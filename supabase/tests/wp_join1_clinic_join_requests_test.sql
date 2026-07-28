-- =====================================================================================
-- WP-JOIN-1 — TESTES (Nível 1: request.jwt.claims + `set local role authenticated`, ROLLBACK).
-- Fixtures criadas como postgres (bypassrls); nada persiste.
--
-- POSITIVOS
--   (P1) pendente com código válido ⇒ pedido criado vinculado à CLÍNICA CERTA
--   (P2) o ADMIN DA CLÍNICA VÊ o pedido
--   (P3) approve ⇒ promove a professional (role/status + linha em professionals)
--   (P4) reject  ⇒ pedido 'rejected' e o profissional SEGUE pending, sem linha criada
--   (P5) rotate troca o código (e o antigo deixa de valer)
--   (P6) o solicitante vê o PRÓPRIO pedido
--
-- NEGATIVOS (obrigatórios)
--   (N1) ★ admin da clínica A NÃO vê pedido da clínica B      — isolamento central
--   (N2) admin de OUTRA clínica NÃO aprova nem rejeita pedido alheio
--   (N3) código inexistente ⇒ erro genérico (não revela existência de clínica)
--   (N4) segundo pedido 'pending' idêntico NÃO duplica (idempotência + índice único)
--   (N5) não-admin (member) NÃO aprova
--   (N6) anon (sem JWT) ⟂ tudo
--   (N7) autor NÃO forjável — o pedido sai no nome do CHAMADOR, não de quem ele indicar
--   (N8) INSERT/UPDATE direto nas tabelas ⟂ (só via RPC)
--   (N9) chamador que já é professional NÃO solicita
--   (N10) terceiro qualquer não vê pedido alheio
--
-- DENORMALIZAÇÃO DO SOLICITANTE (WP-JOIN-1b)
--   (D1) o pedido nasce com requester_name/requester_email do PRÓPRIO chamador
--   (D2) o admin da clínica LÊ nome+e-mail do pedido da SUA clínica
--   (D3) ★ o admin de OUTRA clínica NÃO lê nem a linha nem os campos novos
--   (D4) terceiro qualquer NÃO lê os campos novos
--   (D5) anon ⟂ (nem linha, nem campos)
--   (D6) o snapshot NÃO é forjável pelo client (sai do profile do chamador)
--   (D7) approve/reject seguem funcionando COM as colunas novas, e preservam o snapshot
--
-- REGRESSÃO
--   (R1) create_clinic_with_owner segue funcionando COM a coluna NOT NULL (o fluxo solo)
--   (R2) promote_to_professional intacta (hash conferido fora deste arquivo)
-- =====================================================================================

begin;
do $$
declare
  fails text := '';
  adminA uuid := gen_random_uuid();  auth_adminA uuid := gen_random_uuid();
  adminB uuid := gen_random_uuid();  auth_adminB uuid := gen_random_uuid();
  memberM uuid := gen_random_uuid(); auth_memberM uuid := gen_random_uuid();
  pend1 uuid := gen_random_uuid();   auth_pend1 uuid := gen_random_uuid();
  pend2 uuid := gen_random_uuid();   auth_pend2 uuid := gen_random_uuid();
  solo  uuid := gen_random_uuid();   auth_solo  uuid := gen_random_uuid();
  clinicA uuid := gen_random_uuid(); codeA text;
  clinicB uuid := gen_random_uuid(); codeB text;
  reqA uuid; reqA2 uuid; reqB uuid;
  v_cnt int; v_status text; v_role text; v_prof uuid; v_code text; v_cl uuid; v_json jsonb;
  v_rname text; v_remail text;
