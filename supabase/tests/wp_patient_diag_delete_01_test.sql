-- =====================================================================================
-- WP-PATIENT-DIAG-DELETE-01 · delete_unused_patient_registration / get_patient_deletion_eligibility
-- (BEGIN / DO pequeno / ROLLBACK). Exige 20261010120000.
-- Login via request.jwt.claims + set local role (sub = auth.users.id).
-- NÃO rodar contra produção: cria dados sintéticos e faz ROLLBACK, mas é teste local.
-- Concorrência (T25/T26 + corrida de 1º login): wp_patient_diag_delete_01_concurrency.mjs
-- =====================================================================================

create or replace function pg_temp.pdd_ins_auth(
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

-- Seed: clínica A (owner, admin, member), clínica B (owner/admin), platform admin sem clínica,
-- paciente COM Auth em A (para T4) e um paciente "vizinho" em A e outro em B (T20/T24).
create or replace function pg_temp.pdd_seed()
returns table (
  c_a uuid, c_b uuid,
  a_own uuid, a_adm uuid, a_mem uuid, a_ownb uuid, a_pa uuid, a_pat uuid,
  pf_adm uuid, pr_adm uuid,
  pat_auth uuid, pat_neighbor uuid, pat_b uuid
)
language plpgsql
as $seed$
declare
  v_c_a uuid := gen_random_uuid(); v_c_b uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_pf_mem uuid := gen_random_uuid(); v_a_mem uuid := gen_random_uuid();
  v_pf_ownb uuid := gen_random_uuid(); v_a_ownb uuid := gen_random_uuid();
  v_pf_pa uuid := gen_random_uuid(); v_a_pa uuid := gen_random_uuid();
  v_pf_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid();
  v_pf_nb uuid := gen_random_uuid(); v_pf_b uuid := gen_random_uuid();
  v_pr_adm uuid; v_pat_auth uuid; v_pat_nb uuid; v_pat_b uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own,  v_a_own,  'professional', 'Owner A',  'own-pdd01@t.test',  'active'),
    (v_pf_adm,  v_a_adm,  'professional', 'Admin A',  'adm-pdd01@t.test',  'active'),
    (v_pf_mem,  v_a_mem,  'professional', 'Member A', 'mem-pdd01@t.test',  'active'),
    (v_pf_ownb, v_a_ownb, 'professional', 'Owner B',  'ownb-pdd01@t.test', 'active'),
    (v_pf_pa,   v_a_pa,   'professional', 'Platform', 'pa-pdd01@t.test',   'active'),
    (v_pf_pat,  v_a_pat,  'patient', 'Paciente Com Auth', 'pat-auth@pdd01.test', 'active'),
    (v_pf_nb,   null,     'patient', 'Vizinho A', 'neighbor@pdd01.test', 'active'),
    (v_pf_b,    null,     'patient', 'Paciente B', 'pat-b@pdd01.test', 'active');

  perform pg_temp.pdd_ins_auth(v_a_pat, 'pat-auth@pdd01.test', 'google', true);

  insert into private.platform_admins (profile_id, status) values (v_pf_pa, 'active');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c_a, 'Clinica A PDD01', v_pf_own),
    (v_c_b, 'Clinica B PDD01', v_pf_ownb);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_adm, v_c_a, 'doctor', 'admin', 'active') returning id into v_pr_adm;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_pf_mem, v_c_a, 'nutritionist', 'member', 'active'),
    (v_pf_ownb, v_c_b, 'other', 'admin', 'active');

  insert into public.patients (profile_id, clinic_id) values (v_pf_pat, v_c_a) returning id into v_pat_auth;
  insert into public.patients (profile_id, clinic_id, goal) values (v_pf_nb, v_c_a, 'vizinho') returning id into v_pat_nb;
  insert into public.patients (profile_id, clinic_id, goal) values (v_pf_b, v_c_b, 'b') returning id into v_pat_b;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_pr_adm, v_pat_nb, false, 'active');

  return query select v_c_a, v_c_b, v_a_own, v_a_adm, v_a_mem, v_a_ownb, v_a_pa, v_a_pat,
                      v_pf_adm, v_pr_adm, v_pat_auth, v_pat_nb, v_pat_b;
end;
$seed$;

-- Paciente "como o create_patient deixa": profile sem Auth + patient + (opcional) 1 vínculo ativo.
create or replace function pg_temp.pdd_patient(p_clinic uuid, p_prof uuid, p_email text)
returns table (pat uuid, pf uuid)
language plpgsql
as $f$
declare v_pf uuid := gen_random_uuid(); v_pat uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, null, 'patient', 'Cadastro ' || coalesce(p_email, 'sem email'), p_email, 'active');
  insert into public.patients (profile_id, clinic_id, goal, start_date)
    values (v_pf, p_clinic, 'g', current_date) returning id into v_pat;
  if p_prof is not null then
    insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
      values (p_prof, v_pat, false, 'active');
  end if;
  return query select v_pat, v_pf;
end;
$f$;

