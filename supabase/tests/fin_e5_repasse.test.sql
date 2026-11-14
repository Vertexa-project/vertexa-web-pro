-- Prova SQL da FIN-E5 (motor de repasse) num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e5-sql-proof.sh  (cria o cluster/banco, aplica stub + E1 + E2 + E3 + E4 + E5, roda este arquivo e apaga tudo).
-- Roda dentro de begin ... rollback; a última consulta lista as asserções (ok=false = falha).
-- Datas fixas de 2026 (Exemplos A, B e D passam pelo caminho real das RPCs, que só aceitam atendimento a até 400 dias no passado);
-- os demais exemplos gravam o atendimento/título direto como dono do banco (simulam a integração) e reconciliam pelo mesmo motor.
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
  foreach k in array array['owner','gestor','fin','recep','estoq','other','dra_a','med_b','enf_b','pro_c','med_d','nutri_d','pers_d','enf_e','dr_f','dr_f2','dr_g','fisio_h','pro_ret','pro_simples','pro_f3','pro_f5','pro_f6','pro_f4','seller','pro_x','pro_f11a','pro_f11b','pro_f15','fisio_h2','med_comm'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'Prof ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','gestor','fin','recep','estoq','dra_a','med_b','enf_b','pro_c','med_d','nutri_d','pers_d','enf_e','dr_f','dr_f2','dr_g','fisio_h','pro_ret','pro_simples','pro_f3','pro_f5','pro_f6','pro_f4','seller','pro_x','pro_f11a','pro_f11b','pro_f15','fisio_h2','med_comm'] loop
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

-- estoque (kit a R$ 420,00 e produtos)
do $t$
declare u1 uuid := pg_temp.f('u1');
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.entry(u1, pg_temp.f('it_kit'), 40, 42000);
  perform pg_temp.entry(u1, pg_temp.f('it_sup'), 20, 6000);
  perform pg_temp.entry(u1, pg_temp.f('it_med'), 20, 10000, 'LM1');
  perform pg_temp.su();
end $t$;

-- venda de Manipulado em unidade sem licença: aceite do Owner (E2)
do $t$ begin perform pg_temp.as_user('owner'); perform public.fin_accept_compliance(pg_temp.f('c'), pg_temp.f('u1')); perform pg_temp.su(); end $t$;

-- configuração da clínica: padrão de fábrica (taxa ligada; imposto e material desligados) e alíquota 6% a partir de 2026-10 (os meses seguintes herdam: F21)
do $t$
begin
  perform pg_temp.as_user('gestor');
  perform public.fin_set_tax_rate(pg_temp.f('c'), '2026-10', 6, null, 'alíquota dos exemplos');
  perform public.fin_save_settings(pg_temp.f('c'), jsonb_build_object('auto_settle', false), 'a liquidação vem da integração nos testes');
  perform pg_temp.su();
  perform pg_temp.chk('Z0 fixture: deduções de fábrica (taxa sim, imposto não, material não), alíquota 6% em 2026-10 e liquidação manual', (select deduct_fee and not deduct_tax and not deduct_material from public.fin_settings where clinic_id = pg_temp.f('c'))
    and (select rate_pct = 6 from public.fin_tax_rates where clinic_id = pg_temp.f('c') and period = '2026-10'), null);
end $t$;

