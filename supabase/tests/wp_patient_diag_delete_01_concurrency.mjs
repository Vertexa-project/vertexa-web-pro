// WP-PATIENT-DIAG-DELETE-01 — corridas REAIS contra delete_unused_patient_registration.
// Duas conexões PostgreSQL independentes (psql no container local). Sem service_role, sem dblink.
//
// Garantia exigida: a exclusão NUNCA apaga movimentação/identidade criada concorrentemente.
//   - escrita confirma ANTES da exclusão  -> a exclusão espera o lock, RECALCULA e é NEGADA
//   - exclusão confirma ANTES da escrita  -> a escrita espera o lock e FALHA (FK) — erro visível,
//                                            nada é perdido em silêncio
// Mecanismo: FOR UPDATE no paciente/canal conflita com o FOR KEY SHARE de todo insert que
// referencia patients.id / chat_channels.id; private.identity_email_lock (chave normalizada e
// canônica Gmail) serializa com o 1º login.
//
// Uso: WPPDD01_DOCKER_DB=<container> node supabase/tests/wp_patient_diag_delete_01_concurrency.mjs
import { spawn, execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WPPDD01_DOCKER_DB || "supabase_db_cdhjfyyuhmwrcuxqavib";

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

const tag = `pdd01c${Date.now()}`;
const created = { auth: [], profiles: [], patients: [], clinics: [] };

// Clínica com owner (= admin) + cadastro intocado (profile sem Auth + patient).
function seed(label, email) {
  const out = psql(`
with own as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), gen_random_uuid(), 'professional', '${tag}-${label}-adm', '${tag}-${label}-adm@t.test', 'active')
  returning id, auth_user_id
), cl as (
  insert into public.clinics (id, name, owner_profile_id) select gen_random_uuid(), '${tag}-${label}-clinic', own.id from own returning id
), pat_prof as (
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (gen_random_uuid(), null, 'patient', '${tag}-${label}-pat', '${email}', 'active')
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

const deleteSql = (f, hold) => `
begin;
set local statement_timeout = '20s';
select set_config('request.jwt.claims', json_build_object('sub', '${f.aAdm}', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.delete_unused_patient_registration('${f.pat}'::uuid);
reset role;
${hold ? "select pg_sleep(2);" : ""}
commit;
`;

const writeSql = (stmt, hold) => `
begin;
set local statement_timeout = '20s';
${stmt}
${hold ? "select pg_sleep(2);" : ""}
commit;
`;

const loginSql = (authId, email, hold) =>
  writeSql(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('${authId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', 'x',
        clock_timestamp(), '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
        clock_timestamp(), clock_timestamp());`,
    hold,
  );

const exists = (table, col, id) => psql(`select count(*) from public.${table} where ${col} = '${id}';`);

try {
  // ---------- T25a: atividade confirma ANTES; exclusão espera, recalcula e é NEGADA ----------
  {
    const f = seed("a", `${tag}-a@t.test`);
    const write = runConn(writeSql(`insert into public.nutrition_plans (patient_id, title) values ('${f.pat}', 'Plano');`, true));
    await sleep(700);
    const del = runConn(deleteSql(f, false));
    const [w, d] = await Promise.all([write, del]);
    if (w.code !== 0) fail("T25a: escrita falhou: " + w.err);
    if (d.code === 0) fail("T25a: exclusão deveria ser negada");
    if (hintOf(d.err) !== "PATIENT_DELETE_HAS_PLANS") fail("T25a: hint inesperado: " + d.err);
    if (exists("patients", "id", f.pat) !== "1") fail("T25a: paciente sumiu");
    if (exists("nutrition_plans", "patient_id", f.pat) !== "1") fail("T25a: plano perdido");
    console.log("T25a PASS: plano criado primeiro -> exclusão negada (PATIENT_DELETE_HAS_PLANS), plano preservado");
  }

  // ---------- T25b: exclusão confirma ANTES; a escrita espera e falha (FK), nada some em silêncio ----------
  {
    const f = seed("b", `${tag}-b@t.test`);
    const del = runConn(deleteSql(f, true));
    await sleep(700);
    const write = runConn(writeSql(`insert into public.weight_logs (patient_id, weight_kg) values ('${f.pat}', 80);`, false));
    const [d, w] = await Promise.all([del, write]);
    if (d.code !== 0) fail("T25b: exclusão falhou: " + d.err);
    if (w.code === 0) fail("T25b: escrita deveria falhar após a exclusão");
    if (!/23503|foreign key/i.test(w.err)) fail("T25b: erro inesperado na escrita: " + w.err);
    if (exists("patients", "id", f.pat) !== "0") fail("T25b: paciente não excluído");
    if (exists("weight_logs", "patient_id", f.pat) !== "0") fail("T25b: peso órfão");
    console.log("T25b PASS: exclusão primeiro -> escrita concorrente falha com FK (sem perda silenciosa)");
  }

  // ---------- T25c/d: mensagem no canal VAZIO (scaffolding) x exclusão, nas duas ordens ----------
  {
    const f = seed("c", `${tag}-c@t.test`);
    const ch = psql(`insert into public.chat_channels (patient_id) values ('${f.pat}') returning id;`).split("\n")[0];
    const msg = `insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
                 values ('${ch}', '${f.pfAdm}', 'professional', 'oi');`;
    const write = runConn(writeSql(msg, true));
    await sleep(700);
    const del = runConn(deleteSql(f, false));
    const [w, d] = await Promise.all([write, del]);
    if (w.code !== 0) fail("T25c: mensagem falhou: " + w.err);
    if (hintOf(d.err) !== "PATIENT_DELETE_HAS_MESSAGES") fail("T25c: esperado HAS_MESSAGES: " + d.err);
    if (exists("chat_messages", "channel_id", ch) !== "1") fail("T25c: mensagem perdida");
    console.log("T25c PASS: mensagem primeiro -> exclusão negada, mensagem preservada");
  }
  {
    const f = seed("d", `${tag}-d@t.test`);
    const ch = psql(`insert into public.chat_channels (patient_id) values ('${f.pat}') returning id;`).split("\n")[0];
    const del = runConn(deleteSql(f, true));
    await sleep(700);
    const write = runConn(
      writeSql(
        `insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
         values ('${ch}', '${f.pfAdm}', 'professional', 'oi');`,
        false,
      ),
    );
    const [d, w] = await Promise.all([del, write]);
    if (d.code !== 0) fail("T25d: exclusão falhou: " + d.err);
    if (w.code === 0) fail("T25d: mensagem deveria falhar após a exclusão do canal vazio");
    if (!/23503|foreign key/i.test(w.err)) fail("T25d: erro inesperado: " + w.err);
    if (exists("chat_messages", "channel_id", ch) !== "0") fail("T25d: mensagem órfã");
    console.log("T25d PASS: exclusão primeiro -> mensagem concorrente falha com FK (cascade não engoliu mensagem)");
  }

  // ---------- T26: double delete simultâneo ----------
  {
    const f = seed("e", `${tag}-e@t.test`);
    const [x, y] = await Promise.all([runConn(deleteSql(f, true)), runConn(deleteSql(f, false))]);
    const oks = [x, y].filter((z) => z.code === 0).length;
    const other = [x, y].find((z) => z.code !== 0);
    if (oks !== 1) fail("T26: esperado exatamente 1 sucesso: " + x.err + " | " + y.err);
    if (hintOf(other.err) !== "PATIENT_NOT_FOUND") fail("T26: segunda chamada deveria ser PATIENT_NOT_FOUND: " + other.err);
    if (psql(`select count(*) from public.patient_registration_deletions where patient_id = '${f.pat}';`) !== "1") {
      fail("T26: auditoria deveria ter 1 linha");
    }
    console.log("T26 PASS: double delete -> 1 exclusão, 1 auditoria, segunda = PATIENT_NOT_FOUND");
  }

  // ---------- T25e: 1º login Google (mesmo e-mail) confirma ANTES -> exclusão negada (AUTH_LINKED) ----------
  {
    const email = `${tag}-f@t.test`;
    const f = seed("f", email);
    const authId = psql("select gen_random_uuid();");
    created.auth.push(authId);
    const login = runConn(loginSql(authId, email, true));
    await sleep(700);
    const del = runConn(deleteSql(f, false));
    const [l, d] = await Promise.all([login, del]);
    if (l.code !== 0) fail("T25e: login falhou: " + l.err);
    if (hintOf(d.err) !== "PATIENT_DELETE_AUTH_LINKED") fail("T25e: esperado AUTH_LINKED: " + d.err);
    if (psql(`select coalesce(auth_user_id::text,'null') from public.profiles where id = '${f.pfPat}';`) !== authId) {
      fail("T25e: login não claimou o cadastro");
    }
    console.log("T25e PASS: login primeiro -> cadastro claimado, exclusão negada (PATIENT_DELETE_AUTH_LINKED)");
  }

  // ---------- T25f: exclusão confirma ANTES do 1º login -> login vira pending, nenhum dado clínico órfão ----------
  {
    const email = `${tag}-g@t.test`;
    const f = seed("g", email);
    const authId = psql("select gen_random_uuid();");
    created.auth.push(authId);
    const del = runConn(deleteSql(f, true));
    await sleep(700);
    const login = runConn(loginSql(authId, email, false));
    const [d, l] = await Promise.all([del, login]);
    if (d.code !== 0) fail("T25f: exclusão falhou: " + d.err);
    if (l.code !== 0) fail("T25f: login falhou: " + l.err);
    if (exists("profiles", "id", f.pfPat) !== "0") fail("T25f: profile excluído reapareceu");
    const r = psql(`select status || '|' || (select count(*) from public.patients pt where pt.profile_id = p.id)
                      from public.profiles p where p.auth_user_id = '${authId}';`);
    if (r !== "pending|0") fail("T25f: esperado 1 profile pending sem patient, veio: " + r);
    console.log("T25f PASS: exclusão primeiro -> 1º login cria pending (sem claim de cadastro excluído)");
  }

  // ---------- T25g: caso Alan — login Gmail SEM ponto em curso x exclusão do cadastro COM ponto ----------
  {
    const local = `${tag}h`.replace(/[^a-z0-9]/g, "");
    const dotted = `${local.slice(0, 4)}.${local.slice(4)}@gmail.com`;
    const plain = `${local}@gmail.com`;
    const f = seed("h", dotted);
    const authId = psql("select gen_random_uuid();");
    created.auth.push(authId);
    const login = runConn(loginSql(authId, plain, true));
    await sleep(700);
    const del = runConn(deleteSql(f, false));
    const [l, d] = await Promise.all([login, del]);
    if (l.code !== 0) fail("T25g: login falhou: " + l.err);
    if (hintOf(d.err) !== "PATIENT_DELETE_AUTH_EMAIL_CONFLICT") fail("T25g: esperado AUTH_EMAIL_CONFLICT: " + d.err);
    if (exists("patients", "id", f.pat) !== "1") fail("T25g: cadastro excluído apesar do conflito");
    console.log("T25g PASS: login Gmail sem ponto em curso -> exclusão do cadastro com ponto negada (chave de risco gmail.com)");
  }

  console.log("WP-PATIENT-DIAG-DELETE-01 CONCURRENCY: ALL PASS");
} finally {
  // limpeza dos dados sintéticos (best effort)
  try {
    const ids = (a) => a.filter(Boolean).map((i) => `'${i}'`).join(",") || "'00000000-0000-0000-0000-000000000000'";
    psql(`
      delete from public.patient_registration_deletions where patient_id in (${ids(created.patients)});
      delete from public.patients where id in (${ids(created.patients)});
      delete from public.clinics where id in (${ids(created.clinics)});
      delete from public.profiles where id in (${ids(created.profiles)}) or auth_user_id in (${ids(created.auth)});
      delete from auth.users where id in (${ids(created.auth)});
    `);
  } catch (e) {
    console.error("cleanup parcial:", e.message);
  }
}
