-- =====================================================================================
-- WP-10B1 · TESTES (Nível 1: BEGIN / DO pequeno / ROLLBACK).
-- HARNESS: exige a migration 20260818090000 aplicada.
-- Login simulado via request.jwt.claims (sub = auth_user_id) + set local role.
-- NÃO usa SET ROLE anon (isolador PG 17.6 — SIGSEGV). Prova anon = has_function_privilege.
--
-- Platform admin de teste NÃO tem membership clínica (isolamento real).
-- Counts: TODOS os professionals/patients da clínica (sem filtro de status).
-- list_platform_clinics: fail-closed = 42501 + hint NOT_PLATFORM_ADMIN (não zero rows).
-- =====================================================================================

create or replace function pg_temp.wp10b1_seed()
returns table (
  a_plat uuid, a_rev uuid, a_owner uuid, a_admin uuid, a_member uuid, a_pat uuid, a_common uuid,
  pf_plat uuid, pf_rev uuid, pf_owner uuid, pf_admin uuid, pf_member uuid, pf_pat uuid, pf_common uuid,
  c_a uuid, c_b uuid,
  n_prof_a int, n_pat_a int, n_prof_b int, n_pat_b int,
  n_patients_all int, n_chat_all int, n_adh_all int, n_clinics_all int
)
language plpgsql
as $seed$
declare
  v_c_a uuid := gen_random_uuid(); v_c_b uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_pf_mem uuid := gen_random_uuid(); v_a_mem uuid := gen_random_uuid();
  v_pf_ina uuid := gen_random_uuid(); v_a_ina uuid := gen_random_uuid();
  v_pf_own_b uuid := gen_random_uuid(); v_a_own_b uuid := gen_random_uuid();
  v_pf_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid();
  v_pf_pat2 uuid := gen_random_uuid(); v_a_pat2 uuid := gen_random_uuid();
  v_pf_pat_b uuid := gen_random_uuid(); v_a_pat_b uuid := gen_random_uuid();
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_rev uuid := gen_random_uuid(); v_a_rev uuid := gen_random_uuid();
  v_pf_com uuid := gen_random_uuid(); v_a_com uuid := gen_random_uuid();
  v_pr_mem uuid; v_p1 uuid; v_ch uuid := gen_random_uuid();
  v_n_prof_a int; v_n_pat_a int; v_n_prof_b int; v_n_pat_b int;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own,   v_a_own,   'professional', 'Owner Alfa 10B1',    'own-10b1@t.test',   'active'),
    (v_pf_adm,   v_a_adm,   'professional', 'Admin Alfa 10B1',    'adm-10b1@t.test',   'active'),
    (v_pf_mem,   v_a_mem,   'professional', 'Member Alfa 10B1',   'mem-10b1@t.test',   'active'),
    (v_pf_ina,   v_a_ina,   'professional', 'Inativo Alfa 10B1',  'ina-10b1@t.test',   'active'),
    (v_pf_own_b, v_a_own_b, 'professional', 'Owner Beta 10B1',    'ownb-10b1@t.test',  'active'),
    (v_pf_pat,   v_a_pat,   'patient',      'Paciente A1 10B1',   'p1-10b1@t.test',    'active'),
    (v_pf_pat2,  v_a_pat2,  'patient',      'Paciente A2 10B1',   'p2-10b1@t.test',    'active'),
    (v_pf_pat_b, v_a_pat_b, 'patient',      'Paciente B 10B1',    'pb-10b1@t.test',    'active'),
    (v_pf_plat,  v_a_plat,  'professional', 'Platform Op 10B1',   'plat-10b1@t.test',  'active'),
    (v_pf_rev,   v_a_rev,   'professional', 'Platform Rev 10B1',  'rev-10b1@t.test',   'active'),
    (v_pf_com,   v_a_com,   'professional', 'Common Auth 10B1',   'com-10b1@t.test',   'pending');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c_a, 'Clinica Alfa 10B1', v_pf_own),
    (v_c_b, 'Clinica Beta 10B1', v_pf_own_b);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_pf_own,   v_c_a, 'other',          'admin',  'active'),
    (v_pf_adm,   v_c_a, 'doctor',         'admin',  'active'),
    (v_pf_mem,   v_c_a, 'nutritionist',   'member', 'active'),
    (v_pf_ina,   v_c_a, 'other',          'member', 'inactive'),
    (v_pf_own_b, v_c_b, 'doctor',         'admin',  'active');

  select pr.id into v_pr_mem from public.professionals pr
   where pr.profile_id = v_pf_mem;

  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_pat, v_c_a, 'meta') returning id into v_p1;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_pat2, v_c_a, 'meta');
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_pat_b, v_c_b, 'meta');

  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_pr_mem, v_p1, false, 'active');

  insert into public.chat_channels (id, patient_id) values (v_ch, v_p1);
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (v_ch, v_pf_pat, 'patient', 'hello 10b1');
  insert into public.adherence_snapshots (patient_id, score, level)
    values (v_p1, 50, 'atencao');

  -- platform admins: SEM professional/patient. Autoridade só nesta tabela.
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at) values
    (v_pf_plat, 'active',  now(), null),
    (v_pf_rev,  'revoked', now() - interval '1 day', now());

  select count(*)::int into v_n_prof_a from public.professionals where clinic_id = v_c_a;
  select count(*)::int into v_n_pat_a  from public.patients      where clinic_id = v_c_a;
  select count(*)::int into v_n_prof_b from public.professionals where clinic_id = v_c_b;
  select count(*)::int into v_n_pat_b  from public.patients      where clinic_id = v_c_b;

  return query select
    v_a_plat, v_a_rev, v_a_own, v_a_adm, v_a_mem, v_a_pat, v_a_com,
    v_pf_plat, v_pf_rev, v_pf_own, v_pf_adm, v_pf_mem, v_pf_pat, v_pf_com,
    v_c_a, v_c_b,
    v_n_prof_a, v_n_pat_a, v_n_prof_b, v_n_pat_b,
    (select count(*)::int from public.patients),
    (select count(*)::int from public.chat_messages),
    (select count(*)::int from public.adherence_snapshots),
    (select count(*)::int from public.clinics);
