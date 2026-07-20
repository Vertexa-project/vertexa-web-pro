-- =====================================================================================
-- WP-DISC · A — TESTES (Nível 1; login simulado via request.jwt.claims; tudo em ROLLBACK).
-- Assume a migration 20260725090000 aplicada. Prova: escrita escopada por disciplina (UNIÃO),
-- negação PELA POLICY e PELA RPC, acumulação somando, revogação parcial, admin-sem-disciplina
-- negado, create_patient (anamnese) preservado p/ staff sem disciplina, leitura integrada intacta,
-- externo/não-vinculado/anon negados, IDOR, auto-atribuição negada. Falha (raise) se qualquer check quebrar.
-- =====================================================================================
begin;

create function pg_temp.try_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $h$
begin
  if p_sub is null then perform set_config('request.jwt.claims','',true); else perform set_config('request.jwt.claims', json_build_object('sub',p_sub::text)::text, true); end if;
  execute format('set local role %I', p_role); execute p_sql; reset role; return 'ALLOW';
exception when others then begin reset role; exception when others then end; return 'DENY'; end $h$;
create function pg_temp.cnt_as(p_sub uuid, p_sql text) returns int language plpgsql as $h$
declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub::text)::text, true); set local role authenticated; execute p_sql into n; reset role; return n;
exception when others then begin reset role; exception when others then end; return -1; end $h$;
create temp table _r(chk text, res text);

do $do$
declare
  cA uuid:=gen_random_uuid(); cB uuid:=gen_random_uuid(); P uuid:=gen_random_uuid(); B uuid:=gen_random_uuid();
  a_admin uuid:=gen_random_uuid(); a_nutri uuid:=gen_random_uuid(); a_edu uuid:=gen_random_uuid(); a_fisio uuid:=gen_random_uuid();
  a_med uuid:=gen_random_uuid(); a_dual uuid:=gen_random_uuid(); a_nutedu uuid:=gen_random_uuid(); a_triple uuid:=gen_random_uuid();
  a_fisnut uuid:=gen_random_uuid(); a_lnd uuid:=gen_random_uuid(); a_ext uuid:=gen_random_uuid(); a_nl uuid:=gen_random_uuid(); a_bf uuid:=gen_random_uuid();
  f_admin uuid:=gen_random_uuid(); f_nutri uuid:=gen_random_uuid(); f_edu uuid:=gen_random_uuid(); f_fisio uuid:=gen_random_uuid();
  f_med uuid:=gen_random_uuid(); f_dual uuid:=gen_random_uuid(); f_nutedu uuid:=gen_random_uuid(); f_triple uuid:=gen_random_uuid();
  f_fisnut uuid:=gen_random_uuid(); f_lnd uuid:=gen_random_uuid(); f_ext uuid:=gen_random_uuid(); f_nl uuid:=gen_random_uuid(); f_bf uuid:=gen_random_uuid(); f_P uuid:=gen_random_uuid(); f_B uuid:=gen_random_uuid();
  pr_admin uuid:=gen_random_uuid(); pr_nutri uuid:=gen_random_uuid(); pr_edu uuid:=gen_random_uuid(); pr_fisio uuid:=gen_random_uuid();
  pr_med uuid:=gen_random_uuid(); pr_dual uuid:=gen_random_uuid(); pr_nutedu uuid:=gen_random_uuid(); pr_triple uuid:=gen_random_uuid();
  pr_fisnut uuid:=gen_random_uuid(); pr_lnd uuid:=gen_random_uuid(); pr_ext uuid:=gen_random_uuid(); pr_nl uuid:=gen_random_uuid(); pr_bf uuid:=gen_random_uuid();
  ins_nut text; ins_sup text; ins_wrk text; ins_body text; rpc_nut text; rpc_wrk text; c int;
