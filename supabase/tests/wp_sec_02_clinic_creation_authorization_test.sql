-- =====================================================================================
-- WP-SEC-02 · TESTES Nível 1 (BEGIN / DO pequeno / ROLLBACK).
-- HARNESS: exige 20260829090000 aplicada.
-- Login: request.jwt.claims (sub = auth_user_id) + set local role authenticated.
-- NÃO usa SET ROLE anon (isolador PG 17.6 — SIGSEGV). Anon = has_function_privilege.
-- =====================================================================================

create or replace function pg_temp.wpsec02_seed()
returns table (
  a_plat uuid, a_pend uuid, a_pat uuid, a_staff uuid, a_own uuid, a_tgt uuid, a_oth uuid,
  pf_plat uuid, pf_pend uuid, pf_pat uuid, pf_staff uuid, pf_own uuid, pf_tgt uuid, pf_oth uuid,
  c_exist uuid
)
language plpgsql
as $seed$
declare
  v_c uuid := gen_random_uuid();
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_pend uuid := gen_random_uuid(); v_a_pend uuid := gen_random_uuid();
  v_pf_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid();
  v_pf_staff uuid := gen_random_uuid(); v_a_staff uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_tgt uuid := gen_random_uuid(); v_a_tgt uuid := gen_random_uuid();
  v_pf_oth uuid := gen_random_uuid(); v_a_oth uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_plat,  v_a_plat,  'professional', 'PA SEC02',    'pa-sec02@t.test',    'active'),
    (v_pf_pend,  v_a_pend,  'patient',      'Pend SEC02',  'pend-sec02@t.test',  'pending'),
    (v_pf_pat,   v_a_pat,   'patient',      'Pat SEC02',   'pat-sec02@t.test',   'active'),
    (v_pf_staff, v_a_staff, 'professional', 'Staff SEC02', 'staff-sec02@t.test', 'active'),
    (v_pf_own,   v_a_own,   'professional', 'Own SEC02',   'own-sec02@t.test',   'active'),
    (v_pf_tgt,   v_a_tgt,   'patient',      'Tgt SEC02',   'tgt-sec02@t.test',   'pending'),
    (v_pf_oth,   v_a_oth,   'patient',      'Oth SEC02',   'oth-sec02@t.test',   'pending');

  insert into public.clinics (id, name, owner_profile_id)
    values (v_c, 'Clinica Existente SEC02', v_pf_own);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_pf_own,   v_c, 'other',        'admin',  'active'),
    (v_pf_staff, v_c, 'nutritionist', 'member', 'active');

  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pf_plat, 'active', now(), null);

  -- PLATFORM-01 default remoto é closed. SEC-02 prova o grant/consumo em manual_review.
  insert into private.clinic_onboarding_policy (id, mode, updated_at, updated_by_profile_id)
  values (true, 'manual_review', clock_timestamp(), v_pf_plat)
  on conflict (id) do update
    set mode = excluded.mode,
        updated_at = excluded.updated_at,
        updated_by_profile_id = excluded.updated_by_profile_id;

  return query select
    v_a_plat, v_a_pend, v_a_pat, v_a_staff, v_a_own, v_a_tgt, v_a_oth,
    v_pf_plat, v_pf_pend, v_pf_pat, v_pf_staff, v_pf_own, v_pf_tgt, v_pf_oth,
    v_c;
end;
$seed$;


-- T1: anon sem EXECUTE. authenticated TEM execute (autoridade no body).
begin;
do $$
begin
  if has_function_privilege('anon', 'public.create_clinic_with_owner(text)', 'execute') then
    raise exception 'SEC02 T1 FAIL: anon execute create';
  end if;
  if has_function_privilege('anon', 'public.authorize_clinic_creation(uuid)', 'execute') then
    raise exception 'SEC02 T1 FAIL: anon execute authorize';
  end if;
  if not has_function_privilege('authenticated', 'public.create_clinic_with_owner(text)', 'execute') then
    raise exception 'SEC02 T1 FAIL: authenticated sem execute create';
  end if;
  if not has_function_privilege('authenticated', 'public.authorize_clinic_creation(uuid)', 'execute') then
    raise exception 'SEC02 T1 FAIL: authenticated sem execute authorize';
  end if;
  if has_table_privilege('authenticated', 'private.clinic_creation_authorizations', 'select')
     or has_table_privilege('authenticated', 'private.clinic_creation_authorizations', 'insert')
     or has_table_privilege('authenticated', 'private.clinic_creation_authorizations', 'update')
     or has_table_privilege('authenticated', 'private.clinic_creation_authorizations', 'delete')
     or has_table_privilege('anon', 'private.clinic_creation_authorizations', 'select') then
    raise exception 'SEC02 T1 FAIL: table privilege leaked';
  end if;
