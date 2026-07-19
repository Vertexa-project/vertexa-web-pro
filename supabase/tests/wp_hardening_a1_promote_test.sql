-- =====================================================================================
-- WP-HARDENING · A1 (AUTH-4) — TESTES da RPC promote_to_professional.
-- Login simulado via request.jwt.claims (sub = auth_user_id) + `set local role authenticated`.
-- Fixtures criadas como postgres (bypassrls); tudo em ROLLBACK — nada persiste.
--
-- NEGATIVOS OBRIGATÓRIOS:
--   (N1) profissional NÃO-admin (member) tenta promover        ⇒ NEGADO
--   (N2) admin de OUTRA clínica tenta promover para a minha     ⇒ NEGADO (clínica alheia)
--   (N3) admin tenta se AUTO-promover                           ⇒ NEGADO (self)
--   (N4) usuário PENDENTE tenta se auto-promover                ⇒ NEGADO (não-admin)
-- POSITIVOS:
--   (P1) admin da clínica promove pending da SUA clínica        ⇒ vira professional (role/status + linha)
--   (P2) idempotência: 2ª chamada retorna o mesmo id, sem duplicar
--   (P3) visibilidade: o promovido passa a ser staff da clínica (is_clinic_staff = true)
-- =====================================================================================

begin;
do $$
declare
  fails text := '';
  -- profiles (UUIDs aleatórios: teste roda em ROLLBACK; evita colisão com dados reais)
  adminA uuid := gen_random_uuid();   auth_adminA uuid := gen_random_uuid();
  adminB uuid := gen_random_uuid();   auth_adminB uuid := gen_random_uuid();
  memberM uuid := gen_random_uuid();  auth_memberM uuid := gen_random_uuid();
  pendingP uuid := gen_random_uuid(); auth_pendingP uuid := gen_random_uuid();
  -- clinics
  clinicA uuid := gen_random_uuid();
  clinicB uuid := gen_random_uuid();
  v_ret uuid;
  v_id2 uuid;
  v_cnt int;
  v_role text; v_status text; v_staff boolean;
begin
  -- ── fixtures (postgres / bypassrls) ──────────────────────────────────────────────
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (adminA,   auth_adminA,   'professional', 'Admin A',   'active'),
    (adminB,   auth_adminB,   'professional', 'Admin B',   'active'),
    (memberM,  auth_memberM,  'professional', 'Member M',  'active'),
    (pendingP, auth_pendingP, 'patient',      'Pending P', 'pending');
  insert into public.clinics (id, name, owner_profile_id) values
    (clinicA, 'Clinica A', adminA),
    (clinicB, 'Clinica B', adminB);
  -- membro NÃO-admin da clínica A
  insert into public.professionals (profile_id, clinic_id, type, clinic_role) values
    (memberM, clinicA, 'doctor', 'member');

  -- ── (N1) member (não-admin) promove ⇒ NEGADO ────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
    set local role authenticated;
    perform public.promote_to_professional(pendingP, clinicA, 'doctor');
    reset role;
    fails := fails || 'N1_member_not_denied ';
  exception when others then
    reset role; -- esperado: negado
  end;

  -- ── (N2) admin de OUTRA clínica promove p/ clínica A ⇒ NEGADO ─────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminB::text)::text, true);
    set local role authenticated;
    perform public.promote_to_professional(pendingP, clinicA, 'doctor');
    reset role;
    fails := fails || 'N2_cross_clinic_not_denied ';
  exception when others then
    reset role; -- esperado: negado (is_clinic_admin(A) falso p/ adminB)
  end;

  -- ── (N3) admin tenta se AUTO-promover ⇒ NEGADO ───────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
    set local role authenticated;
    perform public.promote_to_professional(adminA, clinicA, 'doctor');
    reset role;
    fails := fails || 'N3_self_admin_not_denied ';
  exception when others then
    reset role; -- esperado: negado (self)
  end;

  -- ── (N4) usuário PENDENTE tenta se auto-promover ⇒ NEGADO ─────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pendingP::text)::text, true);
    set local role authenticated;
    perform public.promote_to_professional(pendingP, clinicA, 'doctor');
    reset role;
    fails := fails || 'N4_pending_self_not_denied ';
  exception when others then
    reset role; -- esperado: negado (não-admin)
  end;

  -- garante que NENHUM negativo teve efeito colateral (pendingP ainda pending, sem linha professional)
  select role::text, status into v_role, v_status from public.profiles where id = pendingP;
  if v_role <> 'patient' or v_status <> 'pending' then fails := fails || 'NEG_side_effect(role='||v_role||',status='||v_status||') '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pendingP;
  if v_cnt <> 0 then fails := fails || 'NEG_created_professional('||v_cnt||') '; end if;

  -- ── (P1) admin da clínica promove pending da SUA clínica ⇒ SUCESSO ────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  v_ret := public.promote_to_professional(pendingP, clinicA, 'doctor');
  reset role;
  if v_ret is null then fails := fails || 'P1_null_return '; end if;
  select role::text, status into v_role, v_status from public.profiles where id = pendingP;
  if v_role <> 'professional' or v_status <> 'active' then fails := fails || 'P1_profile_not_promoted(role='||v_role||',status='||v_status||') '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pendingP and clinic_id = clinicA and type = 'doctor';
  if v_cnt <> 1 then fails := fails || 'P1_professional_row('||v_cnt||') '; end if;

  -- ── (P2) idempotência: 2ª chamada = mesmo id, sem duplicar ────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  v_id2 := public.promote_to_professional(pendingP, clinicA, 'doctor');
  reset role;
  if v_id2 is distinct from v_ret then fails := fails || 'P2_not_idempotent '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pendingP and clinic_id = clinicA;
  if v_cnt <> 1 then fails := fails || 'P2_duplicated('||v_cnt||') '; end if;

  -- ── (P3) visibilidade: o promovido é staff da clínica ─────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pendingP::text)::text, true);
  set local role authenticated;
  select private.is_clinic_staff(clinicA) into v_staff;
  reset role;
  if v_staff is not true then fails := fails || 'P3_not_staff '; end if;

  if length(fails) > 0 then
    raise exception 'WP-HARDENING A1 promote_to_professional FAIL: %', fails;
  else
    raise notice 'WP-HARDENING A1 promote_to_professional: PASS (N1-N4 denied, P1-P3 ok)';
  end if;
end $$;
rollback;
