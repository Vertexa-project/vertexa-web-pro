-- =====================================================================================
-- WP-09B0 · TESTES (Nível 1: BEGIN / DO pequeno / ROLLBACK).
-- Exige a migration 20260817080000 aplicada. Sem DO monolítico (PG17).
-- =====================================================================================

create or replace function pg_temp.wp09b0_seed()
returns table (
  a_pat uuid, a_adm uuid, a_empty uuid,
  pf_pat uuid, pf_adm uuid, pf_empty uuid,
  pat uuid, c1 uuid, c2 uuid
)
language plpgsql
as $seed$
declare
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid(); v_aown uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid(); v_aadm uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid(); v_apat uuid := gen_random_uuid();
  v_emp uuid := gen_random_uuid(); v_aemp uuid := gen_random_uuid();
  v_beta uuid := gen_random_uuid(); v_abeta uuid := gen_random_uuid();
  v_patient uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_own,  v_aown,  'professional', 'Dona 09B0',   'own-09b0@t.test',   'active'),
    (v_adm,  v_aadm,  'professional', 'Admin 09B0',  'adm-09b0@t.test',   'active'),
    (v_pat,  v_apat,  'patient',      'Pac 09B0',    'pat-09b0@t.test',   'active'),
    (v_emp,  v_aemp,  'patient',      'Empty 09B0',  'empty-09b0@t.test', 'active'),
    (v_beta, v_abeta, 'professional', 'Beta 09B0',   'beta-09b0@t.test',  'active');
  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1, 'Clinica Alfa 09B0', v_own),
    (v_c2, 'Clinica Beta 09B0', v_beta);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_own, v_c1, 'other', 'admin', 'active'),
    (v_adm, v_c1, 'doctor', 'admin', 'active'),
    (v_beta, v_c2, 'doctor', 'admin', 'active');
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pat, v_c1, 'meta') returning id into v_patient;
  return query select v_apat, v_aadm, v_aemp, v_pat, v_adm, v_emp, v_patient, v_c1, v_c2;
end;
$seed$;


-- T1 sem duplicata de profile_id não-nulo. T2 UNIQUE existe.
begin;
do $$
declare
  n_dup int; n_u int; def text;
begin
  select count(*) into n_dup from (
    select profile_id from public.patients
     where profile_id is not null
     group by profile_id having count(*) > 1
  ) s;
  if n_dup <> 0 then raise exception 'WP-09B0 T1 FAIL: dups=%', n_dup; end if;
  select count(*), min(pg_get_constraintdef(oid))
    into n_u, def
    from pg_constraint
   where conrelid = 'public.patients'::regclass and contype = 'u';
  if n_u <> 1 then raise exception 'WP-09B0 T2 FAIL: unique count=%', n_u; end if;
  if def is distinct from 'UNIQUE (profile_id)' then
    raise exception 'WP-09B0 T2 FAIL: def=%', def;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.patients'::regclass
       and conname = 'patients_profile_id_key'
  ) then
    raise exception 'WP-09B0 T2 FAIL: nome';
  end if;
  raise notice 'WP-09B0 T1 T2: PASS';
end $$;
rollback;


-- T3 mesmo profile + mesma clínica bloqueado.
begin;
do $$
declare
  s record; blocked boolean := false;
begin
  select * into s from pg_temp.wp09b0_seed();
  begin
    insert into public.patients (profile_id, clinic_id, goal)
      values (s.pf_pat, s.c1, 'dup');
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'WP-09B0 T3 FAIL'; end if;
  raise notice 'WP-09B0 T3: PASS';
end $$;
rollback;


-- T4 mesmo profile + outra clínica bloqueado (decisão de produto).
begin;
do $$
declare
  s record; blocked boolean := false;
begin
  select * into s from pg_temp.wp09b0_seed();
  begin
    insert into public.patients (profile_id, clinic_id, goal)
      values (s.pf_pat, s.c2, 'clinic-b');
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'WP-09B0 T4 FAIL'; end if;
  raise notice 'WP-09B0 T4: PASS';
end $$;
rollback;


-- T5 múltiplos profile_id NULL permitidos. Sem NOT NULL.
begin;
do $$
declare
  n int; nullable text;
begin
  insert into public.patients (profile_id) values (null), (null);
  select count(*) into n from public.patients where profile_id is null;
  if n < 2 then raise exception 'WP-09B0 T5 FAIL: nulls=%', n; end if;
  select is_nullable into nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'patients' and column_name = 'profile_id';
  if nullable is distinct from 'YES' then
    raise exception 'WP-09B0 T5 FAIL: nullable=%', nullable;
  end if;
  raise notice 'WP-09B0 T5: PASS';
