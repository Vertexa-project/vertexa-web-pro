-- =====================================================================================
-- FIN-E8 — Financeiro / Repasse / Estoque · Entrega 8 (inventário com contagem cega, transferências entre unidades, alertas e relatórios de estoque).
-- ADITIVA: tabelas stock_transfers, stock_transfer_lines, stock_inventories, stock_inventory_lines; 2 colunas novas em stock_movements (transfer_id, inventory_id)
-- e 3 em fin_settings (janelas de alerta, com padrão); RPCs fin_stock_transfer_*, fin_inventory_*, fin_stock_alert*, fin_stock_report; índices.
-- Recria (create or replace) private.fin_area_roles e public.fin_my_access (corpo da E7 + área 'inv_manage'), private.stock_apply e private.stock_reverse_one
-- (corpo da E3 + vínculo com transferência/inventário; o estorno manual de movimentação de transferência/inventário passa a ser recusado: use cancelar/reabrir).
-- Depende de E1..E7 (20261113100000 … 20261116100000).
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local: scripts/fin-e8-sql-proof.sh).
--
-- Regras que valem no servidor (escopo-v1 §3, §8.2, §8.6, §8.7, §8.8, §11, §12.2 E6, E7, E10, E16):
--  * escrita SÓ por RPC security definer (search_path vazio); tabelas novas sem INSERT/UPDATE/DELETE para anon/authenticated; sem exclusão física (gatilhos);
--  * todo ajuste, saída e entrada passa por private.stock_apply: saldo = soma das movimentações (imutáveis); log em fin_audit_log na mesma transação;
--  * inventário: contagem cega — stock_inventory_lines não tem leitura direta; fin_inventory_lines só devolve o esperado a quem revisa e só com a contagem encerrada;
--    diferença = contado − (saldo congelado + movimentado entre o congelamento e o fim da contagem); aprovar lança ajuste «inventory» a custo médio vigente;
--  * transferência: enviar tira da origem (custo médio da origem), fica em trânsito (fora do saldo das duas unidades), receber confere cada linha; diferença
--    vira perda da origem com motivo; cancelar antes de receber devolve à origem por estorno;
--  * área nova 'inv_manage' (aprovar: Gestor/Admin; consultar: + Financeiro). Contar/transferir/receber/alertas/relatórios: área stock_move (Estoquista e Gestor;
--    Financeiro só consulta). Recepção e profissional não acessam.
-- =====================================================================================

-- ---------- 1. Matriz de papéis e acesso do chamador (recriados: corpo da E7 + área 'inv_manage') ----------
create or replace function private.fin_area_roles(p_area text, p_write boolean) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_area = 'units'       then case when p_write then '{}'::text[] else array['gestor','financeiro','estoquista','recepcao'] end
    when p_area = 'staff'       then '{}'::text[]
    when p_area in ('services','packages','payment','tax','pro_finance') then array['gestor','financeiro']
    when p_area = 'settings'    then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'audit'       then case when p_write then '{}'::text[] else array['gestor'] end
    when p_area = 'stock_items' then case when p_write then array['gestor','estoquista'] else array['gestor','estoquista','financeiro'] end
    -- E2
    when p_area = 'sales'           then array['gestor','financeiro','recepcao']
    when p_area = 'sales_price'     then array['gestor','financeiro']
    when p_area = 'sale_cancel'     then case when p_write then array['gestor','financeiro'] else array['gestor','financeiro','recepcao'] end
    when p_area = 'cash'            then array['gestor','financeiro','recepcao']
    when p_area = 'cash_all'        then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    when p_area = 'cash_approve'    then array['gestor']
    when p_area = 'receivables'     then array['gestor','financeiro']
    when p_area = 'receivables_fix' then array['gestor']
    when p_area = 'compliance'      then case when p_write then '{}'::text[] else array['gestor'] end
    -- E3
    when p_area = 'stock_move'      then case when p_write then array['gestor','estoquista'] else array['gestor','estoquista','financeiro'] end
    -- E4
    when p_area = 'appt'            then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'patient_pkg'     then case when p_write then '{}'::text[] else array['gestor','financeiro','recepcao'] end
    when p_area = 'package_deliver' then array['gestor','estoquista','recepcao']
    -- E5
    when p_area = 'share_rules'     then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'share_lines'     then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    when p_area = 'share_recalc'    then array['gestor','financeiro']
    -- E6
    when p_area = 'close_prepare'   then array['gestor','financeiro']
    when p_area = 'close_decide'    then array['gestor']
    when p_area = 'close_pay'       then array['gestor','financeiro']
    -- E7: painel financeiro da clínica (escopo §3: Gestor nas unidades autorizadas, Financeiro «vê dashboard»; Admin/Owner sempre). Só leitura.
    when p_area = 'dash'            then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    -- E8: inventário (abrir, reabrir, cancelar e APROVAR os ajustes: só Gestor e Admin/Owner; o Financeiro vê esperado × contado × valor). Contar, transferir
    -- e receber seguem a área stock_move (Estoquista e Gestor). Alertas e relatórios de estoque também (leitura: Gestor, Estoquista e Financeiro).
    when p_area = 'inv_manage'      then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move',
                                'appt','patient_pkg','package_deliver','share_rules','share_lines','share_recalc',
                                'close_prepare','close_decide','close_pay','dash','inv_manage'];
        a text; v_can jsonb := '{}'::jsonb; v_roles jsonb; v_pro boolean;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then
    return jsonb_build_object('is_admin', false, 'roles', '[]'::jsonb, 'can', '{}'::jsonb);
  end if;
  foreach a in array v_areas loop
    v_can := v_can || jsonb_build_object(a || '_read', private.fin_can(p_clinic, a, null, false), a || '_write', private.fin_can(p_clinic, a, null, true));
  end loop;
  select exists (select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active') into v_pro;
  -- Profissional (sem papel financeiro) vê só a PRÓPRIA produção: vendas em que é vendedor e atendimentos em que participa.
  v_can := v_can || jsonb_build_object('own_sales_read', v_pro, 'own_appt', private.appt_is_pro(p_clinic), 'own_share', private.appt_is_pro(p_clinic));
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids))), '[]'::jsonb)
    into v_roles
    from public.clinic_staff_roles r
    join public.professionals pr on pr.id = r.professional_id
   where r.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  return jsonb_build_object('is_admin', private.is_clinic_admin(p_clinic), 'roles', v_roles, 'can', v_can);
end $$;


-- ---------- 2. Colunas e configurações novas (todas com padrão: nada muda até alguém usar) ----------
alter table public.stock_movements add column if not exists transfer_id uuid;
alter table public.stock_movements add column if not exists inventory_id uuid;
alter table public.fin_settings add column if not exists stock_expiry_alert_days integer[] not null default '{90,60,30}';
alter table public.fin_settings add column if not exists stock_idle_days integer not null default 90;
alter table public.fin_settings add column if not exists stock_transfer_alert_days integer not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_settings_stock_alerts_chk' and conrelid = 'public.fin_settings'::regclass) then
    alter table public.fin_settings add constraint fin_settings_stock_alerts_chk check (
      cardinality(stock_expiry_alert_days) between 1 and 5 and stock_idle_days between 7 and 730 and stock_transfer_alert_days between 1 and 60);
  end if;
end $$;

-- ---------- 3. Tabelas: transferência entre unidades ----------
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  number integer not null,
  from_unit_id uuid not null references public.clinic_units(id),
  to_unit_id uuid not null references public.clinic_units(id),
  status text not null default 'in_transit' check (status in ('in_transit','received','canceled')),
  notes text check (notes is null or char_length(notes) <= 500),
  sent_at timestamptz not null default now(),
  sent_by uuid,
  received_at timestamptz,
  received_by uuid,
  receive_note text check (receive_note is null or char_length(receive_note) <= 500),
  canceled_at timestamptz,
  canceled_by uuid,
  cancel_reason text,
  created_at timestamptz not null default now(),
  unique (clinic_id, number),
  check (from_unit_id <> to_unit_id),
  check (status <> 'received' or (received_at is not null and received_by is not null)),
  check (status <> 'canceled' or (canceled_at is not null and char_length(btrim(coalesce(cancel_reason, ''))) >= 3))
);
create index if not exists stock_transfers_clinic_idx on public.stock_transfers (clinic_id, sent_at desc);
create index if not exists stock_transfers_transit_idx on public.stock_transfers (clinic_id, sent_at) where status = 'in_transit';
create index if not exists stock_transfers_from_idx on public.stock_transfers (from_unit_id, sent_at desc);
create index if not exists stock_transfers_to_idx on public.stock_transfers (to_unit_id, sent_at desc);

create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  item_id uuid not null references public.stock_items(id),
  lot_id uuid not null references public.stock_lots(id),
  lot_code text not null,
  expiry_date date,
  qty_sent numeric(14,3) not null check (qty_sent > 0),
  unit_cost_cents numeric(16,4) not null check (unit_cost_cents >= 0),
  total_cost_cents bigint not null check (total_cost_cents >= 0),
  out_movement_id uuid not null references public.stock_movements(id),
  qty_received numeric(14,3) check (qty_received is null or (qty_received >= 0)),
  dest_lot_id uuid references public.stock_lots(id),
  dest_lot_code text,
  dest_expiry_date date,
  received_cost_cents bigint check (received_cost_cents is null or received_cost_cents >= 0),
  in_movement_id uuid references public.stock_movements(id),
  loss_qty numeric(14,3) check (loss_qty is null or loss_qty >= 0),
  loss_cents bigint check (loss_cents is null or loss_cents >= 0),
  receive_reason text check (receive_reason is null or char_length(receive_reason) <= 300),
  created_at timestamptz not null default now(),
  check (qty_received is null or qty_received <= qty_sent),
  check (qty_received is null or loss_qty = qty_sent - qty_received),
  check (loss_qty is null or loss_qty = 0 or char_length(btrim(coalesce(receive_reason, ''))) >= 3)
);
create index if not exists stock_transfer_lines_transfer_idx on public.stock_transfer_lines (transfer_id);
create index if not exists stock_transfer_lines_loss_idx on public.stock_transfer_lines (clinic_id) where loss_qty > 0;

-- ---------- 4. Tabelas: inventário (contagem cega) ----------
create table if not exists public.stock_inventories (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  number integer not null,
  name text check (name is null or char_length(name) <= 120),
  scope text not null default 'all' check (scope in ('all','category','type')),
  scope_value text,
  blind boolean not null default true,
  status text not null default 'counting' check (status in ('counting','review','approved','canceled')),
  notes text check (notes is null or char_length(notes) <= 500),
  frozen_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  finished_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  approve_note text,
  canceled_at timestamptz,
  canceled_by uuid,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (clinic_id, number),
  check (scope = 'all' or char_length(btrim(coalesce(scope_value, ''))) >= 1),
  check (status <> 'approved' or (approved_at is not null and approved_by is not null)),
  check (status <> 'canceled' or (canceled_at is not null and char_length(btrim(coalesce(cancel_reason, ''))) >= 3)),
  check (status not in ('review','approved') or finished_at is not null)
);
create unique index if not exists stock_inventories_active_uq on public.stock_inventories (unit_id) where status in ('counting','review');
create index if not exists stock_inventories_clinic_idx on public.stock_inventories (clinic_id, created_at desc);