end $$;
rollback;


-- T2: authenticated + profile SEM grant → ONBOARDING_NOT_ALLOWED
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Sem Grant');
    raise exception 'SEC02 T2 FAIL: create sem grant permitida';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T2 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T3 patient active sem grant
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_pat::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Patient');
    raise exception 'SEC02 T3 FAIL';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T3 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T4 pending sem grant
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_pend::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Pending');
    raise exception 'SEC02 T4 FAIL';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T4 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T5 professional não-owner sem grant
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_staff::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Staff');
    raise exception 'SEC02 T5 FAIL';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T5 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T6 PA sem grant NÃO cria (PA ≠ authorization)
begin;
do $$
declare
  s record;
  v_hint text;
  n_own int;
  n_pr int;
begin
  select * into s from pg_temp.wpsec02_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica PA Direta');
    raise exception 'SEC02 T6 FAIL: PA criou sem grant';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T6 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
  select count(*) into n_own from public.clinics where owner_profile_id = s.pf_plat;
  select count(*) into n_pr from public.professionals where profile_id = s.pf_plat;
  if n_own <> 0 or n_pr <> 0 then
    raise exception 'SEC02 T6 FAIL: PA ganhou clinic authority';
  end if;
end $$;
rollback;


-- T7 non-PA não concede
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_staff::text)::text, true);
    set local role authenticated;
    perform public.authorize_clinic_creation(s.pf_tgt);
    raise exception 'SEC02 T7 FAIL: non-PA concedeu';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'NOT_PLATFORM_ADMIN' then
        raise exception 'SEC02 T7 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T8 PA concede para target válido; T9 target cria; T10 consumed; T11 reuse; T12 owner
begin;
do $$
declare
  s record;
  g jsonb;
  r jsonb;
  v_hint text;
  v_owner uuid;
  v_cons timestamptz;
  v_cid uuid;
  n int;
  n_pr_pa int;
  n_own_pa int;
  n_pat_pa int;
begin
  select * into s from pg_temp.wpsec02_seed();

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  g := public.authorize_clinic_creation(s.pf_tgt);
  reset role;
  if g->>'authorization_id' is null then raise exception 'SEC02 T8 FAIL: no id'; end if;
  if (g->>'target_profile_id')::uuid is distinct from s.pf_tgt then
    raise exception 'SEC02 T8 FAIL: target';
  end if;
  if g->>'source' is distinct from 'platform_admin' then
    raise exception 'SEC02 T8 FAIL: source';
  end if;

  -- Grantor auditável: source=platform_admin → granted_by = profile do PA caller.
  -- authorize_clinic_creation NÃO aceita grantor do cliente (só p_target_profile_id).
  if pg_get_function_identity_arguments('public.authorize_clinic_creation(uuid)'::regprocedure)
     is distinct from 'p_target_profile_id uuid' then
    raise exception 'SEC02 T8 FAIL: authorize accepts extra args';
  end if;
  declare
    v_gby uuid;
    v_gsrc text;
  begin
    select granted_by_profile_id, source
      into v_gby, v_gsrc
      from private.clinic_creation_authorizations
     where id = (g->>'authorization_id')::uuid;
    if v_gby is distinct from s.pf_plat then
      raise exception 'SEC02 T8 FAIL: grantor not PA caller';
    end if;
    if v_gsrc is distinct from 'platform_admin' then
      raise exception 'SEC02 T8 FAIL: stored source';
    end if;
  end;

  -- Grant NÃO muda autoridade do PA
  select count(*) into n_pr_pa from public.professionals where profile_id = s.pf_plat;
  select count(*) into n_own_pa from public.clinics where owner_profile_id = s.pf_plat;
  select count(*) into n_pat_pa from public.patients where profile_id = s.pf_plat;
  if n_pr_pa <> 0 or n_own_pa <> 0 or n_pat_pa <> 0 then
    raise exception 'SEC02 T8 FAIL: PA mutated';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
  set local role authenticated;
  r := public.create_clinic_with_owner('Clinica Autorizada');
  reset role;
  if r->>'clinic_id' is null or r->>'professional_id' is null then
    raise exception 'SEC02 T9 FAIL: return';
  end if;

  select owner_profile_id into v_owner from public.clinics where id = (r->>'clinic_id')::uuid;
  if v_owner is distinct from s.pf_tgt then
    raise exception 'SEC02 T12 FAIL: owner forged/wrong';
  end if;

  select consumed_at, consumed_clinic_id
    into v_cons, v_cid
    from private.clinic_creation_authorizations
   where id = (g->>'authorization_id')::uuid;
  if v_cons is null then raise exception 'SEC02 T10 FAIL: consumed_at null'; end if;
  if v_cid is null then raise exception 'SEC02 T10 FAIL: consumed_clinic_id null'; end if;
  if v_cid is distinct from (r->>'clinic_id')::uuid then
    raise exception 'SEC02 T10 FAIL: consumed_clinic_id <> returned clinic_id';
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Segunda Clinica');
    raise exception 'SEC02 T11 FAIL: reuse';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint not in ('ALREADY_OWNS_CLINIC', 'ONBOARDING_NOT_ALLOWED') then
        raise exception 'SEC02 T11 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  select count(*) into n from public.clinics where owner_profile_id = s.pf_tgt;
  if n <> 1 then raise exception 'SEC02 T11 FAIL: clinic count=%', n; end if;
