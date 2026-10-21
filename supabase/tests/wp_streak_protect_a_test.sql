-- WP-STREAK · A — testes (ROLLBACK). Datas relativas a hoje (BRT).
begin;
do $$
declare
  fails text := ''; n int; pt uuid := gen_random_uuid(); pf uuid := gen_random_uuid(); au uuid := gen_random_uuid();
  adm uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid();
  today date := private.brt_date(now()); m date := date_trunc('week', today::timestamp)::date; k int; s jsonb;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values (adm,gen_random_uuid(),'admin','Adm','active',now()),(pf,au,'patient','Pac','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm);
  insert into public.patients (id,profile_id,clinic_id) values (pt,pf,clA);

  -- A) hoje, ontem, (falha), anteontem-1, ...: 1 falha isolada é perdoada e não soma
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[0,1,3,4]) x;
  n := private.event_streak_brt(pt); if n <> 4 then fails := fails || 'A_gap1(got '||n||') '; end if;
  if (select count(*) from private.streak_walk(pt) where protected_day = today - 2) < 1 then fails := fails || 'A_protected_day '; end if;

  -- B) duas falhas seguidas quebram
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[0,1,4,5]) x;
  n := private.event_streak_brt(pt); if n <> 2 then fails := fails || 'B_two_in_row(got '||n||') '; end if;

  -- C) duas falhas na MESMA semana: a segunda quebra. Semana alvo = m-14..m-8; tudo coberto de m-7 até hoje.
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at)
    select pt,'meal_logged',(dd)::timestamp + interval '12 hours' from generate_series(m-7, today, interval '1 day') g(dd);
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(x)::timestamp + interval '12 hours' from unnest(array[m-8, m-10, m-12]) x;
  -- gaps em m-9 (sáb) e m-11 (qui): mesma semana. A primeira (m-9) é perdoada; a segunda (m-11) quebra em m-10.
  n := private.event_streak_brt(pt);
  k := (today - (m-10) + 1) - 1;
  if n <> k then fails := fails || 'C_same_week(got '||n||' want '||k||') '; end if;

  -- D) falhas em semanas DIFERENTES: as duas são perdoadas (gap em m-9 e m-3)
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at)
    select pt,'meal_logged',(dd)::timestamp + interval '12 hours' from generate_series(m-12, today, interval '1 day') g(dd) where dd::date not in (m-9, m-3);
  n := private.event_streak_brt(pt);
  k := (today - (m-12) + 1) - 2;
  if n <> k then fails := fails || 'D_two_weeks(got '||n||' want '||k||') '; end if;

  -- E) hoje e ontem sem registro: zero, mesmo com anteontem coberto
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[2,3,4]) x;
  n := private.event_streak_brt(pt); if n <> 0 then fails := fails || 'E_not_alive(got '||n||') '; end if;

  -- F) sem eventos
  delete from public.activity_events where patient_id = pt;
  n := private.event_streak_brt(pt); if n <> 0 then fails := fails || 'F_empty(got '||n||') '; end if;

  -- G) resumo para o app: recorde vem do maior snapshot; atual vem da regra; protegidos só dos últimos 14 dias
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[0,1,3,4]) x;
  insert into public.adherence_snapshots (patient_id,score,level,status,streak) values (pt,80,'alta','em_acompanhamento',25);
  perform set_config('request.jwt.claims', json_build_object('sub',au::text)::text, true);
  set local role authenticated;
  s := public.my_streak_summary();
  reset role;
  if (s->>'streak')::int <> 4 then fails := fails || 'G_cur('||s::text||') '; end if;
  if (s->>'best')::int <> 25 then fails := fails || 'G_best('||s::text||') '; end if;
  if s->'protected' <> to_jsonb(array[today - 2]) then fails := fails || 'G_prot('||(s->'protected')::text||') '; end if;
  -- recorde nunca fica abaixo da sequência atual
  delete from public.adherence_snapshots where patient_id = pt;
  perform set_config('request.jwt.claims', json_build_object('sub',au::text)::text, true);
  set local role authenticated; s := public.my_streak_summary(); reset role;
  if (s->>'best')::int <> 4 then fails := fails || 'G_best_floor('||s::text||') '; end if;

  -- H) descanso mantém a continuidade mas não soma; falha antiga (>14 dias) conta na sequência e fica fora dos "protegidos"
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[0,2]) x;
  insert into public.rest_days (patient_id, rest_on) values (pt, today - 1);
  n := private.event_streak_brt(pt); if n <> 2 then fails := fails || 'H_rest(got '||n||') '; end if;
  delete from public.rest_days where patient_id = pt;
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at)
    select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from generate_series(0, 25) x where x <> 20;
  perform set_config('request.jwt.claims', json_build_object('sub',au::text)::text, true);
  set local role authenticated; s := public.my_streak_summary(); reset role;
  if (s->>'streak')::int <> 25 then fails := fails || 'H_old_gap_counts(got '||s::text||') '; end if;
  if jsonb_array_length(s->'protected') <> 0 then fails := fails || 'H_old_gap_listed('||s::text||') '; end if;

  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