create table if not exists public.stock_inventory_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.stock_inventories(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  item_id uuid not null references public.stock_items(id),
  lot_id uuid references public.stock_lots(id),
  lot_code text not null check (char_length(btrim(lot_code)) between 1 and 60),
  expiry_date date,
  expected_qty numeric(14,3) not null default 0 check (expected_qty >= 0),   -- saldo congelado (NUNCA sai nas telas de quem conta)
  is_extra boolean not null default false,                                    -- item/lote que o contador achou e não estava na lista congelada
  counted_qty numeric(14,3) check (counted_qty is null or counted_qty >= 0),
  counted_by uuid,
  counted_at timestamptz,
  moved_qty numeric(14,3),                                                    -- movimentações ocorridas entre o congelamento e o fim da contagem
  diff_qty numeric(14,3),                                                     -- contado − (esperado + movimentado)
  avg_cost_cents numeric(16,4),                                               -- custo médio vigente na aprovação
  diff_value_cents bigint,
  adjust_movement_id uuid references public.stock_movements(id),
  created_at timestamptz not null default now(),
  unique (inventory_id, item_id, lot_code)
);
create index if not exists stock_inventory_lines_inv_idx on public.stock_inventory_lines (inventory_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_transfer_fk') then
    alter table public.stock_movements add constraint stock_movements_transfer_fk foreign key (transfer_id) references public.stock_transfers(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_inventory_fk') then
    alter table public.stock_movements add constraint stock_movements_inventory_fk foreign key (inventory_id) references public.stock_inventories(id);
  end if;
end $$;
create index if not exists stock_movements_transfer_idx on public.stock_movements (transfer_id) where transfer_id is not null;
create index if not exists stock_movements_inventory_idx on public.stock_movements (inventory_id) where inventory_id is not null;
create index if not exists stock_movements_loss_idx on public.stock_movements (clinic_id, occurred_on) where movement_type in ('loss','reversal');
create index if not exists stock_lots_expiry_idx on public.stock_lots (clinic_id, expiry_date) where qty_on_hand > 0 and expiry_date is not null;

-- ---------- 5. Sem edição nem exclusão fora do fluxo (documentos de transferência e de inventário) ----------
create or replace function private.stock_transfers_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'STOCK_DOC_IMMUTABLE: transferência não se apaga; cancele antes do recebimento' using errcode = '42501';
  end if;
  if old.status <> 'in_transit' then raise exception 'STOCK_DOC_IMMUTABLE: transferência já concluída' using errcode = '42501'; end if;
  if new.clinic_id <> old.clinic_id or new.from_unit_id <> old.from_unit_id or new.to_unit_id <> old.to_unit_id or new.number <> old.number
     or new.sent_at <> old.sent_at or new.sent_by is distinct from old.sent_by then
    raise exception 'STOCK_DOC_IMMUTABLE: dados do envio não se alteram' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists stock_transfers_guard_row on public.stock_transfers;
create trigger stock_transfers_guard_row before update or delete on public.stock_transfers for each row execute function private.stock_transfers_guard();

create or replace function private.stock_transfer_lines_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'STOCK_DOC_IMMUTABLE: linha de transferência não se apaga' using errcode = '42501';
  end if;
  if old.qty_received is not null then raise exception 'STOCK_DOC_IMMUTABLE: linha já conferida' using errcode = '42501'; end if;
  if new.transfer_id <> old.transfer_id or new.clinic_id <> old.clinic_id or new.item_id <> old.item_id or new.lot_id <> old.lot_id or new.qty_sent <> old.qty_sent
     or new.unit_cost_cents <> old.unit_cost_cents or new.total_cost_cents <> old.total_cost_cents or new.out_movement_id <> old.out_movement_id then
    raise exception 'STOCK_DOC_IMMUTABLE: dados do envio não se alteram' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists stock_transfer_lines_guard_row on public.stock_transfer_lines;
create trigger stock_transfer_lines_guard_row before update or delete on public.stock_transfer_lines for each row execute function private.stock_transfer_lines_guard();

create or replace function private.stock_inventories_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'STOCK_DOC_IMMUTABLE: inventário não se apaga; cancele' using errcode = '42501';
  end if;
  if old.status in ('approved','canceled') then raise exception 'STOCK_DOC_IMMUTABLE: inventário já encerrado' using errcode = '42501'; end if;
  if new.clinic_id <> old.clinic_id or new.unit_id <> old.unit_id or new.number <> old.number or new.scope <> old.scope or new.blind <> old.blind
     or new.frozen_at <> old.frozen_at or new.scope_value is distinct from old.scope_value then
    raise exception 'STOCK_DOC_IMMUTABLE: dados do congelamento não se alteram' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists stock_inventories_guard_row on public.stock_inventories;
create trigger stock_inventories_guard_row before update or delete on public.stock_inventories for each row execute function private.stock_inventories_guard();

create or replace function private.stock_inventory_lines_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'STOCK_DOC_IMMUTABLE: linha de inventário não se apaga' using errcode = '42501';
  end if;
  select status into v_status from public.stock_inventories where id = new.inventory_id;
  if tg_op = 'INSERT' then
    if v_status is distinct from 'counting' then raise exception 'STOCK_DOC_IMMUTABLE: contagem encerrada' using errcode = '42501'; end if;
    return new;
  end if;
  if v_status not in ('counting','review') then raise exception 'STOCK_DOC_IMMUTABLE: inventário encerrado' using errcode = '42501'; end if;
  if new.inventory_id <> old.inventory_id or new.item_id <> old.item_id or new.lot_code <> old.lot_code or new.expected_qty <> old.expected_qty or new.is_extra <> old.is_extra
     or (old.lot_id is not null and new.lot_id is distinct from old.lot_id) or new.clinic_id <> old.clinic_id then
    raise exception 'STOCK_DOC_IMMUTABLE: saldo congelado não se altera' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists stock_inventory_lines_guard_row on public.stock_inventory_lines;
create trigger stock_inventory_lines_guard_row before insert or update or delete on public.stock_inventory_lines for each row execute function private.stock_inventory_lines_guard();

-- ---------- 6. RLS e grants ----------
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_inventories enable row level security;
alter table public.stock_inventory_lines enable row level security;
revoke all on public.stock_transfers, public.stock_transfer_lines, public.stock_inventories, public.stock_inventory_lines from anon, authenticated;
grant select on public.stock_transfers, public.stock_transfer_lines, public.stock_inventories to authenticated;
-- stock_inventory_lines: SEM leitura direta (guarda o saldo esperado; a contagem é cega). Só as RPCs, que escondem o esperado de quem conta.
drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers for select to authenticated
  using (private.fin_can(clinic_id, 'stock_move', from_unit_id, false) or private.fin_can(clinic_id, 'stock_move', to_unit_id, false));
drop policy if exists stock_transfer_lines_select on public.stock_transfer_lines;
create policy stock_transfer_lines_select on public.stock_transfer_lines for select to authenticated
  using (private.fin_can(clinic_id, 'stock_move', null, false) and exists (select 1 from public.stock_transfers t where t.id = transfer_id));
drop policy if exists stock_inventories_select on public.stock_inventories;
create policy stock_inventories_select on public.stock_inventories for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));

-- ---------- 7. Núcleo recriado (create or replace; corpo da E3 + vínculos com transferência e inventário) ----------
-- stock_apply: idêntica à da E3, mais as colunas transfer_id e inventory_id (vêm de p_ctx).
create or replace function private.stock_apply(p_clinic uuid, p_unit uuid, p_item uuid, p_lot uuid, p_open uuid, p_entry uuid, p_type text,
                                               p_qty numeric, p_total bigint, p_recalc boolean, p_ctx jsonb)
returns public.stock_movements
language plpgsql security definer set search_path = '' as $$
declare b public.stock_balances; l public.stock_lots; m public.stock_movements; v_new numeric; v_avg numeric; v_unit_cost numeric; v_name text; v_orig uuid;
begin
  insert into public.stock_balances (item_id, unit_id, clinic_id) values (p_item, p_unit, p_clinic) on conflict (item_id, unit_id) do nothing;
  select * into b from public.stock_balances where item_id = p_item and unit_id = p_unit for update;
  select * into l from public.stock_lots where id = p_lot and item_id = p_item and unit_id = p_unit for update;
  if l.id is null then raise exception 'INVALID_LOT' using errcode = '22023'; end if;
  v_new := b.qty_on_hand + p_qty;
  if v_new < 0 or l.qty_on_hand + p_qty < 0 then raise exception 'INSUFFICIENT_STOCK' using errcode = '22023'; end if;
  v_avg := b.avg_cost_cents;
  -- CM novo = (saldo × CM atual + valor que entra) ÷ (saldo + qtde). Estorno de entrada usa o mesmo cálculo com sinais trocados.
  if p_recalc and v_new > 0 then v_avg := greatest(round((b.qty_on_hand * b.avg_cost_cents + p_total) / v_new, 4), 0); end if;
  update public.stock_lots set qty_on_hand = qty_on_hand + p_qty, updated_at = now() where id = l.id;
  update public.stock_balances set qty_on_hand = v_new, avg_cost_cents = v_avg, updated_at = now() where item_id = p_item and unit_id = p_unit;
  v_unit_cost := round(abs(p_total)::numeric / abs(p_qty), 4);
  v_orig := nullif(p_ctx->>'reversed_movement_id', '')::uuid;
  insert into public.stock_movements (clinic_id, unit_id, item_id, lot_id, open_unit_id, entry_id, movement_type, qty, unit_cost_cents, total_cost_cents, balance_after,
      avg_cost_after_cents, occurred_on, reason, purpose, loss_kind, patient_id, sale_id, appointment_id, reversed_movement_id, transfer_id, inventory_id, created_by)
    values (p_clinic, p_unit, p_item, l.id, p_open, p_entry, p_type, p_qty, v_unit_cost, p_total, v_new, v_avg,
      coalesce(nullif(p_ctx->>'occurred_on', '')::date, private.fin_today()), nullif(btrim(coalesce(p_ctx->>'reason', '')), ''), nullif(btrim(coalesce(p_ctx->>'purpose', '')), ''),
      nullif(p_ctx->>'loss_kind', ''), nullif(p_ctx->>'patient_id', '')::uuid, nullif(p_ctx->>'sale_id', '')::uuid, nullif(p_ctx->>'appointment_id', '')::uuid, v_orig,
      nullif(p_ctx->>'transfer_id', '')::uuid, nullif(p_ctx->>'inventory_id', '')::uuid, private.current_profile_id())
    returning * into m;
  select name into v_name from public.stock_items where id = p_item;
  perform private.fin_log(p_clinic, p_unit, 'stock_movement', m.id, case when p_type = 'reversal' then 'reverse' else 'create' end, null,
    jsonb_build_object('movement_type', m.movement_type, 'item_name', v_name, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'qty', m.qty,
      'unit_cost_cents', m.unit_cost_cents, 'total_cost_cents', m.total_cost_cents, 'balance_after', m.balance_after, 'avg_cost_after_cents', m.avg_cost_after_cents,
      'loss_kind', m.loss_kind, 'purpose', m.purpose, 'transfer_id', m.transfer_id, 'inventory_id', m.inventory_id), m.reason);
  return m;
end $$;

