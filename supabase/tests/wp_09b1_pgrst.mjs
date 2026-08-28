// WP-09B1 — PostgREST local: get_my_care_team via JWT de pacientes sintéticos.
// Não usa service_role como cliente.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DOCKER_DB = process.env.WP09B1_DOCKER_DB || 'supabase_db_vertexa-wp05a1c';
const API = (process.env.WP09B1_API || 'http://127.0.0.1:55523').replace(/\/$/, '');
const JWT_SECRET =
  process.env.WP09B1_JWT_SECRET ||
  'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON =
  process.env.WP09B1_ANON_KEY ||
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

async function req(path, { method = 'POST', token, body = {} } = {}) {
  const headers = {
    apikey: token || ANON,
    Authorization: `Bearer ${token || ANON}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
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
create or replace function pg_temp.wp09b1_pgrst_seed()
returns table (a_p1 uuid, a_p2 uuid, a_adm uuid, ana uuid, beta uuid)
language plpgsql as $s$
declare
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid(); v_aown uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid(); v_aadm uuid := gen_random_uuid();
  v_ana uuid := gen_random_uuid(); v_aana uuid := gen_random_uuid();
  v_beta uuid := gen_random_uuid(); v_abeta uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid(); v_ap1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid(); v_ap2 uuid := gen_random_uuid();
  v_pr_ana uuid; v_pr_beta uuid; v_pat1 uuid; v_pat2 uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_own,  v_aown,  'professional', 'Own PGRST 09B1',  'own-pgrst-09b1@t.test',  'active'),
    (v_adm,  v_aadm,  'professional', 'Adm PGRST 09B1',  'adm-pgrst-09b1@t.test',  'active'),
    (v_ana,  v_aana,  'professional', 'Ana PGRST 09B1',  'ana-pgrst-09b1@t.test',  'active'),
    (v_beta, v_abeta, 'professional', 'Beta PGRST 09B1', 'beta-pgrst-09b1@t.test', 'active'),
    (v_p1,   v_ap1,   'patient',      'P1 PGRST 09B1',   'p1-pgrst-09b1@t.test',   'active'),
    (v_p2,   v_ap2,   'patient',      'P2 PGRST 09B1',   'p2-pgrst-09b1@t.test',   'active');
  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1, 'Clinica PGRST 09B1 A', v_own),
    (v_c2, 'Clinica PGRST 09B1 B', v_beta);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_own, v_c1, 'other', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_adm, v_c1, 'doctor', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_ana, v_c1, 'nutritionist', 'member', 'active') returning id into v_pr_ana;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_beta, v_c2, 'doctor', 'admin', 'active') returning id into v_pr_beta;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_p1, v_c1, 'meta') returning id into v_pat1;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_p2, v_c2, 'meta') returning id into v_pat2;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (v_pr_ana, v_pat1, false, 'active'),
    (v_pr_beta, v_pat2, false, 'active');
  return query select v_ap1, v_ap2, v_aadm, v_pr_ana, v_pr_beta;
end;
$s$;
select row_to_json(t) from pg_temp.wp09b1_pgrst_seed() t;
commit;
`;

const raw = psql(seedSql);
const ids = JSON.parse(raw);
const tokP1 = mint(ids.a_p1);
const tokP2 = mint(ids.a_p2);
const tokAdm = mint(ids.a_adm);

try {
  const p1 = await req('/rpc/get_my_care_team', { token: tokP1 });
  if (p1.status !== 200) fail('P1_status', p1.status + ' ' + p1.text);
  if (!Array.isArray(p1.json) || p1.json.length !== 1) fail('P1_rows', JSON.stringify(p1.json));
  if (p1.json[0].professional_id !== ids.ana) fail('P1_id', JSON.stringify(p1.json));
  if (p1.json[0].professional_id === ids.beta) fail('P1_leak_beta', JSON.stringify(p1.json));
  const keys = Object.keys(p1.json[0]).sort().join(',');
  if (
    /email|auth_user|registry|clinic_role|clinic_id|status_reason|status_changed/i.test(keys)
  ) {
    fail('P1_admin_fields', keys);
  }
  console.log('P1 PASS', keys);

  const p2 = await req('/rpc/get_my_care_team', { token: tokP2 });
  if (p2.status !== 200) fail('P2_status', p2.status + ' ' + p2.text);
  if (!Array.isArray(p2.json) || p2.json.length !== 1) fail('P2_rows', JSON.stringify(p2.json));
  if (p2.json[0].professional_id !== ids.beta) fail('P2_id', JSON.stringify(p2.json));
  if (p2.json[0].professional_id === ids.ana) fail('P2_leak_ana', JSON.stringify(p2.json));
  console.log('P2 PASS');

  const np = await req('/rpc/get_my_care_team', { token: tokAdm });
  if (np.status !== 200) fail('NP_status', np.status + ' ' + np.text);
  if (!Array.isArray(np.json) || np.json.length !== 0) fail('NP_rows', JSON.stringify(np.json));
  console.log('NP PASS fail-closed');

  const anon = await req('/rpc/get_my_care_team');
  if (anon.status === 200 && Array.isArray(anon.json) && anon.json.length > 0) {
    fail('ANON_viu', JSON.stringify(anon.json));
  }
  if (anon.status !== 401 && anon.status !== 403 && anon.status !== 404) {
    fail('ANON_status', anon.status + ' ' + anon.text);
  }
  console.log('ANON PASS', anon.status);
  console.log('WP-09B1 PostgREST PASSED');
} finally {
  psql(`
    delete from public.professional_patient_links
     where professional_id in (
       select pr.id from public.professionals pr
       join public.profiles pf on pf.id = pr.profile_id
       where pf.email like '%pgrst-09b1@t.test'
     );
    delete from public.patients
     where profile_id in (select id from public.profiles where email like '%pgrst-09b1@t.test');
    delete from public.professionals
     where profile_id in (select id from public.profiles where email like '%pgrst-09b1@t.test');
    delete from public.clinics where name like 'Clinica PGRST 09B1%';
    delete from public.profiles where email like '%pgrst-09b1@t.test';
  `);
}
