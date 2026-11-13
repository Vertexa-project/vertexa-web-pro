-- =====================================================================================
-- FIN-E3 — Estoque básico · Entrega 3 (saldo inicial, entradas manual e por XML da NF-e, saídas, lote e validade,
-- uso fracionado e individual por paciente, custo médio ponderado, saldo por unidade, kardex e estorno).
-- 100% ADITIVA: cria tabelas stock_suppliers, stock_supplier_item_map, stock_entries, stock_lots, stock_balances, stock_open_units,
-- stock_movements; funções private.stock_* e public.fin_stock_*; 2 gatilhos novos (AFTER INSERT em fin_sale_items e AFTER UPDATE OF status
-- em fin_sales, da Entrega 2) que baixam/devolvem estoque; recria (create or replace) private.fin_area_roles e public.fin_my_access PRESERVANDO
-- o comportamento anterior e acrescentando a área 'stock_move'. Nenhuma função da E1/E2 muda de corpo além dessas duas.
-- Depende de 20261113100000_fin_e1_base.sql e 20261113180000_fin_e2_vendas.sql (fin_can, fin_log, fin_distribute, fin_today, stock_items, fin_sales).
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local: scripts/fin-e3-sql-proof.sh).
--
-- Regras que valem no servidor (escopo-v1 §3, §8, §11, §12.2):
--  * escrita SÓ por RPC security definer (search_path vazio); tabelas sem INSERT/UPDATE/DELETE para anon/authenticated;
--  * saldo nunca é editado: é a soma das movimentações (stock_lots/stock_balances só mudam dentro de private.stock_apply);
--  * movimentação imutável (trigger bloqueia UPDATE/DELETE/TRUNCATE): correção = estorno com motivo; log em fin_audit_log na mesma transação;
--  * dinheiro em centavos; custo médio por item+unidade com 4 casas (meio-para-cima), recalculado a cada entrada; saída valorada pelo custo médio do momento;
--  * quantidades com até 3 casas; saldo negativo proibido; lote vencido só sai como perda por vencimento (com confirmação);
--  * Estoquista e Gestor movimentam; Financeiro só consulta (vê custo e valor); Recepção e Profissional não acessam o módulo.
-- =====================================================================================

-- ---------- 1. Matriz de papéis (replace: preserva E1/E2, acrescenta stock_move) ----------
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
    when p_area = 'sales'           then array['gestor','financeiro','recepcao']            -- vê e lança venda/recebimento
    when p_area = 'sales_price'     then array['gestor','financeiro']                       -- muda preço de tabela na venda
    when p_area = 'sale_cancel'     then case when p_write then array['gestor','financeiro'] else array['gestor','financeiro','recepcao'] end
    when p_area = 'cash'            then array['gestor','financeiro','recepcao']            -- abre/fecha o PRÓPRIO caixa
    when p_area = 'cash_all'        then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    when p_area = 'cash_approve'    then array['gestor']
    when p_area = 'receivables'     then array['gestor','financeiro']                       -- títulos (taxa, líquido)
    when p_area = 'receivables_fix' then array['gestor']                                    -- corrige data/valor liquidado
    when p_area = 'compliance'      then case when p_write then '{}'::text[] else array['gestor'] end  -- aceite: só Owner/Admin
    -- E3: estoque (saldo, entradas, saídas, kardex). Escreve: Estoquista e Gestor. Lê (com custo e valor): também o Financeiro. Recepção e Profissional: nada.
    when p_area = 'stock_move'      then case when p_write then array['gestor','estoquista'] else array['gestor','estoquista','financeiro'] end
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move'];
        a text; v_can jsonb := '{}'::jsonb; v_roles jsonb;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then
    return jsonb_build_object('is_admin', false, 'roles', '[]'::jsonb, 'can', '{}'::jsonb);
  end if;
  foreach a in array v_areas loop
    v_can := v_can || jsonb_build_object(a || '_read', private.fin_can(p_clinic, a, null, false), a || '_write', private.fin_can(p_clinic, a, null, true));
  end loop;
  -- Profissional (sem papel financeiro) vê só a PRÓPRIA produção: vendas em que é vendedor.
  v_can := v_can || jsonb_build_object('own_sales_read', exists (
    select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'));
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids))), '[]'::jsonb)
    into v_roles
    from public.clinic_staff_roles r
    join public.professionals pr on pr.id = r.professional_id
   where r.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  return jsonb_build_object('is_admin', private.is_clinic_admin(p_clinic), 'roles', v_roles, 'can', v_can);
end $$;


-- ---------- 2. Tabelas ----------
-- Fornecedores (D15: entrada por compra/XML). Sem exclusão: desativa-se.
create table if not exists public.stock_suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  tax_id text check (tax_id is null or tax_id ~ '^([0-9]{11}|[0-9]{14})$'),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists stock_suppliers_tax_uq on public.stock_suppliers (clinic_id, tax_id) where tax_id is not null;
create unique index if not exists stock_suppliers_name_uq on public.stock_suppliers (clinic_id, lower(btrim(name)));

-- De/para do fornecedor (8.1 «Códigos do fornecedor»): criado na 1ª importação de XML e reaproveitado nas seguintes.
create table if not exists public.stock_supplier_item_map (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  supplier_id uuid not null references public.stock_suppliers(id) on delete cascade,
  supplier_code text not null check (char_length(btrim(supplier_code)) between 1 and 60),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  conversion_factor numeric(14,4) not null default 1 check (conversion_factor > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, supplier_code)
);
create index if not exists stock_supplier_item_map_item_idx on public.stock_supplier_item_map (item_id);

-- Documento de entrada (cabeçalho): saldo inicial, compra, XML da NF-e, bonificação.
create table if not exists public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  entry_type text not null check (entry_type in ('initial_balance','purchase','xml_purchase','bonus')),
  supplier_id uuid references public.stock_suppliers(id),
  invoice_number text check (invoice_number is null or char_length(invoice_number) <= 40),
  invoice_key text check (invoice_key is null or invoice_key ~ '^[0-9]{44}$'),
  issue_date date,
  received_on date not null,
  freight_cents integer not null default 0 check (freight_cents >= 0),
  items_total_cents bigint not null default 0 check (items_total_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  notes text check (notes is null or char_length(notes) <= 500),
  status text not null default 'active' check (status in ('active','reversed')),
  reversed_at timestamptz,
  reversed_by uuid,
  reverse_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (status <> 'reversed' or (reversed_at is not null and reverse_reason is not null))
);
create unique index if not exists stock_entries_invoice_key_uq on public.stock_entries (clinic_id, invoice_key) where invoice_key is not null and status = 'active';
create unique index if not exists stock_entries_invoice_num_uq on public.stock_entries (clinic_id, supplier_id, invoice_number)
  where supplier_id is not null and invoice_number is not null and status = 'active';
