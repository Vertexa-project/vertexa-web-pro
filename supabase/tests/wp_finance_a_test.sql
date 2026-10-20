-- WP-FIN · A — testes (ROLLBACK). Assume 20261025090000 e 20261027090000 aplicadas/concatenadas.
begin;
do $$
declare
  fails text := ''; st text; n int; v jsonb; cid uuid; cid2 uuid; cur date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  prev date; nxt date;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); mem uuid:=gen_random_uuid(); au_mem uuid:=gen_random_uuid();
  oth uuid:=gen_random_uuid(); au_oth uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid(); p4 uuid:=gen_random_uuid(); p5 uuid:=gen_random_uuid(); u5 uuid:=gen_random_uuid(); t5 uuid:=gen_random_uuid();
  u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); u3 uuid:=gen_random_uuid(); u4 uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid(); t4 uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid(); eMem uuid:=gen_random_uuid(); eOth uuid:=gen_random_uuid();
begin
  prev := (cur - interval '1 month')::date; nxt := (cur + interval '1 month')::date;
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(mem,au_mem,'professional','Membro','active',now()),(oth,au_oth,'admin','Admin B','active',now()),
    (p1,u1,'patient','Paciente Um','active',now() - interval '60 days'),(p2,u2,'patient','Paciente Dois','active',now() - interval '60 days'),
    (p3,u3,'patient','Paciente Tres','pending',now()),(p4,u4,'patient','Paciente Quatro','active',now()),(p5,u5,'patient','Paciente Cinco','active',now() - interval '60 days');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm),(clB,'B',oth);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin'),(eMem,mem,clA,'nutritionist','member'),(eOth,oth,clB,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id) values (t1,p1,clA),(t2,p2,clA),(t3,p3,clA),(t4,p4,clB),(t5,p5,clA);
  insert into public.activity_events (patient_id,type,payload) values (t1,'meal_logged','{}'::jsonb); -- t1 ativo agora; t2 parado

  -- ══ permissões ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true);
  set local role authenticated;
  begin perform public.set_patient_billing(t1, 10000, 10); fails:=fails||'member_set ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'mem_set_sqlstate('||st||') '; end if; end;
  begin perform public.finance_overview(clA, cur); fails:=fails||'member_overview ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'mem_ov_sqlstate('||st||') '; end if; end;
  begin perform * from public.finance_patients(clA); fails:=fails||'member_patients ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'mem_pt_sqlstate('||st||') '; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_oth::text)::text, true);
  set local role authenticated;
  begin perform public.set_patient_billing(t1, 10000, 10); fails:=fails||'cross_set ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'cross_set_sqlstate('||st||') '; end if; end;
  begin perform public.generate_month_charges(clA, cur); fails:=fails||'cross_gen ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'cross_gen_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ admin configura valores ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  perform public.set_patient_billing(t1, 20000, 10);            -- R$ 200,00 dia 10
  perform public.set_patient_billing(t2, 30000, 5);             -- R$ 300,00 dia 5
  perform public.set_patient_billing(t3, 15000, 10);            -- paciente pendente (não gera cobrança)
  perform public.set_patient_billing(t5, 99900, 10, false);     -- cobrança desligada (não gera cobrança)
  begin perform public.set_patient_billing(t1, -1, 10); fails:=fails||'neg_amount ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'neg_sqlstate('||st||') '; end if; end;
  begin perform public.set_patient_billing(t1, 100, 29); fails:=fails||'due_29 ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'due29_sqlstate('||st||') '; end if; end;
  select count(*) into n from public.patient_billing; if n<>4 then fails:=fails||'admin_sees_billing(got '||n||') '; end if;

  -- ══ gerar cobranças ══
  reset role; update public.patient_billing set started_on = (cur - interval '100 days')::date where patient_id in (t1,t2,t3,t5); set local role authenticated;
  select public.generate_month_charges(clA, prev) into n; if n<>2 then fails:=fails||'gen_prev(got '||n||') '; end if;
  select public.generate_month_charges(clA, prev) into n; if n<>0 then fails:=fails||'gen_idem '; end if;
  begin perform public.generate_month_charges(clA, (cur + interval '3 months')::date); fails:=fails||'gen_future ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'genfuture_sqlstate('||st||') '; end if; end;
  begin perform public.generate_month_charges(clA, (cur - interval '13 months')::date); fails:=fails||'gen_old ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'genold_sqlstate('||st||') '; end if; end;
  reset role;
  select id into cid from public.patient_charges where patient_id=t1 and competence=prev;
  select id into cid2 from public.patient_charges where patient_id=t2 and competence=prev;
  if (select due_on from public.patient_charges where id=cid) <> make_date(extract(year from prev)::int, extract(month from prev)::int, 10) then fails:=fails||'due_date '; end if;
  if exists (select 1 from public.patient_charges where patient_id in (t3,t5)) then fails:=fails||'pending_or_off_patient_charged '; end if;

  -- ══ visão geral do mês passado: tudo em atraso (vencimentos já passaram) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  v := public.finance_overview(clA, prev);
  if (v->>'expected_cents')::int<>50000 or (v->>'overdue_cents')::int<>50000 or (v->>'overdue_count')::int<>2 or (v->>'received_cents')::int<>0 then
    fails:=fails||'ov_overdue('||v::text||') '; end if;
  -- ══ pagar: t1 paga ══
  perform public.mark_charge_paid(cid);
  perform public.mark_charge_paid(cid);  -- idempotente
  begin perform public.mark_charge_paid(cid2, current_date + 2); fails:=fails||'paid_future ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'paidfuture_sqlstate('||st||') '; end if; end;
  v := public.finance_overview(clA, prev);
  if (v->>'received_cents')::int<>20000 or (v->>'overdue_cents')::int<>30000 or (v->>'overdue_count')::int<>1 then fails:=fails||'ov_after_paid('||v::text||') '; end if;
  -- não cancela paga; reabre e cancela
  begin perform public.cancel_charge(cid); fails:=fails||'cancel_paid ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'cancelpaid_sqlstate('||st||') '; end if; end;
  perform public.cancel_charge(cid2);
  begin perform public.mark_charge_paid(cid2); fails:=fails||'pay_canceled ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'paycanceled_sqlstate('||st||') '; end if; end;
  v := public.finance_overview(clA, prev);
  if (v->>'expected_cents')::int<>20000 or (v->>'overdue_count')::int<>0 then fails:=fails||'ov_canceled('||v::text||') '; end if;
  perform public.reopen_charge(cid2);
  select count(*) into n from public.finance_charges(clA, prev) where status='pending' and overdue; if n<>1 then fails:=fails||'charges_overdue(got '||n||') '; end if;
  perform public.reopen_charge(cid);
  select count(*) into n from public.patient_charges where id=cid and status='pending' and paid_on is null; if n<>1 then fails:=fails||'reopen '; end if;

  -- ══ mudar valor: pendentes do mês atual em diante acompanham; as de meses passados não ══
  perform public.generate_month_charges(clA, nxt);
  perform public.mark_charge_paid(cid);
  perform public.set_patient_billing(t1, 25000, 12);
  reset role;
  if (select amount_cents from public.patient_charges where patient_id=t1 and competence=nxt) <> 25000 then fails:=fails||'future_pending_updated '; end if;
  if (select due_on from public.patient_charges where patient_id=t1 and competence=nxt) <> make_date(extract(year from nxt)::int, extract(month from nxt)::int, 12) then fails:=fails||'future_due_updated '; end if;
  if (select amount_cents from public.patient_charges where id=cid) <> 20000 then fails:=fails||'past_paid_changed '; end if;

  -- ══ receita em risco e projeção ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  v := public.finance_overview(clA, cur);
  -- ativos pagantes: t1 (250,00, ativo agora) e t2 (300,00, parado há 60 dias); t3 pendente fora
  if (v->>'at_risk_patients')::int<>1 or (v->>'at_risk_cents')::int<>30000 then fails:=fails||'at_risk('||v::text||') '; end if;
  if (v->>'billed_patients')::int<>2 or (v->>'ticket_avg_cents')::int<>27500 then fails:=fails||'ticket('||v::text||') '; end if;
  if jsonb_array_length(v->'projection')<>3 or (v->'projection'->0->>'expected_cents')::int<>55000 then fails:=fails||'projection('||(v->>'projection')||') '; end if;
  if (v->>'unconfigured_patients')::int<>0 then fails:=fails||'unconfigured '; end if;
  -- desativa t2: sai de risco, de projeção e de novas cobranças
  perform public.mark_charge_paid((select id from public.patient_charges where patient_id=t2 and competence=nxt));
  perform public.set_patient_billing(t2, 31000, 5, false);
  if (select amount_cents from public.patient_charges where patient_id=t2 and competence=nxt) <> 30000 then fails:=fails||'paid_future_changed '; end if;
  v := public.finance_overview(clA, cur);
  if (v->>'at_risk_patients')::int<>0 or (v->'projection'->0->>'expected_cents')::int<>25000 then fails:=fails||'inactive_billing('||v::text||') '; end if;
  select count(*) into n from public.finance_patients(clA); if n<>3 then fails:=fails||'finpatients(got '||n||') '; end if;
  reset role;

  -- ══ isolamento: membro/paciente/outra clínica não lêem tabelas ══
  foreach cid in array array[au_mem, u1, au_oth] loop
    perform set_config('request.jwt.claims', json_build_object('sub',cid::text)::text, true);
    set local role authenticated;
    select (select count(*) from public.patient_billing) + (select count(*) from public.patient_charges) into n;
    reset role;
    if n<>0 then fails:=fails||'leak_read('||n||') '; end if;
  end loop;
  -- escrita direta bloqueada até para admin
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  begin update public.patient_charges set status='paid', paid_on=current_date where patient_id=t1; fails:=fails||'direct_update ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'direct_sqlstate('||st||') '; end if; end;
  reset role;

  if fails <> '' then raise exception 'WP-FIN-A FAILS: %', fails; end if;
  raise notice 'WP-FIN-A: OK';
end $$;
rollback;
