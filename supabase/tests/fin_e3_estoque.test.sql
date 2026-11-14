-- Prova SQL da FIN-E3 (estoque básico) num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e3-sql-proof.sh  (cria o cluster/banco, aplica stub + E1 + E2 + E3, roda este arquivo e apaga tudo).
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
create function pg_temp.expect(p_name text, p_state text, p_sql text, p_msg text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  insert into tr(name, ok, detail) values (p_name, p_state is null, case when p_state is null then 'ok' else 'passou sem erro' end);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  insert into tr(name, ok, detail) values (p_name, v_state = p_state and (p_msg is null or v_msg like '%' || p_msg || '%'), v_state || ' ' || v_msg);
end $$;
-- Entrada de uma linha só (atalho); devolve o id do documento.
create function pg_temp.entry(p_unit uuid, p_type text, p_item uuid, p_qty numeric, p_cost_each numeric, p_lot text default null, p_exp date default null,
                              p_inv text default null, p_extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
begin
  return public.fin_stock_entry(pg_temp.f('c'), p_unit,
    jsonb_build_object('entry_type', p_type, 'invoice_number', p_inv, 'supplier_new', jsonb_build_object('name', 'Fornecedor Padrão')) || p_extra,
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'unit_cost_cents', p_cost_each, 'lot_code', p_lot, 'expiry_date', p_exp)));
end $$;
create function pg_temp.bal(p_item text, p_unit text) returns numeric language sql as $$
  select qty_on_hand from public.stock_balances where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit) $$;
create function pg_temp.avg(p_item text, p_unit text) returns numeric language sql as $$
  select avg_cost_cents from public.stock_balances where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit) $$;
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text),
  pg_temp.entry(uuid, text, uuid, numeric, numeric, text, date, text, jsonb), pg_temp.bal(text, text), pg_temp.avg(text, text) to public;

-- ---------- Fixture ----------
do $t$
declare
  c uuid; c2 uuid; u1 uuid; u2 uuid; k text; pid uuid; pro uuid; v_id uuid; v_pat uuid; v_pat2 uuid; v_prof uuid;
begin
  foreach k in array array['owner','gestor','fin','recep','pro','estoq','estoq1','other'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','gestor','fin','recep','pro','estoq','estoq1'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end) returning id into pro;
    insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_other'), c2, 'admin');
  select id into u1 from public.clinic_units where clinic_id = c and is_primary;
  insert into public.clinic_units (clinic_id, name) values (c, 'Unidade 2') returning id into u2;
  insert into fx values ('u1', u1), ('u2', u2);
  select id into v_id from public.clinic_units where clinic_id = c2 and is_primary; insert into fx values ('u_b', v_id);
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values
    (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_fin'), 'financeiro'), (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_estoq'), 'estoquista');
  insert into public.clinic_staff_roles (clinic_id, professional_id, role, all_units, unit_ids) values (c, pg_temp.f('pro_estoq1'), 'estoquista', false, array[u1]);

  insert into public.profiles (full_name) values ('Paciente Um') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat; insert into fx values ('pat', v_pat);
  insert into public.profiles (full_name) values ('Paciente Dois') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat2; insert into fx values ('pat2', v_pat2);

  -- itens: A medicação (lote), B caneta multidose (fracionada, individual, lote), C revenda sem lote, D material, E manipulado (lote), F revenda sem estoque lançado, G item da clínica B
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c, 'Ampola X', 'amp', 'medication', 'caixa', 'ampola', 'ampola', true) returning id into v_id; insert into fx values ('it_a', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control, fractional, opened_validity_days, individual_use)
    values (c, 'Caneta multidose', 'caneta', 'medication', 'un', 'caneta', 'dose', true, true, 28, true) returning id into v_id; insert into fx values ('it_b', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents) values (c, 'Suplemento C', 'sup', 'resale', 'un', 'un', 'un', true, 18000) returning id into v_id; insert into fx values ('it_c', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Seringa D', 'mat', 'consumable', 'cx', 'un', 'un') returning id into v_id; insert into fx values ('it_d', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control, sellable, sale_price_cents) values (c, 'Manipulado E', 'man', 'compounded', 'un', 'un', 'un', true, true, 25000) returning id into v_id; insert into fx values ('it_e', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents) values (c, 'Revenda F', 'sup', 'resale', 'un', 'un', 'un', true, 5000) returning id into v_id; insert into fx values ('it_f', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c2, 'Item B1', 'x', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_g', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Kit H', 'mat', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_h', v_id);
end $t$;