create index if not exists stock_entries_clinic_idx on public.stock_entries (clinic_id, unit_id, received_on desc);

-- Lote por item + unidade. Item sem controle de lote usa o lote único «SEM LOTE».
create table if not exists public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  item_id uuid not null references public.stock_items(id),
  lot_code text not null check (char_length(btrim(lot_code)) between 1 and 60),
  expiry_date date,
  qty_on_hand numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, unit_id, lot_code)
);
create index if not exists stock_lots_clinic_idx on public.stock_lots (clinic_id, unit_id);

-- Saldo e custo médio por item + unidade (não por lote, 8.4). Nunca editado direto: só pelas funções de movimento.
create table if not exists public.stock_balances (
  item_id uuid not null references public.stock_items(id),
  unit_id uuid not null references public.clinic_units(id),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  qty_on_hand numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  avg_cost_cents numeric(16,4) not null default 0 check (avg_cost_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, unit_id)
);
create index if not exists stock_balances_clinic_idx on public.stock_balances (clinic_id, unit_id);

-- Unidade aberta (uso fracionado / individual por paciente, 8.1 e 8.3, D20): fração 0..1 de uma unidade de estoque.
create table if not exists public.stock_open_units (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  item_id uuid not null references public.stock_items(id),
  lot_id uuid not null references public.stock_lots(id),
  patient_id uuid references public.patients(id),
  opened_on date not null,
  expires_on date,
  qty_remaining numeric(14,3) not null check (qty_remaining >= 0 and qty_remaining <= 1),
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  close_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists stock_open_units_lot_idx on public.stock_open_units (lot_id) where status = 'open';
create index if not exists stock_open_units_item_idx on public.stock_open_units (clinic_id, item_id, unit_id) where status = 'open';

-- Movimentações: imutáveis. Corrigir = estorno (nova linha apontando para a original).
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  item_id uuid not null references public.stock_items(id),
  lot_id uuid not null references public.stock_lots(id),
  open_unit_id uuid references public.stock_open_units(id),
  entry_id uuid references public.stock_entries(id),
  movement_type text not null check (movement_type in ('initial_balance','purchase','xml_purchase','bonus','patient_return','appointment','package_delivery','sale',
    'sector','loss','supplier_return','transfer_out','transfer_in','inventory','reversal')),
  qty numeric(14,3) not null check (qty <> 0),
  unit_cost_cents numeric(16,4) not null check (unit_cost_cents >= 0),
  total_cost_cents bigint not null,
  balance_after numeric(14,3) not null check (balance_after >= 0),
  avg_cost_after_cents numeric(16,4) not null check (avg_cost_after_cents >= 0),
  occurred_on date not null,
  reason text check (reason is null or char_length(reason) <= 300),
  purpose text check (purpose is null or char_length(purpose) <= 120),
  loss_kind text check (loss_kind is null or loss_kind in ('loss','breakage','expiry')),
  patient_id uuid references public.patients(id),
  sale_id uuid,
  appointment_id uuid,
  reversed_movement_id uuid references public.stock_movements(id),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),   -- relógio real: várias linhas na mesma transação mantêm a ordem do kardex
  check (sign(qty) = sign(total_cost_cents) or total_cost_cents = 0),
  check (movement_type <> 'reversal' or reversed_movement_id is not null),
  check (movement_type <> 'loss' or loss_kind is not null)
);
create unique index if not exists stock_movements_reversal_uq on public.stock_movements (reversed_movement_id) where reversed_movement_id is not null;
create index if not exists stock_movements_clinic_idx on public.stock_movements (clinic_id, unit_id, occurred_on desc, created_at desc);
create index if not exists stock_movements_item_idx on public.stock_movements (item_id, unit_id, created_at);
create index if not exists stock_movements_sale_idx on public.stock_movements (sale_id) where sale_id is not null;
create index if not exists stock_movements_entry_idx on public.stock_movements (entry_id) where entry_id is not null;

-- Sem exclusão física nem edição (§3): trigger de linha + de TRUNCATE. DELETE em cascata (apagar a clínica inteira) passa.
create or replace function private.stock_movements_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'STOCK_MOVEMENT_IMMUTABLE: movimentação de estoque não se edita nem se apaga; corrija por estorno' using errcode = '42501';
end $$;
drop trigger if exists stock_movements_immutable_row on public.stock_movements;
create trigger stock_movements_immutable_row before update or delete on public.stock_movements for each row execute function private.stock_movements_immutable();
drop trigger if exists stock_movements_immutable_trunc on public.stock_movements;
create trigger stock_movements_immutable_trunc before truncate on public.stock_movements for each statement execute function private.stock_movements_immutable();

-- ---------- 3. RLS e grants (leitura pela matriz; escrita só por RPC) ----------
alter table public.stock_suppliers enable row level security;
alter table public.stock_supplier_item_map enable row level security;
alter table public.stock_entries enable row level security;
alter table public.stock_lots enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_open_units enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.stock_suppliers, public.stock_supplier_item_map, public.stock_entries, public.stock_lots, public.stock_balances,
  public.stock_open_units, public.stock_movements from anon, authenticated;
grant select on public.stock_suppliers, public.stock_supplier_item_map, public.stock_entries, public.stock_lots, public.stock_balances,
  public.stock_open_units, public.stock_movements to authenticated;

create policy stock_suppliers_select on public.stock_suppliers for select to authenticated using (private.fin_can(clinic_id, 'stock_move', null, false));
create policy stock_supplier_item_map_select on public.stock_supplier_item_map for select to authenticated using (private.fin_can(clinic_id, 'stock_move', null, false));
create policy stock_entries_select on public.stock_entries for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));
create policy stock_lots_select on public.stock_lots for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));
create policy stock_balances_select on public.stock_balances for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));
create policy stock_open_units_select on public.stock_open_units for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));
create policy stock_movements_select on public.stock_movements for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));

-- ---------- 4. Núcleo do estoque (internas; toda movimentação passa por private.stock_apply) ----------
-- Fração aberta de um lote (reservada por unidades abertas).
create or replace function private.stock_lot_open_qty(p_lot uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(qty_remaining), 0) from public.stock_open_units where lot_id = p_lot and status = 'open'
$$;

