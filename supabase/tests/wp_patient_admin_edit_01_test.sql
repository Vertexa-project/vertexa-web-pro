-- =====================================================================================
-- WP-PATIENT-ADMIN-EDIT-01 · update_patient_registration / get_patient_registration_access
-- (BEGIN / DO pequeno / ROLLBACK). Exige 20260926120000.
-- Login via request.jwt.claims + set local role (sub = auth.users.id).
-- NÃO rodar contra produção: criam dados sintéticos e fazem ROLLBACK, mas são testes locais.
-- =====================================================================================

create or replace function pg_temp.pae_ins_auth(
  p_id uuid, p_email text, p_provider text, p_confirmed boolean
) returns void
language plpgsql
as $fn$
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
    'x', case when p_confirmed then clock_timestamp() else null end,
    jsonb_build_object('provider', p_provider, 'providers', jsonb_build_array(p_provider)),
    '{}'::jsonb, clock_timestamp(), clock_timestamp()
  );
end;
$fn$;

-- Seed: clínica A (owner, admin, member), clínica B (owner), pacientes em A:
--   pat_noauth  = profile SEM Auth, e-mail digitado errado (wrong@pae01.test)
--   pat_auth    = profile COM Auth Google (withauth@pae01.test)
--   pat_taken   = profile SEM Auth com e-mail 'taken@pae01.test'
create or replace function pg_temp.pae_seed()
returns table (
  c_a uuid, c_b uuid,
  a_own uuid, a_adm uuid, a_mem uuid, a_ownb uuid, a_patauth uuid,
  pf_noauth uuid, pf_auth uuid, pf_taken uuid,
  pat_noauth uuid, pat_auth uuid, pat_taken uuid
)
language plpgsql
as $seed$
declare
  v_c_a uuid := gen_random_uuid(); v_c_b uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_pf_mem uuid := gen_random_uuid(); v_a_mem uuid := gen_random_uuid();
  v_pf_ownb uuid := gen_random_uuid(); v_a_ownb uuid := gen_random_uuid();
  v_pf_noauth uuid := gen_random_uuid();
  v_pf_auth uuid := gen_random_uuid(); v_a_patauth uuid := gen_random_uuid();
  v_pf_taken uuid := gen_random_uuid();
  v_pat_noauth uuid; v_pat_auth uuid; v_pat_taken uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own,  v_a_own,  'professional', 'Owner A',  'own-pae01@t.test',  'active'),
    (v_pf_adm,  v_a_adm,  'professional', 'Admin A',  'adm-pae01@t.test',  'active'),
    (v_pf_mem,  v_a_mem,  'professional', 'Member A', 'mem-pae01@t.test',  'active'),
    (v_pf_ownb, v_a_ownb, 'professional', 'Owner B',  'ownb-pae01@t.test', 'active'),
    (v_pf_noauth, null,   'patient', 'Paciente Sem Auth', 'wrong@pae01.test',    'active'),
    (v_pf_auth, v_a_patauth, 'patient', 'Paciente Com Auth', 'withauth@pae01.test', 'active'),
    (v_pf_taken, null,    'patient', 'Paciente Taken', 'taken@pae01.test',    'active');

  -- auth.users do paciente COM Auth entra DEPOIS do profile (handle_new_user retorna cedo).
  perform pg_temp.pae_ins_auth(v_a_patauth, 'withauth@pae01.test', 'google', true);

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c_a, 'Clinica A PAE01', v_pf_own),
    (v_c_b, 'Clinica B PAE01', v_pf_ownb);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_pf_adm, v_c_a, 'doctor', 'admin', 'active'),
    (v_pf_mem, v_c_a, 'nutritionist', 'member', 'active'),
    (v_pf_ownb, v_c_b, 'other', 'admin', 'active');

  insert into public.patients (profile_id, clinic_id) values (v_pf_noauth, v_c_a) returning id into v_pat_noauth;
  insert into public.patients (profile_id, clinic_id) values (v_pf_auth, v_c_a) returning id into v_pat_auth;
  insert into public.patients (profile_id, clinic_id) values (v_pf_taken, v_c_a) returning id into v_pat_taken;

  return query select v_c_a, v_c_b, v_a_own, v_a_adm, v_a_mem, v_a_ownb, v_a_patauth,
                      v_pf_noauth, v_pf_auth, v_pf_taken, v_pat_noauth, v_pat_auth, v_pat_taken;