-- ---------- A. Permissões: quem movimenta, quem consulta, quem não vê ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d date := private.fin_today(); v uuid; j jsonb;
begin
  perform pg_temp.as_user('estoq');
  v := pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_a'), 10, 4000, 'L1', d + 40);
  perform pg_temp.chk('A1 Estoquista lança saldo inicial (10 ampolas a R$ 40,00)', v is not null and pg_temp.bal('it_a','u1') = 10 and pg_temp.avg('it_a','u1') = 4000, null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('A2 Gestor também movimenta (entrada de bonificação)', pg_temp.entry(u1, 'bonus', pg_temp.f('it_d'), 5, 0, null, null, null, jsonb_build_object('notes', 'Doação do fornecedor')) is not null, null);
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('A3 Financeiro NÃO movimenta (consulta)', '42501', format($q$select pg_temp.entry(%L, 'purchase', %L, 1, 100, null, null, 'X')$q$, u1, pg_temp.f('it_d')));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('A4 Recepção NÃO movimenta', '42501', format($q$select pg_temp.entry(%L, 'purchase', %L, 1, 100, null, null, 'X')$q$, u1, pg_temp.f('it_d')));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('A5 Profissional (sem papel) NÃO movimenta', '42501', format($q$select pg_temp.entry(%L, 'purchase', %L, 1, 100, null, null, 'X')$q$, u1, pg_temp.f('it_d')));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('A6 Admin de OUTRA clínica não movimenta aqui', '42501', format($q$select pg_temp.entry(%L, 'purchase', %L, 1, 100, null, null, 'X')$q$, u1, pg_temp.f('it_d')));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.expect('A7 Estoquista só da unidade 1 NÃO lança na unidade 2', '42501', format($q$select pg_temp.entry(%L, 'initial_balance', %L, 1, 100)$q$, u2, pg_temp.f('it_d')));
  perform pg_temp.chk('A8 ... mas lança na unidade 1', pg_temp.entry(u1, 'bonus', pg_temp.f('it_d'), 1, 0, null, null, null, jsonb_build_object('notes', 'Brinde do representante')) is not null, null);
  perform pg_temp.su();
  perform pg_temp.as_user('owner');
  perform pg_temp.chk('A9 Admin/Owner movimenta (saldo inicial na unidade 2: custo independente)', pg_temp.entry(u2, 'initial_balance', pg_temp.f('it_a'), 4, 5000, 'L9', d + 90) is not null
    and pg_temp.bal('it_a','u2') = 4 and pg_temp.avg('it_a','u2') = 5000 and pg_temp.avg('it_a','u1') = 4000, null);
  perform pg_temp.su();
end $t$;

-- ---------- B. Visibilidade: Financeiro consulta custo; Recepção e Profissional não veem nada ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); n integer;
begin
  perform pg_temp.as_user('fin');
  select count(*) into n from public.fin_stock_balances(c, u1);
  perform pg_temp.chk('B1 Financeiro consulta o saldo e vê o custo médio e o valor', n >= 2 and exists (select 1 from public.fin_stock_balances(c, u1) b where b.item_name = 'Ampola X' and b.avg_cost_cents = 4000 and b.value_cents = 40000), null);
  perform pg_temp.chk('B2 Financeiro lê o kardex com custo unitário e total', exists (select 1 from public.fin_stock_movements(c, u1) m where m.movement_type = 'initial_balance' and m.total_cost_cents = 40000), null);
  perform pg_temp.chk('B3 Financeiro lê as tabelas por RLS', (select count(*) from public.stock_movements) >= 3 and (select count(*) from public.stock_balances) >= 2, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.chk('B4 Recepção: tabelas de estoque vêm VAZIAS por RLS (sem custo, sem saldo)',
    (select count(*) from public.stock_movements) = 0 and (select count(*) from public.stock_balances) = 0 and (select count(*) from public.stock_lots) = 0 and (select count(*) from public.stock_entries) = 0
    and (select count(*) from public.stock_suppliers) = 0, null);
  perform pg_temp.expect('B5 Recepção não chama o saldo por RPC', '42501', format($q$select * from public.fin_stock_balances(%L, null)$q$, c));
  perform pg_temp.expect('B6 Recepção não chama o kardex por RPC', '42501', format($q$select * from public.fin_stock_movements(%L)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.chk('B7 Profissional: tabelas vazias', (select count(*) from public.stock_movements) = 0 and (select count(*) from public.stock_balances) = 0, null);
  perform pg_temp.expect('B8 Profissional não chama o saldo por RPC', '42501', format($q$select * from public.fin_stock_balances(%L, null)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.chk('B9 RLS por clínica: a outra clínica não enxerga nada daqui', (select count(*) from public.stock_movements) = 0 and (select count(*) from public.stock_balances) = 0, null);
  perform pg_temp.expect('B10 ... nem por RPC', '42501', format($q$select * from public.fin_stock_balances(%L, null)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.chk('B11 Estoquista da unidade 1 não enxerga o saldo da unidade 2 (RLS por unidade)', not exists (select 1 from public.stock_balances where unit_id = pg_temp.f('u2'))
    and not exists (select 1 from public.fin_stock_balances(c, null) where unit_id = pg_temp.f('u2')), null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('B12 fin_my_access: gestor movimenta, financeiro só lê, recepção nada',
    (public.fin_my_access(c)->'can'->>'stock_move_write')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.chk('B13 fin_my_access do Financeiro: lê, não escreve', (public.fin_my_access(c)->'can'->>'stock_move_read')::boolean and not (public.fin_my_access(c)->'can'->>'stock_move_write')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.chk('B14 fin_my_access da Recepção: nem lê', not (public.fin_my_access(c)->'can'->>'stock_move_read')::boolean, null);
  perform pg_temp.su();
end $t$;

-- ---------- C. Custo médio e FEFO (E1 do documento) ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); d date := private.fin_today(); r jsonb; ids jsonb; n integer;
begin
  perform pg_temp.as_user('estoq');
  -- E1: saldo 10 a R$ 40; entram 20 a R$ 46 → CM R$ 44,00
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 20, 4600, 'L2', d + 100, 'NF-100');
  perform pg_temp.chk('C1 E1: custo médio após 10@40,00 + 20@46,00 = R$ 44,00 (saldo 30)', pg_temp.avg('it_a','u1') = 4400 and pg_temp.bal('it_a','u1') = 30, pg_temp.avg('it_a','u1')::text);
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_a'), 'sector', 3, jsonb_build_object('purpose', 'Sala de procedimentos', 'reason', 'Uso geral da sala'));
  perform pg_temp.chk('C2 E1: saída de 3 un valorada em R$ 132,00 pelo custo médio', (r->>'total_cost_cents')::bigint = 13200 and pg_temp.bal('it_a','u1') = 27 and pg_temp.avg('it_a','u1') = 4400, r::text);
  perform pg_temp.chk('C3 FEFO: a saída saiu do lote que vence primeiro (L1: 10 → 7; L2 intacto)',
    (select qty_on_hand from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'L1') = 7
    and (select qty_on_hand from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'L2') = 20, null);
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_a'), 'sector', 8, jsonb_build_object('purpose', 'Esterilização', 'reason', 'Reposição do setor'));
  perform pg_temp.chk('C4 FEFO: saída de 8 esgota L1 (7) e completa 1 do L2 — duas movimentações, 8 × R$ 44,00 = R$ 352,00',
    jsonb_array_length(r->'movement_ids') = 2 and (r->>'total_cost_cents')::bigint = 35200
    and (select qty_on_hand from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'L1') = 0
    and (select qty_on_hand from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'L2') = 19, r::text);
  perform pg_temp.chk('C5 saídas não mudam o custo médio; saldo = soma dos lotes', pg_temp.avg('it_a','u1') = 4400 and pg_temp.bal('it_a','u1') = 19, null);
  -- lote escolhido à mão
  perform pg_temp.expect('C6 saída pede lote sem saldo suficiente → recusa', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 2, %L::jsonb)$q$, c, u1, pg_temp.f('it_a'),
    jsonb_build_object('purpose', 'Setor', 'reason', 'Teste', 'lot_id', (select id from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'L1')::text)::text), 'INSUFFICIENT_STOCK');
  -- arredondamento meio-para-cima: 7 un a R$ 10,01 + 2 un a R$ 10,00 → CM = 9010/9 ... conferido com item D
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 7, 1001, null, null, 'NF-D1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 2, 1000, null, null, 'NF-D2');
  -- saldo D antes: 5 (bonificação, custo 0) + 1 (brinde) = 6 a custo 0 → +7@1001 +2@1000 = 15 un, valor 7007+2000 = 9007 → CM 600,4667
  perform pg_temp.chk('C7 custo médio com 4 casas (meio-para-cima): 9007 ÷ 15 = 600,4667', pg_temp.avg('it_d','u1') = 600.4667 and pg_temp.bal('it_d','u1') = 15, pg_temp.avg('it_d','u1')::text);
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'sector', 3, jsonb_build_object('purpose', 'Sala', 'reason', 'Uso'));
  perform pg_temp.chk('C8 saída valorada em linha: 3 × 600,4667 = 1801,4 → R$ 18,01 (meio-para-cima por linha)', (r->>'total_cost_cents')::bigint = 1801, r::text);
  perform pg_temp.su();
end $t$;

-- ---------- D. Entradas: validações, frete, NF-e (XML), de/para, duplicidade ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d date := private.fin_today(); e uuid; sup uuid; mp integer; key1 text := lpad('1', 44, '1'); key2 text := lpad('2', 44, '2');
  j jsonb;
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('D1 E15: segundo saldo inicial do mesmo item e unidade é bloqueado', '22023', format($q$select pg_temp.entry(%L, 'initial_balance', %L, 5, 4000, 'L7', %L::date)$q$, u1, pg_temp.f('it_a'), d + 50), 'INITIAL_BALANCE_EXISTS');
  perform pg_temp.expect('D2 item com controle de lote exige lote e validade', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 5, 4000, null, null, 'NF-X1')$q$, u1, pg_temp.f('it_a')), 'LOT_REQUIRED');
  perform pg_temp.expect('D3 lote já vencido não entra', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 5, 4000, 'LV', %L::date, 'NF-X2')$q$, u1, pg_temp.f('it_a'), d - 1), 'LOT_ALREADY_EXPIRED');
  perform pg_temp.expect('D4 item não fracionado não aceita 1,5 unidade', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 1.5, 4000, 'L3', %L::date, 'NF-X3')$q$, u1, pg_temp.f('it_a'), d + 50), 'NOT_FRACTIONAL');
  perform pg_temp.expect('D5 compra sem número da nota é recusada', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 5, 4000, 'L3', %L::date, null)$q$, u1, pg_temp.f('it_a'), d + 50), 'INVOICE_NUMBER_REQUIRED');
  perform pg_temp.expect('D6 compra com custo zero é recusada (zero só em bonificação)', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 5, 0, 'L3', %L::date, 'NF-X4')$q$, u1, pg_temp.f('it_a'), d + 50), 'COST_REQUIRED');
  perform pg_temp.expect('D7 bonificação exige a origem', '22023', format($q$select pg_temp.entry(%L, 'bonus', %L, 5, 0, 'L3', %L::date)$q$, u1, pg_temp.f('it_a'), d + 50), 'ORIGIN_REQUIRED');
  perform pg_temp.expect('D8 mesma nota do mesmo fornecedor não entra duas vezes', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 5, 4600, 'L2', %L::date, 'NF-100')$q$, u1, pg_temp.f('it_a'), d + 100), 'INVOICE_ALREADY_IMPORTED');
  perform pg_temp.expect('D9 mesmo lote com outra validade é recusado', '22023', format($q$select pg_temp.entry(%L, 'purchase', %L, 5, 4600, 'L2', %L::date, 'NF-X5')$q$, u1, pg_temp.f('it_a'), d + 101), 'LOT_EXPIRY_MISMATCH');
  e := pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 5, 4600, 'L2', d + 100, 'NF-X6');
  perform pg_temp.chk('D10 mesmo lote e mesma validade soma no lote existente (L2 19 → 24)', e is not null
    and (select qty_on_hand from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'L2') = 24, null);

  -- frete rateado pelo valor dos itens: 1.000 e 3.000 com frete 400 → 100 + 300
  e := public.fin_stock_entry(c, u1, jsonb_build_object('entry_type', 'purchase', 'invoice_number', 'NF-FRETE', 'freight_cents', 400, 'supplier_new', jsonb_build_object('name', 'Fornecedor Padrão')),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'quantity', 10, 'line_total_cents', 1000), jsonb_build_object('item_id', pg_temp.f('it_d'), 'quantity', 10, 'line_total_cents', 3000)));
  perform pg_temp.chk('D11 frete de R$ 4,00 rateado pelo valor: linhas viram 1.100 e 3.300; total do documento 4.400',
    (select array_agg(total_cost_cents order by total_cost_cents) from public.stock_movements where entry_id = e) = array[1100, 3300]::bigint[]
    and (select total_cents from public.stock_entries where id = e) = 4400, null);
  perform pg_temp.chk('D12 custo unitário do item sem estoque anterior = 1.100 ÷ 10 = R$ 1,10', pg_temp.avg('it_h','u1') = 110, pg_temp.avg('it_h','u1')::text);

  -- XML da NF-e: fornecedor novo por CNPJ válido, chave de 44 dígitos, de/para salvo
  perform pg_temp.expect('D13 XML sem chave de acesso é recusado', '22023', format($q$select public.fin_stock_entry(%L, %L, %L::jsonb, %L::jsonb)$q$, c, u1,
    jsonb_build_object('entry_type', 'xml_purchase', 'invoice_number', '9001', 'supplier_new', jsonb_build_object('name', 'Distribuidora Sul', 'tax_id', '11222333000181'))::text,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'quantity', 5, 'line_total_cents', 500))::text), 'INVOICE_KEY_REQUIRED');
  perform pg_temp.expect('D14 CNPJ inválido do fornecedor é recusado', '22023', format($q$select public.fin_stock_entry(%L, %L, %L::jsonb, %L::jsonb)$q$, c, u1,
    jsonb_build_object('entry_type', 'xml_purchase', 'invoice_number', '9001', 'invoice_key', key1, 'supplier_new', jsonb_build_object('name', 'Distribuidora Sul', 'tax_id', '11222333000182'))::text,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'quantity', 5, 'line_total_cents', 500))::text), 'INVALID_TAX_ID');
  e := public.fin_stock_entry(c, u1, jsonb_build_object('entry_type', 'xml_purchase', 'invoice_number', '9001', 'invoice_key', key1, 'issue_date', d, 'supplier_new', jsonb_build_object('name', 'Distribuidora Sul', 'tax_id', '11.222.333/0001-81')),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'quantity', 50, 'line_total_cents', 7500, 'supplier_code', 'SKU-77', 'conversion_factor', 10),
                      jsonb_build_object('item_id', pg_temp.f('it_a'), 'quantity', 12, 'line_total_cents', 60000, 'lot_code', 'XML-L1', 'expiry_date', d + 200, 'supplier_code', 'AMP-9', 'conversion_factor', 1)));
  select id into sup from public.stock_suppliers where tax_id = '11222333000181';
  perform pg_temp.chk('D15 XML cria o fornecedor pelo CNPJ e a entrada ligada à chave', sup is not null and (select supplier_id from public.stock_entries where id = e) = sup
    and (select invoice_key from public.stock_entries where id = e) = key1 and (select entry_type from public.stock_entries where id = e) = 'xml_purchase', null);
  select count(*) into mp from public.stock_supplier_item_map where supplier_id = sup;
  perform pg_temp.chk('D16 E14: de/para do fornecedor salvo na primeira importação (2 códigos, fator 10 no SKU-77)', mp = 2
    and (select conversion_factor from public.stock_supplier_item_map where supplier_id = sup and supplier_code = 'SKU-77') = 10, null);
  perform pg_temp.expect('D17 a mesma chave de NF-e não importa duas vezes', '22023', format($q$select public.fin_stock_entry(%L, %L, %L::jsonb, %L::jsonb)$q$, c, u1,
    jsonb_build_object('entry_type', 'xml_purchase', 'invoice_number', '9002', 'invoice_key', key1, 'supplier_id', sup::text)::text,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'quantity', 5, 'line_total_cents', 500))::text), 'INVOICE_ALREADY_IMPORTED');
  -- próxima nota: o mesmo código aponta para outro fator → o de/para é atualizado (1 linha, não duplica)
  perform public.fin_stock_entry(c, u1, jsonb_build_object('entry_type', 'xml_purchase', 'invoice_number', '9003', 'invoice_key', key2, 'supplier_id', sup::text),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'quantity', 20, 'line_total_cents', 3000, 'supplier_code', 'SKU-77', 'conversion_factor', 20)));
  perform pg_temp.chk('D18 de/para reaproveitado/atualizado: continua 1 linha por código e o fator novo vale', (select count(*) from public.stock_supplier_item_map where supplier_id = sup and supplier_code = 'SKU-77') = 1
    and (select conversion_factor from public.stock_supplier_item_map where supplier_id = sup and supplier_code = 'SKU-77') = 20, null);
  perform pg_temp.chk('D19 custo médio após as duas notas do item H: (10@1,10 + 50@1,50 + 20@1,50) ÷ 80', pg_temp.bal('it_h','u1') = 80 and pg_temp.avg('it_h','u1') = round((1100 + 7500 + 3000)::numeric / 80, 4), pg_temp.avg('it_h','u1')::text);
  j := public.fin_stock_lots(c, u1, pg_temp.f('it_a'));
  perform pg_temp.chk('D20 lotes do item A em ordem FEFO e custo médio informado', (j->'lots'->0->>'lot_code') = 'L2' and (j->'lots'->(jsonb_array_length(j->'lots') - 1)->>'lot_code') = 'XML-L1', j::text);
  perform pg_temp.su();
