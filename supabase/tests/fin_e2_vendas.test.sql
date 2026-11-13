-- Prova SQL da FIN-E2 num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e2-sql-proof.sh  (cria o cluster/banco, aplica stub + E1 + E2, roda este arquivo e apaga tudo).
-- Roda dentro de begin ... rollback; a última consulta lista as asserções (ok=false = falha).
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
-- Executa um comando e confere o SQLSTATE e (opcional) um trecho da mensagem.
create function pg_temp.expect(p_name text, p_state text, p_sql text, p_msg text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  insert into tr(name, ok, detail) values (p_name, p_state is null, case when p_state is null then 'ok' else 'passou sem erro' end);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  insert into tr(name, ok, detail) values (p_name, v_state = p_state and (p_msg is null or v_msg like '%' || p_msg || '%'), v_state || ' ' || v_msg);
end $$;
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text) to public;

-- ---------- Fixture ----------
do $t$
declare
  c uuid; c2 uuid; u1 uuid; u2 uuid; k text; pid uuid; pro uuid; v_acq uuid; v_pat uuid; v_svc uuid;
begin
  foreach k in array array['owner','gestor','fin','recep','recep2','pro','other'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','gestor','fin','recep','recep2','pro'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end) returning id into pro;
    insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_other'), c2, 'admin');
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values
    (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_fin'), 'financeiro'), (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_recep2'), 'recepcao');
  select id into u1 from public.clinic_units where clinic_id = c and is_primary;
  insert into public.clinic_units (clinic_id, name) values (c, 'Unidade 2') returning id into u2;
  insert into fx values ('u1', u1), ('u2', u2);

  insert into public.profiles (full_name) values ('Paciente Teste') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat;
  insert into fx values ('pat', v_pat);

  -- Maquininha com taxas (D: 1,5% 1d; crédito 1x 3% 30d; 2–6x 5% 30d/parcela; Master 2–6x antecipada 3%+2% em 2 dias)
  insert into public.fin_acquirers (clinic_id, name, kind) values (c, 'Maq1', 'machine') returning id into v_acq;
  insert into fx values ('maq', v_acq);
  insert into public.fin_fee_rows (acquirer_id, brand, modality, fee_pct, settle_days, anticipation, anticipation_fee_pct, anticipation_days) values
    (v_acq, 'Visa', 'debit', 1.5, 1, false, 0, 1), (v_acq, 'Visa', 'credit_1', 3, 30, false, 0, 1), (v_acq, 'Visa', 'credit_2_6', 5, 30, false, 0, 1),
    (v_acq, 'Master', 'credit_2_6', 3, 30, true, 2, 2);
  insert into fx select 'pix', id from public.fin_acquirers where clinic_id = c and kind = 'pix';
  insert into fx select 'cashq', id from public.fin_acquirers where clinic_id = c and kind = 'cash';

  -- Catálogo
  insert into public.fin_services (clinic_id, name, category, default_price_cents) values (c, 'Procedimento X', 'procedimento', 200000) returning id into v_svc;
  insert into fx values ('svc_proc', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents) values (c, 'Consulta médica', 'consulta', 50000) returning id into v_svc;
  insert into fx values ('svc_cons', v_svc);
  insert into public.fin_services (clinic_id, name, category, default_price_cents) values (c, 'Sessão 1', 'sessao', 30000) returning id into v_svc;
  insert into fx values ('svc_ses', v_svc);
  insert into public.fin_packages (clinic_id, name, price_cents, validity_days) values (c, 'Programa', 360000, 90) returning id into v_svc;
  insert into fx values ('pkg', v_svc);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents)
    values (c, 'Suplemento', 'sup', 'resale', 'un', 'un', 'un', true, 18000) returning id into v_svc;
  insert into fx values ('it_resale', v_svc);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control, sellable, sale_price_cents)
    values (c, 'Manipulado Y', 'man', 'compounded', 'un', 'un', 'un', true, true, 25000) returning id into v_svc;
  insert into fx values ('it_comp', v_svc);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control)
    values (c, 'Semaglutida', 'med', 'medication', 'un', 'un', 'un', true) returning id into v_svc;
  insert into fx values ('it_med', v_svc);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit)
    values (c, 'Luva', 'mat', 'consumable', 'un', 'un', 'un') returning id into v_svc;
  insert into fx values ('it_cons', v_svc);
end $t$;