end;
$seed$;

-- Chama a RPC como `p_sub` (auth.users.id) e devolve 'OK:<changed>' ou 'ERR:<sqlstate>:<hint>'.
create or replace function pg_temp.pae_try(
  p_sub uuid, p_patient uuid, p_name text, p_email text,
  p_sex text default null, p_start date default null
) returns text
language plpgsql
as $f$
declare v_hint text; v_state text; v_res jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub::text)::text, true);
  set local role authenticated;
  begin
    v_res := public.update_patient_registration(p_patient, p_name, p_email, null, p_sex, null, null, null, null, p_start);
    reset role;
    return 'OK:' || coalesce(v_res->>'changed_fields', '');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    reset role;
    return 'ERR:' || v_state || ':' || coalesce(v_hint, '');
  end;
end;
$f$;

-- hash de todas as tabelas billing/asaas/entitlement (independência de cobrança)
create or replace function pg_temp.pae_billing_hash() returns text
language plpgsql
as $f$
declare r record; h text; acc text := '';
begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'r' and n.nspname in ('public', 'private') and c.relname ~* 'billing|asaas|entitle'
            order by 1, 2 loop
    execute format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) from %I.%I t', r.nspname, r.relname) into h;
    acc := acc || r.relname || '=' || h || ';';
  end loop;
  return md5(acc);
end;
$f$;


-- T0: catálogo — uma assinatura, DEFINER, search_path vazio, grants, sem billing, locks nos claim paths
begin;
do $$
declare
  v_n int; v_def boolean; v_cfg text; v_src text; v_rls boolean;
  v_sig text := 'public.update_patient_registration(uuid,text,text,date,text,numeric,text,numeric,numeric,date)';
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_patient_registration';
  if v_n <> 1 then raise exception 'PAE01 T0 FAIL: overloads=%', v_n; end if;

  select p.prosecdef, array_to_string(p.proconfig, ','), p.prosrc into v_def, v_cfg, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_patient_registration';
  if not v_def then raise exception 'PAE01 T0 FAIL: not DEFINER'; end if;
  if v_cfg is null or v_cfg not like '%search_path=%' or v_cfg like '%search_path=public%' then
    raise exception 'PAE01 T0 FAIL: search_path=%', coalesce(v_cfg, 'null');
  end if;
  if v_src !~ 'is_clinic_admin' then raise exception 'PAE01 T0 FAIL: missing is_clinic_admin'; end if;
  if v_src ~* 'billing|asaas|entitle' then raise exception 'PAE01 T0 FAIL: billing leaked'; end if;
  if v_src ~* 'update\s+auth\.|insert\s+into\s+auth\.|auth\.identities' then
    raise exception 'PAE01 T0 FAIL: touches auth schema';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then raise exception 'PAE01 T0 FAIL: anon execute'; end if;
  if not has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'PAE01 T0 FAIL: authenticated execute missing';
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = 'public.patient_registration_events'::regclass;
  if not v_rls then raise exception 'PAE01 T0 FAIL: audit RLS off'; end if;
  if has_table_privilege('authenticated', 'public.patient_registration_events', 'insert')
     or has_table_privilege('authenticated', 'public.patient_registration_events', 'update')
     or has_table_privilege('authenticated', 'public.patient_registration_events', 'delete') then
    raise exception 'PAE01 T0 FAIL: audit writable by client';
  end if;

  -- os 3 caminhos de claim usam a MESMA chave canônica de lock
  if (select prosrc from pg_proc where proname = 'handle_new_user' and pronamespace = 'public'::regnamespace) !~ 'identity_email_lock' then
    raise exception 'PAE01 T0 FAIL: handle_new_user sem lock';
  end if;
  if (select prosrc from pg_proc where proname = 'ensure_auth_profile' and pronamespace = 'private'::regnamespace) !~ 'identity_email_lock' then
    raise exception 'PAE01 T0 FAIL: ensure_auth_profile sem lock';
  end if;
  if (select prosrc from pg_proc where proname = 'create_patient' and pronamespace = 'public'::regnamespace) !~ 'identity_email_lock' then
    raise exception 'PAE01 T0 FAIL: create_patient sem lock';
  end if;
  if has_function_privilege('authenticated', 'private.identity_email_lock(text)', 'execute') then
    raise exception 'PAE01 T0 FAIL: lock helper exposed';
  end if;
  raise notice 'PAE01 T0 PASSED';