-- Aplica UMA movimentação já validada: trava saldo e lote, recalcula o custo médio (só quando p_recalc), grava a linha e o log (mesma transação).
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
      avg_cost_after_cents, occurred_on, reason, purpose, loss_kind, patient_id, sale_id, appointment_id, reversed_movement_id, created_by)
    values (p_clinic, p_unit, p_item, l.id, p_open, p_entry, p_type, p_qty, v_unit_cost, p_total, v_new, v_avg,
      coalesce(nullif(p_ctx->>'occurred_on', '')::date, private.fin_today()), nullif(btrim(coalesce(p_ctx->>'reason', '')), ''), nullif(btrim(coalesce(p_ctx->>'purpose', '')), ''),
      nullif(p_ctx->>'loss_kind', ''), nullif(p_ctx->>'patient_id', '')::uuid, nullif(p_ctx->>'sale_id', '')::uuid, nullif(p_ctx->>'appointment_id', '')::uuid, v_orig,
      private.current_profile_id())
    returning * into m;
  select name into v_name from public.stock_items where id = p_item;
  perform private.fin_log(p_clinic, p_unit, 'stock_movement', m.id, case when p_type = 'reversal' then 'reverse' else 'create' end, null,
    jsonb_build_object('movement_type', m.movement_type, 'item_name', v_name, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'qty', m.qty,
      'unit_cost_cents', m.unit_cost_cents, 'total_cost_cents', m.total_cost_cents, 'balance_after', m.balance_after, 'avg_cost_after_cents', m.avg_cost_after_cents,
      'loss_kind', m.loss_kind, 'purpose', m.purpose), m.reason);
  return m;
end $$;

-- Saída com regras de lote (FEFO), validade, fração e unidade aberta. Devolve {movement_ids, total_cost_cents}.
create or replace function private.stock_exit(p_clinic uuid, p_unit uuid, p_item uuid, p_type text, p_qty numeric, p_ctx jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  it public.stock_items; b public.stock_balances; l public.stock_lots; ou public.stock_open_units; m public.stock_movements;
  v_qty numeric := p_qty; v_today date := private.fin_today(); v_loss boolean := (p_type = 'loss'); v_kind text := nullif(p_ctx->>'loss_kind', '');
  v_expiry_loss boolean := (p_type = 'loss' and coalesce(p_ctx->>'loss_kind', '') = 'expiry');
  v_lot uuid := nullif(p_ctx->>'lot_id', '')::uuid; v_open uuid := nullif(p_ctx->>'open_unit_id', '')::uuid; v_patient uuid := nullif(p_ctx->>'patient_id', '')::uuid;
  v_confirm boolean := coalesce((p_ctx->>'confirm_expired')::boolean, false);
  v_left numeric; v_take numeric; v_avail numeric; v_ids uuid[] := '{}'; v_total bigint := 0; v_exp boolean; v_dose boolean; v_cost bigint; v_picked boolean := false;
  v_expires date;
begin
  select * into it from public.stock_items where id = p_item and clinic_id = p_clinic;
  if it.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
  if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 3) then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
  if v_patient is not null and not exists (select 1 from public.patients pt where pt.id = v_patient and pt.clinic_id = p_clinic) then raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into b from public.stock_balances where item_id = p_item and unit_id = p_unit for update;
  if b.item_id is null or b.qty_on_hand < v_qty then raise exception 'INSUFFICIENT_STOCK' using errcode = '22023'; end if;
  if not it.fractional and v_qty <> trunc(v_qty) then raise exception 'NOT_FRACTIONAL' using errcode = '22023'; end if;
  v_dose := it.fractional and (v_open is not null or v_qty < 1);
  if it.fractional and not v_dose and v_qty <> trunc(v_qty) then raise exception 'FRACTION_EXCEEDS_UNIT' using errcode = '22023'; end if;
  if v_expiry_loss and not v_confirm then raise exception 'EXPIRED_LOT_CONFIRM_REQUIRED' using errcode = '22023'; end if;

  if v_dose then
    -- Uso fracionado: a dose sai de uma unidade aberta (existente ou aberta agora).
    if v_open is not null then
      select * into ou from public.stock_open_units where id = v_open and item_id = p_item and unit_id = p_unit and clinic_id = p_clinic for update;
      if ou.id is null or ou.status <> 'open' then raise exception 'OPEN_UNIT_NOT_FOUND' using errcode = 'P0002'; end if;
      select * into l from public.stock_lots where id = ou.lot_id for update;
    else
      if it.individual_use and v_patient is null and not v_loss then raise exception 'PATIENT_REQUIRED' using errcode = '22023'; end if;
      for l in select * from public.stock_lots x where x.item_id = p_item and x.unit_id = p_unit and (v_lot is null or x.id = v_lot)
                  order by x.expiry_date nulls last, x.lot_code, x.id for update loop
        v_exp := l.expiry_date is not null and l.expiry_date < v_today;
        if v_exp <> v_expiry_loss then continue; end if;   -- consumo só de lote vigente; perda por vencimento só de lote vencido
        if l.qty_on_hand - private.stock_lot_open_qty(l.id) < 1 then continue; end if;
        v_picked := true; exit;
      end loop;
      if not v_picked then
        if v_lot is not null and exists (select 1 from public.stock_lots x where x.id = v_lot and x.item_id = p_item and x.unit_id = p_unit and x.qty_on_hand > 0) then
          if (select x.expiry_date is not null and x.expiry_date < v_today from public.stock_lots x where x.id = v_lot) then raise exception 'LOT_EXPIRED' using errcode = '22023'; end if;
          if v_expiry_loss then raise exception 'LOT_NOT_EXPIRED' using errcode = '22023'; end if;
        end if;
        if not v_expiry_loss and exists (select 1 from public.stock_lots x where x.item_id = p_item and x.unit_id = p_unit and x.qty_on_hand > 0 and x.expiry_date < v_today) then
          raise exception 'LOT_EXPIRED' using errcode = '22023';
        end if;
        raise exception 'INSUFFICIENT_STOCK' using errcode = '22023';
      end if;
      v_expires := nullif(least(coalesce(l.expiry_date, 'infinity'::date), coalesce(v_today + it.opened_validity_days, 'infinity'::date)), 'infinity'::date);
      insert into public.stock_open_units (clinic_id, unit_id, item_id, lot_id, patient_id, opened_on, expires_on, qty_remaining, created_by)
        values (p_clinic, p_unit, p_item, l.id, v_patient, v_today, v_expires, 1, private.current_profile_id()) returning * into ou;
    end if;
    -- E12: caneta de uso individual aberta para um paciente só dá dose a ele (perda/descarte da sobra não depende do paciente).
    if it.individual_use and not v_loss and ou.patient_id is distinct from v_patient then raise exception 'OPEN_UNIT_OTHER_PATIENT' using errcode = '22023'; end if;
    v_exp := ou.expires_on is not null and ou.expires_on < v_today;
    if v_exp and not v_expiry_loss then raise exception 'OPEN_UNIT_EXPIRED' using errcode = '22023'; end if;
    if not v_exp and v_expiry_loss then raise exception 'LOT_NOT_EXPIRED' using errcode = '22023'; end if;
    if v_qty > ou.qty_remaining then raise exception 'INSUFFICIENT_OPEN_UNIT' using errcode = '22023'; end if;
    v_cost := round(v_qty * b.avg_cost_cents)::bigint;
    m := private.stock_apply(p_clinic, p_unit, p_item, l.id, ou.id, null, p_type, -v_qty, -v_cost, false, p_ctx);
    update public.stock_open_units set qty_remaining = qty_remaining - v_qty,
        status = case when qty_remaining - v_qty = 0 then 'closed' else 'open' end,
        closed_at = case when qty_remaining - v_qty = 0 then now() else null end,
        close_reason = case when qty_remaining - v_qty = 0 then (case when v_loss then 'discarded' else 'consumed' end) else null end
      where id = ou.id;
    return jsonb_build_object('movement_ids', jsonb_build_array(m.id), 'total_cost_cents', v_cost, 'open_unit_id', ou.id);
  end if;

  -- Unidades inteiras: FEFO (vence primeiro, sai primeiro) ou o lote escolhido. Lote vencido só sai como perda por vencimento, com confirmação.
  v_left := v_qty;
  for l in select * from public.stock_lots x where x.item_id = p_item and x.unit_id = p_unit and (v_lot is null or x.id = v_lot)
              order by x.expiry_date nulls last, x.lot_code, x.id for update loop
    exit when v_left <= 0;
    v_exp := l.expiry_date is not null and l.expiry_date < v_today;
    if v_exp and not v_expiry_loss then
      if v_lot is not null then raise exception 'LOT_EXPIRED' using errcode = '22023'; end if;
      continue;
    end if;
    if not v_exp and v_expiry_loss then
      if v_lot is not null then raise exception 'LOT_NOT_EXPIRED' using errcode = '22023'; end if;
      continue;
    end if;
    v_avail := l.qty_on_hand - private.stock_lot_open_qty(l.id);
    if v_avail <= 0 then continue; end if;
    v_take := least(v_avail, v_left);
    v_cost := round(v_take * b.avg_cost_cents)::bigint;
    m := private.stock_apply(p_clinic, p_unit, p_item, l.id, null, null, p_type, -v_take, -v_cost, false, p_ctx);
    v_ids := v_ids || m.id; v_total := v_total + v_cost; v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    if not v_expiry_loss and v_left <= (select coalesce(sum(x.qty_on_hand - private.stock_lot_open_qty(x.id)), 0) from public.stock_lots x
                                         where x.item_id = p_item and x.unit_id = p_unit and x.expiry_date < v_today and (v_lot is null or x.id = v_lot)) then
      raise exception 'LOT_EXPIRED' using errcode = '22023';   -- E4: o que falta só existe em lote vencido
    end if;
    if v_expiry_loss and exists (select 1 from public.stock_lots x where x.item_id = p_item and x.unit_id = p_unit and x.qty_on_hand > 0
                                   and (x.expiry_date is null or x.expiry_date >= v_today) and (v_lot is null or x.id = v_lot)) then
      raise exception 'LOT_NOT_EXPIRED' using errcode = '22023';   -- perda por vencimento só de lote que venceu
    end if;
    raise exception 'INSUFFICIENT_STOCK' using errcode = '22023';
  end if;
  return jsonb_build_object('movement_ids', to_jsonb(v_ids), 'total_cost_cents', v_total);
