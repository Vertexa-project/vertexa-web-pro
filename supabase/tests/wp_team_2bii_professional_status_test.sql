-- =====================================================================================
-- WP-TEAM-2b-ii — TESTES (Nível 1: request.jwt.claims + `set local role`, ROLLBACK).
-- Fixtures criadas como postgres (bypassrls); nada persiste. Exige a migration
-- 20260808090000 APLICADA (ou executada antes deste arquivo na MESMA transação).
--
-- OS 8 ATORES (o mesmo elenco da matriz do PR):
--   A1 o alvo (member) · A2 colega ativo (member) · A3 admin NÃO-dono · A4 o DONO ·
--   A5 a paciente vinculada · A6 profissional com vínculo EXTERNO · A7 outra clínica · A8 anon
--
-- POSITIVOS
--   (P1) admin desativa: status/trilha/autor do servidor
--   (P2) CASCATA — todos os vínculos ativos caem, com prefixo de causa na trilha do vínculo
--   (P3) roster do chat reconciliado (a dívida V7, agora pela desativação da PESSOA)
--   (P4) idempotência: desativar 2x não erra e não duplica trilha
--   (P5) reativar a PESSOA devolve o poder na clínica e NÃO religa vínculo (assimetria)
--   (P6) reativar PESSOA + VÍNCULO devolve o conjunto de antes (menos a escrita no chat, que
--        depende do roster — assimetria HERDADA do 2b-i, ver nota em N9)
--   (P7) my_clinic_memberships: o desativado enxerga clínica+nome+o PRÓPRIO status
--   (P8) promote_to_professional: linha ATIVA continua deduplicando (caminho inalterado)
--
-- NEGATIVOS (obrigatórios)
--   (N1) ★ o DONO não pode ser desativado (L2), nem por ele mesmo
--   (N2) ★ ninguém se autodesativa
--   (N3) ★ o desativado NÃO lê `clinics` e portanto NÃO lê o JOIN_CODE — asserção NOMEADA,
--        não consequência presumida
--   (N4) ★ o desativado NÃO lê journey_columns
--   (N5) ★ TRANCA DUPLA: vínculo religado na força (fora da RPC) NÃO devolve acesso, porque o
--        helper exige a PESSOA ativa
--   (N6) ★ UNIQUE (profile_id, clinic_id) fecha a premissa "um profissional = uma linha"
--   (N7) o desativado perde o próprio report_export pelo ramo de AUTORIA; o ADMIN continua lendo
--   (N8) trilha da PESSOA é lida SÓ pelo admin (nem o desativado, nem o colega ativo)
--   (N9) approve_join_request de quem tem cadastro DESATIVADO falha e a solicitação FICA pendente
--   (N10) my_clinic_memberships: não vaza status de terceiro, nem outra clínica, nem join_code;
--         fail-closed sem profile; anon NEGADO
--   (N11) `status` não é escrito por UPDATE direto do client (privilégio de coluna)
--   (N12) DELETE de professionals não existe mais para authenticated (item 6)
--
-- IDENTIDADE (a L1)
--   (I1) o ADMIN e o DONO continuam vendo profile, linha de professionals e disciplinas de A1
--   (I2) channel_professionals com false = resultado IDÊNTICO ao anterior; com true traz o AUTOR
--        que saiu do roster
--   (I3) ⚠️ LIMITE CONHECIDO E DECLARADO, NÃO É BUG DESTE ARQUIVO: a PACIENTE deixa de ver o
--        profile (o NOME) de A1, porque o ramo R4 de private.can_see_profile exige VÍNCULO
--        ATIVO e a cascata derruba o vínculo. can_see_profile NÃO foi tocada (hash provado no
--        PR) — o comportamento é herdado do 2b-i, onde desativar UM vínculo já fazia isso para
--        aquela paciente. O teste FIXA esse comportamento para que uma mudança futura seja
--        deliberada, e a decisão está registrada como DÍVIDA-2bii-4 em docs/PENDENCIAS.md.
-- =====================================================================================

