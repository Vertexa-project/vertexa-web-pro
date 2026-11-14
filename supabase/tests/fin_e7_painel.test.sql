-- Prova SQL da FIN-E7 (painel financeiro com números clicáveis) num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e7-sql-proof.sh  (cria o cluster/banco, aplica stub + E1..E7, roda este arquivo e apaga tudo).
-- Roda dentro de begin ... rollback. Datas relativas a hoje (private.fin_today()): mês atual e mês anterior.
begin;
create temp table tr (n serial, name text, ok boolean, detail text);
create temp table fx (k text primary key, v uuid);
grant all on tr, fx to authenticated; grant usage, select on sequence tr_n_seq to authenticated;

create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null) returns void language sql as
$$ insert into tr(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;
create function pg_temp.as_user(p_k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.profiles where id = pg_temp.f('prof_' || p_k)), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.expect(p_name text, p_state text, p_sql text, p_msg text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  insert into tr(name, ok, detail) values (p_name, p_state is null, case when p_state is null then 'ok' else 'passou sem erro' end);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  insert into tr(name, ok, detail) values (p_name, v_state = p_state and (p_msg is null or v_msg like '%' || p_msg || '%'), v_state || ' ' || v_msg);
end $$;
-- participantes: responsável (+ executor opcional) por chave de profissional
create function pg_temp.parts(p_resp text, p_exec text default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('professional_id', pg_temp.f('pro_' || p_resp), 'role', 'responsavel'))
      || case when p_exec is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('professional_id', pg_temp.f('pro_' || p_exec), 'role', 'executor')) end $$;
-- venda (como Gestor) + recebimento; devolve a venda. p_pay: dados do recebimento (acquirer_id etc.)
create function pg_temp.sale_pay(p_key text, p_patient text, p_items jsonb, p_pay jsonb, p_seller text default null) returns uuid language plpgsql as $$
declare s uuid; c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1');
begin
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f(p_patient), p_items, 0, null, case when p_seller is null then null else pg_temp.f('pro_' || p_seller) end);
  perform public.fin_add_payment(s, p_pay);
  perform pg_temp.su();
  insert into fx values (p_key, s);
  return s;
end $$;
create function pg_temp.svc_item(p_svc text, p_price integer default null, p_pct integer default null, p_qty integer default 1) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('item_type', 'service', 'ref_id', pg_temp.f(p_svc), 'quantity', p_qty, 'unit_price_cents', p_price, 'discount_pct', p_pct))) $$;
-- datas de liquidação dos títulos da venda (como dono do banco: simula a integração/liquidação), na ordem da parcela
create function pg_temp.settle(p_sale text, p_dates date[]) returns void language plpgsql as $$
declare r record; i integer := 0;
begin
  for r in select id from public.fin_receivables where sale_id = pg_temp.f(p_sale) order by installment_no loop
    i := i + 1;
    update public.fin_receivables set status = 'settled', settled_date = p_dates[i], settled_net_cents = net_cents, updated_at = now() where id = r.id;
  end loop;
end $$;
-- atendimento realizado gravado direto (sem as travas de data das RPCs) e reconciliado pelo motor
create function pg_temp.mk_appt(p_key text, p_patient text, p_service text, p_on date, p_parts jsonb, p_sale text default null, p_material bigint default 0) returns uuid language plpgsql as $$
declare a uuid; c uuid := pg_temp.f('c'); si uuid; sv public.fin_services; x jsonb; k integer := 0; v_base integer;
begin
  select * into sv from public.fin_services where id = pg_temp.f(p_service);
  if p_sale is not null then
    select id, net_cents into si, v_base from public.fin_sale_items where sale_id = pg_temp.f(p_sale) order by position limit 1;
  end if;
  insert into public.fin_appointments (clinic_id, unit_id, patient_id, service_id, service_name, sale_id, sale_item_id, performed_on, status, base_value_cents, material_cost_cents, done_at)
    values (c, pg_temp.f('u1'), pg_temp.f(p_patient), sv.id, sv.name, case when p_sale is null then null else pg_temp.f(p_sale) end, si, p_on, 'done', v_base, p_material, now()) returning id into a;
  for x in select * from jsonb_array_elements(p_parts) loop
    k := k + 1;
    insert into public.fin_appointment_participants (appointment_id, clinic_id, professional_id, role, position) values (a, c, (x->>'professional_id')::uuid, x->>'role', k);
  end loop;
  insert into fx values (p_key, a);
  perform private.share_reconcile_appt(a, 'teste');
  return a;
end $$;
create function pg_temp.rule(p_pro text, p_data jsonb) returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('gestor');
  r := public.fin_share_rule_save(pg_temp.f('c'), null, jsonb_build_object('professional_id', pg_temp.f('pro_' || p_pro)) || p_data, 'teste');
  perform pg_temp.su();
  return (r->>'id')::uuid;
end $$;
-- somas lidas como dono do banco
create function pg_temp.lsum(p_pro text, p_period text, p_type text default null) returns bigint language sql as $$
  select coalesce(sum(amount_cents), 0) from public.fin_share_lines where professional_id = pg_temp.f('pro_' || p_pro) and (p_period is null or period = p_period) and (p_type is null or line_type = p_type) $$;
create function pg_temp.lcount(p_pro text, p_period text default null, p_type text default null) returns integer language sql as $$
  select count(*)::integer from public.fin_share_lines where professional_id = pg_temp.f('pro_' || p_pro) and (p_period is null or period = p_period) and (p_type is null or line_type = p_type) $$;
create function pg_temp.month(p_pro text, p_period text) returns jsonb language sql as $$ select private.share_month(pg_temp.f('c'), pg_temp.f('pro_' || p_pro), p_period) $$;
create function pg_temp.entry(p_unit uuid, p_item uuid, p_qty numeric, p_cost_each numeric, p_lot text default null) returns uuid language plpgsql as $$
begin
  return public.fin_stock_entry(pg_temp.f('c'), p_unit, jsonb_build_object('entry_type', 'purchase', 'invoice_number', 'NF-' || left(p_item::text, 8), 'supplier_new', jsonb_build_object('name', 'Fornecedor ' || left(p_item::text, 8))),
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'unit_cost_cents', p_cost_each, 'lot_code', p_lot, 'expiry_date', case when p_lot is null then null else current_date + 365 end)));
end $$;
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text), pg_temp.parts(text, text),
  pg_temp.sale_pay(text, text, jsonb, jsonb, text), pg_temp.svc_item(text, integer, integer, integer), pg_temp.settle(text, date[]),
  pg_temp.mk_appt(text, text, text, date, jsonb, text, bigint), pg_temp.rule(text, jsonb), pg_temp.lsum(text, text, text), pg_temp.lcount(text, text, text), pg_temp.month(text, text),
  pg_temp.entry(uuid, uuid, numeric, numeric, text) to public;

-- ---------- Fixture ----------
do $t$
declare
  c uuid; c2 uuid; u1 uuid; k text; pid uuid; pro uuid; v_acq uuid; v_pat uuid; v_pat2 uuid; v_svc uuid; v_id uuid;