-- Chama a RPC de exclusão como `p_sub` e devolve 'OK' ou 'ERR:<sqlstate>:<hint>'.
create or replace function pg_temp.pdd_try(p_sub uuid, p_patient uuid) returns text
language plpgsql
as $f$
declare v_hint text; v_state text; v_res jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_res := public.delete_unused_patient_registration(p_patient);
    reset role;
    if (v_res->>'deleted')::boolean is not true then return 'BAD:' || v_res::text; end if;
    return 'OK';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    reset role;
    return 'ERR:' || v_state || ':' || coalesce(v_hint, '');
  end;
end;
$f$;

-- Lê a elegibilidade como `p_sub`. Erro vira {"error": "<sqlstate>:<hint>"}.
create or replace function pg_temp.pdd_elig(p_sub uuid, p_patient uuid) returns jsonb
language plpgsql
as $f$
declare v_hint text; v_state text; v_res jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_res := public.get_patient_deletion_eligibility(p_patient);
    reset role;
    return v_res;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    reset role;
    return jsonb_build_object('error', v_state || ':' || coalesce(v_hint, ''));
  end;
end;
$f$;

-- Estado "intocável" fora do alvo: Auth, billing, outras clínicas.
create or replace function pg_temp.pdd_billing_hash() returns text
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

create or replace function pg_temp.pdd_auth_hash() returns text
language sql
as $f$
  select md5(
    (select coalesce(string_agg(u.id::text || coalesce(u.email, '') || coalesce(u.email_confirmed_at::text, ''), '|' order by u.id), '') from auth.users u)
    || '#' ||
    (select coalesce(string_agg(i.id::text || i.user_id::text, '|' order by i.id), '') from auth.identities i)
  )
$f$;

-- Bloqueio esperado: RPC de exclusão nega com 55000/<reason>, elegibilidade concorda e NADA muda.
create or replace function pg_temp.pdd_expect_block(p_sub uuid, p_patient uuid, p_reason text, p_label text)
returns void
language plpgsql
as $f$
declare r text; e jsonb; v_pat0 bigint; v_prof0 bigint; v_aud0 bigint;
begin
  select count(*) into v_pat0 from public.patients;
  select count(*) into v_prof0 from public.profiles;
  select count(*) into v_aud0 from public.patient_registration_deletions;

  e := pg_temp.pdd_elig(p_sub, p_patient);
  if (e->>'eligible')::boolean is not false or not (e->'blockers' ? p_reason) then
    raise exception 'PDD01 % FAIL eligibility: %', p_label, e;
  end if;

  r := pg_temp.pdd_try(p_sub, p_patient);
  if r not like 'ERR:55000:%' then raise exception 'PDD01 % FAIL delete: %', p_label, r; end if;
  if r <> 'ERR:55000:' || (e->>'reason') then
    raise exception 'PDD01 % FAIL reason mismatch rpc=% elig=%', p_label, r, e->>'reason';
  end if;
  if (select count(*) from public.patients) <> v_pat0
     or (select count(*) from public.profiles) <> v_prof0
     or (select count(*) from public.patient_registration_deletions) <> v_aud0 then
    raise exception 'PDD01 % FAIL: blocked delete changed data', p_label;
  end if;
end;
$f$;


-- T0: catálogo — assinaturas únicas, DEFINER, search_path vazio, grants, helpers fechados, auditoria
begin;
do $$
declare
  v_n int; v_def boolean; v_cfg text; v_src text; v_rls boolean; v_fn text;
