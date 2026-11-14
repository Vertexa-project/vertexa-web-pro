-- Medição de desempenho da FIN-E8 num Postgres LOCAL descartável (banco apagado ao fim; roda com commit para o planejador ter estatísticas reais): 1.000 itens × 2 unidades × 3 lotes (6.000 lotes), ~72 mil movimentações, 12 transferências,
-- inventário com 6.000 linhas. Roda como usuário (Gestor), 5 rodadas por chamada. Uso: PERF=1 scripts/fin-e8-sql-proof.sh
create temp table tm (label text, ms numeric);
grant all on tm to authenticated;
create temp table fx (k text primary key, v uuid);
grant all on fx to authenticated;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;
create function pg_temp.as_user(p_k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.profiles where id = pg_temp.f('prof_' || p_k)), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.timeit(p_label text, p_sql text, p_runs integer default 5) returns void language plpgsql as $$
declare t0 timestamptz; i integer; tot numeric := 0; mx numeric := 0; e numeric;
begin
  execute p_sql;   -- aquecimento
  for i in 1..p_runs loop
    t0 := clock_timestamp(); execute p_sql; e := extract(epoch from clock_timestamp() - t0) * 1000; tot := tot + e; mx := greatest(mx, e);
  end loop;
  insert into tm values (p_label || ' (média)', round(tot / p_runs, 1)), (p_label || ' (máx)', round(mx, 1));
end $$;
grant execute on function pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.timeit(text, text, integer) to public;

do $t$
declare c uuid; u1 uuid; u2 uuid; pid uuid; pro uuid; k text;
begin
  foreach k in array array['owner','gestor','estoq'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid; insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica Grande', pg_temp.f('prof_owner')) returning id into c; insert into fx values ('c', c);
  foreach k in array array['owner','gestor','estoq'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end) returning id into pro; insert into fx values ('pro_' || k, pro);
  end loop;
  select id into u1 from public.clinic_units where clinic_id = c and is_primary;
  insert into public.clinic_units (clinic_id, name) values (c, 'Unidade 2') returning id into u2;
  insert into fx values ('u1', u1), ('u2', u2);
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_estoq'), 'estoquista');
end $t$;

-- itens, lotes, saldos e movimentações em massa (como dono do banco; consistentes: lote = soma das movimentações)
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); d date := private.fin_today();
begin
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control)
    select c, 'Item ' || lpad(g::text, 4, '0'), 'cat' || (g % 12), case g % 4 when 0 then 'medication' when 1 then 'resale' when 2 then 'consumable' else 'compounded' end, 'cx', 'un', 'un', (g % 4) in (0, 3)
      from generate_series(1, 1000) g;
  insert into public.stock_lots (clinic_id, unit_id, item_id, lot_code, expiry_date)
    select c, u, i.id, 'L' || l, d + (case l when 1 then 5 + abs(hashtext(i.id::text)) % 80 when 2 then 90 + abs(hashtext(i.id::text)) % 200 else 400 end)
      from public.stock_items i cross join (values (u1), (u2)) uu(u) cross join generate_series(1, 3) l where i.clinic_id = c;
  -- 12 movimentações por lote: 1 entrada de 100 e 11 saídas de 1 a 5
  insert into public.stock_movements (clinic_id, unit_id, item_id, lot_id, movement_type, qty, unit_cost_cents, total_cost_cents, balance_after, avg_cost_after_cents, occurred_on, created_at, loss_kind)
    select c, l.unit_id, l.item_id, l.id, case when n = 1 then 'purchase' else (array['appointment','sale','sector','loss'])[1 + n % 4] end,
           case when n = 1 then 100 else -(1 + (n % 5)) end, 1000, case when n = 1 then 100000 else -1000 * (1 + (n % 5)) end, 50, 1000,
           d - (n * 3), now() - (n || ' days')::interval + (random() * interval '1 hour'), case when n > 1 and (array['appointment','sale','sector','loss'])[1 + n % 4] = 'loss' then 'breakage' end
      from public.stock_lots l cross join generate_series(1, 12) n where l.clinic_id = c;
  update public.stock_lots l set qty_on_hand = (select sum(m.qty) from public.stock_movements m where m.lot_id = l.id) where l.clinic_id = c;
  insert into public.stock_balances (item_id, unit_id, clinic_id, qty_on_hand, avg_cost_cents)
    select l.item_id, l.unit_id, c, sum(l.qty_on_hand), 1000 from public.stock_lots l where l.clinic_id = c group by l.item_id, l.unit_id;
  insert into public.stock_item_minimums (item_id, unit_id, min_qty) select item_id, unit_id, 200 from public.stock_balances where clinic_id = c and item_id in (select id from public.stock_items order by name limit 300);
end $t$;
analyze;   -- estatísticas reais (como a produção tem depois do autovacuum)

select count(*) as movimentos, (select count(*) from public.stock_lots) as lotes from public.stock_movements;

