-- Medição de desempenho da FIN-E7 num Postgres LOCAL descartável, com volume realista (padrão: 6.000 vendas em 24 meses, 6.000 atendimentos, ~9.000 títulos).
-- Uso: SQL_ONLY=supabase/tests/fin_e7_perf.sql scripts/fin-e7-sql-proof.sh [porta]   (aplica o stub + E1..E7 e roda este arquivo; apaga tudo ao sair)
-- O volume vem de gerar linhas em lote (como dono do banco, com gatilhos desligados); a medição é feita COMO USUÁRIO (role authenticated + RLS/permissões reais).
\set ON_ERROR_STOP on
\timing off
set session_replication_role = replica;

create temp table pf (k text primary key, v uuid);
grant all on pf to public;
do $t$
declare c uuid; u1 uuid; u2 uuid; owner uuid; pid uuid; k integer; acq uuid; sv uuid; cat text[] := array['consulta', 'procedimento', 'aplicacao', 'sessao'];
begin
  insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'Dona da clínica') returning id into owner;
  insert into public.clinics (name, owner_profile_id) values ('Clínica volume', owner) returning id into c;
  insert into pf values ('c', c), ('owner', owner);
  insert into public.clinic_units (clinic_id, name, is_primary) values (c, 'Unidade principal', true) returning id into u1;
  insert into public.clinic_units (clinic_id, name) values (c, 'Unidade 2') returning id into u2;
  insert into pf values ('u1', u1), ('u2', u2);
  insert into public.fin_settings (clinic_id) values (c) on conflict do nothing;
  insert into public.fin_acquirers (clinic_id, name, kind) values (c, 'Pix', 'pix') returning id into acq; insert into pf values ('acq', acq);
  -- 12 profissionais (10 com regra, 2 sem regra)
  for k in 1..12 loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'Profissional ' || k) returning id into pid;
    insert into public.professionals (profile_id, clinic_id) values (pid, c);
  end loop;
  insert into public.fin_share_rules (clinic_id, professional_id, role, target_type, rule_type, pct, valid_from)
    select c, p.id, 'responsavel', 'default', 'pct', 50, date '2020-01-01' from (select id from public.professionals where clinic_id = c order by id limit 10) p;
  -- 8 serviços
  for k in 1..8 loop
    insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Serviço ' || k, cat[1 + k % 4], 10000 * k, '{responsavel}') returning id into sv;
    insert into pf values ('sv' || k, sv);
  end loop;
  -- 400 pacientes
  insert into public.profiles (full_name) select 'Paciente ' || g from generate_series(1, 400) g;
  insert into public.patients (profile_id, clinic_id) select p.id, c from public.profiles p where p.full_name like 'Paciente %';
end $t$;

