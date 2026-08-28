// WP-09B0 — PostgREST: paciente sintético continua resolvendo o MESMO patient.
// Não usa service_role como cliente. Não testa Care Team.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DOCKER_DB = process.env.WP09B0_DOCKER_DB || 'supabase_db_vertexa-wp05a1c';
const API = (process.env.WP09B0_API || 'http://127.0.0.1:55523').replace(/\/$/, '');
const JWT_SECRET =
  process.env.WP09B0_JWT_SECRET ||
  'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON =
  process.env.WP09B0_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function mint(sub) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({
      iss: 'supabase-demo',
      role: 'authenticated',
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

async function req(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      apikey: token || ANON,
      Authorization: `Bearer ${token || ANON}`,
    },
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

const raw = psql(`
begin;
create or replace function pg_temp.wp09b0_pgrst_seed()
returns table (a_pat uuid, a_adm uuid, patient_id uuid)
language plpgsql as $s$
declare
  v_c uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid(); v_aown uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid(); v_aadm uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid(); v_ap uuid := gen_random_uuid();
  v_pat uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_own, v_aown, 'professional', 'Own PGRST 09B0', 'own-pgrst-09b0@t.test', 'active'),
    (v_adm, v_aadm, 'professional', 'Adm PGRST 09B0', 'adm-pgrst-09b0@t.test', 'active'),
    (v_p, v_ap, 'patient', 'Pat PGRST 09B0', 'pat-pgrst-09b0@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_c, 'Clinica PGRST 09B0', v_own);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_own, v_c, 'other', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_adm, v_c, 'doctor', 'admin', 'active');
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_p, v_c, 'meta') returning id into v_pat;
  return query select v_ap, v_aadm, v_pat;
end;
$s$;
select row_to_json(t) from pg_temp.wp09b0_pgrst_seed() t;
commit;
`);

const ids = JSON.parse(raw);
const tokPat = mint(ids.a_pat);
const tokAdm = mint(ids.a_adm);

try {
  const helper = psql(`
    select private.current_patient_id()
    from (select set_config('request.jwt.claims',
           json_build_object('sub','${ids.a_pat}','role','authenticated')::text, true)) s;
  `);
  if (helper !== ids.patient_id) fail('HELPER', helper + ' vs ' + ids.patient_id);

  const p1 = await req('/patients?select=id', tokPat);
  if (p1.status !== 200) fail('P1_status', p1.status + ' ' + p1.text);
  if (!Array.isArray(p1.json) || p1.json.length !== 1) fail('P1_rows', JSON.stringify(p1.json));
  if (p1.json[0].id !== ids.patient_id) fail('P1_id', JSON.stringify(p1.json));

  const adm = await req(`/patients?select=id&id=eq.${ids.patient_id}`, tokAdm);
  if (adm.status !== 200) fail('ADM_status', adm.status + ' ' + adm.text);
  if (!Array.isArray(adm.json) || adm.json.length !== 1) {
    fail('ADM_clinic_read', JSON.stringify(adm.json));
  }

  const anon = await req('/patients?select=id');
  if (anon.status === 200 && Array.isArray(anon.json) && anon.json.some((r) => r.id === ids.patient_id)) {
    fail('ANON_viu', JSON.stringify(anon.json));
  }
  console.log('WP-09B0 PostgREST PASSED', ids.patient_id);
} finally {
  psql(`
    delete from public.patients
     where profile_id in (select id from public.profiles where email like '%pgrst-09b0@t.test');
    delete from public.professionals
     where profile_id in (select id from public.profiles where email like '%pgrst-09b0@t.test');
    delete from public.clinics where name = 'Clinica PGRST 09B0';
    delete from public.profiles where email like '%pgrst-09b0@t.test';
  `);
}