end $$;
rollback;


-- T13 nome inválido NÃO consome
begin;
do $$
declare
  s record;
  g jsonb;
  v_hint text;
  v_cons timestamptz;
begin
  select * into s from pg_temp.wpsec02_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  g := public.authorize_clinic_creation(s.pf_tgt);
  reset role;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('x');
    raise exception 'SEC02 T13 FAIL: short name allowed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'NAME_TOO_SHORT' then
        raise exception 'SEC02 T13 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  declare
    v_cid uuid;
  begin
    select consumed_at, consumed_clinic_id
      into v_cons, v_cid
      from private.clinic_creation_authorizations
     where id = (g->>'authorization_id')::uuid;
    if v_cons is not null then
      raise exception 'SEC02 T13 FAIL: grant consumed on bad name';
    end if;
    if v_cid is not null then
      raise exception 'SEC02 T13 FAIL: consumed_clinic_id set on bad name';
    end if;
  end;
end $$;
rollback;


-- T14 claim + falha posterior → rollback do consumo
begin;
do $$
declare
  s record;
  g jsonb;
  v_cons timestamptz;
  n int;
begin
  select * into s from pg_temp.wpsec02_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  g := public.authorize_clinic_creation(s.pf_tgt);
  reset role;

  create function pg_temp.wpsec02_boom()
  returns trigger language plpgsql as $t$
  begin
    raise exception 'forced_professional_fail';
  end;
  $t$;
  create trigger wpsec02_boom
    before insert on public.professionals
    for each row execute function pg_temp.wpsec02_boom();

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica TX');
    reset role;
    raise exception 'SEC02 T14 FAIL: create succeeded';
  exception
    when others then
      reset role;
      if sqlerrm not like '%forced_professional_fail%' and sqlerrm not like '%SEC02 T14 FAIL%' then
        null;
      elsif sqlerrm like '%SEC02 T14 FAIL%' then
        raise;
      end if;
  end;

  drop trigger wpsec02_boom on public.professionals;

  declare
    v_cid uuid;
  begin
    select consumed_at, consumed_clinic_id
      into v_cons, v_cid
      from private.clinic_creation_authorizations
     where id = (g->>'authorization_id')::uuid;
    select count(*) into n from public.clinics where owner_profile_id = s.pf_tgt;
    if v_cons is not null then raise exception 'SEC02 T14 FAIL: consumed_at persisted'; end if;
    if v_cid is not null then raise exception 'SEC02 T14 FAIL: consumed_clinic_id persisted'; end if;
    if n <> 0 then raise exception 'SEC02 T14 FAIL: clinic persisted'; end if;
  end;
end $$;
rollback;


-- T15 expirada
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  insert into private.clinic_creation_authorizations (
    target_profile_id, granted_by_profile_id, source, granted_at, expires_at
  ) values (
    s.pf_tgt, s.pf_plat, 'platform_admin',
    now() - interval '8 days', now() - interval '1 day'
  );
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Expirada');
    raise exception 'SEC02 T15 FAIL';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T15 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T16 grant de outro profile
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.authorize_clinic_creation(s.pf_tgt);
  reset role;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_oth::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Alheia');
    raise exception 'SEC02 T16 FAIL';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'SEC02 T16 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- T17: segunda criação SEQUENCIAL após sucesso falha; body tem advisory lock + claim atômico.
-- Corrida REAL (2 conexões) = supabase/tests/wp_sec_02_concurrency.mjs.
begin;
do $$
declare
  s record;
  def text;
  n int;
  v_hint text;