end $$;
rollback;


-- T1: EMAIL CORRECTION BEFORE AUTH (admin da mesma clínica) — sem profile/patient/Auth novos
-- (Jacqueline/Luana: edição nunca cria Auth sem patient nem 2º profile)
begin;
do $$
declare
  s record; r text; v_auth0 int; v_prof0 int; v_pat0 int; v_email text; v_authid uuid; v_clinic uuid; v_prof uuid;
  v_ev int; v_fields text[];
begin
  select * into s from pg_temp.pae_seed();
  select count(*) into v_auth0 from auth.users;
  select count(*) into v_prof0 from public.profiles;
  select count(*) into v_pat0 from public.patients;

  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'correto@pae01.test');
  if r not like 'OK:%' then raise exception 'PAE01 T1 FAIL: %', r; end if;

  select pr.email, pr.auth_user_id, pr.id into v_email, v_authid, v_prof
    from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = s.pat_noauth;
  select pt.clinic_id into v_clinic from public.patients pt where pt.id = s.pat_noauth;

  if v_email is distinct from 'correto@pae01.test' then raise exception 'PAE01 T1 FAIL: email=%', v_email; end if;
  if v_authid is not null then raise exception 'PAE01 T1 FAIL: auth_user_id set'; end if;
  if v_clinic is distinct from s.c_a then raise exception 'PAE01 T1 FAIL: clinic moved'; end if;
  if (select count(*) from auth.users) <> v_auth0 then raise exception 'PAE01 T1 FAIL: auth.users changed'; end if;
  if (select count(*) from public.profiles) <> v_prof0 then raise exception 'PAE01 T1 FAIL: profiles changed'; end if;
  if (select count(*) from public.patients) <> v_pat0 then raise exception 'PAE01 T1 FAIL: patients changed'; end if;
  if (select count(*) from public.profiles where lower(btrim(email)) = 'correto@pae01.test') <> 1 then
    raise exception 'PAE01 T1 FAIL: matching profiles <> 1';
  end if;

  select count(*), (array_agg(changed_fields))[1] into v_ev, v_fields
    from public.patient_registration_events where patient_id = s.pat_noauth;
  if v_ev <> 1 or not ('email' = any(v_fields)) then raise exception 'PAE01 T1 FAIL: audit ev=% fields=%', v_ev, v_fields; end if;
  if array_to_string(v_fields, ',') like '%@%' then raise exception 'PAE01 T1 FAIL: PII in audit'; end if;
  raise notice 'PAE01 T1 PASSED';
end $$;
rollback;


-- T2: owner da clínica (sem linha em professionals) também edita
begin;
do $$
declare s record; r text;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_own, s.pat_noauth, 'Nome Novo Owner', 'wrong@pae01.test');
  if r not like 'OK:%full_name%' then raise exception 'PAE01 T2 FAIL: %', r; end if;
  if (select pr.full_name from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = s.pat_noauth) <> 'Nome Novo Owner' then
    raise exception 'PAE01 T2 FAIL: name not applied';
  end if;
  raise notice 'PAE01 T2 PASSED';
end $$;
rollback;


-- T3: AUTH-LINKED EMAIL DIRECT EDIT = DENIED; mesmo e-mail + outro campo passa; auth_user_id e Auth intactos
-- (Max: conta Google-only continua Google-only)
begin;
do $$
declare s record; r text; v_authrow0 text; v_authrow1 text; v_au0 uuid; v_au1 uuid;
begin
  select * into s from pg_temp.pae_seed();
  select md5(u::text) into v_authrow0 from auth.users u where u.id = s.a_patauth;
  select auth_user_id into v_au0 from public.profiles where id = s.pf_auth;

  r := pg_temp.pae_try(s.a_adm, s.pat_auth, 'Paciente Com Auth', 'novo-login@pae01.test');
  if r is distinct from 'ERR:42501:PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED' then raise exception 'PAE01 T3 FAIL deny: %', r; end if;
  if (select email from public.profiles where id = s.pf_auth) <> 'withauth@pae01.test' then
    raise exception 'PAE01 T3 FAIL: email changed';
  end if;

  -- mesmo e-mail (inclusive variação de case/trim) + nome novo: permitido
  r := pg_temp.pae_try(s.a_adm, s.pat_auth, 'Nome Corrigido', '  WithAuth@PAE01.test ');
  if r not like 'OK:%full_name%' then raise exception 'PAE01 T3 FAIL same-email edit: %', r; end if;
  if (select email from public.profiles where id = s.pf_auth) <> 'withauth@pae01.test' then
    raise exception 'PAE01 T3 FAIL: email rewritten on no-op';
  end if;

  select auth_user_id into v_au1 from public.profiles where id = s.pf_auth;
  select md5(u::text) into v_authrow1 from auth.users u where u.id = s.a_patauth;
  if v_au1 is distinct from v_au0 then raise exception 'PAE01 T3 FAIL: auth_user_id changed'; end if;
  if v_authrow1 is distinct from v_authrow0 then raise exception 'PAE01 T3 FAIL: auth.users row changed'; end if;
  raise notice 'PAE01 T3 PASSED';