-- 6.000 vendas nos últimos 24 meses (uma linha de item, um Pix, um título; 80% liquidados), 6.000 atendimentos realizados (30% sem venda), participantes e lançamentos de repasse
do $t$
declare c uuid := (select v from pf where k = 'c'); u1 uuid := (select v from pf where k = 'u1'); u2 uuid := (select v from pf where k = 'u2'); acq uuid := (select v from pf where k = 'acq'); today date := private.fin_today();
begin
  create temp table gen (n integer, sale_id uuid, item_id uuid, pay_id uuid, appt_id uuid, d date, unit_id uuid, price integer, svc integer, pro_n integer, patient_id uuid);
  insert into gen
    select g, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), (today - (random() * 730)::int), (case when g % 3 = 0 then u2 else u1 end),
           (10000 * (1 + g % 8)), 1 + g % 8, 1 + (g % 12), (select id from public.patients where clinic_id = c order by id offset (g % 400) limit 1)
      from generate_series(1, 6000) g;
  insert into public.fin_sales (id, clinic_id, unit_id, patient_id, status, total_gross_cents, discount_cents, total_net_cents, paid_cents, seller_professional_id, created_at, cancel_reason, canceled_at)
    select sale_id, c, unit_id, patient_id, case when n % 40 = 0 then 'canceled' when n % 11 = 0 then 'open' else 'paid' end, price, 0, price, case when n % 11 = 0 or n % 40 = 0 then 0 else price end, null,
           (d::timestamp at time zone 'America/Sao_Paulo') + interval '9 hours', case when n % 40 = 0 then 'x' end, case when n % 40 = 0 then now() end from gen;
  insert into public.fin_sale_items (id, sale_id, position, item_type, service_id, description, quantity, list_price_cents, unit_price_cents, gross_cents, discount_item_cents, discount_share_cents, net_cents)
    select item_id, sale_id, 1, 'service', (select v from pf where k = 'sv' || svc), 'Serviço ' || svc, 1, price, price, price, 0, 0, price from gen;
  insert into public.fin_payments (id, clinic_id, unit_id, sale_id, acquirer_id, method, cash_key, cash_label, amount_cents, paid_on)
    select pay_id, c, unit_id, sale_id, acq, 'pix', 'pix', 'Pix', price, d from gen where n % 11 <> 0 and n % 40 <> 0;
  insert into public.fin_receivables (clinic_id, unit_id, sale_id, payment_id, installment_no, installments, gross_cents, fee_cents, net_cents, expected_date, settled_date, settled_net_cents, status)
    select c, unit_id, sale_id, pay_id, 1, 1, price, 0, price, d + (case when n % 9 = 0 then 40 else 0 end), case when n % 9 = 0 and d + 40 > today then null else d + (case when n % 9 = 0 then 40 else 0 end) end,
           case when n % 9 = 0 and d + 40 > today then null else price end, case when n % 9 = 0 and d + 40 > today then 'expected' else 'settled' end
      from gen where n % 11 <> 0 and n % 40 <> 0;
  insert into public.fin_appointments (id, clinic_id, unit_id, patient_id, service_id, service_name, sale_id, sale_item_id, performed_on, status, base_value_cents, material_cost_cents, done_at)
    select appt_id, c, unit_id, patient_id, (select v from pf where k = 'sv' || svc), 'Serviço ' || svc, case when n % 10 < 7 then sale_id end, case when n % 10 < 7 then item_id end, d, 'done',
           price, (n % 5) * 100, now() from gen;
  insert into public.fin_appointment_participants (appointment_id, clinic_id, professional_id, role, position)
    select g.appt_id, c, (select id from public.professionals where clinic_id = c order by id offset (g.pro_n - 1) limit 1), 'responsavel', 1 from gen g;
  insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, scope_id, line_key, source_date, appointment_id, amount_cents, kind)
    select c, g.unit_id, (select id from public.professionals where clinic_id = c order by id offset (g.pro_n - 1) limit 1), to_char(g.d, 'YYYY-MM'), 'pct', 'responsavel', 'appointment', g.appt_id, 'perf:' || g.n, g.d, g.appt_id, g.price / 2, 'original'
      from gen g where g.pro_n <= 10;
end $t$;
analyze;
select (select count(*) from public.fin_sales) as vendas, (select count(*) from public.fin_receivables) as titulos, (select count(*) from public.fin_appointments) as atendimentos, (select count(*) from public.fin_share_lines) as lancamentos;
set session_replication_role = origin;

-- medição COMO USUÁRIO (dona da clínica): 5 rodadas de cada chamada
create temp table tm (what text, ms numeric);
grant all on tm to public;
create function pg_temp.timeit(p_what text, p_sql text) returns void language plpgsql as $$
declare t0 timestamptz; t1 timestamptz; i integer;
begin
  for i in 1..5 loop
    t0 := clock_timestamp(); execute p_sql; t1 := clock_timestamp();
    insert into tm values (p_what, round(extract(epoch from (t1 - t0)) * 1000, 1));
  end loop;
end $$;
grant execute on function pg_temp.timeit(text, text) to public;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.profiles where id = (select v from pf where k = 'owner')), 'role', 'authenticated')::text, false);
set role authenticated;
select pg_temp.timeit('painel completo (mês atual, todas as unidades)', format('select public.fin_dashboard_summary(%L)', (select v from pf where k = 'c')));
select pg_temp.timeit('painel completo (mês de 11 meses atrás)', format('select public.fin_dashboard_summary(%L, %L)', (select v from pf where k = 'c'), to_char(now() - interval '11 month', 'YYYY-MM')));
select pg_temp.timeit('painel de uma unidade', format('select public.fin_dashboard_summary(%L, null, %L)', (select v from pf where k = 'c'), (select v from pf where k = 'u2')));
select pg_temp.timeit('lista: Vendido do mês', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'sold'));
select pg_temp.timeit('lista: Recebido do mês', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'received'));
select pg_temp.timeit('lista: A receber', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'to_receive'));
select pg_temp.timeit('lista: Em atraso', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'overdue'));
select pg_temp.timeit('lista: Atendidos sem venda', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'appt_no_sale'));
select pg_temp.timeit('lista: Atendimentos sem regra', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'unruled'));
select pg_temp.timeit('lista: Margem (composição)', format('select public.fin_dashboard_detail(%L, %L)', (select v from pf where k = 'c'), 'margin'));
reset role;
select what, min(ms) as min_ms, round(avg(ms), 1) as media_ms, max(ms) as max_ms from tm group by what order by 1;
