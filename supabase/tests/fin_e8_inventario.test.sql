-- Prova SQL da FIN-E8 (inventário cego, transferências, alertas e relatórios de estoque) num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e8-sql-proof.sh  (cria o cluster/banco, aplica stub + E1..E8, roda este arquivo e apaga tudo).
-- Roda dentro de begin ... rollback; a última consulta lista as asserções (ok=false = falha). Datas relativas a hoje (private.fin_today()).
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
create function pg_temp.entry(p_unit uuid, p_type text, p_item uuid, p_qty numeric, p_cost_each numeric, p_lot text default null, p_exp date default null,
                              p_inv text default null, p_extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
begin
  return public.fin_stock_entry(pg_temp.f('c'), p_unit,
    jsonb_build_object('entry_type', p_type, 'invoice_number', p_inv, 'supplier_new', jsonb_build_object('name', 'Fornecedor Padrão')) || p_extra,
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'unit_cost_cents', p_cost_each, 'lot_code', p_lot, 'expiry_date', p_exp)));
end $$;
create function pg_temp.bal(p_item text, p_unit text) returns numeric language sql as $$
  select coalesce((select qty_on_hand from public.stock_balances where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit)), 0) $$;
create function pg_temp.avg(p_item text, p_unit text) returns numeric language sql as $$
  select avg_cost_cents from public.stock_balances where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit) $$;
create function pg_temp.lotq(p_item text, p_unit text, p_lot text) returns numeric language sql as $$
  select coalesce((select qty_on_hand from public.stock_lots where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit) and lot_code = p_lot), 0) $$;
-- invariante: saldo = soma das movimentações = soma dos lotes; lote = soma das movimentações do lote
create function pg_temp.inv_ok() returns boolean language sql as $$
  select not exists (select 1 from public.stock_balances b where b.qty_on_hand <> coalesce((select sum(m.qty) from public.stock_movements m where m.item_id = b.item_id and m.unit_id = b.unit_id), 0))
     and not exists (select 1 from public.stock_balances b where b.qty_on_hand <> coalesce((select sum(l.qty_on_hand) from public.stock_lots l where l.item_id = b.item_id and l.unit_id = b.unit_id), 0))
     and not exists (select 1 from public.stock_lots l where l.qty_on_hand <> coalesce((select sum(m.qty) from public.stock_movements m where m.lot_id = l.id), 0)) $$;
-- recebe tudo (ou a quantidade p_qty em cada linha) da transferência
create function pg_temp.recv_lines(p_transfer uuid, p_qty numeric default null, p_reason text default null) returns jsonb language sql as $$
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('line_id', l.id, 'quantity', coalesce(p_qty, l.qty_sent), 'reason', p_reason)) order by l.id) from public.stock_transfer_lines l where l.transfer_id = p_transfer $$;
create function pg_temp.send(p_from text, p_to text, p_item text, p_qty numeric, p_lot uuid default null) returns uuid language sql as $$
  select public.fin_stock_transfer_send(pg_temp.f('c'), pg_temp.f(p_from), pg_temp.f(p_to),
    jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('item_id', pg_temp.f(p_item), 'quantity', p_qty, 'lot_id', p_lot))), null) $$;
-- linhas do inventário por item (como o chamador atual enxerga)
create function pg_temp.ilines(p_inv uuid) returns jsonb language sql as $$ select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.fin_inventory_lines(p_inv) x $$;
create function pg_temp.iline(p_inv uuid, p_item text, p_lot text default null) returns uuid language sql as $$
  select l.id from public.fin_inventory_lines(p_inv) l where l.item_id = pg_temp.f(p_item) and (p_lot is null or l.lot_code = p_lot) order by l.lot_code limit 1 $$;
create function pg_temp.icount(p_inv uuid, p_item text, p_qty numeric, p_lot text default null) returns integer language sql as $$
  select public.fin_inventory_count(p_inv, jsonb_build_array(jsonb_build_object('line_id', pg_temp.iline(p_inv, p_item, p_lot), 'counted_qty', p_qty))) $$;
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text),
  pg_temp.entry(uuid, text, uuid, numeric, numeric, text, date, text, jsonb), pg_temp.bal(text, text), pg_temp.avg(text, text), pg_temp.lotq(text, text, text), pg_temp.inv_ok(),
  pg_temp.recv_lines(uuid, numeric, text), pg_temp.send(text, text, text, numeric, uuid), pg_temp.ilines(uuid), pg_temp.iline(uuid, text, text), pg_temp.icount(uuid, text, numeric, text) to public;

-- ---------- Fixture ----------
do $t$
declare
  c uuid; c2 uuid; u1 uuid; u2 uuid; k text; pid uuid; pro uuid; v_id uuid; v_pat uuid;
begin
  foreach k in array array['owner','gestor','gestor2','fin','recep','pro','estoq','estoq1','other'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','gestor','gestor2','fin','recep','pro','estoq','estoq1'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end) returning id into pro;
    insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_other'), c2, 'admin');
  select id into u1 from public.clinic_units where clinic_id = c and is_primary;
  insert into public.clinic_units (clinic_id, name) values (c, 'Unidade 2') returning id into u2;
  insert into fx values ('u1', u1), ('u2', u2);
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values
    (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_fin'), 'financeiro'), (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_estoq'), 'estoquista');
  insert into public.clinic_staff_roles (clinic_id, professional_id, role, all_units, unit_ids) values
    (c, pg_temp.f('pro_estoq1'), 'estoquista', false, array[u1]), (c, pg_temp.f('pro_gestor2'), 'gestor', false, array[u2]);
  insert into public.profiles (full_name) values ('Paciente Um') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat; insert into fx values ('pat', v_pat);

  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c, 'Ampola X', 'amp', 'medication', 'caixa', 'ampola', 'ampola', true) returning id into v_id; insert into fx values ('it_a', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control, fractional, opened_validity_days, individual_use)
    values (c, 'Caneta multidose', 'caneta', 'medication', 'un', 'caneta', 'dose', true, true, 28, true) returning id into v_id; insert into fx values ('it_b', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents) values (c, 'Suplemento C', 'sup', 'resale', 'un', 'un', 'un', true, 18000) returning id into v_id; insert into fx values ('it_c', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Seringa D', 'mat', 'consumable', 'cx', 'un', 'un') returning id into v_id; insert into fx values ('it_d', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c, 'Soro E', 'amp', 'medication', 'un', 'un', 'un', true) returning id into v_id; insert into fx values ('it_e', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Luva H', 'mat', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_h', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Item parado P', 'mat', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_p', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c2, 'Item B1', 'x', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_g', v_id);
end $t$;

-- ---------- 0. Saldos iniciais (como Owner) ----------
do $t$
declare d date := private.fin_today();
begin
  perform pg_temp.as_user('owner');
  perform pg_temp.entry(pg_temp.f('u1'), 'initial_balance', pg_temp.f('it_a'), 10, 4000, 'L1', d + 40);
  perform pg_temp.entry(pg_temp.f('u1'), 'initial_balance', pg_temp.f('it_d'), 20, 100);
  perform pg_temp.entry(pg_temp.f('u1'), 'initial_balance', pg_temp.f('it_c'), 5, 8000);
  perform pg_temp.entry(pg_temp.f('u2'), 'initial_balance', pg_temp.f('it_a'), 4, 5000, 'L9', d + 90);
  perform pg_temp.su();
  perform pg_temp.chk('S0 fixture: saldos iniciais e invariante', pg_temp.bal('it_a','u1') = 10 and pg_temp.bal('it_a','u2') = 4 and pg_temp.inv_ok(), null);
end $t$;