begin;
do $$
declare
  fails text := '';
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  p_own uuid := gen_random_uuid(); a_own uuid := gen_random_uuid();
  p_adm uuid := gen_random_uuid(); a_adm uuid := gen_random_uuid();
  p_a1  uuid := gen_random_uuid(); a_a1  uuid := gen_random_uuid();
  p_a2  uuid := gen_random_uuid(); a_a2  uuid := gen_random_uuid();
  p_ext uuid := gen_random_uuid(); a_ext uuid := gen_random_uuid();
  p_oth uuid := gen_random_uuid(); a_oth uuid := gen_random_uuid();
  p_pat uuid := gen_random_uuid(); a_pat uuid := gen_random_uuid();
  p_pend uuid := gen_random_uuid(); a_pend uuid := gen_random_uuid();
  p_act uuid := gen_random_uuid();  a_act uuid := gen_random_uuid();
  a_orfao uuid := gen_random_uuid();
  prof_own uuid; prof_adm uuid; prof_a1 uuid; prof_a2 uuid; prof_ext uuid; prof_oth uuid;
  pat1 uuid; link_a1 uuid; link_a2 uuid; link_ext uuid; ch1 uuid := gen_random_uuid();
  jc1 uuid; re1 uuid;
  req1 uuid := gen_random_uuid(); req2 uuid := gen_random_uuid();
  req3 uuid := gen_random_uuid(); req4 uuid := gen_random_uuid();
  v_n int; v_txt text; v_code text; v_state text; v_hint text;
  v_prof_novo uuid; v_prof_act uuid; v_ret uuid;
  v_old text; v_new text; v_true text;
