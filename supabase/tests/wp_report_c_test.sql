-- =====================================================================================
-- WP-REPORT · C — TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20261016090000 aplicada. Fixtures como postgres (bypassrls); nada persiste.
--
-- DESTAQUES: água soma por dia em America/Sao_Paulo (23h30 do dia 1 em SP fica no dia 1, mesmo sendo dia 2
-- em UTC); alias legado payload.amount; litros não numéricos ignorados (sem quebrar); suplementação conta
-- suplementos DISTINTOS por dia; fora do período não entra; quem não é vinculado ⟂ (42501) nas seções novas.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; v jsonb; st text;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  pOut uuid:=gen_random_uuid(); au_pOut uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pxProf uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); eOut uuid:=gen_random_uuid();
  daX uuid:=gen_random_uuid();
  s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid();
  d1 date := current_date - 10; d2 date := current_date - 9; dOut date := current_date - 60;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),
    (pOut,au_pOut,'professional','POut','active'),(adminB,au_adminB,'admin','Admin B','active'),
    (pxProf,null,'patient','Paciente X','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,p1,clA,'nutritionist','member'),(eOut,pOut,clB,'doctor','member');
  insert into public.patients (id,profile_id,clinic_id) values (daX,pxProf,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,daX,false,'active');
  insert into public.supplements (id,patient_id,name,dose,time_label,order_index) values
    (s1,daX,'Whey','30 g','Pós',0),(s2,daX,'Creatina','5 g','Manhã',1);

  -- Água: dia d1 = 2 registros (1.0 + 1.5, o 2º às 23h30 em São Paulo) ; d2 = alias legado amount=2 ; lixo ignorado ; fora do período
  insert into public.activity_events (patient_id,type,payload,created_at) values
    (daX,'hydration_logged','{"liters":1.0}', (d1::text||' 12:00:00-03')::timestamptz),
    (daX,'hydration_logged','{"liters":1.5}', (d1::text||' 23:30:00-03')::timestamptz),
    (daX,'hydration_logged','{"amount":2}',   (d2::text||' 09:00:00-03')::timestamptz),
    (daX,'hydration_logged','{"liters":"muita"}', (d2::text||' 10:00:00-03')::timestamptz),
    (daX,'hydration_logged','{"liters":9}',   (dOut::text||' 10:00:00-03')::timestamptz),
    (daX,'weight_logged','{"liters":7}',      (d1::text||' 10:00:00-03')::timestamptz);
  -- Suplementação: d1 = 2 distintos ; d2 = 1 ; fora do período = 1
  insert into public.supplement_intakes (patient_id,supplement_id,taken_on,source) values
    (daX,s1,d1,'app'),(daX,s2,d1,'app'),(daX,s1,d2,'app'),(daX,s1,dOut,'app');

  -- ══ POSITIVO: P1 (vinculado) exporta as duas seções novas ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
    select public.export_patient_report(daX, current_date-30, current_date, array['hydration','supplement_intakes'], 'web') into v;
  reset role;
  if jsonb_array_length(v->'sections'->'hydration') <> 2 then fails:=fails||'hyd_days(got '||jsonb_array_length(v->'sections'->'hydration')||') '; end if;
  if (v->'sections'->'hydration'->0->>'day')::date <> d1 then fails:=fails||'hyd_day1 '; end if;
  if (v->'sections'->'hydration'->0->>'liters')::numeric <> 2.5 then fails:=fails||'hyd_sum_tz(got '||(v->'sections'->'hydration'->0->>'liters')||') '; end if;
  if (v->'sections'->'hydration'->0->>'entries')::int <> 2 then fails:=fails||'hyd_entries '; end if;
  if (v->'sections'->'hydration'->1->>'liters')::numeric <> 2 then fails:=fails||'hyd_legacy_amount_and_garbage(got '||(v->'sections'->'hydration'->1->>'liters')||') '; end if;
  if jsonb_array_length(v->'sections'->'supplement_intakes') <> 2 then fails:=fails||'sup_days '; end if;
  if (v->'sections'->'supplement_intakes'->0->>'taken')::int <> 2 then fails:=fails||'sup_distinct_day1 '; end if;
  if (v->'sections'->'supplement_intakes'->1->>'taken')::int <> 1 then fails:=fails||'sup_day2 '; end if;
  if (v->'sections'->'supplement_intakes'->0->>'total')::int <> 2 then fails:=fails||'sup_total '; end if;
  if (v->'meta'->>'record_count')::int <> 4 then fails:=fails||'count(got '||(v->'meta'->>'record_count')||') '; end if;
  if (v->'meta'->>'truncated')::bool <> false then fails:=fails||'trunc '; end if;

  -- ══ seção que não existe continua recusada (lista fechada) ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
    set local role authenticated;
      perform public.export_patient_report(daX, current_date-30, current_date, array['xyz'], 'web');
    reset role;
    fails:=fails||'unknown_should_be_refused ';
  exception when others then
    reset role;
    get stacked diagnostics st = returned_sqlstate;
    if st <> '22023' then fails:=fails||'unknown_section_sqlstate(got '||st||') '; end if;
  end;

  -- ══ NEGATIVO: profissional de OUTRA clínica não exporta as seções novas (42501) ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_pOut::text)::text, true);
    set local role authenticated;
      perform public.export_patient_report(daX, current_date-30, current_date, array['hydration'], 'web');
    reset role;
    fails:=fails||'outsider_should_be_denied ';
  exception when others then
    reset role;
    get stacked diagnostics st = returned_sqlstate;
    if st <> '42501' then fails:=fails||'outsider_sqlstate(got '||st||') '; end if;
  end;

  if fails <> '' then raise exception 'WP-REPORT-C FAILS: %', fails; end if;
  raise notice 'WP-REPORT-C: OK';
end $$;
rollback;