begin
  insert into public.profiles(id,auth_user_id,role,full_name,status) values
   (f_admin,a_admin,'professional','Admin','active'),(f_nutri,a_nutri,'professional','Nutri','active'),(f_edu,a_edu,'professional','Edu','active'),
   (f_fisio,a_fisio,'professional','Fisio','active'),(f_med,a_med,'professional','Med','active'),(f_dual,a_dual,'professional','Dual','active'),
   (f_nutedu,a_nutedu,'professional','NutEdu','active'),(f_triple,a_triple,'professional','Triple','active'),(f_fisnut,a_fisnut,'professional','FisNut','active'),
   (f_lnd,a_lnd,'professional','LinkedNoDisc','active'),(f_ext,a_ext,'professional','Ext','active'),(f_nl,a_nl,'professional','NonLinked','active'),
   (f_bf,a_bf,'professional','Backfill','active'),(f_P,gen_random_uuid(),'patient','PatP','active'),(f_B,gen_random_uuid(),'patient','PatB','active');
  insert into public.clinics(id,name,owner_profile_id) values (cA,'A',f_admin),(cB,'B',null);
  insert into public.patients(id,profile_id,clinic_id) values (P,f_P,cA),(B,f_B,cB);
  insert into public.professionals(id,profile_id,clinic_id,type,clinic_role) values
   (pr_admin,f_admin,cA,'other','admin'),(pr_nutri,f_nutri,cA,'nutritionist','member'),(pr_edu,f_edu,cA,'personal_trainer','member'),
   (pr_fisio,f_fisio,cA,'physiotherapist','member'),(pr_med,f_med,cA,'doctor','member'),(pr_dual,f_dual,cA,'doctor','member'),
   (pr_nutedu,f_nutedu,cA,'nutritionist','member'),(pr_triple,f_triple,cA,'doctor','member'),(pr_fisnut,f_fisnut,cA,'physiotherapist','member'),
   (pr_lnd,f_lnd,cA,'other','member'),(pr_ext,f_ext,cA,'nutritionist','member'),(pr_nl,f_nl,cA,'nutritionist','member'),(pr_bf,f_bf,cA,'nutritionist','member');
  insert into public.professional_patient_links(professional_id,patient_id,is_external,status) values
   (pr_nutri,P,false,'active'),(pr_edu,P,false,'active'),(pr_fisio,P,false,'active'),(pr_med,P,false,'active'),(pr_dual,P,false,'active'),
   (pr_nutedu,P,false,'active'),(pr_triple,P,false,'active'),(pr_fisnut,P,false,'active'),(pr_lnd,P,false,'active'),(pr_ext,P,true,'active'),(pr_bf,P,false,'active');
  insert into public.professional_disciplines(professional_id,discipline) values
   (pr_nutri,'nutricionista'),(pr_edu,'educador_fisico'),(pr_fisio,'fisioterapeuta'),(pr_med,'medico'),
   (pr_dual,'medico'),(pr_dual,'nutricionista'),(pr_nutedu,'nutricionista'),(pr_nutedu,'educador_fisico'),
   (pr_triple,'medico'),(pr_triple,'nutricionista'),(pr_triple,'educador_fisico'),(pr_fisnut,'fisioterapeuta'),(pr_fisnut,'nutricionista'),
   (pr_ext,'nutricionista'),(pr_nl,'nutricionista');
  -- backfillProf: sem disciplina explícita; aplica o mesmo map(type) do backfill da migration
  insert into public.professional_disciplines(professional_id,discipline,granted_by)
   select pr.id, case pr.type when 'nutritionist' then 'nutricionista' end, null from public.professionals pr where pr.id=pr_bf on conflict do nothing;

  ins_nut  := format('insert into public.nutrition_plans(patient_id,title) values (%L,%L)', P,'t');
  ins_sup  := format('insert into public.supplements(patient_id,name) values (%L,%L)', P,'s');
  ins_wrk  := format('insert into public.workout_plans(patient_id,title) values (%L,%L)', P,'w');
  ins_body := format('insert into public.body_assessments(patient_id) values (%L)', P);
  rpc_nut  := format('select public.save_nutrition_plan(%L,%L)', P,'t');
  rpc_wrk  := format('select public.save_workout_plan(%L,%L)', P,'t');

  -- POSITIVOS
  insert into _r values('P_nutri_nut', case when pg_temp.try_as(a_nutri,'authenticated',ins_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_nutri_sup', case when pg_temp.try_as(a_nutri,'authenticated',ins_sup)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_nutri_rpcnut', case when pg_temp.try_as(a_nutri,'authenticated',rpc_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_edu_wrk', case when pg_temp.try_as(a_edu,'authenticated',ins_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_edu_rpcwrk', case when pg_temp.try_as(a_edu,'authenticated',rpc_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_fisio_wrk', case when pg_temp.try_as(a_fisio,'authenticated',ins_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_med_body', case when pg_temp.try_as(a_med,'authenticated',ins_body)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_dual_nut', case when pg_temp.try_as(a_dual,'authenticated',ins_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_dual_body', case when pg_temp.try_as(a_dual,'authenticated',ins_body)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_nutedu_nut', case when pg_temp.try_as(a_nutedu,'authenticated',ins_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_nutedu_wrk', case when pg_temp.try_as(a_nutedu,'authenticated',ins_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_triple_nut', case when pg_temp.try_as(a_triple,'authenticated',ins_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_triple_wrk', case when pg_temp.try_as(a_triple,'authenticated',ins_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_triple_body', case when pg_temp.try_as(a_triple,'authenticated',ins_body)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_fisnut_wrk', case when pg_temp.try_as(a_fisnut,'authenticated',ins_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_fisnut_nut', case when pg_temp.try_as(a_fisnut,'authenticated',ins_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_backfill_nut', case when pg_temp.try_as(a_bf,'authenticated',ins_nut)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('P_backfill_notwrk', case when pg_temp.try_as(a_bf,'authenticated',ins_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('P_createpatient_admin_nodisc', case when pg_temp.try_as(a_admin,'authenticated', format('select public.create_patient(p_clinic_id=>%L,p_full_name=>%L,p_anamnese_weight=>80,p_anamnese_body_fat_pct=>20,p_anamnese_method=>%L,p_anamnese_notes=>%L)', cA,'Novo','skinfold','n'))='ALLOW' then 'ok' else 'FAIL' end);

  -- NEGATIVOS (policy E rpc)
  insert into _r values('N_nutri_wrk', case when pg_temp.try_as(a_nutri,'authenticated',ins_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_nutri_rpcwrk', case when pg_temp.try_as(a_nutri,'authenticated',rpc_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_edu_nut', case when pg_temp.try_as(a_edu,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_edu_rpcnut', case when pg_temp.try_as(a_edu,'authenticated',rpc_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_fisio_nut', case when pg_temp.try_as(a_fisio,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_med_nut', case when pg_temp.try_as(a_med,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_med_wrk', case when pg_temp.try_as(a_med,'authenticated',ins_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_med_sup', case when pg_temp.try_as(a_med,'authenticated',ins_sup)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_med_rpcwrk', case when pg_temp.try_as(a_med,'authenticated',rpc_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_dual_wrk', case when pg_temp.try_as(a_dual,'authenticated',ins_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_dual_rpcwrk', case when pg_temp.try_as(a_dual,'authenticated',rpc_wrk)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_admin_nut', case when pg_temp.try_as(a_admin,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_admin_body', case when pg_temp.try_as(a_admin,'authenticated',ins_body)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_lnd_nut', case when pg_temp.try_as(a_lnd,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_lnd_body', case when pg_temp.try_as(a_lnd,'authenticated',ins_body)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_nonlinked_nut', case when pg_temp.try_as(a_nl,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_external_nut', case when pg_temp.try_as(a_ext,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_anon_nut', case when pg_temp.try_as(null,'anon',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_idor_nutri_B', case when pg_temp.try_as(a_nutri,'authenticated', format('insert into public.nutrition_plans(patient_id,title) values (%L,%L)', B,'t'))='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_selfassign', case when pg_temp.try_as(a_nutri,'authenticated', format('select public.assign_professional_discipline(%L,%L)', pr_nutri,'educador_fisico'))='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('N_nonadmin_assign', case when pg_temp.try_as(a_nutri,'authenticated', format('select public.assign_professional_discipline(%L,%L)', pr_edu,'nutricionista'))='DENY' then 'ok' else 'FAIL' end);

  -- ATRIBUIÇÃO por admin + união expande; REVOGAÇÃO parcial
  insert into _r values('A_admin_assign_fisio_to_med', case when pg_temp.try_as(a_admin,'authenticated', format('select public.assign_professional_discipline(%L,%L)', pr_med,'fisioterapeuta'))='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('A_med_wrk_after_assign', case when pg_temp.try_as(a_med,'authenticated',ins_wrk)='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('A_admin_revoke_nut_from_dual', case when pg_temp.try_as(a_admin,'authenticated', format('select public.revoke_professional_discipline(%L,%L)', pr_dual,'nutricionista'))='ALLOW' then 'ok' else 'FAIL' end);
  insert into _r values('A_dual_nut_after_revoke_DENY', case when pg_temp.try_as(a_dual,'authenticated',ins_nut)='DENY' then 'ok' else 'FAIL' end);
  insert into _r values('A_dual_body_after_revoke_OK', case when pg_temp.try_as(a_dual,'authenticated',ins_body)='ALLOW' then 'ok' else 'FAIL' end);

  -- MÚLTIPLAS (triple mantém 3)
  select count(*) into c from public.professional_disciplines where professional_id=pr_triple;
  insert into _r values('M_triple_count3', case when c=3 then 'ok' else 'FAIL('||c||')' end);

  -- REGRESSÃO de leitura integrada
  insert into public.nutrition_plans(patient_id,title) values (P,'seed-read');
  insert into _r values('R_linked_reads', case when pg_temp.cnt_as(a_lnd, format('select count(*)::int from public.nutrition_plans where patient_id=%L',P)) >= 1 then 'ok' else 'FAIL' end);
  insert into _r values('R_nonlinked_noread', case when pg_temp.cnt_as(a_nl, format('select count(*)::int from public.nutrition_plans where patient_id=%L',P)) = 0 then 'ok' else 'FAIL' end);
end $do$;

do $chk$
begin
  if exists (select 1 from _r where res <> 'ok') then
    raise exception 'WP-DISC-A FAIL: %', (select string_agg(chk||'='||res, ', ') from _r where res<>'ok');
  else
    raise notice 'WP-DISC-A: PASS (% checks)', (select count(*) from _r);
  end if;
end $chk$;
rollback;
