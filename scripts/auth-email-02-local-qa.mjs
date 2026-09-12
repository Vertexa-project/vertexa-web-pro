/**
 * AUTH-EMAIL-02 — QA local contra o stack isolado + Mailpit/Inbucket.
 * Cria usuários só no Auth local. Não imprime senha, token nem service_role.
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolated = path.join(root, ".tmp-authemail01");
const MAIL_URL = "http://127.0.0.1:55624";
const ORIGIN = "http://localhost:5173";
const PASSWORD = "local-qa-ok-8";
const NEW_PASSWORD = "local-qa-ok-9";

function fail(step, detail) {
  console.error(`FAIL ${step}${detail ? ` — ${detail}` : ""}`);
  process.exit(1);
}

function pass(step) {
  console.info(`PASS ${step}`);
}

function loadIsolatedEnv() {
  if (!existsSync(isolated)) fail("stack", "tmpdir isolado ausente");
  const result = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: isolated,
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) fail("stack", "supabase status falhou");
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const get = (key) => text.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");
  const apiUrl = get("API_URL");
  const anonKey = get("ANON_KEY");
  const serviceKey = get("SERVICE_ROLE_KEY");
  if (!apiUrl || !anonKey || !serviceKey) fail("stack", "env local incompleto");
  if (/supabase\\.co/i.test(apiUrl)) fail("stack", "recusou URL remota");
  return { apiUrl, anonKey, serviceKey };
}

async function mailpitMessages() {
  const res = await fetch(`${MAIL_URL}/api/v1/messages`);
  if (!res.ok) return null;
  return res.json();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractLink(htmlOrText) {
  const source = decodeHtml(htmlOrText ?? "");
  const match = source.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const scored = match
    .map((raw) => {
      try {
        const url = new URL(raw);
        const keys = [...url.searchParams.keys()];
        const hasType = keys.includes("type");
        const hasToken = keys.includes("token") || keys.includes("token_hash");
        return { raw, score: (hasType ? 2 : 0) + (hasToken ? 2 : 0) + (url.pathname.includes("verify") ? 1 : 0) };
      } catch {
        return { raw, score: 0 };
      }
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].raw : null;
}

async function verifyFromLink(client, link) {
  const res = await fetch(link, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  if (!location) {
    return { data: { session: null }, error: { message: `verify HTTP ${res.status}` } };
  }
  let hash = "";
  try {
    hash = new URL(location).hash;
  } catch {
    const idx = location.indexOf("#");
    hash = idx >= 0 ? location.slice(idx) : "";
  }
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) {
    return { data: { session: null }, error: { message: "verify sem sessão no redirect" } };
  }
  return client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
}

function messageRecipients(message) {
  return JSON.stringify(message.To ?? message.to ?? message.recipients ?? "").toLowerCase();
}

async function waitForMail(to, subjectRe, timeoutMs = 20_000) {
  const started = Date.now();
  const needle = to.toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const box = await mailpitMessages();
    const messages = [...(box?.messages ?? box?.items ?? [])].sort((a, b) => {
      const ta = Date.parse(a.Created ?? a.created ?? "") || 0;
      const tb = Date.parse(b.Created ?? b.created ?? "") || 0;
      return tb - ta;
    });
    for (const hit of messages) {
      const subject = String(hit.Subject ?? hit.subject ?? "");
      if (!subjectRe.test(subject)) continue;
      if (!messageRecipients(hit).includes(needle)) continue;
      const id = hit.ID ?? hit.id;
      const full = await fetch(`${MAIL_URL}/api/v1/message/${id}`).then((r) => r.json());
      if (!messageRecipients(full).includes(needle) && !messageRecipients(hit).includes(needle)) continue;
      const body = `${full.HTML ?? full.html ?? ""} ${full.Text ?? full.text ?? ""}`;
      const link = extractLink(body);
      return { subject: full.Subject ?? hit.Subject ?? "", link };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

await fetch(`${MAIL_URL}/api/v1/messages`, { method: "DELETE" }).catch(() => undefined);

const env = loadIsolatedEnv();
const admin = createClient(env.apiUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stamp = Date.now();
const ownerEmail = `ae02-owner-${stamp}@example.test`;
const invitedEmail = `ae02-invited-${stamp}@example.test`;
const unconfirmedEmail = `ae02-unconf-${stamp}@example.test`;

const ownerClient = createClient(env.apiUrl, env.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const signupPayload = (email, fullName) => ({
  email,
  password: PASSWORD,
  options: {
    emailRedirectTo: `${ORIGIN}/auth/callback`,
    data: { full_name: fullName, signup_surface: "web" },
  },
});

const ownerSignUp = await ownerClient.auth.signUp(signupPayload(ownerEmail, "QA Owner"));
if (ownerSignUp.error) fail("signup-owner", ownerSignUp.error.message);
if (ownerSignUp.data.session) fail("signup-owner", "sessão inesperada com confirm ON");
if (JSON.stringify(ownerSignUp.data.user?.user_metadata ?? {}).includes("role")) {
  fail("signup-metadata", "metadata contém role");
}
pass("signup-owner-no-session");

const ownerMail = await waitForMail(ownerEmail, /confirm/i);
if (!ownerMail?.link) fail("local-mail-owner", "e-mail de confirmação não capturado");
pass("local-mail-owner");

const confirm = await verifyFromLink(ownerClient, ownerMail.link);
if (confirm.error) fail("confirm-owner", confirm.error.message);
pass("confirm-owner-link");

const confirmedLogin = confirm.data.session
  ? confirm
  : await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
if (confirmedLogin.error || !confirmedLogin.data.session) fail("login-confirmed", confirmedLogin.error?.message);
pass("login-confirmed");

const ensure = await ownerClient.rpc("ensure_my_profile");
if (ensure.error) fail("ensure-profile", ensure.error.message);
pass("ensure-profile");

const { data: profile, error: profileError } = await ownerClient
  .from("profiles")
  .select("id, auth_user_id, full_name")
  .eq("auth_user_id", confirmedLogin.data.user.id)
  .maybeSingle();
if (profileError || !profile) fail("profile-pending", profileError?.message ?? "sem profile");
pass("profile-exists");

const { data: professional } = await ownerClient
  .from("professionals")
  .select("id")
  .eq("profile_id", profile.id)
  .maybeSingle();
if (professional) fail("profile-pending", "profissional criado no auth layer");
pass("profile-pending-no-professional");

const onboarding = await ownerClient.rpc("get_clinic_onboarding_state");
if (onboarding.error) fail("onboarding-state", onboarding.error.message);
const mode = onboarding.data?.mode ?? onboarding.data?.[0]?.mode ?? null;
pass(`onboarding-state mode=${mode ?? "unknown"}`);

const wrong = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: "wrong-pass" });
if (!wrong.error) fail("login-wrong", "aceitou senha errada");
pass("login-wrong-safe");

const unconfClient = createClient(env.apiUrl, env.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const unconfSignUp = await unconfClient.auth.signUp(signupPayload(unconfirmedEmail, "QA Unconfirmed"));
if (unconfSignUp.error) fail("signup-unconfirmed", unconfSignUp.error.message);
const unconfLogin = await unconfClient.auth.signInWithPassword({
  email: unconfirmedEmail,
  password: PASSWORD,
});
if (unconfLogin.data.session) fail("unconfirmed-login", "sessão concedida sem confirmar");
pass("unconfirmed-blocked");

const invitedClient = createClient(env.apiUrl, env.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const invitedSignUp = await invitedClient.auth.signUp(signupPayload(invitedEmail, "QA Invited"));
if (invitedSignUp.error) fail("signup-invited", invitedSignUp.error.message);
const invitedMail = await waitForMail(invitedEmail, /confirm/i);
if (!invitedMail?.link) fail("local-mail-invited", "confirmação do convidado não capturada");
const invitedConfirm = await verifyFromLink(invitedClient, invitedMail.link);
if (invitedConfirm.error) fail("confirm-invited", invitedConfirm.error.message);
const invitedLogin = invitedConfirm.data.session
  ? invitedConfirm
  : await invitedClient.auth.signInWithPassword({ email: invitedEmail, password: PASSWORD });
if (invitedLogin.error) fail("login-invited", invitedLogin.error.message);
await invitedClient.rpc("ensure_my_profile");
const invalidJoin = await invitedClient.rpc("request_clinic_access", { p_join_code: "ZZZZZZZZ" });
if (!invalidJoin.error) fail("join-invalid", "código inválido aceito");
pass("join-invalid-neutral");

const { data: clinics } = await admin.from("clinics").select("id, join_code").limit(5);
const fixture = (clinics ?? []).find((row) => row.join_code);
if (fixture?.join_code) {
  const join = await invitedClient.rpc("request_clinic_access", { p_join_code: fixture.join_code });
  if (join.error) fail("join-valid", join.error.message);
  pass("join-valid-request");
} else {
  pass("join-valid-skipped-no-fixture");
}

const reset = await ownerClient.auth.resetPasswordForEmail(ownerEmail, {
  redirectTo: `${ORIGIN}/auth/update-password`,
});
if (reset.error) fail("forgot-password", reset.error.message);
const resetMail = await waitForMail(ownerEmail, /reset|recover|redefin/i);
if (!resetMail?.link) fail("recovery-mail", "e-mail de recovery não capturado");
pass("recovery-mail");
const recoveryClient = createClient(env.apiUrl, env.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const recoveryVerify = await verifyFromLink(recoveryClient, resetMail.link);
if (recoveryVerify.error || !recoveryVerify.data.session) {
  fail("recovery-verify", recoveryVerify.error?.message ?? "sem sessão de recovery");
}
const updated = await recoveryClient.auth.updateUser({ password: NEW_PASSWORD });
if (updated.error) fail("update-password", updated.error.message);
await recoveryClient.auth.signOut();
const oldLogin = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
if (oldLogin.data.session) fail("login-new-password", "senha antiga ainda funciona");
const newLogin = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: NEW_PASSWORD });
if (newLogin.error || !newLogin.data.session) fail("login-new-password", newLogin.error?.message);
pass("recovery-update-login");

const { data: users } = await admin.auth.admin.listUsers();
const created = (users?.users ?? []).filter((u) =>
  [ownerEmail, invitedEmail, unconfirmedEmail].includes(u.email ?? ""),
);
if (created.length < 2) fail("local-users", "usuários locais não encontrados");
pass("local-users-only");

console.info("AUTH-EMAIL-02 local QA complete");
