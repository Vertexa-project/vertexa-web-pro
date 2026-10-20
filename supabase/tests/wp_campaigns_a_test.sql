-- WP-CAMP · A — testes (ROLLBACK). Assume 20261025090000 aplicada/concatenada.
begin;
do $$
declare
  fails text := ''; st text; n int; v jsonb; cid uuid; camp record;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid();
  mem uuid:=gen_random_uuid(); au_mem uuid:=gen_random_uuid();
  oth uuid:=gen_random_uuid(); au_oth uuid:=gen_random_uuid();
  pA uuid:=gen_random_uuid(); pB uuid:=gen_random_uuid(); pC uuid:=gen_random_uuid(); pD uuid:=gen_random_uuid(); pX uuid:=gen_random_uuid();
  uA uuid:=gen_random_uuid(); uB uuid:=gen_random_uuid(); uC uuid:=gen_random_uuid(); uD uuid:=gen_random_uuid(); uX uuid:=gen_random_uuid();
  tA uuid:=gen_random_uuid(); tB uuid:=gen_random_uuid(); tC uuid:=gen_random_uuid(); tD uuid:=gen_random_uuid(); tX uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  eAdm uuid:=gen_random_uuid(); eMem uuid:=gen_random_uuid(); eOth uuid:=gen_random_uuid();
  today date := date '2026-10-21';
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(mem,au_mem,'professional','Membro','active',now()),(oth,au_oth,'admin','Admin B','active',now()),
    -- A: entrou hoje, aniversário hoje, sem atividade
    (pA,uA,'patient','Ana Souza','active',timestamptz '2026-10-21 12:00:00+00'),
    -- B: entrou há 45 dias (múltiplo de 15 e 30 mais ~0), sem atividade, vinculado ao membro
    (pB,uB,'patient','Bruno Lima','active',timestamptz '2026-09-06 12:00:00+00'),
    -- C: entrou há 40 dias, ATIVO ontem
    (pC,uC,'patient','Carla Dias','active',timestamptz '2026-09-11 12:00:00+00'),
    -- D: pendente (não recebe)
    (pD,uD,'patient','Dora Reis','pending',timestamptz '2026-10-21 12:00:00+00'),
    -- X: outra clínica
    (pX,uX,'patient','Xavier Outro','active',timestamptz '2026-10-21 12:00:00+00');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm),(clB,'B',oth);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (eAdm,adm,clA,'nutritionist','admin'),(eMem,mem,clA,'nutritionist','member'),(eOth,oth,clB,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id,birth_date) values
    (tA,pA,clA,date '1990-10-21'),(tB,pB,clA,date '1985-03-03'),(tC,pC,clA,date '1992-10-05'),(tD,pD,clA,null),(tX,pX,clB,date '1990-10-21');
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (eMem,tB,false,'active'),(eMem,tC,false,'active');
  insert into public.activity_events (patient_id,type,payload,created_at) values (tC,'meal_logged','{}'::jsonb,timestamptz '2026-10-20 15:00:00+00');

  -- ══ modelos: só admin cria; membro não; nascem DESLIGADOS; idempotente ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true);
  set local role authenticated;
  begin perform public.ensure_clinic_campaigns(clA); fails:=fails||'member_ensure ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'ensure_sqlstate('||st||') '; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  select public.ensure_clinic_campaigns(clA) into n; if n<>5 then fails:=fails||'ensure_5(got '||n||') '; end if;
  select public.ensure_clinic_campaigns(clA) into n; if n<>0 then fails:=fails||'ensure_idem '; end if;
  select count(*) into n from public.campaigns where clinic_id=clA and is_active; if n<>0 then fails:=fails||'born_active '; end if;
  reset role;

  -- desligado ⇒ nada enviado
  select private.run_campaigns(clA, today) into n; if n<>0 then fails:=fails||'off_sends(got '||n||') '; end if;

  -- ══ liga tudo (admin edita só conteúdo/liga) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  update public.campaigns set is_active=true where clinic_id=clA;
  get diagnostics n = row_count; if n<>5 then fails:=fails||'admin_toggle(got '||n||') '; end if;
  begin update public.campaigns set trigger='birthday' where clinic_id=clA and trigger='welcome'; fails:=fails||'trigger_mutable ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'trig_sqlstate('||st||') '; end if; end;
  begin update public.campaigns set message_template=repeat('x',501) where clinic_id=clA and trigger='welcome'; fails:=fails||'body_501 ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'body_sqlstate('||st||') '; end if; end;
  reset role;
  -- membro NÃO liga/desliga
  perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true);
  set local role authenticated;
  update public.campaigns set is_active=false where clinic_id=clA;
  get diagnostics n = row_count; if n<>0 then fails:=fails||'member_toggle '; end if;
  reset role;

  select private.run_campaigns(clA, today) into n;
  -- A: welcome + birthday (2). B: checkin (45/15=3, 45%15=0) + return (45/30=1, 45%30=15>2 → não) + reactivation (idle 45) = 2.
  -- C: checkin (40/15=2, 40%15=10 → não), return (40/30=1, 10 → não), reactivation (idle 1 → não) = 0. D pendente 0. X outra clínica 0.
  if n<>4 then fails:=fails||'run_total(got '||n||') '; end if;
  select count(*) into n from public.notifications where patient_id=tA and type='professional' and title like 'Bem-vindo(a), Ana!'; if n<>1 then fails:=fails||'welcome_render '; end if;
  select count(*) into n from public.notifications where patient_id=tA and title like 'Feliz aniversário, Ana!%' and type='motivation'; if n<>1 then fails:=fails||'birthday '; end if;
  select count(*) into n from public.notifications where patient_id=tB and type='reminder' and title='Como você está, Bruno?'; if n<>1 then fails:=fails||'checkin_B '; end if;
  select count(*) into n from public.notifications where patient_id=tB and type='retention' and title='Sentimos sua falta, Bruno'; if n<>1 then fails:=fails||'reactivation_B '; end if;
  select count(*) into n from public.notifications where patient_id=tB and title='Hora de agendar seu retorno'; if n<>0 then fails:=fails||'return_B_early '; end if;
  select count(*) into n from public.notifications where patient_id in (tC,tD,tX); if n<>0 then fails:=fails||'leak(got '||n||') '; end if;

  -- ══ idempotência: rodar de novo no mesmo dia não repete ══
  select private.run_campaigns(clA, today) into n; if n<>0 then fails:=fails||'rerun_dup(got '||n||') '; end if;
  select count(*) into n from public.notifications where patient_id=tB; if n<>2 then fails:=fails||'dup_B(got '||n||') '; end if;
  -- dia seguinte: bem-vindo não repete; reativação do mesmo episódio não repete
  select private.run_campaigns(clA, today+1) into n; if n<>0 then fails:=fails||'nextday_dup(got '||n||') '; end if;
  -- C fica 3 dias sem atividade com limiar 7 ⇒ ainda não; em today+7 (idle 8) ⇒ reativação
  select private.run_campaigns(clA, today+7) into n;
  select count(*) into n from public.notifications where patient_id=tC and type='retention'; if n<>1 then fails:=fails||'reactivation_C(got '||n||') '; end if;
  -- B em today+15 (idade 60 = 2×30): retorno
  select private.run_campaigns(clA, today+15) into n;
  select count(*) into n from public.notifications where patient_id=tB and title='Hora de agendar seu retorno'; if n<>1 then fails:=fails||'return_B(got '||n||') '; end if;

  -- ══ paciente lê só as suas ══
  perform set_config('request.jwt.claims', json_build_object('sub',uB::text)::text, true);
  set local role authenticated; select count(*) into n from public.notifications; reset role;
  if n<>(select count(*) from public.notifications where patient_id=tB) or n=0 then fails:=fails||'patient_scope(got '||n||') '; end if;

  -- ══ disparo manual ══
  insert into public.activity_events (patient_id,type,payload) values (tC,'meal_logged','{}'::jsonb); -- C ativo AGORA (independe da data real)
  perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true);
  set local role authenticated;
  select public.preview_broadcast(clA,'mine') into n; if n<>2 then fails:=fails||'mine_preview(got '||n||') '; end if;
  begin perform public.preview_broadcast(clA,'all'); fails:=fails||'member_all ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'all_sqlstate('||st||') '; end if; end;
  begin perform public.preview_broadcast(clB,'mine'); fails:=fails||'cross_clinic ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'cross_sqlstate('||st||') '; end if; end;
  begin perform public.send_broadcast(clA,'mine',null,'','x'); fails:=fails||'empty_title ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'title_sqlstate('||st||') '; end if; end;
  v := public.send_broadcast(clA,'mine',null,'Aviso, {nome}','Consulta de revisão semana que vem.');
  if (v->>'recipients')::int<>2 then fails:=fails||'send_mine('||v::text||') '; end if;
  reset role;
  select count(*) into n from public.notifications where title in ('Aviso, Bruno','Aviso, Carla') and type='professional'; if n<>2 then fails:=fails||'send_render(got '||n||') '; end if;
  select count(*) into n from public.notifications where title like 'Aviso%' and patient_id in (tA,tD,tX); if n<>0 then fails:=fails||'send_leak '; end if;
  -- inativos entre os meus: C ativo agora ⇒ com 400 dias ninguém; com 1 dia só o B
  perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true);
  set local role authenticated;
  select public.preview_broadcast(clA,'mine_inactive',400) into n; if n<>0 then fails:=fails||'inactive_400(got '||n||') '; end if;
  select public.preview_broadcast(clA,'mine_inactive',1) into n; if n<>1 then fails:=fails||'inactive_1(got '||n||') '; end if;
  reset role;
  -- admin: all = A,B,C (D pendente fora)
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  select public.preview_broadcast(clA,'all') into n; if n<>3 then fails:=fails||'all_preview(got '||n||') '; end if;
  select count(*) into n from public.campaign_broadcasts; if n<>1 then fails:=fails||'admin_sees_history(got '||n||') '; end if;
  reset role;
  -- histórico: membro vê o seu; outra clínica não vê
  perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true);
  set local role authenticated; select count(*) into n from public.campaign_broadcasts; reset role;
  if n<>1 then fails:=fails||'member_history '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_oth::text)::text, true);
  set local role authenticated; select count(*) into n from public.campaign_broadcasts; reset role;
  if n<>0 then fails:=fails||'other_clinic_history '; end if;
  -- paciente não dispara nem lê campanhas
  perform set_config('request.jwt.claims', json_build_object('sub',uB::text)::text, true);
  set local role authenticated;
  begin perform public.send_broadcast(clA,'mine',null,'x','y'); fails:=fails||'patient_send ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'patsend_sqlstate('||st||') '; end if; end;
  select count(*) into n from public.campaigns; if n<>0 then fails:=fails||'patient_reads_campaigns '; end if;
  reset role;

  if fails <> '' then raise exception 'WP-CAMP-A FAILS: %', fails; end if;
  raise notice 'WP-CAMP-A: OK';
end $$;
rollback;