begin
  foreach v_fn in array array['delete_unused_patient_registration', 'get_patient_deletion_eligibility'] loop
    select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn;
    if v_n <> 1 then raise exception 'PDD01 T0 FAIL: % overloads=%', v_fn, v_n; end if;
    select p.prosecdef, array_to_string(p.proconfig, ','), p.prosrc into v_def, v_cfg, v_src
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn;
    if not v_def then raise exception 'PDD01 T0 FAIL: % not DEFINER', v_fn; end if;
    if v_cfg is distinct from 'search_path=""' then raise exception 'PDD01 T0 FAIL: % search_path=%', v_fn, v_cfg; end if;
    if v_src !~ 'is_clinic_admin' then raise exception 'PDD01 T0 FAIL: % missing is_clinic_admin', v_fn; end if;
    if v_src ~* 'billing|asaas|entitle' then raise exception 'PDD01 T0 FAIL: % billing leaked', v_fn; end if;
    if v_src ~* '(update|delete\s+from|insert\s+into)\s+auth\.' then raise exception 'PDD01 T0 FAIL: % writes auth', v_fn; end if;
    if has_function_privilege('anon', 'public.' || v_fn || '(uuid)', 'execute') then
      raise exception 'PDD01 T0 FAIL: anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', 'public.' || v_fn || '(uuid)', 'execute') then
      raise exception 'PDD01 T0 FAIL: authenticated cannot execute %', v_fn;
    end if;
  end loop;

  select p.prosrc into v_src from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_unused_patient_registration';
  if v_src !~ 'identity_email_lock' then raise exception 'PDD01 T0 FAIL: delete sem lock de identidade'; end if;
  if v_src !~* 'for update' then raise exception 'PDD01 T0 FAIL: delete sem lock de linha'; end if;
  if v_src !~ 'patient_deletion_assessment' then raise exception 'PDD01 T0 FAIL: delete não recalcula elegibilidade'; end if;
  if v_src ~* 'delete\s+from\s+public\.patient_registration_events' then
    raise exception 'PDD01 T0 FAIL: delete apaga auditoria';
  end if;

  if has_function_privilege('authenticated', 'private.patient_deletion_assessment(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.destructive_identity_risk_key(text)', 'execute')
     or has_function_privilege('anon', 'private.destructive_identity_risk_key(text)', 'execute') then
    raise exception 'PDD01 T0 FAIL: helper exposed';
  end if;

  -- a chave de risco NÃO vaza para a semântica de identidade/login/edição
  foreach v_fn in array array['public.handle_new_user', 'private.ensure_auth_profile', 'public.ensure_my_profile',
                              'public.create_patient', 'public.update_patient_registration'] loop
    select p.prosrc into v_src from pg_proc p
     where p.oid = (select min(p2.oid) from pg_proc p2
                     where p2.pronamespace = split_part(v_fn, '.', 1)::regnamespace
                       and p2.proname = split_part(v_fn, '.', 2));
    if v_src is null then raise exception 'PDD01 T0 FAIL: % missing', v_fn; end if;
    if v_src ~* 'destructive_identity_risk_key|gmail|replace\s*\(' then
      raise exception 'PDD01 T0 FAIL: identity semantics drift in %', v_fn;
    end if;
  end loop;

  -- DELETE/TRUNCATE direto em patients: nenhum cliente (anon/authenticated) tem privilégio nem policy
  if has_table_privilege('anon', 'public.patients', 'delete') or has_table_privilege('authenticated', 'public.patients', 'delete')
     or has_table_privilege('anon', 'public.patients', 'truncate') or has_table_privilege('authenticated', 'public.patients', 'truncate') then
    raise exception 'PDD01 T0 FAIL: client DELETE/TRUNCATE grant on patients';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'patients'
              and permissive = 'PERMISSIVE' and cmd in ('DELETE', 'ALL')) then
    raise exception 'PDD01 T0 FAIL: permissive DELETE policy on patients';
  end if;

  -- auditoria da exclusão: só ids/contagens (sem colunas de conteúdo)
  if (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
       where table_schema = 'public' and table_name = 'patient_registration_deletions')
     is distinct from 'id,patient_id,profile_id,clinic_id,actor_profile_id,profile_deleted,removed_links,removed_empty_channels,preserved_registration_events,created_at' then
    raise exception 'PDD01 T0 FAIL: deletion audit columns changed';
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = 'public.patient_registration_deletions'::regclass;
  if not v_rls then raise exception 'PDD01 T0 FAIL: audit RLS off'; end if;
  if has_table_privilege('authenticated', 'public.patient_registration_deletions', 'insert')
     or has_table_privilege('authenticated', 'public.patient_registration_deletions', 'update')
     or has_table_privilege('authenticated', 'public.patient_registration_deletions', 'delete')
     or has_table_privilege('anon', 'public.patient_registration_deletions', 'select') then
    raise exception 'PDD01 T0 FAIL: audit writable/readable by client';
  end if;
  -- auditoria anterior continua sem FK (sobrevive ao paciente)
  if exists (select 1 from pg_constraint where conrelid = 'public.patient_registration_events'::regclass and contype = 'f')
     or exists (select 1 from pg_constraint where conrelid = 'public.patient_registration_deletions'::regclass and contype = 'f') then
    raise exception 'PDD01 T0 FAIL: audit table has FK';
  end if;

  -- escopo exato da chave de risco: gmail.com sem pontos; nada mais é colapsado
  if private.destructive_identity_risk_key('  Al.Mosena@GMAIL.com ') is distinct from 'almosena@gmail.com'
     or private.destructive_identity_risk_key('almosena@gmail.com') is distinct from 'almosena@gmail.com'
     or private.destructive_identity_risk_key('john.smith@example.com') is distinct from 'john.smith@example.com'
     or private.destructive_identity_risk_key('jo.ao@clinica-workspace.com.br') is distinct from 'jo.ao@clinica-workspace.com.br'
     or private.destructive_identity_risk_key('a.b@googlemail.com') is distinct from 'a.b@googlemail.com'
     or private.destructive_identity_risk_key('a.b+tag@gmail.com') is distinct from 'ab+tag@gmail.com'
     or private.destructive_identity_risk_key('  ') is not null then
    raise exception 'PDD01 T0 FAIL: destructive risk key scope';
  end if;
  raise notice 'PDD01 T0 PASSED';
end $$;
rollback;


