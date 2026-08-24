// WP-07B1 — PostgREST local P1–P8.
// Não usa service_role como usuário. JWT HS256 com role=authenticated e sub=auth_user_id.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DOCKER_DB = process.env.WP07B1_DOCKER_DB || 'supabase_db_vertexa-wp05a1c';
const API = (process.env.WP07B1_API || 'http://127.0.0.1:55523').replace(/\/$/, '');
const PREFIX = process.env.WP07B1_PREFIX ?? '';
const JWT_SECRET =
  process.env.WP07B1_JWT_SECRET ||
  'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON =
  process.env.WP07B1_ANON_KEY ||
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

async function req(path, { method = 'GET', token, body, extra = {} } = {}) {
  const headers = {
    apikey: token || ANON,
    Authorization: `Bearer ${token || ANON}`,
    ...extra,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = extra.Prefer || 'return=representation';
  }
  const res = await fetch(`${API}${PREFIX}${path}`, {
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
create or replace function pg_temp.wp07b1_pgrst_seed()
returns table (a1 uuid, a2 uuid, p2 uuid, nid1 uuid, nid2 uuid)
language plpgsql as $s$
declare
  v_c uuid; v_pown uuid := gen_random_uuid(); v_aown uuid := gen_random_uuid();
  v_pa1 uuid := gen_random_uuid(); v_aa1 uuid := gen_random_uuid(); v_pra1 uuid;
  v_pa2 uuid := gen_random_uuid(); v_aa2 uuid := gen_random_uuid(); v_pra2 uuid;
  v_ppat uuid := gen_random_uuid(); v_apat uuid := gen_random_uuid(); v_pat uuid; v_ch uuid;
  v_n1 uuid; v_n2 uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pown, v_aown, 'professional', 'Own', 'own-pgrst@t.test', 'active'),
    (v_pa1, v_aa1, 'professional', 'A1', 'a1-pgrst@t.test', 'active'),
    (v_pa2, v_aa2, 'professional', 'A2', 'a2-pgrst@t.test', 'active'),
    (v_ppat, v_apat, 'patient', 'P', 'p-pgrst@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (gen_random_uuid(), 'PGRST 07B1', v_pown) returning id into v_c;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pown, v_c, 'other', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pa1, v_c, 'doctor', 'member', 'active') returning id into v_pra1;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pa2, v_c, 'nutritionist', 'member', 'active') returning id into v_pra2;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_ppat, v_c, 'meta') returning id into v_pat;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_aown, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(v_pat, v_pra1);
  perform public.assign_patient_professional(v_pat, v_pra2);
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_aa1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ch := public.get_or_create_channel(v_pat);
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_apat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (v_ch, v_ppat, 'patient', 'Preciso de ajuda' || chr(32) || chr(8212) || ' Dieta');
  reset role;
  select id into v_n1 from public.staff_notifications where recipient_profile_id = v_pa1;
  select id into v_n2 from public.staff_notifications where recipient_profile_id = v_pa2;
  return query select v_aa1, v_aa2, v_pa2, v_n1, v_n2;
end;
$s$;
select row_to_json(t) from pg_temp.wp07b1_pgrst_seed() t;
`;

const raw = psql(seedSql);
const ids = JSON.parse(raw);
const tok1 = mint(ids.a1);
const tok2 = mint(ids.a2);

const p1 = await req('/staff_notifications?select=id,type,severity,recipient_profile_id,read_at', {
  token: tok1,
});
if (p1.status !== 200) fail('P1_status', p1.status + ' ' + p1.text);
if (!Array.isArray(p1.json) || p1.json.length !== 1) fail('P1_rows', JSON.stringify(p1.json));
console.log('P1 PASS');

const p2 = await req(
  `/staff_notifications?select=id&recipient_profile_id=eq.${ids.p2}`,
  { token: tok1 },
);
if (p2.status !== 200) fail('P2_status', p2.status + ' ' + p2.text);
if (!Array.isArray(p2.json) || p2.json.length !== 0) fail('P2_rows', JSON.stringify(p2.json));
console.log('P2 PASS');

const p3 = await req(`/staff_notifications?id=eq.${ids.nid1}`, {
  method: 'PATCH',
  token: tok1,
  body: { read_at: new Date().toISOString() },
});
if (p3.status < 200 || p3.status >= 300) fail('P3_status', p3.status + ' ' + p3.text);
console.log('P3 PASS');

const p4 = await req(`/staff_notifications?id=eq.${ids.nid1}`, {
  method: 'PATCH',
  token: tok1,
  body: { severity: 'critical', type: 'help_requested' },
});
if (p4.status < 400) fail('P4_deveria_negar', p4.status + ' ' + p4.text);
console.log('P4 PASS', p4.status);

const p5 = await req(`/staff_notifications?id=eq.${ids.nid2}`, {
  method: 'PATCH',
  token: tok1,
  body: { read_at: new Date().toISOString() },
  extra: { Prefer: 'return=representation' },
});
if (p5.status === 200 && Array.isArray(p5.json) && p5.json.length > 0) {
  fail('P5_alterou_a2', JSON.stringify(p5.json));
}
const stillUnread = psql(
  `select read_at is null from public.staff_notifications where id = '${ids.nid2}'`,
);
if (stillUnread !== 't') fail('P5_read_at_a2', stillUnread);
console.log('P5 PASS', p5.status);

const p6 = await req('/staff_notifications', {
  method: 'POST',
  token: tok1,
  body: {
    clinic_id: '00000000-0000-0000-0000-000000000000',
    recipient_profile_id: ids.a1,
    message_id: '00000000-0000-0000-0000-000000000000',
    type: 'help_requested',
    severity: 'critical',
  },
});
if (p6.status < 400) fail('P6_deveria_negar', p6.status + ' ' + p6.text);
console.log('P6 PASS', p6.status);

const p7 = await req(`/staff_notifications?id=eq.${ids.nid1}`, {
  method: 'DELETE',
  token: tok1,
});
if (p7.status < 400) fail('P7_deveria_negar', p7.status + ' ' + p7.text);
console.log('P7 PASS', p7.status);

const p8 = await req('/staff_notifications?select=id');
if (p8.status === 200 && Array.isArray(p8.json) && p8.json.length > 0) {
  fail('P8_anon_viu', JSON.stringify(p8.json));
}
if (p8.status !== 200 && p8.status !== 401 && p8.status !== 403) {
  fail('P8_status_inesperado', p8.status + ' ' + p8.text);
}
console.log('P8 PASS', p8.status);
console.log('WP-07B1 P1-P8 PASSED');
