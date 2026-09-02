// PLATFORM-02 S26 — duas suspensões simultâneas: só uma legítima, 1 event.
import { spawn, execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WP02_DOCKER_DB || "supabase_db_vertexa-wp09b1";

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
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.stdin.write(sql);
    child.stdin.end();
  });
}

psql(`
set session_replication_role = replica;
delete from private.platform_clinic_status_events
 where clinic_id in (select id from public.clinics where name = 'Clinica Conc 02');
delete from private.platform_admins
 where profile_id in (select id from public.profiles where email like '%conc-02@t.test');
delete from public.professionals
 where profile_id in (select id from public.profiles where email like '%conc-02@t.test');
delete from public.clinics where name = 'Clinica Conc 02';
delete from public.profiles where email like '%conc-02@t.test';
set session_replication_role = origin;
`);

const seed = psql(`
insert into public.profiles (id, auth_user_id, role, full_name, email, status)
values
  (gen_random_uuid(), gen_random_uuid(), 'professional', 'PA Conc 02', 'pa-conc-02@t.test', 'active'),
  (gen_random_uuid(), gen_random_uuid(), 'professional', 'Own Conc 02', 'own-conc-02@t.test', 'active');
insert into public.clinics (id, name, owner_profile_id)
select gen_random_uuid(), 'Clinica Conc 02', p.id
  from public.profiles p where p.email = 'own-conc-02@t.test';
insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
select p.id, c.id, 'other', 'admin', 'active'
  from public.profiles p
  join public.clinics c on c.owner_profile_id = p.id
 where p.email = 'own-conc-02@t.test';
insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
select p.id, 'active', now(), null
  from public.profiles p where p.email = 'pa-conc-02@t.test';
select c.id::text || ',' || p.auth_user_id::text
  from public.clinics c
  join public.profiles p on p.email = 'pa-conc-02@t.test'
 where c.name = 'Clinica Conc 02';
`);

const [clinicId, authId] = seed.split(",");
if (!clinicId || !authId) throw new Error("seed fail: " + seed);

const sql = `
begin;
select set_config('request.jwt.claims', json_build_object('sub','${authId}','role','authenticated')::text, true);
set local role authenticated;
select public.suspend_platform_clinic('${clinicId}'::uuid, 'corrida simultanea');
commit;
`;

const [a, b] = await Promise.all([runConn(sql), runConn(sql)]);
const ok = [a, b].filter((r) => r.code === 0 && !/ERROR/i.test(r.err));
const failed = [a, b].filter((r) => r.code !== 0 || /ERROR/i.test(r.err));

const inspect = psql(`
select status || ',' || (
  select count(*)::text from private.platform_clinic_status_events
   where clinic_id = '${clinicId}'::uuid
) from public.clinics where id = '${clinicId}'::uuid;
`);

psql(`
set session_replication_role = replica;
delete from private.platform_clinic_status_events where clinic_id = '${clinicId}'::uuid;
delete from private.platform_admins
 where profile_id in (select id from public.profiles where email like '%conc-02@t.test');
delete from public.professionals
 where profile_id in (select id from public.profiles where email like '%conc-02@t.test');
delete from public.clinics where id = '${clinicId}'::uuid;
delete from public.profiles where email like '%conc-02@t.test';
set session_replication_role = origin;
`);

const [status, events] = inspect.split(",");
if (status !== "suspended") throw new Error("S26 status=" + status);
if (events !== "1") throw new Error("S26 events=" + events + " ok=" + ok.length + " fail=" + failed.length);
if (ok.length !== 1 || failed.length !== 1) {
  throw new Error("S26 winners=" + ok.length + " losers=" + failed.length + " a=" + a.err + " b=" + b.err);
}
console.log("PLATFORM-02 S26 concurrency PASSED events=1 status=suspended");