-- stock_reverse_one: idêntica à da E3, mais (a) a movimentação de transferência/inventário só se desfaz pelo fluxo próprio (cancelar/reabrir),
-- nunca pelo estorno manual (p_allow_sale = chamada interna autorizada) e (b) o estorno herda transfer_id e inventory_id da original.
create or replace function private.stock_reverse_one(p_movement uuid, p_reason text, p_allow_sale boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements; r public.stock_movements; ou public.stock_open_units; l public.stock_lots;
begin
  select * into m from public.stock_movements where id = p_movement for update;
  if m.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if m.movement_type = 'reversal' then raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '22023'; end if;
  if m.movement_type = 'sale' and not p_allow_sale then raise exception 'SALE_MOVEMENT_USE_CANCEL' using errcode = '22023'; end if;
  if m.movement_type in ('transfer_out','transfer_in','inventory') and not p_allow_sale then raise exception 'DOC_MOVEMENT_USE_FLOW' using errcode = '22023'; end if;
  if exists (select 1 from public.stock_movements x where x.reversed_movement_id = m.id) then raise exception 'ALREADY_REVERSED' using errcode = '22023'; end if;
  select * into l from public.stock_lots where id = m.lot_id for update;
  if m.qty > 0 and l.qty_on_hand - private.stock_lot_open_qty(l.id) < m.qty then raise exception 'REVERSAL_NO_STOCK' using errcode = '22023'; end if;
  r := private.stock_apply(m.clinic_id, m.unit_id, m.item_id, m.lot_id, m.open_unit_id, null, 'reversal', -m.qty, -m.total_cost_cents, true,
         jsonb_build_object('reason', p_reason, 'reversed_movement_id', m.id, 'patient_id', m.patient_id, 'sale_id', m.sale_id, 'transfer_id', m.transfer_id, 'inventory_id', m.inventory_id));
  if m.qty < 0 and m.open_unit_id is not null then
    select * into ou from public.stock_open_units where id = m.open_unit_id for update;
    update public.stock_open_units set qty_remaining = least(qty_remaining + abs(m.qty), 1),
        status = case when qty_remaining + abs(m.qty) >= 1 then 'closed' else 'open' end,
        closed_at = case when qty_remaining + abs(m.qty) >= 1 then now() else null end,
        close_reason = case when qty_remaining + abs(m.qty) >= 1 then 'reversed' else null end
      where id = ou.id;
  end if;
  return r.id;
end $$;

-- Unidades do estoque que o chamador alcança (por unidade, nunca pela clínica inteira). p_unit informado precisa estar entre elas.
create or replace function private.stock_units(p_clinic uuid, p_unit uuid, p_write boolean default false) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare v uuid[];
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_unit is not null then
    if not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic) or not private.fin_can(p_clinic, 'stock_move', p_unit, p_write) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    return array[p_unit];
  end if;
  select coalesce(array_agg(u.id), '{}') into v from public.clinic_units u where u.clinic_id = p_clinic and private.fin_can(p_clinic, 'stock_move', u.id, p_write);
  if cardinality(v) = 0 then raise exception 'forbidden' using errcode = '42501'; end if;
  return v;
end $$;

-- ---------- 8. Transferência entre unidades (escopo §8.7, E6) ----------
-- Enviar: sai da origem (FEFO ou o lote escolhido; só unidades inteiras livres; lote vencido não vai), fica «em trânsito» (fora do saldo das duas unidades).
-- p_lines: [{item_id, quantity, lot_id?}]. Custo: custo médio da ORIGEM no envio (não muda o custo médio da origem).
create or replace function public.fin_stock_transfer_send(p_clinic uuid, p_from uuid, p_to uuid, p_lines jsonb, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uf public.clinic_units; ut public.clinic_units; t public.stock_transfers; x jsonb; it public.stock_items; b public.stock_balances; l public.stock_lots; m public.stock_movements;
  v_qty numeric; v_left numeric; v_take numeric; v_avail numeric; v_lot uuid; v_today date := private.fin_today(); v_num integer; v_tid uuid := gen_random_uuid();
  v_cost bigint; v_sum bigint := 0; v_lines jsonb := '[]'::jsonb;
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_from, true);
  select * into uf from public.clinic_units where id = p_from and clinic_id = p_clinic;
  select * into ut from public.clinic_units where id = p_to and clinic_id = p_clinic;
  if uf.id is null or ut.id is null then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if p_from = p_to then raise exception 'SAME_UNIT' using errcode = '22023'; end if;
  if not uf.is_active or not ut.is_active then raise exception 'UNIT_INACTIVE' using errcode = '22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'LINES_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stock_transfer:' || p_clinic::text, 0));
  select coalesce(max(number), 0) + 1 into v_num from public.stock_transfers where clinic_id = p_clinic;
  insert into public.stock_transfers (id, clinic_id, number, from_unit_id, to_unit_id, notes, sent_by)
    values (v_tid, p_clinic, v_num, p_from, p_to, nullif(btrim(coalesce(p_notes, '')), ''), private.current_profile_id()) returning * into t;
  for x in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.stock_items where id = nullif(x->>'item_id', '')::uuid and clinic_id = p_clinic;
    if it.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    v_qty := nullif(x->>'quantity', '')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;   -- só unidades inteiras (dose aberta não se transfere)
    v_lot := nullif(x->>'lot_id', '')::uuid;
    if v_lot is not null and not exists (select 1 from public.stock_lots z where z.id = v_lot and z.item_id = it.id and z.unit_id = p_from) then raise exception 'INVALID_LOT' using errcode = '22023'; end if;
    select * into b from public.stock_balances where item_id = it.id and unit_id = p_from for update;
    if b.item_id is null or b.qty_on_hand < v_qty then raise exception 'INSUFFICIENT_STOCK' using errcode = '22023'; end if;
    v_left := v_qty;
    for l in select * from public.stock_lots z where z.item_id = it.id and z.unit_id = p_from and (v_lot is null or z.id = v_lot)
                order by z.expiry_date nulls last, z.lot_code, z.id for update loop
      exit when v_left <= 0;
      if l.expiry_date is not null and l.expiry_date < v_today then
        if v_lot is not null then raise exception 'LOT_EXPIRED' using errcode = '22023'; end if;
        continue;
      end if;
      v_avail := trunc(l.qty_on_hand - private.stock_lot_open_qty(l.id));
      if v_avail <= 0 then continue; end if;
      v_take := least(v_avail, v_left);
      v_cost := round(v_take * b.avg_cost_cents)::bigint;
      m := private.stock_apply(p_clinic, p_from, it.id, l.id, null, null, 'transfer_out', -v_take, -v_cost, false,
             jsonb_build_object('transfer_id', v_tid, 'reason', left(format('Transferência nº %s para %s', v_num, ut.name), 300)));
      insert into public.stock_transfer_lines (transfer_id, clinic_id, item_id, lot_id, lot_code, expiry_date, qty_sent, unit_cost_cents, total_cost_cents, out_movement_id)
        values (v_tid, p_clinic, it.id, l.id, l.lot_code, l.expiry_date, v_take, b.avg_cost_cents, v_cost, m.id);
      v_lines := v_lines || jsonb_build_object('item_name', it.name, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'qty', v_take, 'total_cost_cents', v_cost);
      v_sum := v_sum + v_cost; v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      if exists (select 1 from public.stock_lots z where z.item_id = it.id and z.unit_id = p_from and z.qty_on_hand > 0 and z.expiry_date < v_today and (v_lot is null or z.id = v_lot)) then
        raise exception 'LOT_EXPIRED' using errcode = '22023';
      end if;
      raise exception 'INSUFFICIENT_STOCK' using errcode = '22023';
    end if;
  end loop;
  perform private.fin_log(p_clinic, p_from, 'stock_transfer', v_tid, 'create', null,
    jsonb_build_object('number', v_num, 'status', 'in_transit', 'from_unit', uf.name, 'to_unit', ut.name, 'total_cost_cents', v_sum, 'lines', v_lines), p_notes);
  return v_tid;
end $$;

