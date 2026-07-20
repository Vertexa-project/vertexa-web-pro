-- =====================================================================================
-- WP-REPORT · B — TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20260729090000 aplicada (report_exports.batch_id + RPC de 6 args com p_batch_id opcional).
-- O LOTE = N chamadas da MESMA RPC com o MESMO batch_id (1 linha/paciente; autz reavaliada por paciente).
--
-- DESTAQUES: N linhas com o MESMO batch_id; paciente não-autorizado no meio ⟂ 42501 SEM gravar linha e
-- SEM impedir os demais; regressão de 1 paciente sem batch_id (batch_id null); trilha imutável; leitura
-- da trilha só admin da clínica / autor.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; n int; cnt int;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  p2 uuid:=gen_random_uuid(); au_p2 uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid();
  x1 uuid:=gen_random_uuid(); px1 uuid:=gen_random_uuid();
  x2 uuid:=gen_random_uuid(); px2 uuid:=gen_random_uuid();
  x3 uuid:=gen_random_uuid(); px3 uuid:=gen_random_uuid();
  batch uuid:=gen_random_uuid();
  d_from date:=current_date-30; d_to date:=current_date;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),(p2,au_p2,'professional','P2','active'),
    (adminB,au_adminB,'admin','Admin B','active'),(px1,gen_random_uuid(),'patient','X1','active'),
    (px2,gen_random_uuid(),'patient','X2','active'),(px3,gen_random_uuid(),'patient','X3','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (e1,p1,clA,'nutritionist','member'),(e2,p2,clA,'physiotherapist','member');
  insert into public.patients (id,profile_id,clinic_id) values (x1,px1,clA),(x2,px2,clA),(x3,px3,clA);
  -- P1 vinculado a X1 e X2; NÃO a X3 (o "meio do lote" que falha)
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,x1,false,'active'),(e1,x2,false,'active');

  -- ══ LOTE do P1 (mesmo batch_id): X1 ok, X2 ok, X3 ⟂ (42501) — o lote NÃO aborta ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.export_patient_report(x1, d_from, d_to, array['identity'], 'web', batch);
    perform public.export_patient_report(x2, d_from, d_to, array['identity'], 'web', batch);
    begin perform public.export_patient_report(x3, d_from, d_to, array['identity'], 'web', batch); fails:=fails||'X3_not_denied '; exception when others then null; end; -- 42501 esperado
  reset role;

  -- N linhas com o MESMO batch_id = 2 (X1,X2); X3 ausente
  select count(*) into cnt from public.report_exports where batch_id=batch; if cnt<>2 then fails:=fails||'batch_rows('||cnt||') '; end if;
  select count(*) into cnt from public.report_exports where batch_id=batch and patient_id in (x1,x2); if cnt<>2 then fails:=fails||'batch_patients '; end if;
  select count(*) into cnt from public.report_exports where batch_id=batch and patient_id=x3; if cnt<>0 then fails:=fails||'X3_leaked '; end if;
  -- todas do mesmo autor
  select count(*) into cnt from public.report_exports where batch_id=batch and exported_by_profile_id<>p1; if cnt<>0 then fails:=fails||'batch_author '; end if;

  -- ══ REGRESSÃO: 1 paciente SEM batch_id (chamada de "5 args" via default) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.export_patient_report(x1, d_from, d_to, array['identity'], 'web');
  reset role;
  select count(*) into cnt from public.report_exports where patient_id=x1 and batch_id is null; if cnt<>1 then fails:=fails||'regress_single('||cnt||') '; end if;

  -- ══ TRILHA IMUTÁVEL ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    begin update public.report_exports set batch_id=null where batch_id=batch; get diagnostics n=row_count; if n>0 then fails:=fails||'MUT_upd('||n||') '; end if; exception when others then null; end;
    begin delete from public.report_exports where batch_id=batch; get diagnostics n=row_count; if n>0 then fails:=fails||'MUT_del('||n||') '; end if; exception when others then null; end;
  reset role;

  -- ══ LEITURA DA TRILHA: admin da clínica ✓, autor ✓, terceiro ⟂, admin de OUTRA clínica ⟂ ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated;
    if (select count(*) from public.report_exports where batch_id=batch) <> 2 then fails:=fails||'read_admin '; end if; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if (select count(*) from public.report_exports where batch_id=batch) <> 2 then fails:=fails||'read_author '; end if; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated;
    if (select count(*) from public.report_exports where batch_id=batch) <> 0 then fails:=fails||'read_p2 '; end if; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminB::text)::text, true); set local role authenticated;
    if (select count(*) from public.report_exports where batch_id=batch) <> 0 then fails:=fails||'read_adminB '; end if; reset role;

  if length(fails)>0 then raise exception 'WP-REPORT B TESTS FAILED: %', fails;
  else raise notice 'WP-REPORT B: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
