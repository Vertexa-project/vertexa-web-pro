-- =====================================================================================
-- WP-PATIENT-IDENTITY-POLISH-01 · contrato de resolução após reconciliação de identidade
-- (BEGIN / DO / ROLLBACK). Identidades SINTÉTICAS — nenhum dado real de paciente.
--
-- Cenário (classe de incidente "Gmail com ponto"):
--   cadastro clínico  : synthetic.user.pir01@gmail.com (sem Auth, com patient)
--   Google autentica  : syntheticuserpir01@gmail.com   (mesma caixa Gmail, sem ponto)
-- Prova que:
--   R1 a semântica global de claim continua EXATA: o login cria um profile pending separado,
--      sem auto-link (nenhuma normalização de Gmail no login);
--   R2 após a reconciliação explícita (remover o pending vazio + ligar o MESMO Auth ao profile
--      clínico), auth.uid -> profile canônico -> patient -> clínica resolve, inclusive via RLS,
--      e NÃO depende de profile.email = auth.users.email;
--   R3 novos logins não recriam pending: ensure_auth_profile / ensure_my_profile / o trigger
--      handle_new_user (UPDATE de email_confirmed_at) são no-op para um Auth já ligado;
--   R4 a exclusão definitiva continua NEGADA para o cadastro reconciliado (Auth vinculado).
-- =====================================================================================

create or replace function pg_temp.pir_seed()
returns table (c_id uuid, pf_canon uuid, pat uuid, a_goo uuid, pf_adm uuid, a_adm uuid)
language plpgsql
as $seed$
declare
  v_c uuid := gen_random_uuid(); v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_canon uuid := gen_random_uuid(); v_pat uuid; v_a_goo uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own, v_a_own, 'professional', 'Owner PIR01', 'own-pir01@t.test', 'active'),
    (v_pf_canon, null, 'patient', 'Paciente Sintetico PIR01', 'synthetic.user.pir01@gmail.com', 'active');
  insert into public.clinics (id, name, owner_profile_id) values (v_c, 'Clinica PIR01', v_pf_own);
  insert into public.patients (profile_id, clinic_id, goal) values (v_pf_canon, v_c, 'g') returning id into v_pat;

  -- 1º login Google: endereço SEM ponto, confirmado (trigger roda no INSERT)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_a_goo, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'syntheticuserpir01@gmail.com', 'x', clock_timestamp(),
          '{"provider":"google","providers":["google"]}'::jsonb, '{"full_name":"Paciente Sintetico"}'::jsonb,
          clock_timestamp(), clock_timestamp());

  return query select v_c, v_pf_canon, v_pat, v_a_goo, v_pf_own, v_a_own;
end;
$seed$;


begin;
do $$
declare
  s record; v_pending uuid; v_n int; v_auth_md5 text;
  v_cur_profile uuid; v_cur_patient uuid; v_self boolean; v_seen_profile uuid; v_seen_patient uuid;
  v_hint text;
begin
  select * into s from pg_temp.pir_seed();

  -- R1: claim exato — nenhum auto-link, nasce o pending separado
  if (select auth_user_id from public.profiles where id = s.pf_canon) is not null then
    raise exception 'PIR01 R1 FAIL: canonical auto-linked (global Gmail normalization?)';
  end if;
  select id into v_pending from public.profiles where auth_user_id = s.a_goo and status = 'pending';
  if v_pending is null then raise exception 'PIR01 R1 FAIL: pending profile not created'; end if;
  if (select count(*) from public.patients where profile_id = v_pending) <> 0 then raise exception 'PIR01 R1 FAIL: pending has patient'; end if;
  raise notice 'PIR01 R1 PASSED';

  -- reconciliação explícita (mesma forma do reparo operacional): sem tocar auth.*
  select md5(u::text) into v_auth_md5 from auth.users u where id = s.a_goo;
  delete from public.profiles where id = v_pending and status = 'pending' and auth_user_id = s.a_goo;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'PIR01 setup: pending delete = %', v_n; end if;
  update public.profiles set auth_user_id = s.a_goo where id = s.pf_canon and auth_user_id is null;
  if (select md5(u::text) from auth.users u where id = s.a_goo) <> v_auth_md5 then raise exception 'PIR01 FAIL: auth changed'; end if;

  -- R2: resolução por auth.uid (helpers + RLS), com e-mails DIFERENTES entre profile e Auth
  if (select email from public.profiles where id = s.pf_canon) = (select email from auth.users where id = s.a_goo) then
    raise exception 'PIR01 R2 setup: emails should differ';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_goo::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_cur_profile := private.current_profile_id();
  v_cur_patient := private.current_patient_id();
  v_self := private.is_self_patient(s.pat);
  select p.id into v_seen_profile from public.profiles p where p.auth_user_id = s.a_goo;
  select pt.id into v_seen_patient from public.patients pt where pt.profile_id = v_seen_profile;
  reset role;
  if v_cur_profile is distinct from s.pf_canon or v_cur_patient is distinct from s.pat or not v_self
     or v_seen_profile is distinct from s.pf_canon or v_seen_patient is distinct from s.pat then
    raise exception 'PIR01 R2 FAIL: profile=% patient=% self=% seen=%/%', v_cur_profile, v_cur_patient, v_self, v_seen_profile, v_seen_patient;
  end if;
  raise notice 'PIR01 R2 PASSED';

  -- R3: novos logins não recriam pending
  perform private.ensure_auth_profile(s.a_goo);
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_goo::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.ensure_my_profile();
  reset role;
  update auth.users set email_confirmed_at = clock_timestamp() where id = s.a_goo;  -- dispara handle_new_user
  if (select count(*) from public.profiles where auth_user_id = s.a_goo) <> 1
     or (select count(*) from public.profiles where lower(email) in ('syntheticuserpir01@gmail.com', 'synthetic.user.pir01@gmail.com')) <> 1
     or (select id from public.profiles where auth_user_id = s.a_goo) <> s.pf_canon then
    raise exception 'PIR01 R3 FAIL: duplicate profile after re-login';
  end if;
  raise notice 'PIR01 R3 PASSED';

  -- R4: exclusão definitiva continua negada (Auth vinculado)
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_unused_patient_registration(s.pat);
    v_hint := 'RAN';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  reset role;
  if v_hint is distinct from 'PATIENT_DELETE_AUTH_LINKED' then raise exception 'PIR01 R4 FAIL: %', v_hint; end if;
  if not exists (select 1 from public.patients where id = s.pat) then raise exception 'PIR01 R4 FAIL: patient gone'; end if;
  raise notice 'PIR01 R4 PASSED';
end $$;
rollback;


-- R0: semântica global de identidade continua sem Gmail (corpo das funções de login)
begin;
do $$
declare v_fn text; v_src text;
begin
  foreach v_fn in array array['public.handle_new_user', 'private.ensure_auth_profile', 'public.ensure_my_profile',
                              'private.current_profile_id', 'private.current_patient_id'] loop
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = split_part(v_fn, '.', 1)::regnamespace and p.proname = split_part(v_fn, '.', 2);
    if v_src ~* 'gmail|destructive_identity_risk_key|replace\s*\(' then
      raise exception 'PIR01 R0 FAIL: Gmail normalization leaked into %', v_fn;
    end if;
  end loop;
  raise notice 'PIR01 R0 PASSED';
end $$;
rollback;
