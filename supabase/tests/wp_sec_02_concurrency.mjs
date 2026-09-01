// WP-SEC-02A1 — corrida REAL: duas conexões PostgreSQL independentes.
// Consomem o MESMO grant para o MESMO profile. Sem dblink. Sem service_role.
import { spawn, execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WPSEC02_DOCKER_DB || "supabase_db_vertexa-wp09b1";

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

function suffix(id) {
  const s = String(id || "").replace(/[^a-f0-9-]/gi, "");
  return s.length >= 8 ? s.slice(-8) : "n/a";
}

function runConn(sql) {
  return new Promise((resolve) => {
    const child = spawn(
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
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const t0 = Date.now();
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => {
      resolve({
        code,
        out: out.trim(),
        err: err.trim(),
        ms: Date.now() - t0,
      });
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

function hintOf(text) {
  const m = String(text || "").match(/HINT:\s*([A-Z0-9_]+)/);
  return m ? m[1] : null;
}

function fail(msg) {
  throw new Error(msg);
}

const tag = `sec02a1c${Date.now()}`;

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
  from pa, tgt, pol;
`);

const [pfPlat, aPlat, pfTgt, aTgt] = seed.split("|");
if (!pfPlat || !aTgt) fail("seed parse: " + seed);

psql(`
select set_config('request.jwt.claims', json_build_object('sub', '${aPlat}')::text, false);
set role authenticated;
select public.authorize_clinic_creation('${pfTgt}'::uuid);
reset role;
`);

const workerSql = `
begin;
set local statement_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', '${aTgt}')::text, true);
set local role authenticated;
select public.create_clinic_with_owner('Clinica Race SEC02A1');
commit;
`;

const tRace = Date.now();
const [left, right] = await Promise.all([runConn(workerSql), runConn(workerSql)]);
const raceMs = Date.now() - tRace;

const inspect = psql(`
select
  (select count(*) from public.clinics where owner_profile_id = '${pfTgt}'::uuid) || '|' ||
  (select count(*) from private.clinic_creation_authorizations
    where target_profile_id = '${pfTgt}'::uuid and consumed_at is not null) || '|' ||
  (select count(*) from private.clinic_creation_authorizations
    where target_profile_id = '${pfTgt}'::uuid and consumed_at is null) || '|' ||
  coalesce((
    select consumed_clinic_id::text
      from private.clinic_creation_authorizations
     where target_profile_id = '${pfTgt}'::uuid
     order by granted_at desc
     limit 1
  ), '') || '|' ||
  coalesce((
    select id::text from public.clinics
     where owner_profile_id = '${pfTgt}'::uuid
     limit 1
  ), '');
`);

const [clinicCount, consumedCount, openCount, consumedClinicId, clinicId] =
  inspect.split("|");

psql(`
delete from public.professionals where profile_id in ('${pfPlat}'::uuid, '${pfTgt}'::uuid);
delete from public.clinics where owner_profile_id = '${pfTgt}'::uuid;
delete from private.clinic_creation_authorizations
 where target_profile_id in ('${pfPlat}'::uuid, '${pfTgt}'::uuid);
delete from private.platform_admins where profile_id = '${pfPlat}'::uuid;
delete from public.profiles where id in ('${pfPlat}'::uuid, '${pfTgt}'::uuid);
`);

const ok = [left, right].filter((r) => r.code === 0 && r.out.includes("clinic_id"));
const denied = [left, right].filter((r) => r.code !== 0);
const hints = denied.map((r) => hintOf(r.err) || hintOf(r.out));
const deadlock = [left, right].some(
  (r) => /40P01|deadlock/i.test(r.err) || /40P01|deadlock/i.test(r.out),
);
const clinicMatch =
  consumedClinicId && clinicId && consumedClinicId === clinicId;

const result = {
  successes: ok.length,
  denied: denied.length,
  denied_hints: hints,
  clinic_count: Number(clinicCount),
  consumed: Number(consumedCount),
  open_grants: Number(openCount),
  consumed_clinic_matches: clinicMatch,
  clinic_suffix: suffix(clinicId),
  deadlock,
  ms: { left: left.ms, right: right.ms, pair: raceMs },
};

console.log("WP-SEC-02 CONCURRENCY " + JSON.stringify(result));

if (
  result.successes !== 1 ||
  result.denied !== 1 ||
  result.clinic_count !== 1 ||
  result.consumed !== 1 ||
  result.open_grants !== 0 ||
  !result.consumed_clinic_matches ||
  result.deadlock ||
  !hints.every((h) => h === "ALREADY_OWNS_CLINIC" || h === "ONBOARDING_NOT_ALLOWED")
) {
  fail("concurrency assertions failed");
}

console.log("WP-SEC-02 CONCURRENCY ALL ASSERTIONS PASSED");