end $$;
rollback;


-- T4: admin de OUTRA clínica = DENIED
begin;
do $$
declare s record; r text;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_ownb, s.pat_noauth, 'Hacker', 'x@pae01.test');
  if r is distinct from 'ERR:42501:PATIENT_EDIT_ADMIN_REQUIRED' then raise exception 'PAE01 T4 FAIL: %', r; end if;
  if (select email from public.profiles where id = s.pf_noauth) <> 'wrong@pae01.test' then raise exception 'PAE01 T4 FAIL: changed'; end if;
  raise notice 'PAE01 T4 PASSED';
end $$;
rollback;


-- T5: member sem permissão = DENIED
begin;
do $$
declare s record; r text;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_mem, s.pat_noauth, 'Member', 'm@pae01.test');
  if r is distinct from 'ERR:42501:PATIENT_EDIT_ADMIN_REQUIRED' then raise exception 'PAE01 T5 FAIL: %', r; end if;
  raise notice 'PAE01 T5 PASSED';
end $$;
rollback;


-- T6: paciente tentando alterar outro paciente = DENIED; anon = sem EXECUTE; sem sessão = DENIED
begin;
do $$
declare s record; r text; v_raised boolean := false;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_patauth, s.pat_noauth, 'Outro', 'o@pae01.test');
  if r is distinct from 'ERR:42501:PATIENT_EDIT_ADMIN_REQUIRED' then raise exception 'PAE01 T6 FAIL patient: %', r; end if;
  r := pg_temp.pae_try(s.a_patauth, s.pat_auth, 'Si Mesmo', 'withauth@pae01.test');
  if r is distinct from 'ERR:42501:PATIENT_EDIT_ADMIN_REQUIRED' then raise exception 'PAE01 T6 FAIL self: %', r; end if;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.update_patient_registration(s.pat_noauth, 'x', null);
  exception when insufficient_privilege then v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception 'PAE01 T6 FAIL: anon executed'; end if;
  raise notice 'PAE01 T6 PASSED';
end $$;
rollback;


-- T7: DUPLICATE EMAIL = DENIED (profile de outra pessoa; variação case/trim; auth.users sem profile)
begin;
do $$
declare s record; r text; v_stranger uuid := gen_random_uuid();
begin
  select * into s from pg_temp.pae_seed();

  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'taken@pae01.test');
  if r is distinct from 'ERR:23505:PATIENT_EMAIL_IN_USE' then raise exception 'PAE01 T7 FAIL profile: %', r; end if;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', '  TAKEN@PAE01.TEST ');
  if r is distinct from 'ERR:23505:PATIENT_EMAIL_IN_USE' then raise exception 'PAE01 T7 FAIL case/trim: %', r; end if;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'withauth@pae01.test');
  if r is distinct from 'ERR:23505:PATIENT_EMAIL_IN_USE' then raise exception 'PAE01 T7 FAIL auth-linked profile: %', r; end if;

  -- Auth de outra pessoa SEM profile (apaga o pending criado pelo trigger só para isolar auth.users)
  perform pg_temp.pae_ins_auth(v_stranger, 'stranger@pae01.test', 'google', true);
  delete from public.profiles where auth_user_id = v_stranger;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'stranger@pae01.test');
  if r is distinct from 'ERR:23505:PATIENT_EMAIL_IN_USE' then raise exception 'PAE01 T7 FAIL auth.users: %', r; end if;

  if (select email from public.profiles where id = s.pf_noauth) <> 'wrong@pae01.test' then raise exception 'PAE01 T7 FAIL: email changed'; end if;
  raise notice 'PAE01 T7 PASSED';