end $$;

-- Estorna UMA movimentação (nunca apaga): linha oposta, mesmo lote e mesmo custo da original; devolve a fração à unidade aberta.
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
  if exists (select 1 from public.stock_movements x where x.reversed_movement_id = m.id) then raise exception 'ALREADY_REVERSED' using errcode = '22023'; end if;
  select * into l from public.stock_lots where id = m.lot_id for update;
  if m.qty > 0 and l.qty_on_hand - private.stock_lot_open_qty(l.id) < m.qty then raise exception 'REVERSAL_NO_STOCK' using errcode = '22023'; end if;
  r := private.stock_apply(m.clinic_id, m.unit_id, m.item_id, m.lot_id, m.open_unit_id, null, 'reversal', -m.qty, -m.total_cost_cents, true,
         jsonb_build_object('reason', p_reason, 'reversed_movement_id', m.id, 'patient_id', m.patient_id, 'sale_id', m.sale_id));
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

-- ---------- 5. Venda de produto baixa o estoque (E9) e o cancelamento devolve ----------
-- Gatilhos sobre as tabelas da Entrega 2 (nenhuma função da E2 muda). Só baixa item JÁ CONTROLADO na unidade (tem saldo registrado);
-- item sem estoque lançado continua vendendo como na Entrega 2.
create or replace function private.stock_on_sale_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.fin_sales;
begin
  if new.item_type not in ('product', 'compounded') or new.stock_item_id is null then return new; end if;
  select * into s from public.fin_sales where id = new.sale_id;
  if not exists (select 1 from public.stock_balances b where b.item_id = new.stock_item_id and b.unit_id = s.unit_id) then return new; end if;
  perform private.stock_exit(s.clinic_id, s.unit_id, new.stock_item_id, 'sale', new.quantity,
    jsonb_build_object('sale_id', s.id, 'patient_id', s.patient_id, 'reason', 'Venda de produto'));
  return new;
end $$;
drop trigger if exists stock_on_sale_item on public.fin_sale_items;
create trigger stock_on_sale_item after insert on public.fin_sale_items for each row execute function private.stock_on_sale_item();

create or replace function private.stock_on_sale_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select m.id from public.stock_movements m
            where m.sale_id = new.id and m.movement_type = 'sale'
              and not exists (select 1 from public.stock_movements x where x.reversed_movement_id = m.id)
            order by m.created_at desc, m.id loop
    perform private.stock_reverse_one(r.id, 'Venda cancelada: ' || coalesce(new.cancel_reason, ''), true);
  end loop;
  return new;
end $$;
drop trigger if exists stock_on_sale_cancel on public.fin_sales;
create trigger stock_on_sale_cancel after update of status on public.fin_sales for each row
  when (old.status is distinct from 'canceled' and new.status = 'canceled') execute function private.stock_on_sale_cancel();

