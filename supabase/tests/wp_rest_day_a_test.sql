-- WP-REST · A — testes (ROLLBACK). Assume 20261023090000 aplicada/concatenada.
begin;
do $$
declare
  fails text := ''; st text; n int; s int;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  pOut uuid:=gen_random_uuid(); au_pOut uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pxA uuid:=gen_random_uuid(); au_pxA uuid:=gen_random_uuid();
  pxB uuid:=gen_random_uuid(); au_pxB uuid:=gen_random_uuid();
  px3 uuid:=gen_random_uuid(); px4 uuid:=gen_random_uuid(); px5 uuid:=gen_random_uuid(); px6 uuid:=gen_random_uuid(); px7 uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); eOut uuid:=gen_random_uuid();
  da uuid:=gen_random_uuid(); db uuid:=gen_random_uuid();
  q1 uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); q3 uuid:=gen_random_uuid(); q4 uuid:=gen_random_uuid(); q5 uuid:=gen_random_uuid();
  pq1 uuid:=gen_random_uuid(); pq2 uuid:=gen_random_uuid(); pq3 uuid:=gen_random_uuid(); pq4 uuid:=gen_random_uuid(); pq5 uuid:=gen_random_uuid(); pq6 uuid:=gen_random_uuid(); q6 uuid:=gen_random_uuid();
  t date := private.brt_date(now());
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),(pOut,au_pOut,'professional','POut','active'),
    (adminB,au_adminB,'admin','Admin B','active'),(pxA,au_pxA,'patient','Paciente A','active'),(pxB,au_pxB,'patient','Paciente B','active'),
    (pq1,null,'patient','Q1','active'),(pq2,null,'patient','Q2','active'),(pq3,null,'patient','Q3','active'),(pq4,null,'patient','Q4','active'),(pq5,null,'patient','Q5','active'),(pq6,null,'patient','Q6','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (e1,p1,clA,'nutritionist','member'),(eOut,pOut,clB,'doctor','member');
  insert into public.patients (id,profile_id,clinic_id) values (da,pxA,clA),(db,pxB,clA),(q1,pq1,clA),(q2,pq2,clA),(q3,pq3,clA),(q4,pq4,clA),(q5,pq5,clA),(q6,pq6,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,da,false,'active');

  -- ══ SEQUÊNCIA (como postgres) ══
  -- q1: sem descanso, eventos em t-1,t-2,t-3 → 3 (comportamento antigo preservado)
  insert into public.activity_events (patient_id,type,payload,created_at) select q1,'hydration_logged','{}', ((t-g)::text||' 12:00:00-03')::timestamptz from generate_series(1,3) g;
  s := private.event_streak_brt(q1); if s <> 3 then fails:=fails||'base(got '||s||') '; end if;
  -- q2: eventos hoje e t-2 (t-1 vazio, sem descanso) → 1 (quebra)
  insert into public.activity_events (patient_id,type,payload,created_at) values (q2,'hydration_logged','{}',(t::text||' 12:00:00-03')::timestamptz),(q2,'hydration_logged','{}',((t-2)::text||' 12:00:00-03')::timestamptz);
  s := private.event_streak_brt(q2); if s <> 1 then fails:=fails||'gap_breaks(got '||s||') '; end if;
  -- ... com descanso em t-1 → hoje + t-2 = 2 (descanso atravessa e NÃO soma)
  insert into public.rest_days (patient_id,rest_on) values (q2,t-1);
  s := private.event_streak_brt(q2); if s <> 2 then fails:=fails||'rest_bridges(got '||s||') '; end if;
  -- q3: descanso hoje, eventos t-1,t-2 → 2
  insert into public.activity_events (patient_id,type,payload,created_at) select q3,'hydration_logged','{}', ((t-g)::text||' 12:00:00-03')::timestamptz from generate_series(1,2) g;
  insert into public.rest_days (patient_id,rest_on) values (q3,t);
  s := private.event_streak_brt(q3); if s <> 2 then fails:=fails||'rest_today(got '||s||') '; end if;
  -- q4: só descanso, sem evento nenhum → 0 (descanso não vira dia ativo)
  insert into public.rest_days (patient_id,rest_on) values (q4,t);
  s := private.event_streak_brt(q4); if s <> 0 then fails:=fails||'rest_only(got '||s||') '; end if;
  -- q5: descanso há 4 dias não cobre buraco em t-1 (sem ligação com hoje) → 1
  insert into public.activity_events (patient_id,type,payload,created_at) values (q5,'hydration_logged','{}',(t::text||' 12:00:00-03')::timestamptz),(q5,'hydration_logged','{}',((t-5)::text||' 12:00:00-03')::timestamptz);
  insert into public.rest_days (patient_id,rest_on) values (q5,t-4);
  s := private.event_streak_brt(q5); if s <> 1 then fails:=fails||'rest_isolated(got '||s||') '; end if;

  -- ══ profissional vinculado NÃO grava descanso do paciente (ainda sem descansos → barra é a RLS) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
  begin insert into public.rest_days (patient_id,rest_on) values (da,t); fails:=fails||'prof_write ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'profwrite_sqlstate('||st||') '; end if; end;
  reset role;

  -- q6: descanso hoje E ontem, eventos t-2,t-3 → 2 (dois descansos seguidos atravessados)
  insert into public.activity_events (patient_id,type,payload,created_at) select q6,'hydration_logged','{}', ((t-g)::text||' 12:00:00-03')::timestamptz from generate_series(2,3) g;
  insert into public.rest_days (patient_id,rest_on) values (q6,t),(q6,t-1);
  s := private.event_streak_brt(q6); if s <> 2 then fails:=fails||'two_rests(got '||s||') '; end if;

  -- ══ PACIENTE A marca descanso ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pxA::text)::text, true);
  set local role authenticated;
  insert into public.rest_days (patient_id,rest_on) values (da,t);
  begin insert into public.rest_days (patient_id,rest_on) values (da,t); fails:=fails||'dup ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23505' then fails:=fails||'dup_sqlstate('||st||') '; end if; end;
  insert into public.rest_days (patient_id,rest_on) values (da,t-1);
  begin insert into public.rest_days (patient_id,rest_on) values (da,t-1); fails:=fails||'dup2 '; exception when others then null; end;
  -- 3º dia dentro de 7 dias: precisa ser ontem/hoje (já usados) → força via delete+reinsert não é possível; testa limite com trigger direto abaixo
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_pxB::text)::text, true);
  set local role authenticated;
  begin insert into public.rest_days (patient_id,rest_on) values (db,t+1); fails:=fails||'future ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'future_sqlstate('||st||') '; end if; end;
  begin insert into public.rest_days (patient_id,rest_on) values (db,t-5); fails:=fails||'old ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'old_sqlstate('||st||') '; end if; end;
  begin insert into public.rest_days (patient_id,rest_on) values (da,t-2); fails:=fails||'forge ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'forge_sqlstate('||st||') '; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_pxA::text)::text, true);
  set local role authenticated;
  -- desfazer o de hoje
  delete from public.rest_days where patient_id=da and rest_on=t;
  get diagnostics n = row_count; if n <> 1 then fails:=fails||'undo '; end if;
  reset role;

  -- limite 2/7 dias: já há t-1 (A). Insere t-3 como postgres (já passou da RLS) e tenta hoje → 3º → recusa
  insert into public.rest_days (patient_id,rest_on) values (da,t-3);
  perform set_config('request.jwt.claims', json_build_object('sub',au_pxA::text)::text, true);
  set local role authenticated;
  begin insert into public.rest_days (patient_id,rest_on) values (da,t); fails:=fails||'limit_not_enforced ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'limit_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ profissional vinculado LÊ mas não escreve; outra clínica não vê ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.rest_days where patient_id=da; if n <> 2 then fails:=fails||'linked_read(got '||n||') '; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_pOut::text)::text, true);
  set local role authenticated; select count(*) into n from public.rest_days where patient_id=da; reset role;
  if n <> 0 then fails:=fails||'outsider_read(got '||n||') '; end if;
  set local role anon;
  begin perform 1 from public.rest_days; fails:=fails||'anon ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'anon_sqlstate('||st||') '; end if; end;
  reset role;

  if fails <> '' then raise exception 'WP-REST-A FAILS: %', fails; end if;
  raise notice 'WP-REST-A: OK';
end $$;
rollback;