end $$;
rollback;


-- T8: normalização trim/case — comparação case-insensitive; nada de heurística Gmail
begin;
do $$
declare s record; r text; v_stored text;
begin
  select * into s from pg_temp.pae_seed();

  -- só case: no-op (nenhuma mudança, nenhuma auditoria)
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', '  WRONG@PAE01.TEST ');
  if r is distinct from 'OK:[]' then raise exception 'PAE01 T8 FAIL no-op: %', r; end if;
  if (select count(*) from public.patient_registration_events where patient_id = s.pat_noauth) <> 0 then
    raise exception 'PAE01 T8 FAIL: audit on no-op';
  end if;

  -- trim aplicado; case do usuário preservado
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', '  Correto@Pae01.Test ');
  if r not like 'OK:%email%' then raise exception 'PAE01 T8 FAIL: %', r; end if;
  select email into v_stored from public.profiles where id = s.pf_noauth;
  if v_stored is distinct from 'Correto@Pae01.Test' then raise exception 'PAE01 T8 FAIL stored=%', v_stored; end if;

  -- Gmail: john.smith@gmail.com e johnsmith@gmail.com NÃO são o mesmo e-mail
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'john.smith@gmail.com');
  if r not like 'OK:%email%' then raise exception 'PAE01 T8 FAIL gmail1: %', r; end if;
  update public.profiles set email = 'johnsmith@gmail.com' where id = s.pf_taken;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'john.smith@gmail.com');
  if r is distinct from 'OK:[]' then raise exception 'PAE01 T8 FAIL gmail dots treated as equal: %', r; end if;
  raise notice 'PAE01 T8 PASSED';
end $$;
rollback;


-- T9: GOOGLE CLAIM REGRESSION (Alan) — edita e-mail; 1º login Google com o e-mail corrigido
--     claima EXATAMENTE o profile existente; nenhum profile/patient novo
begin;
do $$
declare
  s record; r text; v_new uuid := gen_random_uuid();
  v_prof0 int; v_pat0 int; v_linked uuid; v_status text;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'correto@pae01.test');
  if r not like 'OK:%email%' then raise exception 'PAE01 T9 FAIL edit: %', r; end if;
  select count(*) into v_prof0 from public.profiles;
  select count(*) into v_pat0 from public.patients;

  -- insert em auth.users dispara handle_new_user (trigger on_auth_user_created)
  perform pg_temp.pae_ins_auth(v_new, 'Correto@Pae01.Test', 'google', true);

  select auth_user_id, status into v_linked, v_status from public.profiles where id = s.pf_noauth;
  if v_linked is distinct from v_new then raise exception 'PAE01 T9 FAIL: profile existente não foi claimado'; end if;
  if v_status <> 'active' then raise exception 'PAE01 T9 FAIL: status=%', v_status; end if;
  if (select count(*) from public.profiles) <> v_prof0 then raise exception 'PAE01 T9 FAIL: profile novo criado'; end if;
  if (select count(*) from public.patients) <> v_pat0 then raise exception 'PAE01 T9 FAIL: patient novo criado'; end if;
  if (select count(*) from public.profiles where lower(btrim(email)) = 'correto@pae01.test') <> 1 then
    raise exception 'PAE01 T9 FAIL: profiles por e-mail <> 1';
  end if;
  if (select pt.id from public.patients pt where pt.profile_id = s.pf_noauth) is distinct from s.pat_noauth then
    raise exception 'PAE01 T9 FAIL: patient diferente';
  end if;
  raise notice 'PAE01 T9 PASSED';
end $$;
rollback;


