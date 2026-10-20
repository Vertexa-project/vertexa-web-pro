-- WP-SUPP · A — testes (ROLLBACK). Assume 20261024090000 aplicada/concatenada.
begin;
do $$
declare
  fails text := ''; st text; n int; v jsonb; sid uuid;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  nutP uuid:=gen_random_uuid(); au_nut uuid:=gen_random_uuid();
  medP uuid:=gen_random_uuid(); au_med uuid:=gen_random_uuid();
  noP uuid:=gen_random_uuid(); au_no uuid:=gen_random_uuid();
  outP uuid:=gen_random_uuid(); au_out uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pacP uuid:=gen_random_uuid(); au_pac uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  eNut uuid:=gen_random_uuid(); eMed uuid:=gen_random_uuid(); eNo uuid:=gen_random_uuid(); eOut uuid:=gen_random_uuid();
  pt uuid:=gen_random_uuid();
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(nutP,au_nut,'professional','Nutri','active'),(medP,au_med,'professional','Médico','active'),
    (noP,au_no,'professional','Sem disciplina','active'),(outP,au_out,'professional','Outra clínica','active'),(adminB,au_adminB,'admin','Admin B','active'),
    (pacP,au_pac,'patient','Paciente','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (eNut,nutP,clA,'nutritionist','member'),(eMed,medP,clA,'doctor','member'),(eNo,noP,clA,'nutritionist','member'),(eOut,outP,clB,'doctor','member');
  insert into public.professional_disciplines (professional_id,discipline) values (eNut,'nutricionista'),(eMed,'medico'),(eOut,'medico');
  insert into public.patients (id,profile_id,clinic_id) values (pt,pacP,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (eNut,pt,false,'active'),(eMed,pt,false,'active'),(eNo,pt,false,'active');

  -- ══ NUTRICIONISTA: cria suplemento com marca/lembrete; NÃO cria medicamento ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_nut::text)::text, true);
  set local role authenticated;
  insert into public.supplements (patient_id,name,dose,time_label,order_index,brand,notes,reminder_time) values (pt,'Creatina','5 g','Pós-treino',0,'Marca X','Com água','18:30');
  begin insert into public.supplements (patient_id,name,order_index,kind) values (pt,'Remédio',1,'medication'); fails:=fails||'nutri_medication ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'nutri_med_sqlstate('||st||') '; end if; end;
  begin insert into public.supplements (patient_id,name,order_index,brand) values (pt,'Whey',1,repeat('x',81)); fails:=fails||'brand_81 ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'brand_sqlstate('||st||') '; end if; end;
  begin insert into public.supplements (patient_id,name,order_index,kind) values (pt,'X',1,'outro'); fails:=fails||'bad_kind ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st not in ('23514','42501') then fails:=fails||'kind_sqlstate('||st||') '; end if; end;
  select id into sid from public.supplements where patient_id=pt and name='Creatina';
  update public.supplements set brand='Marca Y', reminder_time='07:00' where id=sid;
  get diagnostics n = row_count; if n <> 1 then fails:=fails||'nutri_update '; end if;
  begin update public.supplements set kind='medication' where id=sid; fails:=fails||'kind_mutable ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'kindmut_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ MÉDICO: cria medicamento; NÃO cria suplemento nem mexe no suplemento da nutri ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_med::text)::text, true);
  set local role authenticated;
  insert into public.supplements (patient_id,name,dose,order_index,kind,brand,reminder_time) values (pt,'Losartana','50 mg',2,'medication','Genérico','08:00');
  begin insert into public.supplements (patient_id,name,order_index) values (pt,'Whey',3); fails:=fails||'med_supplement ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'medsup_sqlstate('||st||') '; end if; end;
  update public.supplements set dose='99 g' where id=sid;
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'med_updates_supplement '; end if;
  delete from public.supplements where id=sid;
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'med_deletes_supplement '; end if;
  reset role;

  -- nutri não altera nem apaga o medicamento
  perform set_config('request.jwt.claims', json_build_object('sub',au_nut::text)::text, true);
  set local role authenticated;
  update public.supplements set dose='1 g' where patient_id=pt and kind='medication';
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'nutri_updates_med '; end if;
  delete from public.supplements where patient_id=pt and kind='medication';
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'nutri_deletes_med '; end if;
  reset role;

  -- ══ sem disciplina: nada escreve ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_no::text)::text, true);
  set local role authenticated;
  begin insert into public.supplements (patient_id,name,order_index) values (pt,'Z',9); fails:=fails||'nodisc_write ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'nodisc_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ paciente lê os dois tipos; outra clínica não vê ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pac::text)::text, true);
  set local role authenticated; select count(*) into n from public.supplements where patient_id=pt; reset role;
  if n <> 2 then fails:=fails||'patient_read(got '||n||') '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_out::text)::text, true);
  set local role authenticated; select count(*) into n from public.supplements where patient_id=pt; reset role;
  if n <> 0 then fails:=fails||'outsider_read(got '||n||') '; end if;

  -- ══ relatório traz tipo, marca e lembrete ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_nut::text)::text, true);
  set local role authenticated; select public.export_patient_report(pt, current_date-30, current_date, array['supplements'], 'web') into v; reset role;
  if jsonb_array_length(v->'sections'->'supplements') <> 2 then fails:=fails||'rpt_rows '; end if;
  if (v->'sections'->'supplements'->0->>'kind') is distinct from 'supplement' or (v->'sections'->'supplements'->0->>'brand') is distinct from 'Marca Y'
     or (v->'sections'->'supplements'->0->>'reminder_time') is distinct from '07:00:00' then fails:=fails||'rpt_supp_fields '; end if;
  if (v->'sections'->'supplements'->1->>'kind') is distinct from 'medication' then fails:=fails||'rpt_med_kind '; end if;

  if fails <> '' then raise exception 'WP-SUPP-A FAILS: %', fails; end if;
  raise notice 'WP-SUPP-A: OK';
end $$;
rollback;