-- Receber no destino: conferência de TODAS as linhas (quantidade e lote). Divergência (quantidade a menos ou lote diferente) exige motivo.
-- Destino +recebido ao custo médio da origem (recalcula o custo médio do destino); a diferença vira perda da ORIGEM, registrada na linha e no log
-- (a saída já saiu do saldo da origem no envio: nenhuma movimentação a mais, o saldo continua = soma das movimentações).
-- p_lines: [{line_id, quantity, lot_code?, expiry_date?, reason?}]
create or replace function public.fin_stock_transfer_receive(p_transfer uuid, p_lines jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.stock_transfers; tl public.stock_transfer_lines; x jsonb; it public.stock_items; dl public.stock_lots; m public.stock_movements; ut public.clinic_units; uf public.clinic_units;
  v_qty numeric; v_code text; v_exp date; v_reason text; v_recv bigint; v_loss numeric; v_loss_cents bigint; v_n integer := 0; v_lines jsonb := '[]'::jsonb;
  v_loss_total bigint := 0; v_recv_total bigint := 0; v_seen uuid[] := '{}'; v_expected integer;
begin
  select * into t from public.stock_transfers where id = p_transfer for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(t.clinic_id, 'stock_move', t.to_unit_id, true);
  if t.status <> 'in_transit' then raise exception 'NOT_IN_TRANSIT' using errcode = '22023'; end if;
  select * into uf from public.clinic_units where id = t.from_unit_id; select * into ut from public.clinic_units where id = t.to_unit_id;
  select count(*) into v_expected from public.stock_transfer_lines where transfer_id = t.id;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> v_expected then raise exception 'ALL_LINES_REQUIRED' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    select * into tl from public.stock_transfer_lines where id = nullif(x->>'line_id', '')::uuid and transfer_id = t.id for update;
    if tl.id is null or tl.id = any (v_seen) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;
    v_seen := v_seen || tl.id;
    v_qty := nullif(x->>'quantity', '')::numeric;
    if v_qty is null or v_qty < 0 or v_qty > tl.qty_sent or v_qty <> round(v_qty, 3) then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
    select * into it from public.stock_items where id = tl.item_id;
    v_code := coalesce(nullif(btrim(coalesce(x->>'lot_code', '')), ''), tl.lot_code);
    v_exp := coalesce(nullif(x->>'expiry_date', '')::date, tl.expiry_date);
    v_reason := nullif(btrim(coalesce(x->>'reason', '')), '');
    v_loss := tl.qty_sent - v_qty;
    if (v_loss > 0 or v_code <> tl.lot_code or v_exp is distinct from tl.expiry_date) and (v_reason is null or char_length(v_reason) < 3) then
      raise exception 'DIVERGENCE_REASON_REQUIRED' using errcode = '22023';
    end if;
    v_recv := round(v_qty * tl.unit_cost_cents)::bigint;
    v_loss_cents := tl.total_cost_cents - v_recv;
    dl := null; m := null;
    if v_qty > 0 then
      if it.lot_control and v_exp is null then raise exception 'LOT_REQUIRED' using errcode = '22023'; end if;
      select * into dl from public.stock_lots where item_id = tl.item_id and unit_id = t.to_unit_id and lot_code = v_code for update;
      if dl.id is null then
        insert into public.stock_lots (clinic_id, unit_id, item_id, lot_code, expiry_date) values (t.clinic_id, t.to_unit_id, tl.item_id, v_code, v_exp) returning * into dl;
      elsif dl.expiry_date is distinct from v_exp then
        if dl.expiry_date is null and v_exp is not null then update public.stock_lots set expiry_date = v_exp where id = dl.id returning * into dl;
        elsif v_exp is not null then raise exception 'LOT_EXPIRY_MISMATCH' using errcode = '22023'; end if;
      end if;
      m := private.stock_apply(t.clinic_id, t.to_unit_id, tl.item_id, dl.id, null, null, 'transfer_in', v_qty, v_recv, true,
             jsonb_build_object('transfer_id', t.id, 'reason', left(format('Transferência nº %s de %s', t.number, uf.name), 300)));
    end if;
    update public.stock_transfer_lines set qty_received = v_qty, dest_lot_id = dl.id, dest_lot_code = case when v_qty > 0 then v_code end,
        dest_expiry_date = case when v_qty > 0 then v_exp end, received_cost_cents = v_recv, in_movement_id = m.id, loss_qty = v_loss, loss_cents = v_loss_cents,
        receive_reason = v_reason
      where id = tl.id;
    v_loss_total := v_loss_total + v_loss_cents; v_recv_total := v_recv_total + v_recv; v_n := v_n + 1;
    v_lines := v_lines || jsonb_build_object('item_name', it.name, 'lot_code', tl.lot_code, 'qty_sent', tl.qty_sent, 'qty_received', v_qty, 'loss_qty', v_loss,
                                              'loss_cents', v_loss_cents, 'reason', v_reason);
    if v_loss > 0 then
      perform private.fin_log(t.clinic_id, t.from_unit_id, 'stock_transfer_loss', tl.id, 'create', null,
        jsonb_build_object('transfer_number', t.number, 'item_name', it.name, 'lot_code', tl.lot_code, 'loss_qty', v_loss, 'loss_cents', v_loss_cents, 'to_unit', ut.name), v_reason);
    end if;
  end loop;
  update public.stock_transfers set status = 'received', received_at = now(), received_by = private.current_profile_id(), receive_note = nullif(btrim(coalesce(p_note, '')), '') where id = t.id;
  perform private.fin_log(t.clinic_id, t.to_unit_id, 'stock_transfer', t.id, 'update', jsonb_build_object('status', 'in_transit'),
    jsonb_build_object('status', 'received', 'number', t.number, 'received_cents', v_recv_total, 'loss_cents', v_loss_total, 'lines', v_lines), p_note);
  return jsonb_build_object('transfer_id', t.id, 'lines', v_n, 'received_cents', v_recv_total, 'loss_cents', v_loss_total);
end $$;

-- Cancelar antes de receber: devolve tudo à origem (estorno de cada saída; o custo médio da origem é recalculado pela mesma conta do estorno). Motivo obrigatório.
create or replace function public.fin_stock_transfer_cancel(p_transfer uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers; r record; v_n integer := 0;
begin
  select * into t from public.stock_transfers where id = p_transfer for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (private.fin_can(t.clinic_id, 'stock_move', t.from_unit_id, true) or private.fin_can(t.clinic_id, 'stock_move', t.to_unit_id, true)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.status <> 'in_transit' then raise exception 'NOT_IN_TRANSIT' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  for r in select out_movement_id from public.stock_transfer_lines where transfer_id = t.id order by out_movement_id loop
    perform private.stock_reverse_one(r.out_movement_id, 'Transferência nº ' || t.number || ' cancelada: ' || btrim(p_reason), true);
    v_n := v_n + 1;
  end loop;
  update public.stock_transfers set status = 'canceled', canceled_at = now(), canceled_by = private.current_profile_id(), cancel_reason = btrim(p_reason) where id = t.id;
  perform private.fin_log(t.clinic_id, t.from_unit_id, 'stock_transfer', t.id, 'reverse', jsonb_build_object('status', 'in_transit'),
    jsonb_build_object('status', 'canceled', 'number', t.number, 'lines', v_n), p_reason);
end $$;

-- Lista de transferências (cabeçalho + linhas) das unidades que o chamador alcança (origem OU destino). Custo e valor: quem lê o estoque (E3).
create or replace function public.fin_stock_transfers(p_clinic uuid, p_unit uuid default null, p_status text default null, p_from date default null, p_to date default null,
                                                      p_limit integer default 100, p_offset integer default 0)
returns table (id uuid, number integer, status text, from_unit_id uuid, from_unit_name text, to_unit_id uuid, to_unit_name text, sent_at timestamptz, sent_by_name text,
               received_at timestamptz, received_by_name text, canceled_at timestamptz, cancel_reason text, notes text, receive_note text, age_days integer, stale boolean,
               can_receive boolean, can_cancel boolean, lines_count bigint, sent_cents bigint, received_cents bigint, loss_cents bigint, lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_units uuid[]; v_today date := private.fin_today(); v_stale integer;
begin
  v_units := private.stock_units(p_clinic, p_unit, false);
  select coalesce((select s.stock_transfer_alert_days from public.fin_settings s where s.clinic_id = p_clinic), 3) into v_stale;
  return query
    with page as (
      select t.* from public.stock_transfers t
       where t.clinic_id = p_clinic and (t.from_unit_id = any (v_units) or t.to_unit_id = any (v_units))
         and (p_status is null or t.status = p_status)
         and (p_from is null or (t.sent_at at time zone 'America/Sao_Paulo')::date >= p_from) and (p_to is null or (t.sent_at at time zone 'America/Sao_Paulo')::date <= p_to)
       order by t.sent_at desc, t.id
       limit least(greatest(coalesce(p_limit, 100), 1), 300) offset greatest(coalesce(p_offset, 0), 0))
    select t.id, t.number, t.status, t.from_unit_id, uf.name, t.to_unit_id, ut.name, t.sent_at, spr.full_name, t.received_at, rpr.full_name, t.canceled_at, t.cancel_reason,
           t.notes, t.receive_note,
           (v_today - (t.sent_at at time zone 'America/Sao_Paulo')::date)::integer,
           (t.status = 'in_transit' and (v_today - (t.sent_at at time zone 'America/Sao_Paulo')::date) > v_stale),
           (t.status = 'in_transit' and private.fin_can(t.clinic_id, 'stock_move', t.to_unit_id, true)),
           (t.status = 'in_transit' and (private.fin_can(t.clinic_id, 'stock_move', t.from_unit_id, true) or private.fin_can(t.clinic_id, 'stock_move', t.to_unit_id, true))),
           (select count(*) from public.stock_transfer_lines l where l.transfer_id = t.id),
           (select coalesce(sum(l.total_cost_cents), 0)::bigint from public.stock_transfer_lines l where l.transfer_id = t.id),
           (select coalesce(sum(l.received_cost_cents), 0)::bigint from public.stock_transfer_lines l where l.transfer_id = t.id),
           (select coalesce(sum(l.loss_cents), 0)::bigint from public.stock_transfer_lines l where l.transfer_id = t.id),
           coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id, 'item_id', l.item_id, 'item_name', i.name, 'stock_unit', i.stock_unit, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date,
                       'qty_sent', l.qty_sent, 'qty_received', l.qty_received, 'unit_cost_cents', l.unit_cost_cents, 'total_cost_cents', l.total_cost_cents,
                       'received_cost_cents', l.received_cost_cents, 'loss_qty', l.loss_qty, 'loss_cents', l.loss_cents, 'receive_reason', l.receive_reason,
                       'dest_lot_code', l.dest_lot_code, 'dest_expiry_date', l.dest_expiry_date) order by i.name, l.lot_code)
                      from public.stock_transfer_lines l join public.stock_items i on i.id = l.item_id where l.transfer_id = t.id), '[]'::jsonb)
      from page t
      join public.clinic_units uf on uf.id = t.from_unit_id
      join public.clinic_units ut on ut.id = t.to_unit_id
      left join public.profiles spr on spr.id = t.sent_by
      left join public.profiles rpr on rpr.id = t.received_by
     order by t.sent_at desc, t.id;
end $$;