-- T9b: mesmo claim pelo caminho private.ensure_auth_profile (fallback de cada SIGNED_IN)
begin;
do $$
declare s record; r text; v_new uuid := gen_random_uuid(); v_prof0 int; v_linked uuid;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'correto2@pae01.test');
  if r not like 'OK:%email%' then raise exception 'PAE01 T9b FAIL edit: %', r; end if;

  -- não confirmado: o trigger ignora; confirma depois e chama o fallback
  perform pg_temp.pae_ins_auth(v_new, 'correto2@pae01.test', 'google', false);
  update auth.users set email_confirmed_at = clock_timestamp() where id = v_new;
  select count(*) into v_prof0 from public.profiles;

  perform private.ensure_auth_profile(v_new);
  select auth_user_id into v_linked from public.profiles where id = s.pf_noauth;
  if v_linked is distinct from v_new then raise exception 'PAE01 T9b FAIL: não claimou'; end if;
  if (select count(*) from public.profiles) <> v_prof0 then raise exception 'PAE01 T9b FAIL: profile novo'; end if;
  raise notice 'PAE01 T9b PASSED';
end $$;
rollback;


-- T10: login com o e-mail ANTIGO (errado) após a correção NÃO claima — cria pending à parte
--      (comportamento documentado; o profile existente continua sem Auth e com o e-mail novo)
begin;
do $$
declare s record; r text; v_old uuid := gen_random_uuid(); v_prof0 int;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'correto@pae01.test');
  if r not like 'OK:%email%' then raise exception 'PAE01 T10 FAIL edit: %', r; end if;
  select count(*) into v_prof0 from public.profiles;
  perform pg_temp.pae_ins_auth(v_old, 'wrong@pae01.test', 'google', true);
  if (select auth_user_id from public.profiles where id = s.pf_noauth) is not null then
    raise exception 'PAE01 T10 FAIL: e-mail antigo claimou o profile corrigido';
  end if;
  if (select count(*) from public.profiles) <> v_prof0 + 1 then raise exception 'PAE01 T10 FAIL: esperava 1 pending'; end if;
  raise notice 'PAE01 T10 PASSED';
end $$;
rollback;


-- T11: validações — e-mail inválido, limpar e-mail, sexo/medidas inválidos, start_date
--      (current_weight, clinic_id, profile_id, auth_user_id nunca mudam)
begin;
do $$
declare s record; r text; v_cw numeric; v_sd date;
begin
  select * into s from pg_temp.pae_seed();
  update public.patients set current_weight = 77.7 where id = s.pat_noauth;

  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'sem-arroba');
  if r is distinct from 'ERR:22023:PATIENT_EMAIL_INVALID' then raise exception 'PAE01 T11 FAIL invalid: %', r; end if;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', null);
  if r is distinct from 'ERR:22023:PATIENT_EMAIL_INVALID' then raise exception 'PAE01 T11 FAIL clear: %', r; end if;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, '   ', 'wrong@pae01.test');
  if r is distinct from 'ERR:22023:PATIENT_NAME_REQUIRED' then raise exception 'PAE01 T11 FAIL name: %', r; end if;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test', 'alienigena');
  if r is distinct from 'ERR:22023:PATIENT_FIELD_INVALID' then raise exception 'PAE01 T11 FAIL sex: %', r; end if;
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test', null, current_date + 1);
  if r is distinct from 'ERR:22023:PATIENT_FIELD_INVALID' then raise exception 'PAE01 T11 FAIL future start: %', r; end if;

  -- start_date é ADMIN_EDITABLE; passado é aceito e auditado
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test', 'feminino', current_date - 30);
  if r not like 'OK:%start_date%' or r not like '%sex%' then raise exception 'PAE01 T11 FAIL start ok: %', r; end if;
  select current_weight, start_date into v_cw, v_sd from public.patients where id = s.pat_noauth;
  if v_cw is distinct from 77.7 then raise exception 'PAE01 T11 FAIL: current_weight mudou'; end if;
  if v_sd is distinct from current_date - 30 then raise exception 'PAE01 T11 FAIL: start_date=%', v_sd; end if;

  -- start_date nulo = manter
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test', 'feminino', null);
  if r is distinct from 'OK:[]' then raise exception 'PAE01 T11 FAIL keep start: %', r; end if;
  raise notice 'PAE01 T11 PASSED';
end $$;
rollback;


-- T12: double submit idempotente — 2ª chamada idêntica é no-op, 1 só linha de auditoria
begin;
do $$
declare s record; r1 text; r2 text;
begin
  select * into s from pg_temp.pae_seed();
  r1 := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'correto@pae01.test');
  r2 := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Paciente Sem Auth', 'correto@pae01.test');
  if r1 not like 'OK:%email%' or r2 is distinct from 'OK:[]' then raise exception 'PAE01 T12 FAIL: % / %', r1, r2; end if;
  if (select count(*) from public.patient_registration_events where patient_id = s.pat_noauth) <> 1 then
    raise exception 'PAE01 T12 FAIL: audit rows';
  end if;
  raise notice 'PAE01 T12 PASSED';