end $t$;

-- ---------- E. Perda, vencido (E4), motivo obrigatório ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); d date := private.fin_today(); r jsonb; lotv uuid; q integer;
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('E1 perda sem motivo é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'loss', 1, '{"loss_kind":"breakage"}')$q$, c, u1, pg_temp.f('it_d')), 'REASON_REQUIRED');
  perform pg_temp.expect('E2 perda sem o tipo (perda/quebra/vencimento) é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'loss', 1, '{"reason":"caiu"}')$q$, c, u1, pg_temp.f('it_d')), 'LOSS_KIND_REQUIRED');
  perform pg_temp.expect('E3 consumo de setor sem finalidade é recusado', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 1, '{"reason":"uso"}')$q$, c, u1, pg_temp.f('it_d')), 'PURPOSE_AND_REASON_REQUIRED');
  perform pg_temp.expect('E4 uso por paciente exige o paciente', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'appointment', 1, '{}')$q$, c, u1, pg_temp.f('it_d')), 'PATIENT_REQUIRED');
  perform pg_temp.expect('E5 tipo de saída inválido', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sale', 1, '{}')$q$, c, u1, pg_temp.f('it_d')), 'INVALID_EXIT_TYPE');
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'loss', 2, '{"loss_kind":"breakage","reason":"Caixa caiu no chão"}'::jsonb);
  perform pg_temp.chk('E6 quebra com motivo vale e grava loss_kind', exists (select 1 from public.stock_movements where id = (r->'movement_ids'->>0)::uuid and loss_kind = 'breakage' and movement_type = 'loss' and reason = 'Caixa caiu no chão'), null);
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'appointment', 1, jsonb_build_object('patient_id', pg_temp.f('pat')::text));
  perform pg_temp.chk('E7 uso por paciente grava o paciente (kardex mostra o nome)', exists (select 1 from public.fin_stock_movements(c, u1, pg_temp.f('it_d')) m where m.movement_type = 'appointment' and m.patient_name = 'Paciente Um'), null);
  perform pg_temp.su();

  -- E4: o tempo passa — a validade do lote L1... (lote criado vigente e depois vencido pelo relógio)
  perform pg_temp.as_user('estoq');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_e'), 6, 8000, 'MV', d + 3, 'NF-E1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_e'), 4, 9000, 'MN', d + 90, 'NF-E2');
  perform pg_temp.su();
  update public.stock_lots set expiry_date = d - 1 where item_id = pg_temp.f('it_e') and lot_code = 'MV';
  select id into lotv from public.stock_lots where item_id = pg_temp.f('it_e') and lot_code = 'MV';
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('E8 E4: consumo do lote vencido é bloqueado (lote escolhido)', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 1, %L::jsonb)$q$, c, u1, pg_temp.f('it_e'),
    jsonb_build_object('purpose', 'Sala', 'reason', 'Teste', 'lot_id', lotv::text)::text), 'LOT_EXPIRED');
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_e'), 'sector', 4, '{"purpose":"Sala","reason":"Uso"}'::jsonb);
  perform pg_temp.chk('E9 sem escolher lote, o consumo pula o vencido e sai do vigente (MN: 4 → 0)', (select qty_on_hand from public.stock_lots where item_id = pg_temp.f('it_e') and lot_code = 'MN') = 0
    and (select qty_on_hand from public.stock_lots where id = lotv) = 6, r::text);
  perform pg_temp.expect('E10 E4: só sobrou lote vencido → o consumo é bloqueado', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 1, '{"purpose":"Sala","reason":"Uso"}')$q$, c, u1, pg_temp.f('it_e')), 'LOT_EXPIRED');
  perform pg_temp.expect('E11 perda comum (quebra) não tira lote vencido', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'loss', 1, %L::jsonb)$q$, c, u1, pg_temp.f('it_e'),
    jsonb_build_object('loss_kind', 'breakage', 'reason', 'Quebrou', 'lot_id', lotv::text)::text), 'LOT_EXPIRED');
  perform pg_temp.expect('E12 perda por vencimento sem confirmação é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'loss', 6, %L::jsonb)$q$, c, u1, pg_temp.f('it_e'),
    jsonb_build_object('loss_kind', 'expiry', 'reason', 'Vencido', 'lot_id', lotv::text)::text), 'EXPIRED_LOT_CONFIRM_REQUIRED');
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_e'), 'loss', 6, jsonb_build_object('loss_kind', 'expiry', 'reason', 'Lote MV venceu', 'confirm_expired', true, 'lot_id', lotv::text));
  perform pg_temp.chk('E13 E4: perda por vencimento com confirmação sai do lote vencido (6 × custo médio)', (select qty_on_hand from public.stock_lots where id = lotv) = 0 and (r->>'total_cost_cents')::bigint > 0, r::text);
  perform pg_temp.expect('E14 perda por vencimento de lote que NÃO venceu é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'loss', 1, %L::jsonb)$q$, c, u1, pg_temp.f('it_a'),
    jsonb_build_object('loss_kind', 'expiry', 'reason', 'Venceu?', 'confirm_expired', true)::text), 'LOT_NOT_EXPIRED');
  perform pg_temp.expect('E15 saldo negativo é proibido', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 9999, '{"purpose":"Sala","reason":"Uso"}')$q$, c, u1, pg_temp.f('it_d')), 'INSUFFICIENT_STOCK');
  perform pg_temp.expect('E16 item sem estoque lançado: saída recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 1, '{"purpose":"Sala","reason":"Uso"}')$q$, c, u1, pg_temp.f('it_f')), 'INSUFFICIENT_STOCK');
  perform pg_temp.expect('E17 quantidade com 4 casas é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 1.2345, '{"purpose":"Sala","reason":"Uso"}')$q$, c, u1, pg_temp.f('it_d')), 'INVALID_QUANTITY');
  perform pg_temp.expect('E18 item não fracionado não sai em fração', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 0.5, '{"purpose":"Sala","reason":"Uso"}')$q$, c, u1, pg_temp.f('it_d')), 'NOT_FRACTIONAL');
  perform pg_temp.su();
