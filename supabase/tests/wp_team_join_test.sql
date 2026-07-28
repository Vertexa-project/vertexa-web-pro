-- =====================================================================================
-- WP-TEAM-JOIN — TESTES de request_clinic_access / decide_join_request / RLS da fila.
-- Login simulado via request.jwt.claims (sub = auth_user_id) + `set local role authenticated`.
-- Fixtures criadas como postgres (bypassrls); tudo em ROLLBACK — nada persiste.
--
-- O TESTE QUE JUSTIFICA O WP INTEIRO é o (I1): admin da clínica A NÃO enxerga solicitação da
-- clínica B. Se ele falhar, o desenho falhou e não adianta seguir.
--
-- NEGATIVOS (os que importam):
--   (N1) código inexistente                                  ⇒ P0002
--   (N2) chamador NÃO pendente (já professional)             ⇒ 22023
--   (N3) sem JWT                                             ⇒ 42501
--   (N4) 4ª solicitação aberta (teto anti-spam)              ⇒ 22023
--   (N5) aprovar sem p_type                                  ⇒ 22023
--   (N6) NÃO-admin tenta decidir                             ⇒ 42501
--   (N7) decidir solicitação já decidida                     ⇒ 22023
--   (N8) INSERT direto na tabela como `authenticated`        ⇒ NEGADO
-- ISOLAMENTO (RLS):
--   (I1) admin da clínica A lê solicitação da clínica B      ⇒ ZERO linhas   ← núcleo do WP
--   (I2) solicitante lê a PRÓPRIA solicitação                ⇒ 1 linha
--   (I3) terceiro qualquer lê solicitação alheia             ⇒ ZERO linhas
-- POSITIVOS:
--   (P1) pendente com código válido                          ⇒ cria, status 'pending'
--   (P2) mesmo código de novo                                ⇒ MESMO id (idempotente), sem duplicar
--   (P3) admin aprova                                        ⇒ vira professional (role/status + linha)
--   (P4) admin rejeita                                       ⇒ 'rejected' e NENHUMA linha em professionals
-- =====================================================================================

begin;
do $$
declare
  fails text := '';
  -- profiles
  adminA uuid := gen_random_uuid();  auth_adminA uuid := gen_random_uuid();
  adminB uuid := gen_random_uuid();  auth_adminB uuid := gen_random_uuid();
  memberM uuid := gen_random_uuid(); auth_memberM uuid := gen_random_uuid();
  pend1 uuid := gen_random_uuid();   auth_pend1 uuid := gen_random_uuid();
  pend2 uuid := gen_random_uuid();   auth_pend2 uuid := gen_random_uuid();
  pend3 uuid := gen_random_uuid();   auth_pend3 uuid := gen_random_uuid();
  -- clinics
  clinicA uuid := gen_random_uuid(); codeA text;
  clinicB uuid := gen_random_uuid(); codeB text;
  clinicC uuid := gen_random_uuid(); codeC text;
  clinicD uuid := gen_random_uuid(); codeD text;
  -- trabalho
  req1 uuid; req1b uuid; req2 uuid; reqB uuid;
  v_cnt int; v_status text; v_role text; v_prof uuid; v_code text;
