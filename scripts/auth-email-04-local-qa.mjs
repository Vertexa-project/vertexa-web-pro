/**
 * AUTH-EMAIL-04 — QA local: mesma auth user após updateUser({ password }).
 * Só stack isolado. Recusa *.supabase.co. Não imprime senha, token nem service_role.
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolated = path.join(root, ".tmp-authemail01");
const PASSWORD = "local-qa-ok-8";

function fail(step, detail) {
  console.error(`FAIL ${step}${detail ? ` — ${detail}` : ""}`);
  process.exit(1);
}

function pass(step) {
  console.info(`PASS ${step}`);
}

function loadIsolatedEnv() {
  if (!existsSync(isolated)) fail("stack", "tmpdir isolado ausente");
  const result = spawnSync("npx", ["--yes", "supabase@2.117.0", "status", "-o", "env"], {
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
  if (/supabase\.co/i.test(apiUrl)) fail("stack", "recusou URL remota");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(apiUrl)) {
    fail("stack", "recusou URL não local");
  }
  return { apiUrl, anonKey, serviceKey };
}

async function countRows(admin, table) {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) fail(`count-${table}`, error.message);
  return count ?? 0;
}

async function snapshot(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) fail("count-auth-users", error.message);
  return {
    authUsers: data.users.length,
    profiles: await countRows(admin, "profiles"),
    professionals: await countRows(admin, "professionals"),
    patients: await countRows(admin, "patients"),
    clinics: await countRows(admin, "clinics"),
  };
}

function sameCounts(before, after) {
  return Object.keys(before).every((key) => before[key] === after[key]);
}

const env = loadIsolatedEnv();
const admin = createClient(env.apiUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(env.apiUrl, env.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `ae04-google-shaped-${Date.now()}@example.test`;
const created = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
  app_metadata: { provider: "google", providers: ["google"] },
});
if (created.error || !created.data.user) fail("create-google-shaped", created.error?.message);
const userId = created.data.user.id;
pass("create-google-shaped-local-user");

const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (link.error || !link.data.properties?.hashed_token) {
  fail("magiclink", link.error?.message ?? "sem hashed_token");
}
const verified = await client.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.data.properties.hashed_token,
});
if (verified.error || !verified.data.user) fail("session", verified.error?.message ?? "sem sessão");
if (verified.data.user.id !== userId) fail("session", "id divergente após magiclink");
pass("session-same-user");

await client.rpc("ensure_my_profile");
const { data: profileBefore, error: profileError } = await client
  .from("profiles")
  .select("id, auth_user_id")
  .eq("auth_user_id", userId)
  .maybeSingle();
if (profileError || !profileBefore) fail("profile-before", profileError?.message ?? "sem profile");
if (profileBefore.auth_user_id !== userId) fail("profile-before", "auth_user_id divergente");
pass("profile-before");

const before = await snapshot(admin);
const payload = { password: PASSWORD };
if (JSON.stringify(Object.keys(payload)) !== JSON.stringify(["password"])) {
  fail("payload", "payload não é só password");
}

const updated = await client.auth.updateUser(payload);
if (updated.error) fail("updateUser", updated.error.message);
if (updated.data.user?.id !== userId) fail("updateUser", "auth user id mudou");
pass("updateUser-same-user");

await client.auth.getUser();
const after = await snapshot(admin);
if (!sameCounts(before, after)) {
  fail("counts", `antes=${JSON.stringify(before)} depois=${JSON.stringify(after)}`);
}
pass("counts-unchanged");

const { data: profileAfter, error: profileAfterError } = await client
  .from("profiles")
  .select("id, auth_user_id")
  .eq("auth_user_id", userId)
  .maybeSingle();
if (profileAfterError || !profileAfter) fail("profile-after", profileAfterError?.message ?? "sem profile");
if (profileAfter.id !== profileBefore.id) fail("profile-after", "profile id mudou");
if (profileAfter.auth_user_id !== userId) fail("profile-after", "auth_user_id mudou");
pass("profile-same");

const { data: professional } = await client.from("professionals").select("id").eq("profile_id", profileAfter.id);
if ((professional ?? []).length > 0) fail("authority", "profissional criado");
const { data: patient } = await client.from("patients").select("id").eq("profile_id", profileAfter.id);
if ((patient ?? []).length > 0) fail("authority", "paciente criado");
pass("no-professional-or-patient-created");

await client.auth.signOut();
const login = await client.auth.signInWithPassword({ email, password: PASSWORD });
if (login.error || !login.data.user) fail("login-password", login.error?.message ?? "sem sessão");
if (login.data.user.id !== userId) fail("login-password", "login criou outra auth user");
pass("login-email-password-same-user");

console.info("AUTH-EMAIL-04 local QA complete");
console.info(
  `counts auth.users=${after.authUsers} profiles=${after.profiles} professionals=${after.professionals} patients=${after.patients} clinics=${after.clinics}`,
);
