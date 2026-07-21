-- =====================================================================================
-- WP-KANBAN · A — TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20260730090000 aplicada. Fixtures como postgres (bypassrls); nada persiste.
--
-- DESTAQUES: externo ⟂ mover; forja de moved_by/acked_by ⟂ (escrita só via RPC); histórico imutável;
-- UMA só coluna inicial por clínica; regressão do create_patient (sem/COM p_start_date; futuro ⟂);
-- sem versão órfã da RPC; leitura restrita a quem acessa o paciente.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; n int;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  p2 uuid:=gen_random_uuid(); au_p2 uuid:=gen_random_uuid();
  pext uuid:=gen_random_uuid(); au_pext uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); eext uuid:=gen_random_uuid();
  x1 uuid:=gen_random_uuid(); px1 uuid:=gen_random_uuid();
  x2 uuid:=gen_random_uuid(); px2 uuid:=gen_random_uuid();
  colA_init uuid; colA2 uuid; colA3 uuid; colB_init uuid;
  v_col uuid; v_by uuid; v_from uuid; v_cnt int; v_new uuid; v_sd date;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),(p2,au_p2,'professional','P2','active'),
    (pext,au_pext,'professional','Ext','active'),(adminB,au_adminB,'admin','Admin B','active'),
    (px1,gen_random_uuid(),'patient','X1','active'),(px2,gen_random_uuid(),'patient','X2','active');
  -- inserir clínicas dispara o trigger de seed (4 colunas cada)
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,p1,clA,'nutritionist','member'),(e2,p2,clA,'physiotherapist','member'),(eext,pext,clB,'personal_trainer','member');
  insert into public.patients (id,profile_id,clinic_id) values (x1,px1,clA),(x2,px2,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values
    (e1,x1,false,'active'),(eext,x1,true,'active');   -- P1 comum ; Pext externo

  -- ══ trigger semeou 4 colunas com 1 inicial ══
  select count(*) into v_cnt from public.journey_columns where clinic_id=clA; if v_cnt<>4 then fails:=fails||'seed_count('||v_cnt||') '; end if;
  select count(*) into v_cnt from public.journey_columns where clinic_id=clA and is_initial; if v_cnt<>1 then fails:=fails||'seed_initial('||v_cnt||') '; end if;
  select id into colA_init from public.journey_columns where clinic_id=clA and is_initial;
  select id into colA2 from public.journey_columns where clinic_id=clA and position=2;
  select id into colA3 from public.journey_columns where clinic_id=clA and position=3;
  select id into colB_init from public.journey_columns where clinic_id=clB and is_initial;

  -- ══ paciente SEM estado: X2 não tem linha (quadro deriva para a inicial) ══
  select count(*) into v_cnt from public.patient_journey_state where patient_id=x2; if v_cnt<>0 then fails:=fails||'x2_has_state '; end if;

  -- ══ POSITIVO: P1 (comum) move X1 p/ colA2 → estado + 1 histórico (from=inicial, autor=P1) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.move_patient_journey(x1, colA2);
  reset role;
  select column_id, moved_by_profile_id into v_col, v_by from public.patient_journey_state where patient_id=x1;
  if v_col<>colA2 then fails:=fails||'move_state_col '; end if;
  if v_by<>p1 then fails:=fails||'move_state_by '; end if;
  select count(*) into v_cnt from public.patient_journey_moves where patient_id=x1; if v_cnt<>1 then fails:=fails||'move_hist_count '; end if;
  select from_column_id, to_column_id, moved_by_profile_id into v_from, v_col, v_by from public.patient_journey_moves where patient_id=x1;
  if v_from<>colA_init then fails:=fails||'move_from_initial '; end if;
  if v_col<>colA2 or v_by<>p1 then fails:=fails||'move_hist_fields '; end if;

  -- ══ POSITIVO: admin move X1 p/ colA3 → estado atualizado + 2º histórico ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated;
    perform public.move_patient_journey(x1, colA3);
  reset role;
  select column_id into v_col from public.patient_journey_state where patient_id=x1; if v_col<>colA3 then fails:=fails||'admin_move_col '; end if;
  select count(*) into v_cnt from public.patient_journey_moves where patient_id=x1; if v_cnt<>2 then fails:=fails||'admin_move_hist '; end if;

  -- ══ POSITIVO: admin cria / renomeia / reordena coluna (CRUD direto) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated;
    begin insert into public.journey_columns (clinic_id,name,position,is_initial) values (clA,'Nova',5,false); exception when others then fails:=fails||'admin_create_col '; end;
    begin update public.journey_columns set name='Retorno 30d' where id=colA3; get diagnostics n=row_count; if n<>1 then fails:=fails||'admin_rename '; end if; exception when others then fails:=fails||'admin_rename_exc '; end;
    begin update public.journey_columns set position=6 where id=colA2; get diagnostics n=row_count; if n<>1 then fails:=fails||'admin_reorder '; end if; exception when others then fails:=fails||'admin_reorder_exc '; end;
  reset role;

  -- ══ POSITIVO: reconhecer marco (acked_by=P1) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.ack_journey_milestone(x1, 'day_30');
  reset role;
  select count(*) into v_cnt from public.journey_milestone_ack where patient_id=x1 and milestone_key='day_30' and acked_by_profile_id=p1; if v_cnt<>1 then fails:=fails||'ack_row '; end if;

  -- ══ POSITIVO: create_patient COM p_start_date grava a data; SEM o parâmetro usa hoje ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    select public.create_patient(clA,'Paciente Antigo',null,null,null,null,null,null,null,null,null,null,null, date '2026-01-15') into v_new;
  reset role;
  select start_date into v_sd from public.patients where id=v_new; if v_sd<>date '2026-01-15' then fails:=fails||'cp_with_start('||coalesce(v_sd::text,'null')||') '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    select public.create_patient(clA,'Paciente Novo') into v_new;
  reset role;
  select start_date into v_sd from public.patients where id=v_new; if v_sd<>current_date then fails:=fails||'cp_default_start '; end if;

  -- ══ NEGATIVOS ══
  -- P2 não-vinculado ⟂ mover
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated; perform public.move_patient_journey(x1, colA2); reset role; fails:=fails||'NEG_p2_move '; exception when others then reset role; end;
  -- externo ⟂ mover
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pext::text)::text, true); set local role authenticated; perform public.move_patient_journey(x1, colA2); reset role; fails:=fails||'NEG_ext_move '; exception when others then reset role; end;
  -- profissional comum ⟂ criar coluna (só admin)
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; insert into public.journey_columns (clinic_id,name,position,is_initial) values (clA,'Hack',9,false); reset role; fails:=fails||'NEG_p1_create_col '; exception when others then reset role; end;
  -- mover p/ coluna de OUTRA clínica ⟂
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; perform public.move_patient_journey(x1, colB_init); reset role; fails:=fails||'NEG_cross_clinic '; exception when others then reset role; end;
  -- forja: insert DIRETO em moves/state/ack ⟂ (escrita só via RPC)
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    begin insert into public.patient_journey_moves (patient_id,to_column_id,moved_by_profile_id) values (x1,colA2,adminA); fails:=fails||'NEG_forge_move '; exception when others then null; end;
    begin insert into public.patient_journey_state (patient_id,column_id,moved_by_profile_id) values (x2,colA2,adminA); fails:=fails||'NEG_forge_state '; exception when others then null; end;
    begin insert into public.journey_milestone_ack (patient_id,milestone_key,acked_by_profile_id) values (x1,'start',adminA); fails:=fails||'NEG_forge_ack '; exception when others then null; end;
  reset role;
  -- histórico imutável: UPDATE/DELETE em moves ⟂
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    begin update public.patient_journey_moves set to_column_id=colA2 where patient_id=x1; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_moves_update('||n||') '; end if; exception when others then null; end;
    begin delete from public.patient_journey_moves where patient_id=x1; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_moves_delete('||n||') '; end if; exception when others then null; end;
  reset role;
  -- duas colunas iniciais na mesma clínica ⟂ (índice único parcial)
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated; insert into public.journey_columns (clinic_id,name,position,is_initial) values (clA,'Dup Inicial',7,true); reset role; fails:=fails||'NEG_two_initial '; exception when others then reset role; end;
  -- ack chave desconhecida ⟂
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; perform public.ack_journey_milestone(x1,'day_45'); reset role; fails:=fails||'NEG_ack_unknown '; exception when others then reset role; end;
  -- create_patient com data FUTURA ⟂
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; perform public.create_patient(clA,'Futuro',null,null,null,null,null,null,null,null,null,null,null, current_date+10); reset role; fails:=fails||'NEG_future_start '; exception when others then reset role; end;
  -- leitura por quem NÃO acessa o paciente ⟂ (P2 não-vinculado)
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated;
    if (select count(*) from public.patient_journey_state where patient_id=x1) <> 0 then fails:=fails||'NEG_read_state '; end if;
    if (select count(*) from public.patient_journey_moves where patient_id=x1) <> 0 then fails:=fails||'NEG_read_moves '; end if;
  reset role;
  -- anon ⟂ tudo
  begin reset role; set local role anon; perform public.move_patient_journey(x1, colA2); reset role; fails:=fails||'NEG_anon_move '; exception when others then reset role; end;
  begin reset role; set local role anon; if (select count(*) from public.journey_columns) <> 0 then fails:=fails||'NEG_anon_read_cols '; end if; reset role; exception when others then reset role; end;

  -- ══ REGRESSÃO: sem versão órfã (1 assinatura de cada) ══
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_patient'; if v_cnt<>1 then fails:=fails||'orphan_create_patient('||v_cnt||') '; end if;
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='move_patient_journey'; if v_cnt<>1 then fails:=fails||'orphan_move '; end if;

  if length(fails)>0 then raise exception 'WP-KANBAN A TESTS FAILED: %', fails;
  else raise notice 'WP-KANBAN A: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