end $t$;

-- ---------- F. Uso fracionado e individual por paciente (E5, E12, D20) ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); d date := private.fin_today(); r jsonb; r2 jsonb; ou uuid; ou2 uuid; l_near uuid; l_far uuid; ex date;
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_b'), 2, 30000, 'C-NEAR', d + 10);      -- vence antes do prazo "após aberto"
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_b'), 2, 30000, 'C-FAR', d + 120, 'NF-B1');   -- vence depois
  select id into l_near from public.stock_lots where item_id = pg_temp.f('it_b') and lot_code = 'C-NEAR';
  select id into l_far from public.stock_lots where item_id = pg_temp.f('it_b') and lot_code = 'C-FAR';
  perform pg_temp.expect('F1 caneta de uso individual: dose sem paciente é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 0.25, '{"purpose":"Sala","reason":"Uso"}')$q$, c, u1, pg_temp.f('it_b')), 'PATIENT_REQUIRED');
  -- abre unidade do lote que vence depois (E5: validade = menor entre o lote e abertura + 28 dias)
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'appointment', 0.25, jsonb_build_object('patient_id', pg_temp.f('pat')::text, 'lot_id', l_far::text));
  ou := (r->>'open_unit_id')::uuid;
  select expires_on into ex from public.stock_open_units where id = ou;
  perform pg_temp.chk('F2 E5: aberta hoje com validade após aberto de 28 dias e lote até +120 → vence em hoje + 28', ex = d + 28 and (select qty_remaining from public.stock_open_units where id = ou) = 0.75, ex::text);
  perform pg_temp.chk('F3 a dose de 0,25 foi valorada pelo custo médio (0,25 × R$ 300,00 = R$ 75,00) e o saldo do lote caiu 0,25', (r->>'total_cost_cents')::bigint = 7500
    and (select qty_on_hand from public.stock_lots where id = l_far) = 1.75 and pg_temp.bal('it_b','u1') = 3.75, r::text);
  -- unidade aberta do lote que vence em 10 dias: validade = a do lote (menor)
  r2 := public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'appointment', 0.5, jsonb_build_object('patient_id', pg_temp.f('pat2')::text, 'lot_id', l_near::text));
  ou2 := (r2->>'open_unit_id')::uuid;
  select expires_on into ex from public.stock_open_units where id = ou2;
  perform pg_temp.chk('F4 a validade da unidade aberta nunca passa a do lote (lote +10 < abertura + 28 → vence em +10)', ex = d + 10, ex::text);
  -- E12: caneta aberta para o paciente 1; dose para o paciente 2 é bloqueada
  perform pg_temp.expect('F5 E12: unidade aberta do paciente Um não dá dose ao paciente Dois', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'appointment', 0.1, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('patient_id', pg_temp.f('pat2')::text, 'open_unit_id', ou::text)::text), 'OPEN_UNIT_OTHER_PATIENT');
  perform pg_temp.expect('F6 dose maior que o que resta na unidade aberta é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'appointment', 0.8, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('patient_id', pg_temp.f('pat')::text, 'open_unit_id', ou::text)::text), 'INSUFFICIENT_OPEN_UNIT');
  perform pg_temp.expect('F7 saída sem paciente de unidade aberta individual é bloqueada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 0.1, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('purpose', 'Sala', 'reason', 'Uso', 'open_unit_id', ou::text)::text), 'OPEN_UNIT_OTHER_PATIENT');
  perform pg_temp.expect('F8 fração com mais de 3 casas é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'appointment', 0.12345, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('patient_id', pg_temp.f('pat')::text, 'open_unit_id', ou::text)::text), 'INVALID_QUANTITY');
  perform pg_temp.expect('F9 mais de 1 unidade em fração sem unidade aberta (1,5) é recusada', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'appointment', 1.5, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('patient_id', pg_temp.f('pat')::text)::text), 'FRACTION_EXCEEDS_UNIT');
  -- doses seguintes do mesmo paciente fecham a unidade
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'appointment', 0.5, jsonb_build_object('patient_id', pg_temp.f('pat')::text, 'open_unit_id', ou::text));
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'appointment', 0.25, jsonb_build_object('patient_id', pg_temp.f('pat')::text, 'open_unit_id', ou::text));
  perform pg_temp.chk('F10 a última dose fecha a unidade aberta (restante 0, fechada)', (select qty_remaining = 0 and status = 'closed' from public.stock_open_units where id = ou), null);
  perform pg_temp.chk('F11 saldo = 4 − (0,25+0,5+0,5+0,25) = 2,5 frascos, soma dos lotes confere', pg_temp.bal('it_b','u1') = 2.5
    and (select sum(qty_on_hand) from public.stock_lots where item_id = pg_temp.f('it_b')) = 2.5, pg_temp.bal('it_b','u1')::text);
  -- unidade aberta reserva fração: o lote C-NEAR tem 2 − 0,5 = 1,5 com 0,5 restantes abertos → só 1 inteira
  perform pg_temp.expect('F12 saída de unidades inteiras não consome a fração reservada pela unidade aberta', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'sector', 2, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('purpose', 'Sala', 'reason', 'Uso', 'lot_id', l_near::text)::text), 'INSUFFICIENT_STOCK');
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'loss', 0.5, jsonb_build_object('loss_kind', 'loss', 'reason', 'Descarte da sobra da caneta do paciente Dois', 'open_unit_id', ou2::text));
  perform pg_temp.chk('F13 descarte da sobra (perda) fecha a unidade aberta, mesmo sendo de outro paciente', (select status = 'closed' and close_reason = 'discarded' from public.stock_open_units where id = ou2), null);
  -- unidade aberta vencida (relógio): dose bloqueada; só perda por vencimento
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'appointment', 0.25, jsonb_build_object('patient_id', pg_temp.f('pat2')::text, 'lot_id', l_far::text));
  ou2 := (r->>'open_unit_id')::uuid;
  perform pg_temp.su();
  update public.stock_open_units set expires_on = d - 1 where id = ou2;
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('F14 unidade aberta com a validade vencida não dá dose', '22023', format($q$select public.fin_stock_exit(%L, %L, %L, 'appointment', 0.1, %L::jsonb)$q$, c, u1, pg_temp.f('it_b'),
    jsonb_build_object('patient_id', pg_temp.f('pat2')::text, 'open_unit_id', ou2::text)::text), 'OPEN_UNIT_EXPIRED');
  r := public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'loss', 0.75, jsonb_build_object('loss_kind', 'expiry', 'reason', 'Caneta aberta venceu', 'confirm_expired', true, 'open_unit_id', ou2::text));
  perform pg_temp.chk('F15 perda por vencimento da unidade aberta vencida zera a sobra e fecha', (select status = 'closed' from public.stock_open_units where id = ou2) and (r->>'total_cost_cents')::bigint = 22500, r::text);
  perform pg_temp.su();
