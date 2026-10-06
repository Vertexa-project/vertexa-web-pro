// WP-PATIENT-ADMIN-EDIT-01 — corrida REAL entre correção de e-mail (admin) e 1º login Google.
// Duas conexões PostgreSQL independentes (psql no container local). Sem service_role, sem dblink.
//
// Resultados PERMITIDOS (a serialização por private.identity_email_lock garante que nunca há
// estado intermediário incompatível):
//   A) edição confirma ANTES do login  -> o login claima o profile existente (1 Auth -> 1 profile -> 1 patient)
//   B) login confirma ANTES da edição  -> a edição é BLOQUEADA (PATIENT_EMAIL_IN_USE), nada é corrompido
// Resultado PROIBIDO: e-mail do profile trocado E profile pending paralelo para o mesmo Auth.
//
// Uso: WPPAE01_DOCKER_DB=<container> node supabase/tests/wp_patient_admin_edit_01_concurrency.mjs
import { spawn, execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WPPAE01_DOCKER_DB || "supabase_db_vertexa-wp05a1c";

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function runConn(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.stdin.write(sql);
    child.stdin.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hintOf = (t) => (String(t || "").match(/HINT:\s*([A-Z0-9_]+)/) || [])[1] || null;
const fail = (m) => {
  throw new Error(m);
};

const tag = `pae01c${Date.now()}`;
const created = { auth: [], profiles: [], patients: [], clinics: [] };

function seedPatient(label, wrongEmail) {
  const out = psql(`
with own as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), gen_random_uuid(), 'professional', '${tag}-${label}-adm', '${tag}-${label}-adm@t.test', 'active')
  returning id, auth_user_id
), cl as (
  insert into public.clinics (id, name, owner_profile_id) select gen_random_uuid(), '${tag}-${label}-clinic', own.id from own returning id
), pat_prof as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), null, 'patient', '${tag}-${label}-pat', '${wrongEmail}', 'active')
  returning id
), pat as (
  insert into public.patients (profile_id, clinic_id, goal)
  select pat_prof.id, cl.id, 'g' from pat_prof, cl returning id
)
select own.id || '|' || own.auth_user_id || '|' || cl.id || '|' || pat_prof.id || '|' || pat.id from own, cl, pat_prof, pat;
`);
  const [pfAdm, aAdm, clinic, pfPat, pat] = out.split("|");
  if (!pat) fail("seed parse: " + out);
  created.profiles.push(pfAdm, pfPat);
  created.clinics.push(clinic);
  created.patients.push(pat);
  return { pfAdm, aAdm, clinic, pfPat, pat };
}

const editSql = (f, email, hold) => `
begin;
set local statement_timeout = '20s';
select set_config('request.jwt.claims', json_build_object('sub', '${f.aAdm}')::text, true);
set local role authenticated;
select public.update_patient_registration('${f.pat}'::uuid, 'Paciente ${tag}', '${email}');
reset role;
${hold ? "select pg_sleep(2);" : ""}
commit;
`;

const loginSql = (authId, email, hold) => `
begin;
set local statement_timeout = '20s';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('${authId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', 'x',
        clock_timestamp(), '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
        clock_timestamp(), clock_timestamp());
${hold ? "select pg_sleep(2);" : ""}
commit;
`;

try {
  // ---------- Cenário A: edição confirma primeiro; login (1º Google) espera e claima ----------
  {
    const f = seedPatient("a", `${tag}-a-errado@t.test`);
    const email = `${tag}-a-correto@t.test`;
    const authId = psql("select gen_random_uuid();");
    created.auth.push(authId);
    const edit = runConn(editSql(f, email, true));
    await sleep(700);
    const login = runConn(loginSql(authId, email, false));
    const [e, l] = await Promise.all([edit, login]);
    if (e.code !== 0) fail("A: edição falhou: " + e.err);
    if (l.code !== 0) fail("A: login falhou: " + l.err);
    const r = psql(`select
      (select email from public.profiles where id = '${f.pfPat}') || '|' ||
      coalesce((select auth_user_id::text from public.profiles where id = '${f.pfPat}'), 'null') || '|' ||
      (select count(*) from public.profiles where lower(btrim(email)) = lower('${email}')) || '|' ||
      (select count(*) from public.patients where profile_id = '${f.pfPat}');`).split("|");
    if (r[0] !== email) fail("A: e-mail não aplicado: " + r[0]);
    if (r[1] !== authId) fail("A: login NÃO claimou o profile existente");
    if (r[2] !== "1") fail("A: profiles por e-mail <> 1 (pending paralelo): " + r[2]);
    if (r[3] !== "1") fail("A: patients <> 1");
    console.log("A PASS: edição primeiro -> 1 Auth -> 1 profile existente -> 1 patient");
  }

  // ---------- Cenário B: login confirma primeiro; edição é bloqueada ----------
  {
    const f = seedPatient("b", `${tag}-b-errado@t.test`);
    const email = `${tag}-b-correto@t.test`;
    const authId = psql("select gen_random_uuid();");
    created.auth.push(authId);
    const login = runConn(loginSql(authId, email, true));
    await sleep(700);
    const edit = runConn(editSql(f, email, false));
    const [l, e] = await Promise.all([login, edit]);
    if (l.code !== 0) fail("B: login falhou: " + l.err);
    if (e.code === 0) fail("B: edição deveria ser bloqueada");
    if (hintOf(e.err) !== "PATIENT_EMAIL_IN_USE") fail("B: hint inesperado: " + hintOf(e.err) + " / " + e.err);
    const r = psql(`select
      (select email from public.profiles where id = '${f.pfPat}') || '|' ||
      coalesce((select auth_user_id::text from public.profiles where id = '${f.pfPat}'), 'null') || '|' ||
      (select count(*) from public.profiles where auth_user_id = '${authId}') || '|' ||
      (select count(*) from public.patients where profile_id = '${f.pfPat}');`).split("|");
    created.profiles.push(psql(`select id from public.profiles where auth_user_id = '${authId}';`));
    if (r[0] !== `${tag}-b-errado@t.test`) fail("B: e-mail do cadastro foi alterado apesar do bloqueio");
    if (r[1] !== "null") fail("B: profile do paciente ganhou Auth indevidamente");
    if (r[2] !== "1") fail("B: Auth deveria ter exatamente 1 profile (pending)");
    if (r[3] !== "1") fail("B: patients <> 1");
    console.log("B PASS: login primeiro -> edição bloqueada (PATIENT_EMAIL_IN_USE), nada corrompido");
  }

  // ---------- Cenário C: double submit simultâneo ----------
  {
    const f = seedPatient("c", `${tag}-c-errado@t.test`);
    const email = `${tag}-c-correto@t.test`;
    const [x, y] = await Promise.all([runConn(editSql(f, email, true)), runConn(editSql(f, email, false))]);
    const oks = [x, y].filter((z) => z.code === 0).length;
    const other = [x, y].find((z) => z.code !== 0);
    if (oks < 1) fail("C: nenhuma chamada passou: " + x.err + " | " + y.err);
    if (other && hintOf(other.err) !== "PATIENT_CHANGED_CONCURRENTLY") fail("C: erro inesperado: " + other.err);
    const r = psql(`select
      (select email from public.profiles where id = '${f.pfPat}') || '|' ||
      (select count(*) from public.patient_registration_events where patient_id = '${f.pat}') || '|' ||
      (select count(*) from public.profiles where lower(btrim(email)) = lower('${email}'));`).split("|");
    if (r[0] !== email) fail("C: e-mail não aplicado");
    if (r[1] !== "1") fail("C: auditoria deveria ter 1 linha, tem " + r[1]);
    if (r[2] !== "1") fail("C: profiles por e-mail <> 1");
    console.log("C PASS: double submit -> 1 efeito, 1 auditoria, sem duplicidade");
  }

  // ---------- Cenário D: ordem FIXA de locks (e-mails cruzados x<->y não podem dar deadlock) ----------
  {
    const f = seedPatient("d", `${tag}-d-x@t.test`);
    const second = psql(`
      with pr as (insert into public.profiles (id, auth_user_id, role, full_name, email, status)
                  values (gen_random_uuid(), null, 'patient', '${tag}-d-pat2', '${tag}-d-y@t.test', 'active') returning id),
           pt as (insert into public.patients (profile_id, clinic_id) select pr.id, '${f.clinic}'::uuid from pr returning id)
      select pr.id || '|' || pt.id from pr, pt;`).split("|");
    created.profiles.push(second[0]);
    created.patients.push(second[1]);
    const f2 = { ...f, pfPat: second[0], pat: second[1] };
    // P1: x -> y   |   P2: y -> x   (ambos seguram os locks por 2s: sem ordem fixa => deadlock)
    const [a, b] = await Promise.all([
      runConn(editSql(f, `${tag}-d-y@t.test`, true)),
      runConn(editSql(f2, `${tag}-d-x@t.test`, true)),
    ]);
    const all = a.err + " " + b.err;
    if (/deadlock/i.test(all) || /40P01/.test(all)) fail("D: DEADLOCK detectado (ordem de locks não é fixa): " + all);
    for (const z of [a, b]) {
      if (z.code !== 0 && hintOf(z.err) !== "PATIENT_EMAIL_IN_USE" && hintOf(z.err) !== "PATIENT_CHANGED_CONCURRENTLY") {
        fail("D: erro inesperado: " + z.err);
      }
    }
    const r = psql(`select
      (select count(*) from public.profiles where id in ('${f.pfPat}','${f2.pfPat}') and email is not null) || '|' ||
      (select count(distinct lower(email)) from public.profiles where id in ('${f.pfPat}','${f2.pfPat}'));`).split("|");
    if (r[0] !== "2" || r[1] !== "2") fail("D: e-mails duplicados/perdidos após a corrida cruzada: " + r.join(","));
    console.log("D PASS: edições cruzadas x<->y -> sem deadlock, sem e-mail duplicado (ordem fixa de locks)");
  }

  console.log("WP-PATIENT-ADMIN-EDIT-01 CONCURRENCY: ALL PASS");
} finally {
  // limpeza dos dados sintéticos (best effort)
  try {
    const ids = (a) => a.filter(Boolean).map((i) => `'${i}'`).join(",") || "'00000000-0000-0000-0000-000000000000'";
    psql(`
      delete from public.patient_registration_events where patient_id in (${ids(created.patients)});
      delete from public.patients where id in (${ids(created.patients)});
      delete from public.clinics where id in (${ids(created.clinics)});
      delete from public.profiles where id in (${ids(created.profiles)}) or auth_user_id in (${ids(created.auth)});
      delete from auth.users where id in (${ids(created.auth)});
    `);
  } catch (e) {
    console.error("cleanup parcial:", e.message);
  }
}