-- T1 (+T20 T21 T22 T23 T24 T27): admin + cadastro intocado = EXCLUÍDO, nada fora do alvo muda
begin;
do $$
declare
  s record; p record; r text; e jsonb;
  v_auth0 text; v_bill0 text; v_nb0 text; v_b0 text; v_clin_a0 text; v_clin_b0 text;
  v_pat0 bigint; v_prof0 bigint; v_aud record;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'pristine@pdd01.test');

  v_auth0 := pg_temp.pdd_auth_hash();
  v_bill0 := pg_temp.pdd_billing_hash();
  select md5(t::text) into v_nb0 from public.patients t where t.id = s.pat_neighbor;
  select md5(t::text) into v_b0 from public.patients t where t.id = s.pat_b;
  select md5(c::text) into v_clin_a0 from public.clinics c where c.id = s.c_a;
  select md5(c::text) into v_clin_b0 from public.clinics c where c.id = s.c_b;
  select count(*) into v_pat0 from public.patients;
  select count(*) into v_prof0 from public.profiles;

  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if (e->>'eligible')::boolean is not true or e->>'reason' <> 'PATIENT_DELETE_ELIGIBLE' then
    raise exception 'PDD01 T1 FAIL eligibility: %', e;
  end if;
  if e::text ~ '@' or e ? 'profile_id' or e ? 'clinic_id' then raise exception 'PDD01 T1 FAIL: PII/ids in eligibility: %', e; end if;

  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T1 FAIL: %', r; end if;

  if exists (select 1 from public.patients where id = p.pat) then raise exception 'PDD01 T1 FAIL: patient remains'; end if;
  if exists (select 1 from public.profiles where id = p.pf) then raise exception 'PDD01 T1 FAIL: profile remains'; end if;
  if exists (select 1 from public.professional_patient_links where patient_id = p.pat) then
    raise exception 'PDD01 T1 FAIL: link remains';
  end if;
  if (select count(*) from public.patients) <> v_pat0 - 1 then raise exception 'PDD01 T1 FAIL: patients delta'; end if;
  if (select count(*) from public.profiles) <> v_prof0 - 1 then raise exception 'PDD01 T1 FAIL: profiles delta'; end if;

  if pg_temp.pdd_auth_hash() <> v_auth0 then raise exception 'PDD01 T22/T23 FAIL: auth changed'; end if;
  if pg_temp.pdd_billing_hash() <> v_bill0 then raise exception 'PDD01 T27 FAIL: billing changed'; end if;
  if (select md5(t::text) from public.patients t where t.id = s.pat_neighbor) <> v_nb0 then raise exception 'PDD01 T20 FAIL'; end if;
  if (select md5(c::text) from public.clinics c where c.id = s.c_a) <> v_clin_a0 then raise exception 'PDD01 T21 FAIL'; end if;
  if (select md5(t::text) from public.patients t where t.id = s.pat_b) <> v_b0
     or (select md5(c::text) from public.clinics c where c.id = s.c_b) <> v_clin_b0 then
    raise exception 'PDD01 T24 FAIL: cross-clinic change';
  end if;
  if (select count(*) from public.professional_patient_links where patient_id = s.pat_neighbor) <> 1 then
    raise exception 'PDD01 T20 FAIL: neighbor link changed';
  end if;

  select * into v_aud from public.patient_registration_deletions where patient_id = p.pat;
  if v_aud.id is null or v_aud.profile_id <> p.pf or v_aud.clinic_id <> s.c_a or not v_aud.profile_deleted
     or v_aud.removed_links <> 1 or v_aud.removed_empty_channels <> 0 then
    raise exception 'PDD01 T1 FAIL audit: %', row_to_json(v_aud);
  end if;
  if (select pr.id from public.profiles pr where pr.auth_user_id = s.a_adm) <> v_aud.actor_profile_id then
    raise exception 'PDD01 T1 FAIL: audit actor';
  end if;
  raise notice 'PDD01 T1 (+T20 T21 T22 T23 T24 T27) PASSED';
end $$;
rollback;