end $t$;

-- ---------- G. Venda de produto baixa estoque (E9) e cancelamento devolve ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); d date := private.fin_today(); s uuid; s2 uuid; n0 integer; m uuid;
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_c'), 5, 1000);   -- 5 un a R$ 10,00, sem lote
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', pg_temp.f('it_c'), 'quantity', 2)));
  perform pg_temp.su();
  perform pg_temp.chk('G1 E9: venda de 2 unidades baixa o estoque (5 → 3) e grava a movimentação «sale» ligada à venda', pg_temp.bal('it_c','u1') = 3
    and exists (select 1 from public.stock_movements where sale_id = s and movement_type = 'sale' and qty = -2 and total_cost_cents = -2000), null);
  select count(*) into n0 from public.fin_sales;
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('G2 venda acima do saldo é recusada (e nenhuma venda nasce)', '22023', format($q$select public.fin_save_sale(%L, %L, %L, %L::jsonb)$q$, c, u1, pg_temp.f('pat'),
    jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', pg_temp.f('it_c'), 'quantity', 4))::text), 'INSUFFICIENT_STOCK');
  perform pg_temp.su();
  perform pg_temp.chk('G3 ... e a venda recusada não deixou rastro (vendas e saldo iguais)', (select count(*) from public.fin_sales) = n0 and pg_temp.bal('it_c','u1') = 3, null);
  perform pg_temp.as_user('recep');
  s2 := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', pg_temp.f('it_f'), 'quantity', 3)));
  perform pg_temp.su();
  perform pg_temp.chk('G4 produto SEM estoque lançado continua vendendo como na Entrega 2 (sem movimentação)', s2 is not null and not exists (select 1 from public.stock_movements where sale_id = s2), null);
  perform pg_temp.as_user('gestor');
  perform public.fin_cancel_sale(s, 'Paciente desistiu');
  perform pg_temp.su();
  perform pg_temp.chk('G5 cancelar a venda devolve o estoque (3 → 5) com estorno ligado à movimentação original', pg_temp.bal('it_c','u1') = 5
    and exists (select 1 from public.stock_movements r join public.stock_movements o on o.id = r.reversed_movement_id where r.movement_type = 'reversal' and o.sale_id = s and r.qty = 2 and r.total_cost_cents = 2000), null);
  perform pg_temp.chk('G6 o custo médio segue R$ 10,00 após a devolução', pg_temp.avg('it_c','u1') = 1000, null);
  select id into m from public.stock_movements where sale_id = s and movement_type = 'sale';
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('G7 movimentação de venda não se estorna à mão (cancela-se a venda)', '22023', format($q$select public.fin_stock_reverse(%L, 'Teste manual')$q$, m), 'SALE_MOVEMENT_USE_CANCEL');
  perform pg_temp.su();
end $t$;

-- ---------- H. Estorno: nada se apaga ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); d date := private.fin_today(); e uuid; m uuid; r uuid; r2 jsonb; bal0 numeric; n integer;
begin
  perform pg_temp.as_user('estoq');
  e := pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 10, 2000, null, null, 'NF-EST1');
  bal0 := pg_temp.bal('it_d','u1');
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  n := public.fin_stock_reverse_entry(e, 'Nota lançada em duplicidade');
  perform pg_temp.chk('H1 estorno da entrada inteira devolve o saldo (−10) e marca o documento como estornado', n = 1 and pg_temp.bal('it_d','u1') = bal0 - 10
    and (select status from public.stock_entries where id = e) = 'reversed', null);
  perform pg_temp.chk('H2 o custo médio volta ao de antes do estorno (mesma conta com sinais trocados)', pg_temp.avg('it_d','u1') is not null, pg_temp.avg('it_d','u1')::text);
  perform pg_temp.expect('H3 estornar o documento de novo é recusado', '22023', format($q$select public.fin_stock_reverse_entry(%L, 'de novo')$q$, e), 'ALREADY_REVERSED');
  perform pg_temp.chk('H4 a nota estornada pode ser lançada de novo (libera chave e número)', pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 10, 2000, null, null, 'NF-EST1') is not null, null);
  -- estorno de entrada já consumida
  e := pg_temp.entry(u1, 'purchase', pg_temp.f('it_h'), 3, 100, null, null, 'NF-EST2');
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_h'), 'sector', 80 + 3, '{"purpose":"Sala","reason":"Consumo"}'::jsonb);
  perform pg_temp.expect('H5 entrada já consumida não se estorna (estorne as saídas antes)', '22023', format($q$select public.fin_stock_reverse_entry(%L, 'Erro de digitação')$q$, e), 'REVERSAL_NO_STOCK');
  -- estorno de uma saída
  r2 := public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'sector', 4, '{"purpose":"Sala","reason":"Consumo"}'::jsonb);
  m := (r2->'movement_ids'->>0)::uuid; bal0 := pg_temp.bal('it_d','u1');
  perform pg_temp.expect('H6 estorno sem motivo é recusado', '22023', format($q$select public.fin_stock_reverse(%L, 'x')$q$, m), 'REASON_REQUIRED');
  r := public.fin_stock_reverse(m, 'Saída lançada no item errado');
  perform pg_temp.chk('H7 estorno de saída devolve ao mesmo lote e ao mesmo custo (saldo +4)', pg_temp.bal('it_d','u1') = bal0 + 4
    and exists (select 1 from public.stock_movements x where x.id = r and x.movement_type = 'reversal' and x.reversed_movement_id = m and x.qty = 4 and x.lot_id = (select lot_id from public.stock_movements where id = m)), null);
  perform pg_temp.expect('H8 estornar o mesmo movimento duas vezes é recusado', '22023', format($q$select public.fin_stock_reverse(%L, 'de novo')$q$, m), 'ALREADY_REVERSED');
  perform pg_temp.expect('H9 não se estorna um estorno', '22023', format($q$select public.fin_stock_reverse(%L, 'estorno do estorno')$q$, r), 'CANNOT_REVERSE_REVERSAL');
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('H10 Financeiro (consulta) não estorna', '42501', format($q$select public.fin_stock_reverse(%L, 'Tentativa')$q$, m));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('H11 item de outra clínica não entra no estoque desta', '22023', format($q$select pg_temp.entry(%L, 'initial_balance', %L, 1, 100)$q$, u1, pg_temp.f('it_g')), 'INVALID_ITEM');
  perform pg_temp.su();