-- ---------- 6. RPCs de escrita ----------
-- 6.1 Fornecedor
create or replace function public.fin_stock_save_supplier(p_clinic uuid, p_id uuid, p_data jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.stock_suppliers; v_before jsonb; v_name text := btrim(coalesce(p_data->>'name', '')); v_tax text := nullif(regexp_replace(coalesce(p_data->>'tax_id', ''), '[^0-9]', '', 'g'), '');
  v_active boolean := coalesce((p_data->>'is_active')::boolean, true); v_action text;
begin
  perform private.fin_gate(p_clinic, 'stock_move', null, true);
  if v_name = '' then raise exception 'NAME_REQUIRED' using errcode = '22023'; end if;
  if v_tax is not null and not private.fin_valid_tax_id(v_tax) then raise exception 'INVALID_TAX_ID' using errcode = '22023'; end if;
  if p_id is not null then
    select * into s from public.stock_suppliers where id = p_id and clinic_id = p_clinic for update;
    if s.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_before := to_jsonb(s);
    v_action := private.fin_action(true, s.is_active, v_active, p_reason);
    update public.stock_suppliers set name = v_name, tax_id = v_tax, is_active = v_active, updated_at = now() where id = s.id returning * into s;
  else
    v_action := 'create';
    insert into public.stock_suppliers (clinic_id, name, tax_id, is_active, created_by) values (p_clinic, v_name, v_tax, v_active, private.current_profile_id()) returning * into s;
  end if;
  perform private.fin_log(p_clinic, null, 'stock_supplier', s.id, v_action, v_before, to_jsonb(s), p_reason);
  return s.id;
end $$;

-- 6.2 Entrada (saldo inicial, compra manual, XML da NF-e, bonificação). Tudo ou nada.
-- p_header: {entry_type, supplier_id | supplier_new:{name,tax_id}, invoice_number, invoice_key, issue_date, freight_cents, notes}
-- p_lines : [{item_id, quantity (unidade de ESTOQUE), line_total_cents | unit_cost_cents, lot_code, expiry_date, supplier_code, conversion_factor}]
create or replace function public.fin_stock_entry(p_clinic uuid, p_unit uuid, p_header jsonb, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u public.clinic_units; e public.stock_entries; x jsonb; it public.stock_items; l public.stock_lots; sup public.stock_suppliers; mp public.stock_supplier_item_map;
  v_type text := p_header->>'entry_type'; v_today date := private.fin_today(); v_freight integer := coalesce(nullif(p_header->>'freight_cents', '')::integer, 0);
  v_inv text := nullif(btrim(coalesce(p_header->>'invoice_number', '')), ''); v_key text := nullif(regexp_replace(coalesce(p_header->>'invoice_key', ''), '[^0-9]', '', 'g'), '');
  v_issue date := nullif(p_header->>'issue_date', '')::date; v_notes text := nullif(btrim(coalesce(p_header->>'notes', '')), '');
  v_sup uuid := nullif(p_header->>'supplier_id', '')::uuid; v_new jsonb := p_header->'supplier_new'; v_sname text; v_stax text;
  n integer; i integer; v_items uuid[] := '{}'; v_qtys numeric[] := '{}'; v_totals bigint[] := '{}'; v_lots text[] := '{}'; v_exps date[] := '{}'; v_codes text[] := '{}'; v_factors numeric[] := '{}';
  v_qty numeric; v_total bigint; v_code text; v_exp date; v_shares bigint[]; v_sum bigint := 0; v_unit_cost numeric; v_factor numeric; v_mvt public.stock_movements;
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, true);
  select * into u from public.clinic_units where id = p_unit and clinic_id = p_clinic and is_active;
  if u.id is null then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if v_type is null or v_type not in ('initial_balance', 'purchase', 'xml_purchase', 'bonus') then raise exception 'INVALID_ENTRY_TYPE' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'ENTRY_LINES_REQUIRED' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'TOO_MANY_LINES' using errcode = '22023'; end if;
  if v_freight < 0 then raise exception 'INVALID_FREIGHT' using errcode = '22023'; end if;
  if v_freight > 0 and v_type in ('initial_balance', 'bonus') then raise exception 'INVALID_FREIGHT' using errcode = '22023'; end if;
  if v_issue is not null and v_issue > v_today then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if v_type = 'bonus' and (v_notes is null or char_length(v_notes) < 3) then raise exception 'ORIGIN_REQUIRED' using errcode = '22023'; end if;

  -- fornecedor e nota (compra e XML)
  if v_type in ('purchase', 'xml_purchase') then
    if v_inv is null then raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = '22023'; end if;
    if v_sup is null and v_new is not null then
      v_sname := btrim(coalesce(v_new->>'name', '')); v_stax := nullif(regexp_replace(coalesce(v_new->>'tax_id', ''), '[^0-9]', '', 'g'), '');
      if v_sname = '' then raise exception 'SUPPLIER_REQUIRED' using errcode = '22023'; end if;
      if v_stax is not null and not private.fin_valid_tax_id(v_stax) then raise exception 'INVALID_TAX_ID' using errcode = '22023'; end if;
      select * into sup from public.stock_suppliers where clinic_id = p_clinic and ((v_stax is not null and tax_id = v_stax) or lower(btrim(name)) = lower(v_sname)) order by (tax_id = v_stax) desc nulls last limit 1;
      if sup.id is null then
        insert into public.stock_suppliers (clinic_id, name, tax_id, created_by) values (p_clinic, v_sname, v_stax, private.current_profile_id()) returning * into sup;
        perform private.fin_log(p_clinic, null, 'stock_supplier', sup.id, 'create', null, to_jsonb(sup), 'Criado ao importar entrada');
      elsif sup.tax_id is null and v_stax is not null then
        update public.stock_suppliers set tax_id = v_stax, updated_at = now() where id = sup.id returning * into sup;
      end if;
      v_sup := sup.id;
    end if;
    if v_sup is null then raise exception 'SUPPLIER_REQUIRED' using errcode = '22023'; end if;
    if not exists (select 1 from public.stock_suppliers s where s.id = v_sup and s.clinic_id = p_clinic) then raise exception 'SUPPLIER_REQUIRED' using errcode = '22023'; end if;
    if v_type = 'xml_purchase' and (v_key is null or char_length(v_key) <> 44) then raise exception 'INVOICE_KEY_REQUIRED' using errcode = '22023'; end if;
    if (v_key is not null and exists (select 1 from public.stock_entries z where z.clinic_id = p_clinic and z.invoice_key = v_key and z.status = 'active'))
       or exists (select 1 from public.stock_entries z where z.clinic_id = p_clinic and z.supplier_id = v_sup and z.invoice_number = v_inv and z.status = 'active') then
      raise exception 'INVOICE_ALREADY_IMPORTED' using errcode = '22023';
    end if;
  else
    v_sup := null; v_inv := null; v_key := null;
  end if;

  -- linhas
  n := jsonb_array_length(p_lines);
  for i in 0..n - 1 loop
    x := p_lines->i;
    select * into it from public.stock_items where id = nullif(x->>'item_id', '')::uuid and clinic_id = p_clinic;
    if it.id is null or not it.is_active then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    v_qty := round((x->>'quantity')::numeric, 3);
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
    if not it.fractional and v_qty <> trunc(v_qty) then raise exception 'NOT_FRACTIONAL' using errcode = '22023'; end if;
    if nullif(x->>'line_total_cents', '') is not null then v_total := round((x->>'line_total_cents')::numeric)::bigint;
    elsif nullif(x->>'unit_cost_cents', '') is not null then v_total := round(v_qty * (x->>'unit_cost_cents')::numeric)::bigint;
    else raise exception 'COST_REQUIRED' using errcode = '22023'; end if;
    if v_total < 0 or (v_total = 0 and v_type <> 'bonus') then raise exception 'COST_REQUIRED' using errcode = '22023'; end if;
    v_code := nullif(btrim(coalesce(x->>'lot_code', '')), ''); v_exp := nullif(x->>'expiry_date', '')::date;
    if it.lot_control and (v_code is null or v_exp is null) then raise exception 'LOT_REQUIRED' using errcode = '22023'; end if;
    if v_exp is not null and v_exp < v_today then raise exception 'LOT_ALREADY_EXPIRED' using errcode = '22023'; end if;
    v_factor := coalesce(nullif(x->>'conversion_factor', '')::numeric, 1);
    if v_factor <= 0 then raise exception 'INVALID_FACTOR' using errcode = '22023'; end if;
    v_items := v_items || it.id; v_qtys := v_qtys || v_qty; v_totals := v_totals || v_total; v_lots := v_lots || coalesce(v_code, 'SEM LOTE'); v_exps := v_exps || v_exp;
    v_codes := v_codes || coalesce(nullif(btrim(coalesce(x->>'supplier_code', '')), ''), ''); v_factors := v_factors || v_factor;
    v_sum := v_sum + v_total;
  end loop;
  -- E15: saldo inicial uma vez por item e unidade (estornado libera de novo)
  if v_type = 'initial_balance' then
    for i in 1..n loop
      if exists (select 1 from public.stock_movements m where m.item_id = v_items[i] and m.unit_id = p_unit and m.movement_type = 'initial_balance'
                    and not exists (select 1 from public.stock_movements r where r.reversed_movement_id = m.id)) then
        raise exception 'INITIAL_BALANCE_EXISTS' using errcode = '22023';
      end if;
    end loop;
  end if;
  -- frete rateado pelo valor dos itens (meio-para-cima por linha, resto na última)
  if v_freight > 0 then
    if v_sum <= 0 then raise exception 'INVALID_FREIGHT' using errcode = '22023'; end if;
    v_shares := private.fin_distribute(v_freight, v_totals);
    for i in 1..n loop v_totals[i] := v_totals[i] + v_shares[i]; end loop;
  end if;

  insert into public.stock_entries (clinic_id, unit_id, entry_type, supplier_id, invoice_number, invoice_key, issue_date, received_on, freight_cents, items_total_cents, total_cents, notes, created_by)
    values (p_clinic, p_unit, v_type, v_sup, v_inv, v_key, v_issue, v_today, v_freight, v_sum, v_sum + v_freight, v_notes, private.current_profile_id()) returning * into e;

  for i in 1..n loop
    select * into it from public.stock_items where id = v_items[i];
    select * into l from public.stock_lots where item_id = v_items[i] and unit_id = p_unit and lot_code = v_lots[i] for update;
    if l.id is null then
      insert into public.stock_lots (clinic_id, unit_id, item_id, lot_code, expiry_date) values (p_clinic, p_unit, v_items[i], v_lots[i], v_exps[i]) returning * into l;
    elsif l.expiry_date is distinct from v_exps[i] and (l.qty_on_hand > 0 or v_exps[i] is not null) then
      if l.expiry_date is not null and v_exps[i] is not null then raise exception 'LOT_EXPIRY_MISMATCH' using errcode = '22023'; end if;
      if l.expiry_date is null and v_exps[i] is not null then update public.stock_lots set expiry_date = v_exps[i] where id = l.id returning * into l; end if;
    end if;
    v_mvt := private.stock_apply(p_clinic, p_unit, v_items[i], l.id, null, e.id, v_type, v_qtys[i], v_totals[i], true,
      jsonb_build_object('reason', case when v_type = 'bonus' then v_notes else concat_ws(' · ', case when v_inv is not null then 'NF ' || v_inv end) end));
    -- de/para salvo para as próximas notas
    if v_sup is not null and v_codes[i] <> '' then
      select * into mp from public.stock_supplier_item_map where supplier_id = v_sup and supplier_code = v_codes[i] for update;
      if mp.id is null then
        insert into public.stock_supplier_item_map (clinic_id, supplier_id, supplier_code, item_id, conversion_factor, created_by)
          values (p_clinic, v_sup, v_codes[i], v_items[i], v_factors[i], private.current_profile_id()) returning * into mp;
        perform private.fin_log(p_clinic, null, 'stock_item_map', mp.id, 'create', null, jsonb_build_object('supplier_code', mp.supplier_code, 'item_name', it.name, 'conversion_factor', mp.conversion_factor), null);
      elsif mp.item_id <> v_items[i] or mp.conversion_factor <> v_factors[i] then
        update public.stock_supplier_item_map set item_id = v_items[i], conversion_factor = v_factors[i], updated_at = now() where id = mp.id;
        perform private.fin_log(p_clinic, null, 'stock_item_map', mp.id, 'update', jsonb_build_object('conversion_factor', mp.conversion_factor),
          jsonb_build_object('supplier_code', mp.supplier_code, 'item_name', it.name, 'conversion_factor', v_factors[i]), null);
      end if;
    end if;
  end loop;
  perform private.fin_log(p_clinic, p_unit, 'stock_entry', e.id, 'create', null,
    jsonb_build_object('entry_type', e.entry_type, 'invoice_number', e.invoice_number, 'invoice_key', e.invoice_key, 'freight_cents', e.freight_cents,
      'items_total_cents', e.items_total_cents, 'total_cents', e.total_cents, 'lines', n), v_notes);
  return e.id;
end $$;

-- 6.3 Saída: consumo interno (setor), perda/quebra/vencimento (motivo obrigatório) e uso por paciente (individual).
-- p_data: {reason, purpose, loss_kind (loss|breakage|expiry), patient_id, lot_id, open_unit_id, confirm_expired}
create or replace function public.fin_stock_exit(p_clinic uuid, p_unit uuid, p_item uuid, p_type text, p_quantity numeric, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_reason text := btrim(coalesce(p_data->>'reason', '')); v_purpose text := btrim(coalesce(p_data->>'purpose', '')); v_kind text := nullif(p_data->>'loss_kind', '');
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, true);
  if not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if p_type is null or p_type not in ('sector', 'loss', 'appointment') then raise exception 'INVALID_EXIT_TYPE' using errcode = '22023'; end if;
  if p_type = 'sector' and (char_length(v_purpose) < 2 or char_length(v_reason) < 3) then raise exception 'PURPOSE_AND_REASON_REQUIRED' using errcode = '22023'; end if;
  if p_type = 'loss' then
    if v_kind is null or v_kind not in ('loss', 'breakage', 'expiry') then raise exception 'LOSS_KIND_REQUIRED' using errcode = '22023'; end if;
    if char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  end if;
  if p_type = 'appointment' and nullif(p_data->>'patient_id', '') is null then raise exception 'PATIENT_REQUIRED' using errcode = '22023'; end if;
  return private.stock_exit(p_clinic, p_unit, p_item, p_type, p_quantity, p_data);
end $$;

-- 6.4 Estorno (movimentação ou entrada inteira): motivo obrigatório; nada é apagado.
create or replace function public.fin_stock_reverse(p_movement uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements;
begin
  select * into m from public.stock_movements where id = p_movement;
  if m.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(m.clinic_id, 'stock_move', m.unit_id, true);
  return private.stock_reverse_one(p_movement, p_reason, false);
end $$;

create or replace function public.fin_stock_reverse_entry(p_entry uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.stock_entries; r record; n integer := 0; v_before jsonb;
begin
  select * into e from public.stock_entries where id = p_entry for update;
  if e.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(e.clinic_id, 'stock_move', e.unit_id, true);
  if e.status = 'reversed' then raise exception 'ALREADY_REVERSED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_before := to_jsonb(e);
  for r in select m.id from public.stock_movements m
            where m.entry_id = e.id and not exists (select 1 from public.stock_movements x where x.reversed_movement_id = m.id)
            order by m.created_at desc, m.id desc loop
    perform private.stock_reverse_one(r.id, p_reason, false);
    n := n + 1;
  end loop;
  update public.stock_entries set status = 'reversed', reversed_at = now(), reversed_by = private.current_profile_id(), reverse_reason = btrim(p_reason) where id = e.id returning * into e;
  perform private.fin_log(e.clinic_id, e.unit_id, 'stock_entry', e.id, 'reverse', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'reversed', 'movements', n), p_reason);
  return n;
end $$;

-- ---------- 7. RPCs de leitura (security definer + fin_can por unidade) ----------
-- 7.1 Saldo por item × unidade, com lotes, validade, custo médio e valor (Recepção/Profissional: forbidden)
create or replace function public.fin_stock_balances(p_clinic uuid, p_unit uuid default null, p_item uuid default null, p_search text default null, p_only_positive boolean default false)
returns table (item_id uuid, item_name text, category text, item_type text, stock_unit text, fractional boolean, lot_control boolean, unit_id uuid, unit_name text,
               qty_on_hand numeric, avg_cost_cents numeric, value_cents bigint, min_qty numeric, below_min boolean, next_expiry date, expired_qty numeric, open_qty numeric, lots jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, false);
  return query
    select i.id, i.name, i.category, i.item_type, i.stock_unit, i.fractional, i.lot_control, b.unit_id, u.name,
           b.qty_on_hand, b.avg_cost_cents, round(b.qty_on_hand * b.avg_cost_cents)::bigint,
           mn.min_qty, (mn.min_qty is not null and b.qty_on_hand < mn.min_qty),
           (select min(l.expiry_date) from public.stock_lots l where l.item_id = b.item_id and l.unit_id = b.unit_id and l.qty_on_hand > 0 and l.expiry_date is not null),
           coalesce((select sum(l.qty_on_hand) from public.stock_lots l where l.item_id = b.item_id and l.unit_id = b.unit_id and l.expiry_date < private.fin_today()), 0),
           coalesce((select sum(o.qty_remaining) from public.stock_open_units o where o.item_id = b.item_id and o.unit_id = b.unit_id and o.status = 'open'), 0),
           coalesce((select jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'qty', l.qty_on_hand,
                       'open_qty', private.stock_lot_open_qty(l.id), 'expired', l.expiry_date is not null and l.expiry_date < private.fin_today())
                     order by l.expiry_date nulls last, l.lot_code)
                      from public.stock_lots l where l.item_id = b.item_id and l.unit_id = b.unit_id and (l.qty_on_hand > 0)), '[]'::jsonb)
      from public.stock_balances b
      join public.stock_items i on i.id = b.item_id
      join public.clinic_units u on u.id = b.unit_id
      left join public.stock_item_minimums mn on mn.item_id = b.item_id and mn.unit_id = b.unit_id
     where b.clinic_id = p_clinic
       and (p_unit is null or b.unit_id = p_unit) and (p_item is null or b.item_id = p_item)
       and (not coalesce(p_only_positive, false) or b.qty_on_hand > 0)
       and (nullif(btrim(coalesce(p_search, '')), '') is null or i.name ilike '%' || btrim(p_search) || '%' or i.category ilike '%' || btrim(p_search) || '%')
       and private.fin_can(p_clinic, 'stock_move', b.unit_id, false)
     order by i.name, u.name;