-- T1b: owner (sem linha em professionals, sem vínculo) também exclui
begin;
do $$
declare s record; p record; r text;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, null, 'owner-made@pdd01.test');
  r := pg_temp.pdd_try(s.a_own, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T1b FAIL: %', r; end if;
  raise notice 'PDD01 T1b PASSED';
end $$;
rollback;


-- T2..T6: autoridade (member, admin de outra clínica, paciente, anon, platform admin)
begin;
do $$
declare s record; p record; r text; e jsonb; v_hint text; v_state text;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'authz@pdd01.test');

  r := pg_temp.pdd_try(s.a_mem, p.pat);
  if r <> 'ERR:42501:PATIENT_DELETE_NOT_ADMIN' then raise exception 'PDD01 T2 FAIL: %', r; end if;
  e := pg_temp.pdd_elig(s.a_mem, p.pat);
  if e <> '{"eligible": false, "reason": "PATIENT_DELETE_NOT_ADMIN"}'::jsonb then raise exception 'PDD01 T2 FAIL elig: %', e; end if;
  raise notice 'PDD01 T2 PASSED';

  r := pg_temp.pdd_try(s.a_ownb, p.pat);
  if r <> 'ERR:42501:PATIENT_DELETE_FOREIGN_CLINIC' then raise exception 'PDD01 T3 FAIL: %', r; end if;
  e := pg_temp.pdd_elig(s.a_ownb, p.pat);
  if e <> '{"eligible": false, "reason": "PATIENT_DELETE_FOREIGN_CLINIC"}'::jsonb then raise exception 'PDD01 T3 FAIL elig: %', e; end if;
  raise notice 'PDD01 T3 PASSED';

  r := pg_temp.pdd_try(s.a_pat, p.pat);
  if r <> 'ERR:42501:PATIENT_DELETE_FOREIGN_CLINIC' then raise exception 'PDD01 T4 FAIL: %', r; end if;
  r := pg_temp.pdd_try(s.a_pat, s.pat_auth);  -- nem o próprio cadastro
  if r not like 'ERR:42501:%' then raise exception 'PDD01 T4 FAIL self: %', r; end if;
  raise notice 'PDD01 T4 PASSED';

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform public.delete_unused_patient_registration(p.pat);
    reset role;
    raise exception 'PDD01 T5 FAIL: anon executed';
  exception when insufficient_privilege then
    reset role;
  end;
  set local role anon;
  begin
    perform public.get_patient_deletion_eligibility(p.pat);
    reset role;
    raise exception 'PDD01 T5 FAIL: anon read eligibility';
  exception when insufficient_privilege then
    reset role;
  end;
  raise notice 'PDD01 T5 PASSED';

  r := pg_temp.pdd_try(s.a_pa, p.pat);
  if r <> 'ERR:42501:PATIENT_DELETE_FOREIGN_CLINIC' then raise exception 'PDD01 T6 FAIL: %', r; end if;
  raise notice 'PDD01 T6 PASSED';

  if not exists (select 1 from public.patients where id = p.pat) then raise exception 'PDD01 T2-T6 FAIL: patient gone'; end if;

  -- clínica suspensa (caminho oficial do platform admin): nem o admin exclui
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_pa::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.suspend_platform_clinic(s.c_a, 'teste PDD01 suspensao');
  reset role;
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'ERR:42501:CLINIC_NOT_OPERATIONAL' then raise exception 'PDD01 T2b FAIL suspended: %', r; end if;
  raise notice 'PDD01 T2b (clínica suspensa) PASSED';
end $$;
rollback;


-- T7..T9: identidade (Auth vinculado, Auth com mesmo e-mail, pending duplicado, e-mail Gmail canônico)
begin;
do $$
declare s record; p record; v_au uuid;
begin
  select * into s from pg_temp.pdd_seed();

  -- T7: auth_user_id presente (paciente com conta)
  perform pg_temp.pdd_expect_block(s.a_adm, s.pat_auth, 'PATIENT_DELETE_AUTH_LINKED', 'T7');
  raise notice 'PDD01 T7 PASSED';

  -- T8: auth.users com o mesmo e-mail normalizado (não confirmado => o trigger não claimou)
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'Same@PDD01.test');
  v_au := gen_random_uuid();
  perform pg_temp.pdd_ins_auth(v_au, '  same@pdd01.test ', 'email', false);
  if (select auth_user_id from public.profiles where id = p.pf) is not null then raise exception 'PDD01 T8 setup: claimed'; end if;
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_AUTH_EMAIL_CONFLICT', 'T8');
  raise notice 'PDD01 T8 PASSED';

  -- T9 (equivalente ao Alan): cadastro clínico COM ponto, Google autentica SEM ponto
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'al.mosena.pdd01@gmail.com');
  v_au := gen_random_uuid();
  perform pg_temp.pdd_ins_auth(v_au, 'almosenapdd01@gmail.com', 'google', true);
  -- identidade normal = igualdade EXATA: são diferentes
  if lower(btrim('al.mosena.pdd01@gmail.com')) = lower(btrim('almosenapdd01@gmail.com')) then
    raise exception 'PDD01 T9 FAIL: exact identity key collapsed';
  end if;
  -- login: NENHUM auto-link; nasce o pending separado (semântica de claim inalterada)
  if (select auth_user_id from public.profiles where id = p.pf) is not null then
    raise exception 'PDD01 T9 FAIL: clinical profile auto-linked (claim semantics changed)';
  end if;
  if (select count(*) from public.profiles where auth_user_id = v_au and status = 'pending'
        and lower(btrim(email)) = 'almosenapdd01@gmail.com') <> 1 then
    raise exception 'PDD01 T9 FAIL: pending duplicate not created as before';
  end if;
  if (select count(*) from public.patients where profile_id = p.pf) <> 1 then
    raise exception 'PDD01 T9 FAIL: clinical patient changed';
  end if;
  -- exclusão: possível identidade relacionada => NÃO elegível (conflito/ambiguidade)
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_AUTH_EMAIL_CONFLICT', 'T9a');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_AMBIGUOUS_IDENTITY', 'T9b');
  if (select auth_user_id from public.profiles where id = p.pf) is not null
     or not exists (select 1 from public.patients where id = p.pat) then
    raise exception 'PDD01 T9 FAIL: blocked delete linked or removed the clinical record';
  end if;

  -- T9c: outro profile (sem Auth) disputando o mesmo e-mail normalizado
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'twin@pdd01.test');
  insert into public.profiles (auth_user_id, role, full_name, email, status)
    values (null, 'patient', 'Gêmeo', ' TWIN@pdd01.test', 'active');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_AMBIGUOUS_IDENTITY', 'T9c');
  raise notice 'PDD01 T9 PASSED';