end;
$seed$;


-- T1 T8 grants: anon sem execute; authenticated com execute; PUBLIC revogado.
-- Funções: private.is_platform_admin, public.am_i_platform_admin, public.list_platform_clinics.
begin;
do $$
declare
  n_pub int;
begin
  if has_function_privilege('anon', 'private.is_platform_admin()', 'execute') then
    raise exception 'WP-10B1 T1 FAIL: anon execute is_platform_admin';
  end if;
  if has_function_privilege('anon', 'public.am_i_platform_admin()', 'execute') then
    raise exception 'WP-10B1 T1 FAIL: anon execute am_i_platform_admin';
  end if;
  if has_function_privilege('anon', 'public.list_platform_clinics()', 'execute') then
    raise exception 'WP-10B1 T1 FAIL: anon execute list_platform_clinics';
  end if;
  if not has_function_privilege('authenticated', 'private.is_platform_admin()', 'execute') then
    raise exception 'WP-10B1 T1 FAIL: authenticated sem execute is_platform_admin';
  end if;
  if not has_function_privilege('authenticated', 'public.am_i_platform_admin()', 'execute') then
    raise exception 'WP-10B1 T8 FAIL: authenticated sem execute am_i_platform_admin';
  end if;
  if not has_function_privilege('authenticated', 'public.list_platform_clinics()', 'execute') then
    raise exception 'WP-10B1 T1 FAIL: authenticated sem execute list_platform_clinics';
  end if;
  select count(*) into n_pub
    from information_schema.routine_privileges
   where specific_schema in ('public', 'private')
     and routine_name in ('is_platform_admin', 'am_i_platform_admin', 'list_platform_clinics')
     and grantee = 'PUBLIC';
  if n_pub <> 0 then raise exception 'WP-10B1 T1 FAIL: PUBLIC grants=%', n_pub; end if;

  -- sem JWT: fail-closed false (postgres chama DEFINER que lê current_profile_id → null)
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T1 FAIL: sem auth deveria ser false';
  end if;
  raise notice 'WP-10B1 T1 T8 grants: PASS';
end $$;
rollback;


-- Assinaturas zero-arg, STABLE, DEFINER, search_path vazio.
begin;
do $$
declare
  r record;