begin
  -- ── fixtures ───────────────────────────────────────────────────────────────────────
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (adminA, auth_adminA, 'professional', 'Admin A',   'a@t.test', 'active'),
    (adminB, auth_adminB, 'professional', 'Admin B',   'b@t.test', 'active'),
    (memberM,auth_memberM,'professional', 'Member M',  'm@t.test', 'active'),
    (pend1,  auth_pend1,  'patient',      'Pendente 1','p1@t.test','pending'),
    (pend2,  auth_pend2,  'patient',      'Pendente 2','p2@t.test','pending'),
    (solo,   auth_solo,   'patient',      'Solo',      's@t.test', 'pending');
  insert into public.clinics (id, name, owner_profile_id) values
    (clinicA, 'Clinica A', adminA),
    (clinicB, 'Clinica B', adminB);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role) values
    (memberM, clinicA, 'doctor', 'member');       -- membro NÃO-admin de A

  -- o DEFAULT gerou os códigos sozinho?
  select join_code into codeA from public.clinics where id = clinicA;
  select join_code into codeB from public.clinics where id = clinicB;
  if codeA is null or length(codeA) <> 8 then fails := fails || 'FIX_no_default_code '; end if;
  if codeA = codeB then fails := fails || 'FIX_codes_collided '; end if;
  if codeA ~ '[OI01]' then fails := fails || 'FIX_ambiguous_chars('||codeA||') '; end if;

  -- ── (N6) anon ⟂ tudo ───────────────────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeA);
    reset role; fails := fails || 'N6_anon_request_allowed ';
  exception when others then reset role;
    if sqlstate <> '42501' then fails := fails || 'N6_sqlstate('||sqlstate||') '; end if;
  end;

  -- ── (N3) código inexistente ⇒ erro genérico ────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access('ZZZZZZZZ');
    reset role; fails := fails || 'N3_bad_code_allowed ';
  exception when others then reset role;
    if sqlstate <> 'P0002' then fails := fails || 'N3_sqlstate('||sqlstate||') '; end if;
    -- a mensagem NÃO pode revelar existência/inexistência de clínica
    if sqlerrm ilike '%clinic%not%found%' or sqlerrm ilike '%does not exist%' then
      fails := fails || 'N3_message_leaks_clinic_existence ';
    end if;
  end;

  -- ── (P1) pendente com código válido ⇒ pedido na clínica CERTA ──────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
  set local role authenticated;
  reqA := public.request_clinic_access(codeA);
  reset role;
  if reqA is null then fails := fails || 'P1_null_return '; end if;
  select clinic_id, status, profile_id into v_cl, v_status, v_prof
    from public.clinic_join_requests where id = reqA;
  if v_cl is distinct from clinicA then fails := fails || 'P1_wrong_clinic '; end if;
  if v_status <> 'pending' then fails := fails || 'P1_status('||v_status||') '; end if;
  -- ── (N7) autor NÃO forjável: saiu no nome do CHAMADOR ──────────────────────────────
  if v_prof is distinct from pend1 then fails := fails || 'N7_author_forged '; end if;

  -- ── (D1)(D6) snapshot do solicitante gravado pelo SERVIDOR ─────────────────────────
  select count(*) into v_cnt from public.clinic_join_requests
   where id = reqA and requester_name = 'Pendente 1' and requester_email = 'p1@t.test';
  if v_cnt <> 1 then fails := fails || 'D1_snapshot_missing '; end if;
  -- não pode ter vindo de outro profile: confere contra o profile do CHAMADOR
  select count(*) into v_cnt from public.clinic_join_requests r
   join public.profiles p on p.id = r.profile_id
   where r.id = reqA and r.requester_name = p.full_name and r.requester_email = p.email;
  if v_cnt <> 1 then fails := fails || 'D6_snapshot_not_from_caller '; end if;

  -- ── (N4) segundo pedido idêntico NÃO duplica ───────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
  set local role authenticated;
  reqA2 := public.request_clinic_access(codeA);
  reset role;
  if reqA2 is distinct from reqA then fails := fails || 'N4_not_idempotent '; end if;
  select count(*) into v_cnt from public.clinic_join_requests
   where profile_id = pend1 and clinic_id = clinicA;
  if v_cnt <> 1 then fails := fails || 'N4_duplicated('||v_cnt||') '; end if;

  -- pedido na clínica B, para o teste de isolamento
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend2::text)::text, true);
  set local role authenticated;
  reqB := public.request_clinic_access(codeB);
  reset role;

  -- ══ (N1) ★ ADMIN DE A NÃO VÊ PEDIDO DE B — isolamento central ═════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = reqB;
  reset role;
  if v_cnt <> 0 then fails := fails || 'N1_CROSS_CLINIC_LEAK('||v_cnt||') '; end if;

  -- ══ (D3) ★ ADMIN DE A NÃO LÊ NOME/E-MAIL DO PEDIDO DE B ══════════════════════════
  -- Não basta a linha não aparecer: nenhum dos campos denormalizados pode vazar.
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests
   where requester_email = 'p2@t.test' or requester_name = 'Pendente 2';
  reset role;
  if v_cnt <> 0 then fails := fails || 'D3_CROSS_CLINIC_PII_LEAK('||v_cnt||') '; end if;

  -- ── (P2)(D2) o admin da clínica VÊ o pedido E o nome/e-mail do solicitante ─────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = reqA;
  select requester_name, requester_email into v_rname, v_remail
    from public.clinic_join_requests where id = reqA;
  reset role;
  if v_cnt <> 1 then fails := fails || 'P2_admin_blind_to_own_queue '; end if;
  if v_rname is distinct from 'Pendente 1' or v_remail is distinct from 'p1@t.test' then
    fails := fails || 'D2_admin_cannot_read_requester('||coalesce(v_rname,'NULL')||') ';
  end if;

  -- ── (P6) o solicitante vê o PRÓPRIO pedido ─────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = reqA;
  reset role;
  if v_cnt <> 1 then fails := fails || 'P6_own_request_invisible '; end if;

  -- ── (N10)(D4) terceiro qualquer não vê o pedido nem os campos novos ────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests where id = reqA;
  reset role;
  if v_cnt <> 0 then fails := fails || 'N10_third_party_leak('||v_cnt||') '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests
   where requester_email in ('p1@t.test','p2@t.test');
  reset role;
  if v_cnt <> 0 then fails := fails || 'D4_third_party_pii_leak('||v_cnt||') '; end if;

  -- ── (D5) anon ⟂ linha e campos ─────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.clinic_join_requests
   where requester_email is not null or id is not null;
  reset role;
  if v_cnt <> 0 then fails := fails || 'D5_anon_pii_leak('||v_cnt||') '; end if;

  -- ── (N8) INSERT / UPDATE direto ⟂ ──────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend2::text)::text, true);
    set local role authenticated;
    insert into public.clinic_join_requests (profile_id, clinic_id) values (pend2, clinicA);
    reset role; fails := fails || 'N8_direct_insert_allowed ';
  exception when others then reset role;
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
    set local role authenticated;
    update public.clinic_join_requests set status = 'approved' where id = reqA;
    reset role; fails := fails || 'N8b_direct_update_allowed ';
  exception when others then reset role;
  end;

  -- ── (N2) admin de OUTRA clínica não aprova nem rejeita ─────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminB::text)::text, true);
    set local role authenticated;
    perform public.approve_join_request(reqA);
    reset role; fails := fails || 'N2_cross_clinic_approved ';
  exception when others then reset role;
    if sqlstate <> '42501' then fails := fails || 'N2_sqlstate('||sqlstate||') '; end if;
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminB::text)::text, true);
    set local role authenticated;
    perform public.reject_join_request(reqA);
    reset role; fails := fails || 'N2b_cross_clinic_rejected ';
  exception when others then reset role;
    if sqlstate <> '42501' then fails := fails || 'N2b_sqlstate('||sqlstate||') '; end if;
  end;

  -- ── (N5) não-admin (member da própria clínica) não aprova ──────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
    set local role authenticated;
    perform public.approve_join_request(reqA);
    reset role; fails := fails || 'N5_member_approved ';
  exception when others then reset role;
    if sqlstate <> '42501' then fails := fails || 'N5_sqlstate('||sqlstate||') '; end if;
  end;

  -- nenhum negativo pode ter deixado efeito colateral
  select role::text, status into v_role, v_status from public.profiles where id = pend1;
  if v_role <> 'patient' or v_status <> 'pending' then
    fails := fails || 'NEG_side_effect('||v_role||','||v_status||') '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pend1;
  if v_cnt <> 0 then fails := fails || 'NEG_created_professional('||v_cnt||') '; end if;
  select status into v_status from public.clinic_join_requests where id = reqA;
  if v_status <> 'pending' then fails := fails || 'NEG_status_changed('||v_status||') '; end if;

  -- ── (P3) approve ⇒ promove ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  v_prof := public.approve_join_request(reqA);
  reset role;
  if v_prof is null then fails := fails || 'P3_null_professional '; end if;
  select role::text, status into v_role, v_status from public.profiles where id = pend1;
  if v_role <> 'professional' or v_status <> 'active' then
    fails := fails || 'P3_not_promoted('||v_role||','||v_status||') '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pend1 and clinic_id = clinicA;
  if v_cnt <> 1 then fails := fails || 'P3_professional_row('||v_cnt||') '; end if;
  select status into v_status from public.clinic_join_requests where id = reqA;
  if v_status <> 'approved' then fails := fails || 'P3_request_status('||v_status||') '; end if;
  select count(*) into v_cnt from public.clinic_join_requests
   where id = reqA and decided_by = adminA and decided_at is not null;
  if v_cnt <> 1 then fails := fails || 'P3_decided_by_missing '; end if;
  -- (D7) o snapshot SOBREVIVE à aprovação (é o registro de quem entrou e como)
  select requester_name, requester_email into v_rname, v_remail
    from public.clinic_join_requests where id = reqA;
  if v_rname is distinct from 'Pendente 1' or v_remail is distinct from 'p1@t.test' then
    fails := fails || 'D7_snapshot_lost_on_approve '; end if;

  -- aprovar de novo ⟂
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
    set local role authenticated;
    perform public.approve_join_request(reqA);
    reset role; fails := fails || 'P3b_reapprove_allowed ';
  exception when others then reset role;
    if sqlstate <> '22023' then fails := fails || 'P3b_sqlstate('||sqlstate||') '; end if;
  end;

  -- ── (N9) quem já é professional NÃO solicita ───────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_pend1::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeB);   -- pend1 agora é professional de A
    reset role; fails := fails || 'N9_active_could_request ';
  exception when others then reset role;
    if sqlstate <> '22023' then fails := fails || 'N9_sqlstate('||sqlstate||') '; end if;
  end;

  -- ── (P4) reject ⇒ segue pending, nada criado ───────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminB::text)::text, true);
  set local role authenticated;
  perform public.reject_join_request(reqB);
  reset role;
  select status into v_status from public.clinic_join_requests where id = reqB;
  if v_status <> 'rejected' then fails := fails || 'P4_status('||v_status||') '; end if;
  select role::text, status into v_role, v_status from public.profiles where id = pend2;
  if v_role <> 'patient' or v_status <> 'pending' then
    fails := fails || 'P4_profile_changed('||v_role||','||v_status||') '; end if;
  select count(*) into v_cnt from public.professionals where profile_id = pend2;
  if v_cnt <> 0 then fails := fails || 'P4_created_professional('||v_cnt||') '; end if;
  -- (D7) o snapshot SOBREVIVE à rejeição
  select requester_name, requester_email into v_rname, v_remail
    from public.clinic_join_requests where id = reqB;
  if v_rname is distinct from 'Pendente 2' or v_remail is distinct from 'p2@t.test' then
    fails := fails || 'D7b_snapshot_lost_on_reject '; end if;

  -- ── (P5) rotate ────────────────────────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_memberM::text)::text, true);
    set local role authenticated;
    perform public.rotate_clinic_join_code(clinicA);
    reset role; fails := fails || 'P5a_non_admin_rotated ';
  exception when others then reset role;
    if sqlstate <> '42501' then fails := fails || 'P5a_sqlstate('||sqlstate||') '; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', auth_adminA::text)::text, true);
  set local role authenticated;
  v_code := public.rotate_clinic_join_code(clinicA);
  reset role;
  if v_code is null or length(v_code) <> 8 then fails := fails || 'P5_bad_code '; end if;
  if v_code = codeA then fails := fails || 'P5_code_unchanged '; end if;
  -- o código antigo deixa de valer (mesmo erro neutro)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', auth_solo::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_access(codeA);
    reset role; fails := fails || 'P5b_old_code_still_valid ';
  exception when others then reset role;
    if sqlstate <> 'P0002' then fails := fails || 'P5b_sqlstate('||sqlstate||') '; end if;
  end;

  -- ── (R1) REGRESSÃO: create_clinic_with_owner segue funcionando com NOT NULL ────────
  perform set_config('request.jwt.claims', json_build_object('sub', auth_solo::text)::text, true);
  set local role authenticated;
  v_json := public.create_clinic_with_owner('Clinica Solo Regressao');
  reset role;
  if v_json is null or v_json->>'clinic_id' is null then fails := fails || 'R1_solo_flow_broken '; end if;
  select join_code into v_code from public.clinics where id = (v_json->>'clinic_id')::uuid;
  if v_code is null or length(v_code) <> 8 then fails := fails || 'R1_new_clinic_no_code '; end if;
  select role::text, status into v_role, v_status from public.profiles where id = solo;
  if v_role <> 'professional' or v_status <> 'active' then fails := fails || 'R1_owner_not_active '; end if;

  if length(fails) > 0 then
    raise exception 'WP-JOIN-1 FAIL: %', fails;
  else
    raise notice 'WP-JOIN-1: PASS (P1-P6, N1-N10, R1)';
  end if;
end $$;
rollback;