-- ---------- M. Matriz de acesso (fin_my_access) ----------
do $t$
declare c uuid := pg_temp.f('c'); j jsonb;
begin
  perform pg_temp.as_user('gestor'); j := public.fin_my_access(c);
  perform pg_temp.chk('M1 Gestor: inv_manage lê e escreve', (j->'can'->>'inv_manage_read')::boolean and (j->'can'->>'inv_manage_write')::boolean, j->'can'->>'inv_manage_write');
  perform pg_temp.su();
  perform pg_temp.as_user('fin'); j := public.fin_my_access(c);
  perform pg_temp.chk('M2 Financeiro: inv_manage só lê', (j->'can'->>'inv_manage_read')::boolean and not (j->'can'->>'inv_manage_write')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('estoq'); j := public.fin_my_access(c);
  perform pg_temp.chk('M3 Estoquista: sem inv_manage, mas movimenta (conta, transfere, recebe)', not (j->'can'->>'inv_manage_read')::boolean and (j->'can'->>'stock_move_write')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep'); j := public.fin_my_access(c);
  perform pg_temp.chk('M4 Recepção: nada de estoque nem inventário', not (j->'can'->>'inv_manage_read')::boolean and not (j->'can'->>'stock_move_read')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('owner'); j := public.fin_my_access(c);
  perform pg_temp.chk('M5 Owner/Admin: tudo', (j->'can'->>'inv_manage_write')::boolean, null);
  perform pg_temp.chk('M6 áreas antigas preservadas (dash, close_pay, stock_move)', (j->'can'->>'dash_read')::boolean and (j->'can'->>'close_pay_write')::boolean and (j->'can'->>'stock_move_write')::boolean, null);
  perform pg_temp.su();
end $t$;

-- ---------- T. Transferência entre unidades ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); t1 uuid; r jsonb; n integer; l public.stock_transfer_lines; v_avg2 numeric;
begin
  -- T1: E6 do escopo — 10 un enviadas, 9 recebidas
  perform pg_temp.as_user('estoq');
  t1 := pg_temp.send('u1', 'u2', 'it_a', 10);
  perform pg_temp.su();
  insert into fx values ('t1', t1);
  perform pg_temp.chk('T1 enviar: sai da origem e fica EM TRÂNSITO (fora do saldo das duas unidades)',
    pg_temp.bal('it_a','u1') = 0 and pg_temp.bal('it_a','u2') = 4 and (select status from public.stock_transfers where id = t1) = 'in_transit' and pg_temp.inv_ok(), null);
  perform pg_temp.chk('T2 custo médio da origem preservado no envio (R$ 40,00) e linha guarda o custo',
    pg_temp.avg('it_a','u1') = 4000 and (select total_cost_cents from public.stock_transfer_lines where transfer_id = t1) = 40000 and (select unit_cost_cents from public.stock_transfer_lines where transfer_id = t1) = 4000, null);
  perform pg_temp.chk('T3 movimentação transfer_out ligada à transferência (qty −10, R$ −400,00)',
    exists (select 1 from public.stock_movements m where m.transfer_id = t1 and m.movement_type = 'transfer_out' and m.qty = -10 and m.total_cost_cents = -40000 and m.unit_id = u1), null);
  perform pg_temp.chk('T4 numeração por clínica começa em 1', (select number from public.stock_transfers where id = t1) = 1, null);

  perform pg_temp.as_user('estoq1');
  perform pg_temp.expect('T5 Estoquista só da unidade 1 NÃO recebe na unidade 2', '42501', format($q$select public.fin_stock_transfer_receive(%L, pg_temp.recv_lines(%L, null, 'x'))$q$, t1, t1));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('T6 receber sem conferir TODAS as linhas é recusado', '22023', format($q$select public.fin_stock_transfer_receive(%L, '[]'::jsonb)$q$, t1), 'ALL_LINES_REQUIRED');
  perform pg_temp.expect('T7 quantidade a menos sem motivo é recusada', '22023', format($q$select public.fin_stock_transfer_receive(%L, pg_temp.recv_lines(%L, 9, null))$q$, t1, t1), 'DIVERGENCE_REASON_REQUIRED');
  perform pg_temp.expect('T8 recebido acima do enviado é recusado', '22023', format($q$select public.fin_stock_transfer_receive(%L, pg_temp.recv_lines(%L, 11, 'x'))$q$, t1, t1), 'INVALID_QUANTITY');
  r := public.fin_stock_transfer_receive(t1, pg_temp.recv_lines(t1, 9, 'Uma ampola quebrada no transporte'));
  perform pg_temp.su();
  perform pg_temp.chk('T9 E6: destino +9 (4+9=13)', pg_temp.bal('it_a','u2') = 13 and pg_temp.lotq('it_a','u2','L1') = 9 and pg_temp.lotq('it_a','u2','L9') = 4, pg_temp.bal('it_a','u2')::text);
  v_avg2 := round((4 * 5000 + 9 * 4000)::numeric / 13, 4);
  perform pg_temp.chk('T10 custo médio do destino recalculado com o custo da origem ((4×50 + 9×40) ÷ 13 = R$ 43,0769)', pg_temp.avg('it_a','u2') = v_avg2, pg_temp.avg('it_a','u2')::text || ' x ' || v_avg2);
  perform pg_temp.chk('T11 E6: origem registra a PERDA de 1 un (R$ 40,00) com motivo; origem não muda de saldo/custo',
    (select loss_qty from public.stock_transfer_lines where transfer_id = t1) = 1 and (select loss_cents from public.stock_transfer_lines where transfer_id = t1) = 4000
    and (select receive_reason from public.stock_transfer_lines where transfer_id = t1) like 'Uma ampola%' and pg_temp.bal('it_a','u1') = 0 and pg_temp.avg('it_a','u1') = 4000, r::text);
  perform pg_temp.chk('T12 enviado = recebido + perda (R$ 400,00 = 360,00 + 40,00) no retorno', (r->>'received_cents')::bigint = 36000 and (r->>'loss_cents')::bigint = 4000, r::text);
  perform pg_temp.chk('T13 movimentação transfer_in no destino (+9, R$ 360,00) ligada à transferência',
    exists (select 1 from public.stock_movements m where m.transfer_id = t1 and m.movement_type = 'transfer_in' and m.qty = 9 and m.total_cost_cents = 36000 and m.unit_id = u2), null);
  perform pg_temp.chk('T14 invariante: saldo = soma das movimentações = soma dos lotes', pg_temp.inv_ok(), null);
  perform pg_temp.chk('T15 a perda fica no log (stock_transfer_loss) com motivo e valor',
    exists (select 1 from public.fin_audit_log a where a.entity = 'stock_transfer_loss' and (a.after->>'loss_cents')::bigint = 4000 and a.reason like 'Uma ampola%'), null);
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('T16 receber duas vezes é recusado', '22023', format($q$select public.fin_stock_transfer_receive(%L, pg_temp.recv_lines(%L, 9, 'x'))$q$, t1, t1), 'NOT_IN_TRANSIT');
  perform pg_temp.expect('T17 cancelar depois de recebida é recusado', '22023', format($q$select public.fin_stock_transfer_cancel(%L, 'motivo')$q$, t1), 'NOT_IN_TRANSIT');
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); t2 uuid; t3 uuid; d date := private.fin_today(); avg_before numeric;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 6, 5000, 'L2', d + 10, 'NF-1');   -- u1: L2 6 un a R$ 50,00 (custo médio 50)
  perform pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_e'), 3, 2000, 'E1', d + 5);
  perform pg_temp.su();
  -- T20: cancelar antes de receber devolve à origem
  avg_before := pg_temp.avg('it_a','u1');
  perform pg_temp.as_user('estoq1');
  t2 := pg_temp.send('u1', 'u2', 'it_a', 4);
  perform pg_temp.su();
  perform pg_temp.chk('T20 segunda transferência: origem 6→2, em trânsito', pg_temp.bal('it_a','u1') = 2 and pg_temp.lotq('it_a','u1','L2') = 2 and (select number from public.stock_transfers where id = t2) = 2, null);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('T21 Financeiro (só consulta) não cancela', '42501', format($q$select public.fin_stock_transfer_cancel(%L, 'motivo')$q$, t2));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.expect('T22 cancelar exige motivo', '22023', format($q$select public.fin_stock_transfer_cancel(%L, '')$q$, t2), 'REASON_REQUIRED');
  perform public.fin_stock_transfer_cancel(t2, 'Enviada para a unidade errada');
  perform pg_temp.su();
  perform pg_temp.chk('T23 cancelar: devolve à origem por estorno (6 de novo), custo médio igual, destino intocado',
    pg_temp.bal('it_a','u1') = 6 and pg_temp.lotq('it_a','u1','L2') = 6 and pg_temp.avg('it_a','u1') = avg_before and pg_temp.bal('it_a','u2') = 13
    and (select status from public.stock_transfers where id = t2) = 'canceled' and pg_temp.inv_ok(), pg_temp.avg('it_a','u1')::text);
  perform pg_temp.chk('T24 o estorno fica ligado à transferência e à saída original',
    exists (select 1 from public.stock_movements r join public.stock_movements o on o.id = r.reversed_movement_id where r.transfer_id = t2 and r.movement_type = 'reversal' and o.movement_type = 'transfer_out'), null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('T25 receber transferência cancelada é recusado', '22023', format($q$select public.fin_stock_transfer_receive(%L, pg_temp.recv_lines(%L, 4, 'x'))$q$, t2, t2), 'NOT_IN_TRANSIT');
  perform pg_temp.su();
  -- T30..: validações do envio
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('T30 mesma unidade é recusada', '22023', format($q$select pg_temp.send('u1', 'u1', 'it_a', 1)$q$), 'SAME_UNIT');
  perform pg_temp.expect('T31 só unidades inteiras', '22023', format($q$select pg_temp.send('u1', 'u2', 'it_a', 1.5)$q$), 'INVALID_QUANTITY');
  perform pg_temp.expect('T32 saldo insuficiente é recusado', '22023', format($q$select pg_temp.send('u1', 'u2', 'it_a', 99)$q$), 'INSUFFICIENT_STOCK');
  perform pg_temp.expect('T33 item de outra clínica é recusado', '22023', format($q$select public.fin_stock_transfer_send(%L, %L, %L, jsonb_build_array(jsonb_build_object('item_id', %L, 'quantity', 1)), null)$q$, c, u1, u2, pg_temp.f('it_g')), 'INVALID_ITEM');
  perform pg_temp.expect('T34 sem linhas é recusado', '22023', format($q$select public.fin_stock_transfer_send(%L, %L, %L, '[]'::jsonb, null)$q$, c, u1, u2), 'LINES_REQUIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.expect('T35 Estoquista só da unidade 1 NÃO envia da unidade 2', '42501', format($q$select pg_temp.send('u2', 'u1', 'it_a', 1)$q$));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('T36 Recepção não envia', '42501', format($q$select pg_temp.send('u1', 'u2', 'it_a', 1)$q$));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('T37 Profissional não envia', '42501', format($q$select pg_temp.send('u1', 'u2', 'it_a', 1)$q$));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('T38 Financeiro não envia', '42501', format($q$select pg_temp.send('u1', 'u2', 'it_a', 1)$q$));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('T39 Admin de OUTRA clínica não envia aqui', '42501', format($q$select pg_temp.send('u1', 'u2', 'it_a', 1)$q$));
  perform pg_temp.su();
  -- T40: lote vencido não vai; lote escolhido; FEFO entre lotes
  update public.stock_lots set expiry_date = d - 1 where item_id = pg_temp.f('it_e') and unit_id = u1;
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('T40 lote vencido não é transferido (só some como perda)', '22023', format($q$select pg_temp.send('u1', 'u2', 'it_e', 1)$q$), 'LOT_EXPIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 5, 6000, 'L3', d + 200, 'NF-2');   -- u1: L2 (6, vence antes) + L3 (5); custo médio (6×50 + 5×60)/11
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  t3 := pg_temp.send('u1', 'u2', 'it_a', 8);
  perform pg_temp.su();
  perform pg_temp.chk('T41 sem lote escolhido, sai primeiro o que vence primeiro (FEFO): 6 de L2 e 2 de L3, duas linhas',
    (select count(*) from public.stock_transfer_lines where transfer_id = t3) = 2 and (select qty_sent from public.stock_transfer_lines where transfer_id = t3 and lot_code = 'L2') = 6
    and (select qty_sent from public.stock_transfer_lines where transfer_id = t3 and lot_code = 'L3') = 2 and pg_temp.inv_ok(), null);
  perform pg_temp.chk('T42 as duas linhas saem ao custo médio da origem naquele momento (R$ 54,5455 × 8)',
    (select sum(total_cost_cents) from public.stock_transfer_lines where transfer_id = t3) = (select -sum(total_cost_cents) from public.stock_movements where transfer_id = t3 and movement_type = 'transfer_out'), null);
  insert into fx values ('t3', t3);
end $t$;

-- T50: conferência de lote no destino
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); t3 uuid := pg_temp.f('t3'); d date := private.fin_today(); lines jsonb; r jsonb;
begin
  select jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', l.qty_sent) order by l.lot_code) into lines from public.stock_transfer_lines l where l.transfer_id = t3;
  perform pg_temp.as_user('estoq');
  -- lote conferido com código diferente sem motivo
  perform pg_temp.expect('T50 lote diferente do enviado exige motivo', '22023', format($q$select public.fin_stock_transfer_receive(%L, (select jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', l.qty_sent, 'lot_code', 'XX') order by l.lot_code) from public.stock_transfer_lines l where l.transfer_id = %L))$q$, t3, t3), 'DIVERGENCE_REASON_REQUIRED');
  -- L9 já existe no destino com outra validade
  perform pg_temp.expect('T51 lote que já existe no destino com outra validade é recusado', '22023',
    format($q$select public.fin_stock_transfer_receive(%L, (select jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', l.qty_sent, 'lot_code', 'L9', 'expiry_date', %L, 'reason', 'etiqueta') order by l.lot_code) from public.stock_transfer_lines l where l.transfer_id = %L))$q$, t3, (d + 5)::text, t3), 'LOT_EXPIRY_MISMATCH');
  -- recebe a linha L2 como 4 (perde 2), L3 certo, e conta o lote com o MESMO código/validade
  r := public.fin_stock_transfer_receive(t3, (select jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', case when l.lot_code = 'L2' then 4 else l.qty_sent end, 'reason', case when l.lot_code = 'L2' then 'Dois frascos avariados' end) order by l.lot_code)
                                                from public.stock_transfer_lines l where l.transfer_id = t3));
  perform pg_temp.su();
  perform pg_temp.chk('T52 recebimento por linha: L2 chegou 4 de 6 (perda 2), L3 chegou 2 de 2', (r->>'loss_cents')::bigint = (select loss_cents from public.stock_transfer_lines where transfer_id = t3 and lot_code = 'L2')
    and (select loss_qty from public.stock_transfer_lines where transfer_id = t3 and lot_code = 'L3') = 0, r::text);
  perform pg_temp.chk('T53 destino ganhou os lotes L2 (4) e L3 (2) com as validades do envio', pg_temp.lotq('it_a','u2','L2') = 4 and pg_temp.lotq('it_a','u2','L3') = 2
    and (select expiry_date from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u2 and lot_code = 'L3') = d + 200 and pg_temp.inv_ok(), null);
  -- transferência trocando o código do lote (com motivo) e recebimento zero
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_h'), 6, 150);
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  insert into fx values ('t4', pg_temp.send('u1', 'u2', 'it_h', 6));
  r := public.fin_stock_transfer_receive(pg_temp.f('t4'), pg_temp.recv_lines(pg_temp.f('t4'), 0, 'Caixa extraviada pela transportadora'));
  perform pg_temp.su();
  perform pg_temp.chk('T54 recebimento ZERO: nenhuma entrada no destino; perda total (R$ 9,00) na origem', pg_temp.bal('it_h','u2') = 0 and (r->>'loss_cents')::bigint = 900 and (r->>'received_cents')::bigint = 0
    and not exists (select 1 from public.stock_movements where transfer_id = pg_temp.f('t4') and movement_type = 'transfer_in'), r::text);
  perform pg_temp.chk('T55 invariante depois das transferências', pg_temp.inv_ok(), null);
end $t$;

-- T60: imutabilidade, estorno manual e RLS
do $t$
declare c uuid := pg_temp.f('c'); t1 uuid := pg_temp.f('t1'); mv uuid; n integer;
begin
  select id into mv from public.stock_movements where transfer_id = t1 and movement_type = 'transfer_out';
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('T60 movimentação de transferência não se estorna à mão (use cancelar)', '22023', format($q$select public.fin_stock_reverse(%L, 'tentativa')$q$, mv), 'DOC_MOVEMENT_USE_FLOW');
  perform pg_temp.su();
  perform pg_temp.expect('T61 transferência concluída não se edita (nem pelo dono do banco)', '42501', format($q$update public.stock_transfers set notes = 'x' where id = %L$q$, t1));
  perform pg_temp.expect('T62 transferência não se apaga', '42501', format($q$delete from public.stock_transfers where id = %L$q$, t1));
  perform pg_temp.expect('T63 linha conferida não se edita', '42501', format($q$update public.stock_transfer_lines set loss_qty = 0 where transfer_id = %L$q$, t1));
  perform pg_temp.expect('T64 linha não se apaga', '42501', format($q$delete from public.stock_transfer_lines where transfer_id = %L$q$, t1));
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('T65 ninguém escreve direto pelas tabelas (gestor)', '42501', format($q$update public.stock_transfers set status = 'received' where id = %L$q$, pg_temp.f('t3')));
  perform pg_temp.su();
  -- RLS
  perform pg_temp.as_user('recep');
  select count(*) into n from public.stock_transfers; perform pg_temp.chk('T66 Recepção: transferências vazias por RLS', n = 0 and (select count(*) from public.stock_transfer_lines) = 0, null);
  perform pg_temp.expect('T67 Recepção não lista por RPC', '42501', format($q$select * from public.fin_stock_transfers(%L)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.chk('T68 Profissional: vazio', (select count(*) from public.stock_transfers) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.chk('T69 outra clínica: vazio e recusada por RPC', (select count(*) from public.stock_transfers) = 0, null);
  perform pg_temp.expect('T70 outra clínica não lista por RPC', '42501', format($q$select * from public.fin_stock_transfers(%L)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.chk('T71 Estoquista da unidade 1 vê as transferências que tocam a unidade 1 (origem)', (select count(*) from public.fin_stock_transfers(c)) = 4, (select count(*) from public.fin_stock_transfers(c))::text);
  perform pg_temp.chk('T72 ... com linhas, custo e perda', (select loss_cents from public.fin_stock_transfers(c) where number = 1) = 4000 and jsonb_array_length((select lines from public.fin_stock_transfers(c) where number = 1)) = 1, null);
  perform pg_temp.chk('T73 ... e sabe se pode receber (não pode: destino é a unidade 2)', not (select can_receive from public.fin_stock_transfers(c, null, null) limit 1), null);
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.chk('T74 Financeiro consulta as transferências com valores', (select sum(sent_cents) from public.fin_stock_transfers(c)) > 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor2');
  perform pg_temp.chk('T75 Gestor só da unidade 2 também vê (destino) e pode receber lá', (select count(*) from public.fin_stock_transfers(c)) = 4, null);
  perform pg_temp.su();
  perform pg_temp.chk('T76 log da transferência (criar, receber, cancelar)', (select count(*) from public.fin_audit_log where entity = 'stock_transfer') = 8, (select count(*) from public.fin_audit_log where entity = 'stock_transfer')::text);
end $t$;

-- T80: unidade aberta de dose fracionada reserva a fração: só unidades inteiras livres vão
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d date := private.fin_today(); tx uuid;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_b'), 3, 30000, 'C1', d + 120);
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_b'), 'appointment', 0.25, jsonb_build_object('patient_id', pg_temp.f('pat')));   -- abre 1 caneta (3 → 2,75)
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('T80 caneta aberta reserva a fração: 3 não saem (só 2 inteiras livres)', '22023', format($q$select pg_temp.send('u1', 'u2', 'it_b', 3)$q$), 'INSUFFICIENT_STOCK');
  tx := pg_temp.send('u1', 'u2', 'it_b', 2);
  perform pg_temp.su();
  perform pg_temp.chk('T81 duas canetas inteiras vão; sobra a aberta (0,75) na origem', pg_temp.bal('it_b','u1') = 0.75 and pg_temp.inv_ok(), pg_temp.bal('it_b','u1')::text);
end $t$;

-- ---------- I. Inventário cego ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); inv uuid; n integer; j jsonb; d date := private.fin_today();
begin
  -- estado do u1 antes: it_a: L2 0 (foi tudo), L3 3; vamos conferir e abrir
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('I1 Estoquista NÃO abre inventário', '42501', format($q$select public.fin_inventory_open(%L, %L, '{}'::jsonb)$q$, c, u1));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor2');
  perform pg_temp.expect('I2 Gestor só da unidade 2 NÃO abre na unidade 1', '42501', format($q$select public.fin_inventory_open(%L, %L, '{}'::jsonb)$q$, c, u1));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('I3 Financeiro NÃO abre', '42501', format($q$select public.fin_inventory_open(%L, %L, '{}'::jsonb)$q$, c, u1));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  inv := public.fin_inventory_open(c, u1, jsonb_build_object('name', 'Contagem de novembro'));
  perform pg_temp.su();
  insert into fx values ('inv1', inv);
  select count(*) into n from public.stock_inventory_lines where inventory_id = inv;
  perform pg_temp.chk('I4 abrir congela uma linha por item/lote com saldo da unidade', n = (select count(*) from public.stock_lots where unit_id = u1 and qty_on_hand > 0) and n >= 4, n::text);
  perform pg_temp.chk('I5 saldo esperado congelado = saldo do lote no momento', not exists (select 1 from public.stock_inventory_lines l join public.stock_lots s on s.id = l.lot_id where l.inventory_id = inv and l.expected_qty <> s.qty_on_hand), null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I6 só um inventário ativo por unidade', '22023', format($q$select public.fin_inventory_open(%L, %L, '{}'::jsonb)$q$, c, u1), 'INVENTORY_ALREADY_OPEN');
  perform pg_temp.su();
  -- E16: tela de contagem NÃO exibe o saldo esperado
  perform pg_temp.as_user('estoq');
  j := pg_temp.ilines(inv);
  perform pg_temp.chk('I10 E16: quem conta recebe as linhas SEM esperado, movimentado, diferença, custo nem valor',
    jsonb_array_length(j) = n and not exists (select 1 from jsonb_array_elements(j) e where e->>'expected_qty' is not null or e->>'moved_qty' is not null or e->>'diff_qty' is not null or e->>'avg_cost_cents' is not null or e->>'diff_value_cents' is not null), j::text);
  perform pg_temp.expect('I11 leitura direta da tabela de linhas é negada (guarda o esperado)', '42501', $q$select expected_qty from public.stock_inventory_lines$q$);
  perform pg_temp.chk('I12 a lista de inventários não traz diferença para quem conta', (select lines_with_difference is null and increase_cents is null and not can_review and can_count from public.fin_inventory_list(c, u1) limit 1), null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  j := pg_temp.ilines(inv);
  perform pg_temp.chk('I13 contagem cega vale também para o Gestor enquanto se conta', not exists (select 1 from jsonb_array_elements(j) e where e->>'expected_qty' is not null), null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('I14 Recepção não lê as linhas', '42501', format($q$select * from public.fin_inventory_lines(%L)$q$, inv));
  perform pg_temp.expect('I15 Recepção não lista inventários', '42501', format($q$select * from public.fin_inventory_list(%L)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('I16 outra clínica não lê as linhas', '42501', format($q$select * from public.fin_inventory_lines(%L)$q$, inv));
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); inv uuid := pg_temp.f('inv1'); j jsonb; n integer; d date := private.fin_today(); ln uuid; lc numeric;
begin
  -- movimentação DURANTE a contagem: seringa D tinha 20 (congelado); sai 1 durante a contagem
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'sector', 1, jsonb_build_object('reason', 'Uso na sala 2', 'purpose', 'Sala'));
  perform pg_temp.su();
  -- contagem física (E7): ampola L3: congelado 3; contou 1 (−2); seringa: congelado 20, saiu 1 durante; contou 17 → diferença = 17 − (20 − 1) = −2
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('I20 quantidade fracionada em item inteiro é recusada', '22023', format($q$select pg_temp.icount(%L, 'it_d', 3.5)$q$, inv), 'NOT_FRACTIONAL');
  perform pg_temp.expect('I21 quantidade negativa é recusada', '22023', format($q$select pg_temp.icount(%L, 'it_d', -1)$q$, inv), 'INVALID_QUANTITY');
  perform pg_temp.chk('I22 contar por item/lote', pg_temp.icount(inv, 'it_a', 1, 'L3') = 1 and pg_temp.icount(inv, 'it_d', 17) = 1 and pg_temp.icount(inv, 'it_c', 5) = 1, null);
  perform pg_temp.expect('I23 encerrar com linhas sem contar é recusado', '22023', format($q$select public.fin_inventory_finish(%L)$q$, inv), 'UNCOUNTED_LINES');
  perform pg_temp.su();
  perform pg_temp.chk('I24 contar não mexe no estoque', pg_temp.bal('it_a','u1') = 3 and pg_temp.bal('it_d','u1') = 19, null);
  -- achado fora da lista: item/lote que não estava congelado; lote novo exige validade
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('I25 lote novo de item com controle de lote exige validade', '22023', format($q$select public.fin_inventory_count(%L, jsonb_build_array(jsonb_build_object('item_id', %L, 'lot_code', 'NOVO1', 'counted_qty', 2)))$q$, inv, pg_temp.f('it_a')), 'LOT_REQUIRED');
  perform pg_temp.chk('I26 achar um lote que a lista não trazia (NOVO1, 2 un, vence em 200 dias)',
    public.fin_inventory_count(inv, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_a'), 'lot_code', 'NOVO1', 'expiry_date', (d + 200)::text, 'counted_qty', 2))) = 1, null);
  perform pg_temp.chk('I27 achar item sem saldo lançado (Luva H, lote único, 3 un)',
    public.fin_inventory_count(inv, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_h'), 'counted_qty', 3))) = 1, null);
  perform pg_temp.chk('I27b contar o resto: caneta aberta (0,75) e soro E1 (3)', pg_temp.icount(inv, 'it_b', 0.75) = 1 and pg_temp.icount(inv, 'it_e', 3) = 1, null);
  perform pg_temp.chk('I28 encerrar com tudo contado (o «zerar o que sobrou» fica para o inventário 4)', public.fin_inventory_finish(inv, true) = 4, null);
  perform pg_temp.su();
  perform pg_temp.chk('I28b o lote achado entra como linha extra, com esperado 0', exists (select 1 from public.stock_inventory_lines where inventory_id = inv and lot_code = 'NOVO1' and is_extra and expected_qty = 0), null);
  perform pg_temp.chk('I29 estado = revisão e instante do fim gravado', (select status from public.stock_inventories where id = inv) = 'review' and (select finished_at from public.stock_inventories where id = inv) > (select frozen_at from public.stock_inventories where id = inv), null);
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('I30 depois de encerrada, contar é recusado', '22023', format($q$select pg_temp.icount(%L, 'it_d', 10)$q$, inv), 'COUNT_CLOSED');
  j := pg_temp.ilines(inv);
  perform pg_temp.chk('I31 E16: na revisão o Estoquista continua SEM ver o esperado', not exists (select 1 from jsonb_array_elements(j) e where e->>'expected_qty' is not null or e->>'diff_qty' is not null), null);
  perform pg_temp.chk('I32 ... e a lista não traz diferença', (select lines_with_difference is null from public.fin_inventory_list(c, u1, null, inv)), null);
  perform pg_temp.expect('I33 Estoquista não aprova', '42501', format($q$select public.fin_inventory_approve(%L, 'ok')$q$, inv));
  perform pg_temp.expect('I34 Estoquista não reabre', '42501', format($q$select public.fin_inventory_reopen(%L, 'recontar')$q$, inv));
  perform pg_temp.expect('I35 Estoquista não cancela', '42501', format($q$select public.fin_inventory_cancel(%L, 'motivo')$q$, inv));
  perform pg_temp.su();
  -- gestor revisa
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('I40 Gestor vê esperado × contado × diferença × valor: ampola L3 esperado 3, contado 1, −2 (−R$ 80,00 a R$ 40,00?)',
    (select expected_qty = 3 and counted_qty = 1 and moved_qty = 0 and diff_qty = -2 from public.fin_inventory_lines(inv) where lot_code = 'L3' and item_id = pg_temp.f('it_a')), null);
  perform pg_temp.chk('I41 seringa: congelado 20, saiu 1 durante a contagem, contou 17 → diferença −2 (contra congelado + movimentado)',
    (select expected_qty = 20 and moved_qty = -1 and counted_qty = 17 and diff_qty = -2 and avg_cost_cents = 100 and diff_value_cents = -200 from public.fin_inventory_lines(inv) where item_id = pg_temp.f('it_d')), null);
  perform pg_temp.chk('I42 achado extra: lote NOVO1 esperado 0, contado 2, +2', (select expected_qty = 0 and diff_qty = 2 from public.fin_inventory_lines(inv) where lot_code = 'NOVO1'), null);
  perform pg_temp.chk('I43 sem diferença: suplemento C 5 = 5 (diferença 0)', (select diff_qty = 0 from public.fin_inventory_lines(inv) where item_id = pg_temp.f('it_c')), null);
  perform pg_temp.chk('I44 lista do gestor traz o resumo (linhas com diferença e valor líquido do que sobe e do que desce)', (select lines_with_difference >= 3 and decrease_cents < 0 and can_review from public.fin_inventory_list(c, u1, null, inv)), (select increase_cents::text || '/' || decrease_cents::text from public.fin_inventory_list(c, u1, null, inv)));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.chk('I45 Financeiro consulta a revisão (esperado × contado × valor), sem aprovar', exists (select 1 from public.fin_inventory_lines(inv) where expected_qty is not null and diff_value_cents is not null), null);
  perform pg_temp.expect('I46 Financeiro não aprova', '42501', format($q$select public.fin_inventory_approve(%L, 'ok')$q$, inv));
  perform pg_temp.su();
  -- nada mudou no estoque até aprovar
  perform pg_temp.chk('I47 até aprovar o estoque não muda (saldo da ampola 3, seringa 19)', pg_temp.bal('it_a','u1') = 3 and pg_temp.bal('it_d','u1') = 19 and not exists (select 1 from public.stock_movements where inventory_id = inv), null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I48 aprovar com diferença exige motivo', '22023', format($q$select public.fin_inventory_approve(%L, '')$q$, inv), 'REASON_REQUIRED');
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); inv uuid := pg_temp.f('inv1'); r jsonb; avg_a numeric;
begin
  avg_a := pg_temp.avg('it_a','u1');
  perform pg_temp.as_user('gestor');
  r := public.fin_inventory_approve(inv, 'Inventário de novembro conferido');
  perform pg_temp.su();
  perform pg_temp.chk('I50 aprovar lança os ajustes: ampola L3 −2, seringa −2, NOVO1 +2, luva +3 (4 ajustes; suplemento sem diferença)', (r->>'adjustments')::int = 4, r::text);
  perform pg_temp.chk('I51 E7: ajuste de −2 un valorado a custo médio vigente (ampola: −2 × custo médio)', (select total_cost_cents from public.stock_movements where inventory_id = inv and item_id = pg_temp.f('it_a') and qty = -2) = -round(2 * avg_a)::bigint
    and (select movement_type from public.stock_movements where inventory_id = inv and item_id = pg_temp.f('it_a') and qty = -2) = 'inventory', avg_a::text);
  perform pg_temp.chk('I52 saldos depois do inventário = o que se contou (ampola 3→1+2 novo; seringa 17 (19−2))', pg_temp.lotq('it_a','u1','L3') = 1 and pg_temp.lotq('it_a','u1','NOVO1') = 2 and pg_temp.bal('it_d','u1') = 17 and pg_temp.bal('it_h','u1') = 3
    and pg_temp.bal('it_c','u1') = 5, null);
  perform pg_temp.chk('I53 o custo médio NÃO muda com o ajuste (ampola, seringa, luva)', pg_temp.avg('it_a','u1') = avg_a and pg_temp.avg('it_d','u1') = 100, pg_temp.avg('it_a','u1')::text);
  perform pg_temp.chk('I54 motivo «inventário» com o número e a nota', (select reason from public.stock_movements where inventory_id = inv and item_id = pg_temp.f('it_d')) = 'Inventário nº 1: Inventário de novembro conferido', null);
  perform pg_temp.chk('I55 lote novo criado só na aprovação, com a validade informada', exists (select 1 from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'NOVO1' and expiry_date = private.fin_today() + 200), null);
  perform pg_temp.chk('I56 invariante (saldo = movimentações = lotes)', pg_temp.inv_ok(), null);
  perform pg_temp.chk('I57 linhas guardam o ajuste, o custo e o valor; resumo aprovado', (select count(*) from public.stock_inventory_lines where inventory_id = inv and adjust_movement_id is not null) = 4
    and (select status from public.stock_inventories where id = inv) = 'approved' and (r->>'decrease_cents')::bigint < 0 and (r->>'increase_cents')::bigint >= 0, null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I58 aprovar de novo é recusado', '22023', format($q$select public.fin_inventory_approve(%L, 'de novo')$q$, inv), 'NOT_IN_REVIEW');
  perform pg_temp.expect('I59 reabrir inventário aprovado é recusado', '22023', format($q$select public.fin_inventory_reopen(%L, 'tentar')$q$, inv), 'NOT_IN_REVIEW');
  perform pg_temp.expect('I60 cancelar inventário aprovado é recusado', '22023', format($q$select public.fin_inventory_cancel(%L, 'tentar')$q$, inv), 'INVENTORY_CLOSED');
  perform pg_temp.su();
  perform pg_temp.expect('I61 inventário aprovado não se edita (nem pelo dono do banco)', '42501', format($q$update public.stock_inventories set notes = 'x' where id = %L$q$, inv));
  perform pg_temp.expect('I62 linha do inventário aprovado não se edita', '42501', format($q$update public.stock_inventory_lines set counted_qty = 99 where inventory_id = %L$q$, inv));
  perform pg_temp.expect('I63 inventário não se apaga', '42501', format($q$delete from public.stock_inventories where id = %L$q$, inv));
  perform pg_temp.expect('I64 linha de inventário não se apaga', '42501', format($q$delete from public.stock_inventory_lines where inventory_id = %L$q$, inv));
  perform pg_temp.expect('I65 movimentação de inventário não se estorna à mão', '22023', format($q$select public.fin_stock_reverse((select id from public.stock_movements where inventory_id = %L limit 1), 'tentativa')$q$, inv), 'DOC_MOVEMENT_USE_FLOW');
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('I66 histórico: a lista mostra o inventário aprovado com o valor líquido', (select status = 'approved' and decrease_cents < 0 from public.fin_inventory_list(c, u1, 'approved')), null);
  perform pg_temp.su();
  perform pg_temp.chk('I67 o log registra criar, encerrar e aprovar sem gravar o saldo esperado',
    (select count(*) from public.fin_audit_log where entity = 'stock_inventory' and entity_id = inv) = 3 and not exists (select 1 from public.fin_audit_log where entity = 'stock_inventory' and (after::text like '%expected%' or after::text like '%counted%')), null);
  perform pg_temp.su();
end $t$;

-- I70..: fluxos de reabrir, cancelar, desatualizado, escopo, inventário não cego, protegido por unidade aberta
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); inv uuid; j jsonb; n integer; b4 numeric; d date := private.fin_today();
begin
  -- escopo por categoria: só 'mat'
  perform pg_temp.as_user('gestor');
  inv := public.fin_inventory_open(c, u1, jsonb_build_object('scope', 'category', 'scope_value', 'mat'));
  perform pg_temp.su();
  insert into fx values ('inv2', inv);
  perform pg_temp.chk('I70 escopo por categoria: só os itens da categoria «mat» entram', (select count(*) from public.stock_inventory_lines where inventory_id = inv) = 2
    and not exists (select 1 from public.stock_inventory_lines l join public.stock_items i on i.id = l.item_id where l.inventory_id = inv and i.category <> 'mat'), (select count(*) from public.stock_inventory_lines where inventory_id = inv)::text);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I71 cancelar exige motivo', '22023', format($q$select public.fin_inventory_cancel(%L, '')$q$, inv), 'REASON_REQUIRED');
  perform public.fin_inventory_cancel(inv, 'Aberto por engano');
  perform pg_temp.su();
  perform pg_temp.chk('I72 cancelar não mexe no estoque e libera a unidade para outra contagem', (select status from public.stock_inventories where id = inv) = 'canceled' and not exists (select 1 from public.stock_movements where inventory_id = inv), null);
  -- escopo por tipo inválido
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I73 escopo por tipo precisa de um tipo válido', '22023', format($q$select public.fin_inventory_open(%L, %L, '{"scope":"type","scope_value":"banana"}'::jsonb)$q$, c, u1), 'SCOPE_VALUE_REQUIRED');
  -- inventário NÃO cego: gestor vê o esperado durante a contagem; quem conta (estoquista) continua sem ver
  inv := public.fin_inventory_open(c, u1, jsonb_build_object('scope', 'type', 'scope_value', 'consumable', 'blind', false));
  perform pg_temp.su();
  insert into fx values ('inv3', inv);
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('I74 inventário aberto como NÃO cego: o Gestor vê o esperado durante a contagem', exists (select 1 from public.fin_inventory_lines(inv) where expected_qty is not null), null);
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('I75 ... mas o Estoquista (que só conta) não vê', not exists (select 1 from public.fin_inventory_lines(inv) where expected_qty is not null), null);
  -- conta tudo, encerra, recebe saída depois do fim da contagem, aprova: o que saiu depois não é tocado
  perform pg_temp.chk('I76 contar tudo do escopo (seringa 15, luva 3) e encerrar', (select count(*) from public.fin_inventory_lines(inv)) = 2 and
    public.fin_inventory_count(inv, (select jsonb_agg(jsonb_build_object('line_id', l.id, 'counted_qty', case when l.item_id = pg_temp.f('it_d') then 15 else 3 end)) from public.fin_inventory_lines(inv) l)) = 2
    and public.fin_inventory_finish(inv) = 1, null);
  perform pg_temp.su();
  -- depois do fim da contagem: sai 1 seringa (17 → 16): o ajuste de −2 (17 contados 15) deixa 14, ou seja, contado 15 − 1 posterior
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'sector', 1, jsonb_build_object('reason', 'Uso depois da contagem', 'purpose', 'Sala'));
  perform pg_temp.su();
  perform pg_temp.chk('I77 antes de aprovar: seringa 16', pg_temp.bal('it_d','u1') = 16, pg_temp.bal('it_d','u1')::text);
  perform pg_temp.as_user('gestor');
  -- reabrir pede motivo e volta a contar; limpa a revisão
  perform pg_temp.expect('I78 reabrir exige motivo', '22023', format($q$select public.fin_inventory_reopen(%L, '')$q$, inv), 'REASON_REQUIRED');
  perform public.fin_inventory_reopen(inv, 'Conferir a luva de novo');
  perform pg_temp.su();
  perform pg_temp.chk('I79 reaberto: volta a «contando», revisão limpa, contagens mantidas', (select status from public.stock_inventories where id = inv) = 'counting'
    and (select count(*) from public.stock_inventory_lines where inventory_id = inv and counted_qty is not null) = 2 and not exists (select 1 from public.stock_inventory_lines where inventory_id = inv and diff_qty is not null), null);
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('I80 recontar e encerrar de novo', pg_temp.icount(inv, 'it_h', 3) = 1 and public.fin_inventory_finish(inv) = 1, null);
  perform pg_temp.su();
  -- seringa: congelado 17, contado 15; depois da 1ª finalização saiu 1 (16): movido na 2ª finalização = −1 (saiu antes do fim da 2ª contagem) → diff = 15 − (17 − 1) = −1
  perform pg_temp.chk('I81 a diferença usa os movimentos até o FIM da última contagem (15 − (17 − 1) = −1)', (select diff_qty = -1 from public.stock_inventory_lines where inventory_id = inv and item_id = pg_temp.f('it_d')), (select diff_qty::text from public.stock_inventory_lines where inventory_id = inv and item_id = pg_temp.f('it_d')));
  -- movimento DEPOIS do fim: sai mais 1 seringa (16 → 15) e aprova: ajuste −1 → 14 (= contado 15 − 1 posterior)
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'sector', 1, jsonb_build_object('reason', 'Uso depois do fim', 'purpose', 'Sala'));
  perform public.fin_inventory_approve(inv, 'Conferido');
  perform pg_temp.su();
  perform pg_temp.chk('I82 o que saiu DEPOIS do fim da contagem não é tocado: 16 − 1 (uso) − 1 (ajuste) = 14', pg_temp.bal('it_d','u1') = 14 and pg_temp.inv_ok(), pg_temp.bal('it_d','u1')::text);
end $t$;

-- I90: aprovação desatualizada é tudo ou nada; abaixo da unidade aberta; Gestor restrito
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); inv uuid; n0 integer; d date := private.fin_today();
begin
  -- luva H (u1: 3). Conta 3 → diferença 0; seringa conta 0 (diferença −14); depois consome tudo e aprova → desatualizado
  perform pg_temp.as_user('gestor');
  inv := public.fin_inventory_open(c, u1, jsonb_build_object('scope', 'type', 'scope_value', 'consumable'));
  perform pg_temp.su();
  insert into fx values ('inv4', inv);
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('I90a contar só a luva (3)', pg_temp.icount(inv, 'it_h', 3) = 1, null);
  n0 := public.fin_inventory_finish(inv, true);
  perform pg_temp.chk('I90 confirmar zero no que sobrou: a seringa vira diferença', n0 = 1, n0::text);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'sector', 14, jsonb_build_object('reason', 'Gasto todo depois da contagem', 'purpose', 'Sala'));
  select count(*) into n0 from public.stock_movements;
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('I91 se o saldo caiu depois da contagem e o ajuste ficou impossível: INVENTORY_LINE_STALE', '22023', format($q$select public.fin_inventory_approve(%L, 'tentar')$q$, inv), 'INVENTORY_LINE_STALE');
  perform pg_temp.su();
  perform pg_temp.chk('I92 ... e nada foi lançado (tudo ou nada); continua em revisão', (select count(*) from public.stock_movements) = n0 and (select status from public.stock_inventories where id = inv) = 'review', null);
  perform pg_temp.as_user('gestor');
  perform public.fin_inventory_cancel(inv, 'Saldo mudou depois da contagem');
  perform pg_temp.su();
  -- unidade aberta: caneta u1 tem 0,75 (aberta). Inventário conta 0 → ficaria abaixo da fração reservada.
  perform pg_temp.as_user('gestor');
  inv := public.fin_inventory_open(c, u1, jsonb_build_object('scope', 'category', 'scope_value', 'caneta'));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('I93 caneta: congelado 0,75 (fração da unidade aberta); contagem pode ser decimal em item fracionado', pg_temp.icount(inv, 'it_b', 0.5) = 1 and public.fin_inventory_finish(inv) = 1, null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('I94 diferença decimal −0,25', (select diff_qty = -0.25 from public.fin_inventory_lines(inv) where item_id = pg_temp.f('it_b')), null);
  perform pg_temp.expect('I96 não deixa o lote abaixo da fração reservada por unidade aberta', '22023', format($q$select public.fin_inventory_approve(%L, 'tentar')$q$, inv), 'INVENTORY_BELOW_OPEN_UNITS');
  perform public.fin_inventory_cancel(inv, 'Fechar a unidade aberta antes');
  perform pg_temp.su();
  -- Gestor só da unidade 2: abre/aprova lá, não na 1
  perform pg_temp.as_user('gestor2');
  inv := public.fin_inventory_open(c, u2, '{}'::jsonb);
  perform pg_temp.chk('I97 Gestor restrito à unidade 2 abre inventário na 2', inv is not null and (select count(*) from public.fin_inventory_list(c)) >= 1, null);
  perform pg_temp.chk('I98 ... e só vê os inventários das unidades dele', not exists (select 1 from public.fin_inventory_list(c) x where x.unit_id = u1), null);
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.expect('I99 Estoquista só da 1 não conta na unidade 2', '42501', format($q$select public.fin_inventory_count(%L, jsonb_build_array(jsonb_build_object('item_id', %L, 'lot_code', 'L1', 'counted_qty', 1)))$q$, inv, pg_temp.f('it_a')));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor2');
  perform public.fin_inventory_cancel(inv, 'Teste de permissão por unidade');
  perform pg_temp.su();
end $t$;

-- ---------- A. Alertas ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d date := private.fin_today(); j jsonb; j1 jsonb; sv uuid; ap uuid; mt uuid; k integer;
begin
  -- estado: u1 ampola: L3 1 (vence d+200), NOVO1 2 (d+200); L1 fora; mínimos
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 3, 4000, 'V25', d + 25, 'NF-V1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 2, 4000, 'V55', d + 55, 'NF-V2');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 1, 4000, 'V85', d + 85, 'NF-V3');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 4, 4000, 'V120', d + 120, 'NF-V4');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_e'), 2, 2500, 'E2', d + 8, 'NF-E');
  perform pg_temp.su();
  update public.stock_lots set expiry_date = d - 3 where item_id = pg_temp.f('it_e') and unit_id = u1 and lot_code = 'E1';   -- E1 (3 un) venceu há 3 dias
  insert into public.stock_item_minimums (item_id, unit_id, min_qty) values (pg_temp.f('it_d'), u1, 100), (pg_temp.f('it_c'), u1, 2), (pg_temp.f('it_a'), u2, 50);
  -- transferência parada (enviada há 5 dias) e consumo sem saldo
  perform pg_temp.as_user('estoq');
  insert into fx values ('t5', pg_temp.send('u1', 'u2', 'it_c', 1));
  perform pg_temp.su();
  alter table public.stock_transfers disable trigger stock_transfers_guard_row;
  update public.stock_transfers set sent_at = now() - interval '5 days' where id = pg_temp.f('t5');
  alter table public.stock_transfers enable trigger stock_transfers_guard_row;
  insert into public.fin_services (clinic_id, name, category, default_price_cents) values (c, 'Soroterapia', 'aplicacao', 20000) returning id into sv;
  insert into fx values ('svc', sv);
  insert into public.fin_appointments (clinic_id, unit_id, patient_id, service_id, service_name, performed_on, status, done_at) values (c, u1, pg_temp.f('pat'), sv, 'Soroterapia', d, 'done', now()) returning id into ap;
  insert into fx values ('appt', ap);
  insert into public.fin_appointment_materials (appointment_id, clinic_id, unit_id, item_id, source, qty_consumption, qty, short_qty) values (ap, c, u1, pg_temp.f('it_d'), 'kit', 5, 5, 5) returning id into mt;
  insert into public.stock_shortfalls (clinic_id, unit_id, item_id, appointment_id, material_id, patient_id, qty, est_cost_cents, occurred_on) values (c, u1, pg_temp.f('it_d'), ap, mt, pg_temp.f('pat'), 5, 500, d);

  perform pg_temp.as_user('estoq');
  j := public.fin_stock_alerts(c);
  j1 := public.fin_stock_alerts(c, u1);
  perform pg_temp.su();
  perform pg_temp.chk('A1 abaixo do mínimo: Seringa D (< 100) na unidade 1 e Ampola X na unidade 2 (< 50), com saldo e mínimo',
    jsonb_array_length(j->'below_min') = 2 and exists (select 1 from jsonb_array_elements(j->'below_min') e where e->>'item_name' = 'Seringa D' and (e->>'min_qty')::numeric = 100 and (e->>'qty_on_hand')::numeric < 100)
    and exists (select 1 from jsonb_array_elements(j->'below_min') e where e->>'item_name' = 'Ampola X' and e->>'unit_name' = 'Unidade 2' and (e->>'missing_qty')::numeric > 0), (j->'counts')::text);
  perform pg_temp.chk('A2 Suplemento C (4 ≥ 2 após enviar 1) não alerta', not exists (select 1 from jsonb_array_elements(j->'below_min') e where e->>'item_name' = 'Suplemento C'), null);
  perform pg_temp.chk('A3 vencendo nas janelas 90/60/30: V25→30, V55→60, V85→90; V120 e L3 (200 dias) fora; E2 (8 dias) → 30',
    (select count(*) from jsonb_array_elements(j1->'expiring')) = 4
    and (select (e->>'window_days')::int from jsonb_array_elements(j1->'expiring') e where e->>'lot_code' = 'V25') = 30
    and (select (e->>'window_days')::int from jsonb_array_elements(j1->'expiring') e where e->>'lot_code' = 'V55') = 60
    and (select (e->>'window_days')::int from jsonb_array_elements(j1->'expiring') e where e->>'lot_code' = 'V85') = 90
    and (select (e->>'window_days')::int from jsonb_array_elements(j1->'expiring') e where e->>'lot_code' = 'E2') = 30
    and not exists (select 1 from jsonb_array_elements(j1->'expiring') e where e->>'lot_code' in ('V120','L3')), (j1->'expiring')::text);
  perform pg_temp.chk('A4 vencido: lote E1 (3 un, venceu há 3 dias) com valor', jsonb_array_length(j1->'expired') = 1 and (j1->'expired'->0->>'lot_code') = 'E1' and (j1->'expired'->0->>'days_late')::int = 3 and (j1->'expired'->0->>'value_cents')::bigint = 6600, (j1->'expired')::text);
  perform pg_temp.chk('A5 consumo sem saldo em aberto (1 ocorrência, R$ 5,00)', (j->'counts'->>'shortfalls')::int = 1 and (j->'counts'->>'shortfalls_cents')::bigint = 500, (j->'counts')::text);
  perform pg_temp.chk('A6 transferência parada há mais de 3 dias', (j->'counts'->>'stale_transfers')::int = 1 and (j->'stale_transfers'->0->>'age_days')::int = 5, (j->'stale_transfers')::text);
  perform pg_temp.chk('A7 contagens fecham com as listas', (j->'counts'->>'below_min')::int = jsonb_array_length(j->'below_min') and (j->'counts'->>'expiring')::int = jsonb_array_length(j->'expiring')
    and (j->'counts'->>'total')::int = (j->'counts'->>'below_min')::int + (j->'counts'->>'expiring')::int + (j->'counts'->>'expired')::int + (j->'counts'->>'shortfalls')::int + (j->'counts'->>'stale_transfers')::int
    and (j->'counts'->>'expiring')::int = jsonb_array_length(j->'expiring') and (j1->'counts'->>'expiring')::int = 4, (j->'counts')::text);
  perform pg_temp.as_user('fin');
  perform pg_temp.chk('A8 Financeiro consulta os alertas e as contagens', (public.fin_stock_alert_counts(c)->'counts'->>'total')::int = (j->'counts'->>'total')::int and (public.fin_stock_alert_counts(c)->'below_min') is null, null);
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  j := public.fin_stock_alerts(c);
  perform pg_temp.chk('A9 Estoquista da unidade 1: alertas só da unidade 1 (sem a Ampola X da unidade 2)', not exists (select 1 from jsonb_array_elements(j->'below_min') e where e->>'unit_name' = 'Unidade 2'), (j->'below_min')::text);
  perform pg_temp.expect('A10 ... e é recusado na unidade 2', '42501', format($q$select public.fin_stock_alerts(%L, %L)$q$, c, u2));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('A11 Recepção não vê alertas', '42501', format($q$select public.fin_stock_alerts(%L)$q$, c));
  perform pg_temp.expect('A12 Recepção não vê as contagens', '42501', format($q$select public.fin_stock_alert_counts(%L)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('A13 outra clínica não vê', '42501', format($q$select public.fin_stock_alerts(%L)$q$, c));
  perform pg_temp.su();
  -- janelas configuráveis
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('A20 Estoquista não muda as janelas', '42501', format($q$select public.fin_stock_alert_settings_save(%L, '{"expiry_days":[45]}'::jsonb)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('A21 Financeiro não muda as janelas', '42501', format($q$select public.fin_stock_alert_settings_save(%L, '{"expiry_days":[45]}'::jsonb)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('A22 janela inválida (0 dia) é recusada', '22023', format($q$select public.fin_stock_alert_settings_save(%L, '{"expiry_days":[0]}'::jsonb)$q$, c), 'INVALID_EXPIRY_DAYS');
  perform pg_temp.expect('A23 mais de 5 janelas é recusado', '22023', format($q$select public.fin_stock_alert_settings_save(%L, '{"expiry_days":[1,2,3,4,5,6]}'::jsonb)$q$, c), 'INVALID_EXPIRY_DAYS');
  perform pg_temp.expect('A24 dias sem giro fora de 7 a 730 são recusados', '22023', format($q$select public.fin_stock_alert_settings_save(%L, '{"idle_days":3}'::jsonb)$q$, c), 'INVALID_IDLE_DAYS');
  j := public.fin_stock_alert_settings_save(c, '{"expiry_days":[30, 10]}'::jsonb, 'Vencimento mais curto');
  perform pg_temp.chk('A25 Gestor salva as janelas (30 e 10 dias); ordem decrescente', j->'expiry_days' = '[30,10]'::jsonb, j::text);
  j := public.fin_stock_alerts(c, u1);
  perform pg_temp.su();
  perform pg_temp.chk('A26 com as janelas novas só vencem até 30 dias: V25 (→30), E2 (8 → 10)', jsonb_array_length(j->'expiring') = 2 and exists (select 1 from jsonb_array_elements(j->'expiring') e where e->>'lot_code' = 'E2' and (e->>'window_days')::int = 10), (j->'expiring')::text);
  perform pg_temp.chk('A27 a mudança fica no log com antes e depois', exists (select 1 from public.fin_audit_log where entity = 'stock_alert_settings' and (before->'expiry_days') = '[90,60,30]'::jsonb and (after->'expiry_days') = '[30,10]'::jsonb), null);
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_alert_settings_save(c, '{"expiry_days":[90,60,30]}'::jsonb, 'Voltar ao padrão');
  perform pg_temp.su();
  -- receber a transferência parada tira o alerta
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_transfer_receive(pg_temp.f('t5'), pg_temp.recv_lines(pg_temp.f('t5')));
  j := public.fin_stock_alerts(c);
  perform pg_temp.su();
  perform pg_temp.chk('A30 receber a transferência parada zera o alerta', (j->'counts'->>'stale_transfers')::int = 0, null);
  -- resolver o consumo sem saldo por ajuste tira o alerta (E4 existente)
  perform pg_temp.as_user('gestor');
  perform public.fin_shortfall_resolve((select id from public.stock_shortfalls where appointment_id = pg_temp.f('appt')), 'adjust', 'Regularizado no inventário');
  j := public.fin_stock_alerts(c);
  perform pg_temp.su();
  perform pg_temp.chk('A31 resolver o consumo sem saldo zera o alerta', (j->'counts'->>'shortfalls')::int = 0, (j->'counts')::text);
end $t$;

-- ---------- R. Relatórios ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d date := private.fin_today(); r jsonb; s bigint; ap uuid := pg_temp.f('appt'); v_ou uuid;
begin
  -- consumo por serviço e executor: ligar o atendimento a participantes e baixar 2 seringas (uma estornada depois)
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 20, 100, null, null, 'NF-R0');
  perform pg_temp.su();
  insert into public.fin_appointment_participants (appointment_id, clinic_id, professional_id, role, position) values (ap, c, pg_temp.f('pro_gestor'), 'responsavel', 1), (ap, c, pg_temp.f('pro_estoq'), 'executor', 2);
  perform private.stock_exit(c, u1, pg_temp.f('it_d'), 'appointment', 3, jsonb_build_object('appointment_id', ap, 'patient_id', pg_temp.f('pat'), 'reason', 'Kit'));
  perform private.stock_exit(c, u1, pg_temp.f('it_c'), 'appointment', 1, jsonb_build_object('patient_id', pg_temp.f('pat'), 'reason', 'Uso individual'));
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_d'), 'loss', 1, jsonb_build_object('loss_kind', 'breakage', 'reason', 'Caiu no chão'));
  perform public.fin_stock_exit(c, u1, pg_temp.f('it_a'), 'loss', 1, jsonb_build_object('lot_id', (select id from public.stock_lots where item_id = pg_temp.f('it_a') and unit_id = u1 and lot_code = 'V25'), 'loss_kind', 'loss', 'reason', 'Frasco rachado'));
  perform pg_temp.su();
  -- perda estornada não conta
  perform pg_temp.as_user('gestor');
  perform public.fin_stock_reverse((select id from public.stock_movements where movement_type = 'loss' and loss_kind = 'loss' limit 1), 'Foi engano, o frasco estava inteiro');
  perform pg_temp.su();

  -- posição valorizada
  perform pg_temp.as_user('fin');
  r := public.fin_stock_report(c, 'position');
  perform pg_temp.chk('R1 posição: total = soma das linhas = soma do Saldo (E3)', (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e)
    and (r->'totals'->>'value_cents')::bigint = (select sum(value_cents) from public.fin_stock_balances(c, null, null, null, true)) and (r->>'count')::int = jsonb_array_length(r->'rows'), (r->'totals')::text);
  r := public.fin_stock_report(c, 'position', u2);
  perform pg_temp.chk('R2 posição filtrada por unidade: só a unidade 2', not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'unit_id' <> u2::text) and (r->>'count')::int >= 1, null);
  r := public.fin_stock_report(c, 'position', null, null, null, '{"category":"mat"}'::jsonb);
  perform pg_temp.chk('R3 posição filtrada por categoria', jsonb_array_length(r->'rows') >= 1 and not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'category' <> 'mat'), null);
  perform pg_temp.su();

  -- movimentação por período
  perform pg_temp.as_user('estoq');
  r := public.fin_stock_report(c, 'movements', null, d - 30, d);
  perform pg_temp.chk('R10 movimentação por período: entradas − saídas = Σ do custo das movimentações do período',
    (r->'totals'->>'value_cents')::bigint = (select sum(total_cost_cents) from public.stock_movements where occurred_on between d - 30 and d)
    and (r->'totals'->>'in_cents')::bigint - (r->'totals'->>'out_cents')::bigint = (r->'totals'->>'value_cents')::bigint
    and (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e)
    and (r->'totals'->>'count')::int = (select count(*) from public.stock_movements where occurred_on between d - 30 and d), (r->'totals')::text);
  r := public.fin_stock_report(c, 'movements', u1, d + 1, d + 2);
  -- bordas do período: movimentação com data exatamente no primeiro e no último dia entra (between inclusivo)
  perform pg_temp.su();
  perform private.stock_apply(c, u1, pg_temp.f('it_c'), (select id from public.stock_lots where item_id = pg_temp.f('it_c') and unit_id = u1), null, null, 'sector', -1, -8000, false, jsonb_build_object('occurred_on', (d - 30)::text, 'reason', 'Saída na borda do período', 'purpose', 'Sala'));
  perform pg_temp.as_user('estoq');
  r := public.fin_stock_report(c, 'movements', u1, d - 30, d - 30);
  perform pg_temp.chk('R10b o primeiro dia do período entra no relatório (borda inclusiva)', (r->>'count')::int = 1 and (r->'totals'->>'out_cents')::bigint = 8000, (r->'totals')::text);
  r := public.fin_stock_report(c, 'movements', null, d - 30, d);
  perform pg_temp.chk('R10c o total do período com a borda continua fechando (Σ das linhas = Σ do custo das movimentações)', (r->'totals'->>'value_cents')::bigint = (select sum(total_cost_cents) from public.stock_movements where occurred_on between d - 30 and d)
    and (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e), (r->'totals')::text);
  r := public.fin_stock_report(c, 'movements', u1, d + 1, d + 2);
  perform pg_temp.chk('R11 período sem movimento: vazio e total zero', jsonb_array_length(r->'rows') = 0 and coalesce((r->'totals'->>'value_cents')::bigint, 0) = 0, r::text);
  perform pg_temp.expect('R12 período invertido é recusado', '22023', format($q$select public.fin_stock_report(%L, 'movements', null, %L, %L)$q$, c, d, d - 1), 'INVALID_PERIOD');
  perform pg_temp.expect('R13 relatório inexistente é recusado', '22023', format($q$select public.fin_stock_report(%L, 'banana')$q$, c), 'INVALID_REPORT');
  perform pg_temp.su();

  -- consumo por serviço / profissional executor / item
  perform pg_temp.as_user('gestor');
  r := public.fin_stock_report(c, 'consumption', null, d - 1, d);
  perform pg_temp.chk('R20 consumo por serviço: Soroterapia = 3 seringas (R$ 3,00) e uso sem atendimento = suplemento (R$ 80,00) + dose da caneta (R$ 75,00)',
    exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'service' = 'Soroterapia' and (e->>'value_cents')::bigint = 300)
    and exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'service' like 'Uso por paciente%' and (e->>'value_cents')::bigint = 15500), (r->'rows')::text);
  perform pg_temp.chk('R21 consumo: total = soma das linhas', (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e) and (r->'totals'->>'value_cents')::bigint = 15800, (r->'totals')::text);
  r := public.fin_stock_report(c, 'consumption', null, d - 1, d, '{"group":"professional"}'::jsonb);
  perform pg_temp.chk('R22 consumo por profissional EXECUTOR (não o responsável): U estoq com R$ 3,00', exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'professional' = 'U estoq' and (e->>'value_cents')::bigint = 300)
    and not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'professional' = 'U gestor'), (r->'rows')::text);
  r := public.fin_stock_report(c, 'consumption', null, d - 1, d, '{"group":"item"}'::jsonb);
  perform pg_temp.chk('R23 consumo por item com quantidade', exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'item_name' = 'Seringa D' and (e->>'qty')::numeric = 3), (r->'rows')::text);
  perform pg_temp.su();

  -- perdas por motivo
  perform pg_temp.as_user('gestor');
  r := public.fin_stock_report(c, 'losses', null, d - 1, d);
  s := (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e);
  perform pg_temp.chk('R30 perdas: quebra (R$ 1,00), transferência com diferença (Item da E6: R$ 40,00 + 2 ampolas L2 + caixa de luva) e o estorno cancela a perda «loss»',
    exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'kind' = 'breakage' and e->>'item_name' = 'Seringa D' and (e->>'value_cents')::bigint = 100)
    and exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'kind' = 'transfer_diff' and e->>'item_name' = 'Luva H' and (e->>'value_cents')::bigint = 900)
    and not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'kind' = 'loss' and (e->>'value_cents')::bigint <> 0), (r->'rows')::text);
  perform pg_temp.chk('R31 perdas: total = soma das linhas = Σ(loss líquido) + Σ(diferenças de transferência)', (r->'totals'->>'value_cents')::bigint = s
    and s = (select -coalesce(sum(m.total_cost_cents), 0) from public.stock_movements m where m.movement_type = 'loss' and m.occurred_on between d - 1 and d)
          - (select coalesce(sum(m2.total_cost_cents), 0) from public.stock_movements m2 join public.stock_movements o on o.id = m2.reversed_movement_id where m2.movement_type = 'reversal' and o.movement_type = 'loss' and m2.occurred_on between d - 1 and d)
          + (select coalesce(sum(l.loss_cents), 0) from public.stock_transfer_lines l where l.loss_qty > 0), s::text);
  perform pg_temp.su();

  -- validade
  perform pg_temp.as_user('estoq');
  r := public.fin_stock_report(c, 'validity', null, null, null, '{"window":60}'::jsonb);
  perform pg_temp.chk('R40 validade até 60 dias: vencido (E1), E2, V25, V55; V85 e V120 fora', (select array_agg(e->>'lot_code' order by e->>'lot_code') from jsonb_array_elements(r->'rows') e where e->>'unit_name' = 'Unidade principal') = array['E1','E2','V25','V55'], (r->'rows')::text);
  perform pg_temp.chk('R41 validade: dias restantes negativos no vencido e total = soma', (select (e->>'days_left')::int from jsonb_array_elements(r->'rows') e where e->>'lot_code' = 'E1') = -3
    and (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e), null);
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); d date := private.fin_today(); r jsonb; a uuid; pr public.stock_movements;
begin
  -- sem giro: Item parado P entrou há 200 dias e nunca saiu; Luva H entrou e saiu recentemente
  perform pg_temp.as_user('owner');
  perform pg_temp.entry(u1, 'initial_balance', pg_temp.f('it_p'), 7, 300);
  perform pg_temp.su();
  update public.stock_movements set created_at = created_at where false;
  perform pg_temp.chk('R50 fixture do sem giro', true, null);
  -- envelhece a entrada do item parado (dono do banco: desliga o gatilho de imutabilidade só neste teste)
  alter table public.stock_movements disable trigger stock_movements_immutable_row;
  update public.stock_movements set occurred_on = d - 200 where item_id = pg_temp.f('it_p');
  update public.stock_movements set occurred_on = d - 150 where item_id = pg_temp.f('it_c') and movement_type = 'initial_balance';
  alter table public.stock_movements enable trigger stock_movements_immutable_row;
  perform pg_temp.as_user('gestor');
  r := public.fin_stock_report(c, 'idle', u1);
  perform pg_temp.chk('R51 sem giro há 90 dias: Item parado P (entrou há 200 dias, nunca saiu) aparece; Seringa D (saiu hoje) não',
    exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'item_name' = 'Item parado P' and (e->>'days_idle')::int = 200 and (e->>'value_cents')::bigint = 2100)
    and not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'item_name' = 'Seringa D'), (r->'rows')::text);
  perform pg_temp.chk('R52 Suplemento C: última saída hoje → não está parado (mesmo com a entrada antiga)', not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'item_name' = 'Suplemento C'), null);
  perform pg_temp.chk('R53 sem giro: total = soma das linhas', (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e), null);
  r := public.fin_stock_report(c, 'idle', u1, null, null, '{"days":400}'::jsonb);
  perform pg_temp.chk('R54 janela de 400 dias: nada parado', jsonb_array_length(r->'rows') = 0, null);
  perform pg_temp.su();

  -- compras por fornecedor
  perform pg_temp.as_user('gestor');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 10, 100, null, null, 'NF-P1', jsonb_build_object('supplier_new', jsonb_build_object('name', 'Distribuidora Alfa'), 'freight_cents', 100));
  a := pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 5, 100, null, null, 'NF-P2', jsonb_build_object('supplier_new', jsonb_build_object('name', 'Distribuidora Beta')));
  perform public.fin_stock_reverse_entry(a, 'Nota lançada em duplicidade');   -- estornada: não conta
  perform pg_temp.entry(u1, 'bonus', pg_temp.f('it_d'), 2, 0, null, null, null, jsonb_build_object('notes', 'Brinde', 'supplier_new', jsonb_build_object('name', 'Distribuidora Gama')));
  r := public.fin_stock_report(c, 'purchases', null, d - 1, d);
  perform pg_temp.su();
  perform pg_temp.chk('R60 compras por fornecedor: Alfa R$ 11,00 (10×1,00 + frete 1,00); Beta estornada e bonificação não entram',
    exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'supplier_name' = 'Distribuidora Alfa' and (e->>'value_cents')::bigint = 1100 and (e->>'entries')::int = 1)
    and not exists (select 1 from jsonb_array_elements(r->'rows') e where e->>'supplier_name' in ('Distribuidora Beta','Distribuidora Gama')), (r->'rows')::text);
  perform pg_temp.chk('R61 compras: total = soma das linhas e de Fornecedor Padrão (compras anteriores do teste)', (r->'totals'->>'value_cents')::bigint = (select sum((e->>'value_cents')::bigint) from jsonb_array_elements(r->'rows') e)
    and (r->'totals'->>'value_cents')::bigint = (select sum(total_cents) from public.stock_entries where status = 'active' and entry_type in ('purchase','xml_purchase') and received_on between d - 1 and d), (r->'totals')::text);
  -- paginação: total do relatório inteiro e linhas da página
  perform pg_temp.as_user('gestor');
  r := public.fin_stock_report(c, 'position', null, null, null, '{}'::jsonb, 2, 0);
  perform pg_temp.chk('R70 paginação: 2 linhas na página, total e contagem do relatório inteiro, truncado', jsonb_array_length(r->'rows') = 2 and (r->>'count')::int > 2 and (r->>'truncated')::boolean
    and (r->'totals'->>'value_cents')::bigint = (select sum(value_cents) from public.fin_stock_balances(c, null, null, null, true)), r->>'count');
  r := public.fin_stock_report(c, 'position', null, null, null, '{}'::jsonb, 2, 2);
  perform pg_temp.chk('R71 página 2 continua a ordem (sem repetir)', (r->'rows'->0->>'ord')::int = 3, null);
  perform pg_temp.su();
  -- permissões dos relatórios
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('R80 Recepção não vê relatórios', '42501', format($q$select public.fin_stock_report(%L, 'position')$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('R81 Profissional não vê relatórios', '42501', format($q$select public.fin_stock_report(%L, 'consumption')$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('R82 outra clínica não vê relatórios', '42501', format($q$select public.fin_stock_report(%L, 'position')$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq1');
  perform pg_temp.chk('R83 Estoquista da unidade 1: relatórios só da unidade 1', not exists (select 1 from jsonb_array_elements(public.fin_stock_report(c, 'position')->'rows') e where e->>'unit_name' = 'Unidade 2'), null);
  perform pg_temp.expect('R84 ... e a unidade 2 é recusada', '42501', format($q$select public.fin_stock_report(%L, 'position', %L)$q$, c, pg_temp.f('u2')));
  perform pg_temp.su();
  perform pg_temp.chk('R90 invariante final (saldo = movimentações = lotes)', pg_temp.inv_ok(), null);
  perform pg_temp.chk('R91 funções internas não são chamáveis por usuário', not has_function_privilege('authenticated', 'private.rpt_position(uuid, uuid[], date, date, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'private.stock_alerts_calc(uuid, uuid[], boolean)', 'execute') and not has_function_privilege('anon', 'public.fin_stock_report(uuid, text, uuid, date, date, jsonb, integer, integer)', 'execute'), null);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
