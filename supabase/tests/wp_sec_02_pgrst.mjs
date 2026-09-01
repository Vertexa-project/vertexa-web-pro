// WP-SEC-02 — PostgREST local. JWT do isolador. NÃO usa service_role como cliente.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WPSEC02_DOCKER_DB || "supabase_db_vertexa-wp09b1";
const API = (process.env.WPSEC02_API || "http://127.0.0.1:55533").replace(/\/$/, "");
const JWT_SECRET =
  process.env.WPSEC02_JWT_SECRET ||
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON =
  process.env.WPSEC02_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function mint(sub, role = "authenticated") {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({
      iss: "supabase-demo",
      role,
      sub,
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
    }),
  );
  const sig = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DOCKER_DB,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

async function req(path, { method = "POST", token, body } = {}) {
  const headers = {
    apikey: token || ANON,
    Authorization: `Bearer ${token || ANON}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

function hintOf(res) {
  const j = res.json;
  if (j && typeof j === "object" && j.hint) return String(j.hint);
  const m = String(res.text || "").match(/ONBOARDING_NOT_ALLOWED|NOT_PLATFORM_ADMIN|ALREADY_OWNS_CLINIC|TARGET_[A-Z_]+/);
  return m ? m[0] : null;
}

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function suffix(id) {
  const s = String(id || "");
  return s.length >= 8 ? s.slice(-8) : "n/a";
}

async function main() {
  const health = await fetch(`${API}/`).catch(() => null);
  if (!health) {
    console.log("WP-SEC-02 PGRST SKIP: API unreachable " + API);
    console.log("POSTGREST = PENDING PRE-APPLY GATE");
    process.exit(2);
  }

  const tag = `sec02a1p${Date.now()}`;
  const seed = psql(`
with pa as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), gen_random_uuid(), 'professional',
          '${tag}-pa', '${tag}-pa@t.test', 'active')
  returning id, auth_user_id
), tgt as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), gen_random_uuid(), 'patient',
          '${tag}-tgt', '${tag}-tgt@t.test', 'pending')
  returning id, auth_user_id
), staff as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), gen_random_uuid(), 'professional',
          '${tag}-st', '${tag}-st@t.test', 'active')
  returning id, auth_user_id
), adm as (
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
  select pa.id, 'active', now(), null from pa
)
, pol as (
  update private.clinic_onboarding_policy
     set mode = 'manual_review'
   where id = true
  returning 1
)
select pa.id || '|' || pa.auth_user_id || '|' || tgt.id || '|' || tgt.auth_user_id
    || '|' || staff.id || '|' || staff.auth_user_id
  from pa, tgt, staff, pol;
`);
  const [pfPa, aPa, pfTgt, aTgt, pfStaff, aStaff] = seed.split("|");
  if (!aPa || !aTgt || !aStaff) fail("seed", seed);

  psql(`notify pgrst, 'reload schema';`);

  const pa = mint(aPa);
  const tgt = mint(aTgt);
  const staff = mint(aStaff);
  const rpcCreate = "/rpc/create_clinic_with_owner";
  const rpcAuth = "/rpc/authorize_clinic_creation";

  const results = {};

  // P1 anon → create negado
  const p1 = await req(rpcCreate, { token: ANON, body: { p_name: "Clinica Anon" } });
  if (p1.status < 400) fail("P1", p1.status + " " + p1.text);
  results.P1 = { status: p1.status, denied: true };

  // P2 authenticated comum + profile sem grant → RPC alcançável, ONBOARDING_NOT_ALLOWED
  const p2 = await req(rpcCreate, { token: tgt, body: { p_name: "Clinica Sem Grant" } });
  if (p2.status < 400) fail("P2_allowed", p2.status + " " + p2.text);
  if (hintOf(p2) !== "ONBOARDING_NOT_ALLOWED") fail("P2_hint", p2.text);
  results.P2 = { status: p2.status, hint: "ONBOARDING_NOT_ALLOWED" };

  // P3 authenticated non-PA → authorize negado
  const p3 = await req(rpcAuth, {
    token: staff,
    body: { p_target_profile_id: pfTgt },
  });
  if (p3.status < 400) fail("P3_allowed", p3.status + " " + p3.text);
  if (hintOf(p3) !== "NOT_PLATFORM_ADMIN") fail("P3_hint", p3.text);
  results.P3 = { status: p3.status, hint: "NOT_PLATFORM_ADMIN" };

  // P4 Platform Admin → authorize permitido
  const p4 = await req(rpcAuth, {
    token: pa,
    body: { p_target_profile_id: pfTgt },
  });
  if (p4.status !== 200) fail("P4", p4.status + " " + p4.text);
  const authId = p4.json?.authorization_id || p4.json?.[0]?.authorization_id;
  if (!authId) fail("P4_body", p4.text);
  results.P4 = { status: p4.status, authorization_suffix: suffix(authId) };

  // P5 target com grant → create permitido
  const p5 = await req(rpcCreate, { token: tgt, body: { p_name: "Clinica PGRST SEC02" } });
  if (p5.status !== 200) fail("P5", p5.status + " " + p5.text);
  const clinicId = p5.json?.clinic_id || p5.json?.[0]?.clinic_id;
  if (!clinicId) fail("P5_body", p5.text);
  results.P5 = { status: p5.status, clinic_suffix: suffix(clinicId) };

  // P6 reuse → negado
  const p6 = await req(rpcCreate, { token: tgt, body: { p_name: "Clinica Reuse" } });
  if (p6.status < 400) fail("P6_allowed", p6.status + " " + p6.text);
  const p6hint = hintOf(p6);
  if (p6hint !== "ALREADY_OWNS_CLINIC" && p6hint !== "ONBOARDING_NOT_ALLOWED") {
    fail("P6_hint", p6.text);
  }
  results.P6 = { status: p6.status, hint: p6hint };

  psql(`
delete from public.professionals where profile_id in ('${pfPa}'::uuid, '${pfTgt}'::uuid, '${pfStaff}'::uuid);
delete from public.clinics where owner_profile_id = '${pfTgt}'::uuid;
delete from private.clinic_creation_authorizations
 where target_profile_id in ('${pfPa}'::uuid, '${pfTgt}'::uuid, '${pfStaff}'::uuid);
delete from private.platform_admins where profile_id = '${pfPa}'::uuid;
delete from public.profiles where id in ('${pfPa}'::uuid, '${pfTgt}'::uuid, '${pfStaff}'::uuid);
`);

  console.log("WP-SEC-02 PGRST " + JSON.stringify(results));
  console.log("WP-SEC-02 PGRST ALL ASSERTIONS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
