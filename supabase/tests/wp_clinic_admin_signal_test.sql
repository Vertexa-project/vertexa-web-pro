-- =====================================================================================
-- WP-CLINIC-ADMIN-SIGNAL — TESTES de public.am_i_clinic_admin(uuid default null).
-- Login simulado via request.jwt.claims (sub = auth_user_id) + `set local role authenticated`.
-- Fixtures criadas como postgres (bypassrls); tudo em ROLLBACK — nada persiste.
-- Assume a função já aplicada no schema (igual ao teste A1). Para provar ANTES de aplicar,
-- rode o corpo da migration + este teste na MESMA transação (BEGIN/ROLLBACK).
--
-- PROVA CENTRAL: a autoridade vem de DONO/clinic_role — NUNCA de profiles.role. Por isso ownerA e
-- coadminA têm profiles.role='professional' (NÃO 'admin') e ainda assim retornam TRUE.
--
--   (P1) DONO da clínica (owner_profile_id, sem linha em professionals) ........ true (arg e null)
--   (P2) CO-ADMIN (professionals.clinic_role='admin') ......................... true (arg e null)
--   (N1) profissional COMUM (clinic_role='member') ............................ false (arg e null)
--   (N2) profissional de OUTRA clínica pergunta pela minha .................... false (alheia + null)
--   (G1) privilégios: anon NÃO executa; authenticated executa.
-- =====================================================================================

begin;
do $$
declare
  fails text := '';
  ownerA   uuid := gen_random_uuid();  auth_ownerA   uuid := gen_random_uuid();
  coadminA uuid := gen_random_uuid();  auth_coadminA uuid := gen_random_uuid();
  memberA  uuid := gen_random_uuid();  auth_memberA  uuid := gen_random_uuid();
  ownerB   uuid := gen_random_uuid();  auth_ownerB   uuid := gen_random_uuid();
  profB    uuid := gen_random_uuid();  auth_profB    uuid := gen_random_uuid();
  clinicA  uuid := gen_random_uuid();
  clinicB  uuid := gen_random_uuid();
  v_arg boolean; v_null boolean;
begin
  -- ── fixtures (postgres / bypassrls) ──────────────────────────────────────────────
  -- IMPORTANTE: role='professional' (NÃO 'admin') mesmo para os admins reais — prova que o sinal
  -- NÃO depende de profiles.role.
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (ownerA,   auth_ownerA,   'professional', 'Owner A',   'active'),
    (coadminA, auth_coadminA, 'professional', 'CoAdmin A', 'active'),
    (memberA,  auth_memberA,  'professional', 'Member A',  'active'),
    (ownerB,   auth_ownerB,   'professional', 'Owner B',   'active'),
    (profB,    auth_profB,    'professional', 'Prof B',    'active');
  insert into public.clinics (id, name, owner_profile_id) values
    (clinicA, 'Clinica A', ownerA),
    (clinicB, 'Clinica B', ownerB);
  -- ownerA é DONO puro (NÃO tem linha em professionals) → exercita o fallback de dono no p_clinic null.
  insert into public.professionals (profile_id, clinic_id, type, clinic_role) values
    (coadminA, clinicA, 'doctor',       'admin'),   -- co-admin
    (memberA,  clinicA, 'nutritionist', 'member'),  -- comum
    (profB,    clinicB, 'doctor',       'member');  -- comum, outra clínica

  -- ── P1: DONO ─────────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_ownerA::text)::text, true);
  set local role authenticated;
    select public.am_i_clinic_admin(clinicA) into v_arg;
    select public.am_i_clinic_admin()        into v_null;  -- null → dono resolve clinicA
  reset role;
  if v_arg  is not true then fails := fails || 'P1_owner_arg '; end if;
  if v_null is not true then fails := fails || 'P1_owner_null '; end if;

  -- ── P2: CO-ADMIN ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_coadminA::text)::text, true);
  set local role authenticated;
    select public.am_i_clinic_admin(clinicA) into v_arg;
    select public.am_i_clinic_admin()        into v_null;  -- null → professionals resolve clinicA
  reset role;
  if v_arg  is not true then fails := fails || 'P2_coadmin_arg '; end if;
  if v_null is not true then fails := fails || 'P2_coadmin_null '; end if;

  -- ── N1: profissional COMUM ───────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_memberA::text)::text, true);
  set local role authenticated;
    select public.am_i_clinic_admin(clinicA) into v_arg;
    select public.am_i_clinic_admin()        into v_null;
  reset role;
  if v_arg  is not false then fails := fails || 'N1_member_arg '; end if;
  if v_null is not false then fails := fails || 'N1_member_null '; end if;

  -- ── N2: profissional de OUTRA clínica ────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_profB::text)::text, true);
  set local role authenticated;
    select public.am_i_clinic_admin(clinicA) into v_arg;   -- clínica alheia
    select public.am_i_clinic_admin()        into v_null;  -- null → clinicB, member
  reset role;
  if v_arg  is not false then fails := fails || 'N2_foreign_arg '; end if;
  if v_null is not false then fails := fails || 'N2_foreign_null '; end if;

  -- ── G1: privilégios de EXECUTE ───────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.am_i_clinic_admin(uuid)', 'EXECUTE') then
    fails := fails || 'G1_anon_can_execute ';
  end if;
  if not has_function_privilege('authenticated', 'public.am_i_clinic_admin(uuid)', 'EXECUTE') then
    fails := fails || 'G1_authenticated_cannot_execute ';
  end if;

  if length(fails) > 0 then
    raise exception 'WP-CLINIC-ADMIN-SIGNAL am_i_clinic_admin FAIL: %', fails;
  else
    raise notice 'WP-CLINIC-ADMIN-SIGNAL am_i_clinic_admin: PASS (P1-P2 admin true, N1-N2 false, G1 grants ok)';
  end if;
end $$;
rollback;