begin
  if pg_get_function_identity_arguments('private.is_platform_admin()'::regprocedure) <> '' then
    raise exception 'WP-10B1 FAIL: is_platform_admin args';
  end if;
  if pg_get_function_identity_arguments('public.am_i_platform_admin()'::regprocedure) <> '' then
    raise exception 'WP-10B1 FAIL: am_i_platform_admin args';
  end if;
  if pg_get_function_identity_arguments('public.list_platform_clinics()'::regprocedure) <> '' then
    raise exception 'WP-10B1 FAIL: list_platform_clinics args';
  end if;
  for r in
    select p.proname, p.prosecdef, p.provolatile, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('private','is_platform_admin'),
       ('public','am_i_platform_admin'),
       ('public','list_platform_clinics')
     )
  loop
    if r.prosecdef is not true then
      raise exception 'WP-10B1 FAIL: % not DEFINER', r.proname;
    end if;
    if r.provolatile <> 's' then
      raise exception 'WP-10B1 FAIL: % not STABLE (%)', r.proname, r.provolatile;
    end if;
    if r.proconfig is null or not exists (
      select 1 from unnest(r.proconfig) c
       where c in ('search_path=', 'search_path=""', 'search_path=''''')
          or c like 'search_path=%'
    ) then
      raise exception 'WP-10B1 FAIL: % search_path config=%', r.proname, r.proconfig;
    end if;
    if not exists (
      select 1 from unnest(coalesce(r.proconfig, array[]::text[])) c
       where c = 'search_path=' or c = 'search_path=""' or c = 'search_path='''''
    ) then
      raise exception 'WP-10B1 FAIL: % search_path not empty: %', r.proname, r.proconfig;
    end if;
  end loop;
  raise notice 'WP-10B1 signatures/DEFINER/search_path: PASS';
end $$;
rollback;


-- T14 T15 T16 projeção: sem join_code, email, patient ids/names, auth_user.
begin;
do $$
declare
  res text;
begin
  select pg_get_function_result('public.list_platform_clinics()'::regprocedure) into res;
  if res ~* 'join_code|email|auth_user|patient_id|full_name|chat_|adherence|document|photo' then
    raise exception 'WP-10B1 T14/T15/T16 FAIL: %', res;
  end if;
  if res not like '%clinic_id%' or res not like '%clinic_name%'
     or res not like '%created_at%' or res not like '%professional_count%'
     or res not like '%patient_count%' then
    raise exception 'WP-10B1 T14 FAIL: colunas mínimas ausentes %', res;
  end if;
  raise notice 'WP-10B1 T14 T15 T16 projection: PASS %', res;
end $$;
rollback;


-- Tabela mínima: sem granted_by; ACL fail-closed; RLS on; zero policies; bootstrap 0.
begin;
do $$
declare
  cols text[];
  n_pol int;
  n_rows int;
  acl text;
begin
  select array_agg(attname order by attnum) into cols
    from pg_attribute
   where attrelid = 'private.platform_admins'::regclass
     and attnum > 0 and not attisdropped;
  if cols is distinct from array['profile_id','status','granted_at','revoked_at']::text[] then
    raise exception 'WP-10B1 table FAIL: cols=%', cols;
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'private.platform_admins'::regclass and attname = 'granted_by'
  ) then
    raise exception 'WP-10B1 table FAIL: granted_by presente';
  end if;
  if has_table_privilege('authenticated', 'private.platform_admins', 'select')
     or has_table_privilege('authenticated', 'private.platform_admins', 'insert')
     or has_table_privilege('authenticated', 'private.platform_admins', 'update')
     or has_table_privilege('authenticated', 'private.platform_admins', 'delete')
     or has_table_privilege('anon', 'private.platform_admins', 'select')
     or has_table_privilege('anon', 'private.platform_admins', 'insert')
     or has_table_privilege('anon', 'private.platform_admins', 'update')
     or has_table_privilege('anon', 'private.platform_admins', 'delete') then
    raise exception 'WP-10B1 ACL FAIL: anon/authenticated têm table privilege';
  end if;
  select coalesce(relacl::text, '') into acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'platform_admins';
  if acl ~ 'authenticated' or acl ~ 'anon=' then
    raise exception 'WP-10B1 ACL FAIL: relacl=%', acl;
  end if;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='private' and c.relname='platform_admins') then
    raise exception 'WP-10B1 FAIL: RLS desligado';
  end if;
  select count(*) into n_pol from pg_policies
   where schemaname = 'private' and tablename = 'platform_admins';
  if n_pol <> 0 then raise exception 'WP-10B1 FAIL: policies=%', n_pol; end if;
  select count(*) into n_rows from private.platform_admins;
  if n_rows <> 0 then raise exception 'WP-10B1 L FAIL: bootstrap rows=%', n_rows; end if;
  if exists (
    select 1 from pg_policies
     where coalesce(qual,'') ilike '%is_platform_admin%'
        or coalesce(with_check,'') ilike '%is_platform_admin%'
  ) then
    raise exception 'WP-10B1 H1 FAIL: is_platform_admin em policy';
  end if;
  if pg_get_functiondef('private.is_clinic_admin(uuid)'::regprocedure) ilike '%platform_admin%'
     or pg_get_functiondef('private.is_clinic_member(uuid)'::regprocedure) ilike '%platform_admin%'
     or pg_get_functiondef('private.can_see_profile(uuid)'::regprocedure) ilike '%platform_admin%'
     or pg_get_functiondef('private.current_profile_id()'::regprocedure) ilike '%platform_admin%'
     or pg_get_functiondef('private.current_patient_id()'::regprocedure) ilike '%platform_admin%' then
    raise exception 'WP-10B1 H2 FAIL: helper clínico alterado';
  end if;
  raise notice 'WP-10B1 table/ACL/bootstrap/H1/H2: PASS acl=%', acl;