-- ---------- A. Títulos (exemplo C), antecipação, Pix D+0, desconto distribuído (F15) ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid; p uuid; n int; r record; v_dates date[]; v_today date := private.fin_today(); v_net int; v_disc int; v_items jsonb;
begin
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_proc'),'quantity',1)));
  insert into fx values ('sale_c', s);
  p := public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Visa', 'modality', 'credit_2_6', 'installments', 4, 'amount_cents', 200000, 'nsu', '123'));
  perform pg_temp.su();
  select count(*) into n from public.fin_receivables where payment_id = p;
  perform pg_temp.chk('A1 exemplo C: 4 títulos', n = 4, n::text);
  perform pg_temp.chk('A2 exemplo C: bruto 500,00 / taxa 25,00 / líquido 475,00 em todas',
    (select bool_and(gross_cents = 50000 and fee_cents = 2500 and net_cents = 47500) from public.fin_receivables where payment_id = p), null);
  perform pg_temp.chk('A3 exemplo C: datas +30/+60/+90/+120 dias',
    (select array_agg(expected_date - v_today order by installment_no) = array[30,60,90,120] from public.fin_receivables where payment_id = p), null);
  perform pg_temp.chk('A4 exemplo C: venda quitada, todos os títulos previstos',
    (select status = 'paid' and paid_cents = 200000 from public.fin_sales where id = s) and (select bool_and(status = 'expected') from public.fin_receivables where payment_id = p), null);
  perform pg_temp.chk('A5 distribuição por item: 1 item recebe 100% do recebimento', (select amount_cents from public.fin_payment_allocations where payment_id = p) = 200000, null);

  -- parcelamento com resto: 1000,00 em 3x → 333,33 + 333,33 + 333,34
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_proc'),'quantity',1,'unit_price_cents',100000)));
  p := public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Visa', 'modality', 'credit_2_6', 'installments', 3, 'amount_cents', 100000));
  perform pg_temp.su();
  perform pg_temp.chk('A6 resto na última parcela (33333/33333/33334), taxa meio-para-cima por linha',
    (select array_agg(gross_cents order by installment_no) = array[33333,33333,33334] and array_agg(fee_cents order by installment_no) = array[1667,1667,1667] from public.fin_receivables where payment_id = p), null);

  -- antecipação: todas no prazo de antecipação (+2) e taxa somada (3% + 2% = 5%)
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_proc'),'quantity',1,'unit_price_cents',90000)));
  p := public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Master', 'modality', 'credit_2_6', 'installments', 3, 'amount_cents', 90000));
  perform pg_temp.su();
  perform pg_temp.chk('A7 antecipação: 3 × 300,00, taxa 5% = 15,00, todas em +2 dias',
    (select bool_and(gross_cents = 30000 and fee_cents = 1500 and net_cents = 28500 and expected_date = v_today + 2) from public.fin_receivables where payment_id = p), null);

  -- Pix D+0, taxa 0, liquidado na hora (auto_settle padrão)
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_cons'),'quantity',1)));
  insert into fx values ('sale_pix', s);
  p := public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 50000));
  perform pg_temp.su();
  select * into r from public.fin_receivables where payment_id = p;
  perform pg_temp.chk('A8 Pix: 1 título, taxa 0, D+0, liquidado automaticamente', r.fee_cents = 0 and r.net_cents = 50000 and r.expected_date = v_today and r.status = 'settled' and r.settled_net_cents = 50000, r.status);

  -- F15: consulta R$ 500 com 10% de desconto → líquido do item 450,00
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_cons'),'quantity',1,'discount_pct',10)));
  perform pg_temp.su();
  select net_cents, discount_item_cents into v_net, v_disc from public.fin_sale_items where sale_id = s;
  perform pg_temp.chk('A9 F15: consulta 500 com 10% → líquido do item 450,00 (desconto 50,00)', v_net = 45000 and v_disc = 5000, v_net::text);
  perform pg_temp.chk('A10 F15: total da venda 450,00', (select total_net_cents = 45000 and discount_cents = 5000 from public.fin_sales where id = s), null);

  -- desconto TOTAL rateado proporcionalmente: 300,00 + 100,00 (sessão ×1 e... ) com desconto 40,00 → 30,00 / 10,00
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(
        jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_ses'),'quantity',1),
        jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_ses'),'quantity',1,'unit_price_cents',10000)), 4000);
  perform pg_temp.su();
  perform pg_temp.chk('A11 desconto total 40,00 rateado 30,00/10,00 pelo líquido de cada item',
    (select array_agg(discount_share_cents order by position) = array[3000,1000] and array_agg(net_cents order by position) = array[27000,9000] from public.fin_sale_items where sale_id = s), null);
  perform pg_temp.chk('A12 soma dos itens = total da venda (36000)', (select total_net_cents = 36000 and discount_cents = 4000 from public.fin_sales where id = s) and (select sum(net_cents) = 36000 from public.fin_sale_items where sale_id = s), null);
  -- recebimento distribuído proporcional ao líquido: 18000 → 13500 / 4500
  perform pg_temp.as_user('gestor');
  p := public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 18000));
  perform pg_temp.su();
  perform pg_temp.chk('A13 recebimento 180,00 distribuído 135,00/45,00 entre os itens', (select array_agg(a.amount_cents order by i.position) = array[13500,4500] from public.fin_payment_allocations a join public.fin_sale_items i on i.id = a.sale_item_id where a.payment_id = p), null);
  perform pg_temp.chk('A14 venda paga parcialmente', (select status = 'partial' and paid_cents = 18000 from public.fin_sales where id = s), null);
  insert into fx values ('sale_part', s);