end $$;

-- 7.2 Kardex / saídas / movimentações
create or replace function public.fin_stock_movements(p_clinic uuid, p_unit uuid default null, p_item uuid default null, p_type text default null, p_direction text default null,
                                                      p_from date default null, p_to date default null, p_entry uuid default null, p_limit integer default 200, p_offset integer default 0)
returns table (id uuid, occurred_on date, created_at timestamptz, unit_id uuid, unit_name text, item_id uuid, item_name text, stock_unit text, movement_type text, qty numeric,
               unit_cost_cents numeric, total_cost_cents bigint, balance_after numeric, avg_cost_after_cents numeric, lot_code text, expiry_date date, reason text, purpose text,
               loss_kind text, patient_name text, user_name text, supplier_name text, invoice_number text, entry_id uuid, sale_id uuid, reversed boolean, reversal_of uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, false);
  return query
    select m.id, m.occurred_on, m.created_at, m.unit_id, u.name, m.item_id, i.name, i.stock_unit, m.movement_type, m.qty, m.unit_cost_cents, m.total_cost_cents, m.balance_after,
           m.avg_cost_after_cents, l.lot_code, l.expiry_date, m.reason, m.purpose, m.loss_kind, ppr.full_name, upr.full_name, sp.name, en.invoice_number, m.entry_id, m.sale_id,
           exists (select 1 from public.stock_movements r where r.reversed_movement_id = m.id), m.reversed_movement_id
      from public.stock_movements m
      join public.clinic_units u on u.id = m.unit_id
      join public.stock_items i on i.id = m.item_id
      join public.stock_lots l on l.id = m.lot_id
      left join public.patients pt on pt.id = m.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
      left join public.profiles upr on upr.id = m.created_by
      left join public.stock_entries en on en.id = m.entry_id
      left join public.stock_suppliers sp on sp.id = en.supplier_id
     where m.clinic_id = p_clinic
       and (p_unit is null or m.unit_id = p_unit) and (p_item is null or m.item_id = p_item) and (p_type is null or m.movement_type = p_type)
       and (p_direction is null or (p_direction = 'in' and m.qty > 0) or (p_direction = 'out' and m.qty < 0))
       and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to) and (p_entry is null or m.entry_id = p_entry)
       and private.fin_can(p_clinic, 'stock_move', m.unit_id, false)
     order by m.created_at desc, m.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- 7.3 Documentos de entrada