end $$;
rollback;


-- T10..T15: movimentação significativa bloqueia (uma categoria por cadastro)
begin;
do $$
declare s record; p record; v_ch uuid;
begin
  select * into s from pg_temp.pdd_seed();

  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't10@pdd01.test');
  insert into public.body_assessments (patient_id) values (p.pat);
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_CLINICAL_DATA', 'T10');
  raise notice 'PDD01 T10 PASSED';

  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't11a@pdd01.test');
  insert into public.weight_logs (patient_id, weight_kg) values (p.pat, 80);
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_CLINICAL_DATA', 'T11a');
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't11b@pdd01.test');
  insert into public.activity_events (patient_id, type) values (p.pat, 'activity_logged');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_ACTIVITY', 'T11b');
  raise notice 'PDD01 T11 PASSED';

  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't12@pdd01.test');
  insert into public.nutrition_plans (patient_id, title) values (p.pat, 'Plano');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_PLANS', 'T12');
  raise notice 'PDD01 T12 PASSED';

  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't13a@pdd01.test');
  insert into public.supplements (patient_id, name) values (p.pat, 'Creatina');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_PLANS', 'T13a');
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't13b@pdd01.test');
  insert into public.workout_plans (patient_id, title) values (p.pat, 'Treino');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_PLANS', 'T13b');
  raise notice 'PDD01 T13 PASSED';

  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't14a@pdd01.test');
  insert into public.patient_documents (patient_id, uploaded_by_role, file_path) values (p.pat, 'professional', 'x/y.pdf');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_DOCUMENTS', 'T14a');
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't14b@pdd01.test');
  insert into public.progress_photos (patient_id) values (p.pat);
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_DOCUMENTS', 'T14b');
  raise notice 'PDD01 T14 PASSED';

  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't15@pdd01.test');
  insert into public.chat_channels (patient_id) values (p.pat) returning id into v_ch;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (v_ch, s.pf_adm, 'professional', 'olá');
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_MESSAGES', 'T15');
  raise notice 'PDD01 T15 PASSED';

  -- vínculo alterado / equipe adicionada = atividade administrativa (não é mais scaffolding)
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't15b@pdd01.test');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    select pr.id, p.pat, false, 'active' from public.professionals pr
     where pr.clinic_id = s.c_a and pr.clinic_role = 'member';
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_ACTIVITY', 'T15b');
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't15c@pdd01.test');
  update public.professional_patient_links set status = 'inactive', status_changed_at = now() where patient_id = p.pat;
  perform pg_temp.pdd_expect_block(s.a_adm, p.pat, 'PATIENT_DELETE_HAS_ACTIVITY', 'T15c');
  raise notice 'PDD01 T15b/c (vínculo alterado) PASSED';
end $$;
rollback;


-- T16: scaffolding apenas (vínculo do create_patient + canal criado sob demanda, VAZIO) = EXCLUÍDO
begin;
do $$
declare s record; p record; r text; v_ch uuid; v_parts int; v_aud record;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't16@pdd01.test');

  -- abre o chat como o admin faria (RPC real: canal + roster)
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ch := public.get_or_create_channel(p.pat);
  reset role;
  select count(*) into v_parts from public.chat_participants where channel_id = v_ch;
  if v_parts < 1 then raise exception 'PDD01 T16 setup: roster vazio'; end if;

  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T16 FAIL: %', r; end if;
  if exists (select 1 from public.chat_channels where id = v_ch)
     or exists (select 1 from public.chat_participants where channel_id = v_ch) then
    raise exception 'PDD01 T16 FAIL: channel scaffolding left';
  end if;
  select * into v_aud from public.patient_registration_deletions where patient_id = p.pat;
  if v_aud.removed_links <> 1 or v_aud.removed_empty_channels <> 1 then
    raise exception 'PDD01 T16 FAIL audit: %', row_to_json(v_aud);
  end if;
  raise notice 'PDD01 T16 PASSED';
end $$;
rollback;


-- T17: correção cadastral (patient_registration_events) NÃO é movimentação; a trilha é PRESERVADA
begin;
do $$
declare s record; p record; r text; v_res jsonb;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't17-errado@pdd01.test');

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.update_patient_registration(p.pat, 'Nome Corrigido', 't17-certo@pdd01.test');
  reset role;
  if (select count(*) from public.patient_registration_events where patient_id = p.pat) <> 1 then
    raise exception 'PDD01 T17 setup: no registration event';
  end if;

  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T17 FAIL: %', r; end if;
  if (select count(*) from public.patient_registration_events where patient_id = p.pat and profile_id = p.pf) <> 1 then
    raise exception 'PDD01 T17 FAIL: registration audit not preserved';
  end if;
  if (select preserved_registration_events from public.patient_registration_deletions where patient_id = p.pat) <> 1 then
    raise exception 'PDD01 T17 FAIL: deletion audit count';
  end if;
  raise notice 'PDD01 T17 PASSED';
