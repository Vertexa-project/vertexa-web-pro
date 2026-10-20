-- =====================================================================================
-- WP-SLEEP · A — testes Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20261021090000 aplicada (ou concatenada antes deste arquivo). Nada persiste.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; v jsonb; st text; n int;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  pOut uuid:=gen_random_uuid(); au_pOut uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pxA uuid:=gen_random_uuid(); au_pxA uuid:=gen_random_uuid();
  pxB uuid:=gen_random_uuid(); au_pxB uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); eOut uuid:=gen_random_uuid();
  daA uuid:=gen_random_uuid(); daB uuid:=gen_random_uuid();
  d1 date := current_date - 5; d2 date := current_date - 4;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),
    (pOut,au_pOut,'professional','POut','active'),(adminB,au_adminB,'admin','Admin B','active'),
    (pxA,au_pxA,'patient','Paciente A','active'),(pxB,au_pxB,'patient','Paciente B','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,p1,clA,'nutritionist','member'),(eOut,pOut,clB,'doctor','member');
  insert into public.patients (id,profile_id,clinic_id) values (daA,pxA,clA),(daB,pxB,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,daA,false,'active');

  -- ══ paciente A registra o próprio sono ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pxA::text)::text, true);
  set local role authenticated;
  insert into public.sleep_logs (patient_id,slept_on,hours,quality) values (daA,d1,7.5,4),(daA,d2,6,null);

  -- corrigir horas do dia (UPDATE permitido em hours/quality)
  update public.sleep_logs set hours=8 where patient_id=daA and slept_on=d2;
  get diagnostics n = row_count;
  if n <> 1 then fails:=fails||'update_own '; end if;

  -- NEGATIVOS
  begin insert into public.sleep_logs (patient_id,slept_on,hours) values (daB,d1,7); fails:=fails||'forge_other_patient ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'forge_sqlstate('||st||') '; end if; end;
  begin insert into public.sleep_logs (patient_id,slept_on,hours) values (daA,current_date+3,7); fails:=fails||'future_day ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'future_sqlstate('||st||') '; end if; end;
  begin insert into public.sleep_logs (patient_id,slept_on,hours) values (daA,current_date-9,0); fails:=fails||'hours_zero ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'zero_sqlstate('||st||') '; end if; end;
  begin insert into public.sleep_logs (patient_id,slept_on,hours) values (daA,current_date-9,25); fails:=fails||'hours_25 ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'h25_sqlstate('||st||') '; end if; end;
  begin insert into public.sleep_logs (patient_id,slept_on,hours,quality) values (daA,current_date-9,7,6); fails:=fails||'quality_6 ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'q6_sqlstate('||st||') '; end if; end;
  begin insert into public.sleep_logs (patient_id,slept_on,hours) values (daA,d1,5); fails:=fails||'duplicate_day ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23505' then fails:=fails||'dup_sqlstate('||st||') '; end if; end;
  begin update public.sleep_logs set patient_id=daB where patient_id=daA and slept_on=d1; fails:=fails||'reassign_patient ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'reassign_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ profissional vinculado LÊ, mas não escreve; de outra clínica não vê ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.sleep_logs where patient_id=daA;
  if n <> 2 then fails:=fails||'linked_read(got '||n||') '; end if;
  begin insert into public.sleep_logs (patient_id,slept_on,hours) values (daA,current_date-8,7); fails:=fails||'prof_write ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'profwrite_sqlstate('||st||') '; end if; end;
  select public.export_patient_report(daA, current_date-30, current_date, array['sleep'], 'web') into v;
  reset role;
  if jsonb_array_length(v->'sections'->'sleep') <> 2 then fails:=fails||'rpt_rows '; end if;
  if (v->'sections'->'sleep'->0->>'day')::date <> d1 then fails:=fails||'rpt_order '; end if;
  if (v->'sections'->'sleep'->0->>'hours')::numeric is distinct from 7.5 or (v->'sections'->'sleep'->0->>'quality')::int is distinct from 4 then fails:=fails||'rpt_vals1 '; end if;
  if (v->'sections'->'sleep'->1->>'hours')::numeric is distinct from 8 or (v->'sections'->'sleep'->1->'quality') is distinct from 'null'::jsonb then fails:=fails||'rpt_vals2 '; end if;
  if (v->'meta'->>'record_count')::int <> 2 then fails:=fails||'rpt_count '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',au_pOut::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.sleep_logs where patient_id=daA;
  if n <> 0 then fails:=fails||'outsider_read(got '||n||') '; end if;
  begin perform public.export_patient_report(daA, current_date-30, current_date, array['sleep'], 'web'); fails:=fails||'outsider_report ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'outsider_rpt_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ anon: sem acesso ══
  set local role anon;
  begin perform 1 from public.sleep_logs; fails:=fails||'anon_read ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'anon_sqlstate('||st||') '; end if; end;
  reset role;

  if fails <> '' then raise exception 'WP-SLEEP-A FAILS: %', fails; end if;
  raise notice 'WP-SLEEP-A: OK';
end $$;
rollback;