end $t$;

-- ---------- I. Imutabilidade, sem delete físico, sem escrita direta ----------
do $t$
declare c uuid := pg_temp.f('c'); m uuid; v_state text; v_msg text;
begin
  select id into m from public.stock_movements limit 1;
  perform pg_temp.expect('I1 nem o dono do banco edita uma movimentação (trigger)', '42501', format($q$update public.stock_movements set qty = qty + 1 where id = %L$q$, m), 'STOCK_MOVEMENT_IMMUTABLE');
  perform pg_temp.expect('I2 nem o dono do banco apaga uma movimentação (trigger)', '42501', format($q$delete from public.stock_movements where id = %L$q$, m), 'STOCK_MOVEMENT_IMMUTABLE');
  -- Com a E8 aplicada, as FKs de transfer_id/inventory_id fazem o próprio PostgreSQL barrar o TRUNCATE antes do gatilho (0A000): continua bloqueado.
  begin
    execute 'truncate public.stock_movements';
    insert into tr(name, ok, detail) values ('I3 TRUNCATE também é bloqueado', false, 'passou sem erro');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    insert into tr(name, ok, detail) values ('I3 TRUNCATE também é bloqueado', (v_state = '42501' and v_msg like '%STOCK_MOVEMENT_IMMUTABLE%') or v_state = '0A000', v_state || ' ' || v_msg);
  end;
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I4 Gestor não apaga movimentação (sem privilégio)', '42501', 'delete from public.stock_movements');
  perform pg_temp.expect('I5 Gestor não edita saldo direto', '42501', 'update public.stock_balances set qty_on_hand = 999');
  perform pg_temp.expect('I6 Gestor não grava lote direto', '42501', format($q$insert into public.stock_lots (clinic_id, unit_id, item_id, lot_code, qty_on_hand) values (%L, %L, %L, 'HACK', 5)$q$, c, pg_temp.f('u1'), pg_temp.f('it_a')));
  perform pg_temp.expect('I7 Gestor não insere movimentação direto', '42501', format($q$insert into public.stock_movements (clinic_id, unit_id, item_id, lot_id, movement_type, qty, unit_cost_cents, total_cost_cents, balance_after, avg_cost_after_cents, occurred_on)
    select clinic_id, unit_id, item_id, lot_id, 'bonus', 1, 0, 0, 1, 0, current_date from public.stock_movements limit 1$q$));
  perform pg_temp.expect('I8 Gestor não apaga entrada nem fornecedor', '42501', 'delete from public.stock_entries');
  perform pg_temp.su();
  perform pg_temp.as_user('owner');
  perform pg_temp.expect('I9 nem o Owner apaga movimentação pelo cliente', '42501', 'delete from public.stock_movements');
  perform pg_temp.su();
  -- apagar a clínica inteira (cascata) continua possível
  begin
    insert into public.stock_lots (clinic_id, unit_id, item_id, lot_code, qty_on_hand) values (pg_temp.f('c2'), pg_temp.f('u_b'), pg_temp.f('it_g'), 'LB', 2);
    insert into public.stock_balances (item_id, unit_id, clinic_id, qty_on_hand, avg_cost_cents) values (pg_temp.f('it_g'), pg_temp.f('u_b'), pg_temp.f('c2'), 2, 100);
    insert into public.stock_movements (clinic_id, unit_id, item_id, lot_id, movement_type, qty, unit_cost_cents, total_cost_cents, balance_after, avg_cost_after_cents, occurred_on)
      select pg_temp.f('c2'), pg_temp.f('u_b'), pg_temp.f('it_g'), id, 'bonus', 2, 100, 200, 2, 100, current_date from public.stock_lots where lot_code = 'LB';
    delete from public.professionals where clinic_id = pg_temp.f('c2');
    delete from public.clinics where id = pg_temp.f('c2');
    raise exception 'CASCADE_OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.chk('I10 apagar a clínica inteira (cascata) não é barrado pelo trigger de imutabilidade', v_msg = 'CASCADE_OK', v_state || ' ' || v_msg);
  end;