-- transferências (12) via RPC
do $t$
declare c uuid := pg_temp.f('c'); i integer; it uuid; t uuid;
begin
  perform pg_temp.as_user('estoq');
  for i in 1..12 loop
    select id into it from public.stock_items order by name offset i limit 1;
    t := public.fin_stock_transfer_send(c, pg_temp.f('u1'), pg_temp.f('u2'), jsonb_build_array(jsonb_build_object('item_id', it, 'quantity', 2)), null);
    if i % 2 = 0 then perform public.fin_stock_transfer_receive(t, (select jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', l.qty_sent)) from public.stock_transfer_lines l where l.transfer_id = t)); end if;
  end loop;
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); inv uuid; n integer; t0 timestamptz;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.timeit('saldo (E3) 2.000 linhas', format($q$select count(*) from public.fin_stock_balances(%L)$q$, c));
  perform pg_temp.timeit('alertas completos', format($q$select public.fin_stock_alerts(%L)$q$, c));
  perform pg_temp.timeit('contagem de alertas (painel)', format($q$select public.fin_stock_alert_counts(%L)$q$, c));
  perform pg_temp.timeit('relatório posição valorizada', format($q$select public.fin_stock_report(%L, 'position')$q$, c));
  perform pg_temp.timeit('relatório movimentação (30 dias)', format($q$select public.fin_stock_report(%L, 'movements', null, current_date - 30, current_date)$q$, c));
  perform pg_temp.timeit('relatório movimentação (12 meses)', format($q$select public.fin_stock_report(%L, 'movements', null, current_date - 365, current_date)$q$, c));
  perform pg_temp.timeit('relatório consumo (30 dias)', format($q$select public.fin_stock_report(%L, 'consumption', null, current_date - 30, current_date)$q$, c));
  perform pg_temp.timeit('relatório consumo por item (12 meses)', format($q$select public.fin_stock_report(%L, 'consumption', null, current_date - 365, current_date, '{"group":"item"}')$q$, c));
  perform pg_temp.timeit('relatório perdas (12 meses)', format($q$select public.fin_stock_report(%L, 'losses', null, current_date - 365, current_date)$q$, c));
  perform pg_temp.timeit('relatório validade (90 dias)', format($q$select public.fin_stock_report(%L, 'validity')$q$, c));
  perform pg_temp.timeit('relatório sem giro', format($q$select public.fin_stock_report(%L, 'idle')$q$, c));
  perform pg_temp.timeit('relatório compras por fornecedor', format($q$select public.fin_stock_report(%L, 'purchases', null, current_date - 365, current_date)$q$, c));
  perform pg_temp.timeit('lista de transferências', format($q$select count(*) from public.fin_stock_transfers(%L)$q$, c));
  -- inventário completo da unidade 1 (3.000 lotes)
  t0 := clock_timestamp();
  inv := public.fin_inventory_open(c, u1, '{}'::jsonb);
  insert into tm values ('abrir inventário (3.000 linhas)', round(extract(epoch from clock_timestamp() - t0) * 1000, 1));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  t0 := clock_timestamp();
  select public.fin_inventory_count(inv, (select jsonb_agg(jsonb_build_object('line_id', x.id, 'counted_qty', 0)) from (select l.id from public.fin_inventory_lines(inv) l limit 500) x)) into n;
  insert into tm values ('contar 500 linhas (uma chamada)', round(extract(epoch from clock_timestamp() - t0) * 1000, 1));
  perform pg_temp.timeit('listar linhas do inventário (3.000)', format($q$select count(*) from public.fin_inventory_lines(%L)$q$, inv));
  perform pg_temp.timeit('lista de inventários', format($q$select count(*) from public.fin_inventory_list(%L)$q$, c));
  perform pg_temp.su();
  -- conta o resto com o valor esperado (como se estivesse tudo certo) por SQL direto e aprova: ~3.000 linhas, ~500 com diferença
  update public.stock_inventory_lines set counted_qty = case when counted_qty is not null then counted_qty else expected_qty end, counted_at = now() where inventory_id = inv;
  perform pg_temp.as_user('estoq');
  t0 := clock_timestamp();
  n := public.fin_inventory_finish(inv);
  insert into tm values ('encerrar contagem (3.000 linhas, ' || n || ' diferenças)', round(extract(epoch from clock_timestamp() - t0) * 1000, 1));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.timeit('revisão: listar linhas com diferença (3.000)', format($q$select count(*) from public.fin_inventory_lines(%L)$q$, inv));
  t0 := clock_timestamp();
  perform public.fin_inventory_approve(inv, 'Perf');
  insert into tm values ('aprovar inventário (' || n || ' ajustes)', round(extract(epoch from clock_timestamp() - t0) * 1000, 1));
  perform pg_temp.su();
end $t$;

select label || '|' || ms from tm order by ctid;