end $$;
rollback;


-- T2 T3 T4 T5 T8 T10 T11 T12: actores clínicos/comuns NÃO são platform admin e NÃO listam.
begin;
do $$
declare
  s record;
  v boolean;
  raised boolean;
begin
  select * into s from pg_temp.wp10b1_seed();

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_common, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := private.is_platform_admin();
  if v is not false then raise exception 'WP-10B1 T2 FAIL: common is_platform_admin=%', v; end if;
  v := public.am_i_platform_admin();
  if v is not false then raise exception 'WP-10B1 T8 FAIL: common am_i=%', v; end if;
  raised := false;
  begin
    perform * from public.list_platform_clinics();
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'WP-10B1 T10 FAIL: common listou'; end if;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T3 FAIL: clinic admin';
  end if;
  if public.am_i_clinic_admin(s.c_a) is not true then
    raise exception 'WP-10B1 K FAIL: clinic admin perdeu am_i_clinic_admin';
  end if;
  raised := false;
  begin
    perform * from public.list_platform_clinics();
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'WP-10B1 T11 FAIL: clinic admin listou'; end if;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T4 FAIL: owner';
  end if;
  raised := false;
  begin
    perform * from public.list_platform_clinics();
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'WP-10B1 T4 FAIL: owner listou'; end if;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_member, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T2 FAIL: member';
  end if;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T5 FAIL: patient';
  end if;
  if public.am_i_platform_admin() is not false then
    raise exception 'WP-10B1 T8 FAIL: patient am_i';
  end if;
  raised := false;
  begin
    perform * from public.list_platform_clinics();
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'WP-10B1 T12 FAIL: patient listou'; end if;
  reset role;

  raise notice 'WP-10B1 T2 T3 T4 T5 T8 T10 T11 T12: PASS';
end $$;
rollback;


-- T6 T7 T9 T13 T17 T18 T19 T20 + projeção runtime.
begin;
do $$
declare
  s record;
  n int;
  n_clinics int;
  r record;
  keys text;
  raised boolean;
  n_pat int; n_chat int; n_adh int; n_cli int; n_ppl int; n_sto int;