begin
  foreach k in array array['owner','gestor','fin','recep','estoq','pa','pb','pc','pd','pe','px','other'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'Prof ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','gestor','fin','recep','estoq','pa','pb','pc','pd','pe','px'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role, type) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end, case when k in ('fin','recep','estoq') then 'other' end) returning id into pro;
    insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_other'), c2, 'admin');
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values
    (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_fin'), 'financeiro'), (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_estoq'), 'estoquista');
  select id into u1 from public.clinic_units where clinic_id = c and is_primary;
  insert into fx values ('u1', u1);

  insert into public.profiles (full_name) values ('Paciente Um') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat; insert into fx values ('pat', v_pat);
  insert into public.profiles (full_name) values ('Maria da Silva Santos') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat2; insert into fx values ('pat2', v_pat2);
  insert into public.care_team select p.v, pr.profile_id from fx p join public.professionals pr on pr.clinic_id = c where p.k in ('pat','pat2');

  -- maquininha: Visa à vista 3% (30d); Visa 2–6x 5% (30d/parcela); Master 2–6x 4% (30d/parcela)
  insert into public.fin_acquirers (clinic_id, name, kind) values (c, 'Maq1', 'machine') returning id into v_acq; insert into fx values ('maq', v_acq);
  insert into public.fin_fee_rows (acquirer_id, brand, modality, fee_pct, settle_days) values
    (v_acq, 'Visa', 'credit_1', 3, 30), (v_acq, 'Visa', 'credit_2_6', 5, 30), (v_acq, 'Master', 'credit_2_6', 4, 30);
  select id into v_id from public.fin_acquirers where clinic_id = c and kind = 'pix'; insert into fx values ('pix', v_id);

  -- serviços
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Consulta', 'consulta', 50000, '{responsavel}') returning id into v_svc; insert into fx values ('sv_cons', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Aplicação', 'aplicacao', 120000, '{responsavel,executor}') returning id into v_svc; insert into fx values ('sv_apl', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Procedimento', 'procedimento', 200000, '{responsavel}') returning id into v_svc; insert into fx values ('sv_proc', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Consulta médica', 'consulta', 50000, '{responsavel}') returning id into v_svc; insert into fx values ('sv_med', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Consulta nutri', 'consulta', 30000, '{responsavel}') returning id into v_svc; insert into fx values ('sv_nut', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Sessão personal', 'sessao', 10000, '{responsavel}') returning id into v_svc; insert into fx values ('sv_pers', v_svc);
  -- itens: kit da aplicação (consumo) e produtos para revenda/medicação
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Kit aplicação', 'kit', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_kit', v_id);
  insert into public.fin_service_kit_items (service_id, item_id, quantity) values (pg_temp.f('sv_apl'), v_id, 1);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents) values (c, 'Suplemento C', 'sup', 'resale', 'un', 'un', 'un', true, 18000) returning id into v_id; insert into fx values ('it_sup', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents, lot_control) values (c, 'Manipulado X', 'amp', 'compounded', 'un', 'un', 'un', true, 30000, true) returning id into v_id; insert into fx values ('it_med', v_id);
end $t$;



-- ---------- helpers do painel ----------
create function pg_temp.dash(p_user text, p_period text default null, p_unit uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := public.fin_dashboard_summary(pg_temp.f('c'), p_period, p_unit);
  perform pg_temp.su();
  return v;
end $$;
create function pg_temp.det(p_user text, p_metric text, p_period text default null, p_unit uuid default null, p_params jsonb default '{}', p_limit integer default 1000, p_offset integer default 0) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := public.fin_dashboard_detail(pg_temp.f('c'), p_metric, p_period, p_unit, p_params, 7, p_limit, p_offset);
  perform pg_temp.su();
  return v;
end $$;
-- venda em qualquer unidade (sem recebimento se p_pay for nulo); p_ts move a criação da venda
create function pg_temp.sale_u(p_key text, p_unit text, p_patient text, p_items jsonb, p_pay jsonb default null, p_seller text default null, p_ts timestamptz default null) returns uuid language plpgsql as $$
declare s uuid; c uuid := pg_temp.f('c');
begin
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, pg_temp.f(p_unit), pg_temp.f(p_patient), p_items, 0, null, case when p_seller is null then null else pg_temp.f('pro_' || p_seller) end);
  if p_pay is not null then perform public.fin_add_payment(s, p_pay); end if;
  perform pg_temp.su();
  if p_ts is not null then update public.fin_sales set created_at = p_ts where id = s; end if;
  insert into fx values (p_key, s);
  return s;
end $$;
create function pg_temp.exp_date(p_sale text, p_n integer, p_d date) returns void language sql as $$
  update public.fin_receivables set expected_date = p_d where sale_id = pg_temp.f(p_sale) and installment_no = p_n $$;