begin
  -- ── fixtures ───────────────────────────────────────────────────────────────────────
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (p_own, a_own,'professional','Zulmira Dona',   'own@t2bii.test','active'),
    (p_adm, a_adm,'professional','Adalberto Admin','adm@t2bii.test','active'),
    (p_a1,  a_a1, 'professional','Alvo A1',        'a1@t2bii.test', 'active'),
    (p_a2,  a_a2, 'professional','Beatriz A2',     'a2@t2bii.test', 'active'),
    (p_ext, a_ext,'professional','Externo Ext',    'ext@t2bii.test','active'),
    (p_oth, a_oth,'professional','Outro Oth',      'oth@t2bii.test','active'),
    (p_pat, a_pat,'patient',     'Paciente Pat',   'pat@t2bii.test','active'),
    (p_pend,a_pend,'patient',    'Pendente Novo',  'pn@t2bii.test', 'pending'),
    (p_act, a_act, 'patient',    'Pendente Ativo', 'pa@t2bii.test', 'pending');
  insert into public.clinics (id, name, owner_profile_id) values (c1,'Teste 2bii Alfa',p_own),(c2,'Teste 2bii Beta',p_oth);
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_own,c1,'other','admin')           returning id into prof_own;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_adm,c1,'doctor','admin')          returning id into prof_adm;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_a1, c1,'nutritionist','member')   returning id into prof_a1;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_a2, c1,'personal_trainer','member') returning id into prof_a2;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_ext,c1,'physiotherapist','member') returning id into prof_ext;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_oth,c2,'other','admin')           returning id into prof_oth;
  insert into public.professional_disciplines (professional_id, discipline) values (prof_a1,'nutricionista'),(prof_a2,'educador_fisico');
  insert into public.patients (profile_id, clinic_id, goal) values (p_pat, c1,'meta') returning id into pat1;
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (prof_a1,pat1,false,'active') returning id into link_a1;
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (prof_a2,pat1,false,'active') returning id into link_a2;
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (prof_ext,pat1,true,'active') returning id into link_ext;
  insert into public.chat_channels (id, patient_id) values (ch1, pat1);
  insert into public.chat_participants (channel_id,profile_id,role) values (ch1,p_a1,'professional'),(ch1,p_a2,'professional'),(ch1,p_pat,'patient');
  insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body) values
    (ch1,p_a1,'professional','mensagem do A1 — o nome dela precisa sobreviver ao roster'),
    (ch1,p_a2,'professional','mensagem do A2');
  insert into public.journey_columns (clinic_id,name,position) values (c1,'Coluna 2bii',1) returning id into jc1;
  insert into public.report_exports (exported_by_profile_id,patient_id,clinic_id,period_from,period_to,sections)
    values (p_a1,pat1,c1,current_date-30,current_date,array['resumo']) returning id into re1;
  select c.join_code into v_code from public.clinics c where c.id = c1;

  -- ── (N6) UNIQUE (profile_id, clinic_id) ────────────────────────────────────────────
  begin
    insert into public.professionals(profile_id,clinic_id,type) values (p_a1,c1,'other');
    fails := fails || 'N6_unique_nao_barrou ';
  exception when unique_violation then null;
  end;

  -- ── (N1) o DONO não pode ser desativado ────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.deactivate_professional(prof_own,'tentativa');
    reset role; fails := fails || 'N1_admin_desativou_o_dono ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    reset role;
    if v_state <> '42501' or v_hint <> 'OWNER_CANNOT_BE_DEACTIVATED' then fails := fails || 'N1_errcode('||v_state||'/'||coalesce(v_hint,'-')||') '; end if;
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_own,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.deactivate_professional(prof_own,'tentativa');
    reset role; fails := fails || 'N1b_dono_se_desativou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'N1b_errcode('||v_state||') '; end if;
  end;

  -- ── (N2) sem autodesativação ───────────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.deactivate_professional(prof_adm,'tentativa');
    reset role; fails := fails || 'N2_autodesativacao_passou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    reset role;
    if v_state <> '42501' or v_hint <> 'SELF_DEACTIVATION_NOT_ALLOWED' then fails := fails || 'N2_errcode('||v_state||'/'||coalesce(v_hint,'-')||') '; end if;
  end;

  -- ── não-admin não desativa ninguém ─────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_a2,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.deactivate_professional(prof_a1,'tentativa');
    reset role; fails := fails || 'colega_desativou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'colega_errcode('||v_state||') '; end if;
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_oth,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.deactivate_professional(prof_a1,'tentativa');
    reset role; fails := fails || 'outra_clinica_desativou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'outra_clinica_errcode('||v_state||') '; end if;
  end;

  -- ── (P1)(P2)(P3) a desativação em si ───────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  v_ret := public.deactivate_professional(prof_a1,'saiu da clinica');
  reset role;
  if v_ret is distinct from prof_a1 then fails := fails || 'P1_retorno '; end if;

  select 'st='||pr.status||' by='||(pr.status_changed_by = p_adm)::text||' rz='||coalesce(pr.status_reason,'-')
    into v_txt from public.professionals pr where pr.id = prof_a1;
  if v_txt <> 'st=inactive by=true rz=saiu da clinica' then fails := fails || 'P1_estado('||v_txt||') '; end if;

  select count(*) into v_n from public.professional_status_events
   where professional_id = prof_a1 and to_status='inactive' and from_status='active' and changed_by = p_adm;
  if v_n <> 1 then fails := fails || 'P1_trilha('||v_n::text||') '; end if;

  select count(*) into v_n from public.professional_patient_links
   where professional_id = prof_a1 and coalesce(status,'active')='active';
  if v_n <> 0 then fails := fails || 'P2_vinculos_ativos('||v_n::text||') '; end if;

  select count(*) into v_n from public.ppl_status_events
   where professional_id = prof_a1 and reason like '[DESATIVACAO_DO_PROFISSIONAL]%';
  if v_n <> 1 then fails := fails || 'P2_causa_na_trilha('||v_n::text||') '; end if;

  select count(*) into v_n from public.chat_participants cp join public.chat_channels cc on cc.id = cp.channel_id
   where cc.patient_id = pat1 and cp.profile_id = p_a1 and cp.role='professional';
  if v_n <> 0 then fails := fails || 'P3_roster('||v_n::text||') '; end if;
  select count(*) into v_n from public.chat_participants where channel_id = ch1;
  if v_n <> 2 then fails := fails || 'P3_roster_dos_outros('||v_n::text||') '; end if;   -- A2 e a paciente ficam

  -- vínculo de A2 intacto (a cascata é SÓ do desativado)
  select coalesce(status,'active') into v_txt from public.professional_patient_links where id = link_a2;
  if v_txt <> 'active' then fails := fails || 'cascata_vazou_para_A2 '; end if;

  -- ── (P4) idempotência ──────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.deactivate_professional(prof_a1,'de novo');
  reset role;
  select count(*) into v_n from public.professional_status_events where professional_id = prof_a1;
  if v_n <> 1 then fails := fails || 'P4_trilha_duplicada('||v_n::text||') '; end if;

  -- ── O CORTE, ator por ator ─────────────────────────────────────────────────────────
  -- A1 perde o eixo da paciente e o da clínica
  perform set_config('request.jwt.claims', json_build_object('sub',a_a1,'role','authenticated')::text, true);
  set local role authenticated;
  if private.is_common_professional_of_patient(pat1) then fails := fails || 'A1_ainda_is_common '; end if;
  if private.can_access_patient(pat1)               then fails := fails || 'A1_ainda_can_access '; end if;
  if private.can_prescribe_for_patient(pat1)        then fails := fails || 'A1_ainda_prescreve '; end if;
  if private.can_read_channel(ch1)                  then fails := fails || 'A1_ainda_le_canal '; end if;
  if private.owns_professional(prof_a1)             then fails := fails || 'A1_ainda_owns '; end if;
  if private.is_clinic_staff(c1)                    then fails := fails || 'A1_ainda_staff '; end if;
  if private.is_clinic_member(c1)                   then fails := fails || 'A1_ainda_member '; end if;
  select count(*) into v_n from public.patients where id = pat1;
  if v_n <> 0 then fails := fails || 'A1_ve_paciente('||v_n::text||') '; end if;
  -- (N3) ★ JOIN_CODE — asserção NOMEADA
  select count(*) into v_n from public.clinics where id = c1;
  if v_n <> 0 then fails := fails || 'N3_A1_ve_clinics('||v_n::text||') '; end if;
  select count(*) into v_n from public.clinics where id = c1 and join_code = v_code;
  if v_n <> 0 then fails := fails || 'N3_A1_LE_O_JOIN_CODE('||v_n::text||') '; end if;
  -- (N4) journey_columns
  select count(*) into v_n from public.journey_columns where clinic_id = c1;
  if v_n <> 0 then fails := fails || 'N4_A1_ve_journey_columns('||v_n::text||') '; end if;
  -- (N7) report_export próprio cai pelo ramo de autoria
  select count(*) into v_n from public.report_exports where id = re1;
  if v_n <> 0 then fails := fails || 'N7_A1_ve_proprio_export('||v_n::text||') '; end if;
  -- (N8) não lê a trilha da própria desativação
  select count(*) into v_n from public.professional_status_events where clinic_id = c1;
  if v_n <> 0 then fails := fails || 'N8_A1_le_trilha('||v_n::text||') '; end if;
  -- (N11) status não muda por UPDATE direto
  begin
    update public.professionals set status='active' where id = prof_a1;
    fails := fails || 'N11_update_direto_passou ';
  exception when insufficient_privilege then null;
  end;
  -- (P7) mas ENXERGA a própria situação pela RPC estreita
  select count(*) into v_n from public.my_clinic_memberships();
  select string_agg(m.clinic_name||'/'||m.status,'·') into v_txt from public.my_clinic_memberships() m;
  if v_n <> 1 or v_txt <> 'Teste 2bii Alfa/inactive' then fails := fails || 'P7_rpc('||v_n::text||'/'||coalesce(v_txt,'-')||') '; end if;
  -- (N10) e a RPC não devolve o join_code em nenhuma coluna
  select count(*) into v_n from public.my_clinic_memberships() m
   where m.clinic_name = v_code or m.status = v_code or m.clinic_id::text = v_code;
  if v_n <> 0 then fails := fails || 'N10_rpc_vazou_join_code '; end if;
  -- (N3b) nem pela RPC de rotação
  begin
    perform public.rotate_clinic_join_code(c1);
    fails := fails || 'N3b_A1_rotacionou_codigo ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then fails := fails || 'N3b_errcode('||v_state||') '; end if;
  end;
  reset role;

  -- (I1) o ADMIN e o DONO seguem vendo a IDENTIDADE de A1
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.profiles where id = p_a1;
  if v_n <> 1 then fails := fails || 'I1_admin_perdeu_profile '; end if;
  if not private.can_see_profile(p_a1) then fails := fails || 'I1_admin_can_see_profile '; end if;
  select count(*) into v_n from public.professionals where id = prof_a1;
  if v_n <> 1 then fails := fails || 'I1_admin_perdeu_linha '; end if;
  select count(*) into v_n from public.professional_disciplines where professional_id = prof_a1;
  if v_n <> 1 then fails := fails || 'I1_admin_perdeu_disciplina '; end if;
  select count(*) into v_n from public.report_exports where id = re1;   -- (N7) auditoria preservada
  if v_n <> 1 then fails := fails || 'N7_admin_perdeu_export '; end if;
  select count(*) into v_n from public.professional_status_events where clinic_id = c1;  -- (N8) o admin LÊ
  if v_n < 1 then fails := fails || 'N8_admin_nao_le_trilha '; end if;
  -- (N12) DELETE de professionals nao existe mais para authenticated
  delete from public.professionals where id = prof_a1;
  if found then fails := fails || 'N12_admin_apagou_professional '; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',a_own,'role','authenticated')::text, true);
  set local role authenticated;
  if not private.is_clinic_admin(c1) then fails := fails || 'dono_perdeu_adminidade '; end if;
  select count(*) into v_n from public.profiles where id = p_a1;
  if v_n <> 1 then fails := fails || 'I1_dono_perdeu_profile '; end if;
  reset role;

  -- (N8) o COLEGA ATIVO não lê a trilha da pessoa
  perform set_config('request.jwt.claims', json_build_object('sub',a_a2,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.professional_status_events where clinic_id = c1;
  if v_n <> 0 then fails := fails || 'N8_colega_le_trilha('||v_n::text||') '; end if;
  -- e NÃO ganhou nada com a desativação: continua vendo a paciente e o canal
  if not private.is_common_professional_of_patient(pat1) then fails := fails || 'A2_perdeu_paciente '; end if;
  select count(*) into v_n from public.chat_messages where channel_id = ch1;
  if v_n <> 2 then fails := fails || 'A2_perdeu_historico('||v_n::text||') '; end if;
  reset role;

  -- A5 (a paciente) e A6 (externo) NÃO ganharam nada
  perform set_config('request.jwt.claims', json_build_object('sub',a_pat,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.chat_messages where channel_id = ch1;
  if v_n <> 2 then fails := fails || 'A5_perdeu_historico('||v_n::text||') '; end if;
  -- (I3) LIMITE DECLARADO: a paciente PERDE o profile (o nome) de A1 — ramo R4 exige vínculo
  -- ativo e a cascata o derrubou. can_see_profile NÃO foi tocada. Ver DÍVIDA-2bii-4.
  if private.can_see_profile(p_a1) then fails := fails || 'I3_comportamento_mudou_verifique_a_divida '; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',a_ext,'role','authenticated')::text, true);
  set local role authenticated;
  if not private.is_external_professional_of_patient(pat1) then fails := fails || 'A6_perdeu_vinculo_externo '; end if;
  select count(*) into v_n from public.clinics where id = c1;
  if v_n <> 1 then fails := fails || 'A6_perdeu_clinics('||v_n::text||') '; end if;
  reset role;

  -- A8 anon ⊥ tudo
  perform set_config('request.jwt.claims','',true);
  set local role anon;
  select count(*) into v_n from public.professionals where id = prof_a1;
  if v_n <> 0 then fails := fails || 'A8_anon_le_professionals '; end if;
  begin
    perform public.my_clinic_memberships();
    fails := fails || 'A8_anon_executou_rpc ';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── (N5) TRANCA DUPLA ──────────────────────────────────────────────────────────────
  update public.professional_patient_links set status='active' where id = link_a1;
  perform set_config('request.jwt.claims', json_build_object('sub',a_a1,'role','authenticated')::text, true);
  set local role authenticated;
  if private.is_common_professional_of_patient(pat1) then fails := fails || 'N5_vinculo_na_forca_devolveu_acesso '; end if;
  select count(*) into v_n from public.patients where id = pat1;
  if v_n <> 0 then fails := fails || 'N5_ve_paciente('||v_n::text||') '; end if;
  reset role;
  update public.professional_patient_links set status='inactive' where id = link_a1;

  -- ── (P5) reativar a PESSOA não religa vínculo ──────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.reactivate_professional(prof_a1,'voltou');
  reset role;
  select coalesce(status,'active') into v_txt from public.professionals where id = prof_a1;
  if v_txt <> 'active' then fails := fails || 'P5_status('||v_txt||') '; end if;
  select count(*) into v_n from public.professional_patient_links
   where professional_id = prof_a1 and coalesce(status,'active')='active';
  if v_n <> 0 then fails := fails || 'P5_RELIGOU_VINCULO('||v_n::text||') ';  end if;
  select count(*) into v_n from public.professional_status_events where professional_id = prof_a1;
  if v_n <> 2 then fails := fails || 'P5_trilha('||v_n::text||') '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',a_a1,'role','authenticated')::text, true);
  set local role authenticated;
  if not private.is_clinic_staff(c1) then fails := fails || 'P5_nao_voltou_a_ser_staff '; end if;
  select count(*) into v_n from public.clinics where id = c1;          -- volta a ver a clínica
  if v_n <> 1 then fails := fails || 'P5_nao_voltou_clinics '; end if;
  if private.is_common_professional_of_patient(pat1) then fails := fails || 'P5_voltou_acesso_a_paciente '; end if;
  select count(*) into v_n from public.report_exports where id = re1;  -- autoria volta (é staff de novo)
  if v_n <> 1 then fails := fails || 'P5_export_nao_voltou '; end if;
  reset role;

  -- ── (P6) reativar o VÍNCULO devolve o eixo clínico (menos a escrita no chat) ────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.reactivate_patient_link(prof_a1, pat1, 'religa');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',a_a1,'role','authenticated')::text, true);
  set local role authenticated;
  if not private.is_common_professional_of_patient(pat1) then fails := fails || 'P6_nao_voltou_is_common '; end if;
  select count(*) into v_n from public.patients where id = pat1;
  if v_n <> 1 then fails := fails || 'P6_nao_voltou_paciente '; end if;
  if not private.can_read_channel(ch1) then fails := fails || 'P6_nao_voltou_leitura_do_canal '; end if;
  -- ASSIMETRIA HERDADA DO 2b-i: a linha do roster NÃO é recriada, então a ESCRITA no chat só
  -- volta quando a conversa for reaberta por get_or_create_channel. Fixado aqui de propósito.
  if private.is_channel_participant(ch1) then fails := fails || 'P6_roster_voltou_sozinho(mudou_o_2bi) '; end if;
  reset role;

  -- ── (N9) a âncora: cadastro desativado não volta pela porta da frente ──────────────
  insert into public.clinic_join_requests(id,profile_id,clinic_id,status,requester_name,requester_email)
    values (req1,p_pend,c1,'pending','Pendente Novo','pn@t2bii.test'),
           (req3,p_act, c1,'pending','Pendente Ativo','pa@t2bii.test');
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  v_prof_novo := public.approve_join_request(req1);
  v_prof_act  := public.approve_join_request(req3);
  perform public.deactivate_professional(v_prof_novo,'desativa o recem-promovido');
  reset role;
  insert into public.clinic_join_requests(id,profile_id,clinic_id,status,requester_name,requester_email)
    values (req2,p_pend,c1,'pending','Pendente Novo','pn@t2bii.test');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.approve_join_request(req2);
    reset role; fails := fails || 'N9_aprovou_desativado ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    reset role;
    if v_state <> '22023' or v_hint <> 'PROFESSIONAL_INACTIVE' then fails := fails || 'N9_errcode('||v_state||'/'||coalesce(v_hint,'-')||') '; end if;
  end;
  select status into v_txt from public.clinic_join_requests where id = req2;
  if v_txt <> 'pending' then fails := fails || 'N9_solicitacao_nao_ficou_pendente('||v_txt||') '; end if;
  select count(*) into v_n from public.professionals where id = v_prof_novo and status='inactive';
  if v_n <> 1 then fails := fails || 'N9_linha_foi_reativada '; end if;

  -- ── (P8) linha ATIVA: dedup inalterado ─────────────────────────────────────────────
  insert into public.clinic_join_requests(id,profile_id,clinic_id,status,requester_name,requester_email)
    values (req4,p_act,c1,'pending','Pendente Ativo','pa@t2bii.test');
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  v_ret := public.approve_join_request(req4);
  reset role;
  select status into v_txt from public.clinic_join_requests where id = req4;
  if v_ret is distinct from v_prof_act or v_txt <> 'approved' then fails := fails || 'P8_dedup_mudou '; end if;

  -- ── (I2) channel_professionals: false = idêntico; true traz o autor fora do roster ──
  perform set_config('request.jwt.claims', json_build_object('sub',a_a2,'role','authenticated')::text, true);
  set local role authenticated;
  select string_agg(t::text,'|') into v_new  from public.channel_professionals(ch1) t;
  select string_agg(t::text,'|') into v_old  from public.channel_professionals(ch1,false) t;
  select string_agg(t::text,'|') into v_true from public.channel_professionals(ch1,true) t;
  reset role;
  if v_new is distinct from v_old then fails := fails || 'I2_default_diferente_de_false '; end if;
  if coalesce(v_new,'') like '%'||p_a1::text||'%' then fails := fails || 'I2_false_trouxe_quem_saiu_do_roster '; end if;
  if coalesce(v_true,'') not like '%'||p_a1::text||'%' then fails := fails || 'I2_true_nao_trouxe_o_autor '; end if;

  -- ── veredito ───────────────────────────────────────────────────────────────────────
  if fails <> '' then
    raise exception 'WP-TEAM-2b-ii TESTES FALHARAM: %', fails;
  end if;
  raise notice 'WP-TEAM-2b-ii: TODOS OS TESTES PASSARAM';
end
$$;
rollback;