end $t$;

-- ---------- B. Permissões: Recepção, preço, taxa, cancelamento, RLS por clínica ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid; n int; v_reg uuid; v_cnt int;
begin
  -- Recepção sem caixa aberto não lança recebimento
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_cons'),'quantity',1)));
  insert into fx values ('sale_recep', s);
  perform pg_temp.chk('B1 Recepção registra venda', s is not null, null);
  perform pg_temp.expect('B2 Recepção sem caixa aberto: recebimento recusado', '22023', format($q$select public.fin_add_payment(%L, jsonb_build_object('acquirer_id', %L, 'amount_cents', 1000))$q$, s, pg_temp.f('pix')), 'CASH_REGISTER_REQUIRED');
  v_reg := public.fin_open_cash(c, u1, 5000);
  insert into fx values ('reg_recep', v_reg);
  perform public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 20000));
  perform pg_temp.chk('B3 Recepção registra recebimento Pix com caixa aberto (vinculado ao caixa)', (select cash_register_id = v_reg from public.fin_payments where sale_id = s), null);
  -- não edita taxa nem cadastros
  perform pg_temp.expect('B4 Recepção não edita meio de pagamento/taxa', '42501', format($q$select public.fin_save_acquirer(%L, %L, '{"name":"Maq1"}'::jsonb, '[]'::jsonb)$q$, c, pg_temp.f('maq')));
  perform pg_temp.expect('B5 Recepção não grava alíquota', '42501', format($q$select public.fin_set_tax_rate(%L, '2026-11', 5)$q$, c));
  perform pg_temp.expect('B6 Recepção não altera configurações', '42501', format($q$select public.fin_save_settings(%L, '{"cash_diff_limit_cents":99999}'::jsonb)$q$, c));
  perform pg_temp.expect('B7 Recepção não muda preço de tabela', '42501', format($q$select public.fin_save_sale(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_type','service','ref_id',%L,'quantity',1,'unit_price_cents',100)))$q$, c, u1, pg_temp.f('pat'), pg_temp.f('svc_cons')), 'PRICE_NOT_ALLOWED');
  perform pg_temp.expect('B8 Recepção não cancela venda', '42501', format($q$select public.fin_cancel_sale(%L, 'teste')$q$, s));
  perform pg_temp.expect('B9 Recepção não lê a lista de títulos (taxas)', '42501', format($q$select * from public.fin_receivables_list(%L)$q$, c));
  select count(*) into v_cnt from public.fin_receivables; perform pg_temp.chk('B10 Recepção: tabela de títulos vazia por RLS', v_cnt = 0, v_cnt::text);
  select count(*) into v_cnt from public.fin_sales; perform pg_temp.chk('B11 Recepção vê as vendas da clínica', v_cnt >= 5, v_cnt::text);
  perform pg_temp.su();

  -- Financeiro muda preço; Profissional só a produção própria
  perform pg_temp.as_user('fin');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_cons'),'quantity',1,'unit_price_cents',42000)));
  perform pg_temp.chk('B12 Financeiro pode alterar o preço na venda', (select total_net_cents = 42000 from public.fin_sales where id = s), null);
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('B13 Profissional sem papel financeiro não registra venda', '42501', format($q$select public.fin_save_sale(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_type','service','ref_id',%L,'quantity',1)))$q$, c, u1, pg_temp.f('pat'), pg_temp.f('svc_cons')));
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid; v_cnt int;
begin
  -- Profissional como VENDEDOR (venda lançada pelo financeiro em nome dele): vê só a própria venda
  perform pg_temp.as_user('fin');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_cons'),'quantity',1)), 0, null, pg_temp.f('pro_pro'));
  insert into fx values ('sale_pro', s);
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  select count(*) into v_cnt from public.fin_sales; perform pg_temp.chk('B14 Profissional vê só a venda em que é vendedor', v_cnt = 1, v_cnt::text);
  select count(*) into v_cnt from public.fin_sale_items; perform pg_temp.chk('B15 Profissional vê só os itens da própria venda', v_cnt = 1, v_cnt::text);
  select count(*) into v_cnt from public.fin_payments; perform pg_temp.chk('B16 Profissional não vê recebimentos', v_cnt = 0, v_cnt::text);
  select count(*) into v_cnt from public.fin_receivables; perform pg_temp.chk('B17 Profissional não vê títulos', v_cnt = 0, v_cnt::text);
  select count(*) into v_cnt from public.fin_sales_list(c); perform pg_temp.chk('B18 fin_sales_list do Profissional = só as próprias', v_cnt = 1, v_cnt::text);
  perform pg_temp.expect('B19 Profissional não abre venda de outro vendedor (fin_sale_get)', '42501', format($q$select public.fin_sale_get(%L)$q$, pg_temp.f('sale_c')));
  perform pg_temp.expect('B20 Profissional não registra recebimento', '42501', format($q$select public.fin_add_payment(%L, '{}'::jsonb)$q$, s));
  perform pg_temp.su();

  -- Outra clínica: zero linhas e escrita recusada
  perform pg_temp.as_user('other');
  select count(*) into v_cnt from public.fin_sales; perform pg_temp.chk('B21 outra clínica: fin_sales = 0', v_cnt = 0, v_cnt::text);
  select count(*) into v_cnt from public.fin_payments; perform pg_temp.chk('B22 outra clínica: fin_payments = 0', v_cnt = 0, v_cnt::text);
  select count(*) into v_cnt from public.fin_receivables; perform pg_temp.chk('B23 outra clínica: fin_receivables = 0', v_cnt = 0, v_cnt::text);
  select count(*) into v_cnt from public.fin_cash_registers; perform pg_temp.chk('B24 outra clínica: fin_cash_registers = 0', v_cnt = 0, v_cnt::text);
  perform pg_temp.expect('B25 outra clínica: fin_sale_get recusado', '42501', format($q$select public.fin_sale_get(%L)$q$, pg_temp.f('sale_c')));
  perform pg_temp.expect('B26 outra clínica: fin_save_sale recusado', '42501', format($q$select public.fin_save_sale(%L, %L, %L, '[]'::jsonb)$q$, c, u1, pg_temp.f('pat')));
  perform pg_temp.expect('B27 outra clínica: fin_cancel_sale recusado', '42501', format($q$select public.fin_cancel_sale(%L, 'abc')$q$, pg_temp.f('sale_c')));
  perform pg_temp.expect('B28 outra clínica: fin_receivables_list recusado', '42501', format($q$select * from public.fin_receivables_list(%L)$q$, c));
  perform pg_temp.su();

  -- Sem exclusão/alteração física direta pelo cliente
  perform pg_temp.as_user('owner');
  perform pg_temp.expect('B29 admin não apaga venda direto (sem DELETE)', '42501', 'delete from public.fin_sales');
  perform pg_temp.expect('B30 admin não altera venda direto (sem UPDATE)', '42501', $q$update public.fin_sales set total_net_cents = 1$q$);
  perform pg_temp.expect('B31 admin não insere recebimento direto (sem INSERT)', '42501', $q$insert into public.fin_payments (clinic_id) values (gen_random_uuid())$q$);
  perform pg_temp.expect('B32 admin não apaga título direto', '42501', 'delete from public.fin_receivables');
  perform pg_temp.expect('B33 ninguém lê fin_events direto', '42501', 'select * from public.fin_events');
  perform pg_temp.su();
end $t$;

-- ---------- C. Conformidade (E13, F18) ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid; n int;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('C1 E13: medicação aplicada não pode ser vendida', '22023', format($q$select public.fin_save_sale(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_type','product','ref_id',%L,'quantity',1)))$q$, c, u1, pg_temp.f('pat'), pg_temp.f('it_med')), 'MEDICATION_NOT_SELLABLE');
  perform pg_temp.expect('C2 material de consumo não vende', '22023', format($q$select public.fin_save_sale(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_type','product','ref_id',%L,'quantity',1)))$q$, c, u1, pg_temp.f('pat'), pg_temp.f('it_cons')), 'ITEM_NOT_SELLABLE');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','product','ref_id',pg_temp.f('it_resale'),'quantity',2)));
  perform pg_temp.chk('C3 produto de revenda vende (2 × 180,00 = 360,00)', (select total_net_cents = 36000 from public.fin_sales where id = s), null);
  -- F18: manipulado sem licença → alerta/aceite do Owner
  perform pg_temp.expect('C4 F18: manipulado em unidade sem licença exige aceite do Owner', '42501', format($q$select public.fin_save_sale(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_type','product','ref_id',%L,'quantity',1)))$q$, c, u1, pg_temp.f('pat'), pg_temp.f('it_comp')), 'COMPLIANCE_ACCEPTANCE_REQUIRED');
  perform pg_temp.chk('C5 status de conformidade mostra bloqueio', (public.fin_compliance_status(c, u1)->>'blocked')::boolean, null);
  perform pg_temp.expect('C6 Gestor não dá o aceite (só Owner/Admin)', '42501', format($q$select public.fin_accept_compliance(%L, %L)$q$, c, u1));
  perform pg_temp.su();
  perform pg_temp.as_user('owner');
  perform public.fin_accept_compliance(c, u1);
  perform public.fin_accept_compliance(c, u1);
  select count(*) into n from public.fin_compliance_acceptances where clinic_id = c and unit_id = u1;
  perform pg_temp.chk('C7 aceite do Owner gravado uma única vez por unidade', n = 1, n::text);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','product','ref_id',pg_temp.f('it_comp'),'quantity',1)));
  perform pg_temp.chk('C8 F18: após o aceite, a venda seguinte não repete o alerta', s is not null, null);
  perform pg_temp.su();
  perform pg_temp.chk('C9 aceite gravou fin_audit_log (create/compliance)', (select count(*) = 1 from public.fin_audit_log where entity = 'compliance' and action = 'create'), null);
  -- outra unidade continua exigindo (aceite é por unidade)
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('C10 aceite é por unidade: Unidade 2 ainda exige', '42501', format($q$select public.fin_save_sale(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_type','product','ref_id',%L,'quantity',1)))$q$, c, pg_temp.f('u2'), pg_temp.f('pat'), pg_temp.f('it_comp')), 'COMPLIANCE_ACCEPTANCE_REQUIRED');
  perform pg_temp.expect('C11 recebimento acima do saldo é recusado', '22023', format($q$select public.fin_add_payment(%L, jsonb_build_object('acquirer_id', %L, 'amount_cents', 999999))$q$, pg_temp.f('sale_pix'), pg_temp.f('pix')), 'OVERPAYMENT');
  perform pg_temp.su();
end $t$;

-- ---------- D. Caixa diário: F19, F20, sangria/suprimento, fechamento, aprovação, relatório ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); reg uuid := pg_temp.f('reg_recep'); s uuid; sm jsonb; v_status text; v_cnt int; reg2 uuid; v_exp int;
begin
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('D1 F20: segundo caixa com outro aberto é bloqueado', '23505', format($q$select public.fin_open_cash(%L, %L, 1000)$q$, c, u1), 'CASH_ALREADY_OPEN');
  -- Caixa da Recepção: troco 50,00; Pix 200,00 (já lançado em B3). Agora: dinheiro 100,00 + cartão Visa débito 50,00.
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_ses'),'quantity',1)));
  perform public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('cashq'), 'amount_cents', 10000));
  perform public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('maq'), 'brand', 'Visa', 'modality', 'debit', 'installments', 1, 'amount_cents', 5000, 'nsu', '987'));
  perform pg_temp.chk('D2 recebimentos do operador entram no caixa aberto dele', (select count(*) = 3 from public.fin_payments where cash_register_id = reg), null);
  perform public.fin_cash_movement(reg, 'sangria', 2000, 'Retirada para o cofre');
  perform public.fin_cash_movement(reg, 'suprimento', 500, 'Reforço de troco');
  perform pg_temp.expect('D3 sangria exige motivo', '22023', format($q$select public.fin_cash_movement(%L, 'sangria', 100, '')$q$, reg), 'REASON_REQUIRED');
  perform pg_temp.expect('D4 sangria acima do dinheiro em caixa é recusada', '22023', format($q$select public.fin_cash_movement(%L, 'sangria', 99999999, 'muito')$q$, reg), 'CASH_INSUFFICIENT');
  sm := public.fin_cash_summary(reg);
  -- espécie esperada = 50,00 + 100,00 − 20,00 + 5,00 = 135,00
  perform pg_temp.chk('D5 esperado em espécie = troco + dinheiro − sangria + suprimento = 135,00',
    (select (e->>'expected_cents')::int = 13500 from jsonb_array_elements(sm->'live_lines') e where e->>'key' = 'cash'), sm->>'live_lines');
  perform pg_temp.chk('D6 esperado por forma: Pix 200,00 e Maq1 · Visa 50,00',
    (select (e->>'expected_cents')::int = 20000 from jsonb_array_elements(sm->'live_lines') e where e->>'key' = 'pix')
    and (select (e->>'expected_cents')::int = 5000 from jsonb_array_elements(sm->'live_lines') e where e->>'key' like 'machine:%:visa'), null);
  -- F19: contado 125,00 (diferença −10,00) exige justificativa
  perform pg_temp.expect('D7 F19: diferença de R$ 10,00 sem justificativa é recusada', '22023', format($q$select public.fin_close_cash(%L, '{"cash":12500}'::jsonb)$q$, reg), 'JUSTIFICATION_REQUIRED');
  v_status := public.fin_close_cash(reg, '{"cash":12500}'::jsonb, 'Troco dado a menos ao paciente');
  perform pg_temp.chk('D8 F19: com justificativa o fechamento aguarda aprovação do gestor', v_status = 'pending_approval', v_status);
  perform pg_temp.chk('D9 diferença registrada: −10,00 em espécie', (select cash_difference_cents = -1000 and difference_cents = 1000 and expected_cash_cents = 13500 and counted_cash_cents = 12500 from public.fin_cash_registers where id = reg), null);
  perform pg_temp.expect('D10 Recepção não aprova o próprio fechamento', '42501', format($q$select public.fin_approve_cash(%L)$q$, reg));
  perform pg_temp.expect('D11 caixa fechado não recebe novo recebimento (sem caixa aberto)', '22023', format($q$select public.fin_add_payment(%L, jsonb_build_object('acquirer_id', %L, 'amount_cents', 100))$q$, pg_temp.f('sale_recep'), pg_temp.f('pix')), 'CASH_REGISTER_REQUIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform public.fin_approve_cash(reg, 'Conferido');
  perform pg_temp.chk('D12 gestor aprova: caixa fecha com aprovador registrado', (select status = 'closed' and approved_by = pg_temp.f('prof_gestor') from public.fin_cash_registers where id = reg), null);
  select count(*) into v_cnt from public.fin_cash_report(c); perform pg_temp.chk('D13 relatório: gestor vê os caixas da clínica', v_cnt >= 1, v_cnt::text);
  perform pg_temp.su();

  -- novo dia de trabalho: limite configurado 30,00 → diferença de 10,00 fecha sem aprovação
  perform pg_temp.as_user('gestor'); perform public.fin_save_settings(c, '{"cash_diff_limit_cents":3000}'::jsonb, 'teste'); perform pg_temp.su();
  perform pg_temp.as_user('recep');
  reg2 := public.fin_open_cash(c, u1, 1000);
  perform pg_temp.chk('D14 após fechar, o operador pode abrir novo caixa', reg2 is not null, null);
  v_status := public.fin_close_cash(reg2, '{"cash":1500}'::jsonb);
  perform pg_temp.chk('D15 diferença dentro do limite (5,00 ≤ 30,00) fecha sem aprovação', v_status = 'closed', v_status);
  perform pg_temp.su();
  perform pg_temp.as_user('recep2');
  reg2 := public.fin_open_cash(c, u1, 0);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  select count(*) into v_cnt from public.fin_cash_report(c); perform pg_temp.chk('D16 relatório: Recepção vê só os próprios caixas (2 do dia)', v_cnt = 2, v_cnt::text);
  select count(*) into v_cnt from public.fin_cash_registers; perform pg_temp.chk('D17 RLS: Recepção não lê caixa de outro operador', v_cnt = 2, v_cnt::text);
  perform pg_temp.expect('D18 Recepção não vê resumo do caixa de outro operador', '42501', format($q$select public.fin_cash_summary(%L)$q$, reg2));
  perform pg_temp.su();
  -- caixa de ontem não fechado = pendência
  update public.fin_cash_registers set business_date = private.fin_today() - 1 where id = reg2;
  perform pg_temp.as_user('owner');
  perform pg_temp.chk('D19 caixa de ontem aberto aparece como pendência', (select stale from public.fin_cash_report(c) where id = reg2), null);
  perform pg_temp.su();
  perform pg_temp.chk('D20 abertura e fechamento gravaram fin_audit_log', (select count(*) >= 5 from public.fin_audit_log where entity = 'cash_register'), null);
end $t$;

-- ---------- E. Liquidação: automática, manual, correção, chargeback; cancelamento e auditoria ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid := pg_temp.f('sale_c'); r uuid; n int; v_today date := private.fin_today(); v_before jsonb;
begin
  -- rotina diária: título com data vencida é liquidado quando auto_settle está ligado
  select id into r from public.fin_receivables where sale_id = s and installment_no = 1;
  update public.fin_receivables set expected_date = v_today - 1 where id = r;
  n := private.fin_auto_settle_all();
  perform pg_temp.chk('E1 rotina diária liquida o vencido', n >= 1 and (select status = 'settled' and settled_net_cents = 47500 and settled_date = v_today from public.fin_receivables where id = r), null);
  perform pg_temp.chk('E2 liquidação automática gravou log', (select count(*) >= 1 from public.fin_audit_log where entity = 'receivable' and entity_id = r and reason = 'liquidação automática'), null);
  perform pg_temp.chk('E3 títulos futuros seguem previstos', (select count(*) = 3 from public.fin_receivables where sale_id = s and status = 'expected'), null);
  -- liquidação manual quando auto_settle desligado
  perform pg_temp.as_user('gestor'); perform public.fin_save_settings(c, '{"auto_settle":false}'::jsonb); perform pg_temp.su();
  perform pg_temp.as_user('fin');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type','service','ref_id',pg_temp.f('svc_cons'),'quantity',1)));
  perform public.fin_add_payment(s, jsonb_build_object('acquirer_id', pg_temp.f('pix'), 'amount_cents', 50000));
  perform pg_temp.chk('E4 com liquidação automática desligada o Pix fica previsto', (select status = 'expected' from public.fin_receivables where sale_id = s), null);
  select id into r from public.fin_receivables where sale_id = s;
  perform pg_temp.expect('E5 data de liquidação futura é recusada', '22023', format($q$select public.fin_settle_receivable(%L, current_date + 5)$q$, r), 'SETTLE_DATE_FUTURE');
  perform public.fin_settle_receivable(r);
  perform pg_temp.chk('E6 confirmação manual liquida', (select status = 'settled' from public.fin_receivables where id = r), null);
  perform pg_temp.expect('E7 Financeiro não corrige data/valor liquidado (só gestor)', '42501', format($q$select public.fin_correct_receivable(%L, current_date, 100, 'x ajuste')$q$, r));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('E8 correção exige motivo', '22023', format($q$select public.fin_correct_receivable(%L, current_date, 49000, '')$q$, r), 'REASON_REQUIRED');
  perform public.fin_correct_receivable(r, v_today - 1, 49000, 'Extrato do banco mostrou 490,00');
  perform pg_temp.su();
  perform pg_temp.chk('E9 gestor corrige valor e data liquidados, com log antes/depois',
    (select settled_net_cents = 49000 and settled_date = v_today - 1 from public.fin_receivables where id = r)
    and (select count(*) = 1 and bool_and((before->>'settled_net_cents')::int = 50000 and (after->>'settled_net_cents')::int = 49000) from public.fin_audit_log where entity = 'receivable' and entity_id = r and reason like '%490,00%'), null);
  perform pg_temp.as_user('gestor');
  -- chargeback: título estornado, venda volta a "paga parcialmente", evento gerado
  perform pg_temp.expect('E10 estorno de título exige motivo', '22023', format($q$select public.fin_reverse_receivable(%L, '')$q$, r), 'REASON_REQUIRED');
  perform public.fin_reverse_receivable(r, 'Chargeback do banco');
  perform pg_temp.su();
  perform pg_temp.chk('E11 chargeback: título estornado e venda sem valor pago', (select status = 'reversed' from public.fin_receivables where id = r) and (select status = 'open' and paid_cents = 0 from public.fin_sales where id = s), null);
  perform pg_temp.chk('E12 chargeback deixou evento para o repasse (E5)', (select count(*) = 1 from public.fin_events where receivable_id = r and event_type = 'receivable_reversed' and (payload->>'was_settled')::boolean), null);

  -- cancelamento da venda do exemplo C: estorna recebimento e títulos, com motivo e log
  s := pg_temp.f('sale_c');
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('E13 cancelar exige motivo', '22023', format($q$select public.fin_cancel_sale(%L, ' ')$q$, s), 'REASON_REQUIRED');
  perform public.fin_cancel_sale(s, 'Paciente desistiu');
  perform pg_temp.expect('E14 venda cancelada não recebe novo pagamento', '22023', format($q$select public.fin_add_payment(%L, jsonb_build_object('acquirer_id', %L, 'amount_cents', 100))$q$, s, pg_temp.f('pix')), 'SALE_CANCELED');
  perform pg_temp.expect('E15 cancelar duas vezes é recusado', '22023', format($q$select public.fin_cancel_sale(%L, 'de novo')$q$, s), 'ALREADY_CANCELED');
  perform pg_temp.su();
  perform pg_temp.chk('E16 cancelamento: venda cancelada, recebimento e 4 títulos estornados (nada apagado)',
    (select status = 'canceled' and cancel_reason = 'Paciente desistiu' and paid_cents = 0 from public.fin_sales where id = s)
    and (select bool_and(status = 'reversed') and count(*) = 4 from public.fin_receivables where sale_id = s)
    and (select bool_and(status = 'reversed') from public.fin_payments where sale_id = s), null);
  perform pg_temp.chk('E17 cancelamento deixou eventos (venda, recebimento, 4 títulos) para o repasse',
    (select count(*) filter (where event_type = 'sale_canceled') = 1 and count(*) filter (where event_type = 'payment_reversed') = 1 and count(*) filter (where event_type = 'receivable_reversed') = 4 from public.fin_events where sale_id = s), null);
  perform pg_temp.chk('E18 auditoria: criação da venda, do recebimento e estorno (reverse) com motivo',
    (select count(*) = 1 from public.fin_audit_log where entity = 'sale' and entity_id = s and action = 'create')
    and (select count(*) = 1 from public.fin_audit_log where entity = 'sale' and entity_id = s and action = 'reverse' and reason = 'Paciente desistiu' and user_profile_id = pg_temp.f('prof_gestor'))
    and (select count(*) = 1 from public.fin_audit_log where entity = 'payment' and action = 'reverse' and (before->>'sale_id')::uuid = s)
    and (select count(*) = 1 from public.fin_audit_log where entity = 'payment' and action = 'create' and (after->>'sale_id')::uuid = s), null);
  perform pg_temp.chk('E19 nada foi apagado: contagens só crescem (vendas, recebimentos, títulos > 0)', (select count(*) from public.fin_sales) > 5 and (select count(*) from public.fin_receivables) > 8, null);
  -- Distribuição: soma de alocações = valor do recebimento, sempre
  perform pg_temp.chk('E20 alocações por item somam o valor de cada recebimento', not exists (
    select 1 from public.fin_payments p where p.amount_cents <> (select sum(a.amount_cents) from public.fin_payment_allocations a where a.payment_id = p.id)), null);
  -- Sem DELETE para quem chama, mesmo gestor
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('E21 gestor também não apaga lançamento (correção só por estorno)', '42501', 'delete from public.fin_payments');
  perform pg_temp.su();
end $t$;

-- ---------- F. Catálogo e opções de recebimento para a Recepção (sem ler cadastros) ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); j jsonb; o jsonb;
begin
  perform pg_temp.as_user('recep');
  j := public.fin_sale_catalog(c, u1);
  perform pg_temp.chk('F1 Recepção recebe o catálogo vendável (serviços, pacote, produto de revenda e manipulado; sem medicação/consumo)',
    jsonb_array_length(j->'services') = 3 and jsonb_array_length(j->'packages') = 1 and jsonb_array_length(j->'products') = 2 and not (j->>'can_edit_price')::boolean, j::text);
  o := public.fin_payment_options(c, u1);
  perform pg_temp.chk('F2 Recepção vê as formas de pagamento, mas sem taxas', jsonb_array_length(o) >= 4 and (select bool_and(e->'rows' is not null) from jsonb_array_elements(o) e)
    and not exists (select 1 from jsonb_array_elements(o) e, jsonb_array_elements(e->'rows') r where r->>'fee_pct' is not null), null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  o := public.fin_payment_options(c, u1);
  perform pg_temp.chk('F3 Gestor vê as taxas na mesma RPC', exists (select 1 from jsonb_array_elements(o) e, jsonb_array_elements(e->'rows') r where r->>'brand' = 'Visa' and (r->>'fee_pct')::numeric = 5 and r->>'modality' = 'credit_2_6'), null);
  perform pg_temp.chk('F4 Gestor pode editar preço', (public.fin_sale_catalog(c, u1)->>'can_edit_price')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('F5 Profissional sem papel não lê o catálogo de venda', '42501', format($q$select public.fin_sale_catalog(%L, %L)$q$, c, u1));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('F6 outra clínica não lê opções de recebimento', '42501', format($q$select public.fin_payment_options(%L, %L)$q$, c, u1));
  perform pg_temp.su();
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