create function pg_temp.pix(p_cents integer) returns jsonb language sql as $$ select jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', p_cents) $$;
create function pg_temp.n(p_j jsonb, p_path text[]) returns bigint language sql as $$ select (p_j #>> p_path)::bigint $$;
create function pg_temp.rowsum(p_j jsonb, p_key text) returns bigint language sql as $$ select coalesce(sum((r->>p_key)::bigint), 0) from jsonb_array_elements(p_j->'rows') r $$;
grant execute on function pg_temp.dash(text, text, uuid), pg_temp.det(text, text, text, uuid, jsonb, integer, integer), pg_temp.sale_u(text, text, text, jsonb, jsonb, text, timestamptz),
  pg_temp.exp_date(text, integer, date), pg_temp.pix(integer), pg_temp.n(jsonb, text[]), pg_temp.rowsum(jsonb, text) to public;

-- ---------- Configuração: unidade 2, gestor restrito, alíquotas, regras, estoque ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid; pid uuid; pro uuid; d0 date := private.fin_today(); p0 text := to_char(private.fin_today(), 'YYYY-MM');
        s1 date := (date_trunc('month', private.fin_today()) - interval '1 month')::date;
begin
  perform pg_temp.as_user('owner');
  u2 := public.fin_save_unit(c, null, '{"name":"Unidade 2"}'::jsonb);
  perform pg_temp.su();
  insert into fx values ('u2', u2);
  insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'Prof pz') returning id into pid; insert into fx values ('prof_pz', pid);
  insert into public.professionals (profile_id, clinic_id, type) values (pid, c, 'other') returning id into pro; insert into fx values ('pro_pz', pro);
  insert into public.clinic_staff_roles (clinic_id, professional_id, role, all_units, unit_ids) values (c, pro, 'gestor', false, array[u1]);
  perform pg_temp.as_user('fin');
  perform public.fin_set_tax_rate(c, p0, 6, null, 'teste'); perform public.fin_set_tax_rate(c, p0, 10, u2, 'teste');
  perform pg_temp.su();
  -- regras: pa 60% (responsável) + fixo mensal 1.000 desde o mês anterior + comissão de produto 10%; pb 50%; pd taxa de uso 500 só no mês anterior; pc SEM regra
  perform pg_temp.rule('pa', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', (s1 - 60)::text));
  perform pg_temp.rule('pa', jsonb_build_object('rule_type', 'fixed_monthly', 'amount_cents', 100000, 'valid_from', s1::text));
  perform pg_temp.rule('pa', jsonb_build_object('role', 'vendedor', 'rule_type', 'product_commission', 'target_type', 'default', 'pct', 10, 'valid_from', (s1 - 60)::text));
  perform pg_temp.rule('pb', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', (s1 - 60)::text));
  perform pg_temp.rule('pb', jsonb_build_object('role', 'executor', 'rule_type', 'pct', 'pct', 20, 'valid_from', (s1 - 60)::text));
  perform pg_temp.rule('pd', jsonb_build_object('rule_type', 'usage_fee', 'usage_fee_mode', 'fixed', 'amount_cents', 50000, 'valid_from', s1::text, 'valid_to', (s1 + interval '1 month - 1 day')::date::text));
end $t$;

-- ---------- Dados: mês atual (M0), mês anterior (M1), títulos, atendimentos, produtos, caixa, pacotes ----------
do $t$
declare
  c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d0 date := private.fin_today(); s0 date := date_trunc('month', private.fin_today())::date;
  s1 date := (date_trunc('month', private.fin_today()) - interval '1 month')::date; v uuid; r uuid; it_sup uuid := pg_temp.f('it_sup');
begin
  -- estoque do suplemento: 10 un a R$ 50,00 na unidade 1; mínimo 20 (alerta E10)
  perform pg_temp.as_user('estoq'); perform pg_temp.entry(u1, it_sup, 10, 5000); perform pg_temp.su();
  insert into public.stock_item_minimums (item_id, unit_id, min_qty) values (it_sup, u1, 20);

  -- S1: Consulta 1.000,00 no Pix, liquidada no 1º dia do mês atual
  perform pg_temp.sale_u('s1', 'u1', 'pat', pg_temp.svc_item('sv_cons', 100000), pg_temp.pix(100000));
  perform pg_temp.settle('s1', array[s0 + 1]);
  -- S2: Visa 3x R$ 1.500,00 (5% por parcela): 1ª liquidada no mês; 2ª venceu há 3 dias; 3ª em 40 dias
  perform pg_temp.sale_u('s2', 'u1', 'pat2', pg_temp.svc_item('sv_proc', 150000), jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Visa', 'modality', 'credit_2_6', 'installments', 3, 'amount_cents', 150000));
  perform pg_temp.exp_date('s2', 1, s0 + 2); perform pg_temp.exp_date('s2', 2, d0 - 3); perform pg_temp.exp_date('s2', 3, d0 + 40);
  update public.fin_receivables set status = 'settled', settled_date = s0 + 2, settled_net_cents = net_cents where sale_id = pg_temp.f('s2') and installment_no = 1;
  -- o gestor corrige o líquido liquidado da 1ª parcela (R$ 1,00 a menos): a taxa efetiva passa de 25,00 para 26,00
  perform pg_temp.as_user('gestor');
  perform public.fin_correct_receivable((select id from public.fin_receivables where sale_id = pg_temp.f('s2') and installment_no = 1), s0 + 2, 47400, 'tarifa extra do banco');
  perform pg_temp.su();
  -- S3: venda cancelada (fora do Vendido)
  perform pg_temp.sale_u('s3', 'u1', 'pat', pg_temp.svc_item('sv_cons', 30000), pg_temp.pix(30000));
  perform pg_temp.as_user('gestor'); perform public.fin_cancel_sale(pg_temp.f('s3'), 'cliente desistiu'); perform pg_temp.su();
  -- S4: Aplicação R$ 1.200,00 com 10% de desconto no item: R$ 1.080,00, Pix liquidado no mês
  perform pg_temp.sale_u('s4', 'u1', 'pat', pg_temp.svc_item('sv_apl', 120000, 10), pg_temp.pix(108000));
  perform pg_temp.settle('s4', array[s0 + 3]);
  -- S5: venda de R$ 400,00 SEM recebimento criada no mês anterior (em atraso há mais de 7 dias); S6: R$ 200,00 sem recebimento, de hoje (não é atraso)
  perform pg_temp.sale_u('s5', 'u1', 'pat', pg_temp.svc_item('sv_cons', 40000), null, null, (s1 + 10)::timestamp at time zone 'America/Sao_Paulo' + interval '10 hours');
  perform pg_temp.sale_u('s6', 'u1', 'pat2', pg_temp.svc_item('sv_cons', 20000), null);
  -- S7: produto (2 × R$ 180,00 = R$ 360,00, vendedor pa) no Pix liquidado; baixa 2 un a R$ 50,00 = custo R$ 100,00. S8: 1 un vendida e cancelada (custo volta)
  perform pg_temp.sale_u('s7', 'u1', 'pat', jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', it_sup, 'quantity', 2)), pg_temp.pix(36000), 'pa');
  perform pg_temp.settle('s7', array[s0 + 4]);
  perform pg_temp.sale_u('s8', 'u1', 'pat', jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', it_sup, 'quantity', 1)), pg_temp.pix(18000));
  perform pg_temp.as_user('gestor'); perform public.fin_cancel_sale(pg_temp.f('s8'), 'devolvido'); perform pg_temp.su();
  -- S9 (mês anterior): Consulta R$ 800,00 liquidada no mês anterior
  perform pg_temp.sale_u('s9', 'u1', 'pat', pg_temp.svc_item('sv_cons', 80000), pg_temp.pix(80000), null, (s1 + 4)::timestamp at time zone 'America/Sao_Paulo' + interval '10 hours');
  perform pg_temp.settle('s9', array[s1 + 5]);
  -- S10: unidade 2, Consulta R$ 500,00 liquidada no mês (alíquota própria de 10%)
  perform pg_temp.sale_u('s10', 'u2', 'pat2', pg_temp.svc_item('sv_cons', 50000), pg_temp.pix(50000));
  perform pg_temp.settle('s10', array[s0 + 2]);
  -- S11: título que vence HOJE (R$ 100,00) e S12: título além de 90 dias (R$ 300,00)
  perform pg_temp.sale_u('s11', 'u1', 'pat', pg_temp.svc_item('sv_cons', 10000), pg_temp.pix(10000));
  perform pg_temp.sale_u('s12', 'u1', 'pat2', pg_temp.svc_item('sv_cons', 30000), pg_temp.pix(30000));
  -- o Pix liquida na hora; aqui os dois voltam a «esperado» (simula a liquidação futura) com vencimento hoje e daqui a 120 dias
  update public.fin_receivables set status = 'expected', settled_date = null, settled_net_cents = null where sale_id in (pg_temp.f('s11'), pg_temp.f('s12'));
  perform pg_temp.exp_date('s11', 1, d0); perform pg_temp.exp_date('s12', 1, d0 + 120);
  -- S15: criada 23h30 de Brasília do último dia do mês anterior (já é o mês seguinte em UTC): pertence ao mês anterior
  perform pg_temp.sale_u('s15', 'u1', 'pat', pg_temp.svc_item('sv_cons', 7000), null, null, (s0 - 1)::timestamp at time zone 'America/Sao_Paulo' + interval '23 hours 30 minutes');

  -- atendimentos realizados: A1 (pa, venda S1), A2 (pb responsável + pa executor? não: pb responsável, material R$ 80,00, venda S4), A3 (pa, SEM venda), A4 (pc, SEM venda e SEM regra, material R$ 25,00), A5 no mês anterior (pa, venda S9), A6 unidade 2
  perform pg_temp.mk_appt('a1', 'pat', 'sv_cons', s0 + 1, pg_temp.parts('pa'), 's1');
  perform pg_temp.mk_appt('a2', 'pat', 'sv_apl', s0 + 3, pg_temp.parts('pb', 'pa'), 's4', 8000);
  perform pg_temp.mk_appt('a3', 'pat2', 'sv_cons', s0 + 5, pg_temp.parts('pa'), null);
  perform pg_temp.mk_appt('a4', 'pat2', 'sv_cons', s0 + 6, pg_temp.parts('pc'), null, 2500);
  perform pg_temp.mk_appt('a5', 'pat', 'sv_cons', s1 + 5, pg_temp.parts('pa'), 's9');
  -- recalcula o repasse (liquidações e atendimentos gravados direto)
  perform pg_temp.as_user('gestor'); perform public.fin_share_recalc(c, s1 - 60, d0); perform pg_temp.su();

  -- pacotes: um vence em 10 dias (aparece), outro em 45 (não aparece)
  perform pg_temp.as_user('owner');
  v := public.fin_save_package(c, null, jsonb_build_object('name', 'Pacote Vitalidade', 'price_cents', 90000, 'validity_days', 90), jsonb_build_array(jsonb_build_object('item_type', 'service', 'service_id', pg_temp.f('sv_cons'), 'quantity', 3, 'reference_price_cents', 30000)));
  insert into fx values ('pk_a', v);
  v := public.fin_save_package(c, null, jsonb_build_object('name', 'Pacote Longo', 'price_cents', 60000, 'validity_days', 90), jsonb_build_array(jsonb_build_object('item_type', 'service', 'service_id', pg_temp.f('sv_cons'), 'quantity', 2, 'reference_price_cents', 30000)));
  insert into fx values ('pk_b', v);
  perform pg_temp.su();
  perform pg_temp.sale_u('s13', 'u1', 'pat', jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk_a'), 'quantity', 1)), null);
  perform pg_temp.sale_u('s14', 'u1', 'pat2', jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk_b'), 'quantity', 1)), null);
  update public.fin_patient_packages set expires_on = d0 + 10 where sale_id = pg_temp.f('s13');
  update public.fin_patient_packages set expires_on = d0 + 45 where sale_id = pg_temp.f('s14');

  -- caixa: um de dia anterior ainda aberto (Recepção) e um fechado com diferença aguardando aprovação (Financeiro)
  perform pg_temp.as_user('recep'); r := public.fin_open_cash(c, u1, 10000); insert into fx values ('cash_stale', r); perform pg_temp.su();
  update public.fin_cash_registers set business_date = d0 - 2 where id = r;
  perform pg_temp.as_user('fin'); r := public.fin_open_cash(c, u1, 10000); perform public.fin_close_cash(r, '{"cash":12500}'::jsonb, 'troco a mais'); insert into fx values ('cash_diff', r); perform pg_temp.su();
end $t$;

-- F12: a lista (total e soma das linhas exibidas) bate com o número do painel
create function pg_temp.f12(p_name text, p_metric text, p_expected bigint, p_period text default null, p_unit uuid default null, p_params jsonb default '{}', p_user text default 'gestor', p_count integer default null) returns void language plpgsql as $$
declare d jsonb := pg_temp.det(p_user, p_metric, p_period, p_unit, p_params);
begin
  perform pg_temp.chk(p_name, (d->>'total_cents')::bigint = p_expected and pg_temp.rowsum(d, 'value_cents') = p_expected and not (d->>'truncated')::boolean
     and (p_count is null or (d->>'count')::integer = p_count) and jsonb_array_length(d->'rows') = (d->>'count')::integer,
     format('esperado %s; total %s; soma das linhas %s; linhas %s/%s', p_expected, d->>'total_cents', pg_temp.rowsum(d, 'value_cents'), jsonb_array_length(d->'rows'), d->>'count'));
end $$;
grant execute on function pg_temp.f12(text, text, bigint, text, uuid, jsonb, text, integer) to public;

-- ---------- A. Números do mês atual e F12 (cada número = soma das linhas que o compõem) ----------
do $t$
declare
  c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d0 date := private.fin_today(); p0 text := to_char(private.fin_today(), 'YYYY-MM');
  s jsonb; d jsonb; k jsonb; r jsonb; v bigint; n integer; i integer;
begin
  s := pg_temp.dash('gestor');
  perform pg_temp.chk('A0 o painel abre no mês atual de Brasília, todas as unidades, e devolve 12 meses de evolução e 14 faixas de agenda', s->>'period' = p0 and (s->>'all_units')::boolean and jsonb_array_length(s->'evolution') = 12 and jsonb_array_length(s->'agenda') = 14 and (s->>'today')::date = d0, s->>'period');
  perform pg_temp.chk('A1 Vendido = vendas do mês sem as canceladas, líquidas de desconto (R$ 6.540,00 em 10 vendas); a venda das 23h30 do último dia do mês anterior não entra', pg_temp.n(s, '{cards,sold_cents}') = 654000 and pg_temp.n(s, '{cards,sold_count}') = 10, s->'cards'->>'sold_cents');
  perform pg_temp.chk('A2 Ticket médio = Vendido ÷ nº de vendas (R$ 654,00)', pg_temp.n(s, '{cards,ticket_cents}') = 65400, s->'cards'->>'ticket_cents');
  perform pg_temp.chk('A3 Recebido = títulos liquidados no mês, bruto (R$ 3.440,00)', pg_temp.n(s, '{cards,received_cents}') = 344000, s->'cards'->>'received_cents');
  perform pg_temp.chk('A4 Taxas = bruto − líquido liquidado (a correção do gestor entra: 25,00 + 1,00)', pg_temp.n(s, '{cards,fees_cents}') = 2600, s->'cards'->>'fees_cents');
  perform pg_temp.chk('A5 Imposto = alíquota do mês de cada unidade × recebido (6% de 2.940,00 + 10% de 500,00 da unidade 2)', pg_temp.n(s, '{cards,tax_cents}') = 22640, s->'cards'->>'tax_cents');
  perform pg_temp.chk('A6 Custo de material = atendimentos realizados no mês (80,00 + 25,00)', pg_temp.n(s, '{cards,material_cents}') = 10500, s->'cards'->>'material_cents');
  perform pg_temp.chk('A7 Custo dos produtos vendidos = 2 un × 50,00; a venda cancelada devolve o custo', pg_temp.n(s, '{cards,products_cost_cents}') = 10000, s->'cards'->>'products_cost_cents');
  perform pg_temp.chk('A8 A receber = títulos esperados de hoje em diante (hoje 100,00 + 3ª parcela 500,00 + além de 90 dias 300,00)', pg_temp.n(s, '{cards,to_receive_cents}') = 90000 and pg_temp.n(s, '{cards,to_receive_count}') = 3, s->'cards'->>'to_receive_cents');
  perform pg_temp.chk('A9 Em atraso = título vencido (500,00) + vendas sem recebimento há mais de 7 dias (400,00 e 70,00); a venda de hoje sem recebimento não entra', pg_temp.n(s, '{cards,overdue_cents}') = 97000 and pg_temp.n(s, '{cards,overdue_count}') = 3
     and pg_temp.n(s, '{cards,overdue_titles_cents}') = 50000 and pg_temp.n(s, '{cards,overdue_sales_cents}') = 47000 and pg_temp.n(s, '{cards,overdue_sales_count}') = 2, s->'cards'->>'overdue_cents');
  perform pg_temp.chk('A10 Repasses do mês (sem fechamento) = lançamentos do mês: pa 600,00 + comissão 36,00; pb 540,00', pg_temp.n(s, '{cards,repasse_cents}') = 117600
     and not exists (select 1 from jsonb_array_elements(s->'by_professional') x where x->>'repasse_source' <> 'lines'), s->'cards'->>'repasse_cents');
  perform pg_temp.chk('A11 Margem = Recebido − taxas − imposto − material − repasses − custo dos produtos (R$ 1.806,60)', pg_temp.n(s, '{cards,margin_cents}') = 344000 - 2600 - 22640 - 10500 - 117600 - 10000
     and pg_temp.n(s, '{cards,margin_cents}') = 180660, s->'cards'->>'margin_cents');
  perform pg_temp.chk('A12 Produtos: receita 360,00, custo 100,00, comissão 36,00, margem 224,00', pg_temp.n(s, '{cards,products_revenue_cents}') = 36000 and pg_temp.n(s, '{cards,products_commission_cents}') = 3600 and pg_temp.n(s, '{cards,products_margin_cents}') = 22400, null);

  -- F12
  perform pg_temp.f12('F1 F12 Vendido: soma das vendas listadas = número', 'sold', 654000, null, null, '{}', 'gestor', 10);
  d := pg_temp.det('gestor', 'ticket');
  perform pg_temp.chk('F2 F12 Ticket médio: total ÷ nº de linhas listadas = número', round((d->>'total_cents')::numeric / (d->>'count')::integer) = 65400 and jsonb_array_length(d->'rows') = 10, d->>'total_cents');
  perform pg_temp.f12('F3 F12 Recebido', 'received', 344000, null, null, '{}', 'gestor', 5);
  perform pg_temp.f12('F4 F12 Taxas de pagamento', 'fees', 2600, null, null, '{}', 'gestor', 5);
  d := pg_temp.det('gestor', 'received');
  perform pg_temp.chk('F4b a lista de recebidos mostra bruto, taxa efetiva e líquido de cada título (1ª parcela do Visa: 500,00 / 26,00 / 474,00)',
    exists (select 1 from jsonb_array_elements(d->'rows') x where (x->>'gross_cents')::bigint = 50000 and (x->>'fee_cents')::bigint = 2600 and (x->>'net_cents')::bigint = 47400 and x->>'installment' = '1/3'), null);
  perform pg_temp.f12('F5 F12 A receber', 'to_receive', 90000, null, null, '{}', 'gestor', 3);
  perform pg_temp.f12('F6 F12 Em atraso (títulos + vendas sem recebimento)', 'overdue', 97000, null, null, '{}', 'gestor', 3);
  perform pg_temp.f12('F7 F12 Títulos em atraso', 'overdue_titles', 50000, null, null, '{}', 'gestor', 1);
  perform pg_temp.f12('F8 F12 Repasses do mês (uma linha por profissional)', 'repasse', 117600, null, null, '{}', 'gestor', 2);
  perform pg_temp.f12('F9 F12 Custo de material', 'material', 10500, null, null, '{}', 'gestor', 2);
  perform pg_temp.f12('F10 F12 Imposto (uma linha por unidade)', 'tax', 22640, null, null, '{}', 'gestor', 2);
  perform pg_temp.f12('F11 F12 Receita de produtos', 'products_revenue', 36000, null, null, '{}', 'gestor', 1);
  perform pg_temp.f12('F12 F12 Custo dos produtos vendidos (saídas e estornos)', 'products_cost', 10000, null, null, '{}', 'gestor');
  d := pg_temp.det('gestor', 'products_cost');
  perform pg_temp.chk('F12b o custo lista a saída e o estorno da venda cancelada', exists (select 1 from jsonb_array_elements(d->'rows') x where x->>'movement_type' = 'reversal' and (x->>'value_cents')::bigint = -5000)
     and exists (select 1 from jsonb_array_elements(d->'rows') x where x->>'movement_type' = 'sale' and (x->>'value_cents')::bigint = 5000), d::text);
  perform pg_temp.f12('F13 F12 Comissões de produtos', 'products_commission', 3600, null, null, '{}', 'gestor', 1);
  perform pg_temp.f12('F14 F12 Margem da clínica: as 6 linhas da composição somam a margem', 'margin', 180660, null, null, '{}', 'gestor', 6);
  -- cada linha da composição é, ela mesma, clicável e igual ao seu número
  d := pg_temp.det('gestor', 'margin');
  perform pg_temp.chk('F15 cada componente da margem abre a lista de mesmo valor (recebido, taxas, imposto, material, repasses, custo dos produtos)',
    (select bool_and(abs((pg_temp.det('gestor', x->>'metric')->>'total_cents')::bigint) = (x->>'amount_cents')::bigint) from jsonb_array_elements(d->'rows') x), d::text);

  -- por forma de pagamento
  perform pg_temp.chk('F16 por forma de pagamento: a soma das formas = Recebido', (select sum((x->>'cents')::bigint) from jsonb_array_elements(s->'by_method') x) = 344000, s->>'by_method');
  perform pg_temp.chk('F17 F12 cada forma de pagamento abre a lista de mesmo valor', (select bool_and((pg_temp.det('gestor', 'received', null, null, jsonb_build_object('method', x->>'key'))->>'total_cents')::bigint = (x->>'cents')::bigint
     and (pg_temp.det('gestor', 'received', null, null, jsonb_build_object('method', x->>'key'))->>'count')::integer = (x->>'count')::integer) from jsonb_array_elements(s->'by_method') x), null);

  -- por profissional e por serviço
  perform pg_temp.chk('F18 por profissional: atendimentos, receita gerada, repasse, % repassado e margem gerada', (select count(*) from jsonb_array_elements(s->'by_professional')) = 3
     and (select (x->>'revenue_cents')::bigint from jsonb_array_elements(s->'by_professional') x where x->>'name' = 'Prof pb') = 108000
     and (select (x->>'pct_repassed')::numeric from jsonb_array_elements(s->'by_professional') x where x->>'name' = 'Prof pb') = 50.0
     and (select (x->>'margin_cents')::bigint from jsonb_array_elements(s->'by_professional') x where x->>'name' = 'Prof pb') = 108000 - 54000 - 8000, s->>'by_professional');
  perform pg_temp.chk('F19 F12 cada número por profissional abre a lista de mesmo valor (atendimentos, receita gerada, composição da margem gerada)',
    (select bool_and((pg_temp.det('gestor', 'pro_appointments', null, null, jsonb_build_object('professional', x->>'professional_id'))->>'total_cents')::bigint = (x->>'revenue_cents')::bigint
        and (pg_temp.det('gestor', 'pro_appointments', null, null, jsonb_build_object('professional', x->>'professional_id'))->>'count')::integer = (x->>'appointments')::integer
        and (pg_temp.det('gestor', 'pro_margin', null, null, jsonb_build_object('professional', x->>'professional_id'))->>'total_cents')::bigint = (x->>'margin_cents')::bigint
        and pg_temp.rowsum(pg_temp.det('gestor', 'pro_lines', null, null, jsonb_build_object('professional', x->>'professional_id')), 'value_cents') = (x->>'repasse_cents')::bigint) from jsonb_array_elements(s->'by_professional') x), s->>'by_professional');
  perform pg_temp.chk('F20 por serviço: quantidade, receita, custo médio de material e margem por unidade; F12 cada linha abre a lista de mesmo valor',
    (select count(*) from jsonb_array_elements(s->'by_service')) = 2
    and (select bool_and((pg_temp.det('gestor', 'service_appointments', null, null, jsonb_build_object('service', x->>'service_id'))->>'total_cents')::bigint = (x->>'revenue_cents')::bigint
        and (pg_temp.det('gestor', 'service_appointments', null, null, jsonb_build_object('service', x->>'service_id'))->>'count')::integer = (x->>'quantity')::integer
        and pg_temp.rowsum(pg_temp.det('gestor', 'service_appointments', null, null, jsonb_build_object('service', x->>'service_id')), 'material_cents') = (x->>'material_cents')::bigint
        and (x->>'avg_material_cents')::bigint = round((x->>'material_cents')::numeric / (x->>'quantity')::integer)) from jsonb_array_elements(s->'by_service') x), s->>'by_service');

  -- agenda de recebimentos: 90 dias por faixa + além; fecha com «A receber»
  perform pg_temp.chk('F21 agenda: as 14 faixas (13 de até 7 dias + depois de 90 dias) somam o «A receber»', (select sum((x->>'cents')::bigint) from jsonb_array_elements(s->'agenda') x) = 90000 and (select sum((x->>'count')::integer) from jsonb_array_elements(s->'agenda') x) = 3, s->>'agenda');
  perform pg_temp.chk('F22 agenda: o título que vence hoje cai na 1ª faixa, a 3ª parcela (40 dias) na 6ª, e o de 120 dias fica depois de 90 dias',
    pg_temp.n(s, '{agenda,0,cents}') = 10000 and pg_temp.n(s, '{agenda,5,cents}') = 50000 and pg_temp.n(s, '{agenda,13,cents}') = 30000 and (s->'agenda'->13->>'to') is null, s->>'agenda');
  perform pg_temp.chk('F23 F12 cada faixa da agenda abre a lista de mesmo valor e mesma quantidade', (select bool_and((pg_temp.det('gestor', 'to_receive', null, null, jsonb_build_object('from', x->>'from', 'to', x->>'to'))->>'total_cents')::bigint = (x->>'cents')::bigint
     and (pg_temp.det('gestor', 'to_receive', null, null, jsonb_build_object('from', x->>'from', 'to', x->>'to'))->>'count')::integer = (x->>'count')::integer) from jsonb_array_elements(s->'agenda') x), null);

  -- filas de pendências (cada uma clicável)
  perform pg_temp.chk('P1 atendidos sem venda: 2 (A3 e A4)', pg_temp.n(s, '{pendencies,appt_no_sale,count}') = 2 and (pg_temp.det('gestor', 'appt_no_sale')->>'count')::integer = 2, s->>'pendencies');
  perform pg_temp.f12('P1b F12 atendidos sem venda: soma do valor de serviço das linhas', 'appt_no_sale', pg_temp.n(s, '{pendencies,appt_no_sale,cents}'), null, null, '{}', 'gestor', 2);
  perform pg_temp.chk('P2 atendimentos sem regra de repasse: 2 (pc, e pa como executor da aplicação)', pg_temp.n(s, '{pendencies,unruled,count}') = 2 and (pg_temp.det('gestor', 'unruled')->>'count')::integer = 2
     and exists (select 1 from jsonb_array_elements(pg_temp.det('gestor', 'unruled')->'rows') x where x->>'professional_name' = 'Prof pc'), null);
  perform pg_temp.chk('P3 títulos em atraso: 1 de R$ 500,00', pg_temp.n(s, '{pendencies,overdue_titles,count}') = 1 and pg_temp.n(s, '{pendencies,overdue_titles,cents}') = 50000, null);
  perform pg_temp.chk('P4 pacotes vencendo em 30 dias com sessões não realizadas: só o de 10 dias', pg_temp.n(s, '{pendencies,packages,count}') = 1 and (pg_temp.det('gestor', 'packages')->>'count')::integer = 1
     and pg_temp.det('gestor', 'packages')->'rows'->0->>'package_name' = 'Pacote Vitalidade' and (pg_temp.det('gestor', 'packages')->'rows'->0->>'remaining')::numeric = 3, pg_temp.det('gestor', 'packages')::text);
  perform pg_temp.chk('P5 caixas: o de dia anterior ainda aberto e o fechado com diferença aguardando aprovação; diferença em espécie R$ 25,00', pg_temp.n(s, '{pendencies,cash,count}') = 2 and pg_temp.n(s, '{pendencies,cash,cents}') = 2500
     and (pg_temp.det('gestor', 'cash')->>'count')::integer = 2 and (pg_temp.det('gestor', 'cash')->>'total_cents')::bigint = 2500, pg_temp.det('gestor', 'cash')::text);
  perform pg_temp.chk('P6 item abaixo do mínimo (E10): suplemento com 8 un e mínimo 20', pg_temp.n(s, '{pendencies,stock,count}') = 1 and (pg_temp.det('gestor', 'stock')->'rows'->0->>'item_name') = 'Suplemento C'
     and (pg_temp.det('gestor', 'stock')->'rows'->0->>'qty_on_hand')::numeric = 8 and (pg_temp.det('gestor', 'stock')->'rows'->0->>'min_qty')::numeric = 20, pg_temp.det('gestor', 'stock')::text);
  perform pg_temp.chk('P7 a lista da venda cancelada e a venda de hoje sem recebimento: cancelada fora do Vendido, não é atraso', not exists (select 1 from jsonb_array_elements(pg_temp.det('gestor', 'sold')->'rows') x where (x->>'id')::uuid = pg_temp.f('s3'))
     and not exists (select 1 from jsonb_array_elements(pg_temp.det('gestor', 'overdue')->'rows') x where (x->>'id')::uuid = pg_temp.f('s6')), null);

  -- evolução de 12 meses: cada ponto = os números do próprio mês; F12 do mês (a mesma lista com o mês escolhido)
  perform pg_temp.chk('E1 evolução de 12 meses termina no mês escolhido e o último ponto = os números do topo', s->'evolution'->11->>'period' = p0 and s->'evolution'->0->>'period' = to_char((date_trunc('month', d0) - interval '11 month')::date, 'YYYY-MM')
     and pg_temp.n(s, '{evolution,11,sold_cents}') = 654000 and pg_temp.n(s, '{evolution,11,received_cents}') = 344000 and pg_temp.n(s, '{evolution,11,margin_cents}') = 180660, s->>'evolution');
  perform pg_temp.chk('E2 cada mês da evolução = o painel daquele mês (vendido, recebido e margem)', (select bool_and(
      (pg_temp.dash('gestor', x->>'period')->'cards'->>'sold_cents')::bigint = (x->>'sold_cents')::bigint and (pg_temp.dash('gestor', x->>'period')->'cards'->>'received_cents')::bigint = (x->>'received_cents')::bigint
      and (pg_temp.dash('gestor', x->>'period')->'cards'->>'margin_cents')::bigint = (x->>'margin_cents')::bigint) from jsonb_array_elements(s->'evolution') x), null);
  k := pg_temp.dash('gestor', to_char((date_trunc('month', d0) - interval '1 month')::date, 'YYYY-MM'));
  perform pg_temp.chk('E3 mês anterior: Vendido 1.270,00 em 3 vendas (a das 23h30 do último dia é dele) e Recebido 800,00', pg_temp.n(k, '{cards,sold_cents}') = 127000 and pg_temp.n(k, '{cards,sold_count}') = 3 and pg_temp.n(k, '{cards,received_cents}') = 80000, k->>'cards');
  perform pg_temp.f12('E4 F12 do mês anterior: Vendido', 'sold', 127000, to_char((date_trunc('month', d0) - interval '1 month')::date, 'YYYY-MM'), null, '{}', 'gestor', 3);
  perform pg_temp.f12('E5 F12 do mês anterior: Recebido', 'received', 80000, to_char((date_trunc('month', d0) - interval '1 month')::date, 'YYYY-MM'), null, '{}', 'gestor', 1);
  perform pg_temp.chk('E6 a venda em atraso do mês anterior (400,00) segue na fila de atraso do mês atual: atraso e agenda não dependem do mês escolhido', pg_temp.n(k, '{cards,overdue_cents}') = 97000 and pg_temp.n(k, '{cards,to_receive_cents}') = 90000, null);

  -- paginação
  d := pg_temp.det('gestor', 'sold', null, null, '{}', 3, 0);
  perform pg_temp.chk('G1 paginação: 3 de 10 linhas, total do número inteiro e aviso de que há mais', jsonb_array_length(d->'rows') = 3 and (d->>'count')::integer = 10 and (d->>'total_cents')::bigint = 654000 and (d->>'truncated')::boolean, d::text);
  d := pg_temp.det('gestor', 'sold', null, null, '{}', 3, 9);
  perform pg_temp.chk('G2 última página: 1 linha e sem aviso', jsonb_array_length(d->'rows') = 1 and not (d->>'truncated')::boolean, d::text);
end $t$;

create function pg_temp.as_user_access(p_user text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(p_user); v := public.fin_my_access(pg_temp.f('c')); perform pg_temp.su(); return v;
end $$;
grant execute on function pg_temp.as_user_access(text) to public;

-- ---------- B. Unidades: soma das unidades = clínica; gestor restrito vê só a sua ----------
do $t$
declare
  c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); s jsonb; a jsonb; b jsonb; z jsonb; k text;
begin
  s := pg_temp.dash('gestor'); a := pg_temp.dash('gestor', null, u1); b := pg_temp.dash('gestor', null, u2);
  perform pg_temp.chk('U1 unidade 2: Vendido 500,00 (1 venda), Recebido 500,00, imposto 10% = 50,00, sem material', pg_temp.n(b, '{cards,sold_cents}') = 50000 and pg_temp.n(b, '{cards,sold_count}') = 1 and pg_temp.n(b, '{cards,received_cents}') = 50000
     and pg_temp.n(b, '{cards,tax_cents}') = 5000 and pg_temp.n(b, '{cards,material_cents}') = 0 and not (b->>'all_units')::boolean, b->>'cards');
  perform pg_temp.chk('U2 a soma das unidades = a clínica em cada indicador somável', (select bool_and(coalesce((a->'cards'->>x)::bigint, 0) + coalesce((b->'cards'->>x)::bigint, 0) = (s->'cards'->>x)::bigint)
     from unnest(array['sold_cents', 'sold_count', 'received_cents', 'fees_cents', 'tax_cents', 'material_cents', 'repasse_cents', 'products_cost_cents', 'products_revenue_cents', 'products_commission_cents', 'to_receive_cents', 'overdue_cents', 'margin_cents']) x), a->>'cards');
  perform pg_temp.f12('U3 F12 com unidade: Vendido da unidade 2', 'sold', 50000, null, u2, '{}', 'gestor', 1);
  perform pg_temp.f12('U4 F12 com unidade: Recebido da unidade 1', 'received', 294000, null, u1, '{}', 'gestor', 4);
  perform pg_temp.f12('U5 F12 com unidade: Margem da unidade 1 (composição)', 'margin', (a->'cards'->>'margin_cents')::bigint, null, u1, '{}', 'gestor', 6);
  perform pg_temp.chk('U6 gestor restrito à unidade 1 vê exatamente o painel da unidade 1 (e «todas» para ele é só a unidade 1)', (pg_temp.dash('pz')->'cards') = (a->'cards') and (pg_temp.dash('pz')->>'all_units')::boolean is false, pg_temp.dash('pz')->>'cards');
  perform pg_temp.expect('U7 gestor restrito não abre a unidade 2', '42501', format($q$select pg_temp.dash('pz', null, %L)$q$, u2));
  perform pg_temp.expect('U8 gestor restrito não abre a lista da unidade 2', '42501', format($q$select pg_temp.det('pz', 'sold', null, %L)$q$, u2));
  z := pg_temp.det('pz', 'sold');
  perform pg_temp.chk('U9 a lista do gestor restrito não traz venda da unidade 2', (z->>'count')::integer = 9 and not exists (select 1 from jsonb_array_elements(z->'rows') x where x->>'unit_name' = 'Unidade 2'), (z->>'count'));
  perform pg_temp.chk('U10 o repasse do gestor restrito é a soma dos lançamentos da unidade 1 (nunca o fechamento da clínica inteira)', not exists (select 1 from jsonb_array_elements(pg_temp.dash('pz')->'by_professional') x where x->>'repasse_source' <> 'lines'), null);
end $t$;

-- ---------- C. Fechamento do mês anterior: o painel usa o extrato (bruto, nunca negativo) e as linhas «close:» não contam duas vezes ----------
do $t$
declare
  c uuid := pg_temp.f('c'); d0 date := private.fin_today(); p0 text := to_char(private.fin_today(), 'YYYY-MM'); p1 text := to_char((date_trunc('month', private.fin_today()) - interval '1 month')::date, 'YYYY-MM');
  s jsonb; before jsonb; v bigint; d jsonb; n integer;
begin
  before := pg_temp.dash('gestor', p1);
  perform pg_temp.chk('C1 antes de iniciar o fechamento, o repasse do mês anterior = lançamentos (480,00 de pa); fixo mensal ainda não entra', pg_temp.n(before, '{cards,repasse_cents}') = 48000 and before->>'closing_status' is null, before->>'cards');
  perform pg_temp.as_user('gestor'); perform public.fin_closing_start(c, p1); perform pg_temp.su();
  s := pg_temp.dash('gestor', p1);
  select coalesce(sum(greatest(cp.gross_cents, 0)), 0) into v from public.fin_closing_pros cp join public.fin_closings fc on fc.id = cp.closing_id where fc.clinic_id = c and fc.period = p1;
  perform pg_temp.chk('C2 com o fechamento iniciado, o repasse do painel = soma dos brutos dos extratos (fixo mensal incluído), e o status do fechamento aparece', pg_temp.n(s, '{cards,repasse_cents}') = v and v = 148000 and s->>'closing_status' = 'conferencia', s->>'cards');
  perform pg_temp.chk('C3 saldo negativo (taxa de uso de pd sem produção) não vira repasse negativo no painel: extrato com bruto < 0 entra como 0', exists (select 1 from public.fin_closing_pros cp join public.fin_closings fc on fc.id = cp.closing_id where fc.period = p1 and cp.gross_cents < 0)
     and not exists (select 1 from jsonb_array_elements(pg_temp.det('gestor', 'repasse', p1)->'rows') x where (x->>'value_cents')::bigint < 0), null);
  perform pg_temp.f12('C4 F12 repasse com fechamento: uma linha por extrato, soma = número', 'repasse', v, p1, null, '{}', 'gestor', 1);
  d := pg_temp.det('gestor', 'repasse', p1);
  perform pg_temp.chk('C5 a linha do repasse traz o extrato (para abrir o fechamento) e a origem «closing»', d->'rows'->0->>'source' = 'closing' and (d->'rows'->0->>'closing_pro_id') is not null and d->'rows'->0->>'closing_status' = 'open', d::text);
  perform pg_temp.chk('C6 margem do mês anterior usa o repasse do fechamento: composição soma o número', (s->'cards'->>'margin_cents')::bigint = 80000 - 0 - 0 - 0 - 148000 - 0, s->>'cards');
  perform pg_temp.f12('C7 F12 margem do mês anterior', 'margin', (s->'cards'->>'margin_cents')::bigint, p1, null, '{}', 'gestor', 6);
  perform pg_temp.chk('C8 com uma unidade escolhida o painel NÃO usa o extrato da clínica (soma os lançamentos da unidade)', (pg_temp.dash('gestor', p1, pg_temp.f('u1'))->'by_professional'->0->>'repasse_source') = 'lines', null);
  -- linha «close:» (razão do travamento) e retenção nunca entram de novo
  insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, line_key, source_date, amount_cents, kind)
    values (c, pg_temp.f('u1'), pg_temp.f('pro_pa'), p0, 'adjustment', null, 'manual', 'close:99:x:1', d0, 777, 'manual'), (c, pg_temp.f('u1'), pg_temp.f('pro_pa'), p0, 'withholding', null, 'manual', 'close:99:x:2', d0, -555, 'manual');
  perform pg_temp.chk('C9 linhas do razão «close:» e retenções não entram no repasse do painel (mês atual segue em R$ 1.176,00)', pg_temp.n(pg_temp.dash('gestor'), '{cards,repasse_cents}') = 117600, null);
  -- ajuste manual: uma linha avulsa da clínica (sem unidade) entra no total da clínica e fica fora da unidade
  insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, line_key, source_date, amount_cents, kind)
    values (c, null, pg_temp.f('pro_pb'), p0, 'adjustment', null, 'manual', 'manual:qa-e7:1', d0, 10000, 'manual');
  perform pg_temp.chk('C10 ajuste manual sem unidade soma no total da clínica (1.276,00) e não em nenhuma unidade', pg_temp.n(pg_temp.dash('gestor'), '{cards,repasse_cents}') = 127600
     and pg_temp.n(pg_temp.dash('gestor', null, pg_temp.f('u1')), '{cards,repasse_cents}') + pg_temp.n(pg_temp.dash('gestor', null, pg_temp.f('u2')), '{cards,repasse_cents}') = 117600, null);
  perform pg_temp.f12('C11 F12 repasse com ajuste manual', 'repasse', 127600, null, null, '{}', 'gestor', 2);
end $t$;

-- ---------- D. Permissões por papel, outra clínica, funções internas e erros ----------
do $t$
declare
  c uuid := pg_temp.f('c'); k text; n integer; a jsonb; ok boolean; msg text;
begin
  foreach k in array array['owner', 'gestor', 'fin'] loop
    perform pg_temp.chk('D1 ' || k || ' abre o painel', (pg_temp.dash(k)->'cards') is not null and (pg_temp.det(k, 'sold')->>'count')::integer = 10, k);
  end loop;
  foreach k in array array['recep', 'estoq', 'pa', 'pc', 'px', 'other'] loop
    perform pg_temp.expect('D2 ' || k || ' não abre o painel da clínica (other = admin de outra clínica)', '42501', format($q$select pg_temp.dash(%L)$q$, k));
    perform pg_temp.expect('D3 ' || k || ' não abre nenhuma lista do painel', '42501', format($q$select pg_temp.det(%L, 'received')$q$, k));
  end loop;
  foreach k in array array['sold', 'received', 'repasse', 'margin', 'appt_no_sale', 'cash', 'stock', 'unruled', 'packages', 'overdue', 'to_receive', 'tax', 'material', 'products_cost'] loop
    perform pg_temp.expect('D4 Recepção não alcança a lista «' || k || '»', '42501', format($q$select pg_temp.det('recep', %L)$q$, k));
  end loop;
  perform pg_temp.chk('D5 acesso do chamador: Admin, Gestor e Financeiro têm dash_read; Recepção, Estoquista e profissional não', (
    select bool_and((pg_temp.as_user_access(x.u)->'can'->>'dash_read')::boolean = x.exp )
      from (values ('owner', true), ('gestor', true), ('fin', true), ('recep', false), ('estoq', false), ('pa', false), ('pz', true)) x(u, exp)), null);
  -- sem sessão e funções internas
  perform pg_temp.su();
  execute 'set local role anon';
  begin perform public.fin_dashboard_summary(c); ok := false; msg := 'passou'; exception when others then ok := sqlstate in ('42501'); msg := sqlstate; end;
  perform pg_temp.su();
  perform pg_temp.chk('D6 anônimo não executa o painel', ok, msg);
  perform pg_temp.as_user('gestor');
  begin perform private.dash_figures(c, to_char(private.fin_today(), 'YYYY-MM'), array[pg_temp.f('u1')], true); ok := false; msg := 'passou'; exception when others then ok := sqlstate = '42501'; msg := sqlstate; end;
  perform pg_temp.chk('D7 as funções internas private.dash_* não são executáveis pelo usuário', ok, msg);
  perform pg_temp.su();
  -- período e métrica inválidos
  perform pg_temp.expect('D8 mês inválido é recusado', '22023', $q$select pg_temp.dash('gestor', '2026-13')$q$, null);
  perform pg_temp.expect('D9 métrica inexistente é recusada', '22023', $q$select pg_temp.det('gestor', 'qualquer')$q$, null);
end $t$;

-- ---------- E. Clínica sem movimento: zeros, sem «-0», ticket vazio ----------
do $t$
declare c2 uuid := pg_temp.f('c2'); s jsonb; d jsonb;
begin
  perform pg_temp.as_user('other');
  s := public.fin_dashboard_summary(c2);
  d := public.fin_dashboard_detail(c2, 'margin');
  perform pg_temp.su();
  perform pg_temp.chk('Z1 clínica sem movimento: tudo zero, ticket médio vazio, 12 meses e 14 faixas', pg_temp.n(s, '{cards,sold_cents}') = 0 and pg_temp.n(s, '{cards,margin_cents}') = 0 and (s->'cards'->>'ticket_cents') is null
     and jsonb_array_length(s->'evolution') = 12 and jsonb_array_length(s->'agenda') = 14 and s->'by_professional' = '[]'::jsonb and s->'by_method' = '[]'::jsonb, s::text);
  perform pg_temp.chk('Z2 lista de margem sem movimento soma zero', (d->>'total_cents')::bigint = 0, d::text);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
