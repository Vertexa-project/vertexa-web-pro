/**
 * AUTH-EMAIL-05 — cleanup fail-closed, só local, só o run_id.
 * Nunca wildcard. Nunca apaga usuário que não prove ownership do run.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadIsolatedEnv, resolveIsolatedStack } from "./loadIsolatedEnv.mjs";
import { assertRunId, clinicNameForRun, isRunOwnedClinicName, isRunOwnedEmail } from "./localTarget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const isolated = resolveIsolatedStack(root);
const publicArtifact = path.join(root, ".tmp", "e2e-fixtures.json");
const secretArtifact = path.join(root, ".tmp", "e2e-secrets.json");

function fail(step, detail) {
  console.error(`FAIL ${step}${detail ? ` — ${detail}` : ""}`);
  process.exit(1);
}

function pass(step) {
  console.info(`PASS ${step}`);
}

function readRunId() {
  if (process.env.E2E_RUN_ID) return assertRunId(process.env.E2E_RUN_ID);
  if (!existsSync(publicArtifact)) fail("run_id", "E2E_RUN_ID e artefato ausentes");
  const parsed = JSON.parse(readFileSync(publicArtifact, "utf8"));
  return assertRunId(parsed.run_id);
}

function envOrFail() {
  try {
    return loadIsolatedEnv(isolated);
  } catch (error) {
    fail("stack", error instanceof Error ? error.message : "alvo não local");
  }
}

async function listRunUsers(admin, runId) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const owned = [];
  for (const user of data.users ?? []) {
    const emailOwned = isRunOwnedEmail(user.email, runId);
    const metaRun = user.user_metadata?.e2e_run_id;
    if (!emailOwned && metaRun !== runId) continue;
    if (!emailOwned || metaRun !== runId) {
      throw new Error(`ownership ambígua para ${user.email ? "qa email" : "user"} — cleanup recusado`);
    }
    owned.push(user);
  }
  return owned;
}

async function deleteEq(admin, table, column, ids) {
  if (ids.length === 0) return;
  const { error } = await admin.from(table).delete().in(column, ids);
  if (error) throw new Error(`${table}: ${error.message}`);
}

const env = envOrFail();
const admin = createClient(env.apiUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = readRunId();

const beforeUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (beforeUsers.error) fail("snapshot", beforeUsers.error.message);
const preexistingEmails = new Set(
  (beforeUsers.data.users ?? [])
    .map((user) => user.email)
    .filter((email) => email && !isRunOwnedEmail(email, runId)),
);

const ownedUsers = await listRunUsers(admin, runId).catch((error) => fail("ownership", error.message));
const authIds = ownedUsers.map((user) => user.id);

let ownedProfiles = [];
if (authIds.length) {
  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("id, auth_user_id, email")
    .in("auth_user_id", authIds);
  if (profileErr) fail("profiles", profileErr.message);
  ownedProfiles = (profiles ?? []).filter((row) => {
    const emailOk = !row.email || isRunOwnedEmail(row.email, runId);
    const authOk = authIds.includes(row.auth_user_id);
    if (!authOk || !emailOk) fail("ownership", "profile fora do run");
    return true;
  });
}
const profileIds = ownedProfiles.map((row) => row.id);

const { data: clinics, error: clinicErr } = await admin
  .from("clinics")
  .select("id, name, owner_profile_id")
  .eq("name", clinicNameForRun(runId));
if (clinicErr) fail("clinics", clinicErr.message);
const ownedClinics = (clinics ?? []).filter((row) => {
  if (!isRunOwnedClinicName(row.name, runId)) fail("ownership", "clínica fora do run");
  if (profileIds.length && row.owner_profile_id && !profileIds.includes(row.owner_profile_id)) {
    fail("ownership", "clínica sem owner do run");
  }
  return true;
});
const clinicIds = ownedClinics.map((row) => row.id);

if (ownedUsers.length === 0 && ownedClinics.length === 0 && ownedProfiles.length === 0) {
  pass(`cleanup-empty run_id=${runId}`);
} else {
  try {
    if (clinicIds.length) {
      const { data: clinicPatients, error: patErr } = await admin
        .from("patients")
        .select("id")
        .in("clinic_id", clinicIds);
      if (patErr) throw new Error(patErr.message);
      const patientIds = (clinicPatients ?? []).map((row) => row.id);
      if (patientIds.length) {
        await deleteEq(admin, "professional_patient_links", "patient_id", patientIds);
      }
      await deleteEq(admin, "patients", "clinic_id", clinicIds);
      await deleteEq(admin, "clinic_join_requests", "clinic_id", clinicIds);
      await deleteEq(admin, "professionals", "clinic_id", clinicIds);
      await deleteEq(admin, "clinics", "id", clinicIds);
    }
    if (profileIds.length) {
      await deleteEq(admin, "patients", "profile_id", profileIds);
      await deleteEq(admin, "professionals", "profile_id", profileIds);
      await deleteEq(admin, "clinic_join_requests", "profile_id", profileIds);
    }
    for (const user of ownedUsers) {
      const removed = await admin.auth.admin.deleteUser(user.id);
      if (removed.error) throw new Error(removed.error.message);
    }
    if (profileIds.length) {
      await deleteEq(admin, "profiles", "id", profileIds);
    }
  } catch (error) {
    fail("delete", error instanceof Error ? error.message : "delete recusado");
  }
  pass(`cleanup-deleted run_id=${runId} users=${ownedUsers.length} clinics=${ownedClinics.length}`);
}

const leftoverUsers = await listRunUsers(admin, runId).catch((error) => fail("assert-users", error.message));
if (leftoverUsers.length > 0) fail("assert-users", "usuários do run permanecem");
const leftoverClinics = await admin.from("clinics").select("id").eq("name", clinicNameForRun(runId));
if (leftoverClinics.error) fail("assert-clinics", leftoverClinics.error.message);
if ((leftoverClinics.data ?? []).length > 0) fail("assert-clinics", "clínica do run permanece");

const afterUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (afterUsers.error) fail("assert-preexisting", afterUsers.error.message);
for (const email of preexistingEmails) {
  const still = (afterUsers.data.users ?? []).some((user) => user.email === email);
  if (!still) fail("assert-preexisting", "usuário fora do run foi removido");
}
pass("cleanup-assertions");

if (existsSync(publicArtifact)) unlinkSync(publicArtifact);
if (existsSync(secretArtifact)) unlinkSync(secretArtifact);
pass("artifacts-removed");