-- ---------- 9. Inventário com contagem cega (escopo §8.6, E7, E16) ----------
-- Abrir (Gestor/Admin): congela o saldo de cada item/lote da unidade (todo, por categoria ou por tipo). Quem conta NUNCA recebe o esperado.
-- p_data: {name, notes, scope: all|category|type, scope_value, blind (padrão true)}
create or replace function public.fin_inventory_open(p_clinic uuid, p_unit uuid, p_data jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_scope text := coalesce(nullif(p_data->>'scope', ''), 'all'); v_val text := nullif(btrim(coalesce(p_data->>'scope_value', '')), ''); v_blind boolean := coalesce((p_data->>'blind')::boolean, true);
  v_num integer; v_id uuid := gen_random_uuid(); v_frozen timestamptz; v_n integer; u public.clinic_units;
begin
  perform private.fin_gate(p_clinic, 'inv_manage', p_unit, true);
  select * into u from public.clinic_units where id = p_unit and clinic_id = p_clinic;
  if u.id is null then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if v_scope not in ('all','category','type') then raise exception 'INVALID_SCOPE' using errcode = '22023'; end if;
  if v_scope = 'category' and v_val is null then raise exception 'SCOPE_VALUE_REQUIRED' using errcode = '22023'; end if;
  if v_scope = 'type' and (v_val is null or v_val not in ('medication','compounded','resale','consumable')) then raise exception 'SCOPE_VALUE_REQUIRED' using errcode = '22023'; end if;
  if v_scope = 'all' then v_val := null; end if;
  if exists (select 1 from public.stock_inventories i where i.unit_id = p_unit and i.status in ('counting','review')) then raise exception 'INVENTORY_ALREADY_OPEN' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stock_inventory:' || p_clinic::text, 0));
  select coalesce(max(number), 0) + 1 into v_num from public.stock_inventories where clinic_id = p_clinic;
  -- Trava os lotes do escopo (quem está movimentando termina antes); o instante do congelamento vem DEPOIS da trava.
  perform 1 from public.stock_lots l join public.stock_items i on i.id = l.item_id
    where l.clinic_id = p_clinic and l.unit_id = p_unit and l.qty_on_hand > 0
      and (v_scope = 'all' or (v_scope = 'category' and i.category = v_val) or (v_scope = 'type' and i.item_type = v_val)) for share of l;
  v_frozen := clock_timestamp();
  insert into public.stock_inventories (id, clinic_id, unit_id, number, name, scope, scope_value, blind, notes, frozen_at, created_by)
    values (v_id, p_clinic, p_unit, v_num, nullif(btrim(coalesce(p_data->>'name', '')), ''), v_scope, v_val, v_blind, nullif(btrim(coalesce(p_data->>'notes', '')), ''), v_frozen, private.current_profile_id());
  insert into public.stock_inventory_lines (inventory_id, clinic_id, item_id, lot_id, lot_code, expiry_date, expected_qty)
    select v_id, p_clinic, l.item_id, l.id, l.lot_code, l.expiry_date, l.qty_on_hand
      from public.stock_lots l join public.stock_items i on i.id = l.item_id
     where l.clinic_id = p_clinic and l.unit_id = p_unit and l.qty_on_hand > 0
       and (v_scope = 'all' or (v_scope = 'category' and i.category = v_val) or (v_scope = 'type' and i.item_type = v_val));
  get diagnostics v_n = row_count;
  perform private.fin_log(p_clinic, p_unit, 'stock_inventory', v_id, 'create', null,
    jsonb_build_object('number', v_num, 'status', 'counting', 'unit', u.name, 'scope', v_scope, 'scope_value', v_val, 'blind', v_blind, 'lines', v_n), p_data->>'notes');
  return v_id;
end $$;

-- Contar (Estoquista/Gestor/Admin da unidade): [{line_id, counted_qty}] ou, para item/lote que a lista não trazia, [{item_id, lot_code?, expiry_date?, counted_qty}].
-- counted_qty nulo desfaz a contagem da linha. Item não fracionado só em unidades inteiras; até 3 casas.
create or replace function public.fin_inventory_count(p_inventory uuid, p_lines jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inv public.stock_inventories; x jsonb; ln public.stock_inventory_lines; it public.stock_items; l public.stock_lots; v_qty numeric; v_code text; v_exp date; v_n integer := 0; v_me uuid := private.current_profile_id();
begin
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if inv.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(inv.clinic_id, 'stock_move', inv.unit_id, true);
  if inv.status <> 'counting' then raise exception 'COUNT_CLOSED' using errcode = '22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'LINES_REQUIRED' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    v_qty := case when x ? 'counted_qty' and jsonb_typeof(x->'counted_qty') <> 'null' then (x->>'counted_qty')::numeric else null end;
    if v_qty is not null and (v_qty < 0 or v_qty <> round(v_qty, 3) or v_qty > 1000000) then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
    ln := null;
    if nullif(x->>'line_id', '') is not null then
      select * into ln from public.stock_inventory_lines where id = (x->>'line_id')::uuid and inventory_id = inv.id for update;
      if ln.id is null then raise exception 'INVALID_LINE' using errcode = '22023'; end if;
    else
      select * into it from public.stock_items where id = nullif(x->>'item_id', '')::uuid and clinic_id = inv.clinic_id;
      if it.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
      v_code := coalesce(nullif(btrim(coalesce(x->>'lot_code', '')), ''), case when it.lot_control then null else 'SEM LOTE' end);
      if v_code is null then raise exception 'LOT_REQUIRED' using errcode = '22023'; end if;
      select * into ln from public.stock_inventory_lines where inventory_id = inv.id and item_id = it.id and lot_code = v_code for update;
      if ln.id is null then
        select * into l from public.stock_lots where item_id = it.id and unit_id = inv.unit_id and lot_code = v_code;
        v_exp := coalesce(l.expiry_date, nullif(x->>'expiry_date', '')::date);
        if it.lot_control and v_exp is null then raise exception 'LOT_REQUIRED' using errcode = '22023'; end if;
        insert into public.stock_inventory_lines (inventory_id, clinic_id, item_id, lot_id, lot_code, expiry_date, expected_qty, is_extra)
          values (inv.id, inv.clinic_id, it.id, l.id, v_code, v_exp, 0, true) returning * into ln;
      end if;
    end if;
    select * into it from public.stock_items where id = ln.item_id;
    if v_qty is not null and not it.fractional and v_qty <> trunc(v_qty) then raise exception 'NOT_FRACTIONAL' using errcode = '22023'; end if;
    update public.stock_inventory_lines set counted_qty = v_qty, counted_by = case when v_qty is null then null else v_me end, counted_at = case when v_qty is null then null else now() end where id = ln.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Encerrar a contagem: tudo contado (ou o contador confirma que o que sobrou é zero). Calcula o que se moveu desde o congelamento e a diferença.
create or replace function public.fin_inventory_finish(p_inventory uuid, p_zero_uncounted boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare inv public.stock_inventories; v_fin timestamptz; v_un integer; v_me uuid := private.current_profile_id(); v_diffs integer;
begin
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if inv.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(inv.clinic_id, 'stock_move', inv.unit_id, true);
  if inv.status <> 'counting' then raise exception 'COUNT_CLOSED' using errcode = '22023'; end if;
  select count(*) into v_un from public.stock_inventory_lines where inventory_id = inv.id and counted_qty is null;
  if v_un > 0 and not coalesce(p_zero_uncounted, false) then raise exception 'UNCOUNTED_LINES' using errcode = '22023'; end if;
  if v_un > 0 then
    update public.stock_inventory_lines set counted_qty = 0, counted_by = v_me, counted_at = now() where inventory_id = inv.id and counted_qty is null;
  end if;
  v_fin := clock_timestamp();
  with mv as (
    select m.lot_id, sum(m.qty) as q from public.stock_movements m
     where m.clinic_id = inv.clinic_id and m.unit_id = inv.unit_id and m.created_at > inv.frozen_at and m.created_at <= v_fin and m.inventory_id is distinct from inv.id
     group by m.lot_id),
  calc as (
    select l.id, coalesce(mv.q, 0) as q from public.stock_inventory_lines l left join mv on mv.lot_id = l.lot_id where l.inventory_id = inv.id)
  update public.stock_inventory_lines l set moved_qty = calc.q, diff_qty = l.counted_qty - (l.expected_qty + calc.q) from calc where l.id = calc.id;
  update public.stock_inventories set status = 'review', finished_at = v_fin, finished_by = v_me where id = inv.id;
  select count(*) into v_diffs from public.stock_inventory_lines where inventory_id = inv.id and diff_qty <> 0;
  perform private.fin_log(inv.clinic_id, inv.unit_id, 'stock_inventory', inv.id, 'update', jsonb_build_object('status', 'counting'),
    jsonb_build_object('status', 'review', 'number', inv.number, 'lines_with_difference', v_diffs, 'zeroed_lines', v_un), null);
  return v_diffs;
end $$;

-- Reabrir a contagem para recontar (Gestor/Admin). Limpa o cálculo da revisão; as quantidades contadas ficam.
create or replace function public.fin_inventory_reopen(p_inventory uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.stock_inventories;
begin
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if inv.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(inv.clinic_id, 'inv_manage', inv.unit_id, true);
  if inv.status <> 'review' then raise exception 'NOT_IN_REVIEW' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  update public.stock_inventory_lines set moved_qty = null, diff_qty = null where inventory_id = inv.id;
  update public.stock_inventories set status = 'counting', finished_at = null, finished_by = null where id = inv.id;
  perform private.fin_log(inv.clinic_id, inv.unit_id, 'stock_inventory', inv.id, 'update', jsonb_build_object('status', 'review'), jsonb_build_object('status', 'counting', 'number', inv.number), p_reason);
end $$;

create or replace function public.fin_inventory_cancel(p_inventory uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.stock_inventories;
begin
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if inv.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(inv.clinic_id, 'inv_manage', inv.unit_id, true);
  if inv.status not in ('counting','review') then raise exception 'INVENTORY_CLOSED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  update public.stock_inventories set status = 'canceled', canceled_at = now(), canceled_by = private.current_profile_id(), cancel_reason = btrim(p_reason) where id = inv.id;
  perform private.fin_log(inv.clinic_id, inv.unit_id, 'stock_inventory', inv.id, 'deactivate', jsonb_build_object('status', inv.status), jsonb_build_object('status', 'canceled', 'number', inv.number), p_reason);
end $$;

-- Aprovar (Gestor/Admin): lança o ajuste de cada diferença (movimentação «inventory», ± a custo médio vigente, motivo «inventário»). Tudo ou nada.
-- Só a diferença contra (congelado + movimentado durante a contagem) vira ajuste; o que se moveu depois do fim da contagem não é tocado.
create or replace function public.fin_inventory_approve(p_inventory uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  inv public.stock_inventories; ln record; it public.stock_items; l public.stock_lots; b public.stock_balances; m public.stock_movements;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_diffs integer; v_avg numeric; v_total bigint; v_up bigint := 0; v_down bigint := 0; v_n integer := 0; v_lot uuid;
begin
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if inv.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(inv.clinic_id, 'inv_manage', inv.unit_id, true);
  if inv.status <> 'review' then raise exception 'NOT_IN_REVIEW' using errcode = '22023'; end if;
  select count(*) into v_diffs from public.stock_inventory_lines where inventory_id = inv.id and diff_qty <> 0;
  if v_diffs > 0 and (v_note is null or char_length(v_note) < 3) then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  for ln in select * from public.stock_inventory_lines where inventory_id = inv.id order by item_id, lot_code loop
    if ln.counted_qty is null or ln.diff_qty is null then raise exception 'UNCOUNTED_LINES' using errcode = '22023'; end if;
    select * into b from public.stock_balances where item_id = ln.item_id and unit_id = inv.unit_id;
    v_avg := coalesce(b.avg_cost_cents, 0);
    if ln.diff_qty = 0 then
      update public.stock_inventory_lines set avg_cost_cents = v_avg, diff_value_cents = 0 where id = ln.id;
      continue;
    end if;
    select * into it from public.stock_items where id = ln.item_id;
    v_lot := ln.lot_id;
    if v_lot is null then
      select id into v_lot from public.stock_lots where item_id = ln.item_id and unit_id = inv.unit_id and lot_code = ln.lot_code;
      if v_lot is null then
        insert into public.stock_lots (clinic_id, unit_id, item_id, lot_code, expiry_date) values (inv.clinic_id, inv.unit_id, ln.item_id, ln.lot_code, ln.expiry_date) returning id into v_lot;
      end if;
    end if;
    select * into l from public.stock_lots where id = v_lot for update;
    if l.qty_on_hand + ln.diff_qty < 0 then raise exception 'INVENTORY_LINE_STALE' using errcode = '22023'; end if;
    if l.qty_on_hand + ln.diff_qty < private.stock_lot_open_qty(l.id) then raise exception 'INVENTORY_BELOW_OPEN_UNITS' using errcode = '22023'; end if;
    v_total := round(ln.diff_qty * v_avg)::bigint;
    m := private.stock_apply(inv.clinic_id, inv.unit_id, ln.item_id, v_lot, null, null, 'inventory', ln.diff_qty, v_total, false,
           jsonb_build_object('inventory_id', inv.id, 'reason', left('Inventário nº ' || inv.number || coalesce(': ' || v_note, ''), 300)));
    update public.stock_inventory_lines set lot_id = v_lot, avg_cost_cents = v_avg, diff_value_cents = v_total, adjust_movement_id = m.id where id = ln.id;
    if v_total >= 0 then v_up := v_up + v_total; else v_down := v_down + v_total; end if;
    v_n := v_n + 1;
  end loop;
  update public.stock_inventories set status = 'approved', approved_at = now(), approved_by = private.current_profile_id(), approve_note = v_note where id = inv.id;
  perform private.fin_log(inv.clinic_id, inv.unit_id, 'stock_inventory', inv.id, 'update', jsonb_build_object('status', 'review'),
    jsonb_build_object('status', 'approved', 'number', inv.number, 'adjustments', v_n, 'increase_cents', v_up, 'decrease_cents', v_down), v_note);
  return jsonb_build_object('inventory_id', inv.id, 'adjustments', v_n, 'increase_cents', v_up, 'decrease_cents', v_down, 'net_cents', v_up + v_down);
end $$;

-- Lista de inventários. Esperado/diferença só para quem revisa (inv_manage) E só depois que a contagem foi encerrada (ou se a contagem não é cega).
create or replace function public.fin_inventory_list(p_clinic uuid, p_unit uuid default null, p_status text default null, p_inventory uuid default null,
                                                    p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, number integer, name text, unit_id uuid, unit_name text, scope text, scope_value text, blind boolean, status text, notes text, frozen_at timestamptz,
               finished_at timestamptz, approved_at timestamptz, approve_note text, canceled_at timestamptz, cancel_reason text, created_by_name text, approved_by_name text,
               lines_total bigint, lines_counted bigint, can_review boolean, can_count boolean, lines_with_difference bigint, increase_cents bigint, decrease_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_units uuid[];
begin
  v_units := private.stock_units(p_clinic, p_unit, false);
  return query
    with page as (
      select i.* from public.stock_inventories i
       where i.clinic_id = p_clinic and i.unit_id = any (v_units) and (p_status is null or i.status = p_status) and (p_inventory is null or i.id = p_inventory)
       order by i.created_at desc, i.id
       limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)),
    cnt as (
      select l.inventory_id, count(*) as total, count(*) filter (where l.counted_qty is not null) as counted,
             count(*) filter (where l.diff_qty <> 0) as diffs,
             coalesce(sum(case when i2.status = 'approved' then l.diff_value_cents else round(l.diff_qty * coalesce(b.avg_cost_cents, 0))::bigint end) filter (where l.diff_qty > 0), 0)::bigint as up,
             coalesce(sum(case when i2.status = 'approved' then l.diff_value_cents else round(l.diff_qty * coalesce(b.avg_cost_cents, 0))::bigint end) filter (where l.diff_qty < 0), 0)::bigint as down
        from public.stock_inventory_lines l
        join page i2 on i2.id = l.inventory_id
        left join public.stock_balances b on b.item_id = l.item_id and b.unit_id = i2.unit_id
       group by l.inventory_id)
    select i.id, i.number, i.name, i.unit_id, u.name, i.scope, i.scope_value, i.blind, i.status, i.notes, i.frozen_at, i.finished_at, i.approved_at, i.approve_note, i.canceled_at, i.cancel_reason,
           cpr.full_name, apr.full_name, coalesce(c.total, 0), coalesce(c.counted, 0),
           private.fin_can(i.clinic_id, 'inv_manage', i.unit_id, false),
           (i.status = 'counting' and private.fin_can(i.clinic_id, 'stock_move', i.unit_id, true)),
           case when private.fin_can(i.clinic_id, 'inv_manage', i.unit_id, false) and i.status in ('review','approved') then coalesce(c.diffs, 0) end,
           case when private.fin_can(i.clinic_id, 'inv_manage', i.unit_id, false) and i.status in ('review','approved') then coalesce(c.up, 0) end,
           case when private.fin_can(i.clinic_id, 'inv_manage', i.unit_id, false) and i.status in ('review','approved') then coalesce(c.down, 0) end
      from page i
      join public.clinic_units u on u.id = i.unit_id
      left join cnt c on c.inventory_id = i.id
      left join public.profiles cpr on cpr.id = i.created_by
      left join public.profiles apr on apr.id = i.approved_by
     order by i.created_at desc, i.id;
end $$;

-- Linhas do inventário. CONTAGEM CEGA (E16): expected_qty, moved_qty, diff_qty, custo e valor vêm NULOS para quem conta e para qualquer um durante a contagem;
-- só quem revisa (inv_manage) os vê com a contagem encerrada (revisão/aprovado) — ou durante a contagem se o inventário não foi aberto como cego.
create or replace function public.fin_inventory_lines(p_inventory uuid)
returns table (id uuid, item_id uuid, item_name text, category text, stock_unit text, fractional boolean, ean text, lot_id uuid, lot_code text, expiry_date date, is_extra boolean,
               counted_qty numeric, counted_at timestamptz, counted_by_name text, expected_qty numeric, moved_qty numeric, diff_qty numeric, avg_cost_cents numeric, diff_value_cents bigint,
               adjust_movement_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare inv public.stock_inventories; v_show boolean; v_diff boolean;
begin
  select * into inv from public.stock_inventories where public.stock_inventories.id = p_inventory;
  if inv.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(inv.clinic_id, 'stock_move', inv.unit_id, false);
  v_show := private.fin_can(inv.clinic_id, 'inv_manage', inv.unit_id, false) and (not inv.blind or inv.status in ('review','approved'));
  v_diff := v_show and inv.status in ('review','approved');
  return query
    select l.id, l.item_id, i.name, i.category, i.stock_unit, i.fractional, i.ean, l.lot_id, l.lot_code, l.expiry_date, l.is_extra, l.counted_qty, l.counted_at, pr.full_name,
           case when v_show then l.expected_qty end,
           case when v_diff then l.moved_qty end,
           case when v_diff then l.diff_qty end,
           case when v_diff then coalesce(l.avg_cost_cents, b.avg_cost_cents, 0) end,
           case when v_diff then (case when inv.status = 'approved' then l.diff_value_cents else round(l.diff_qty * coalesce(b.avg_cost_cents, 0))::bigint end) end,
           case when v_diff then l.adjust_movement_id end
      from public.stock_inventory_lines l
      join public.stock_items i on i.id = l.item_id
      left join public.stock_balances b on b.item_id = l.item_id and b.unit_id = inv.unit_id
      left join public.profiles pr on pr.id = l.counted_by
     where l.inventory_id = inv.id
     order by i.name, l.expiry_date nulls last, l.lot_code;
end $$;

-- ---------- 10. Alertas de estoque (escopo §8.8, E10) ----------
-- Abaixo do mínimo · lote vencendo (janelas configuráveis, padrão 90/60/30) · lote vencido · consumo sem saldo · transferência parada.
-- Um só cálculo para a tela (com listas) e para o painel (só contagens).
create or replace function private.stock_alerts_calc(p_clinic uuid, p_units uuid[], p_detail boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.fin_settings; v_today date := private.fin_today(); v_days integer[]; v_max integer; v_stale integer; v_idle integer;
  c_below bigint; c_exp bigint; c_expired bigint; c_sf bigint; c_sf_cents bigint; c_tr bigint;
  v_below jsonb := null; v_exp jsonb := null; v_expired jsonb := null; v_sf jsonb := null; v_tr jsonb := null;
begin
  select * into s from public.fin_settings where clinic_id = p_clinic;
  v_days := coalesce(s.stock_expiry_alert_days, array[90, 60, 30]);
  v_max := (select max(x) from unnest(v_days) x);
  v_stale := coalesce(s.stock_transfer_alert_days, 3);
  v_idle := coalesce(s.stock_idle_days, 90);

  select count(*) into c_below from public.stock_balances b
    join public.stock_item_minimums mn on mn.item_id = b.item_id and mn.unit_id = b.unit_id
    join public.stock_items i on i.id = b.item_id and i.is_active
   where b.clinic_id = p_clinic and b.unit_id = any (p_units) and b.qty_on_hand < mn.min_qty;
  select count(*) into c_exp from public.stock_lots l
   where l.clinic_id = p_clinic and l.unit_id = any (p_units) and l.qty_on_hand > 0 and l.expiry_date >= v_today and l.expiry_date <= v_today + v_max;
  select count(*) into c_expired from public.stock_lots l
   where l.clinic_id = p_clinic and l.unit_id = any (p_units) and l.qty_on_hand > 0 and l.expiry_date < v_today;
  select count(*), coalesce(sum(sf.est_cost_cents), 0)::bigint into c_sf, c_sf_cents from public.stock_shortfalls sf
   where sf.clinic_id = p_clinic and sf.unit_id = any (p_units) and sf.status = 'open';
  select count(*) into c_tr from public.stock_transfers t
   where t.clinic_id = p_clinic and t.status = 'in_transit' and (t.from_unit_id = any (p_units) or t.to_unit_id = any (p_units))
     and (v_today - (t.sent_at at time zone 'America/Sao_Paulo')::date) > v_stale;

  if p_detail then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', z.item_id, 'item_name', z.name, 'unit_id', z.unit_id, 'unit_name', z.uname, 'stock_unit', z.stock_unit,
             'qty_on_hand', z.qty_on_hand, 'min_qty', z.min_qty, 'missing_qty', z.min_qty - z.qty_on_hand) order by z.name, z.uname), '[]'::jsonb) into v_below
      from (select b.item_id, i.name, b.unit_id, u.name as uname, i.stock_unit, b.qty_on_hand, mn.min_qty
              from public.stock_balances b
              join public.stock_item_minimums mn on mn.item_id = b.item_id and mn.unit_id = b.unit_id
              join public.stock_items i on i.id = b.item_id and i.is_active
              join public.clinic_units u on u.id = b.unit_id
             where b.clinic_id = p_clinic and b.unit_id = any (p_units) and b.qty_on_hand < mn.min_qty
             order by i.name, u.name limit 500) z;
    select coalesce(jsonb_agg(jsonb_build_object('lot_id', z.id, 'item_id', z.item_id, 'item_name', z.name, 'unit_id', z.unit_id, 'unit_name', z.uname, 'stock_unit', z.stock_unit,
             'lot_code', z.lot_code, 'expiry_date', z.expiry_date, 'days_left', z.expiry_date - v_today, 'window_days', z.win, 'qty', z.qty_on_hand, 'value_cents', z.val)
             order by z.expiry_date, z.name), '[]'::jsonb) into v_exp
      from (select l.id, l.item_id, i.name, l.unit_id, u.name as uname, i.stock_unit, l.lot_code, l.expiry_date, l.qty_on_hand,
                   (select min(d) from unnest(v_days) d where d >= l.expiry_date - v_today) as win, round(l.qty_on_hand * coalesce(b.avg_cost_cents, 0))::bigint as val
              from public.stock_lots l
              join public.stock_items i on i.id = l.item_id join public.clinic_units u on u.id = l.unit_id
              left join public.stock_balances b on b.item_id = l.item_id and b.unit_id = l.unit_id
             where l.clinic_id = p_clinic and l.unit_id = any (p_units) and l.qty_on_hand > 0 and l.expiry_date >= v_today and l.expiry_date <= v_today + v_max
             order by l.expiry_date, i.name limit 500) z;
    select coalesce(jsonb_agg(jsonb_build_object('lot_id', z.id, 'item_id', z.item_id, 'item_name', z.name, 'unit_id', z.unit_id, 'unit_name', z.uname, 'stock_unit', z.stock_unit,
             'lot_code', z.lot_code, 'expiry_date', z.expiry_date, 'days_late', v_today - z.expiry_date, 'qty', z.qty_on_hand, 'value_cents', z.val)
             order by z.expiry_date, z.name), '[]'::jsonb) into v_expired
      from (select l.id, l.item_id, i.name, l.unit_id, u.name as uname, i.stock_unit, l.lot_code, l.expiry_date, l.qty_on_hand,
                   round(l.qty_on_hand * coalesce(b.avg_cost_cents, 0))::bigint as val
              from public.stock_lots l
              join public.stock_items i on i.id = l.item_id join public.clinic_units u on u.id = l.unit_id
              left join public.stock_balances b on b.item_id = l.item_id and b.unit_id = l.unit_id
             where l.clinic_id = p_clinic and l.unit_id = any (p_units) and l.qty_on_hand > 0 and l.expiry_date < v_today
             order by l.expiry_date, i.name limit 500) z;
    select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'item_name', z.name, 'unit_name', z.uname, 'stock_unit', z.stock_unit, 'qty', z.qty, 'est_cost_cents', z.est_cost_cents,
             'occurred_on', z.occurred_on, 'appointment_id', z.appointment_id) order by z.occurred_on desc, z.name), '[]'::jsonb) into v_sf
      from (select sf.id, i.name, u.name as uname, i.stock_unit, sf.qty, sf.est_cost_cents, sf.occurred_on, sf.appointment_id
              from public.stock_shortfalls sf join public.stock_items i on i.id = sf.item_id join public.clinic_units u on u.id = sf.unit_id
             where sf.clinic_id = p_clinic and sf.unit_id = any (p_units) and sf.status = 'open'
             order by sf.occurred_on desc, i.name limit 500) z;
    select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'number', z.number, 'from_unit_name', z.fname, 'to_unit_name', z.tname, 'sent_at', z.sent_at, 'age_days', z.age,
             'lines', z.n, 'sent_cents', z.val, 'can_receive', z.can_receive) order by z.sent_at), '[]'::jsonb) into v_tr
      from (select t.id, t.number, uf.name as fname, ut.name as tname, t.sent_at, (v_today - (t.sent_at at time zone 'America/Sao_Paulo')::date) as age,
                   (select count(*) from public.stock_transfer_lines l where l.transfer_id = t.id) as n,
                   (select coalesce(sum(l.total_cost_cents), 0) from public.stock_transfer_lines l where l.transfer_id = t.id)::bigint as val,
                   private.fin_can(t.clinic_id, 'stock_move', t.to_unit_id, true) as can_receive
              from public.stock_transfers t join public.clinic_units uf on uf.id = t.from_unit_id join public.clinic_units ut on ut.id = t.to_unit_id
             where t.clinic_id = p_clinic and t.status = 'in_transit' and (t.from_unit_id = any (p_units) or t.to_unit_id = any (p_units))
               and (v_today - (t.sent_at at time zone 'America/Sao_Paulo')::date) > v_stale
             order by t.sent_at limit 200) z;
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object('expiry_days', to_jsonb(v_days), 'idle_days', v_idle, 'transfer_days', v_stale),
    'counts', jsonb_build_object('below_min', c_below, 'expiring', c_exp, 'expired', c_expired, 'shortfalls', c_sf, 'shortfalls_cents', c_sf_cents, 'stale_transfers', c_tr,
                                 'total', c_below + c_exp + c_expired + c_sf + c_tr),
    'below_min', v_below, 'expiring', v_exp, 'expired', v_expired, 'shortfalls', v_sf, 'stale_transfers', v_tr);