begin
  select * into s from pg_temp.wpsec02_seed();
  select pg_get_functiondef('public.create_clinic_with_owner(text)'::regprocedure) into def;
  if def not like '%pg_advisory_xact_lock%' then
    raise exception 'SEC02 T17 FAIL: missing advisory lock';
  end if;
  if def not like '%consumed_at is null%' and def not like '%consumed_at IS NULL%' then
    raise exception 'SEC02 T17 FAIL: missing atomic claim';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.authorize_clinic_creation(s.pf_tgt);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
  set local role authenticated;
  perform public.create_clinic_with_owner('Clinica Una');
  reset role;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_tgt::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Duas');
    raise exception 'SEC02 T17 FAIL: second create';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint not in ('ALREADY_OWNS_CLINIC', 'ONBOARDING_NOT_ALLOWED') then
        raise exception 'SEC02 T17 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
  select count(*) into n from public.clinics where owner_profile_id = s.pf_tgt;
  if n <> 1 then raise exception 'SEC02 T17 FAIL: n=%', n; end if;
end $$;
rollback;


-- T18 existing owner intacto; grant a owner recusado
begin;
do $$
declare
  s record;
  v_hint text;
  n_c int;
  n_pr int;
begin
  select * into s from pg_temp.wpsec02_seed();
  select count(*) into n_c from public.clinics where id = s.c_exist and owner_profile_id = s.pf_own;
  select count(*) into n_pr from public.professionals where profile_id = s.pf_own;
  if n_c <> 1 or n_pr < 1 then raise exception 'SEC02 T18 FAIL: seed owner'; end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
    set local role authenticated;
    perform public.authorize_clinic_creation(s.pf_own);
    raise exception 'SEC02 T18 FAIL: granted to owner';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'TARGET_ALREADY_OWNS_CLINIC' then
        raise exception 'SEC02 T18 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  select count(*) into n_c from public.clinics where id = s.c_exist;
  if n_c <> 1 then raise exception 'SEC02 T18 FAIL: clinic lost'; end if;
end $$;
rollback;


-- T19: source=platform_admin exige granted_by NOT NULL (CHECK). asaas pode ser NULL.
begin;
do $$
declare
  s record;
  v_sqlstate text;
begin
  select * into s from pg_temp.wpsec02_seed();

  begin
    insert into private.clinic_creation_authorizations (
      target_profile_id, granted_by_profile_id, source, granted_at, expires_at
    ) values (
      s.pf_tgt, null, 'platform_admin', now(), now() + interval '7 days'
    );
    raise exception 'SEC02 T19 FAIL: null PA grantor accepted';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if sqlerrm like '%SEC02 T19 FAIL%' then
        raise;
      end if;
      if v_sqlstate is distinct from '23514' then
        raise exception 'SEC02 T19 FAIL: expected check_violation, got % %',
          v_sqlstate, sqlerrm;
      end if;
  end;

  insert into private.clinic_creation_authorizations (
    target_profile_id, granted_by_profile_id, source, granted_at, expires_at
  ) values (
    s.pf_oth, null, 'asaas', now(), now() + interval '7 days'
  );
end $$;
rollback;


-- T20: TARGET STATUS COMPATÍVEL pending → grant permitido
begin;
do $$
declare
  s record;
  g jsonb;
  v_gby uuid;
begin
  select * into s from pg_temp.wpsec02_seed();
  if (select status from public.profiles where id = s.pf_pend) is distinct from 'pending' then
    raise exception 'SEC02 T20 FAIL: seed pending';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  g := public.authorize_clinic_creation(s.pf_pend);
  reset role;
  if g->>'authorization_id' is null then raise exception 'SEC02 T20 FAIL: no grant'; end if;
  select granted_by_profile_id into v_gby
    from private.clinic_creation_authorizations
   where id = (g->>'authorization_id')::uuid;
  if v_gby is distinct from s.pf_plat then
    raise exception 'SEC02 T20 FAIL: grantor';
  end if;
end $$;
rollback;


-- T21: TARGET STATUS COMPATÍVEL active → grant permitido
begin;
do $$
declare
  s record;
  g jsonb;
begin
  select * into s from pg_temp.wpsec02_seed();
  if (select status from public.profiles where id = s.pf_pat) is distinct from 'active' then
    raise exception 'SEC02 T21 FAIL: seed active';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  g := public.authorize_clinic_creation(s.pf_pat);
  reset role;
  if g->>'authorization_id' is null then raise exception 'SEC02 T21 FAIL: no grant'; end if;
end $$;
rollback;


-- T22: TARGET STATUS INCOMPATÍVEL → grant recusado (fail-closed; sem enum inventado)
begin;
do $$
declare
  s record;
  v_hint text;
  v_pf uuid;
  v_au uuid;
  v_st text;
