// WP-10B1 — PostgREST local: platform admin vs clinic admin vs professional vs patient vs anon.
// Não usa service_role como cliente.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DOCKER_DB = process.env.WP10B1_DOCKER_DB || 'supabase_db_vertexa-wp09b1';
const API = (process.env.WP10B1_API || 'http://127.0.0.1:55533').replace(/\/$/, '');
const JWT_SECRET =
  process.env.WP10B1_JWT_SECRET ||
  'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON =
  process.env.WP10B1_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function mint(sub, role = 'authenticated') {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({
      iss: 'supabase-demo',
      role,
      sub,
      aud: 'authenticated',
      exp: now + 3600,
      iat: now,
    }),
  );
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      DOCKER_DB,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-t',
      '-A',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = {
    apikey: token || ANON,
    Authorization: `Bearer ${token || ANON}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
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

function asBool(json, label) {
  if (json === true || json === false) return json;
  if (Array.isArray(json) && json.length === 1 && typeof json[0] === 'boolean') {
    return json[0];
  }
  fail(`${label}_bool`, JSON.stringify(json));
}

function denied(res, label) {
  if (res.status !== 401 && res.status !== 403) {
    fail(`${label}_status`, res.status + ' ' + res.text);
  }
}

function emptyList(res, label) {
  if (res.status !== 200) fail(`${label}_status`, res.status + ' ' + res.text);
  if (!Array.isArray(res.json) || res.json.length !== 0) {
    fail(`${label}_rows`, JSON.stringify(res.json));
  }
}

const seedSql = `
begin;
create or replace function pg_temp.wp10b1_pgrst_seed()
returns table (
  a_plat uuid, a_rev uuid, a_adm uuid, a_mem uuid, a_pat uuid, a_common uuid,
  c_a uuid, c_b uuid
)
language plpgsql as $s$
declare
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid(); v_aown uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid(); v_aadm uuid := gen_random_uuid();
  v_mem uuid := gen_random_uuid(); v_amem uuid := gen_random_uuid();
  v_ownb uuid := gen_random_uuid(); v_aownb uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid(); v_ap1 uuid := gen_random_uuid();
  v_plat uuid := gen_random_uuid(); v_aplat uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid(); v_arev uuid := gen_random_uuid();
  v_com uuid := gen_random_uuid(); v_acom uuid := gen_random_uuid();
  v_pr_mem uuid; v_pat uuid; v_ch uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_own,  v_aown,  'professional', 'Own PGRST 10B1',  'own-pgrst-10b1@t.test',  'active'),
    (v_adm,  v_aadm,  'professional', 'Adm PGRST 10B1',  'adm-pgrst-10b1@t.test',  'active'),
    (v_mem,  v_amem,  'professional', 'Mem PGRST 10B1',  'mem-pgrst-10b1@t.test',  'active'),
    (v_ownb, v_aownb, 'professional', 'OwnB PGRST 10B1', 'ownb-pgrst-10b1@t.test', 'active'),
    (v_p1,   v_ap1,   'patient',      'P1 PGRST 10B1',   'p1-pgrst-10b1@t.test',   'active'),
    (v_plat, v_aplat, 'professional', 'Plat PGRST 10B1', 'plat-pgrst-10b1@t.test', 'active'),
    (v_rev,  v_arev,  'professional', 'Rev PGRST 10B1',  'rev-pgrst-10b1@t.test',  'active'),
    (v_com,  v_acom,  'professional', 'Com PGRST 10B1',  'com-pgrst-10b1@t.test',  'pending');
  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1, 'Clinica PGRST 10B1 A', v_own),
    (v_c2, 'Clinica PGRST 10B1 B', v_ownb);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_own, v_c1, 'other', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_adm, v_c1, 'doctor', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_mem, v_c1, 'nutritionist', 'member', 'active') returning id into v_pr_mem;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_ownb, v_c2, 'doctor', 'admin', 'active');
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_p1, v_c1, 'meta') returning id into v_pat;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_pr_mem, v_pat, false, 'active');
  insert into public.chat_channels (id, patient_id) values (v_ch, v_pat);
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (v_ch, v_p1, 'patient', 'hello pgrst 10b1');
  insert into public.adherence_snapshots (patient_id, score, level)
    values (v_pat, 40, 'atencao');
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at) values
    (v_plat, 'active', now(), null),
    (v_rev,  'revoked', now() - interval '1 day', now());
  return query select v_aplat, v_arev, v_aadm, v_amem, v_ap1, v_acom, v_c1, v_c2;
