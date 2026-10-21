-- WP-STREAK · A3 — testes (ROLLBACK).
begin;
do $$
declare
  fails text := ''; pt uuid := gen_random_uuid(); pf uuid := gen_random_uuid(); au uuid := gen_random_uuid(); adm uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid();
  today date := private.brt_date(now()); s jsonb;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values (adm,gen_random_uuid(),'admin','Adm','active',now()),(pf,au,'patient','Pac','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm);
  insert into public.patients (id,profile_id,clinic_id) values (pt,pf,clA);
  -- hoje e anteontem com registro; ontem descanso; 4 dias atrás falha perdoada? (3 atrás com registro)
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[0,2,4]) x;
  insert into public.activity_events (patient_id,type,created_at) select pt,'meal_logged',(today - x)::timestamp + interval '12 hours' from generate_series(5,20) x;  -- dias antigos (fora da janela de 14)
  insert into public.rest_days (patient_id, rest_on) values (pt, today - 1);
  perform set_config('request.jwt.claims', json_build_object('sub',au::text)::text, true);
  set local role authenticated; s := public.my_streak_summary(); reset role;
  -- caminho: hoje(1) ontem=descanso(1) anteontem(2) [falha em -3 perdoada] -4(3)
  if s->'fulfilled' <> (select jsonb_agg(d order by d) from (select today - x as d from unnest(array[0,2,4,5,6,7,8,9,10,11,12,13]) x) q) then fails := fails || 'ful('||(s->'fulfilled')::text||') '; end if;
  if s->'protected' <> to_jsonb(array[today - 3]) then fails := fails || 'prot('||(s->'protected')::text||') '; end if;
  if (s->>'streak')::int <> 19 then fails := fails || 'streak('||s::text||') '; end if;
  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