create or replace function public.fin_stock_entries(p_clinic uuid, p_unit uuid default null, p_from date default null, p_to date default null, p_limit integer default 200, p_offset integer default 0)
returns table (id uuid, created_at timestamptz, received_on date, unit_id uuid, unit_name text, entry_type text, supplier_name text, invoice_number text, invoice_key text,
               lines_count bigint, items_total_cents bigint, freight_cents integer, total_cents bigint, status text, reverse_reason text, user_name text, notes text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, false);
  return query
    select e.id, e.created_at, e.received_on, e.unit_id, u.name, e.entry_type, sp.name, e.invoice_number, e.invoice_key,
           (select count(*) from public.stock_movements m where m.entry_id = e.id), e.items_total_cents, e.freight_cents, e.total_cents, e.status, e.reverse_reason, upr.full_name, e.notes
      from public.stock_entries e
      join public.clinic_units u on u.id = e.unit_id
      left join public.stock_suppliers sp on sp.id = e.supplier_id
      left join public.profiles upr on upr.id = e.created_by
     where e.clinic_id = p_clinic and (p_unit is null or e.unit_id = p_unit)
       and (p_from is null or e.received_on >= p_from) and (p_to is null or e.received_on <= p_to)
       and private.fin_can(p_clinic, 'stock_move', e.unit_id, false)
     order by e.created_at desc, e.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- 7.4 Lotes e unidades abertas de um item numa unidade (para a tela de saída): FEFO na ordem, vencido marcado