end;
$s$;
select row_to_json(t) from pg_temp.wp10b1_pgrst_seed() t;
commit;
`;

const raw = psql(seedSql);
const ids = JSON.parse(raw);
const tokPlat = mint(ids.a_plat);
const tokRev = mint(ids.a_rev);
const tokAdm = mint(ids.a_adm);
const tokMem = mint(ids.a_mem);
const tokPat = mint(ids.a_pat);
const tokCom = mint(ids.a_common);

try {
  const hidden = await req('/platform_admins', { token: tokPlat });
  if (hidden.status !== 404) fail('TABLE_exposed', hidden.status + ' ' + hidden.text);
  console.log('TABLE private.platform_admins not exposed PASS', hidden.status);

  const ami = await req('/rpc/am_i_platform_admin', { method: 'POST', token: tokPlat, body: {} });
  if (ami.status !== 200) fail('A_ami_status', ami.status + ' ' + ami.text);
  if (asBool(ami.json, 'A_ami') !== true) fail('A_ami', JSON.stringify(ami.json));
  console.log('A am_i_platform_admin true PASS');

  const list = await req('/rpc/list_platform_clinics', { method: 'POST', token: tokPlat, body: {} });
  if (list.status !== 200) fail('A_list_status', list.status + ' ' + list.text);
  if (!Array.isArray(list.json) || list.json.length < 2) {
    fail('A_list_rows', JSON.stringify(list.json));
  }
  const rowA = list.json.find((r) => r.clinic_id === ids.c_a);
  const rowB = list.json.find((r) => r.clinic_id === ids.c_b);
  if (!rowA || !rowB) fail('A_list_missing_seed', JSON.stringify(list.json));
  if (rowA.clinic_name !== 'Clinica PGRST 10B1 A') fail('A_name', JSON.stringify(rowA));
  if (Number(rowA.professional_count) !== 3) fail('A_prof_count', JSON.stringify(rowA));
  if (Number(rowA.patient_count) !== 1) fail('A_pat_count', JSON.stringify(rowA));
  const keys = Object.keys(rowA).sort().join(',');
  if (/join_code|email|auth_user|patient_id|full_name/i.test(keys)) {
    fail('A_projection', keys);
  }
  console.log('A list_platform_clinics PASS', keys);

  emptyList(await req('/patients', { token: tokPlat }), 'A_patients');
  emptyList(await req('/clinics', { token: tokPlat }), 'A_clinics_table');
  emptyList(await req('/chat_messages', { token: tokPlat }), 'A_chat');
  emptyList(await req('/adherence_snapshots', { token: tokPlat }), 'A_adh');
  emptyList(await req('/professional_patient_links', { token: tokPlat }), 'A_ppl');
  console.log('A clinical isolation PASS');

  const amiRev = await req('/rpc/am_i_platform_admin', { method: 'POST', token: tokRev, body: {} });
  if (amiRev.status !== 200) fail('B_ami_status', amiRev.status + ' ' + amiRev.text);
  if (asBool(amiRev.json, 'B_ami') !== false) fail('B_ami', JSON.stringify(amiRev.json));
  denied(await req('/rpc/list_platform_clinics', { method: 'POST', token: tokRev, body: {} }), 'B_list');
  console.log('B revoked PASS');

  const amiAdm = await req('/rpc/am_i_platform_admin', { method: 'POST', token: tokAdm, body: {} });
  if (asBool(amiAdm.json, 'C_ami') !== false) fail('C_ami', JSON.stringify(amiAdm.json));
  denied(await req('/rpc/list_platform_clinics', { method: 'POST', token: tokAdm, body: {} }), 'C_list');
  console.log('C clinic admin PASS');

  const amiMem = await req('/rpc/am_i_platform_admin', { method: 'POST', token: tokMem, body: {} });
  if (asBool(amiMem.json, 'D_ami') !== false) fail('D_ami', JSON.stringify(amiMem.json));
  denied(await req('/rpc/list_platform_clinics', { method: 'POST', token: tokMem, body: {} }), 'D_list');
  console.log('D professional PASS');

  const amiPat = await req('/rpc/am_i_platform_admin', { method: 'POST', token: tokPat, body: {} });
  if (asBool(amiPat.json, 'E_ami') !== false) fail('E_ami', JSON.stringify(amiPat.json));
  denied(await req('/rpc/list_platform_clinics', { method: 'POST', token: tokPat, body: {} }), 'E_list');
  console.log('E patient PASS');

  const amiCom = await req('/rpc/am_i_platform_admin', { method: 'POST', token: tokCom, body: {} });
  if (asBool(amiCom.json, 'F_ami') !== false) fail('F_ami', JSON.stringify(amiCom.json));
  denied(await req('/rpc/list_platform_clinics', { method: 'POST', token: tokCom, body: {} }), 'F_list');
  console.log('F common authenticated PASS');

  const anonAmi = await req('/rpc/am_i_platform_admin', { method: 'POST', body: {} });
  if (anonAmi.status === 200 && asBool(anonAmi.json, 'G_ami') === true) {
    fail('G_ami_true', JSON.stringify(anonAmi.json));
  }
  if (anonAmi.status !== 401 && anonAmi.status !== 403 && anonAmi.status !== 404) {
    fail('G_ami_status', anonAmi.status + ' ' + anonAmi.text);
  }
  const anonList = await req('/rpc/list_platform_clinics', { method: 'POST', body: {} });
  if (anonList.status === 200) fail('G_list_200', anonList.text);
  if (anonList.status !== 401 && anonList.status !== 403 && anonList.status !== 404) {
    fail('G_list_status', anonList.status + ' ' + anonList.text);
  }
  console.log('G anon PASS', anonAmi.status, anonList.status);
  console.log('WP-10B1 PostgREST PASSED');
} finally {
  psql(`
    delete from private.platform_admins
     where profile_id in (select id from public.profiles where email like '%pgrst-10b1@t.test');
    delete from public.adherence_snapshots
     where patient_id in (
       select pt.id from public.patients pt
       join public.profiles pf on pf.id = pt.profile_id
       where pf.email like '%pgrst-10b1@t.test'
     );
    delete from public.chat_messages
     where sender_profile_id in (select id from public.profiles where email like '%pgrst-10b1@t.test');
    delete from public.chat_channels
     where patient_id in (
       select pt.id from public.patients pt
       join public.profiles pf on pf.id = pt.profile_id
       where pf.email like '%pgrst-10b1@t.test'
     );
    delete from public.professional_patient_links
     where professional_id in (
       select pr.id from public.professionals pr
       join public.profiles pf on pf.id = pr.profile_id
       where pf.email like '%pgrst-10b1@t.test'
     );
    delete from public.patients
     where profile_id in (select id from public.profiles where email like '%pgrst-10b1@t.test');
    delete from public.professionals
     where profile_id in (select id from public.profiles where email like '%pgrst-10b1@t.test');
    delete from public.clinics where name like 'Clinica PGRST 10B1%';
    delete from public.profiles where email like '%pgrst-10b1@t.test';
  `);
}