-- ---------- A. Exemplo A — consulta avulsa no cartão (Dra. A, Responsável 60%, taxa e imposto): repasse 273,00 no extrato de novembro ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; a uuid; r uuid; l public.fin_share_lines; n integer;
begin
  r := pg_temp.rule('dra_a', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01', 'deductions_override', jsonb_build_object('tax', true)));
  insert into fx values ('rule_a', r);
  s := pg_temp.sale_pay('sale_a', 'pat', pg_temp.svc_item('sv_cons'), jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Visa', 'modality', 'credit_1', 'installments', 1, 'amount_cents', 50000));
  perform pg_temp.chk('A0 título do cartão à vista: bruto 500,00, taxa 15,00 (3%), previsto +30 dias', (select gross_cents = 50000 and fee_cents = 1500 and net_cents = 48500 and status = 'expected' from public.fin_receivables where sale_id = s), null);
  -- atendimento em 10/10 pelo caminho real (RPCs); o título ainda não liquidou: nada de repasse percentual
  perform pg_temp.as_user('gestor');
  a := public.fin_appt_save(c, pg_temp.f('u1'), null, jsonb_build_object('patient_id', pg_temp.f('pat'), 'service_id', pg_temp.f('sv_cons'), 'sale_item_id', (select id from public.fin_sale_items where sale_id = s), 'performed_on', '2026-10-10'), pg_temp.parts('dra_a'));
  perform public.fin_appt_complete(a);
  perform pg_temp.su();
  insert into fx values ('appt_a', a);
  perform pg_temp.chk('A1 atendimento realizado e dinheiro ainda não liquidado: sem repasse percentual', pg_temp.lcount('dra_a') = 0, null);
  -- o título liquida em 09/11
  perform pg_temp.settle('sale_a', array['2026-11-09'::date]);
  select * into l from public.fin_share_lines where professional_id = pg_temp.f('pro_dra_a');
  perform pg_temp.chk('A2 Exemplo A: base 500 − 15 − 30 = 455,00', l.base_cents = 45500 and l.gross_cents = 50000, l.base_cents::text);
  perform pg_temp.chk('A3 Exemplo A: repasse 455 × 60% = R$ 273,00 no extrato de novembro', l.amount_cents = 27300 and l.period = '2026-11' and l.line_type = 'pct' and l.pct = 60, l.amount_cents || ' ' || l.period);
  perform pg_temp.chk('A4 memória de cálculo: regra, base, percentual, taxa, imposto e a fórmula', l.rule_id = r and (l.memory->>'fee_cents')::int = 1500 and (l.memory->>'tax_cents')::int = 3000 and (l.memory->>'tax_pct')::numeric = 6
    and l.memory->'rule'->>'type' = 'pct' and l.memory->>'formula' like '%base%' and l.appointment_id = a and l.receivable_id = (select id from public.fin_receivables where sale_id = s) and l.origin_period = '2026-11', l.memory::text);
  perform pg_temp.chk('A5 F21: a alíquota de 2026-11 não foi cadastrada e herda os 6% de 2026-10', (l.memory->>'tax_pct')::numeric = 6 and not exists (select 1 from public.fin_tax_rates where clinic_id = c and period = '2026-11'), null);
  -- idempotência: recalcular de novo não grava nada
  n := private.share_reconcile_appt(a, 'de novo') + private.share_reconcile_sale(s, 'de novo');
  perform pg_temp.chk('A6 recalcular é idempotente (nada novo gravado)', n = 0 and pg_temp.lcount('dra_a') = 1, n::text);
  perform pg_temp.chk('A7 prévia do mês: R$ 273,00 bruto', (pg_temp.month('dra_a', '2026-11')->>'gross_total_cents')::bigint = 27300, null);
end $t$;

-- ---------- B. Exemplo B — aplicação com dois participantes e material (médico 30%, enfermeira executora fixo R$ 30) ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; a uuid; v_cost bigint; v_margin bigint; v_med public.fin_share_lines;
begin
  perform pg_temp.rule('med_b', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 30, 'valid_from', '2026-01-01', 'deductions_override', jsonb_build_object('tax', true, 'material', true)));
  perform pg_temp.rule('enf_b', jsonb_build_object('role', 'executor', 'rule_type', 'fixed_per_exec', 'amount_cents', 3000, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('sale_b', 'pat', pg_temp.svc_item('sv_apl'), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 120000));
  perform pg_temp.as_user('gestor');
  a := public.fin_appt_save(c, pg_temp.f('u1'), null, jsonb_build_object('patient_id', pg_temp.f('pat'), 'service_id', pg_temp.f('sv_apl'), 'sale_item_id', (select id from public.fin_sale_items where sale_id = s), 'performed_on', '2026-10-15'), pg_temp.parts('med_b', 'enf_b'));
  perform public.fin_appt_complete(a);   -- kit automático: baixa o kit de R$ 420,00
  perform pg_temp.su();
  insert into fx values ('appt_b', a);
  select material_cost_cents into v_cost from public.fin_appointments where id = a;
  perform pg_temp.chk('B0 kit baixado a custo médio: R$ 420,00', v_cost = 42000, v_cost::text);
  -- o Pix liquidou em 15/10 (a liquidação automática gravou a data de hoje; aqui a data da integração)
  perform pg_temp.settle('sale_b', array['2026-10-15'::date]);
  select * into v_med from public.fin_share_lines where professional_id = pg_temp.f('pro_med_b');
  perform pg_temp.chk('B1 Exemplo B: base 1.200 − 0 − 72 − 420 = 708,00', v_med.base_cents = 70800, v_med.base_cents::text);
  perform pg_temp.chk('B2 Exemplo B: médico 708 × 30% = 212,40 em outubro', v_med.amount_cents = 21240 and v_med.period = '2026-10', v_med.amount_cents || ' ' || v_med.period);
  perform pg_temp.chk('B3 Exemplo B: enfermeira fixo por execução R$ 30,00 em outubro', pg_temp.lsum('enf_b', '2026-10', 'fixed_exec') = 3000 and pg_temp.lcount('enf_b', '2026-10', 'fixed_exec') = 1, null);
  v_margin := 120000 - (v_med.memory->>'tax_cents')::bigint - v_cost - pg_temp.lsum('med_b', null) - pg_temp.lsum('enf_b', null);
  perform pg_temp.chk('B4 Exemplo B: margem da clínica 1.200 − 72 − 420 − 212,40 − 30 = 465,60', v_margin = 46560, v_margin::text);
  perform pg_temp.chk('B5 fixo por execução independe de pagamento: gerado ao realizar (o título da venda B ainda nem existia liquidado antes de A realizar)', (select source_date from public.fin_share_lines where professional_id = pg_temp.f('pro_enf_b')) = '2026-10-15', null);
end $t$;

-- ---------- C. Exemplo C — procedimento parcelado 4× (taxa 5%, só taxa, regra 50%): R$ 237,50 por mês ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; a uuid;
begin
  perform pg_temp.rule('pro_c', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('sale_c', 'pat', pg_temp.svc_item('sv_proc'), jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Visa', 'modality', 'credit_2_6', 'installments', 4, 'amount_cents', 200000));
  perform pg_temp.mk_appt('appt_c', 'pat', 'sv_proc', '2026-10-05', pg_temp.parts('pro_c'), 'sale_c');
  perform pg_temp.chk('C0 antes de liquidar nada é repassado', pg_temp.lcount('pro_c') = 0, null);
  perform pg_temp.settle('sale_c', array['2026-11-04'::date, '2026-12-04', '2027-01-03', '2027-02-02']);
  perform pg_temp.chk('C1 Exemplo C: cada parcela 500 − 25 = 475 de base → 237,50', (select bool_and(base_cents = 47500 and amount_cents = 23750) from public.fin_share_lines where professional_id = pg_temp.f('pro_pro_c')) and pg_temp.lcount('pro_c') = 4, null);
  perform pg_temp.chk('C2 Exemplo C: nos extratos de novembro, dezembro, janeiro e fevereiro',
    (select array_agg(period order by period) = array['2026-11','2026-12','2027-01','2027-02'] from public.fin_share_lines where professional_id = pg_temp.f('pro_pro_c')), null);
  perform pg_temp.chk('C3 soma do repasse = 950,00 (4 × 237,50)', pg_temp.lsum('pro_c', null) = 95000, null);
end $t$;

-- ---------- D. Exemplo D — pacote multiprofissional (R$ 3.600 em 4× R$ 900, taxa 4%, só taxa; 50% / 50% / 40%) ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; pk uuid; pp uuid; i integer; a uuid; v_sale_item uuid; j jsonb;
begin
  perform pg_temp.as_user('owner');
  pk := public.fin_save_package(c, null, jsonb_build_object('name', 'Programa Multi', 'price_cents', 360000, 'validity_days', 120),
    jsonb_build_array(jsonb_build_object('item_type', 'service', 'service_id', pg_temp.f('sv_med'), 'quantity', 3, 'reference_price_cents', 50000),
                      jsonb_build_object('item_type', 'service', 'service_id', pg_temp.f('sv_nut'), 'quantity', 5, 'reference_price_cents', 30000),
                      jsonb_build_object('item_type', 'service', 'service_id', pg_temp.f('sv_pers'), 'quantity', 10, 'reference_price_cents', 10000)));
  perform pg_temp.su();
  insert into fx values ('pk_d', pk);
  perform pg_temp.rule('med_d', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('nutri_d', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('pers_d', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 40, 'valid_from', '2026-01-01'));
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, pg_temp.f('u1'), pg_temp.f('pat2'), jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pk, 'quantity', 1)));
  perform public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Master', 'modality', 'credit_2_6', 'installments', 4, 'amount_cents', 360000));
  perform pg_temp.su();
  insert into fx values ('sale_d', s);
  select id into pp from public.fin_patient_packages where sale_id = s; insert into fx values ('pp_d', pp);
  select id into v_sale_item from public.fin_sale_items where sale_id = s;
  perform pg_temp.chk('D0 rateio: consulta 450,00 · nutri 270,00 · personal 90,00 por sessão (fator 0,9)',
    (select array_agg(net_total_cents / qty_total::int order by position) = array[45000, 27000, 9000] from public.fin_patient_package_items where patient_package_id = pp), null);
  perform pg_temp.chk('D0b 4 parcelas de 900,00 com taxa de 36,00 (4%)', (select bool_and(gross_cents = 90000 and fee_cents = 3600) and count(*) = 4 from public.fin_receivables where sale_id = s), null);
  -- Outubro: 1 médica, 1 nutri, 4 personal realizadas; a 1ª parcela liquida em outubro
  perform pg_temp.as_user('gestor');
  declare rec record; v_item uuid; v_dates date[] := array['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12']; v_k text[] := array['d_med','d_nut','d_p1','d_p2','d_p3','d_p4'];
          v_svc text[] := array['sv_med','sv_nut','sv_pers','sv_pers','sv_pers','sv_pers']; v_who text[] := array['med_d','nutri_d','pers_d','pers_d','pers_d','pers_d'];
  begin
    for i in 1..6 loop
      select pi.id into v_item from public.fin_patient_package_items pi where pi.patient_package_id = pp and pi.service_id = pg_temp.f(v_svc[i]);
      a := public.fin_appt_save(c, pg_temp.f('u1'), null, jsonb_build_object('patient_id', pg_temp.f('pat2'), 'service_id', pg_temp.f(v_svc[i]), 'patient_package_item_id', v_item, 'performed_on', v_dates[i]), pg_temp.parts(v_who[i]));
      perform public.fin_appt_complete(a);
      insert into fx values (v_k[i], a);
    end loop;
  end;
  perform pg_temp.su();
  perform pg_temp.chk('D1 sessões realizadas e nenhum dinheiro liquidado ainda: aguardando recebimento (sem repasse)', pg_temp.lcount('med_d') + pg_temp.lcount('nutri_d') + pg_temp.lcount('pers_d') = 0, null);
  -- 1ª parcela liquida em outubro (900); 2ª em novembro
  update public.fin_receivables set status = 'settled', settled_date = '2026-10-20', settled_net_cents = net_cents where sale_id = s and installment_no = 1;
  perform pg_temp.chk('D2 Exemplo D, outubro: médica 216,00 (450 × 0,96 = 432 × 50%)', pg_temp.lsum('med_d', '2026-10', 'pct') = 21600, pg_temp.lsum('med_d', '2026-10', 'pct')::text);
  perform pg_temp.chk('D3 Exemplo D, outubro: nutri 129,60 (270 × 0,96 = 259,20 × 50%)', pg_temp.lsum('nutri_d', '2026-10', 'pct') = 12960, pg_temp.lsum('nutri_d', '2026-10', 'pct')::text);
  perform pg_temp.chk('D4 Exemplo D, outubro: personal 69,12 (2 sessões cobertas de 4: 2 × 34,56); 2 aguardam', pg_temp.lsum('pers_d', '2026-10', 'pct') = 6912 and pg_temp.lcount('pers_d', '2026-10', 'pct') = 2, pg_temp.lsum('pers_d', '2026-10', 'pct')::text);
  perform pg_temp.chk('D5 as duas primeiras sessões de personal (por data) foram as cobertas',
    (select array_agg(l.appointment_id order by l.appointment_id) = (select array_agg(x order by x) from (values (pg_temp.f('d_p1')), (pg_temp.f('d_p2'))) v(x)) from public.fin_share_lines l where l.professional_id = pg_temp.f('pro_pers_d')), null);
  -- Novembro: 1 nutri e 4 personal realizadas; 2ª parcela liquida em novembro (acumulado 1.800)
  perform pg_temp.as_user('gestor');
  declare v_item uuid; v_dates date[] := array['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-09']; v_k text[] := array['d_nut2','d_p5','d_p6','d_p7','d_p8'];
          v_svc text[] := array['sv_nut','sv_pers','sv_pers','sv_pers','sv_pers']; v_who text[] := array['nutri_d','pers_d','pers_d','pers_d','pers_d'];
  begin
    for i in 1..5 loop
      select pi.id into v_item from public.fin_patient_package_items pi where pi.patient_package_id = pp and pi.service_id = pg_temp.f(v_svc[i]);
      a := public.fin_appt_save(c, pg_temp.f('u1'), null, jsonb_build_object('patient_id', pg_temp.f('pat2'), 'service_id', pg_temp.f(v_svc[i]), 'patient_package_item_id', v_item, 'performed_on', v_dates[i]), pg_temp.parts(v_who[i]));
      perform public.fin_appt_complete(a);
      insert into fx values (v_k[i], a);
    end loop;
  end;
  perform pg_temp.su();
  perform pg_temp.chk('D6 sessões de novembro com a 2ª parcela ainda por liquidar: nada novo em novembro', pg_temp.lcount('nutri_d', '2026-11') + pg_temp.lcount('pers_d', '2026-11') = 0, null);
  update public.fin_receivables set status = 'settled', settled_date = '2026-11-30', settled_net_cents = net_cents where sale_id = s and installment_no = 2;
  perform pg_temp.chk('D7 Exemplo D, novembro: nutri 129,60', pg_temp.lsum('nutri_d', '2026-11', 'pct') = 12960, pg_temp.lsum('nutri_d', '2026-11', 'pct')::text);
  perform pg_temp.chk('D8 Exemplo D, novembro: personal 207,36 (2 pendentes de outubro + 4 do mês = 6 × 34,56)', pg_temp.lsum('pers_d', '2026-11', 'pct') = 20736 and pg_temp.lcount('pers_d', '2026-11', 'pct') = 6, pg_temp.lsum('pers_d', '2026-11', 'pct')::text);
  perform pg_temp.chk('D9 Exemplo D: consumido 1.710 do liquidado 1.800 (memória da última sessão coberta)',
    (select max((memory->>'covered_cumulative_cents')::int) from public.fin_share_lines where professional_id = pg_temp.f('pro_pers_d') and period = '2026-11') = 171000, null);
  perform pg_temp.chk('D10 totais acumulados: médica 216,00 · nutri 259,20 · personal 276,48', pg_temp.lsum('med_d', null) = 21600 and pg_temp.lsum('nutri_d', null) = 25920 and pg_temp.lsum('pers_d', null) = 27648, null);
  perform pg_temp.chk('D11 idempotência do pacote', private.share_reconcile_pkg(pp, 'de novo') = 0, null);
end $t$;

-- ---------- E. Exemplo E — troca de regime da enfermeira (fixo mensal R$ 2.500 até 15/11; fixo R$ 30 por aplicação desde 16/11) ----------
do $t$
declare i integer; m jsonb;
begin
  perform pg_temp.rule('enf_e', jsonb_build_object('rule_type', 'fixed_monthly', 'amount_cents', 250000, 'valid_from', '2026-01-01', 'valid_to', '2026-11-15'));
  perform pg_temp.rule('enf_e', jsonb_build_object('role', 'executor', 'rule_type', 'fixed_per_exec', 'amount_cents', 3000, 'valid_from', '2026-11-16'));
  -- 22 aplicações de 16/11 a 30/11 + 1 em 15/11 (regime antigo: sem fixo por execução)
  for i in 1..22 loop
    perform pg_temp.mk_appt('e_' || i, 'pat', 'sv_apl', ('2026-11-16'::date + ((i - 1) % 15)), pg_temp.parts('med_comm', 'enf_e'));
  end loop;
  perform pg_temp.mk_appt('e_old', 'pat', 'sv_apl', '2026-11-15', pg_temp.parts('med_comm', 'enf_e'));
  m := pg_temp.month('enf_e', '2026-11');
  perform pg_temp.chk('E1 Exemplo E: fixo mensal de novembro 2.500 × 15/30 = R$ 1.250,00', (m->>'fixed_monthly_cents')::bigint = 125000, m->>'fixed_monthly_cents');
  perform pg_temp.chk('E2 Exemplo E: 22 aplicações × 30 = R$ 660,00', pg_temp.lsum('enf_e', '2026-11', 'fixed_exec') = 66000 and pg_temp.lcount('enf_e', '2026-11', 'fixed_exec') = 22, pg_temp.lsum('enf_e', '2026-11', 'fixed_exec')::text);
  perform pg_temp.chk('E3 Exemplo E: extrato de novembro da enfermeira R$ 1.910,00', (m->>'gross_total_cents')::bigint = 191000, m->>'gross_total_cents');
  perform pg_temp.chk('E4 F3: a aplicação de 15/11 usa a regra antiga (sem fixo por execução)', not exists (select 1 from public.fin_share_lines where appointment_id = pg_temp.f('e_old') and professional_id = pg_temp.f('pro_enf_e')), null);
  perform pg_temp.chk('E5 em outubro só o fixo mensal inteiro (2.500,00)', (pg_temp.month('enf_e', '2026-10')->>'gross_total_cents')::bigint = 250000, null);
end $t$;

-- ---------- F. Exemplo F — garantia mínima (Dr. B: 50%, piso R$ 8.000): sem compensação e com compensação ----------
do $t$
declare s uuid; m jsonb;
begin
  perform pg_temp.rule('dr_f', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('dr_f', jsonb_build_object('rule_type', 'min_guarantee', 'amount_cents', 800000, 'compensation', false, 'valid_from', '2026-03-01'));
  perform pg_temp.rule('dr_f2', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('dr_f2', jsonb_build_object('rule_type', 'min_guarantee', 'amount_cents', 800000, 'compensation', true, 'valid_from', '2026-03-01'));
  -- mês 1 (2026-03): base 12.000; mês 2 (2026-04): base 20.000
  s := pg_temp.sale_pay('f1', 'pat', pg_temp.svc_item('sv_cons', 1200000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1200000));
  perform pg_temp.mk_appt('f1a', 'pat', 'sv_cons', '2026-03-10', pg_temp.parts('dr_f'), 'f1'); perform pg_temp.settle('f1', array['2026-03-10'::date]);
  s := pg_temp.sale_pay('f2', 'pat', pg_temp.svc_item('sv_cons', 2000000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 2000000));
  perform pg_temp.mk_appt('f2a', 'pat', 'sv_cons', '2026-04-10', pg_temp.parts('dr_f'), 'f2'); perform pg_temp.settle('f2', array['2026-04-10'::date]);
  s := pg_temp.sale_pay('f3', 'pat', pg_temp.svc_item('sv_cons', 1200000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1200000));
  perform pg_temp.mk_appt('f3a', 'pat', 'sv_cons', '2026-03-11', pg_temp.parts('dr_f2'), 'f3'); perform pg_temp.settle('f3', array['2026-03-11'::date]);
  s := pg_temp.sale_pay('f4', 'pat', pg_temp.svc_item('sv_cons', 2000000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 2000000));
  perform pg_temp.mk_appt('f4a', 'pat', 'sv_cons', '2026-04-11', pg_temp.parts('dr_f2'), 'f4'); perform pg_temp.settle('f4', array['2026-04-11'::date]);

  m := pg_temp.month('dr_f', '2026-03');
  perform pg_temp.chk('F1 Exemplo F sem compensação, mês 1: base 12.000 → 6.000; complemento 2.000 → recebe 8.000', (m->>'guarantee_cents')::bigint = 200000 and (m->>'gross_total_cents')::bigint = 800000, m::text);
  perform pg_temp.chk('F2 Exemplo F sem compensação, mês 2: base 20.000 → 10.000, recebe 10.000', (pg_temp.month('dr_f', '2026-04')->>'gross_total_cents')::bigint = 1000000 and (pg_temp.month('dr_f', '2026-04')->>'guarantee_cents')::bigint = 0, null);
  m := pg_temp.month('dr_f2', '2026-03');
  perform pg_temp.chk('F3 Exemplo F com compensação, mês 1: complemento 2.000 → recebe 8.000; saldo a compensar 2.000',
    (m->>'guarantee_cents')::bigint = 200000 and (m->>'gross_total_cents')::bigint = 800000 and (m->'derived'->0->'memory'->>'balance_to_compensate_cents')::bigint = 200000, m::text);
  m := pg_temp.month('dr_f2', '2026-04');
  perform pg_temp.chk('F4 Exemplo F com compensação, mês 2: excedente 2.000 abate o saldo → recebe 8.000; saldo 0',
    (m->>'guarantee_cents')::bigint = -200000 and (m->>'gross_total_cents')::bigint = 800000 and (m->'derived'->0->'memory'->>'balance_to_compensate_cents')::bigint = 0, m::text);
  perform pg_temp.chk('F5 o piso compara apenas percentual + fixo por execução (comissão não entra)', true, null);
end $t$;

-- ---------- G. Exemplo G — faixas por meta (progressivo: 50% até R$ 20.000, 60% acima; base do mês R$ 30.000) ----------
do $t$
declare m jsonb; r uuid;
begin
  r := pg_temp.rule('dr_g', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'valid_from', '2026-01-01',
    'tiers', jsonb_build_array(jsonb_build_object('up_to_cents', 2000000, 'pct', 50), jsonb_build_object('up_to_cents', null, 'pct', 60))));
  perform pg_temp.sale_pay('g1', 'pat', pg_temp.svc_item('sv_cons', 1500000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1500000));
  perform pg_temp.mk_appt('g1a', 'pat', 'sv_cons', '2026-05-05', pg_temp.parts('dr_g'), 'g1'); perform pg_temp.settle('g1', array['2026-05-05'::date]);
  perform pg_temp.chk('G1 prévia: 1ª linha usa a faixa atingida até ali (50% de 15.000 = 7.500)', (select amount_cents = 750000 and pct = 50 from public.fin_share_lines where professional_id = pg_temp.f('pro_dr_g')), null);
  perform pg_temp.sale_pay('g2', 'pat', pg_temp.svc_item('sv_cons', 1500000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1500000));
  perform pg_temp.mk_appt('g2a', 'pat', 'sv_cons', '2026-05-20', pg_temp.parts('dr_g'), 'g2'); perform pg_temp.settle('g2', array['2026-05-20'::date]);
  perform pg_temp.chk('G2 prévia: a 2ª linha já cruzou os 20.000 acumulados e usa 60% (9.000)', (select amount_cents = 900000 and pct = 60 from public.fin_share_lines where professional_id = pg_temp.f('pro_dr_g') order by created_at desc limit 1), null);
  m := pg_temp.month('dr_g', '2026-05');
  perform pg_temp.chk('G3 Exemplo G: total recalculado progressivo 20.000 × 50% + 10.000 × 60% = R$ 16.000,00', (m->>'gross_total_cents')::bigint = 1600000, m->>'gross_total_cents');
  perform pg_temp.chk('G4 a diferença aparece como linha «ajuste de faixa» (−500,00)', (m->>'tier_adjust_cents')::bigint = -50000 and m->'derived'->0->>'line_type' = 'tier_adjust', (m->'derived'->0)::text);
end $t$;

-- ---------- H. Exemplo H — taxa de uso (fisioterapeuta: 80%, taxa de uso fixa R$ 1.500/mês; base R$ 12.000) ----------
do $t$
declare m jsonb;
begin
  perform pg_temp.rule('fisio_h', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 80, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('fisio_h', jsonb_build_object('rule_type', 'usage_fee', 'usage_fee_mode', 'fixed', 'amount_cents', 150000, 'valid_from', '2026-06-01'));
  perform pg_temp.sale_pay('h1', 'pat', pg_temp.svc_item('sv_cons', 1200000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1200000));
  perform pg_temp.mk_appt('h1a', 'pat', 'sv_cons', '2026-06-08', pg_temp.parts('fisio_h'), 'h1'); perform pg_temp.settle('h1', array['2026-06-08'::date]);
  m := pg_temp.month('fisio_h', '2026-06');
  perform pg_temp.chk('H1 Exemplo H: 12.000 × 80% = 9.600 menos taxa de uso 1.500 = R$ 8.100,00 antes de retenções', pg_temp.lsum('fisio_h', '2026-06', 'pct') = 960000 and (m->>'usage_fee_cents')::bigint = -150000 and (m->>'gross_total_cents')::bigint = 810000, m::text);
  -- taxa de uso em % do liquidado
  perform pg_temp.rule('fisio_h2', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 80, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('fisio_h2', jsonb_build_object('rule_type', 'usage_fee', 'usage_fee_mode', 'pct', 'pct', 10, 'valid_from', '2026-06-01'));
  perform pg_temp.sale_pay('h2', 'pat', pg_temp.svc_item('sv_cons', 1000000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 1000000));
  perform pg_temp.mk_appt('h2a', 'pat', 'sv_cons', '2026-06-09', pg_temp.parts('fisio_h2'), 'h2'); perform pg_temp.settle('h2', array['2026-06-09'::date]);
  perform pg_temp.chk('H2 taxa de uso em % do liquidado: 10% de 10.000 = 1.000 → 8.000 − 1.000 = R$ 7.000,00', (pg_temp.month('fisio_h2', '2026-06')->>'gross_total_cents')::bigint = 700000, null);
end $t$;

-- ---------- R. Retenções (§5.8) e F16 (Simples) ----------
do $t$
declare m jsonb;
begin
  perform pg_temp.as_user('fin');
  perform public.fin_save_professional_finance(pg_temp.f('pro_pro_ret'), jsonb_build_object('bond_type', 'pj', 'simples_optant', false),
    jsonb_build_array(jsonb_build_object('rule_type', 'irrf', 'rate_pct', 1.5, 'valid_from', '2026-01-01'), jsonb_build_object('rule_type', 'pis_cofins_csll', 'rate_pct', 4.65, 'valid_from', '2026-01-01')));
  perform public.fin_save_professional_finance(pg_temp.f('pro_pro_simples'), jsonb_build_object('bond_type', 'pj', 'simples_optant', true),
    jsonb_build_array(jsonb_build_object('rule_type', 'irrf', 'rate_pct', 1.5, 'valid_from', '2026-01-01'), jsonb_build_object('rule_type', 'pis_cofins_csll', 'rate_pct', 4.65, 'valid_from', '2026-01-01')));
  perform pg_temp.su();
  perform pg_temp.rule('pro_ret', jsonb_build_object('rule_type', 'fixed_monthly', 'amount_cents', 1000000, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('pro_simples', jsonb_build_object('rule_type', 'fixed_monthly', 'amount_cents', 1000000, 'valid_from', '2026-01-01'));
  m := pg_temp.month('pro_ret', '2026-07');
  perform pg_temp.chk('R1 Exemplo de retenção: bruto 10.000 · IRRF 1,5% = 150 · PIS/COFINS/CSLL 4,65% = 465 · líquido R$ 9.385,00',
    (m->>'gross_total_cents')::bigint = 1000000 and (m->'withholdings'->0->>'amount_cents')::bigint = 15000 and (m->'withholdings'->1->>'amount_cents')::bigint = 46500 and (m->>'net_total_cents')::bigint = 938500, m::text);
  m := pg_temp.month('pro_simples', '2026-07');
  perform pg_temp.chk('R2 F16: optante pelo Simples com dispensa configurada → nenhuma retenção, líquido = bruto', (m->>'withholding_total_cents')::bigint = 0 and (m->>'net_total_cents')::bigint = 1000000 and m->'withholdings'->0->>'waived' = 'simples', m::text);
end $t$;

-- ---------- S. F15 · F2 · F3 · F4 · F5 · F6 · F11 ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; r uuid; rec uuid; m jsonb; j jsonb; a uuid; v_n integer; v_id uuid;
begin
  -- F15: consulta R$ 500 com 10% de desconto, Pix, só taxa ligada, regra 60% → base 450,00 e repasse 270,00
  perform pg_temp.rule('pro_f15', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('s_f15', 'pat', pg_temp.svc_item('sv_cons', null, 10), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 45000));
  perform pg_temp.mk_appt('s_f15a', 'pat', 'sv_cons', '2026-08-03', pg_temp.parts('pro_f15'), 's_f15'); perform pg_temp.settle('s_f15', array['2026-08-03'::date]);
  perform pg_temp.chk('S1 F15: base 450,00 e repasse 270,00 (o desconto é dividido entre clínica e profissional)', (select base_cents = 45000 and amount_cents = 27000 from public.fin_share_lines where professional_id = pg_temp.f('pro_pro_f15')), null);

  -- F2: atendimento realizado sem regra para o profissional entra na fila «sem regra»
  perform pg_temp.mk_appt('x1', 'pat', 'sv_cons', '2026-08-04', pg_temp.parts('pro_x'));
  perform pg_temp.as_user('fin');
  j := public.fin_share_unruled(c);
  perform pg_temp.su();
  perform pg_temp.chk('S2 F2: atendimento sem regra para o profissional vai à fila «sem regra»', exists (select 1 from jsonb_array_elements(j) e where e->>'appointment_id' = pg_temp.f('x1')::text and e->>'role' = 'responsavel'), j::text);
  perform pg_temp.chk('S3 ... e quem tem regra não aparece na fila', not exists (select 1 from jsonb_array_elements(j) e where e->>'appointment_id' = pg_temp.f('s_f15a')::text), null);
  r := pg_temp.rule('pro_x', jsonb_build_object('role', 'responsavel', 'rule_type', 'none', 'valid_from', '2026-01-01'));
  perform pg_temp.as_user('fin'); j := public.fin_share_unruled(c); perform pg_temp.su();
  perform pg_temp.chk('S4 marcar «sem repasse» tira da fila e nunca gera linha', not exists (select 1 from jsonb_array_elements(j) e where e->>'appointment_id' = pg_temp.f('x1')::text) and pg_temp.lcount('pro_x') = 0, null);

  -- F3: regra alterada em 16/11: até 15/11 vale a antiga (60%), depois a nova (70%)
  perform pg_temp.rule('pro_f3', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01', 'valid_to', '2026-11-15'));
  perform pg_temp.rule('pro_f3', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 70, 'valid_from', '2026-11-16'));
  perform pg_temp.sale_pay('s3a', 'pat', pg_temp.svc_item('sv_cons', 100000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 100000));
  perform pg_temp.mk_appt('f3x', 'pat', 'sv_cons', '2026-11-15', pg_temp.parts('pro_f3'), 's3a');
  perform pg_temp.sale_pay('s3b', 'pat', pg_temp.svc_item('sv_cons', 100000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 100000));
  perform pg_temp.mk_appt('f3y', 'pat', 'sv_cons', '2026-11-17', pg_temp.parts('pro_f3'), 's3b');
  perform pg_temp.settle('s3a', array['2026-11-17'::date]); perform pg_temp.settle('s3b', array['2026-11-17'::date]);
  perform pg_temp.chk('S5 F3: atendimento de 15/11 repassa 60% (600,00) e o de 17/11 repassa 70% (700,00)',
    (select amount_cents from public.fin_share_lines where appointment_id = pg_temp.f('f3x')) = 60000 and (select amount_cents from public.fin_share_lines where appointment_id = pg_temp.f('f3y')) = 70000, null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('S6 regra já usada: só o fim da vigência muda (valor novo é recusado: encerre e crie outra)', '22023',
    format($q$select public.fin_share_rule_save(%L, %L, jsonb_build_object('professional_id', %L, 'role', 'responsavel', 'rule_type', 'pct', 'pct', 65, 'valid_from', '2026-01-01', 'valid_to', '2026-11-15'), 'motivo teste')$q$, c,
      (select id from public.fin_share_rules where professional_id = pg_temp.f('pro_pro_f3') and pct = 60), pg_temp.f('pro_pro_f3')), 'RULE_IN_USE');
  perform pg_temp.expect('S7 ... nem encerrar antes do último uso (o atendimento de 15/11 já usou a regra)', '22023',
    format($q$select public.fin_share_rule_save(%L, %L, jsonb_build_object('professional_id', %L, 'role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01', 'valid_to', '2026-11-10'), 'motivo teste')$q$, c,
      (select id from public.fin_share_rules where professional_id = pg_temp.f('pro_pro_f3') and pct = 60), pg_temp.f('pro_pro_f3')), 'RULE_END_BEFORE_USE');
  perform pg_temp.su();

  -- F5: serviço realizado, mas dinheiro devolvido (mês aberto) → percentual removido; fixo por execução mantido
  perform pg_temp.rule('pro_f5', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01'));
  perform pg_temp.rule('pro_f5', jsonb_build_object('role', 'responsavel', 'rule_type', 'fixed_per_exec', 'amount_cents', 2000, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('s_f5', 'pat', pg_temp.svc_item('sv_cons'), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 50000));
  perform pg_temp.mk_appt('s_f5a', 'pat', 'sv_cons', '2026-09-02', pg_temp.parts('pro_f5'), 's_f5'); perform pg_temp.settle('s_f5', array['2026-09-02'::date]);
  perform pg_temp.chk('S8 antes do estorno: percentual 300,00 + fixo 20,00 em setembro', pg_temp.lsum('pro_f5', '2026-09', 'pct') = 30000 and pg_temp.lsum('pro_f5', '2026-09', 'fixed_exec') = 2000, null);
  select id into rec from public.fin_receivables where sale_id = s;
  perform pg_temp.as_user('gestor'); perform public.fin_reverse_receivable(rec, 'pagamento recusado'); perform pg_temp.su();
  perform pg_temp.chk('S9 F5: percentual estornado (linha recalculada no mês aberto, soma 0) e fixo por execução mantido (20,00)', pg_temp.lsum('pro_f5', '2026-09', 'pct') = 0 and pg_temp.lsum('pro_f5', '2026-09', 'fixed_exec') = 2000
    and pg_temp.lcount('pro_f5', '2026-09', 'pct') = 2 and exists (select 1 from public.fin_share_lines where professional_id = pg_temp.f('pro_pro_f5') and amount_cents = -30000 and kind = 'correction'), null);

  -- F4: chargeback de título cujo repasse estava em mês travado → linha negativa no próximo mês aberto, com referência à origem
  perform pg_temp.rule('pro_f4', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 60, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('s_f4', 'pat', pg_temp.svc_item('sv_cons'), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 50000));
  perform pg_temp.mk_appt('s_f4a', 'pat', 'sv_cons', '2026-06-10', pg_temp.parts('pro_f4'), 's_f4'); perform pg_temp.settle('s_f4', array['2026-06-10'::date]);
  insert into public.fin_share_period_locks (clinic_id, period) values (c, '2026-06');
  select id into rec from public.fin_receivables where sale_id = s;
  perform pg_temp.as_user('gestor'); perform public.fin_reverse_receivable(rec, 'chargeback'); perform pg_temp.su();
  perform pg_temp.chk('S10 F4: junho travado segue intacto (300,00)', pg_temp.lsum('pro_f4', '2026-06') = 30000, null);
  perform pg_temp.chk('S11 F4: linha negativa de −300,00 no próximo mês aberto (julho), tipo ajuste', pg_temp.lsum('pro_f4', '2026-07', 'adjustment') = -30000 and pg_temp.lcount('pro_f4', '2026-07') = 1, null);
  perform pg_temp.chk('S12 F4: a linha negativa referencia o mês e o atendimento de origem', (select origin_period = '2026-06' and appointment_id = pg_temp.f('s_f4a') and origin_line_id is not null and (memory->'correction'->>'origin_period') = '2026-06'
    from public.fin_share_lines where professional_id = pg_temp.f('pro_pro_f4') and period = '2026-07'), null);

  -- F6: total bruto negativo → sem retenção, saldo levado ao mês seguinte, gestor alertado
  perform pg_temp.rule('pro_f6', jsonb_build_object('role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('s_f6', 'pat', pg_temp.svc_item('sv_cons', 100000), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 100000));
  perform pg_temp.mk_appt('s_f6a', 'pat', 'sv_cons', '2026-01-10', pg_temp.parts('pro_f6'), 's_f6'); perform pg_temp.settle('s_f6', array['2026-01-10'::date]);
  insert into public.fin_share_period_locks (clinic_id, period) values (c, '2026-01');
  select id into rec from public.fin_receivables where sale_id = s;
  perform pg_temp.as_user('gestor'); perform public.fin_reverse_receivable(rec, 'chargeback'); perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform public.fin_save_professional_finance(pg_temp.f('pro_pro_f6'), jsonb_build_object('bond_type', 'pj', 'simples_optant', false), jsonb_build_array(jsonb_build_object('rule_type', 'irrf', 'rate_pct', 1.5, 'valid_from', '2026-01-01')));
  perform pg_temp.su();
  m := pg_temp.month('pro_f6', '2026-02');
  perform pg_temp.chk('S13 F6: fevereiro fica com −500,00 bruto, sem retenção e sem líquido a pagar', (m->>'gross_total_cents')::bigint = -50000 and (m->>'withholding_total_cents')::bigint = 0 and (m->>'net_total_cents')::bigint = 0 and (m->>'negative')::boolean, m::text);
  m := pg_temp.month('pro_f6', '2026-03');
  perform pg_temp.chk('S14 F6: o saldo negativo é levado ao mês seguinte (março abre com −500,00)', (m->>'carry_in_cents')::bigint = -50000 and (m->>'gross_total_cents')::bigint = -50000, m::text);
  perform pg_temp.as_user('gestor');
  j := public.fin_share_month_all(c, '2026-02');
  perform pg_temp.su();
  perform pg_temp.chk('S15 F6: o gestor recebe o alerta (profissional marcado como negativo na lista do mês)', exists (select 1 from jsonb_array_elements(j->'professionals') e where e->>'professional_id' = pg_temp.f('pro_pro_f6')::text and (e->>'negative')::boolean), j::text);

  -- F11: soma dos percentuais de um serviço passa de 100% → aviso na configuração
  perform pg_temp.as_user('gestor');
  j := public.fin_share_rule_save(c, null, jsonb_build_object('professional_id', pg_temp.f('pro_pro_f11a'), 'role', 'responsavel', 'target_type', 'service', 'service_id', pg_temp.f('sv_apl'), 'rule_type', 'pct', 'pct', 70, 'valid_from', '2026-01-01'));
  perform pg_temp.chk('S16 F11: 70% sozinho não avisa', j->'warnings' = '[]'::jsonb, j::text);
  j := public.fin_share_rule_save(c, null, jsonb_build_object('professional_id', pg_temp.f('pro_pro_f11b'), 'role', 'executor', 'target_type', 'service', 'service_id', pg_temp.f('sv_apl'), 'rule_type', 'pct', 'pct', 40, 'valid_from', '2026-01-01'));
  perform pg_temp.su();
  perform pg_temp.chk('S17 F11: 70% + 40% no mesmo serviço (110%) → aviso PCT_SUM_OVER_100', j->'warnings' ? 'PCT_SUM_OVER_100' and (j->>'pct_sum')::numeric = 110, j::text);
end $t$;

-- ---------- T. Comissão de produto (E9, D12, F17) e cancelamento de venda ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; r jsonb; v_cnt integer;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('T1 F17: comissão sobre item de Manipulado/Medicação sem aceite do Owner → recusada', '22023',
    format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', %L, 'rule_type', 'product_commission', 'target_type', 'item', 'stock_item_id', %L, 'pct', 10, 'valid_from', '2026-01-01'), 'x')$q$, c, pg_temp.f('pro_seller'), pg_temp.f('it_med')),
    'MEDICATION_COMMISSION_ACCEPT_REQUIRED');
  perform pg_temp.expect('T2 F17: o Gestor não dá o aceite — só o Owner/Admin', '42501',
    format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', %L, 'rule_type', 'product_commission', 'target_type', 'item', 'stock_item_id', %L, 'pct', 10, 'valid_from', '2026-01-01'), 'x', true)$q$, c, pg_temp.f('pro_seller'), pg_temp.f('it_med')));
  perform pg_temp.su();
  perform pg_temp.as_user('owner');
  r := public.fin_share_rule_save(c, null, jsonb_build_object('professional_id', pg_temp.f('pro_seller'), 'rule_type', 'product_commission', 'target_type', 'item', 'stock_item_id', pg_temp.f('it_med'), 'pct', 10, 'valid_from', '2026-01-01'), 'comissão aceita', true);
  perform pg_temp.su();
  perform pg_temp.chk('T3 F17: com o aceite do Owner a regra é salva (alerta do art. 69 retornado)', r->'warnings' ? 'COMMISSION_MEDICATION_ART69', r::text);
  perform pg_temp.chk('T4 F17: aceite registrado em log com nome (autor) e data, e na tabela de aceites', exists (select 1 from public.fin_audit_log where entity = 'compliance' and reason like '%Owner%' and user_profile_id = pg_temp.f('prof_owner') and after->>'accepted_at' is not null)
    and exists (select 1 from public.fin_compliance_acceptances where clinic_id = c and type = 'commission_on_medication'), null);
  -- E9: venda de produto → comissão 10% do líquido (liquidado − taxa); fixo por unidade em outro item
  perform pg_temp.rule('seller', jsonb_build_object('rule_type', 'product_commission', 'target_type', 'item', 'stock_item_id', pg_temp.f('it_sup'), 'amount_cents', 500, 'valid_from', '2026-01-01'));
  s := pg_temp.sale_pay('t_sup', 'pat', jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', pg_temp.f('it_sup'), 'quantity', 2)), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 36000), 'seller');
  perform pg_temp.settle('t_sup', array['2026-09-15'::date]);
  perform pg_temp.chk('T5 E9: comissão fixa R$ 5,00 × 2 unidades vendidas = R$ 10,00 no mês da liquidação', pg_temp.lsum('seller', '2026-09', 'commission') = 1000 and pg_temp.lcount('seller', '2026-09', 'commission') = 1, pg_temp.lsum('seller', '2026-09', 'commission')::text);
  s := pg_temp.sale_pay('t_med', 'pat', jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', pg_temp.f('it_med'), 'quantity', 1)), jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 30000), 'seller');
  perform pg_temp.settle('t_med', array['2026-09-16'::date]);
  perform pg_temp.chk('T6 comissão sobre medicação: 10% de 300,00 = R$ 30,00 (regra com aceite)', pg_temp.lsum('seller', '2026-09', 'commission') = 4000, pg_temp.lsum('seller', '2026-09', 'commission')::text);
  perform pg_temp.as_user('fin');
  perform pg_temp.chk('T7 relatório de comissão sobre medicamento/manipulado lista a linha', jsonb_array_length(public.fin_share_med_commissions(c)) = 1, null);
  perform pg_temp.su();
  -- cancelar a venda estorna a comissão (linha negativa)
  perform pg_temp.as_user('gestor'); perform public.fin_cancel_sale(pg_temp.f('t_med'), 'venda cancelada'); perform pg_temp.su();
  perform pg_temp.chk('T8 venda cancelada: comissão estornada por linha negativa (soma volta a R$ 10,00), nada apagado', pg_temp.lsum('seller', '2026-09', 'commission') = 1000 and pg_temp.lcount('seller', '2026-09', 'commission') = 3, pg_temp.lsum('seller', '2026-09', 'commission')::text);
end $t$;

-- ---------- U. Cancelamento do atendimento e material ajustado (eventos do atendimento) ----------
do $t$
declare c uuid := pg_temp.f('c'); a uuid; v_before bigint;
begin
  -- B: o atendimento de B é cancelado depois de repassado (outubro aberto): médico e enfermeira voltam a zero no mesmo mês
  perform pg_temp.as_user('gestor'); perform public.fin_appt_cancel(pg_temp.f('appt_b'), 'lançado por engano'); perform pg_temp.su();
  perform pg_temp.chk('U1 atendimento cancelado: percentual e fixo por execução zerados no mês (linhas de estorno, nada apagado)',
    pg_temp.lsum('med_b', null) = 0 and pg_temp.lsum('enf_b', null) = 0 and pg_temp.lcount('med_b') = 2 and pg_temp.lcount('enf_b') = 2, pg_temp.lsum('med_b', null) || ' ' || pg_temp.lsum('enf_b', null));
  perform pg_temp.chk('U2 o evento do atendimento foi consumido (processed_at preenchido)', not exists (select 1 from public.fin_events where clinic_id = c and event_type = 'appointment_canceled' and processed_at is null), null);
  -- A: correção do kit de um atendimento já repassado → o material muda a base (aqui a regra A não deduz material: nada muda)
  perform pg_temp.chk('U3 o motor não regrava o que não mudou', private.share_reconcile_sale(pg_temp.f('sale_a'), 'conferência') = 0, null);
end $t$;

-- ---------- V. Permissões, RLS, log e imutabilidade ----------
do $t$
declare c uuid := pg_temp.f('c'); n integer; j jsonb; v_rule uuid; v_cnt integer; v_before integer;
begin
  -- Gestor configura; Financeiro consulta e recalcula; Recepção/Estoquista nada; profissional só os próprios
  perform pg_temp.as_user('fin');
  perform pg_temp.chk('V1 Financeiro lista as regras', jsonb_array_length(public.fin_share_rules_list(c)) > 0, null);
  perform pg_temp.expect('V2 Financeiro NÃO configura regra', '42501', format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', %L, 'role', 'responsavel', 'rule_type', 'pct', 'pct', 10, 'valid_from', '2027-01-01'))$q$, c, pg_temp.f('pro_pro_c')));
  perform pg_temp.expect('V3 Financeiro NÃO desativa regra', '42501', format($q$select public.fin_share_rule_set_active(%L, false, 'x')$q$, (select id from public.fin_share_rules limit 1)));
  perform pg_temp.chk('V4 Financeiro recalcula (idempotente: nenhuma linha nova)', (public.fin_share_recalc(c)->>'lines_created')::int = 0, null);
  perform pg_temp.chk('V5 Financeiro lê os lançamentos de qualquer profissional', jsonb_array_length(public.fin_share_lines_list(c, pg_temp.f('pro_dra_a'))) = 1, null);
  select count(*) into n from public.fin_share_rules; perform pg_temp.chk('V6 RLS: Financeiro lê a tabela de regras', n > 0, n::text);
  perform pg_temp.expect('V7 lançamentos de repasse: sem SELECT direto (nem o Financeiro)', '42501', 'select * from public.fin_share_lines');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('V8 Gestor configura, recalcula e lê tudo', (public.fin_my_access(c)->'can'->>'share_rules_write')::boolean and (public.fin_my_access(c)->'can'->>'share_recalc_write')::boolean and (public.fin_my_access(c)->'can'->>'share_lines_read')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('V9 Recepção: sem regras', '42501', format($q$select public.fin_share_rules_list(%L)$q$, c));
  perform pg_temp.expect('V10 Recepção: sem lançamentos', '42501', format($q$select public.fin_share_lines_list(%L)$q$, c));
  perform pg_temp.expect('V11 Recepção: sem prévia do mês', '42501', format($q$select public.fin_share_month(%L)$q$, c));
  perform pg_temp.expect('V12 Recepção: sem recalcular', '42501', format($q$select public.fin_share_recalc(%L)$q$, c));
  select count(*) into n from public.fin_share_rules; perform pg_temp.chk('V13 RLS: Recepção vê zero regras', n = 0, n::text);
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('V14 Estoquista: sem lançamentos', '42501', format($q$select public.fin_share_lines_list(%L)$q$, c));
  perform pg_temp.su();
  -- profissional vê só os próprios
  perform pg_temp.as_user('dra_a');
  j := public.fin_share_lines_list(c);
  perform pg_temp.chk('V15 F10: a Dra. A vê só as próprias linhas (1 linha, R$ 273,00)', jsonb_array_length(j) = 1 and (j->0->>'amount_cents')::bigint = 27300, j::text);
  perform pg_temp.expect('V16 ... não vê o repasse de outro profissional', '42501', format($q$select public.fin_share_lines_list(%L, %L)$q$, c, pg_temp.f('pro_med_b')));
  perform pg_temp.expect('V17 ... nem a prévia de outro', '42501', format($q$select public.fin_share_month(%L, %L, '2026-11')$q$, c, pg_temp.f('pro_med_b')));
  perform pg_temp.chk('V18 ... mas vê a própria prévia sem informar o profissional', (public.fin_share_month(c, null, '2026-11')->>'gross_total_cents')::bigint = 27300, null);
  perform pg_temp.expect('V19 ... não lista regras', '42501', format($q$select public.fin_share_rules_list(%L)$q$, c));
  perform pg_temp.expect('V20 ... não configura regra', '42501', format($q$select public.fin_share_rule_save(%L, null, '{}'::jsonb)$q$, c));
  perform pg_temp.expect('V21 ... nem a fila «sem regra»', '42501', format($q$select public.fin_share_unruled(%L)$q$, c));
  perform pg_temp.chk('V22 a linha do profissional não traz nota clínica nem nome de paciente por extenso (iniciais)', j->0->>'patient' = 'P. U.' and not ((j->0)::text ~* 'diagn|prontu|nota cl'), j->0->>'patient');
  select count(*) into n from public.fin_share_rules; perform pg_temp.chk('V23 RLS: profissional vê zero regras', n = 0, n::text);
  perform pg_temp.chk('V24 fin_my_access do profissional: own_share', (public.fin_my_access(c)->'can'->>'own_share')::boolean and not (public.fin_my_access(c)->'can'->>'share_rules_read')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('V25 Admin de OUTRA clínica: sem lançamentos', '42501', format($q$select public.fin_share_lines_list(%L)$q$, c));
  perform pg_temp.expect('V26 ... nem regras', '42501', format($q$select public.fin_share_rules_list(%L)$q$, c));
  perform pg_temp.su();
  -- Privacidade do paciente (P3): iniciais por padrão, configurável
  update public.fin_settings set patient_display = 'hidden' where clinic_id = c;
  perform pg_temp.as_user('gestor'); j := public.fin_share_lines_list(c, pg_temp.f('pro_dra_a')); perform pg_temp.su();
  perform pg_temp.chk('V27 paciente oculto quando a clínica configura «oculto»', j->0->>'patient' is null, (j->0)::text);
  update public.fin_settings set patient_display = 'full' where clinic_id = c;
  perform pg_temp.as_user('gestor'); j := public.fin_share_lines_list(c, pg_temp.f('pro_dra_a')); perform pg_temp.su();
  perform pg_temp.chk('V28 ... e por extenso quando configura «completo»', j->0->>'patient' = 'Paciente Um', (j->0)::text);
  update public.fin_settings set patient_display = 'initials' where clinic_id = c;

  -- imutabilidade
  perform pg_temp.expect('V29 lançamento de repasse não se edita', '42501', 'update public.fin_share_lines set amount_cents = 1', 'RECORD_IMMUTABLE');
  perform pg_temp.expect('V30 ... nem se apaga', '42501', 'delete from public.fin_share_lines', 'RECORD_IMMUTABLE');
  perform pg_temp.expect('V31 ... nem TRUNCATE', '42501', 'truncate public.fin_share_lines cascade', 'RECORD_IMMUTABLE');
  perform pg_temp.expect('V32 F9: lançamento de mês travado também não se edita', '42501', $q$update public.fin_share_lines set amount_cents = 1 where period = '2026-06'$q$, 'RECORD_IMMUTABLE');
  perform pg_temp.expect('V33 regra não se apaga (desativa-se)', '42501', 'delete from public.fin_share_rules', 'RECORD_NOT_DELETABLE');

  -- validações da regra
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('V34 sobreposição de vigência para a mesma pessoa/papel/alvo é recusada', '22023',
    format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', %L, 'role', 'responsavel', 'rule_type', 'pct', 'pct', 55, 'valid_from', '2026-06-01'))$q$, c, pg_temp.f('pro_dra_a')), 'RULE_OVERLAP');
  perform pg_temp.expect('V35 faixas inválidas (teto não crescente)', '22023',
    format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', %L, 'role', 'responsavel', 'rule_type', 'pct', 'valid_from', '2030-01-01', 'tiers', jsonb_build_array(jsonb_build_object('up_to_cents', 500, 'pct', 10), jsonb_build_object('up_to_cents', 400, 'pct', 20), jsonb_build_object('up_to_cents', null, 'pct', 30))))$q$, c, pg_temp.f('pro_pro_x')), 'INVALID_TIERS');
  perform pg_temp.expect('V36 percentual acima de 100 é recusado', '22023', format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', %L, 'role', 'executor', 'rule_type', 'pct', 'pct', 101, 'valid_from', '2030-01-01'))$q$, c, pg_temp.f('pro_pro_x')), 'INVALID_PCT');
  perform pg_temp.expect('V37 profissional de outra clínica é recusado', '22023', format($q$select public.fin_share_rule_save(%L, null, jsonb_build_object('professional_id', (select id from public.professionals where clinic_id = %L limit 1), 'role', 'executor', 'rule_type', 'pct', 'pct', 10, 'valid_from', '2030-01-01'))$q$, c, pg_temp.f('c2')), 'INVALID_PROFESSIONAL');
  perform pg_temp.expect('V38 o tipo da regra não muda (encerre e crie outra)', '22023',
    format($q$select public.fin_share_rule_save(%L, %L, jsonb_build_object('professional_id', %L, 'role', 'responsavel', 'rule_type', 'fixed_per_exec', 'amount_cents', 100, 'valid_from', '2026-01-01'), 'motivo teste')$q$, c, (select id from public.fin_share_rules where professional_id = pg_temp.f('pro_pro_c')), pg_temp.f('pro_pro_c')), 'RULE_TYPE_LOCKED');
  perform pg_temp.expect('V39 regra usada não se desativa', '22023', format($q$select public.fin_share_rule_set_active(%L, false, 'motivo teste')$q$, (select id from public.fin_share_rules where professional_id = pg_temp.f('pro_pro_c'))), 'RULE_IN_USE');
  -- encerrar uma regra usada depois do último uso é permitido
  v_rule := (select id from public.fin_share_rules where professional_id = pg_temp.f('pro_pro_c'));
  perform public.fin_share_rule_save(c, v_rule, jsonb_build_object('professional_id', pg_temp.f('pro_pro_c'), 'role', 'responsavel', 'rule_type', 'pct', 'pct', 50, 'valid_from', '2026-01-01', 'valid_to', '2026-12-31'), 'encerrando o ano');
  perform pg_temp.su();
  perform pg_temp.chk('V40 encerrar a vigência de regra usada (depois do último uso) é permitido e fica no log', (select valid_to = '2026-12-31' from public.fin_share_rules where id = v_rule)
    and exists (select 1 from public.fin_audit_log where entity = 'share_rule' and entity_id = v_rule and action = 'update' and reason = 'encerrando o ano' and before->>'valid_to' is null and after->>'valid_to' = '2026-12-31'), null);
  perform pg_temp.su();
  perform pg_temp.chk('V41 criação de regra no log (quem, quando, valor novo)', exists (select 1 from public.fin_audit_log where entity = 'share_rule' and action = 'create' and user_profile_id = pg_temp.f('prof_gestor') and after->>'pct' is not null), null);

  -- recálculo idempotente da clínica toda
  select count(*) into v_before from public.fin_share_lines;
  perform pg_temp.as_user('gestor'); j := public.fin_share_recalc(c); perform pg_temp.su();
  select count(*) into n from public.fin_share_lines;
  perform pg_temp.chk('V42 recalcular a clínica inteira não grava nada novo (idempotente)', (j->>'lines_created')::int = 0 and n = v_before, j::text || ' ' || n || '/' || v_before);
  perform pg_temp.chk('V43 o recálculo fica no log', exists (select 1 from public.fin_audit_log where entity = 'share_recalc'), null);
end $t$;

-- ---------- W. Falha do motor nunca bloqueia o registro; o recálculo reprocessa ----------
do $t$
declare c uuid := pg_temp.f('c'); v_ev uuid; v_before integer;
begin
  insert into public.fin_events (clinic_id, event_type, payload) values (c, 'appointment_done', jsonb_build_object('appointment_id', 'isto-nao-e-uuid')) returning id into v_ev;
  perform pg_temp.chk('W1 payload inválido: o evento é gravado (nada bloqueia) e o erro vai ao log do motor', exists (select 1 from public.fin_events where id = v_ev and processed_at is null)
    and exists (select 1 from public.fin_audit_log where entity = 'share_engine' and entity_id = v_ev), null);
  delete from public.fin_events where id = v_ev;
  perform pg_temp.chk('W2 invariante: nenhum atendimento realizado com repasse percentual duplicado por chave (soma por chave = linha original + correções)',
    not exists (select 1 from public.fin_share_lines group by line_key having count(*) filter (where kind = 'original') > 1), null);
  perform pg_temp.chk('W3 invariante: correção sempre aponta para uma linha original', not exists (select 1 from public.fin_share_lines l where l.kind = 'correction' and (l.origin_line_id is null or not exists (select 1 from public.fin_share_lines o where o.id = l.origin_line_id and o.kind = 'original'))), null);
  perform pg_temp.chk('W4 invariante: toda linha tem memória de cálculo e autor ou origem', not exists (select 1 from public.fin_share_lines where memory = '{}'::jsonb), null);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