begin
  select * into s from pg_temp.wp10b1_seed();
  if s.n_prof_a <> 4 then raise exception 'WP-10B1 seed FAIL: prof_a=%', s.n_prof_a; end if;
  if s.n_pat_a  <> 2 then raise exception 'WP-10B1 seed FAIL: pat_a=%', s.n_pat_a; end if;
  if s.n_prof_b <> 1 then raise exception 'WP-10B1 seed FAIL: prof_b=%', s.n_prof_b; end if;
  if s.n_pat_b  <> 1 then raise exception 'WP-10B1 seed FAIL: pat_b=%', s.n_pat_b; end if;
  select count(*)::int into n_clinics from public.clinics;

  -- T7 revoked
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_rev, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T7 FAIL: revoked true';
  end if;
  if public.am_i_platform_admin() is not false then
    raise exception 'WP-10B1 T7 FAIL: revoked am_i';
  end if;
  raised := false;
  begin
    perform * from public.list_platform_clinics();
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'WP-10B1 T7 FAIL: revoked listou'; end if;
  reset role;

  -- T6 T9 active
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_plat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not true then
    raise exception 'WP-10B1 T6 FAIL: active false';
  end if;
  if public.am_i_platform_admin() is not true then
    raise exception 'WP-10B1 T9 FAIL: am_i false';
  end if;

  select count(*) into n from public.list_platform_clinics();
  if n <> n_clinics then
    raise exception 'WP-10B1 T13 FAIL: listed=% clinics=%', n, n_clinics;
  end if;

  select * into r from public.list_platform_clinics() where clinic_id = s.c_a;
  if r.clinic_name is distinct from 'Clinica Alfa 10B1' then
    raise exception 'WP-10B1 T13 FAIL: name=%', r.clinic_name;
  end if;
  if r.owner_profile_id is distinct from s.pf_owner then
    raise exception 'WP-10B1 T13 FAIL: owner';
  end if;
  if r.professional_count <> s.n_prof_a then
    raise exception 'WP-10B1 T17 FAIL: prof_a got=% want=%', r.professional_count, s.n_prof_a;
  end if;
  if r.patient_count <> s.n_pat_a then
    raise exception 'WP-10B1 T18 FAIL: pat_a got=% want=%', r.patient_count, s.n_pat_a;
  end if;

  select * into r from public.list_platform_clinics() where clinic_id = s.c_b;
  if r.professional_count <> s.n_prof_b or r.patient_count <> s.n_pat_b then
    raise exception 'WP-10B1 T17/T18 FAIL: clinic B';
  end if;

  select string_agg(k, ',' order by k) into keys
    from jsonb_object_keys(to_jsonb(r)) t(k);
  if keys ~* 'join_code|email|auth_user|patient_id|full_name' then
    raise exception 'WP-10B1 T14/T15/T16 FAIL: keys=%', keys;
  end if;

  -- T20: sem acesso clínico extra (sem membership)
  select count(*)::int into n_pat from public.patients;
  select count(*)::int into n_chat from public.chat_messages;
  select count(*)::int into n_adh from public.adherence_snapshots;
  select count(*)::int into n_cli from public.clinics;
  select count(*)::int into n_ppl from public.professional_patient_links;
  select count(*)::int into n_sto from storage.objects;
  if n_pat <> 0 then raise exception 'WP-10B1 T20 FAIL: patients=%', n_pat; end if;
  if n_chat <> 0 then raise exception 'WP-10B1 T20 FAIL: chat_messages=%', n_chat; end if;
  if n_adh <> 0 then raise exception 'WP-10B1 T20 FAIL: adherence=%', n_adh; end if;
  if n_cli <> 0 then raise exception 'WP-10B1 T20 FAIL: clinics table=%', n_cli; end if;
  if n_ppl <> 0 then raise exception 'WP-10B1 T20 FAIL: ppl=%', n_ppl; end if;
  if n_sto <> 0 then raise exception 'WP-10B1 T20 FAIL: storage.objects=%', n_sto; end if;
  reset role;

  if s.n_patients_all < 3 then raise exception 'WP-10B1 T20 FAIL: seed patients ausentes'; end if;
  if s.n_chat_all < 1 then raise exception 'WP-10B1 T20 FAIL: seed chat ausente'; end if;
  if s.n_adh_all < 1 then raise exception 'WP-10B1 T20 FAIL: seed adherence ausente'; end if;

  -- T19 revogação imediata (mesmo JWT)
  update private.platform_admins
     set status = 'revoked', revoked_at = now()
   where profile_id = s.pf_plat;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_plat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.is_platform_admin() is not false then
    raise exception 'WP-10B1 T19 FAIL: ainda active após revoke';
  end if;
  if public.am_i_platform_admin() is not false then
    raise exception 'WP-10B1 T19 FAIL: am_i após revoke';
  end if;
  raised := false;
  begin
    perform * from public.list_platform_clinics();
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'WP-10B1 T19 FAIL: list após revoke'; end if;
  reset role;

  raise notice 'WP-10B1 T6 T7 T9 T13 T17 T18 T19 T20: PASS keys=%', keys;
end $$;
rollback;


select 1 as ok;
select pg_is_in_recovery() as in_recovery;