begin
  select * into s from pg_temp.wpsec02_seed();

  foreach v_st in array array['revoked', 'inactive', 'disabled', '']
  loop
    v_pf := gen_random_uuid();
    v_au := gen_random_uuid();
    insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, v_au, 'professional', 'Bad status SEC02', 'bad-' || v_st || '@t.test', v_st);

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
      set local role authenticated;
      perform public.authorize_clinic_creation(v_pf);
      reset role;
      raise exception 'SEC02 T22 FAIL: granted status=%', v_st;
    exception
      when others then
        get stacked diagnostics v_hint = pg_exception_hint;
        reset role;
        if sqlerrm like '%SEC02 T22 FAIL%' then
          raise;
        end if;
        if v_hint is distinct from 'TARGET_STATUS_INCOMPATIBLE' then
          raise exception 'SEC02 T22 FAIL: status=% hint=%', v_st, coalesce(v_hint, 'null');
        end if;
    end;

    if exists (
      select 1 from private.clinic_creation_authorizations where target_profile_id = v_pf
    ) then
      raise exception 'SEC02 T22 FAIL: row persisted status=%', v_st;
    end if;
  end loop;
end $$;
rollback;


-- T23: TOCTOU no consumo — grant emitido com active; status vira incompatível;
-- create negado; grant NÃO é queimado; restore active + mesmo grant → cria 1 clínica.
begin;
do $$
declare
  s record;
  g jsonb;
  r jsonb;
  v_hint text;
  v_open int;
  v_cons timestamptz;
  v_cid uuid;
  n int;
begin
  select * into s from pg_temp.wpsec02_seed();
  if (select status from public.profiles where id = s.pf_pat) is distinct from 'active' then
    raise exception 'SEC02 T23 FAIL: seed not active';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  g := public.authorize_clinic_creation(s.pf_pat);
  reset role;
  if g->>'authorization_id' is null then raise exception 'SEC02 T23 FAIL: no grant'; end if;

  select count(*) into v_open
    from private.clinic_creation_authorizations
   where id = (g->>'authorization_id')::uuid
     and consumed_at is null;
  if v_open <> 1 then raise exception 'SEC02 T23 FAIL: grant not open'; end if;

  update public.profiles set status = 'revoked' where id = s.pf_pat;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_pat::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica TOCTOU');
    reset role;
    raise exception 'SEC02 T23 FAIL: create allowed after incompatible status';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if sqlerrm like '%SEC02 T23 FAIL%' then
        raise;
      end if;
      if v_hint is distinct from 'TARGET_STATUS_INCOMPATIBLE' then
        raise exception 'SEC02 T23 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  select count(*) into n from public.clinics where owner_profile_id = s.pf_pat;
  select consumed_at, consumed_clinic_id
    into v_cons, v_cid
    from private.clinic_creation_authorizations
   where id = (g->>'authorization_id')::uuid;
  select count(*) into v_open
    from private.clinic_creation_authorizations
   where id = (g->>'authorization_id')::uuid
     and consumed_at is null;
  if n <> 0 then raise exception 'SEC02 T23 FAIL: clinic created'; end if;
  if v_cons is not null then raise exception 'SEC02 T23 FAIL: consumed_at set'; end if;
  if v_cid is not null then raise exception 'SEC02 T23 FAIL: consumed_clinic_id set'; end if;
  if v_open <> 1 then raise exception 'SEC02 T23 FAIL: open grant lost'; end if;

  update public.profiles set status = 'active' where id = s.pf_pat;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_pat::text)::text, true);
  set local role authenticated;
  r := public.create_clinic_with_owner('Clinica TOCTOU Restore');
  reset role;
  if r->>'clinic_id' is null then raise exception 'SEC02 T23 FAIL: restore create'; end if;

  select count(*) into n from public.clinics where owner_profile_id = s.pf_pat;
  select consumed_at, consumed_clinic_id
    into v_cons, v_cid
    from private.clinic_creation_authorizations
   where id = (g->>'authorization_id')::uuid;
  if n <> 1 then raise exception 'SEC02 T23 FAIL: restore clinic count=%', n; end if;
  if v_cons is null then raise exception 'SEC02 T23 FAIL: restore not consumed'; end if;
  if v_cid is distinct from (r->>'clinic_id')::uuid then
    raise exception 'SEC02 T23 FAIL: restore consumed_clinic_id';
  end if;
end $$;
rollback;

do $$ begin raise notice 'WP-SEC-02: ALL ASSERTIONS PASSED'; end $$;