end $$;
rollback;


-- T6 sem auth → NULL. T9 sem LIMIT 1. T10 STABLE. T11 DEFINER. T12 search_path vazio.
begin;
do $$
declare
  v uuid; def text; vol "char"; sec boolean; cfg text;
begin
  perform set_config('request.jwt.claims', '', true);
  v := private.current_patient_id();
  if v is not null then raise exception 'WP-09B0 T6 FAIL: %', v; end if;
  select pg_get_functiondef(p.oid), p.provolatile, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
    into def, vol, sec, cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'current_patient_id';
  if def ~* 'limit[[:space:]]+1' then raise exception 'WP-09B0 T9 FAIL'; end if;
  if vol is distinct from 's' then raise exception 'WP-09B0 T10 FAIL: %', vol; end if;
  if not sec then raise exception 'WP-09B0 T11 FAIL'; end if;
  if cfg !~ 'search_path=' then raise exception 'WP-09B0 T12 FAIL: %', cfg; end if;
  if cfg ~* 'search_path=public' then raise exception 'WP-09B0 T12 FAIL public: %', cfg; end if;
  raise notice 'WP-09B0 T6 T9 T10 T11 T12: PASS';
end $$;
rollback;


-- T7 profile sem patient → NULL. T8 profile com 1 patient → ID. T13 consumer.
begin;
do $$
declare
  s record; v uuid;
begin
  select * into s from pg_temp.wp09b0_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_empty, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := private.current_patient_id();
  reset role;
  if v is not null then raise exception 'WP-09B0 T7 FAIL: %', v; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := private.current_patient_id();
  if v is distinct from s.pat then raise exception 'WP-09B0 T8 FAIL: % vs %', v, s.pat; end if;
  if not private.is_self_patient(v) then raise exception 'WP-09B0 T13 FAIL is_self'; end if;
  if not private.can_access_patient(v) then raise exception 'WP-09B0 T13 FAIL access'; end if;
  reset role;
  raise notice 'WP-09B0 T7 T8 T13: PASS';
end $$;
rollback;


-- T15 table/column ACL de patients: profile_id sem grants de coluna (não alargamos).
begin;
do $$
declare
  col_acl text;
begin
  select coalesce((select string_agg(a::text, ',' order by a::text)
                     from unnest(at.attacl) a), '')
    into col_acl
    from pg_attribute at
   where at.attrelid = 'public.patients'::regclass
     and at.attname = 'profile_id';
  if col_acl is distinct from '' then
    raise exception 'WP-09B0 T15 FAIL col acl=%', col_acl;
  end if;
  raise notice 'WP-09B0 T15: PASS';
end $$;
rollback;
begin;
do $$
declare
  n int; h text;
begin
  select count(*),
         md5(string_agg(
           schemaname||'.'||tablename||'.'||policyname||'|'||cmd||'|'||coalesce(array_to_string(roles,','),'')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''),
           E'\n' order by schemaname, tablename, policyname, cmd))
    into n, h
    from pg_policies where schemaname = 'public';
  if n <> 113 then raise exception 'WP-09B0 T14 FAIL n=%', n; end if;
  if h is distinct from 'bec1ea2443ea4b225e4823a258e32de8' then
    raise exception 'WP-09B0 T14 FAIL h=%', h;
  end if;
  raise notice 'WP-09B0 T14: PASS';
end $$;
rollback;


-- T16 zero chat: helper def sem objetos de chat.
-- T17 cron intacto. T18 VRI functions presentes e job intacto.
begin;
do $$
declare
  def text; n_cron int; n_vri int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'current_patient_id';
  if def ~* 'chat_channels|chat_participants|chat_messages|get_or_create_channel' then
    raise exception 'WP-09B0 T16 FAIL';
  end if;
  select count(*) into n_cron from cron.job
   where jobname in ('wp-rls2-recovery-decay', 'wp-vri-recompute-daily');
  if n_cron <> 2 then raise exception 'WP-09B0 T17 FAIL n=%', n_cron; end if;
  if to_regprocedure('private.recompute_adherence_for(uuid)') is null
     or to_regprocedure('private.recompute_adherence_all()') is null then
    raise exception 'WP-09B0 T18 FAIL motor ausente';
  end if;
  select count(*) into n_vri from cron.job
   where jobname = 'wp-vri-recompute-daily'
     and command = 'select private.recompute_adherence_all();';
  if n_vri <> 1 then raise exception 'WP-09B0 T18 FAIL job'; end if;
  raise notice 'WP-09B0 T16 T17 T18: PASS';
end $$;
rollback;

select 1 as ok;
select pg_is_in_recovery() as in_recovery;