end $$;
rollback;


-- T18/T19: exclui exatamente uma vez; segunda chamada = PATIENT_NOT_FOUND determinístico, sem efeito
begin;
do $$
declare s record; p record; r text; e jsonb;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 't18@pdd01.test');
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T18 FAIL: %', r; end if;
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'ERR:P0002:PATIENT_NOT_FOUND' then raise exception 'PDD01 T19 FAIL: %', r; end if;
  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if e->>'error' <> 'P0002:PATIENT_NOT_FOUND' then raise exception 'PDD01 T19 FAIL elig: %', e; end if;
  if (select count(*) from public.patient_registration_deletions where patient_id = p.pat) <> 1 then
    raise exception 'PDD01 T18 FAIL: audit rows <> 1';
  end if;
  r := pg_temp.pdd_try(s.a_adm, null);
  if r <> 'ERR:P0002:PATIENT_NOT_FOUND' then raise exception 'PDD01 T19 FAIL null: %', r; end if;
  raise notice 'PDD01 T18/T19 PASSED';
end $$;
rollback;


-- T-GMAIL: a chave de risco NÃO torna todo Gmail inexcluível e NÃO colapsa outros domínios
begin;
do $$
declare s record; p record; r text; e jsonb; v_au uuid; v_auth0 text;
begin
  select * into s from pg_temp.pdd_seed();

  -- e-mail disponível (example.com), cadastro intocado => elegível e exclui
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'unused.patient@example.com');
  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if (e->>'eligible')::boolean is not true then raise exception 'PDD01 T-GMAIL avail FAIL: %', e; end if;
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T-GMAIL avail FAIL delete: %', r; end if;

  -- Gmail com ponto SEM identidade relacionada => elegível (Gmail não vira bloqueio geral)
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'maria.silva.pdd01@gmail.com');
  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if (e->>'eligible')::boolean is not true then raise exception 'PDD01 T-GMAIL free gmail FAIL: %', e; end if;
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T-GMAIL free gmail FAIL delete: %', r; end if;

  -- não-Gmail: john.smith x johnsmith são DIFERENTES (Auth confiável sem ponto não bloqueia, não vincula)
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'john.smith.pdd01@example.com');
  v_au := gen_random_uuid();
  perform pg_temp.pdd_ins_auth(v_au, 'johnsmith.pdd01@example.com', 'google', true);
  if (select auth_user_id from public.profiles where id = p.pf) is not null then
    raise exception 'PDD01 T-GMAIL FAIL: non-gmail auto-link';
  end if;
  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if (e->>'eligible')::boolean is not true then raise exception 'PDD01 T-GMAIL non-gmail collapsed: %', e; end if;

  -- Google Workspace (domínio próprio) e googlemail.com: NÃO colapsados
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'jo.ao.pdd01@clinica-workspace.com.br');
  perform pg_temp.pdd_ins_auth(gen_random_uuid(), 'joaopdd01@clinica-workspace.com.br', 'google', true);
  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if (e->>'eligible')::boolean is not true then raise exception 'PDD01 T-GMAIL workspace collapsed: %', e; end if;
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'b.c.pdd01@googlemail.com');
  perform pg_temp.pdd_ins_auth(gen_random_uuid(), 'bcpdd01@googlemail.com', 'google', true);
  e := pg_temp.pdd_elig(s.a_adm, p.pat);
  if (e->>'eligible')::boolean is not true then raise exception 'PDD01 T-GMAIL googlemail collapsed: %', e; end if;

  -- a exclusão não toca Auth
  v_auth0 := pg_temp.pdd_auth_hash();
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T-GMAIL googlemail delete: %', r; end if;
  if pg_temp.pdd_auth_hash() <> v_auth0 then raise exception 'PDD01 T-GMAIL FAIL: auth changed'; end if;
  raise notice 'PDD01 T-GMAIL (e-mail livre / gmail livre / não-gmail / workspace / googlemail) PASSED';
end $$;
rollback;


-- T-DIRECT (exige 20261010120100): DELETE/TRUNCATE direto pelo cliente NEGADO para todos os papéis;
-- a RPC canônica continua excluindo o MESMO cadastro elegível.
create or replace function pg_temp.pdd_direct(p_sub uuid, p_role text, p_sql text) returns text
language plpgsql
as $f$
declare v_state text; v_n int;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    reset role;
    return 'RAN:' || v_n;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    return 'ERR:' || v_state;
  end;
end;
$f$;