create or replace function public.fin_stock_lots(p_clinic uuid, p_unit uuid, p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.fin_today();
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, false);
  return jsonb_build_object(
    'avg_cost_cents', (select b.avg_cost_cents from public.stock_balances b where b.item_id = p_item and b.unit_id = p_unit and b.clinic_id = p_clinic),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'qty', l.qty_on_hand,
                'available', l.qty_on_hand - private.stock_lot_open_qty(l.id), 'expired', l.expiry_date is not null and l.expiry_date < v_today)
              order by l.expiry_date nulls last, l.lot_code)
              from public.stock_lots l where l.item_id = p_item and l.unit_id = p_unit and l.clinic_id = p_clinic and l.qty_on_hand > 0), '[]'::jsonb),
    'open_units', coalesce((select jsonb_agg(jsonb_build_object('open_unit_id', o.id, 'lot_code', l.lot_code, 'patient_id', o.patient_id, 'patient_name', ppr.full_name,
                'opened_on', o.opened_on, 'expires_on', o.expires_on, 'qty_remaining', o.qty_remaining, 'expired', o.expires_on is not null and o.expires_on < v_today)
              order by o.expires_on nulls last, o.opened_on)
              from public.stock_open_units o
              join public.stock_lots l on l.id = o.lot_id
              left join public.patients pt on pt.id = o.patient_id
              left join public.profiles ppr on ppr.id = pt.profile_id
             where o.item_id = p_item and o.unit_id = p_unit and o.clinic_id = p_clinic and o.status = 'open'), '[]'::jsonb));
end $$;

-- 7.5 Busca de paciente para o uso individual (mesma regra da busca da venda: sem paciente removido). Só quem movimenta estoque.
create or replace function public.fin_stock_patients(p_clinic uuid, p_search text default null, p_limit integer default 20)
returns table (patient_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'stock_move', null, true);
  return query
    select pt.id, pr.full_name
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic
       and coalesce(pr.status::text, '') <> 'inactive'
       and (nullif(btrim(coalesce(p_search, '')), '') is null or pr.full_name ilike '%' || btrim(p_search) || '%')
     order by pr.full_name limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- ---------- 8. Permissões de execução ----------
revoke all on function private.stock_movements_immutable(), private.stock_lot_open_qty(uuid),
  private.stock_apply(uuid, uuid, uuid, uuid, uuid, uuid, text, numeric, bigint, boolean, jsonb),
  private.stock_exit(uuid, uuid, uuid, text, numeric, jsonb), private.stock_reverse_one(uuid, text, boolean),
  private.stock_on_sale_item(), private.stock_on_sale_cancel() from public, anon, authenticated;

revoke all on function public.fin_stock_save_supplier(uuid, uuid, jsonb, text), public.fin_stock_entry(uuid, uuid, jsonb, jsonb),
  public.fin_stock_exit(uuid, uuid, uuid, text, numeric, jsonb), public.fin_stock_reverse(uuid, text), public.fin_stock_reverse_entry(uuid, text),
  public.fin_stock_balances(uuid, uuid, uuid, text, boolean),
  public.fin_stock_movements(uuid, uuid, uuid, text, text, date, date, uuid, integer, integer),
  public.fin_stock_entries(uuid, uuid, date, date, integer, integer), public.fin_stock_lots(uuid, uuid, uuid), public.fin_stock_patients(uuid, text, integer) from public, anon;
grant execute on function public.fin_stock_save_supplier(uuid, uuid, jsonb, text), public.fin_stock_entry(uuid, uuid, jsonb, jsonb),
  public.fin_stock_exit(uuid, uuid, uuid, text, numeric, jsonb), public.fin_stock_reverse(uuid, text), public.fin_stock_reverse_entry(uuid, text),
  public.fin_stock_balances(uuid, uuid, uuid, text, boolean),
  public.fin_stock_movements(uuid, uuid, uuid, text, text, date, date, uuid, integer, integer),
  public.fin_stock_entries(uuid, uuid, date, date, integer, integer), public.fin_stock_lots(uuid, uuid, uuid), public.fin_stock_patients(uuid, text, integer) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261113230000','20261113230000_fin_e3_estoque.sql','FIN-E3: estoque básico — saldo inicial, entradas manual e XML da NF-e, saídas, lote e validade (FEFO), uso fracionado e individual, custo médio, saldo por unidade, kardex e estorno (aditiva).','FIN-E3');