end $$;

create or replace function public.fin_stock_alerts(p_clinic uuid, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return private.stock_alerts_calc(p_clinic, private.stock_units(p_clinic, p_unit, false), true);
end $$;

-- Só as contagens (painel e aviso do Estoque): uma consulta leve.
create or replace function public.fin_stock_alert_counts(p_clinic uuid, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return (private.stock_alerts_calc(p_clinic, private.stock_units(p_clinic, p_unit, false), false)) - 'below_min' - 'expiring' - 'expired' - 'shortfalls' - 'stale_transfers';
end $$;

-- Janelas de vencimento (até 5, de 1 a 365 dias), dias sem giro (7 a 730) e dias para a transferência ser «parada» (1 a 60). Gestor/Admin.
create or replace function public.fin_stock_alert_settings_save(p_clinic uuid, p_data jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.fin_settings; v_before jsonb; v_days integer[]; v_idle integer; v_tr integer;
begin
  perform private.fin_gate(p_clinic, 'settings', null, true);
  perform private.fin_seed_clinic(p_clinic);
  select * into s from public.fin_settings where clinic_id = p_clinic for update;
  v_before := jsonb_build_object('expiry_days', to_jsonb(s.stock_expiry_alert_days), 'idle_days', s.stock_idle_days, 'transfer_days', s.stock_transfer_alert_days);
  if p_data ? 'expiry_days' then
    select array_agg(distinct x::integer order by x::integer desc) into v_days from jsonb_array_elements_text(p_data->'expiry_days') x;
    if v_days is null or cardinality(v_days) not between 1 and 5 or exists (select 1 from unnest(v_days) d where d not between 1 and 365) then raise exception 'INVALID_EXPIRY_DAYS' using errcode = '22023'; end if;
  else v_days := s.stock_expiry_alert_days; end if;
  v_idle := coalesce(nullif(p_data->>'idle_days', '')::integer, s.stock_idle_days);
  v_tr := coalesce(nullif(p_data->>'transfer_days', '')::integer, s.stock_transfer_alert_days);
  if v_idle not between 7 and 730 then raise exception 'INVALID_IDLE_DAYS' using errcode = '22023'; end if;
  if v_tr not between 1 and 60 then raise exception 'INVALID_TRANSFER_DAYS' using errcode = '22023'; end if;
  update public.fin_settings set stock_expiry_alert_days = v_days, stock_idle_days = v_idle, stock_transfer_alert_days = v_tr, updated_at = now() where clinic_id = p_clinic;
  perform private.fin_log(p_clinic, null, 'stock_alert_settings', p_clinic, 'update', v_before,
    jsonb_build_object('expiry_days', to_jsonb(v_days), 'idle_days', v_idle, 'transfer_days', v_tr), p_reason);
  return jsonb_build_object('expiry_days', to_jsonb(v_days), 'idle_days', v_idle, 'transfer_days', v_tr);
end $$;

-- ---------- 11. Relatórios de estoque (escopo §8.8) ----------
-- Cada relatório devolve linhas jsonb com 'ord' (ordem) e 'value_cents' (a parte em reais da linha). O invólucro soma TUDO (não só a página):
-- total = soma das linhas. Todos filtram pelas unidades que o chamador alcança.
create or replace function private.rpt_position(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ord', row_number() over (order by i.name, u.name), 'item_id', i.id, 'item_name', i.name, 'category', i.category, 'item_type', i.item_type,
           'unit_id', u.id, 'unit_name', u.name, 'stock_unit', i.stock_unit, 'qty', b.qty_on_hand, 'avg_cost_cents', b.avg_cost_cents,
           'value_cents', round(b.qty_on_hand * b.avg_cost_cents)::bigint)
    from public.stock_balances b
    join public.stock_items i on i.id = b.item_id
    join public.clinic_units u on u.id = b.unit_id
   where b.clinic_id = p_clinic and b.unit_id = any (p_units)
     and (coalesce((p_params->>'only_positive')::boolean, true) is false or b.qty_on_hand > 0)
     and (nullif(p_params->>'category', '') is null or i.category = p_params->>'category')
     and (nullif(p_params->>'item_type', '') is null or i.item_type = p_params->>'item_type')
$$;

create or replace function private.rpt_movements(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ord', row_number() over (order by i.name, u.name), 'item_id', i.id, 'item_name', i.name, 'category', i.category, 'unit_id', u.id, 'unit_name', u.name,
           'stock_unit', i.stock_unit, 'count', g.n, 'in_qty', g.in_qty, 'in_cents', g.in_cents, 'out_qty', g.out_qty, 'out_cents', g.out_cents, 'value_cents', g.in_cents - g.out_cents)
    from (select m.item_id, m.unit_id, count(*) as n,
                 coalesce(sum(m.qty) filter (where m.qty > 0), 0) as in_qty, coalesce(sum(m.total_cost_cents) filter (where m.qty > 0), 0)::bigint as in_cents,
                 coalesce(-sum(m.qty) filter (where m.qty < 0), 0) as out_qty, coalesce(-sum(m.total_cost_cents) filter (where m.qty < 0), 0)::bigint as out_cents
            from public.stock_movements m
           where m.clinic_id = p_clinic and m.unit_id = any (p_units) and m.occurred_on between p_from and p_to
             and (nullif(p_params->>'movement_type', '') is null or m.movement_type = p_params->>'movement_type')
           group by m.item_id, m.unit_id) g
    join public.stock_items i on i.id = g.item_id
    join public.clinic_units u on u.id = g.unit_id
   where (nullif(p_params->>'category', '') is null or i.category = p_params->>'category')
$$;

-- Consumo (saída de kit/atendimento, já líquida de estornos) por serviço e pelo profissional EXECUTOR (sem executor, o responsável). group: service|professional|item.
create or replace function private.rpt_consumption(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  with mv as (
    select m.item_id, m.unit_id, m.qty, m.total_cost_cents, coalesce(m.appointment_id, o.appointment_id) as appt
      from public.stock_movements m
      left join public.stock_movements o on o.id = m.reversed_movement_id
     where m.clinic_id = p_clinic and m.unit_id = any (p_units) and m.occurred_on between p_from and p_to
       and (m.movement_type = 'appointment' or (m.movement_type = 'reversal' and o.movement_type = 'appointment'))),
  ex as (
    select mv.item_id, mv.qty, mv.total_cost_cents, coalesce(a.service_name, 'Uso por paciente (sem atendimento)') as service,
           coalesce((select pr.full_name from public.fin_appointment_participants pp join public.professionals p on p.id = pp.professional_id join public.profiles pr on pr.id = p.profile_id
                      where pp.appointment_id = mv.appt and pp.role in ('executor','responsavel') order by (pp.role = 'executor') desc, pp.position limit 1), '—') as professional
      from mv left join public.fin_appointments a on a.id = mv.appt),
  g as (
    select case coalesce(p_params->>'group', 'service') when 'item' then null else service end as service,
           case coalesce(p_params->>'group', 'service') when 'professional' then professional when 'service' then null else null end as professional,
           case coalesce(p_params->>'group', 'service') when 'item' then ex.item_id else null end as item_id,
           count(*) as n, -sum(ex.qty) as qty, -sum(ex.total_cost_cents)::bigint as cents
      from ex group by 1, 2, 3)
  select jsonb_build_object('ord', row_number() over (order by g.cents desc, g.service, g.professional, i.name), 'service', g.service, 'professional', g.professional,
           'item_name', i.name, 'stock_unit', i.stock_unit, 'count', g.n, 'qty', case when g.item_id is not null then g.qty end, 'value_cents', g.cents)
    from g left join public.stock_items i on i.id = g.item_id
$$;

-- Perdas por motivo: perda/quebra/vencimento (líquidas de estorno) + diferença de transferência (perda da origem). Valor positivo = perda.
create or replace function private.rpt_losses(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  with a as (
    select coalesce(m.loss_kind, o.loss_kind) as kind, m.item_id, m.unit_id, m.qty, m.total_cost_cents as cents, m.reason
      from public.stock_movements m
      left join public.stock_movements o on o.id = m.reversed_movement_id
     where m.clinic_id = p_clinic and m.unit_id = any (p_units) and m.occurred_on between p_from and p_to
       and (m.movement_type = 'loss' or (m.movement_type = 'reversal' and o.movement_type = 'loss'))
    union all
    select 'transfer_diff', l.item_id, t.from_unit_id, -l.loss_qty, -l.loss_cents, l.receive_reason
      from public.stock_transfer_lines l join public.stock_transfers t on t.id = l.transfer_id
     where l.clinic_id = p_clinic and t.status = 'received' and l.loss_qty > 0 and t.from_unit_id = any (p_units)
       and (t.received_at at time zone 'America/Sao_Paulo')::date between p_from and p_to),
  g as (
    select a.kind, a.item_id, a.unit_id, count(*) as n, -sum(a.qty) as qty, -sum(a.cents)::bigint as cents,
           string_agg(distinct a.reason, ' | ') filter (where a.reason is not null) as reasons
      from a group by a.kind, a.item_id, a.unit_id)
  select jsonb_build_object('ord', row_number() over (order by g.kind, i.name, u.name), 'kind', g.kind, 'item_id', i.id, 'item_name', i.name, 'unit_name', u.name, 'stock_unit', i.stock_unit,
           'count', g.n, 'qty', g.qty, 'reasons', g.reasons, 'value_cents', g.cents)
    from g join public.stock_items i on i.id = g.item_id join public.clinic_units u on u.id = g.unit_id
$$;

-- Validade: lotes com saldo vencidos ou que vencem em até params.window dias (padrão 90).
create or replace function private.rpt_validity(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ord', row_number() over (order by l.expiry_date, i.name, u.name), 'item_id', i.id, 'item_name', i.name, 'unit_name', u.name, 'stock_unit', i.stock_unit,
           'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'days_left', l.expiry_date - private.fin_today(), 'qty', l.qty_on_hand,
           'value_cents', round(l.qty_on_hand * coalesce(b.avg_cost_cents, 0))::bigint)
    from public.stock_lots l
    join public.stock_items i on i.id = l.item_id join public.clinic_units u on u.id = l.unit_id
    left join public.stock_balances b on b.item_id = l.item_id and b.unit_id = l.unit_id
   where l.clinic_id = p_clinic and l.unit_id = any (p_units) and l.qty_on_hand > 0 and l.expiry_date is not null
     and l.expiry_date <= private.fin_today() + coalesce(nullif(p_params->>'window', '')::integer, 90)
$$;

-- Sem giro: item com saldo cuja última saída de consumo/venda (atendimento, venda, setor, pacote) — ou, se nunca saiu, a primeira entrada — é de params.days dias atrás ou mais (padrão: o da clínica, 90).
create or replace function private.rpt_idle(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  with cfg as (select coalesce(nullif(p_params->>'days', '')::integer, (select s.stock_idle_days from public.fin_settings s where s.clinic_id = p_clinic), 90) as d),
  mv as (
    select m.item_id, m.unit_id, min(m.occurred_on) as first_in, max(m.occurred_on) filter (where m.qty < 0 and m.movement_type in ('appointment','sale','sector','package_delivery')) as last_out
      from public.stock_movements m where m.clinic_id = p_clinic and m.unit_id = any (p_units) group by m.item_id, m.unit_id)
  select jsonb_build_object('ord', row_number() over (order by coalesce(mv.last_out, mv.first_in), i.name, u.name), 'item_id', i.id, 'item_name', i.name, 'category', i.category, 'unit_name', u.name,
           'stock_unit', i.stock_unit, 'qty', b.qty_on_hand, 'last_out', mv.last_out, 'first_in', mv.first_in, 'days_idle', private.fin_today() - coalesce(mv.last_out, mv.first_in),
           'value_cents', round(b.qty_on_hand * b.avg_cost_cents)::bigint)
    from public.stock_balances b
    join public.stock_items i on i.id = b.item_id join public.clinic_units u on u.id = b.unit_id
    join mv on mv.item_id = b.item_id and mv.unit_id = b.unit_id
    cross join cfg
   where b.clinic_id = p_clinic and b.unit_id = any (p_units) and b.qty_on_hand > 0 and private.fin_today() - coalesce(mv.last_out, mv.first_in) >= cfg.d
$$;

-- Compras por fornecedor: entradas ativas de compra e de XML da NF-e no período (bonificação e saldo inicial não são compra).
create or replace function private.rpt_purchases(p_clinic uuid, p_units uuid[], p_from date, p_to date, p_params jsonb) returns setof jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ord', row_number() over (order by g.total desc, sp.name), 'supplier_id', sp.id, 'supplier_name', sp.name, 'tax_id', sp.tax_id, 'entries', g.n,
           'items_total_cents', g.items, 'freight_cents', g.freight, 'value_cents', g.total)
    from (select e.supplier_id, count(*) as n, sum(e.items_total_cents)::bigint as items, sum(e.freight_cents)::bigint as freight, sum(e.total_cents)::bigint as total
            from public.stock_entries e
           where e.clinic_id = p_clinic and e.unit_id = any (p_units) and e.status = 'active' and e.entry_type in ('purchase','xml_purchase') and e.received_on between p_from and p_to
             and e.supplier_id is not null
           group by e.supplier_id) g
    join public.stock_suppliers sp on sp.id = g.supplier_id
$$;

create or replace function public.fin_stock_report(p_clinic uuid, p_report text, p_unit uuid default null, p_from date default null, p_to date default null,
                                                   p_params jsonb default '{}'::jsonb, p_limit integer default 2000, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_units uuid[]; v_from date; v_to date; v_lim integer; v_off integer; v_keys text[]; v_count bigint; v_total jsonb; v_rows jsonb; v_today date := private.fin_today();
begin
  if p_report is null or p_report not in ('position','movements','consumption','losses','validity','idle','purchases') then raise exception 'INVALID_REPORT' using errcode = '22023'; end if;
  v_units := private.stock_units(p_clinic, p_unit, false);
  v_from := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to := coalesce(p_to, v_today);
  if v_from > v_to or v_to - v_from > 3660 then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  v_lim := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  v_off := greatest(coalesce(p_offset, 0), 0);
  v_keys := case p_report
    when 'position' then array['value_cents']
    when 'movements' then array['count','in_cents','out_cents','value_cents']
    when 'consumption' then array['count','value_cents']
    when 'losses' then array['count','value_cents']
    when 'validity' then array['value_cents']
    when 'idle' then array['value_cents']
    else array['entries','items_total_cents','freight_cents','value_cents'] end;
  execute format($f$
    with r as materialized (select j from private.rpt_%s($1, $2, $3, $4, $5) j),
    t as (select count(*) as n from r),
    s as (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) as o
            from (select e.key as k, sum((e.value #>> '{}')::numeric) as v from r, jsonb_each(r.j) e where e.key = any ($6) group by e.key) q),
    p as (select coalesce(jsonb_agg(z.j order by (z.j->>'ord')::bigint), '[]'::jsonb) as a
            from (select r.j from r order by (r.j->>'ord')::bigint limit $7 offset $8) z)
    select t.n, s.o, p.a from t, s, p $f$, p_report)
    into v_count, v_total, v_rows using p_clinic, v_units, v_from, v_to, coalesce(p_params, '{}'::jsonb), v_keys, v_lim, v_off;
  return jsonb_build_object('report', p_report, 'from', v_from, 'to', v_to, 'count', v_count, 'totals', v_total, 'rows', v_rows, 'truncated', v_count > v_off + v_lim);
end $$;

-- ---------- 12. Permissões de execução ----------
revoke all on function private.stock_transfers_guard(), private.stock_transfer_lines_guard(), private.stock_inventories_guard(), private.stock_inventory_lines_guard(),
  private.stock_units(uuid, uuid, boolean), private.stock_alerts_calc(uuid, uuid[], boolean),
  private.rpt_position(uuid, uuid[], date, date, jsonb), private.rpt_movements(uuid, uuid[], date, date, jsonb), private.rpt_consumption(uuid, uuid[], date, date, jsonb),
  private.rpt_losses(uuid, uuid[], date, date, jsonb), private.rpt_validity(uuid, uuid[], date, date, jsonb), private.rpt_idle(uuid, uuid[], date, date, jsonb),
  private.rpt_purchases(uuid, uuid[], date, date, jsonb) from public, anon, authenticated;
revoke all on function private.stock_apply(uuid, uuid, uuid, uuid, uuid, uuid, text, numeric, bigint, boolean, jsonb), private.stock_reverse_one(uuid, text, boolean) from public, anon, authenticated;

revoke all on function public.fin_stock_transfer_send(uuid, uuid, uuid, jsonb, text), public.fin_stock_transfer_receive(uuid, jsonb, text), public.fin_stock_transfer_cancel(uuid, text),
  public.fin_stock_transfers(uuid, uuid, text, date, date, integer, integer),
  public.fin_inventory_open(uuid, uuid, jsonb), public.fin_inventory_count(uuid, jsonb), public.fin_inventory_finish(uuid, boolean), public.fin_inventory_reopen(uuid, text),
  public.fin_inventory_cancel(uuid, text), public.fin_inventory_approve(uuid, text), public.fin_inventory_list(uuid, uuid, text, uuid, integer, integer), public.fin_inventory_lines(uuid),
  public.fin_stock_alerts(uuid, uuid), public.fin_stock_alert_counts(uuid, uuid), public.fin_stock_alert_settings_save(uuid, jsonb, text),
  public.fin_stock_report(uuid, text, uuid, date, date, jsonb, integer, integer) from public, anon;
grant execute on function public.fin_stock_transfer_send(uuid, uuid, uuid, jsonb, text), public.fin_stock_transfer_receive(uuid, jsonb, text), public.fin_stock_transfer_cancel(uuid, text),
  public.fin_stock_transfers(uuid, uuid, text, date, date, integer, integer),
  public.fin_inventory_open(uuid, uuid, jsonb), public.fin_inventory_count(uuid, jsonb), public.fin_inventory_finish(uuid, boolean), public.fin_inventory_reopen(uuid, text),
  public.fin_inventory_cancel(uuid, text), public.fin_inventory_approve(uuid, text), public.fin_inventory_list(uuid, uuid, text, uuid, integer, integer), public.fin_inventory_lines(uuid),
  public.fin_stock_alerts(uuid, uuid), public.fin_stock_alert_counts(uuid, uuid), public.fin_stock_alert_settings_save(uuid, jsonb, text),
  public.fin_stock_report(uuid, text, uuid, date, date, jsonb, integer, integer) to authenticated;

-- ---------- Desempenho: saldo por item × unidade (E3) ----------
-- Causa medida (auto_explain, 6.000 lotes, ~72 mil movimentações): a partir da 6ª chamada na mesma conexão o PostgreSQL passa a usar o plano GENÉRICO da consulta
-- interna da função (p_unit/p_item/p_search viram parâmetros desconhecidos) e ela fica ~500× mais lenta (50 ms → 23 s). Conexões reaproveitadas do pooler caem nisso em produção.
-- Correção: mesma função da E3 (resultado idêntico; grants preservados), com plano sempre específico por chamada (plan_cache_mode = force_custom_plan).

create or replace function public.fin_stock_balances(p_clinic uuid, p_unit uuid default null, p_item uuid default null, p_search text default null, p_only_positive boolean default false)
returns table (item_id uuid, item_name text, category text, item_type text, stock_unit text, fractional boolean, lot_control boolean, unit_id uuid, unit_name text,
               qty_on_hand numeric, avg_cost_cents numeric, value_cents bigint, min_qty numeric, below_min boolean, next_expiry date, expired_qty numeric, open_qty numeric, lots jsonb)
language plpgsql stable security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
declare v_today date := private.fin_today();
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, false);
  return query
    with allowed as (
      select u.id, u.name from public.clinic_units u where u.clinic_id = p_clinic and (p_unit is null or u.id = p_unit) and private.fin_can(p_clinic, 'stock_move', u.id, false)),
    bal as (
      select b.item_id, b.unit_id, b.qty_on_hand, b.avg_cost_cents from public.stock_balances b
       where b.clinic_id = p_clinic and b.unit_id in (select a.id from allowed a) and (p_item is null or b.item_id = p_item)
         and (not coalesce(p_only_positive, false) or b.qty_on_hand > 0)),
    openq as (
      select o.lot_id, sum(o.qty_remaining) as q from public.stock_open_units o where o.clinic_id = p_clinic and o.status = 'open' group by o.lot_id),
    lagg as (
      select l.item_id, l.unit_id,
             min(l.expiry_date) as next_expiry,
             coalesce(sum(l.qty_on_hand) filter (where l.expiry_date < v_today), 0) as expired_qty,
             coalesce(sum(oq.q), 0) as open_qty,
             jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'qty', l.qty_on_hand, 'open_qty', coalesce(oq.q, 0),
                                          'expired', l.expiry_date is not null and l.expiry_date < v_today) order by l.expiry_date nulls last, l.lot_code) as lots
        from public.stock_lots l
        join bal on bal.item_id = l.item_id and bal.unit_id = l.unit_id
        left join openq oq on oq.lot_id = l.id
       where l.qty_on_hand > 0
       group by l.item_id, l.unit_id)
    select i.id, i.name, i.category, i.item_type, i.stock_unit, i.fractional, i.lot_control, bal.unit_id, a.name,
           bal.qty_on_hand, bal.avg_cost_cents, round(bal.qty_on_hand * bal.avg_cost_cents)::bigint,
           mn.min_qty, (mn.min_qty is not null and bal.qty_on_hand < mn.min_qty),
           la.next_expiry, coalesce(la.expired_qty, 0), coalesce(la.open_qty, 0), coalesce(la.lots, '[]'::jsonb)
      from bal
      join public.stock_items i on i.id = bal.item_id
      join allowed a on a.id = bal.unit_id
      left join public.stock_item_minimums mn on mn.item_id = bal.item_id and mn.unit_id = bal.unit_id
      left join lagg la on la.item_id = bal.item_id and la.unit_id = bal.unit_id
     where (nullif(btrim(coalesce(p_search, '')), '') is null or i.name ilike '%' || btrim(p_search) || '%' or i.category ilike '%' || btrim(p_search) || '%')
     order by i.name, a.name;
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261117100000','20261117100000_fin_e8_inventario.sql','FIN-E8: inventário cego, transferências entre unidades, alertas e relatórios de estoque (aditiva).','FIN-E8');