begin;
do $$
declare s record; p record; r text; v_auth0 text; v_who record;
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('patients', 'profiles')
              and permissive = 'PERMISSIVE' and cmd in ('DELETE', 'ALL')) then
    raise exception 'PDD01 T-DIRECT FAIL: client DELETE policy on patients/profiles';
  end if;

  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'direct.pdd01@example.com');
  v_auth0 := pg_temp.pdd_auth_hash();

  for v_who in
    select * from (values ('admin', s.a_adm, 'authenticated'), ('owner', s.a_own, 'authenticated'),
                          ('member', s.a_mem, 'authenticated'), ('patient', s.a_pat, 'authenticated'),
                          ('platform_admin', s.a_pa, 'authenticated'), ('anon', null::uuid, 'anon')) t(label, sub, role)
  loop
    r := pg_temp.pdd_direct(v_who.sub, v_who.role, format('delete from public.patients where id = %L', p.pat));
    if r <> 'ERR:42501' then raise exception 'PDD01 T-DIRECT FAIL: % direct DELETE => %', v_who.label, r; end if;
    r := pg_temp.pdd_direct(v_who.sub, v_who.role, 'truncate public.patients cascade');
    if r <> 'ERR:42501' then raise exception 'PDD01 T-DIRECT FAIL: % TRUNCATE => %', v_who.label, r; end if;
  end loop;
  if not exists (select 1 from public.patients where id = p.pat) then raise exception 'PDD01 T-DIRECT FAIL: patient gone'; end if;

  -- mesmo cadastro, caminho canônico: passa
  r := pg_temp.pdd_try(s.a_adm, p.pat);
  if r <> 'OK' then raise exception 'PDD01 T-DIRECT FAIL: RPC on eligible fixture => %', r; end if;
  if pg_temp.pdd_auth_hash() <> v_auth0 then raise exception 'PDD01 T-DIRECT FAIL: auth changed'; end if;
  raise notice 'PDD01 T-DIRECT (admin/owner/member/paciente/platform admin/anon negados; RPC exclui) PASSED';
end $$;
rollback;


-- T-CASCADE: cadastro com histórico clínico real. DELETE direto NEGADO; RPC NEGADA; nada muda.
-- (prova que a cascata catastrófica pré-existente não é mais alcançável por um admin)
create or replace function pg_temp.pdd_history_hash(p_pat uuid) returns text
language sql
as $f$
  select md5(concat_ws('#',
    (select count(*) from public.patients where id = p_pat),
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.profiles t
      where t.id = (select profile_id from public.patients where id = p_pat)),
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.weight_logs t where t.patient_id = p_pat),
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.body_assessments t where t.patient_id = p_pat),
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.nutrition_plans t where t.patient_id = p_pat),
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.supplements t where t.patient_id = p_pat),
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.professional_patient_links t where t.patient_id = p_pat),
    (select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from public.chat_messages m
      join public.chat_channels c on c.id = m.channel_id where c.patient_id = p_pat)
  ))
$f$;

begin;
do $$
declare s record; p record; r text; v_ch uuid; v_h0 text; v_auth0 text; v_bill0 text; v_target uuid;
begin
  select * into s from pg_temp.pdd_seed();
  select * into p from pg_temp.pdd_patient(s.c_a, s.pr_adm, 'history.pdd01@example.com');

  foreach v_target in array array[p.pat, s.pat_auth] loop   -- sem Auth e com Auth
    if v_target = s.pat_auth then
      insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
        values (s.pr_adm, v_target, false, 'active');
    end if;
    insert into public.weight_logs (patient_id, weight_kg) values (v_target, 82), (v_target, 81);
    insert into public.body_assessments (patient_id) values (v_target);
    insert into public.nutrition_plans (patient_id, title) values (v_target, 'Plano');
    insert into public.supplements (patient_id, name) values (v_target, 'Whey');
    insert into public.chat_channels (patient_id) values (v_target) returning id into v_ch;
    insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
      values (v_ch, s.pf_adm, 'professional', 'acompanhamento');

    v_h0 := pg_temp.pdd_history_hash(v_target);
    v_auth0 := pg_temp.pdd_auth_hash();
    v_bill0 := pg_temp.pdd_billing_hash();

    r := pg_temp.pdd_direct(s.a_adm, 'authenticated', format('delete from public.patients where id = %L', v_target));
    if r <> 'ERR:42501' then raise exception 'PDD01 T-CASCADE FAIL: direct DELETE => %', r; end if;

    r := pg_temp.pdd_try(s.a_adm, v_target);
    if v_target = s.pat_auth and r <> 'ERR:55000:PATIENT_DELETE_AUTH_LINKED' then
      raise exception 'PDD01 T-CASCADE FAIL: auth patient RPC => %', r;
    end if;
    if v_target = p.pat and r <> 'ERR:55000:PATIENT_DELETE_HAS_CLINICAL_DATA' then
      raise exception 'PDD01 T-CASCADE FAIL: history patient RPC => %', r;
    end if;

    if pg_temp.pdd_history_hash(v_target) <> v_h0 then raise exception 'PDD01 T-CASCADE FAIL: history changed'; end if;
    if pg_temp.pdd_auth_hash() <> v_auth0 then raise exception 'PDD01 T-CASCADE FAIL: auth changed'; end if;
    if pg_temp.pdd_billing_hash() <> v_bill0 then raise exception 'PDD01 T-CASCADE FAIL: billing changed'; end if;
  end loop;
  raise notice 'PDD01 T-CASCADE (histórico protegido de DELETE direto e da RPC) PASSED';
end $$;
rollback;
