/**
 * AUTH-EMAIL-05 — factory local de identidades Playwright.
 * Só stack isolado. Recusa *.supabase.co. Não imprime senha, JWT nem service_role.
 *
 * Caminhos de autoridade:
 * - owner: createUser confirmado + ensure_my_profile + create_clinic_with_owner
 *   TEST FIXTURE ONLY: se a policy local estiver closed, materializa o estado
 *   final via service_role local. Não é comportamento de produto/frontend.
 * - professional: request_clinic_access + approve_join_request
 * - linked patient: create_patient (patient-first) + createUser + ensure_my_profile
 * - pending patient: createUser + ensure_my_profile, sem patients
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadIsolatedEnv, resolveIsolatedStack } from "./loadIsolatedEnv.mjs";
import {
  assertRunId,
  clinicNameForRun,
  isRunOwnedEmail,
  newRunId,
  qaEmail,
} from "./localTarget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const isolated = resolveIsolatedStack(root);
const tmpDir = path.join(root, ".tmp");
const publicArtifact = path.join(tmpDir, "e2e-fixtures.json");
const secretArtifact = path.join(tmpDir, "e2e-secrets.json");

function fail(step, detail) {
  console.error(`FAIL ${step}${detail ? ` — ${detail}` : ""}`);
  process.exit(1);
}

function pass(step) {
  console.info(`PASS ${step}`);
}

function newPassword() {
  return randomBytes(24).toString("base64url");
}

function anonClient(env) {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createConfirmedUser(admin, { email, password, fullName, runId, surface }) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, signup_surface: surface, e2e_run_id: runId },
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "createUser falhou");
  }
  const meta = JSON.stringify(created.data.user.user_metadata ?? {});
  if (/(role|patient_id|profile_id|clinic_id|professional_id|is_admin|platform_admin)/i.test(meta)) {
    throw new Error("metadata contém autoridade");
  }
  return created.data.user;
}

async function signIn(env, email, password) {
  const client = anonClient(env);
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.user || !login.data.session) {
    throw new Error(login.error?.message ?? "login falhou");
  }
  return { client, user: login.data.user };
}

async function ensureProfile(client, admin, userId) {
  const ensure = await client.rpc("ensure_my_profile");
  if (ensure.error) throw new Error(ensure.error.message);
  const { data, error } = await admin
    .from("profiles")
    .select("id, auth_user_id, email, role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "profile ausente");
  return data;
}

async function countEq(admin, table, column, value) {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function createOwnerClinic(owner, admin, profile, runId) {
  const name = clinicNameForRun(runId);
  const rpc = await owner.client.rpc("create_clinic_with_owner", { p_name: name });
  let clinicId = rpc.data?.clinic_id ?? rpc.data?.id ?? (typeof rpc.data === "string" ? rpc.data : null);
  let pathUsed = "create_clinic_with_owner";

  if (!clinicId) {
    // TEST FIXTURE ONLY. Local onboarding policy is closed, so the product RPC
    // cannot mint a tenant. This writes the same public rows a successful
    // create_clinic_with_owner would leave. Not frontend/production logic.
    pathUsed = "qa_fixture_closed_policy_materialization";
    const joinCode = `E2${runId.replaceAll("-", "").slice(-6).toUpperCase()}`.slice(0, 8);
    const inserted = await admin
      .from("clinics")
      .insert({ name, owner_profile_id: profile.id, join_code: joinCode })
      .select("id, join_code, owner_profile_id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(inserted.error?.message ?? rpc.error?.message ?? "clínica não criada");
    }
    clinicId = inserted.data.id;
    const pro = await admin.from("professionals").insert({
      profile_id: profile.id,
      clinic_id: clinicId,
      type: "other",
      clinic_role: "admin",
      status: "active",
    });
    if (pro.error) throw new Error(pro.error.message);
    const promoted = await admin
      .from("profiles")
      .update({ role: "professional", status: "active" })
      .eq("id", profile.id);
    if (promoted.error) throw new Error(promoted.error.message);
  }

  const { data: clinic, error } = await admin
    .from("clinics")
    .select("id, name, owner_profile_id, join_code")
    .eq("id", clinicId)
    .maybeSingle();
  if (error || !clinic) throw new Error(error?.message ?? "clínica não lida");
  if (clinic.owner_profile_id !== profile.id) throw new Error("owner_profile_id divergente");
  if (!clinic.join_code) throw new Error("join_code ausente");
  return { clinic, pathUsed };
}

async function findExistingRunUsers(admin, runId) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return (data.users ?? []).filter((user) => isRunOwnedEmail(user.email, runId));
}

const env = (() => {
  try {
    return loadIsolatedEnv(isolated);
  } catch (error) {
    fail("stack", error instanceof Error ? error.message : "env local recusado");
  }
})();

const admin = createClient(env.apiUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = assertRunId(process.env.E2E_RUN_ID || newRunId());
const password = process.env.E2E_PASSWORD || newPassword();
if (password.length < 8) fail("password", "mínimo 8");

const existing = await findExistingRunUsers(admin, runId);
if (existing.length > 0) {
  const cleaned = spawnSync(process.execPath, [path.join(root, "scripts", "qa", "cleanup-e2e-fixtures.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, E2E_RUN_ID: runId },
  });
  if (cleaned.status !== 0) fail("recreate-cleanup", "cleanup do run anterior recusado");
  pass("recreate-cleaned-previous-run");
}

const emails = {
  owner: qaEmail(runId, "owner"),
  professional: qaEmail(runId, "professional"),
  patient: qaEmail(runId, "patient"),
  pending: qaEmail(runId, "pending"),
};

const ownerUser = await createConfirmedUser(admin, {
  email: emails.owner,
  password,
  fullName: "QA E2E Owner",
  runId,
  surface: "web",
}).catch((error) => fail("owner-user", error.message));
const owner = await signIn(env, emails.owner, password).catch((error) => fail("owner-login", error.message));
if (owner.user.id !== ownerUser.id) fail("owner-login", "auth_user_id mudou");
const ownerProfile = await ensureProfile(owner.client, admin, owner.user.id).catch((error) =>
  fail("owner-profile", error.message),
);
const ownerClinic = await createOwnerClinic(owner, admin, ownerProfile, runId).catch((error) =>
  fail("owner-clinic", error.message),
);
const ownerPros = await countEq(admin, "professionals", "profile_id", ownerProfile.id);
if (ownerPros !== 1) fail("owner-authority", `professionals=${ownerPros}`);
if ((await countEq(admin, "clinics", "owner_profile_id", ownerProfile.id)) !== 1) {
  fail("owner-authority", "owner clinic count");
}
pass(`owner-fixture path=${ownerClinic.pathUsed}`);

const memberUser = await createConfirmedUser(admin, {
  email: emails.professional,
  password,
  fullName: "QA E2E Professional",
  runId,
  surface: "web",
}).catch((error) => fail("member-user", error.message));
const member = await signIn(env, emails.professional, password).catch((error) => fail("member-login", error.message));
if (member.user.id !== memberUser.id) fail("member-login", "auth_user_id mudou");
const memberProfile = await ensureProfile(member.client, admin, member.user.id).catch((error) =>
  fail("member-profile", error.message),
);
const join = await member.client.rpc("request_clinic_access", { p_join_code: ownerClinic.clinic.join_code });
if (join.error || !join.data) fail("member-join", join.error?.message ?? "pedido ausente");
const approved = await owner.client.rpc("approve_join_request", { p_request_id: join.data });
if (approved.error) fail("member-approve", approved.error.message);
const memberPros = await admin
  .from("professionals")
  .select("id, clinic_id, clinic_role, profile_id")
  .eq("profile_id", memberProfile.id);
if (memberPros.error) fail("member-authority", memberPros.error.message);
if ((memberPros.data ?? []).length !== 1) fail("member-authority", "professional count");
if (memberPros.data[0].clinic_id !== ownerClinic.clinic.id) fail("member-authority", "clinic divergente");
if (memberPros.data[0].clinic_role === "admin") fail("member-authority", "membro elevado a admin");
if ((await countEq(admin, "clinics", "owner_profile_id", memberProfile.id)) !== 0) {
  fail("member-authority", "membro virou owner");
}
pass("professional-fixture path=request_clinic_access+approve_join_request");

const createdPatient = await owner.client.rpc("create_patient", {
  p_clinic_id: ownerClinic.clinic.id,
  p_full_name: "QA E2E Patient",
  p_email: emails.patient,
});
if (createdPatient.error || !createdPatient.data) {
  fail("patient-first", createdPatient.error?.message ?? "create_patient falhou");
}
const { data: patientRow, error: patientErr } = await admin
  .from("patients")
  .select("id, profile_id, clinic_id")
  .eq("id", createdPatient.data)
  .maybeSingle();
if (patientErr || !patientRow) fail("patient-first", patientErr?.message ?? "patient ausente");
if (patientRow.clinic_id !== ownerClinic.clinic.id) fail("patient-first", "clinic divergente");
const { data: orphanProfile, error: orphanErr } = await admin
  .from("profiles")
  .select("id, auth_user_id, email")
  .eq("id", patientRow.profile_id)
  .maybeSingle();
if (orphanErr || !orphanProfile) fail("patient-first", orphanErr?.message ?? "profile órfão ausente");
if (orphanProfile.auth_user_id) fail("patient-first", "auth_user_id já ligado");

const linkedUser = await createConfirmedUser(admin, {
  email: emails.patient,
  password,
  fullName: "QA E2E Patient",
  runId,
  surface: "patient_app",
}).catch((error) => fail("patient-user", error.message));
const linked = await signIn(env, emails.patient, password).catch((error) => fail("patient-login", error.message));
if (linked.user.id !== linkedUser.id) fail("patient-login", "auth_user_id mudou");
const linkedProfile = await ensureProfile(linked.client, admin, linked.user.id).catch((error) =>
  fail("patient-link", error.message),
);
if (linkedProfile.id !== orphanProfile.id) fail("patient-link", "profile duplicado");
if ((await countEq(admin, "patients", "profile_id", linkedProfile.id)) !== 1) {
  fail("patient-link", "patient count");
}
pass("linked-patient-fixture path=create_patient+ensure_my_profile");

const pendingUser = await createConfirmedUser(admin, {
  email: emails.pending,
  password,
  fullName: "QA E2E Pending",
  runId,
  surface: "patient_app",
}).catch((error) => fail("pending-user", error.message));
const pending = await signIn(env, emails.pending, password).catch((error) => fail("pending-login", error.message));
if (pending.user.id !== pendingUser.id) fail("pending-login", "auth_user_id mudou");
const pendingProfile = await ensureProfile(pending.client, admin, pending.user.id).catch((error) =>
  fail("pending-profile", error.message),
);
if ((await countEq(admin, "patients", "profile_id", pendingProfile.id)) !== 0) {
  fail("pending-authority", "patients row criada");
}
if ((await countEq(admin, "professionals", "profile_id", pendingProfile.id)) !== 0) {
  fail("pending-authority", "professional criado");
}
pass("pending-patient-fixture");

pass("platform-admin SKIP — autoridade vive em private.platform_admins; fixture não criada");

mkdirSync(tmpDir, { recursive: true });
const publicPayload = {
  run_id: runId,
  app: "professional",
  emails,
  ids: {
    clinic_id: ownerClinic.clinic.id,
    owner_auth_user_id: owner.user.id,
    owner_profile_id: ownerProfile.id,
    professional_auth_user_id: member.user.id,
    professional_profile_id: memberProfile.id,
    professional_id: memberPros.data[0].id,
    patient_id: patientRow.id,
    patient_profile_id: linkedProfile.id,
    patient_auth_user_id: linked.user.id,
    pending_profile_id: pendingProfile.id,
    pending_auth_user_id: pending.user.id,
  },
  paths: {
    owner_clinic: ownerClinic.pathUsed,
    professional: "request_clinic_access+approve_join_request",
    linked_patient: "create_patient+ensure_my_profile",
    pending_patient: "ensure_my_profile_without_patients",
  },
};
writeFileSync(publicArtifact, `${JSON.stringify(publicPayload, null, 2)}\n`, { encoding: "utf8" });
writeFileSync(secretArtifact, `${JSON.stringify({ run_id: runId, password }, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

console.info(`PASS factory run_id=${runId}`);
console.info(`PASS emails owner/professional/patient/pending @${emails.owner.split("@")[1]}`);
console.info("PASS artifacts .tmp/e2e-fixtures.json .tmp/e2e-secrets.json (gitignored)");