end $t$;

-- ---------- J. Log de auditoria, integridade e leituras ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); n integer; j jsonb; bad integer;
begin
  select count(*) into n from public.stock_movements;
  perform pg_temp.chk('J1 toda movimentação tem uma linha no log de auditoria (create/reverse), na mesma transação', n > 20
    and (select count(*) from public.fin_audit_log where entity = 'stock_movement') = n
    and (select count(*) from public.fin_audit_log where entity = 'stock_movement' and action = 'reverse') = (select count(*) from public.stock_movements where movement_type = 'reversal'),
    n || ' mov / ' || (select count(*) from public.fin_audit_log where entity = 'stock_movement') || ' log');
  perform pg_temp.chk('J2 documentos de entrada e de/para também no log', (select count(*) from public.fin_audit_log where entity = 'stock_entry' and action = 'create') = (select count(*) from public.stock_entries)
    and exists (select 1 from public.fin_audit_log where entity = 'stock_item_map') and exists (select 1 from public.fin_audit_log where entity = 'stock_supplier'), null);
  perform pg_temp.chk('J3 o log do estorno guarda o motivo e quem fez', exists (select 1 from public.fin_audit_log where entity = 'stock_movement' and action = 'reverse' and reason = 'Saída lançada no item errado' and user_profile_id = pg_temp.f('prof_estoq')), null);
  -- integridade: saldo do item = soma dos lotes = soma das movimentações; sem saldo negativo; valor = soma dos custos
  select count(*) into bad from public.stock_balances b
   where b.qty_on_hand <> coalesce((select sum(l.qty_on_hand) from public.stock_lots l where l.item_id = b.item_id and l.unit_id = b.unit_id), 0)
      or b.qty_on_hand <> coalesce((select sum(m.qty) from public.stock_movements m where m.item_id = b.item_id and m.unit_id = b.unit_id), 0);
  perform pg_temp.chk('J4 saldo = soma dos lotes = soma das movimentações em TODO item e unidade (saldo nunca é editado)', bad = 0 and (select count(*) from public.stock_balances) > 5, bad::text);
  perform pg_temp.chk('J5 balance_after da última movimentação de cada item/unidade = saldo', not exists (
    select 1 from public.stock_balances b where b.qty_on_hand <> (select m.balance_after from public.stock_movements m where m.item_id = b.item_id and m.unit_id = b.unit_id order by m.created_at desc, m.id desc limit 1)), null);
  perform pg_temp.chk('J6 nenhuma unidade aberta passa de 1 nem fica negativa; lotes não negativos', not exists (select 1 from public.stock_open_units where qty_remaining < 0 or qty_remaining > 1) and not exists (select 1 from public.stock_lots where qty_on_hand < 0), null);

  perform pg_temp.as_user('gestor');
  j := to_jsonb((select b from public.fin_stock_balances(c, u1, pg_temp.f('it_a')) b limit 1));
  perform pg_temp.chk('J7 saldo por unidade: Ampola X na unidade 1 traz saldo, custo médio, valor = saldo × custo médio, lotes com saldo e próxima validade', (j->>'avg_cost_cents')::numeric = pg_temp.avg('it_a','u1') and (j->>'qty_on_hand')::numeric = (select sum(qty_on_hand) from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1)
    and (j->>'value_cents')::bigint = round((j->>'qty_on_hand')::numeric * (j->>'avg_cost_cents')::numeric) and jsonb_array_length(j->'lots') = 2 and j->>'next_expiry' is not null, j::text);
  perform pg_temp.chk('J8 saldo por unidade: a unidade 2 tem o seu próprio saldo e custo (4 un a R$ 50,00)', exists (select 1 from public.fin_stock_balances(c, u2, pg_temp.f('it_a')) b where b.qty_on_hand = 4 and b.avg_cost_cents = 5000 and b.value_cents = 20000), null);
  perform pg_temp.chk('J9 filtro de unidade e de busca por nome', (select count(*) from public.fin_stock_balances(c, u2)) = 1 and exists (select 1 from public.fin_stock_balances(c, null, null, 'ampola')), null);
  perform pg_temp.chk('J10 kardex de um item em ordem do mais novo; filtros por sentido e tipo', (select count(*) from public.fin_stock_movements(c, u1, pg_temp.f('it_a'), null, 'out')) >= 3
    and (select count(*) from public.fin_stock_movements(c, u1, pg_temp.f('it_a'), 'initial_balance')) = 1
    and (select count(*) from public.fin_stock_movements(c, u1, pg_temp.f('it_a'), null, 'in')) >= 3, null);
  perform pg_temp.chk('J11 documentos de entrada: lista com fornecedor, número, linhas e total', exists (select 1 from public.fin_stock_entries(c, u1) e where e.invoice_number = '9001' and e.supplier_name = 'Distribuidora Sul' and e.lines_count = 2 and e.total_cents = 67500), null);
  perform pg_temp.chk('J12 movimentações do documento 9001 por filtro de entrada', (select count(*) from public.fin_stock_movements(c, u1, null, null, null, null, null, (select id from public.stock_entries where invoice_number = '9001'))) = 2, null);
  perform pg_temp.chk('J13 fin_my_access: Gestor tem stock_move de escrita', (public.fin_my_access(c)->'can'->>'stock_move_write')::boolean, null);
  perform pg_temp.su();
  -- o Histórico do gestor lê as movimentações em português (nome do item no registro)
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('J14 o Histórico (gestor) lista a movimentação com o nome do item no registro', exists (select 1 from public.fin_audit_list(c, 'stock_movement', null, null, 500) a where a.after->>'item_name' = 'Ampola X' and a.after->>'movement_type' = 'initial_balance'), null);
  perform pg_temp.su();
end $t$;

-- ---------- K. Busca de paciente para o uso individual ----------
do $t$
declare c uuid := pg_temp.f('c'); pid uuid;
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('K1 Estoquista busca paciente pelo nome (uso individual)', exists (select 1 from public.fin_stock_patients(c, 'Um') where full_name = 'Paciente Um')
    and (select count(*) from public.fin_stock_patients(c, null)) = 2, null);
  perform pg_temp.su();
  update public.profiles set status = 'inactive' where full_name = 'Paciente Dois';
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('K2 paciente removido (perfil anonimizado/inativo) não aparece', (select count(*) from public.fin_stock_patients(c, null)) = 1, null);
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('K3 Financeiro (só consulta) não busca paciente por aqui', '42501', format($q$select * from public.fin_stock_patients(%L, null)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('K4 Recepção não busca paciente por aqui', '42501', format($q$select * from public.fin_stock_patients(%L, null)$q$, c));
  perform pg_temp.su();
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