begin
  -- ── fixtures (postgres / bypassrls) ────────────────────────────────────────────────
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (adminA,  auth_adminA,  'professional', 'Admin A',   'adminA@t.test',  'active'),
    (adminB,  auth_adminB,  'professional', 'Admin B',   'adminB@t.test',  'active'),
    (memberM, auth_memberM, 'professional', 'Member M',  'memberM@t.test', 'active'),
    (pend1,   auth_pend1,   'patient',      'Pendente 1','pend1@t.test',   'pending'),
    (pend2,   auth_pend2,   'patient',      'Pendente 2','pend2@t.test',   'pending'),
    (pend3,   auth_pend3,   'patient',      'Pendente 3','pend3@t.test',   'pending');

  insert into public.clinics (id, name, owner_profile_id) values
    (clinicA, 'Clinica A', adminA),
    (clinicB, 'Clinica B', adminB),
    (clinicC, 'Clinica C', null),
    (clinicD, 'Clinica D', null);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role) values
    (memberM, clinicA, 'doctor', 'member');   -- membro NÃO-admin da clínica A

  -- o DEFAULT da coluna deve ter gerado os códigos sozinho
  select join_code into codeA from public.clinics where id = clinicA;
  select join_code into codeB from public.clinics where id = clinicB;
  select join_code into codeC from public.clinics where id = clinicC;
  select join_code into codeD from public.clinics where id = clinicD;
  if codeA is null or length(codeA) <> 8 then
    fails := fails || 'FIX_default_join_code(' || coalesce(codeA,'NULL') || ') ';
  end if;
  if codeA = codeB then fails := fails || 'FIX_codes_collided '; end if;

  -- ── (N1) código inexistente ⇒ P0002 ────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access('ZZZZZZZZ');
    reset role;
    fails := fails || 'N1_bad_code_not_denied ';
  exception when others then
    reset role;
    if sqlstate <> 'P0002' then fails := fails || 'N1_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- ── (N2) chamador NÃO pendente ⇒ 22023 ─────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeA);
    reset role;
    fails := fails || 'N2_non_pending_not_denied ';
  exception when others then
    reset role;
    if sqlstate <> '22023' then fails := fails || 'N2_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- ── (N3) sem JWT ⇒ 42501 ───────────────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeA);
    reset role;
    fails := fails || 'N3_anon_not_denied ';
  exception when others then
    reset role;
    if sqlstate <> '42501' then fails := fails || 'N3_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- ── (P1) pendente com código válido ⇒ cria ─────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
  set local role authenticated;
  req1 := public.request_clinic_access(codeA);
  reset role;
  if req1 is null then fails := fails || 'P1_null_return '; end if;
  select status, clinic_id::text into v_status, v_code from public.clinic_join_requests where id = req1;
  if v_status <> 'pending' then fails := fails || 'P1_status(' || v_status || ') '; end if;
  if v_code <> clinicA::text then fails := fails || 'P1_wrong_clinic '; end if;
  -- snapshot preenchido (é o que torna o pendente visível ao admin)
  select count(*) into v_cnt from public.clinic_join_requests
   where id = req1 and applicant_name = 'Pendente 1' and applicant_email = 'pend1@t.test'
     and clinic_name = 'Clinica A';
  if v_cnt <> 1 then fails := fails || 'P1_snapshot_missing '; end if;

  -- ── (P2) mesmo código de novo ⇒ MESMO id ───────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
  set local role authenticated;
  req1b := public.request_clinic_access(codeA);
  reset role;
  if req1b is distinct from req1 then fails := fails || 'P2_not_idempotent '; end if;
  select count(*) into v_cnt from public.clinic_join_requests
   where profile_id = pend1 and clinic_id = clinicA;
  if v_cnt <> 1 then fails := fails || 'P2_duplicated(' || v_cnt || ') '; end if;

  -- ── (N4) teto anti-spam: 3 abertas, a 4ª ⇒ 22023 ───────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend3::text)::text, true);
  set local role authenticated;
  perform public.request_clinic_access(codeA);
  perform public.request_clinic_access(codeB);
  perform public.request_clinic_access(codeC);
  reset role;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend3::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeD);
    reset role;
    fails := fails || 'N4_cap_not_enforced ';
  exception when others then
    reset role;
    if sqlstate <> '22023' then fails := fails || 'N4_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- solicitação da clínica B, usada no teste de isolamento
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend2::text)::text, true);
  set local role authenticated;
  reqB := public.request_clinic_access(codeB);
  reset role;

  -- ══ (I1) ADMIN DA CLÍNICA A NÃO VÊ SOLICITAÇÃO DA CLÍNICA B ═══════════════════════
  -- Este é o teste que justifica o WP. Se passar, o desenho entrega o isolamento prometido.
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = reqB;
  reset role;
  if v_cnt <> 0 then fails := fails || 'I1_CROSS_CLINIC_LEAK(' || v_cnt || ') '; end if;

  -- o mesmo admin DEVE ver a fila da própria clínica
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where clinic_id = clinicA;
  reset role;
  if v_cnt < 1 then fails := fails || 'I1b_admin_cannot_see_own_queue '; end if;

  -- ── (I2) solicitante lê a PRÓPRIA solicitação ⇒ 1 linha ────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = req1;
  reset role;
  if v_cnt <> 1 then fails := fails || 'I2_own_request_invisible(' || v_cnt || ') '; end if;

  -- ── (I3) terceiro qualquer lê solicitação alheia ⇒ ZERO ────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = req1;
  reset role;
  if v_cnt <> 0 then fails := fails || 'I3_third_party_leak(' || v_cnt || ') '; end if;

  -- ── (N8) INSERT direto como authenticated ⇒ NEGADO ─────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend2::text)::text, true);
    set local role authenticated;
    insert into public.clinic_join_requests (profile_id, clinic_id) values (pend2, clinicA);
    reset role;
    fails := fails || 'N8_direct_insert_allowed ';
  exception when others then
    reset role; -- esperado: negado (revoke + sem policy de INSERT)
  end;

  -- ── (N6) NÃO-admin tenta decidir ⇒ 42501 ───────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
    set local role authenticated;
    perform public.decide_join_request(req1, true, 'doctor');
    reset role;
    fails := fails || 'N6_non_admin_decided ';
  exception when others then
    reset role;
    if sqlstate <> '42501' then fails := fails || 'N6_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- admin da clínica B tentando decidir solicitação da clínica A ⇒ 42501 (clínica alheia)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminB::text)::text, true);
    set local role authenticated;
    perform public.decide_join_request(req1, true, 'doctor');
    reset role;
    fails := fails || 'N6b_cross_clinic_decided ';
  exception when others then
    reset role;
    if sqlstate <> '42501' then fails := fails || 'N6b_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- ── (N5) aprovar sem p_type ⇒ 22023 ────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
    set local role authenticated;
    perform public.decide_join_request(req1, true, null);
    reset role;
    fails := fails || 'N5_null_type_accepted ';
  exception when others then
    reset role;
    if sqlstate <> '22023' then fails := fails || 'N5_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- nenhum negativo pode ter deixado efeito colateral
  select role::text, status into v_role, v_status from public.profiles where id = pend1;
  if v_role <> 'patient' or v_status <> 'pending' then
    fails := fails || 'NEG_side_effect(role=' || v_role || ',status=' || v_status || ') ';
  end if;

  -- ── (P3) admin aprova ⇒ vira professional ──────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  v_prof := public.decide_join_request(req1, true, 'nutritionist', 'member', 'CRN-123', 'Esportiva');
  reset role;
  if v_prof is null then fails := fails || 'P3_null_professional '; end if;
  select role::text, status into v_role, v_status from public.profiles where id = pend1;
  if v_role <> 'professional' or v_status <> 'active' then
    fails := fails || 'P3_profile_not_promoted(role=' || v_role || ',status=' || v_status || ') ';
  end if;
  select count(*) into v_cnt from public.professionals
   where profile_id = pend1 and clinic_id = clinicA and type = 'nutritionist' and clinic_role = 'member';
  if v_cnt <> 1 then fails := fails || 'P3_professional_row(' || v_cnt || ') '; end if;
  select status into v_status from public.clinic_join_requests where id = req1;
  if v_status <> 'approved' then fails := fails || 'P3_request_status(' || v_status || ') '; end if;
  select count(*) into v_cnt from public.clinic_join_requests
   where id = req1 and decided_by = adminA and decided_at is not null;
  if v_cnt <> 1 then fails := fails || 'P3_decided_by_missing '; end if;

  -- ── (N7) decidir solicitação já decidida ⇒ 22023 ───────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
    set local role authenticated;
    perform public.decide_join_request(req1, true, 'doctor');
    reset role;
    fails := fails || 'N7_redecide_allowed ';
  exception when others then
    reset role;
    if sqlstate <> '22023' then fails := fails || 'N7_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  -- ── (P4) admin rejeita ⇒ 'rejected' e NENHUMA linha em professionals ───────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminB::text)::text, true);
  set local role authenticated;
  v_prof := public.decide_join_request(reqB, false);
  reset role;
  if v_prof is not null then fails := fails || 'P4_returned_professional '; end if;
  select status into v_status from public.clinic_join_requests where id = reqB;
  if v_status <> 'rejected' then fails := fails || 'P4_status(' || v_status || ') '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pend2;
  if v_cnt <> 0 then fails := fails || 'P4_created_professional(' || v_cnt || ') '; end if;
  select role::text, status into v_role, v_status from public.profiles where id = pend2;
  if v_role <> 'patient' or v_status <> 'pending' then
    fails := fails || 'P4_profile_changed(role=' || v_role || ',status=' || v_status || ') ';
  end if;

  -- ── rotação do código: só admin ────────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
    set local role authenticated;
    perform public.rotate_clinic_join_code(clinicA);
    reset role;
    fails := fails || 'R1_non_admin_rotated ';
  exception when others then
    reset role;
    if sqlstate <> '42501' then fails := fails || 'R1_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  v_code := public.rotate_clinic_join_code(clinicA);
  reset role;
  if v_code is null or length(v_code) <> 8 then fails := fails || 'R2_bad_new_code '; end if;
  if v_code = codeA then fails := fails || 'R2_code_unchanged '; end if;
  -- o código antigo deixa de valer
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend2::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeA);
    reset role;
    fails := fails || 'R3_old_code_still_valid ';
  exception when others then
    reset role;
    if sqlstate <> 'P0002' then fails := fails || 'R3_wrong_sqlstate(' || sqlstate || ') '; end if;
  end;

  if length(fails) > 0 then
    raise exception 'WP-TEAM-JOIN FAIL: %', fails;
  else
    raise notice 'WP-TEAM-JOIN: PASS (N1-N8 negados, I1-I3 isolados, P1-P4 ok, rotacao ok)';
  end if;
end $$;
rollback;