end $$;
rollback;


-- T13: BILLING INDEPENDENCE — nenhuma tabela billing/asaas/entitlement muda
begin;
do $$
declare s record; r text; h0 text; h1 text;
begin
  select * into s from pg_temp.pae_seed();
  h0 := pg_temp.pae_billing_hash();
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Nome Novo', 'correto@pae01.test', 'masculino', current_date - 10);
  if r not like 'OK:%' then raise exception 'PAE01 T13 FAIL: %', r; end if;
  h1 := pg_temp.pae_billing_hash();
  if h0 is distinct from h1 then raise exception 'PAE01 T13 FAIL: billing mudou'; end if;
  raise notice 'PAE01 T13 PASSED';
end $$;
rollback;


-- T14: get_patient_registration_access — sem Auth / com Auth / drift legado / clínica alheia
begin;
do $$
declare s record; v jsonb; v_hint text; v_state text; v_raised boolean := false;
begin
  select * into s from pg_temp.pae_seed();

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);
  set local role authenticated;
  v := public.get_patient_registration_access(s.pat_noauth);
  reset role;
  if (v->>'has_login_account')::boolean is distinct from false then raise exception 'PAE01 T14 FAIL no-auth: %', v; end if;

  set local role authenticated;
  v := public.get_patient_registration_access(s.pat_auth);
  reset role;
  if (v->>'has_login_account')::boolean is distinct from true
     or (v->>'login_email_matches_registration')::boolean is distinct from true then
    raise exception 'PAE01 T14 FAIL auth: %', v;
  end if;

  -- LEGACY_AUTH_EMAIL_DRIFT: e-mail do cadastro diverge do e-mail real do Auth
  update public.profiles set email = 'drift@pae01.test' where id = s.pf_auth;
  set local role authenticated;
  v := public.get_patient_registration_access(s.pat_auth);
  reset role;
  if (v->>'login_email_matches_registration')::boolean is distinct from false then
    raise exception 'PAE01 T14 FAIL drift: %', v;
  end if;

  -- admin de outra clínica
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_ownb::text)::text, true);
  set local role authenticated;
  begin
    perform public.get_patient_registration_access(s.pat_auth);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    v_raised := true;
  end;
  reset role;
  if not v_raised or v_state <> '42501' or v_hint <> 'PATIENT_EDIT_ADMIN_REQUIRED' then
    raise exception 'PAE01 T14 FAIL foreign: % %', v_state, v_hint;
  end if;
  raise notice 'PAE01 T14 PASSED';
end $$;
rollback;


-- T15: auditoria — admin da clínica lê; outra clínica não vê; sem PII
begin;
do $$
declare s record; r text; v_a int; v_b int; v_fields text;
begin
  select * into s from pg_temp.pae_seed();
  r := pg_temp.pae_try(s.a_adm, s.pat_noauth, 'Novo Nome', 'correto@pae01.test', 'masculino');
  if r not like 'OK:%' then raise exception 'PAE01 T15 FAIL edit: %', r; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);
  set local role authenticated;
  select count(*) into v_a from public.patient_registration_events where patient_id = s.pat_noauth;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_ownb::text)::text, true);
  set local role authenticated;
  select count(*) into v_b from public.patient_registration_events where patient_id = s.pat_noauth;
  reset role;
  if v_a <> 1 or v_b <> 0 then raise exception 'PAE01 T15 FAIL: a=% b=%', v_a, v_b; end if;

  select string_agg(array_to_string(changed_fields, ','), ';') into v_fields
    from public.patient_registration_events where patient_id = s.pat_noauth;
  if v_fields like '%@%' or v_fields like '%correto%' then raise exception 'PAE01 T15 FAIL: PII'; end if;
  raise notice 'PAE01 T15 PASSED';
end $$;
rollback;


-- T16: start_date — editável; futura negada; anterior ao nascimento negada; NULL = MANTER
--      (limpar para NULL NÃO é suportado); jornada é derivada na leitura (sem trigger em patients)
begin;
do $$
declare
  s record; v_hint text; v_state text; v_raised boolean; v_sd date; v_trg text;
