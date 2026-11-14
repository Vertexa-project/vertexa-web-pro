-- Prova SQL da FIN-E6 (fechamento mensal do repasse) num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e6-sql-proof.sh  (cria o cluster/banco, aplica stub + E1..E6, roda este arquivo e apaga tudo).
-- Roda dentro de begin ... rollback. Datas fixas de 2026 (junho e julho): fechamento exige mês encerrado.
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


-- ---------- helpers do fechamento ----------
create function pg_temp.cp(p_pro text, p_period text) returns uuid language sql security definer as $$
  select cp.id from public.fin_closing_pros cp join public.fin_closings c on c.id = cp.closing_id where c.period = p_period and cp.clinic_id = pg_temp.f('c') and cp.professional_id = pg_temp.f('pro_' || p_pro) $$;
create function pg_temp.cpv(p_pro text, p_period text, p_col text) returns text language plpgsql security definer as $$
declare v text;
begin execute format('select %I::text from public.fin_closing_pros where id = %L', p_col, pg_temp.cp(p_pro, p_period)) into v; return v; end $$;
create function pg_temp.clo(p_period text) returns uuid language sql security definer as $$ select id from public.fin_closings where clinic_id = pg_temp.f('c') and period = p_period $$;
create function pg_temp.row(p_pro text, p_period text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user('gestor');
  select e into v from jsonb_array_elements(public.fin_closing_get(pg_temp.f('c'), p_period)->'rows') e where e->>'professional_id' = pg_temp.f('pro_' || p_pro)::text;
  perform pg_temp.su();
  return v;
end $$;
grant execute on function pg_temp.cp(text, text), pg_temp.cpv(text, text, text), pg_temp.clo(text), pg_temp.row(text, text) to public;

-- ---------- configuração: regras, dados financeiros e produção de junho/2026 ----------
do $t$
declare c uuid := pg_temp.f('c'); r uuid;
begin
  perform pg_temp.as_user('fin');
  perform public.fin_save_professional_finance(pg_temp.f('pro_pa'), jsonb_build_object('bond_type', 'pj', 'simples_optant', false, 'requires_invoice', true, 'tax_id', '52998224725', 'pix_key', 'pa@pix.test'),
    jsonb_build_array(jsonb_build_object('rule_type', 'irrf', 'rate_pct', 1.5, 'valid_from', '2026-01-01'), jsonb_build_object('rule_type', 'pis_cofins_csll', 'rate_pct', 4.65, 'valid_from', '2026-01-01')));
  perform public.fin_save_professional_finance(pg_temp.f('pro_px'), jsonb_build_object('bond_type', 'autonomo', 'tax_id', '52998224725', 'pix_key', 'px@pix.test'), '[]'::jsonb);
  perform pg_temp.su();
  -- pa: 60% + fixo mensal 1.000 (junho em diante)
  perform pg_temp.rule('pa', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('pa', jsonb_build_object('rule_type', 'fixed_monthly', 'amount_cents', 100000, 'valid_from', '2026-06-01'));
  perform pg_temp.sale_pay('pa1', 'pat', pg_temp.svc_item('sv_cons', 1000000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1000000));
  perform pg_temp.mk_appt('pa1a', 'pat', 'sv_cons', '2026-06-05', pg_temp.parts('pa'), 'pa1'); perform pg_temp.settle('pa1', array['2026-06-05'::date]);
  perform pg_temp.sale_pay('pa2', 'pat', pg_temp.svc_item('sv_cons', 100000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 100000));
  perform pg_temp.mk_appt('pa2a', 'pat', 'sv_cons', '2026-06-12', pg_temp.parts('pa'), 'pa2'); perform pg_temp.settle('pa2', array['2026-06-12'::date]);
  -- pb: 50% − taxa de uso 100,00
  perform pg_temp.rule('pb', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('pb', jsonb_build_object('rule_type', 'usage_fee', 'usage_fee_mode', 'fixed', 'amount_cents', 10000, 'valid_from', '2026-06-01'));
  perform pg_temp.sale_pay('pb1', 'pat2', pg_temp.svc_item('sv_cons', 200000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 200000));
  perform pg_temp.mk_appt('pb1a', 'pat2', 'sv_cons', '2026-06-09', pg_temp.parts('pb'), 'pb1'); perform pg_temp.settle('pb1', array['2026-06-09'::date]);
  -- pc: atendimento realizado SEM regra (F2)
  perform pg_temp.sale_pay('pc1', 'pat', pg_temp.svc_item('sv_cons', 50000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 50000));
  perform pg_temp.mk_appt('pc1a', 'pat', 'sv_cons', '2026-06-15', pg_temp.parts('pc'), 'pc1'); perform pg_temp.settle('pc1', array['2026-06-15'::date]);
  -- pd: só taxa de uso 500,00 (junho): mês negativo
  perform pg_temp.rule('pd', jsonb_build_object('rule_type', 'usage_fee', 'usage_fee_mode', 'fixed', 'amount_cents', 50000, 'valid_from', '2026-06-01', 'valid_to', '2026-06-30'));
  -- px: 50% com duas vendas de 1.000,00
  perform pg_temp.rule('px', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  perform pg_temp.sale_pay('px1', 'pat', pg_temp.svc_item('sv_cons', 100000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 100000));
  perform pg_temp.mk_appt('px1a', 'pat', 'sv_cons', '2026-06-08', pg_temp.parts('px'), 'px1'); perform pg_temp.settle('px1', array['2026-06-08'::date]);
  perform pg_temp.sale_pay('px2', 'pat2', pg_temp.svc_item('sv_cons', 100000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 100000));
  perform pg_temp.mk_appt('px2a', 'pat2', 'sv_cons', '2026-06-20', pg_temp.parts('px'), 'px2'); perform pg_temp.settle('px2', array['2026-06-20'::date]);
  perform pg_temp.chk('Z1 fixture: junho de pa = 660,00 de percentual (60% de 11.000), pb = 1.000,00, px = 1.000,00', pg_temp.lsum('pa', '2026-06', 'pct') = 66000 * 10 and pg_temp.lsum('pb', '2026-06', 'pct') = 100000 and pg_temp.lsum('px', '2026-06', 'pct') = 100000, pg_temp.lsum('pa', '2026-06', 'pct')::text);
end $t$;

-- ---------- 0. Começar o fechamento: regras de entrada e permissões ----------
do $t$
declare c uuid := pg_temp.f('c'); j jsonb; k text;
begin
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('S0 mês corrente não fecha (o fechamento começa no dia 1 do mês seguinte)', '22023', format($q$select public.fin_closing_start(%L, to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM'))$q$, c), 'PERIOD_NOT_ENDED');
  perform pg_temp.expect('S0b competência inválida', '22023', format($q$select public.fin_closing_start(%L, '2026-13')$q$, c), 'INVALID_PERIOD');
  perform pg_temp.su();
  foreach k in array array['recep', 'estoq', 'pa', 'px'] loop
    perform pg_temp.as_user(k);
    perform pg_temp.expect('P1 ' || k || ' não inicia fechamento', '42501', format($q$select public.fin_closing_start(%L, '2026-06')$q$, c));
    perform pg_temp.expect('P2 ' || k || ' não vê a tabela do gestor', '42501', format($q$select public.fin_closing_get(%L, '2026-06')$q$, c));
    perform pg_temp.su();
  end loop;
  perform pg_temp.as_user('other');
  perform pg_temp.expect('P3 admin de outra clínica não inicia nem vê', '42501', format($q$select public.fin_closing_start(%L, '2026-06')$q$, c));
  perform pg_temp.su();
  -- Financeiro prepara
  perform pg_temp.as_user('fin');
  j := public.fin_closing_start(c, '2026-06');
  perform pg_temp.su();
  perform pg_temp.chk('S1 Financeiro inicia o fechamento de junho: 4 extratos (pa, pb, pd e px; quem não tem movimento no mês fica de fora)', (j->>'created')::boolean and (j->>'professionals')::int = 4, j::text);
  perform pg_temp.as_user('gestor');
  j := public.fin_closing_start(c, '2026-06');
  perform pg_temp.su();
  perform pg_temp.chk('S2 iniciar de novo é idempotente (não duplica)', not (j->>'created')::boolean and (select count(*) from public.fin_closings where clinic_id = c) = 1 and (select count(*) from public.fin_closing_pros) = 4, j::text);
  perform pg_temp.chk('S3 estado inicial: em conferência, todos abertos e aceite pendente com prazo de 5 dias', (select status = 'conferencia' from public.fin_closings where clinic_id = c)
     and not exists (select 1 from public.fin_closing_pros where status <> 'open' or acceptance <> 'pending' or accept_deadline <> (now() at time zone 'America/Sao_Paulo')::date + 5 or notified_at is null), null);
  insert into fx values ('cl6', pg_temp.clo('2026-06'));
end $t$;

-- ---------- 1. Tabela do gestor × extratos (F13) ----------
do $t$
declare c uuid := pg_temp.f('c'); g jsonb; k text; r jsonb; st jsonb; live jsonb; v_sum bigint;
begin
  perform pg_temp.as_user('gestor');
  g := public.fin_closing_get(c, '2026-06');
  perform pg_temp.su();
  perform pg_temp.chk('T1 tabela: 4 linhas (pa, pb, pd, px) e o fechamento em conferência', jsonb_array_length(g->'rows') = 4 and g->'closing'->>'status' = 'conferencia' and (g->>'period_ended')::boolean, g::text);
  r := pg_temp.row('pa', '2026-06');
  perform pg_temp.chk('T2 pa: percentual 6.600,00 + fixo mensal 1.000,00 = bruto 7.600,00', (r->>'pct_cents')::bigint = 660000 and (r->>'fixed_monthly_cents')::bigint = 100000 and (r->>'gross_cents')::bigint = 760000 and (r->>'appointments')::int = 2, r::text);
  perform pg_temp.chk('T3 pa: retenções IRRF 1,5% = 114,00 + PIS/COFINS/CSLL 4,65% = 353,40 → líquido 7.132,60', (r->>'withholding_cents')::bigint = 46740 and (r->>'net_cents')::bigint = 713260
     and (r->'withholdings'->0->>'amount_cents')::bigint = 11400 and (r->'withholdings'->1->>'amount_cents')::bigint = 35340, r::text);
  r := pg_temp.row('pb', '2026-06');
  perform pg_temp.chk('T4 pb: 1.000,00 − taxa de uso 100,00 = 900,00, sem retenção', (r->>'gross_cents')::bigint = 90000 and (r->>'usage_fee_cents')::bigint = -10000 and (r->>'net_cents')::bigint = 90000 and (r->>'withholding_cents')::bigint = 0, r::text);
  r := pg_temp.row('pd', '2026-06');
  perform pg_temp.chk('T5 F6: pd com bruto negativo (−500,00): sem retenção, líquido 0, marcado para o alerta do gestor', (r->>'gross_cents')::bigint = -50000 and (r->>'net_cents')::bigint = 0 and (r->>'negative')::boolean and (g->'pendencies'->>'negative_count')::int = 1, r::text);
  -- F13: cada linha da tabela = extrato do profissional = soma dos itens do extrato = prévia viva do motor
  foreach k in array array['pa', 'pb', 'pd', 'px'] loop
    perform pg_temp.as_user('gestor');
    st := public.fin_closing_statement(pg_temp.cp(k, '2026-06'));
    perform pg_temp.su();
    r := pg_temp.row(k, '2026-06');
    live := private.share_month(c, pg_temp.f('pro_' || k), '2026-06');
    perform pg_temp.chk('F13 ' || k || ': bruto, retenções e líquido da tabela = extrato = motor', (st->'row'->>'gross_cents') = (r->>'gross_cents') and (st->'row'->>'withholding_cents') = (r->>'withholding_cents') and (st->'row'->>'net_cents') = (r->>'net_cents')
       and (live->>'gross_total_cents') = (r->>'gross_cents') and (live->>'withholding_total_cents') = (r->>'withholding_cents') and (live->>'net_total_cents') = (r->>'net_cents'), (st->'row')::text);
    perform pg_temp.chk('F13 ' || k || ': a soma dos itens do extrato (lançamentos + linhas mensais) fecha com o total bruto', (st->'check'->>'matches')::boolean and (st->'check'->>'items_total_cents') = (r->>'gross_cents'), (st->'check')::text);
  end loop;
  v_sum := (g->'totals'->>'gross_cents')::bigint;
  perform pg_temp.chk('F13 total geral = soma das linhas (bruto, retenções e líquido)', v_sum = (select sum((e->>'gross_cents')::bigint) from jsonb_array_elements(g->'rows') e)
     and (g->'totals'->>'withholding_cents')::bigint = (select sum((e->>'withholding_cents')::bigint) from jsonb_array_elements(g->'rows') e)
     and (g->'totals'->>'net_cents')::bigint = (select sum((e->>'net_cents')::bigint) from jsonb_array_elements(g->'rows') e)
     and v_sum = 760000 + 90000 - 50000 + 100000, (g->'totals')::text);
  perform pg_temp.chk('T6 a tabela traz as pendências: 1 participante sem regra e títulos/atendimentos sem venda como aviso', (g->'pendencies'->>'unruled_count')::int = 1 and g->'pendencies'->'unruled'->0->>'professional_name' = 'Prof pc', (g->'pendencies')::text);
  perform pg_temp.as_user('gestor');
  g := public.fin_closing_get(c, '2026-06', gen_random_uuid());
  perform pg_temp.su();
  perform pg_temp.chk('T7 filtro por unidade desconhecida não traz profissional', jsonb_array_length(g->'rows') = 0, null);
  perform pg_temp.as_user('gestor');
  g := public.fin_closing_get(c, '2026-06', pg_temp.f('u1'));
  perform pg_temp.su();
  perform pg_temp.chk('T8 filtro pela unidade principal traz quem tem lançamento nela (pa, pb, px; pd só tem taxa de uso e fica fora)', jsonb_array_length(g->'rows') = 3, (g->'rows')::text);
end $t$;

-- ---------- 2. Aprovação: bloqueio «sem regra» (F2), aceite pendente e atalhos ----------
do $t$
declare c uuid := pg_temp.f('c'); cl uuid := pg_temp.f('cl6'); j jsonb;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('F2 aprovar com produção «sem regra» é bloqueado', '22023', format($q$select public.fin_closing_approve(%L)$q$, cl), 'UNRULED_PENDING');
  perform pg_temp.su();
  perform pg_temp.chk('F2b nada foi aprovado', not exists (select 1 from public.fin_closing_pros where status <> 'open'), null);
  -- o gestor marca «sem repasse» para pc: desbloqueia
  perform pg_temp.rule('pc', jsonb_build_object('role', 'responsavel', 'rule_type', 'none', 'valid_from', '2026-01-01'));
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('A0 Financeiro prepara mas não aprova', '42501', format($q$select public.fin_closing_approve(%L)$q$, cl));
  perform pg_temp.expect('A0b nem trava', '42501', format($q$select public.fin_closing_lock(%L)$q$, cl));
  perform pg_temp.expect('A0c pagar antes de aprovar é recusado', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', 'x'))$q$, pg_temp.cp('pb', '2026-06')), 'NOT_APPROVED');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  j := public.fin_closing_approve(cl);
  perform pg_temp.su();
  perform pg_temp.chk('A1 sem regra resolvida, mas aceite pendente dentro do prazo: ninguém é aprovado (ACCEPTANCE_PENDING)', (j->>'approved')::int = 0 and jsonb_array_length(j->'skipped') = 4
     and not exists (select 1 from jsonb_array_elements(j->'skipped') e where e->>'reason' <> 'ACCEPTANCE_PENDING'), j::text);
end $t$;

-- ---------- 3. Contestação (F7) ----------
do $t$
declare c uuid := pg_temp.f('c'); cl uuid := pg_temp.f('cl6'); j jsonb; v_line uuid; v_d uuid; st jsonb; v_pxline uuid;
begin
  select l.id into v_pxline from public.fin_share_lines l where l.professional_id = pg_temp.f('pro_px') limit 1;
  select l.id into v_line from public.fin_share_lines l where l.professional_id = pg_temp.f('pro_pa') and l.period = '2026-06' and l.line_type = 'pct' order by l.amount_cents desc limit 1;
  perform pg_temp.as_user('pa');
  perform pg_temp.expect('C0 comentário curto demais', '22023', format($q$select public.fin_closing_contest(%L, 'ok')$q$, pg_temp.cp('pa', '2026-06')), 'COMMENT_REQUIRED');
  perform pg_temp.expect('C0b linha de outro profissional', '22023', format($q$select public.fin_closing_contest(%L, 'esta linha não é minha', %L)$q$, pg_temp.cp('pa', '2026-06'), v_pxline), 'INVALID_LINE');
  v_d := public.fin_closing_contest(pg_temp.cp('pa', '2026-06'), 'O valor do atendimento de 05/06 está errado', v_line, 'Consulta 05/06');
  perform pg_temp.su();
  insert into fx values ('dispute_pa', v_d);
  perform pg_temp.chk('C1 F7: o profissional contesta uma linha: extrato «contestado», contestação aberta com o comentário', pg_temp.cpv('pa', '2026-06', 'acceptance') = 'contested'
     and (select status = 'open' and share_line_id = v_line and comment like '%atendimento de 05/06%' from public.fin_closing_disputes where id = v_d), null);
  perform pg_temp.as_user('px');
  perform pg_temp.expect('C2 outro profissional não contesta o extrato alheio', '42501', format($q$select public.fin_closing_contest(%L, 'quero contestar o do colega')$q$, pg_temp.cp('pa', '2026-06')));
  perform pg_temp.expect('C2b nem aceita', '42501', format($q$select public.fin_closing_accept(%L)$q$, pg_temp.cp('pa', '2026-06')));
  perform pg_temp.expect('C2c nem lê', '42501', format($q$select public.fin_closing_statement(%L)$q$, pg_temp.cp('pa', '2026-06')));
  perform pg_temp.su();
  perform pg_temp.as_user('pa');
  perform pg_temp.expect('C3 contestado não aceita de novo (NOT_PENDING)', '22023', format($q$select public.fin_closing_accept(%L)$q$, pg_temp.cp('pa', '2026-06')), 'NOT_PENDING');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  st := public.fin_closing_statement(pg_temp.cp('pa', '2026-06'));
  perform pg_temp.su();
  perform pg_temp.chk('C4 o gestor vê a contestação no extrato (com a linha apontada)', st->'disputes'->0->>'status' = 'open' and st->'disputes'->0->>'line_label' = 'Consulta 05/06' and (st->'row'->>'open_disputes')::int = 1, (st->'disputes')::text);
  perform pg_temp.as_user('gestor');
  j := public.fin_closing_approve(cl, array[pg_temp.f('pro_pa')]);
  perform pg_temp.su();
  perform pg_temp.chk('C5 contestado não é aprovado (CONTESTED)', (j->>'approved')::int = 0 and j->'skipped'->0->>'reason' = 'CONTESTED', j::text);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('C6 Financeiro não responde contestação', '42501', format($q$select public.fin_closing_answer(%L, 'revisado')$q$, v_d));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('C7 resposta curta', '22023', format($q$select public.fin_closing_answer(%L, 'ok')$q$, v_d), 'RESPONSE_REQUIRED');
  perform public.fin_closing_answer(v_d, 'Conferi o atendimento; faltou um bônus de produtividade.');
  perform pg_temp.su();
  -- 20261115120000_fin_e6_answer_refresh: responder a contestação já regenera o extrato (versão 2) e o devolve ao aceite do profissional
  perform pg_temp.chk('C7b responder a contestação já devolve o extrato ao aceite (versão 2, pendente), sem precisar «Atualizar extrato»', pg_temp.cpv('pa', '2026-06', 'acceptance') = 'pending' and pg_temp.cpv('pa', '2026-06', 'stmt_version') = '2'
     and (select status from public.fin_closing_disputes where id = v_d) = 'answered', concat_ws('/', pg_temp.cpv('pa', '2026-06', 'acceptance'), pg_temp.cpv('pa', '2026-06', 'stmt_version')));
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('C8 não responde duas vezes', '22023', format($q$select public.fin_closing_answer(%L, 'de novo')$q$, v_d), 'ALREADY_ANSWERED');
  -- corrige a origem: ajuste manual de bônus com motivo
  perform pg_temp.expect('C9 ajuste manual sem motivo', '22023', format($q$select public.fin_closing_adjust(%L, 'bonus', 5000, '')$q$, pg_temp.cp('pa', '2026-06')), 'REASON_REQUIRED');
  perform pg_temp.expect('C9b ajuste de valor zero', '22023', format($q$select public.fin_closing_adjust(%L, 'bonus', 0, 'motivo')$q$, pg_temp.cp('pa', '2026-06')), 'INVALID_AMOUNT');
  perform public.fin_closing_adjust(pg_temp.cp('pa', '2026-06'), 'bonus', 5000, 'Bônus de produtividade de junho');
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('C9c Financeiro não lança ajuste', '42501', format($q$select public.fin_closing_adjust(%L, 'bonus', 100, 'motivo teste')$q$, pg_temp.cp('pa', '2026-06')));
  perform pg_temp.su();
  perform pg_temp.chk('C10 F7: após o ajuste o extrato é regenerado de novo (versão 3, depois da versão 2 da resposta), volta para aceite e soma o bônus (bruto 7.650,00)', pg_temp.cpv('pa', '2026-06', 'acceptance') = 'pending' and pg_temp.cpv('pa', '2026-06', 'stmt_version') = '3'
     and pg_temp.cpv('pa', '2026-06', 'gross_cents') = '765000' and pg_temp.cpv('pa', '2026-06', 'adjustment_cents') = '5000', null);
  perform pg_temp.chk('C11 a retenção acompanha o novo bruto (IRRF 114,75 + PIS/COFINS/CSLL 355,73)', pg_temp.cpv('pa', '2026-06', 'withholding_cents') = '47048', pg_temp.cpv('pa', '2026-06', 'withholding_cents'));
  perform pg_temp.as_user('gestor');
  st := public.fin_closing_statement(pg_temp.cp('pa', '2026-06'));
  perform pg_temp.su();
  perform pg_temp.chk('C12 o ajuste manual aparece nos lançamentos do extrato, com o motivo, e o extrato continua fechando', (st->'check'->>'matches')::boolean and exists (select 1 from jsonb_array_elements(st->'lines') l where l->>'line_type' = 'adjustment' and l->>'reason' like 'Bônus%' and (l->>'amount_cents')::bigint = 5000), (st->'check')::text);
  perform pg_temp.chk('C13 a contestação respondida fica no extrato como histórico', st->'disputes'->0->>'status' = 'answered' and st->'disputes'->0->>'response' like 'Conferi%', null);
  -- o profissional vê o próprio extrato (já com a resposta) e aceita
  perform pg_temp.as_user('pa');
  st := public.fin_closing_statement(pg_temp.cp('pa', '2026-06'));
  perform public.fin_closing_accept(pg_temp.cp('pa', '2026-06'));
  perform pg_temp.su();
  perform pg_temp.chk('C14 o profissional lê o próprio extrato e aceita; sem botões de gestão', (st->>'is_self')::boolean and not (st->'can'->>'decide')::boolean and pg_temp.cpv('pa', '2026-06', 'acceptance') = 'accepted', null);
end $t$;

-- ---------- 4. Prazo vencido (F8), extrato que mudou e aprovação em lote ----------
do $t$
declare c uuid := pg_temp.f('c'); cl uuid := pg_temp.f('cl6'); j jsonb;
begin
  -- px aceita
  perform pg_temp.as_user('px'); perform public.fin_closing_accept(pg_temp.cp('px', '2026-06')); perform pg_temp.su();
  -- chega venda nova de pb no mês depois da fotografia: o extrato aprovado seria diferente
  perform pg_temp.sale_pay('pb2', 'pat2', pg_temp.svc_item('sv_cons', 40000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 40000));
  perform pg_temp.mk_appt('pb2a', 'pat2', 'sv_cons', '2026-06-25', pg_temp.parts('pb'), 'pb2'); perform pg_temp.settle('pb2', array['2026-06-25'::date]);
  -- vence o prazo de aceite de pb e pd (F8)
  update public.fin_closing_pros set accept_deadline = '2026-07-01' where professional_id in (pg_temp.f('pro_pb'), pg_temp.f('pro_pd'));
  perform pg_temp.as_user('gestor');
  j := public.fin_closing_approve(cl, array[pg_temp.f('pro_pb')]);
  perform pg_temp.su();
  perform pg_temp.chk('F8a prazo vencido mas o extrato mudou depois da fotografia: não aprova (STATEMENT_CHANGED)', (j->>'approved')::int = 0 and j->'skipped'->0->>'reason' = 'STATEMENT_CHANGED', j::text);
  perform pg_temp.as_user('fin');
  j := public.fin_closing_refresh(cl);
  perform pg_temp.su();
  perform pg_temp.chk('F8b «Atualizar extratos» regenera só o que mudou (pb: 1 extrato; versão 2; bruto 1.100,00; pa segue na versão 3 da resposta + ajuste)', (j->>'changed')::int = 1 and pg_temp.cpv('pb', '2026-06', 'stmt_version') = '2' and pg_temp.cpv('pb', '2026-06', 'gross_cents') = '110000'
     and pg_temp.cpv('pa', '2026-06', 'stmt_version') = '3' and pg_temp.cpv('px', '2026-06', 'stmt_version') = '1', j::text);
  perform pg_temp.as_user('gestor');
  j := public.fin_closing_approve(cl);
  perform pg_temp.su();
  perform pg_temp.chk('F8c F8: prazo vencido → o gestor aprova e o status registra «aprovado sem aceite» (pb e pd); pa e px com aceite', (j->>'approved')::int = 4 and jsonb_array_length(j->'skipped') = 0
     and pg_temp.cpv('pb', '2026-06', 'acceptance') = 'approved_without' and pg_temp.cpv('pd', '2026-06', 'acceptance') = 'approved_without'
     and pg_temp.cpv('pa', '2026-06', 'acceptance') = 'accepted' and pg_temp.cpv('px', '2026-06', 'acceptance') = 'accepted', j::text);
  perform pg_temp.chk('F8d todos aprovados: o fechamento passa para «aprovado» e a aprovação sem aceite fica no histórico', (select status = 'aprovado' from public.fin_closings where id = cl)
     and exists (select 1 from public.fin_audit_log where entity = 'closing_pro' and reason like 'Aprovado sem aceite%'), null);
  perform pg_temp.chk('F8e tabela: aceite mostra «aprovado sem aceite»', pg_temp.row('pb', '2026-06')->>'acceptance' = 'approved_without', null);
end $t$;

-- ---------- 5. Extrato aprovado é congelado: correção nova cai no próximo mês ----------
do $t$
declare c uuid := pg_temp.f('c'); rec uuid; before_gross text; m jsonb;
begin
  before_gross := pg_temp.cpv('pa', '2026-06', 'gross_cents');
  select id into rec from public.fin_receivables where sale_id = pg_temp.f('pa2');
  perform pg_temp.as_user('gestor'); perform public.fin_reverse_receivable(rec, 'chargeback do cartão'); perform pg_temp.su();
  perform pg_temp.chk('Q1 chargeback de título de profissional já aprovado: junho NÃO muda (linhas de junho de pa somam 6.650,00 com o bônus)', pg_temp.lsum('pa', '2026-06') = 660000 + 5000 and pg_temp.cpv('pa', '2026-06', 'gross_cents') = before_gross, pg_temp.lsum('pa', '2026-06')::text);
  perform pg_temp.chk('Q2 a linha negativa (−600,00) cai em julho, tipo ajuste, com o mês e a linha de origem', (select amount_cents = -60000 and origin_period = '2026-06' and origin_line_id is not null and line_type = 'adjustment' from public.fin_share_lines where professional_id = pg_temp.f('pro_pa') and period = '2026-07' and kind = 'correction'), null);
  perform pg_temp.as_user('gestor'); m := public.fin_share_month(c, pg_temp.f('pro_pa'), '2026-06'); perform pg_temp.su();
  perform pg_temp.chk('Q3 a prévia de junho devolve o extrato congelado', (m->>'gross_total_cents') = before_gross, m->>'gross_total_cents');
  -- alterar retenção depois não mexe no que foi aprovado
  perform pg_temp.as_user('fin');
  perform public.fin_save_professional_finance(pg_temp.f('pro_pa'), jsonb_build_object('bond_type', 'pj', 'simples_optant', false, 'requires_invoice', true, 'tax_id', '52998224725', 'pix_key', 'pa@pix.test'),
    jsonb_build_array(jsonb_build_object('rule_type', 'irrf', 'rate_pct', 3, 'valid_from', '2026-01-01'), jsonb_build_object('rule_type', 'pis_cofins_csll', 'rate_pct', 4.65, 'valid_from', '2026-01-01')));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor'); m := public.fin_share_month(c, pg_temp.f('pro_pa'), '2026-06'); perform pg_temp.su();
  perform pg_temp.chk('Q4 retenção alterada depois da aprovação: junho segue com as retenções aprovadas (470,48)', (m->>'withholding_total_cents') = '47048', m->>'withholding_total_cents');
end $t$;

-- ---------- 6. NF e pagamento ----------
do $t$
declare c uuid := pg_temp.f('c'); cl uuid := pg_temp.f('cl6'); j jsonb; v_pa uuid := pg_temp.cp('pa', '2026-06'); v_pb uuid := pg_temp.cp('pb', '2026-06'); v_px uuid := pg_temp.cp('px', '2026-06'); v_pd uuid := pg_temp.cp('pd', '2026-06');
  d text := ''; pf jsonb;
begin
  d := c::text || '/' || v_pa::text || '/';
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('N0 pagar quem exige NF sem a NF recebida', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', %L))$q$, v_pa, d || 'comprovante.pdf'), 'INVOICE_REQUIRED');
  perform pg_temp.expect('N1 NF de quem não é obrigado a emitir', '22023', format($q$select public.fin_closing_invoice_save(%L, '1', '2026-07-02', %L)$q$, v_pb, c::text || '/' || v_pb::text || '/nf.pdf'), 'INVOICE_NOT_REQUIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('px');
  perform pg_temp.expect('N2 outro profissional não anexa a NF do colega', '42501', format($q$select public.fin_closing_invoice_save(%L, '12', '2026-07-02', %L)$q$, v_pa, d || 'nf.pdf'));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('N3 Recepção não anexa NF nem paga', '42501', format($q$select public.fin_closing_invoice_save(%L, '12', '2026-07-02', %L)$q$, v_pa, d || 'nf.pdf'));
  perform pg_temp.su();
  perform pg_temp.as_user('pa');
  perform pg_temp.expect('N4 NF sem arquivo na pasta do extrato', '22023', format($q$select public.fin_closing_invoice_save(%L, '12', '2026-07-02', %L)$q$, v_pa, 'qualquer/coisa.pdf'), 'INVOICE_FILE_REQUIRED');
  perform pg_temp.expect('N5 NF com data futura', '22023', format($q$select public.fin_closing_invoice_save(%L, '12', '2999-01-01', %L)$q$, v_pa, d || 'nf.pdf'), 'INVALID_INVOICE_DATE');
  perform pg_temp.expect('N6 NF sem número', '22023', format($q$select public.fin_closing_invoice_save(%L, ' ', '2026-07-02', %L)$q$, v_pa, d || 'nf.pdf'), 'INVOICE_NUMBER_REQUIRED');
  perform pg_temp.expect('N6b o profissional não registra pagamento', '42501', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', %L))$q$, v_pa, d || 'comprovante.pdf'));
  perform public.fin_closing_invoice_save(v_pa, '1234', '2026-07-02', d || 'nf-1234.pdf');
  perform pg_temp.su();
  perform pg_temp.chk('N7 o próprio profissional anexa a NF (número, data e arquivo): NF «recebida» na tabela do gestor', pg_temp.row('pa', '2026-06')->>'nf_status' = 'received' and pg_temp.row('pb', '2026-06')->>'nf_status' = 'not_required'
     and pg_temp.row('pa', '2026-06')->>'invoice_number' = '1234', null);
  -- arquivo de pagamento (F14)
  perform pg_temp.as_user('pa');
  perform pg_temp.expect('F14a o profissional não baixa o arquivo de pagamento', '42501', format($q$select public.fin_closing_payment_file(%L)$q$, cl));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  pf := public.fin_closing_payment_file(cl);
  perform pg_temp.su();
  perform pg_temp.chk('F14 CSV: nome, documento, chave Pix/banco e líquido de cada profissional APROVADO a pagar (pa, pb e px; pd tem líquido 0)', jsonb_array_length(pf->'rows') = 3
     and (select (e->>'net_cents')::bigint = 717952 from jsonb_array_elements(pf->'rows') e where e->>'name' = 'Prof pa')
     and (select e->>'tax_id' = '52998224725' and e->>'pix_key' = 'pa@pix.test' from jsonb_array_elements(pf->'rows') e where e->>'name' = 'Prof pa')
     and not exists (select 1 from jsonb_array_elements(pf->'rows') e where e->>'name' = 'Prof pd'), pf::text);
  perform pg_temp.chk('F14c o acesso ao dado bancário/fiscal fica no histórico (LGPD)', exists (select 1 from public.fin_audit_log where entity = 'payment_file' and action = 'view_sensitive' and entity_id = cl), null);
  -- pagamento
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('N8 Recepção não paga', '42501', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', %L))$q$, v_pa, d || 'comprovante.pdf'));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('N9 comprovante obrigatório', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix'))$q$, v_pa), 'PROOF_REQUIRED');
  perform pg_temp.expect('N10 data de pagamento futura', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2999-01-01', 'method', 'pix', 'proof_path', %L))$q$, v_pa, d || 'comprovante.pdf'), 'INVALID_PAID_ON');
  perform pg_temp.expect('N11 forma inválida', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'cheque', 'proof_path', %L))$q$, v_pa, d || 'comprovante.pdf'), 'INVALID_METHOD');
  perform pg_temp.expect('N12 comprovante de outra pasta', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', %L))$q$, v_pa, c::text || '/' || v_pb::text || '/comprovante.pdf'), 'PROOF_REQUIRED');
  perform pg_temp.expect('N13 extrato com líquido 0 não tem o que pagar', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', %L))$q$, v_pd, c::text || '/' || v_pd::text || '/c.pdf'), 'NOTHING_TO_PAY');
  j := public.fin_closing_pay(v_pa, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', d || 'comprovante.pdf', 'note', 'Pix 05/07'));
  perform pg_temp.su();
  perform pg_temp.chk('N14 Financeiro registra o pagamento de pa (data, forma e comprovante): extrato «pago», mês ainda não trava', (j->>'paid')::boolean and not (j->>'locked')::boolean and pg_temp.cpv('pa', '2026-06', 'status') = 'paid'
     and pg_temp.row('pa', '2026-06')->>'payment_status' = 'paid' and pg_temp.row('pa', '2026-06')->>'paid_on' = '2026-07-05', j::text);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('N15 não paga duas vezes', '22023', format($q$select public.fin_closing_pay(%L, jsonb_build_object('paid_on', '2026-07-05', 'method', 'pix', 'proof_path', %L))$q$, v_pa, d || 'comprovante.pdf'), 'ALREADY_PAID');
  j := public.fin_closing_pay(v_pb, jsonb_build_object('paid_on', '2026-07-06', 'method', 'transfer', 'proof_path', c::text || '/' || v_pb::text || '/comp.png'));
  perform pg_temp.chk('N16 pagou pb; ainda falta px: não trava', not (j->>'locked')::boolean and (select status = 'aprovado' from public.fin_closings where id = cl), j::text);
  j := public.fin_closing_pay(v_px, jsonb_build_object('paid_on', '2026-07-06', 'method', 'pix', 'proof_path', c::text || '/' || v_px::text || '/comp.pdf'));
  perform pg_temp.su();
  perform pg_temp.chk('N17 todos pagos (pd sem líquido): o mês trava sozinho', (j->>'locked')::boolean and (select status = 'travado' and lock_no = 1 and locked_at is not null from public.fin_closings where id = cl)
     and exists (select 1 from public.fin_share_period_locks where clinic_id = c and period = '2026-06'), j::text);
end $t$;

-- ---------- 7. Mês travado (F9): nada muda; razão do mês gravado ----------
do $t$
declare c uuid := pg_temp.f('c'); cl uuid := pg_temp.f('cl6'); rec uuid; v_pa uuid := pg_temp.cp('pa', '2026-06'); k text; v_before bigint;
begin
  perform pg_temp.chk('L1 ledger: pa tem o fixo mensal (+1.000,00) e as duas retenções (−114,75 e −355,73) gravados como linhas do mês', pg_temp.lsum('pa', '2026-06', 'fixed_monthly') = 100000 and pg_temp.lsum('pa', '2026-06', 'withholding') = -47048
     and pg_temp.lcount('pa', '2026-06', 'withholding') = 2, null);
  perform pg_temp.chk('L2 ledger: pb tem a taxa de uso (−100,00); pd tem a taxa de uso (−500,00) e nenhuma retenção', pg_temp.lsum('pb', '2026-06', 'usage_fee') = -10000 and pg_temp.lsum('pd', '2026-06', 'usage_fee') = -50000 and pg_temp.lcount('pd', '2026-06', 'withholding') = 0, null);
  perform pg_temp.chk('L3 ledger: a soma de TODAS as linhas de junho de cada profissional = o líquido do extrato (pa 7.132,60... com bônus)', pg_temp.lsum('pa', '2026-06') = (pg_temp.cpv('pa', '2026-06', 'net_cents'))::bigint
     and pg_temp.lsum('pb', '2026-06') = (pg_temp.cpv('pb', '2026-06', 'net_cents'))::bigint and pg_temp.lsum('px', '2026-06') = (pg_temp.cpv('px', '2026-06', 'net_cents'))::bigint, pg_temp.lsum('pa', '2026-06')::text);
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('L4 as linhas mensais gravadas não aparecem duas vezes na lista de lançamentos', not exists (select 1 from jsonb_array_elements(public.fin_share_lines_list(c, pg_temp.f('pro_pa'), '2026-06')) e where e->>'line_type' in ('fixed_monthly', 'withholding')), null);
  perform pg_temp.su();
  perform pg_temp.chk('L5 a prévia de junho de pa segue idêntica (bruto 7.650,00; líquido 7.179,52) com o ledger gravado', (private.share_month(c, pg_temp.f('pro_pa'), '2026-06')->>'gross_total_cents') = '765000' and (private.share_month(c, pg_temp.f('pro_pa'), '2026-06')->>'net_total_cents') = '717952', null);
  -- F9: tudo recusado em mês travado
  perform pg_temp.as_user('px');
  perform pg_temp.expect('F9a profissional não contesta em mês travado', '42501', format($q$select public.fin_closing_contest(%L, 'quero contestar depois')$q$, pg_temp.cp('px', '2026-06')), 'PERIOD_LOCKED');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('F9b ajuste manual', '42501', format($q$select public.fin_closing_adjust(%L, 'bonus', 100, 'tentativa')$q$, v_pa), 'PERIOD_LOCKED');
  perform pg_temp.expect('F9c aprovar', '42501', format($q$select public.fin_closing_approve(%L)$q$, cl), 'PERIOD_LOCKED');
  perform pg_temp.expect('F9d atualizar extratos', '42501', format($q$select public.fin_closing_refresh(%L)$q$, cl), 'PERIOD_LOCKED');
  perform pg_temp.expect('F9e pagar', '42501', format($q$select public.fin_closing_pay(%L, '{}'::jsonb)$q$, v_pa), 'PERIOD_LOCKED');
  perform pg_temp.expect('F9f travar de novo', '22023', format($q$select public.fin_closing_lock(%L)$q$, cl), 'ALREADY_LOCKED');
  perform pg_temp.expect('F9g notificar', '42501', format($q$select public.fin_closing_notify(%L)$q$, cl), 'PERIOD_LOCKED');
  perform pg_temp.su();
  begin update public.fin_share_lines set amount_cents = 1 where professional_id = pg_temp.f('pro_pa') and period = '2026-06'; perform pg_temp.chk('F9h UPDATE em lançamento de mês travado é bloqueado', false, 'passou');
  exception when others then perform pg_temp.chk('F9h UPDATE em lançamento de mês travado é bloqueado', sqlstate = '42501' and sqlerrm like 'RECORD_IMMUTABLE%', sqlerrm); end;
end $t$;

-- ---------- 8. Correção depois de travado (F4) e destravar com motivo (F9) ----------
do $t$
declare c uuid := pg_temp.f('c'); cl uuid := pg_temp.f('cl6'); rec uuid; v_rows_before integer; v_n integer;
begin
  select id into rec from public.fin_receivables where sale_id = pg_temp.f('px2');
  perform pg_temp.as_user('gestor'); perform public.fin_reverse_receivable(rec, 'chargeback depois do fechamento'); perform pg_temp.su();
  perform pg_temp.chk('U1 F4: chargeback depois de travar: junho de px intacto (1.000,00) e a linha −500,00 vai para julho com a origem', pg_temp.lsum('px', '2026-06', 'pct') = 100000
     and (select amount_cents = -50000 and origin_period = '2026-06' and line_type = 'adjustment' from public.fin_share_lines where professional_id = pg_temp.f('pro_px') and period = '2026-07' and kind = 'correction'), null);
  -- destravar: só Owner/Admin, com motivo
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('U2 F9: Gestor não destrava (só Owner)', '42501', format($q$select public.fin_closing_unlock(%L, 'preciso corrigir')$q$, cl));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('U3 Financeiro não destrava', '42501', format($q$select public.fin_closing_unlock(%L, 'preciso corrigir')$q$, cl));
  perform pg_temp.su();
  perform pg_temp.as_user('pa');
  perform pg_temp.expect('U4 profissional não destrava', '42501', format($q$select public.fin_closing_unlock(%L, 'preciso corrigir')$q$, cl));
  perform pg_temp.su();
  perform pg_temp.as_user('owner');
  perform pg_temp.expect('U5 Owner sem motivo: recusado', '22023', format($q$select public.fin_closing_unlock(%L, ' ')$q$, cl), 'REASON_REQUIRED');
  perform public.fin_closing_unlock(cl, 'Corrigir o valor aprovado de pd');
  perform pg_temp.su();
  perform pg_temp.chk('U6 Owner destrava com motivo: a trava sai e o fechamento volta para conferência', not exists (select 1 from public.fin_share_period_locks where clinic_id = c and period = '2026-06')
     and (select status = 'conferencia' and unlock_reason = 'Corrigir o valor aprovado de pd' and unlocked_at is not null from public.fin_closings where id = cl), null);
  perform pg_temp.chk('U7 o motivo e o autor ficam no histórico (antes e depois)', exists (select 1 from public.fin_audit_log where entity = 'closing' and entity_id = cl and reason = 'Corrigir o valor aprovado de pd' and user_profile_id = pg_temp.f('prof_owner')
     and before->>'status' = 'travado' and after->>'status' = 'conferencia'), null);
  perform pg_temp.chk('U8 o razão do mês é estornado com linhas novas (a soma das linhas «close» de cada profissional volta a zero; nada foi apagado)', (select coalesce(sum(amount_cents), 0) from public.fin_share_lines where line_key like 'close:%') = 0
     and (select count(*) from public.fin_share_lines where line_key like 'close:rev:%') = (select count(*) from public.fin_share_lines where line_key like 'close:1:%') and pg_temp.lsum('pa', '2026-06') = 665000, null);
  perform pg_temp.chk('U9 quem já foi pago continua pago e congelado; quem estava só aprovado (pd) reabre para aceite', pg_temp.cpv('pa', '2026-06', 'status') = 'paid' and pg_temp.cpv('px', '2026-06', 'status') = 'paid'
     and pg_temp.cpv('pd', '2026-06', 'status') = 'open' and pg_temp.cpv('pd', '2026-06', 'acceptance') = 'pending' and pg_temp.cpv('pd', '2026-06', 'stmt_version') = '2', null);
  perform pg_temp.chk('U10 enquanto reaberto, pa (pago) segue congelado: nova correção dele vai para julho, não para junho', (select count(*) from public.fin_share_lines where professional_id = pg_temp.f('pro_pa') and period = '2026-06' and kind = 'correction' and line_key not like 'close:%') = 0, null);
  -- pd reaprovado (prazo vencido) e o Gestor trava manualmente: razão numerado 2
  update public.fin_closing_pros set accept_deadline = '2026-07-01' where id = pg_temp.cp('pd', '2026-06');
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('U11 travar com extrato em conferência é recusado', '22023', format($q$select public.fin_closing_lock(%L)$q$, cl), 'NOT_ALL_APPROVED');
  perform public.fin_closing_approve(cl);
  perform public.fin_closing_lock(cl, 'travado manualmente');
  perform pg_temp.su();
  perform pg_temp.chk('U12 trava manual do Gestor: ledger do 2º fechamento gravado; a soma das linhas «close» = linhas mensais de novo', (select lock_no = 2 and status = 'travado' from public.fin_closings where id = cl)
     and (select coalesce(sum(amount_cents), 0) from public.fin_share_lines where line_key like 'close:%') = (select coalesce(sum(amount_cents), 0) from public.fin_share_lines where line_key like 'close:2:%')
     and pg_temp.lsum('pa', '2026-06') = 717952 and pg_temp.lsum('pd', '2026-06', 'usage_fee') = -50000, (select coalesce(sum(amount_cents), 0) from public.fin_share_lines where line_key like 'close:%')::text);
end $t$;

-- ---------- 9. Julho: o que foi corrigido depois vem para o mês aberto; saldo negativo levado; reabrir extrato aprovado ----------
do $t$
declare c uuid := pg_temp.f('c'); j jsonb; g jsonb; r jsonb; v_cl uuid; n integer;
begin
  perform pg_temp.as_user('fin');
  perform public.fin_closing_start(c, '2026-07');
  g := public.fin_closing_get(c, '2026-07');
  perform pg_temp.su();
  v_cl := pg_temp.clo('2026-07');
  insert into fx values ('cl7', v_cl);
  r := pg_temp.row('pa', '2026-07');
  perform pg_temp.chk('J1 julho de pa: fixo mensal 1.000,00 + estorno do chargeback −600,00 = 400,00 (a correção de junho entra aqui)', (r->>'fixed_monthly_cents')::bigint = 100000 and (r->>'adjustment_cents')::bigint = -60000 and (r->>'gross_cents')::bigint = 40000, r::text);
  r := pg_temp.row('px', '2026-07');
  perform pg_temp.chk('J2 F6: px fica com −500,00 em julho: sem retenção, líquido 0, alerta para o gestor', (r->>'gross_cents')::bigint = -50000 and (r->>'net_cents')::bigint = 0 and (r->>'negative')::boolean, r::text);
  r := pg_temp.row('pd', '2026-07');
  perform pg_temp.chk('J3 pd: o saldo negativo de junho (−500,00) é levado para julho como ajuste', (r->>'adjustment_cents')::bigint = -50000 and (r->>'gross_cents')::bigint = -50000, r::text);
  perform pg_temp.chk('J4 julho não contém o ledger de junho (as linhas «close» não contam duas vezes)', (pg_temp.row('pa', '2026-07')->>'adjustment_cents')::bigint = -60000, null);
  perform pg_temp.chk('J5 o fechamento de junho não é alterado pelo de julho', (select status = 'travado' from public.fin_closings where id = pg_temp.f('cl6')) and pg_temp.cpv('pa', '2026-06', 'gross_cents') = '765000', null);
  -- notificar
  perform pg_temp.as_user('fin'); n := public.fin_closing_notify(v_cl); perform pg_temp.su();
  perform pg_temp.chk('J6 notificar os profissionais com extrato em conferência', n = 4, n::text);
  -- aceite e aprovação de pa em julho; depois pa reaberto pelo destravar → volta para aceite (manual lock com pb pendente é recusado)
  perform pg_temp.as_user('pa'); perform public.fin_closing_accept(pg_temp.cp('pa', '2026-07')); perform pg_temp.su();
  update public.fin_closing_pros set accept_deadline = '2026-08-01' where closing_id = v_cl and acceptance = 'pending';
  perform pg_temp.as_user('gestor');
  j := public.fin_closing_approve(v_cl);
  perform pg_temp.su();
  perform pg_temp.chk('J7 aprovação em lote de julho: 4 aprovados (1 com aceite, 3 sem aceite pelo prazo)', (j->>'approved')::int = 4 and (select count(*) from public.fin_closing_pros where closing_id = v_cl and acceptance = 'approved_without') = 3, j::text);
  perform pg_temp.as_user('gestor'); perform public.fin_closing_lock(v_cl); perform pg_temp.su();
  perform pg_temp.as_user('owner'); perform public.fin_closing_unlock(v_cl, 'Faltou lançar um adiantamento'); perform pg_temp.su();
  perform pg_temp.chk('J8 destravar julho reabre os 4 extratos aprovados (nenhum pago) para aceite, com nova versão', (select count(*) from public.fin_closing_pros where closing_id = v_cl and status = 'open' and acceptance = 'pending' and stmt_version = 2) = 4
     and (select status = 'conferencia' from public.fin_closings where id = v_cl), null);
  -- depois de destravar, o razão gravado ao travar (e o seu estorno) NÃO entra de novo na conta viva do mês
  r := pg_temp.row('pd', '2026-07');
  perform pg_temp.chk('J9 julho destravado: pd segue com saldo trazido −500,00 (o razão estornado não conta duas vezes)', (r->>'adjustment_cents')::bigint = -50000 and (r->>'gross_cents')::bigint = -50000 and (r->>'gross_cents') = pg_temp.cpv('pd', '2026-07', 'gross_cents'), r::text);
  r := pg_temp.row('pa', '2026-07');
  perform pg_temp.chk('J10 julho destravado: pa segue com 400,00 (fixo mensal 1.000,00 − estorno 600,00)', (r->>'gross_cents')::bigint = 40000 and (r->>'fixed_monthly_cents')::bigint = 100000 and (r->>'adjustment_cents')::bigint = -60000
     and (private.share_month(c, pg_temp.f('pro_pa'), '2026-07')->>'gross_total_cents')::bigint = 40000, r::text);
end $t$;

-- ---------- 10. Permissões, RLS, acesso do chamador, arquivos e imutabilidade ----------
do $t$
declare c uuid := pg_temp.f('c'); k text; n integer; j jsonb; v_pa uuid := pg_temp.cp('pa', '2026-06'); v_pb uuid := pg_temp.cp('pb', '2026-06');
begin
  -- meus extratos
  perform pg_temp.as_user('pa'); j := public.fin_closing_my_list(c); perform pg_temp.su();
  perform pg_temp.chk('R1 «Meu extrato»: o profissional vê só os próprios (junho e julho), nunca de outro', jsonb_array_length(j) = 2 and not exists (select 1 from jsonb_array_elements(j) e where e->>'id' not in (select id::text from public.fin_closing_pros where professional_id = pg_temp.f('pro_pa'))), j::text);
  foreach k in array array['recep', 'estoq', 'other'] loop
    perform pg_temp.as_user(k);
    perform pg_temp.expect('R2 ' || k || ' não tem «Meu extrato»', '42501', format($q$select public.fin_closing_my_list(%L)$q$, c));
    perform pg_temp.expect('R3 ' || k || ' não lê extrato', '42501', format($q$select public.fin_closing_statement(%L)$q$, v_pa));
    perform pg_temp.su();
  end loop;
  -- RLS direta
  perform pg_temp.as_user('pa');
  select count(*) into n from public.fin_closing_pros; perform pg_temp.chk('R4 RLS: o profissional só enxerga a própria linha de extrato (2 fechamentos)', n = 2, n::text);
  select count(*) into n from public.fin_closing_disputes; perform pg_temp.chk('R5 RLS: o profissional vê só as próprias contestações', n = 1, n::text);
  select count(*) into n from public.fin_closings; perform pg_temp.chk('R6 RLS: o profissional não lê a tabela de fechamentos', n = 0, n::text);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  select count(*) into n from public.fin_closing_pros; perform pg_temp.chk('R7 RLS: o Gestor lê todos os extratos', n = 8, n::text);
  perform pg_temp.su();
  foreach k in array array['recep', 'estoq', 'other'] loop
    perform pg_temp.as_user(k);
    select count(*) into n from public.fin_closing_pros; perform pg_temp.chk('R8 RLS: ' || k || ' lê 0 extratos', n = 0, n::text);
    perform pg_temp.su();
  end loop;
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('R9 escrita direta em fin_closings é negada', '42501', $q$update public.fin_closings set status = 'travado'$q$);
  perform pg_temp.expect('R10 escrita direta em fin_closing_pros é negada', '42501', $q$update public.fin_closing_pros set net_cents = 1$q$);
  perform pg_temp.expect('R11 inserir contestação direto é negado', '42501', format($q$insert into public.fin_closing_disputes (closing_pro_id, clinic_id, professional_id, comment) values (%L, %L, %L, 'x y z')$q$, v_pa, c, pg_temp.f('pro_pa')));
  perform pg_temp.su();
  begin delete from public.fin_closings; perform pg_temp.chk('R12 fechamento não se apaga', false, 'passou'); exception when others then perform pg_temp.chk('R12 fechamento não se apaga', sqlstate = '42501' and sqlerrm like 'RECORD_NOT_DELETABLE%', sqlerrm); end;
  begin truncate public.fin_closing_pros cascade; perform pg_temp.chk('R13 extrato não é truncado', false, 'passou'); exception when others then perform pg_temp.chk('R13 extrato não é truncado', sqlstate = '42501', sqlerrm); end;
  -- fin_my_access
  perform pg_temp.as_user('gestor'); j := public.fin_my_access(c)->'can'; perform pg_temp.su();
  perform pg_temp.chk('R14 acesso do Gestor: prepara, decide e paga', (j->>'close_prepare_write')::boolean and (j->>'close_decide_write')::boolean and (j->>'close_pay_write')::boolean, j::text);
  perform pg_temp.as_user('fin'); j := public.fin_my_access(c)->'can'; perform pg_temp.su();
  perform pg_temp.chk('R15 acesso do Financeiro: prepara e paga; não decide', (j->>'close_prepare_write')::boolean and (j->>'close_pay_write')::boolean and not (j->>'close_decide_write')::boolean, j::text);
  perform pg_temp.as_user('recep'); j := public.fin_my_access(c)->'can'; perform pg_temp.su();
  perform pg_temp.chk('R16 Recepção: nada do fechamento nem do repasse', not (j->>'close_prepare_write')::boolean and not (j->>'close_pay_write')::boolean and not (j->>'close_decide_write')::boolean and not (j->>'share_lines_read')::boolean and not (j->>'own_share')::boolean, j::text);
  perform pg_temp.as_user('pa'); j := public.fin_my_access(c)->'can'; perform pg_temp.su();
  perform pg_temp.chk('R17 profissional: só o próprio extrato (own_share), sem papel de gestão; as áreas da E5 seguem iguais', (j->>'own_share')::boolean and not (j->>'close_decide_write')::boolean and not (j->>'share_lines_read')::boolean, j::text);
  perform pg_temp.as_user('owner'); j := public.fin_my_access(c)->'can'; perform pg_temp.su();
  perform pg_temp.chk('R18 Owner/Admin: tudo', (j->>'close_prepare_write')::boolean and (j->>'close_decide_write')::boolean and (j->>'close_pay_write')::boolean, j::text);
  -- arquivos (NF e comprovante): bucket privado e políticas por extrato
  perform pg_temp.chk('R19 bucket fin-repasse existe e é privado', exists (select 1 from storage.buckets where id = 'fin-repasse' and not public), null);
  perform pg_temp.as_user('pa');
  perform pg_temp.expect('R20 o profissional envia a NF na pasta do próprio extrato', null, format($q$insert into storage.objects (bucket_id, name) values ('fin-repasse', %L)$q$, c::text || '/' || v_pa::text || '/nf-nova.pdf'));
  perform pg_temp.expect('R21 ... mas não na pasta do extrato de outro profissional', '42501', format($q$insert into storage.objects (bucket_id, name) values ('fin-repasse', %L)$q$, c::text || '/' || v_pb::text || '/nf.pdf'));
  perform pg_temp.expect('R22 ... nem fora do padrão clínica/extrato/arquivo', '42501', $q$insert into storage.objects (bucket_id, name) values ('fin-repasse', 'qualquer.pdf')$q$);
  select count(*) into n from storage.objects; perform pg_temp.chk('R23 lê só o arquivo do próprio extrato', n = 1, n::text);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('R24 Gestor anexa comprovante no extrato de qualquer profissional', null, format($q$insert into storage.objects (bucket_id, name) values ('fin-repasse', %L)$q$, c::text || '/' || v_pb::text || '/comprovante.pdf'));
  select count(*) into n from storage.objects; perform pg_temp.chk('R25 Gestor lê os arquivos do fechamento', n = 2, n::text);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('R26 Recepção não anexa arquivo', '42501', format($q$insert into storage.objects (bucket_id, name) values ('fin-repasse', %L)$q$, c::text || '/' || v_pb::text || '/x.pdf'));
  select count(*) into n from storage.objects; perform pg_temp.chk('R27 Recepção não lê arquivo', n = 0, n::text);
  perform pg_temp.su();
end $t$;

-- ---------- 11. Histórico (quem, quando, antes/depois, motivo) e invariantes ----------
do $t$
declare c uuid := pg_temp.f('c');
begin
  perform pg_temp.chk('H1 histórico do fechamento: início, contestação, resposta, ajuste, aprovações, NF, pagamentos, trava, destrava', (select count(distinct entity) from public.fin_audit_log where entity in ('closing', 'closing_pro', 'closing_dispute', 'payment_file')) = 4
     and exists (select 1 from public.fin_audit_log where entity = 'closing' and action = 'create' and reason like 'Fechamento de 2026-06%')
     and exists (select 1 from public.fin_audit_log where entity = 'closing_dispute' and action = 'create' and after->>'acceptance' = 'contested')
     and exists (select 1 from public.fin_audit_log where entity = 'closing_pro' and reason = 'Pagamento registrado' and after->>'method' = 'pix')
     and exists (select 1 from public.fin_audit_log where entity = 'closing' and after->>'status' = 'travado' and (after->>'auto')::boolean)
     and exists (select 1 from public.fin_audit_log where entity = 'closing' and after->>'status' = 'travado' and not (after->>'auto')::boolean and reason = 'travado manualmente'), null);
  perform pg_temp.chk('H2 todo registro do fechamento tem autor (quem) e data/hora (quando)', not exists (select 1 from public.fin_audit_log where entity like 'closing%' and (user_profile_id is null or at is null)), null);
  perform pg_temp.chk('H3 invariante: mês travado tem trava e todo extrato do mês está aprovado ou pago', not exists (select 1 from public.fin_closings k where k.status = 'travado' and (not exists (select 1 from public.fin_share_period_locks l where l.clinic_id = k.clinic_id and l.period = k.period)
     or exists (select 1 from public.fin_closing_pros p where p.closing_id = k.id and p.status = 'open'))), null);
  perform pg_temp.chk('H4 invariante: nenhum extrato pago sem data, forma e comprovante; nenhum aprovado sem aprovador', not exists (select 1 from public.fin_closing_pros where status = 'paid' and (paid_on is null or pay_method is null or proof_path is null or paid_by is null))
     and not exists (select 1 from public.fin_closing_pros where status in ('approved', 'paid') and (approved_at is null or approved_by is null)), null);
  perform pg_temp.chk('H5 invariante: «aprovado sem aceite» só com prazo vencido', not exists (select 1 from public.fin_closing_pros where acceptance = 'approved_without' and accept_deadline >= (now() at time zone 'America/Sao_Paulo')::date), null);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
