// PLATFORM-02 — PostgREST JWT real. Não usa service_role como cliente.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WP02_DOCKER_DB || "supabase_db_vertexa-wp09b1";
const API = (process.env.WP02_API || "http://127.0.0.1:55533").replace(/\/$/, "");
const JWT_SECRET =
  process.env.WP02_JWT_SECRET ||
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON =
  process.env.WP02_ANON_KEY ||
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
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
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

async function req(path, { method = "GET", token, body } = {}) {
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

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

const seedSql = `
begin;
create or replace function pg_temp.wp02_pgrst_seed()
returns table (
  a_plat uuid, a_own uuid, a_mem uuid, a_pat uuid,
  c_a uuid, p_a uuid
)
language plpgsql as $s$
declare
  v_c uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid(); v_aown uuid := gen_random_uuid();
  v_mem uuid := gen_random_uuid(); v_amem uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid(); v_apat uuid := gen_random_uuid();
  v_plat uuid := gen_random_uuid(); v_aplat uuid := gen_random_uuid();
  v_pr uuid; v_p uuid; v_ch uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_own,  v_aown,  'professional', 'Own PGRST 02',  'own-pgrst-02@t.test',  'active'),
    (v_mem,  v_amem,  'professional', 'Mem PGRST 02',  'mem-pgrst-02@t.test',  'active'),
    (v_pat,  v_apat,  'patient',      'Pat PGRST 02',  'pat-pgrst-02@t.test',  'active'),
    (v_plat, v_aplat, 'professional', 'Plat PGRST 02', 'plat-pgrst-02@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id) values (v_c, 'Clinica PGRST 02', v_own);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_own, v_c, 'other', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_mem, v_c, 'nutritionist', 'member', 'active') returning id into v_pr;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pat, v_c, 'meta') returning id into v_p;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_pr, v_p, false, 'active');
  insert into public.chat_channels (id, patient_id) values (v_ch, v_p);
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (v_ch, v_pat, 'patient', 'hello pgrst 02');
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_plat, 'active', now(), null);
  return query select v_aplat, v_aown, v_amem, v_apat, v_c, v_p;
end;
$s$;
select row_to_json(t) from pg_temp.wp02_pgrst_seed() t;
commit;
`;

const raw = psql(seedSql);
const ids = JSON.parse(raw);
const tokPlat = mint(ids.a_plat);
const tokOwn = mint(ids.a_own);
const tokMem = mint(ids.a_mem);
const tokPat = mint(ids.a_pat);

function cleanup() {
  psql(`
    delete from private.platform_clinic_status_events
     where clinic_id in (select id from public.clinics where name = 'Clinica PGRST 02');
    delete from private.platform_admins
     where profile_id in (select id from public.profiles where email like '%pgrst-02@t.test');
    delete from public.chat_messages
     where sender_profile_id in (select id from public.profiles where email like '%pgrst-02@t.test');
    delete from public.chat_participants
     where profile_id in (select id from public.profiles where email like '%pgrst-02@t.test');
    delete from public.chat_channels
     where patient_id in (
       select pt.id from public.patients pt
       join public.profiles pf on pf.id = pt.profile_id
       where pf.email like '%pgrst-02@t.test'
     );
    delete from public.professional_patient_links
     where patient_id in (
       select pt.id from public.patients pt
       join public.profiles pf on pf.id = pt.profile_id
       where pf.email like '%pgrst-02@t.test'
     );
    delete from public.patients
     where profile_id in (select id from public.profiles where email like '%pgrst-02@t.test');
    delete from public.professionals
     where profile_id in (select id from public.profiles where email like '%pgrst-02@t.test');
    delete from public.clinics where name = 'Clinica PGRST 02';
    delete from public.profiles where email like '%pgrst-02@t.test';
  `);
}

try {
  const beforePat = await req("/patients", { token: tokPat });
  if (beforePat.status !== 200) fail("pre_pat_status", beforePat.status + " " + beforePat.text);
  if (!Array.isArray(beforePat.json) || beforePat.json.length < 1) {
    fail("pre_pat_rows", JSON.stringify(beforePat.json));
  }

  const denied = await req("/rpc/suspend_platform_clinic", {
    method: "POST",
    token: tokOwn,
    body: { p_clinic_id: ids.c_a, p_reason: "nao deveria" },
  });
  if (denied.status === 200) fail("owner_suspend_200", denied.text);
  console.log("S3/S8 owner cannot suspend PASS", denied.status);

  const susp = await req("/rpc/suspend_platform_clinic", {
    method: "POST",
    token: tokPlat,
    body: { p_clinic_id: ids.c_a, p_reason: "pgrst inadimplencia" },
  });
  if (susp.status !== 200 && susp.status !== 204) {
    fail("pa_suspend", susp.status + " " + susp.text);
  }
  console.log("S1 PA suspend PASS");

  const list = await req("/rpc/list_platform_clinics", { method: "POST", token: tokPlat, body: {} });
  if (list.status !== 200) fail("list_status", list.status + " " + list.text);
  const row = (list.json || []).find((r) => r.clinic_id === ids.c_a);
  if (!row || row.status !== "suspended") fail("list_status_badge", JSON.stringify(row));
  if (/join_code/.test(JSON.stringify(row))) fail("list_join_code", JSON.stringify(row));
  console.log("S27 list status PASS");

  const ownPatients = await req("/patients", { token: tokOwn });
  if (ownPatients.status !== 200) fail("own_pat_status", ownPatients.status + " " + ownPatients.text);
  if (Array.isArray(ownPatients.json) && ownPatients.json.some((p) => p.id === ids.p_a && (p.goal || p.current_weight))) {
    fail("own_clinical", JSON.stringify(ownPatients.json));
  }
  if (Array.isArray(ownPatients.json) && ownPatients.json.some((p) => p.id === ids.p_a)) {
    fail("own_still_sees_patient_row", JSON.stringify(ownPatients.json));
  }
  console.log("S8 owner clinical deny PASS");

  const patSelf = await req("/patients", { token: tokPat });
  if (patSelf.status !== 200) fail("pat_self_status", patSelf.status + " " + patSelf.text);
  if (!Array.isArray(patSelf.json) || patSelf.json.length !== 1) {
    fail("pat_identity", JSON.stringify(patSelf.json));
  }
  const chat = await req("/chat_messages", { token: tokPat });
  if (chat.status !== 200) fail("chat_status", chat.status + " " + chat.text);
  if (Array.isArray(chat.json) && chat.json.length !== 0) fail("S14_chat", JSON.stringify(chat.json));
  console.log("S11/S14 patient identity + chat deny PASS");

  const paPatients = await req("/patients", { token: tokPlat });
  if (paPatients.status !== 200) fail("pa_pat_status", paPatients.status + " " + paPatients.text);
  if (Array.isArray(paPatients.json) && paPatients.json.length !== 0) {
    fail("S7_pa_clinical", JSON.stringify(paPatients.json));
  }
  console.log("S7 PA no clinical PASS");

  const react = await req("/rpc/reactivate_platform_clinic", {
    method: "POST",
    token: tokPlat,
    body: { p_clinic_id: ids.c_a },
  });
  if (react.status !== 200 && react.status !== 204) {
    fail("reactivate", react.status + " " + react.text);
  }

  const afterOwn = await req("/patients", { token: tokOwn });
  if (!Array.isArray(afterOwn.json) || !afterOwn.json.some((p) => p.id === ids.p_a)) {
    fail("S20_owner", JSON.stringify(afterOwn.json));
  }
  console.log("S20 reactivate restores PASS");
  console.log("PLATFORM-02 PostgREST PASSED");
} finally {
  cleanup();
}
