-- WP-FIN · A2 — testes (ROLLBACK). Assume 20261027090000 e 20261027100000 aplicadas/concatenadas.
begin;
do $$
declare
  fails text := ''; n int; cur date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date; today_d int := extract(day from (now() at time zone 'America/Sao_Paulo')::date)::int;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid();
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(p1,gen_random_uuid(),'patient','Pac Um','active',now()),
    (p2,gen_random_uuid(),'patient','Pac Dois','active',now()),(p3,gen_random_uuid(),'patient','Pac Tres','pending',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id) values (t1,p1,clA),(t2,p2,clA),(t3,p3,clA);
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  -- vencimento ainda por vir (28 >= hoje, exceto dias 29-31 que nunca passam de 28... hoje<=28 garante)
  if today_d <= 28 then
    perform public.set_patient_billing(t1, 20000, 28);
    select count(*) into n from public.patient_charges where patient_id=t1 and competence=cur and due_on = (cur + interval '27 days')::date and amount_cents=20000 and status='pending';
    if n<>1 then fails:=fails||'first_charge(got '||n||') '; end if;
    perform public.set_patient_billing(t1, 20000, 28);   -- idempotente
    select count(*) into n from public.patient_charges where patient_id=t1; if n<>1 then fails:=fails||'idem(got '||n||') '; end if;
  end if;
  -- vencimento já passado neste mês (dia 1 < hoje, se hoje > 1): não nasce cobrança do mês atual
  if today_d > 1 then
    perform public.set_patient_billing(t2, 15000, 1);
    select count(*) into n from public.patient_charges where patient_id=t2; if n<>0 then fails:=fails||'past_due_charged(got '||n||') '; end if;
  end if;
  -- cobrança desligada ou paciente pendente: nada
  perform public.set_patient_billing(t2, 15000, 28, false);
  select count(*) into n from public.patient_charges where patient_id=t2; if n<>0 then fails:=fails||'off_charged(got '||n||') '; end if;
  perform public.set_patient_billing(t1, 20000, 28, false);
  perform public.set_patient_billing(t3, 9900, 28);
  select count(*) into n from public.patient_charges where patient_id=t3; if n<>0 then fails:=fails||'pending_patient(got '||n||') '; end if;
  reset role;
  if fails <> '' then raise exception 'WP-FIN-A2 FAILS: %', fails; end if;
  raise notice 'WP-FIN-A2: OK';
end $$;
rollback;