begin
  select * into s from pg_temp.pae_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);

  -- anterior ao nascimento (ambos informados) = DENIED
  v_raised := false;
  set local role authenticated;
  begin
    perform public.update_patient_registration(s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test',
      date '1990-01-01', null, null, null, null, null, date '1980-01-01');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate; v_raised := true;
  end;
  reset role;
  if not v_raised or v_state <> '22023' or v_hint <> 'PATIENT_FIELD_INVALID' then
    raise exception 'PAE01 T16 FAIL before-birth: % % %', v_raised, v_state, v_hint;
  end if;

  -- muda start_date (válida)
  set local role authenticated;
  perform public.update_patient_registration(s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test',
    date '1990-01-01', null, null, null, null, null, current_date - 40);
  reset role;
  select start_date into v_sd from public.patients where id = s.pat_noauth;
  if v_sd is distinct from current_date - 40 then raise exception 'PAE01 T16 FAIL: not changed (%)', v_sd; end if;

  -- NULL = manter (A: muda, B: mantém, C: limpar NÃO suportado)
  set local role authenticated;
  perform public.update_patient_registration(s.pat_noauth, 'Paciente Sem Auth', 'wrong@pae01.test',
    date '1990-01-01', null, null, null, null, null, null);
  reset role;
  select start_date into v_sd from public.patients where id = s.pat_noauth;
  if v_sd is distinct from current_date - 40 then raise exception 'PAE01 T16 FAIL: NULL cleared/changed start_date (%)', v_sd; end if;

  -- jornada é derivada na leitura: o único trigger de patients é o guard de billing (não toca start_date)
  select string_agg(tgname, ',') into v_trg from pg_trigger where tgrelid = 'public.patients'::regclass and not tgisinternal;
  if v_trg is distinct from 'billing_patients_commercial_guard' then raise exception 'PAE01 T16 FAIL: triggers em patients=%', v_trg; end if;
  raise notice 'PAE01 T16 PASSED';
end $$;
rollback;


-- T17: DRIFT — detecção sem correção, sem escrever no Auth, sem vazar o e-mail do Auth
begin;
do $$
declare
  s record; v jsonb; h0 text; h1 text; i0 text; i1 text; v_keys text;
begin
  select * into s from pg_temp.pae_seed();
  update public.profiles set email = 'drift@pae01.test' where id = s.pf_auth;   -- cria o drift
  select md5(string_agg(u::text, '|' order by u.id)) into h0 from auth.users u;
  select md5(coalesce(string_agg(i::text, '|' order by i.id), '')) into i0 from auth.identities i;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);
  set local role authenticated;
  v := public.get_patient_registration_access(s.pat_auth);
  reset role;

  select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from 'has_login_account,login_email_matches_registration' then
    raise exception 'PAE01 T17 FAIL: chaves inesperadas %', v_keys;
  end if;
  if (v->>'login_email_matches_registration')::boolean is distinct from false then raise exception 'PAE01 T17 FAIL: drift não detectado'; end if;
  if v::text ~* 'withauth|drift@|@' then raise exception 'PAE01 T17 FAIL: vazou e-mail: %', v; end if;

  -- a edição com Auth NÃO "corrige" o drift automaticamente
  if pg_temp.pae_try(s.a_adm, s.pat_auth, 'Paciente Com Auth', 'withauth@pae01.test') is distinct from 'ERR:42501:PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED' then
    raise exception 'PAE01 T17 FAIL: edição de e-mail com Auth não foi negada';
  end if;
  if (select email from public.profiles where id = s.pf_auth) <> 'drift@pae01.test' then raise exception 'PAE01 T17 FAIL: autocorreção do drift'; end if;

  select md5(string_agg(u::text, '|' order by u.id)) into h1 from auth.users u;
  select md5(coalesce(string_agg(i::text, '|' order by i.id), '')) into i1 from auth.identities i;
  if h0 is distinct from h1 then raise exception 'PAE01 T17 FAIL: auth.users alterado'; end if;
  if i0 is distinct from i1 then raise exception 'PAE01 T17 FAIL: auth.identities alterado'; end if;
  raise notice 'PAE01 T17 PASSED';
end $$;
rollback;
