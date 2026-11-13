-- =====================================================================================
-- FIN-E2 — Financeiro · Entrega 2 (vendas, recebimentos, títulos e caixa diário).
-- 100% ADITIVA: cria tabelas fin_sales*, fin_payments*, fin_receivables, fin_cash_*, fin_compliance_acceptances,
-- fin_events; funções private.fin_* e public.fin_*; recria (create or replace) private.fin_area_roles e
-- public.fin_my_access da Entrega 1 PRESERVANDO o comportamento anterior e acrescentando áreas novas.
-- Depende de 20261113100000_fin_e1_base.sql (fin_can, fin_log, fin_acquirers, fin_fee_rows, fin_settings...).
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local).
--
-- Regras que valem no servidor:
--  * escrita SÓ por RPC security definer (search_path vazio); tabelas sem INSERT/UPDATE/DELETE para anon/authenticated;
--  * sem exclusão física: venda cancela, recebimento e título estornam (status), com motivo e fin_audit_log;
--  * dinheiro em centavos inteiros; arredondamento meio-para-cima POR LINHA; resto na última linha;
--  * toda RPC passa por private.fin_can(...) com a unidade da linha.
-- =====================================================================================

-- ---------- 1. Matriz de papéis (replace: preserva as áreas da E1, acrescenta as da E2) ----------
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
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance'];
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
create table if not exists public.fin_compliance_acceptances (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete cascade,
  type text not null check (type in ('compounded_no_license','commission_on_medication')),
  accepted_by uuid not null,
  accepted_at timestamptz not null default now(),
  text_version text not null default 'v1'
);
create unique index if not exists fin_compliance_acceptances_uq on public.fin_compliance_acceptances (clinic_id, unit_id, type);

create table if not exists public.fin_cash_registers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete restrict,
  operator_profile_id uuid not null,
  business_date date not null,
  opened_at timestamptz not null default now(),
  opening_cash_cents integer not null check (opening_cash_cents between 0 and 100000000),
  status text not null default 'open' check (status in ('open','pending_approval','closed')),
  closed_at timestamptz,
  expected_lines jsonb,                       -- [{key,label,expected_cents,counted_cents,difference_cents}]
  counted_cash_cents integer,
  expected_cash_cents integer,
  difference_cents integer,                   -- soma das diferenças ABSOLUTAS (todas as formas)
  cash_difference_cents integer,              -- diferença em espécie (contado − esperado, com sinal)
  justification text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (status = 'open' or closed_at is not null)
);
-- F20: um único caixa ABERTO por operador (na clínica). Defesa em profundidade da checagem da RPC.
create unique index if not exists fin_cash_registers_one_open_uq on public.fin_cash_registers (clinic_id, operator_profile_id) where status = 'open';
create index if not exists fin_cash_registers_clinic_day_idx on public.fin_cash_registers (clinic_id, business_date desc);

create table if not exists public.fin_cash_movements (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.fin_cash_registers(id) on delete cascade,
  clinic_id uuid not null,
  unit_id uuid not null,
  type text not null check (type in ('sangria','suprimento')),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  reason text not null check (char_length(btrim(reason)) >= 3),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists fin_cash_movements_reg_idx on public.fin_cash_movements (register_id);

create table if not exists public.fin_sales (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  status text not null default 'open' check (status in ('open','partial','paid','canceled')),
  total_gross_cents integer not null check (total_gross_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_net_cents integer not null check (total_net_cents > 0),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  seller_professional_id uuid references public.professionals(id) on delete set null,
  referrer_professional_id uuid references public.professionals(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  cancel_reason text,
  canceled_at timestamptz,
  canceled_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_net_cents = total_gross_cents - discount_cents),
  check (status <> 'canceled' or (cancel_reason is not null and canceled_at is not null))
);
create index if not exists fin_sales_clinic_idx on public.fin_sales (clinic_id, created_at desc);
create index if not exists fin_sales_patient_idx on public.fin_sales (patient_id);
create index if not exists fin_sales_seller_idx on public.fin_sales (seller_professional_id);

create table if not exists public.fin_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.fin_sales(id) on delete cascade,
  position integer not null,
  item_type text not null check (item_type in ('service','package','product','compounded')),
  service_id uuid references public.fin_services(id) on delete restrict,
  package_id uuid references public.fin_packages(id) on delete restrict,
  stock_item_id uuid references public.stock_items(id) on delete restrict,
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  list_price_cents integer not null check (list_price_cents >= 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  gross_cents integer not null check (gross_cents >= 0),
  discount_item_cents integer not null default 0 check (discount_item_cents >= 0),
  discount_share_cents integer not null default 0 check (discount_share_cents >= 0),   -- parte do desconto TOTAL rateada
  net_cents integer not null check (net_cents >= 0),
  check (net_cents = gross_cents - discount_item_cents - discount_share_cents),
  check ((item_type = 'service' and service_id is not null and package_id is null and stock_item_id is null)
      or (item_type = 'package' and package_id is not null and service_id is null and stock_item_id is null)
      or (item_type in ('product','compounded') and stock_item_id is not null and service_id is null and package_id is null))
);
create index if not exists fin_sale_items_sale_idx on public.fin_sale_items (sale_id, position);

create table if not exists public.fin_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete restrict,
  sale_id uuid not null references public.fin_sales(id) on delete restrict,
  cash_register_id uuid references public.fin_cash_registers(id) on delete restrict,
  acquirer_id uuid not null references public.fin_acquirers(id) on delete restrict,
  method text not null check (method in ('pix','cash','transfer','boleto','debit','credit')),
  cash_key text not null,                       -- chave de conferência do caixa: pix | cash | transfer | boleto | machine:<id>:<bandeira>
  cash_label text not null,
  brand text,
  modality text check (modality is null or modality in ('debit','credit_1','credit_2_6','credit_7_12')),
  installments integer not null default 1 check (installments between 1 and 12),
  amount_cents integer not null check (amount_cents > 0),
  paid_on date not null,
  nsu text check (nsu is null or char_length(nsu) <= 40),
  status text not null default 'active' check (status in ('active','reversed')),
  reversed_at timestamptz,
  reverse_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (status = 'active' or (reversed_at is not null and reverse_reason is not null))
);
create index if not exists fin_payments_sale_idx on public.fin_payments (sale_id);
create index if not exists fin_payments_register_idx on public.fin_payments (cash_register_id) where cash_register_id is not null;
create index if not exists fin_payments_clinic_idx on public.fin_payments (clinic_id, paid_on desc);

-- Distribuição do recebimento entre os itens da venda (proporcional ao valor líquido de desconto, §5.2) — base do repasse (E5).
create table if not exists public.fin_payment_allocations (
  payment_id uuid not null references public.fin_payments(id) on delete restrict,
  sale_item_id uuid not null references public.fin_sale_items(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  primary key (payment_id, sale_item_id)
);

create table if not exists public.fin_receivables (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete restrict,
  sale_id uuid not null references public.fin_sales(id) on delete restrict,
  payment_id uuid not null references public.fin_payments(id) on delete restrict,
  installment_no integer not null check (installment_no >= 1),
  installments integer not null check (installments >= 1),
  gross_cents integer not null check (gross_cents > 0),
  fee_cents integer not null check (fee_cents >= 0),
  net_cents integer not null check (net_cents >= 0),
  expected_date date not null,
  settled_date date,
  settled_net_cents integer check (settled_net_cents is null or settled_net_cents >= 0),
  status text not null default 'expected' check (status in ('expected','settled','reversed')),
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, installment_no),
  check (net_cents = gross_cents - fee_cents),
  check (status <> 'settled' or (settled_date is not null and settled_net_cents is not null)),
  check (status <> 'reversed' or (reversed_at is not null and reverse_reason is not null))
);
create index if not exists fin_receivables_due_idx on public.fin_receivables (expected_date) where status = 'expected';
create index if not exists fin_receivables_clinic_idx on public.fin_receivables (clinic_id, expected_date);
create index if not exists fin_receivables_sale_idx on public.fin_receivables (sale_id);

-- Eventos para o motor de repasse (Entrega 5): cancelamento de venda, estorno de recebimento/título. Sem leitura pelo cliente.
create table if not exists public.fin_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  unit_id uuid,
  event_type text not null check (event_type in ('sale_canceled','payment_reversed','receivable_reversed','receivable_settled')),
  sale_id uuid,
  payment_id uuid,
  receivable_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists fin_events_pending_idx on public.fin_events (clinic_id, created_at) where processed_at is null;

-- ---------- 3. Helpers internos ----------
create or replace function private.fin_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Distribui um total inteiro por pesos inteiros: meio-para-cima por linha, diferença na ÚLTIMA linha (§3, §5.2).
create or replace function private.fin_distribute(p_total bigint, p_weights bigint[]) returns bigint[]
language plpgsql immutable set search_path = '' as $$
declare n int := coalesce(cardinality(p_weights), 0); s bigint := 0; i int; acc bigint := 0; v bigint; r bigint[] := '{}';
begin
  if n = 0 then return r; end if;
  for i in 1..n loop s := s + p_weights[i]; end loop;
  if s <= 0 then raise exception 'INVALID_WEIGHTS' using errcode = '22023'; end if;
  for i in 1..n loop
    if i = n then v := p_total - acc;
    else v := round(p_total::numeric * p_weights[i] / s)::bigint; acc := acc + v; end if;
    r := r || v;
  end loop;
  return r;
end $$;

create or replace function private.fin_sale_visible(p_sale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_sales s
                  where s.id = p_sale
                    and (private.fin_can(s.clinic_id, 'sales', s.unit_id, false)
                         or (s.seller_professional_id is not null and private.fin_is_self_professional(s.seller_professional_id))))
$$;

create or replace function private.fin_cash_key(p_kind text, p_acquirer uuid, p_brand text) returns text
language sql immutable set search_path = '' as $$
  select case when p_kind = 'machine' then 'machine:' || p_acquirer::text || ':' || lower(btrim(coalesce(p_brand, ''))) else p_kind end
$$;

-- Títulos de um recebimento (§4.3). Devolve uma linha por parcela: bruto, taxa, líquido e data prevista.
create or replace function private.fin_build_titles(p_acquirer uuid, p_brand text, p_modality text, p_installments integer, p_amount integer, p_paid_on date)
returns table (installment_no integer, gross_cents integer, fee_cents integer, net_cents integer, expected_date date)
language plpgsql stable security definer set search_path = '' as $$
declare a public.fin_acquirers; f public.fin_fee_rows; v_n integer := coalesce(p_installments, 1); v_pct numeric; v_fixed integer := 0;
        v_antic boolean := false; v_days integer; i integer; v_acc integer := 0; v_gross integer; v_fee integer;
begin
  select * into a from public.fin_acquirers where id = p_acquirer;
  if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if a.kind = 'machine' then
    if p_modality is null or p_modality not in ('debit','credit_1','credit_2_6','credit_7_12') then raise exception 'INVALID_MODALITY' using errcode = '22023'; end if;
    if (p_modality in ('debit','credit_1') and v_n <> 1) or (p_modality = 'credit_2_6' and v_n not between 2 and 6) or (p_modality = 'credit_7_12' and v_n not between 7 and 12) then
      raise exception 'INSTALLMENTS_MODALITY_MISMATCH' using errcode = '22023';
    end if;
    select * into f from public.fin_fee_rows r where r.acquirer_id = p_acquirer and lower(btrim(r.brand)) = lower(btrim(coalesce(p_brand, ''))) and r.modality = p_modality;
    if f.id is null then raise exception 'FEE_NOT_CONFIGURED' using errcode = '22023'; end if;
    v_pct := f.fee_pct; v_antic := f.anticipation;
    if v_antic then v_pct := v_pct + f.anticipation_fee_pct; end if;   -- com antecipação: taxa somada
  else
    if v_n <> 1 then raise exception 'INSTALLMENTS_MODALITY_MISMATCH' using errcode = '22023'; end if;
    v_pct := a.flat_fee_pct; v_fixed := a.flat_fee_cents;
  end if;
  for i in 1..v_n loop
    v_gross := case when i = v_n then p_amount - v_acc else round(p_amount::numeric / v_n)::integer end;
    v_acc := v_acc + v_gross;
    v_fee := round(v_gross::numeric * v_pct / 100)::integer + case when i = 1 then v_fixed else 0 end;
    if v_fee > v_gross then raise exception 'FEE_EXCEEDS_AMOUNT' using errcode = '22023'; end if;
    installment_no := i; gross_cents := v_gross; fee_cents := v_fee; net_cents := v_gross - v_fee;
    if a.kind <> 'machine' then v_days := a.settle_days;
    elsif v_antic then v_days := f.anticipation_days;              -- todas as parcelas no prazo de antecipação
    else v_days := f.settle_days * i;                              -- parcela n: data + prazo × n
    end if;
    expected_date := p_paid_on + v_days;
    return next;
  end loop;
end $$;

-- Recalcula pago e status da venda: pago = recebimentos ativos − bruto dos títulos estornados (chargeback/recusa).
create or replace function private.fin_sale_recalc(p_sale uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.fin_sales; v_paid integer;
begin
  select * into s from public.fin_sales where id = p_sale for update;
  if s.id is null or s.status = 'canceled' then return; end if;
  select coalesce((select sum(p.amount_cents) from public.fin_payments p where p.sale_id = p_sale and p.status = 'active'), 0)
       - coalesce((select sum(r.gross_cents) from public.fin_receivables r join public.fin_payments p on p.id = r.payment_id
                    where r.sale_id = p_sale and r.status = 'reversed' and p.status = 'active'), 0)
    into v_paid;
  update public.fin_sales set paid_cents = greatest(v_paid, 0),
         status = case when v_paid >= total_net_cents then 'paid' when v_paid > 0 then 'partial' else 'open' end, updated_at = now()
   where id = p_sale;
end $$;

-- Esperado do caixa por forma: espécie = troco + recebimentos em espécie + suprimentos − sangrias; demais = recebimentos ativos.
create or replace function private.fin_cash_expected(p_register uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.fin_cash_registers; v_cash integer; v_lines jsonb;
begin
  select * into r from public.fin_cash_registers where id = p_register;
  if r.id is null then return '[]'::jsonb; end if;
  select r.opening_cash_cents
         + coalesce((select sum(p.amount_cents) from public.fin_payments p where p.cash_register_id = r.id and p.status = 'active' and p.cash_key = 'cash'), 0)
         + coalesce((select sum(case m.type when 'suprimento' then m.amount_cents else -m.amount_cents end) from public.fin_cash_movements m where m.register_id = r.id), 0)
    into v_cash;
  select jsonb_build_array(jsonb_build_object('key', 'cash', 'label', 'Dinheiro (espécie)', 'expected_cents', v_cash))
         || coalesce((select jsonb_agg(jsonb_build_object('key', g.cash_key, 'label', g.cash_label, 'expected_cents', g.total) order by g.cash_label)
                        from (select p.cash_key, min(p.cash_label) as cash_label, sum(p.amount_cents)::integer as total
                                from public.fin_payments p where p.cash_register_id = r.id and p.status = 'active' and p.cash_key <> 'cash'
                               group by p.cash_key) g), '[]'::jsonb)
    into v_lines;
  return v_lines;
end $$;

create or replace function private.fin_cash_can_see(p_register uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_cash_registers c
                  where c.id = p_register
                    and (c.operator_profile_id = private.current_profile_id() or private.fin_can(c.clinic_id, 'cash_all', c.unit_id, false)))
$$;

-- Liquidação (automática ou manual) de um título previsto; grava log. p_by null = rotina diária.
create or replace function private.fin_do_settle(p_receivable uuid, p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.fin_receivables; v_before jsonb;
begin
  select * into r from public.fin_receivables where id = p_receivable for update;
  if r.id is null or r.status <> 'expected' then return; end if;
  v_before := to_jsonb(r);
  update public.fin_receivables set status = 'settled', settled_date = p_date, settled_net_cents = net_cents, updated_at = now()
   where id = r.id returning * into r;
  perform private.fin_log(r.clinic_id, r.unit_id, 'receivable', r.id, 'update', v_before, to_jsonb(r), p_reason);
  insert into public.fin_events (clinic_id, unit_id, event_type, sale_id, payment_id, receivable_id, payload, created_by)
    values (r.clinic_id, r.unit_id, 'receivable_settled', r.sale_id, r.payment_id, r.id,
            jsonb_build_object('settled_date', p_date, 'settled_net_cents', r.settled_net_cents, 'gross_cents', r.gross_cents, 'fee_cents', r.fee_cents), private.current_profile_id());
end $$;

-- Rotina diária (pg_cron): liquida títulos vencidos das clínicas com liquidação automática ligada.
create or replace function private.fin_auto_settle_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0; v_today date := private.fin_today();
begin
  for r in select rc.id from public.fin_receivables rc join public.fin_settings st on st.clinic_id = rc.clinic_id
            where rc.status = 'expected' and rc.expected_date <= v_today and st.auto_settle order by rc.expected_date, rc.id loop
    perform private.fin_do_settle(r.id, v_today, 'liquidação automática');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------- 4. RLS e grants (leitura; escrita só por RPC) ----------
alter table public.fin_compliance_acceptances enable row level security;
alter table public.fin_cash_registers enable row level security;
alter table public.fin_cash_movements enable row level security;
alter table public.fin_sales enable row level security;
alter table public.fin_sale_items enable row level security;
alter table public.fin_payments enable row level security;
alter table public.fin_payment_allocations enable row level security;
alter table public.fin_receivables enable row level security;
alter table public.fin_events enable row level security;

revoke all on public.fin_compliance_acceptances, public.fin_cash_registers, public.fin_cash_movements, public.fin_sales, public.fin_sale_items,
  public.fin_payments, public.fin_payment_allocations, public.fin_receivables, public.fin_events from anon, authenticated;
grant select on public.fin_compliance_acceptances, public.fin_cash_registers, public.fin_cash_movements, public.fin_sales, public.fin_sale_items,
  public.fin_payments, public.fin_payment_allocations, public.fin_receivables to authenticated;
-- fin_events: sem leitura direta (consumo interno da Entrega 5).

create policy fin_compliance_acceptances_select on public.fin_compliance_acceptances for select to authenticated
  using (private.fin_can(clinic_id, 'compliance', unit_id, false));
create policy fin_cash_registers_select on public.fin_cash_registers for select to authenticated
  using (operator_profile_id = private.current_profile_id() or private.fin_can(clinic_id, 'cash_all', unit_id, false));
create policy fin_cash_movements_select on public.fin_cash_movements for select to authenticated
  using (private.fin_cash_can_see(register_id));
create policy fin_sales_select on public.fin_sales for select to authenticated
  using (private.fin_can(clinic_id, 'sales', unit_id, false)
         or (seller_professional_id is not null and private.fin_is_self_professional(seller_professional_id)));
create policy fin_sale_items_select on public.fin_sale_items for select to authenticated
  using (private.fin_sale_visible(sale_id));
create policy fin_payments_select on public.fin_payments for select to authenticated
  using (private.fin_can(clinic_id, 'sales', unit_id, false));
create policy fin_payment_allocations_select on public.fin_payment_allocations for select to authenticated
  using (exists (select 1 from public.fin_payments p where p.id = payment_id and private.fin_can(p.clinic_id, 'sales', p.unit_id, false)));
create policy fin_receivables_select on public.fin_receivables for select to authenticated
  using (private.fin_can(clinic_id, 'receivables', unit_id, false));

grant execute on function private.fin_sale_visible(uuid), private.fin_cash_can_see(uuid) to authenticated;

-- ---------- 5. RPCs: venda ----------
-- 5.1 Pacientes da clínica para a venda (nome em profiles; Recepção não precisa de acesso clínico).
create or replace function public.fin_sale_patients(p_clinic uuid, p_search text default null, p_limit integer default 20)
returns table (patient_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'sales', null, true);
  return query
    select pt.id, pr.full_name
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic
       and (nullif(btrim(coalesce(p_search, '')), '') is null or pr.full_name ilike '%' || btrim(p_search) || '%')
     order by pr.full_name limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- 5.1b Catálogo para a venda: só o que pode ser vendido, com preço da unidade. Recepção não lê os cadastros (RLS da E1),
-- então a lista vem por RPC (sem custo, sem taxa). Profissionais ativos para vendedor/indicador.
create or replace function public.fin_sale_catalog(p_clinic uuid, p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'sales', p_unit, true);
  return jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category,
        'price_cents', coalesce((select up.price_cents from public.fin_service_unit_prices up where up.service_id = s.id and up.unit_id = p_unit), s.default_price_cents)) order by s.name)
      from public.fin_services s where s.clinic_id = p_clinic and s.is_active), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'price_cents', k.price_cents) order by k.name)
      from public.fin_packages k where k.clinic_id = p_clinic and k.is_active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'item_type', i.item_type, 'price_cents', i.sale_price_cents) order by i.name)
      from public.stock_items i where i.clinic_id = p_clinic and i.is_active and i.sellable and i.item_type in ('resale','compounded') and i.sale_price_cents is not null), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', prof.full_name) order by prof.full_name)
      from public.professionals pr join public.profiles prof on prof.id = pr.profile_id
      where pr.clinic_id = p_clinic and coalesce(pr.status, 'active') = 'active'), '[]'::jsonb),
    'can_edit_price', private.fin_can(p_clinic, 'sales_price', p_unit, true));
end $$;

-- 6.0 Opções de recebimento (meios ativos da unidade). As TAXAS só vão para quem lê o cadastro de meios de pagamento (gestor/financeiro/admin).
create or replace function public.fin_payment_options(p_clinic uuid, p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_fees boolean;
begin
  perform private.fin_gate(p_clinic, 'sales', p_unit, true);
  v_fees := private.fin_can(p_clinic, 'payment', p_unit, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
        'flat_fee_pct', case when v_fees then a.flat_fee_pct end, 'flat_fee_cents', case when v_fees then a.flat_fee_cents end, 'settle_days', case when v_fees then a.settle_days end,
        'rows', coalesce((select jsonb_agg(jsonb_build_object('brand', f.brand, 'modality', f.modality,
            'fee_pct', case when v_fees then f.fee_pct end, 'settle_days', case when v_fees then f.settle_days end, 'anticipation', case when v_fees then f.anticipation end,
            'anticipation_fee_pct', case when v_fees then f.anticipation_fee_pct end, 'anticipation_days', case when v_fees then f.anticipation_days end) order by f.brand, f.modality)
          from public.fin_fee_rows f where f.acquirer_id = a.id), '[]'::jsonb)) order by a.kind, a.name)
      from public.fin_acquirers a where a.clinic_id = p_clinic and a.is_active and (a.unit_id is null or a.unit_id = p_unit)), '[]'::jsonb);
end $$;

-- 5.2 Aceite do Owner (F18): uma vez por unidade e tipo; só Owner/Admin.
create or replace function public.fin_accept_compliance(p_clinic uuid, p_unit uuid, p_type text default 'compounded_no_license') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_row public.fin_compliance_acceptances;
begin
  perform private.fin_gate(p_clinic, 'compliance', p_unit, true);
  if not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_type is null or p_type not in ('compounded_no_license','commission_on_medication') then raise exception 'INVALID_TYPE' using errcode = '22023'; end if;
  insert into public.fin_compliance_acceptances (clinic_id, unit_id, type, accepted_by) values (p_clinic, p_unit, p_type, private.current_profile_id())
    on conflict (clinic_id, unit_id, type) do nothing returning * into v_row;
  if v_row.id is null then
    select id into v_id from public.fin_compliance_acceptances where clinic_id = p_clinic and unit_id = p_unit and type = p_type;
    return v_id;
  end if;
  perform private.fin_log(p_clinic, p_unit, 'compliance', v_row.id, 'create', null, to_jsonb(v_row), 'aceite do Owner: ' || p_type);
  return v_row.id;
end $$;

create or replace function public.fin_compliance_status(p_clinic uuid, p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u public.clinic_units; v_license boolean; v_acc boolean;
begin
  perform private.fin_gate(p_clinic, 'sales', p_unit, false);
  select * into u from public.clinic_units where id = p_unit and clinic_id = p_clinic;
  if u.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_license := u.license_number is not null and (u.license_valid_until is null or u.license_valid_until >= private.fin_today());
  v_acc := exists (select 1 from public.fin_compliance_acceptances a where a.clinic_id = p_clinic and a.unit_id = p_unit and a.type = 'compounded_no_license');
  return jsonb_build_object('license_ok', v_license, 'accepted', v_acc, 'blocked', not v_license and not v_acc);
end $$;

-- 5.3 Registrar venda. p_items: [{item_type: service|package|product, ref_id, quantity, unit_price_cents?, discount_cents?, discount_pct?}]
create or replace function public.fin_save_sale(p_clinic uuid, p_unit uuid, p_patient uuid, p_items jsonb, p_total_discount_cents integer default 0,
                                                p_total_discount_pct numeric default null, p_seller uuid default null, p_referrer uuid default null, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb; i integer := 0; n integer; v_type text; v_ref uuid; v_qty numeric; v_list integer; v_price integer; v_gross integer; v_disc integer; v_name text;
  v_stype text; si public.stock_items; sv public.fin_services; pk public.fin_packages; u public.clinic_units;
  v_types text[] := '{}'; v_refs uuid[] := '{}'; v_names text[] := '{}'; v_qtys numeric[] := '{}'; v_lists integer[] := '{}'; v_prices integer[] := '{}';
  v_grosses integer[] := '{}'; v_discs integer[] := '{}'; v_nets bigint[] := '{}'; v_shares bigint[];
  v_sum_gross integer := 0; v_sum_net bigint := 0; v_total_disc integer := coalesce(p_total_discount_cents, 0); v_seller uuid := p_seller;
  s public.fin_sales; v_has_compounded boolean := false; v_can_price boolean;
begin
  perform private.fin_gate(p_clinic, 'sales', p_unit, true);
  select * into u from public.clinic_units where id = p_unit and clinic_id = p_clinic and is_active;
  if u.id is null then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if not exists (select 1 from public.patients pt where pt.id = p_patient and pt.clinic_id = p_clinic) then raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED' using errcode = '22023'; end if;
  if v_seller is null then
    select pr.id into v_seller from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active' limit 1;
  end if;
  if v_seller is not null and not exists (select 1 from public.professionals pr where pr.id = v_seller and pr.clinic_id = p_clinic) then raise exception 'INVALID_SELLER' using errcode = '22023'; end if;
  if p_referrer is not null and not exists (select 1 from public.professionals pr where pr.id = p_referrer and pr.clinic_id = p_clinic) then raise exception 'INVALID_SELLER' using errcode = '22023'; end if;
  v_can_price := private.fin_can(p_clinic, 'sales_price', p_unit, true);

  for x in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    v_type := x->>'item_type'; v_ref := nullif(x->>'ref_id', '')::uuid; v_qty := round((x->>'quantity')::numeric, 3);
    if v_ref is null or v_qty is null or v_qty <= 0 then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    if v_type = 'service' then
      select * into sv from public.fin_services where id = v_ref and clinic_id = p_clinic and is_active;
      if sv.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
      v_list := coalesce((select up.price_cents from public.fin_service_unit_prices up where up.service_id = sv.id and up.unit_id = p_unit), sv.default_price_cents);
      v_name := sv.name; v_stype := 'service';
    elsif v_type = 'package' then
      select * into pk from public.fin_packages where id = v_ref and clinic_id = p_clinic and is_active;
      if pk.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
      v_list := pk.price_cents; v_name := pk.name; v_stype := 'package';
    elsif v_type = 'product' then
      select * into si from public.stock_items where id = v_ref and clinic_id = p_clinic and is_active;
      if si.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
      if si.item_type = 'medication' then raise exception 'MEDICATION_NOT_SELLABLE' using errcode = '22023'; end if;   -- E13
      if si.item_type = 'consumable' or not si.sellable or si.sale_price_cents is null then raise exception 'ITEM_NOT_SELLABLE' using errcode = '22023'; end if;
      v_list := si.sale_price_cents; v_name := si.name; v_stype := case when si.item_type = 'compounded' then 'compounded' else 'product' end;
      if v_stype = 'compounded' then v_has_compounded := true; end if;
    else raise exception 'INVALID_ITEM' using errcode = '22023'; end if;

    v_price := coalesce(nullif(x->>'unit_price_cents', '')::integer, v_list);
    if v_price < 0 then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
    if v_price <> v_list and not v_can_price then raise exception 'PRICE_NOT_ALLOWED' using errcode = '42501'; end if;
    v_gross := round(v_price::numeric * v_qty)::integer;
    v_disc := case when nullif(x->>'discount_pct', '') is not null then round(v_gross::numeric * (x->>'discount_pct')::numeric / 100)::integer
                   else coalesce(nullif(x->>'discount_cents', '')::integer, 0) end;
    if v_disc < 0 or v_disc > v_gross then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
    v_types := v_types || v_stype; v_refs := v_refs || v_ref; v_names := v_names || v_name; v_qtys := v_qtys || v_qty; v_lists := v_lists || v_list;
    v_prices := v_prices || v_price; v_grosses := v_grosses || v_gross; v_discs := v_discs || v_disc; v_nets := v_nets || (v_gross - v_disc)::bigint;
    v_sum_gross := v_sum_gross + v_gross; v_sum_net := v_sum_net + (v_gross - v_disc);
  end loop;
  n := i;

  -- Manipulado em unidade sem licença sanitária válida: exige o aceite do Owner (uma vez por unidade) — F18.
  if v_has_compounded and not (u.license_number is not null and (u.license_valid_until is null or u.license_valid_until >= private.fin_today()))
     and not exists (select 1 from public.fin_compliance_acceptances a where a.clinic_id = p_clinic and a.unit_id = p_unit and a.type = 'compounded_no_license') then
    raise exception 'COMPLIANCE_ACCEPTANCE_REQUIRED' using errcode = '42501';
  end if;

  -- Desconto no total (valor ou %), rateado entre os itens proporcionalmente ao líquido de cada um (§5.2/D23).
  if p_total_discount_pct is not null then v_total_disc := round(v_sum_net::numeric * p_total_discount_pct / 100)::integer; end if;
  if v_total_disc < 0 or v_total_disc > v_sum_net then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
  if v_sum_net - v_total_disc <= 0 then raise exception 'SALE_TOTAL_REQUIRED' using errcode = '22023'; end if;
  if v_sum_net > 0 then v_shares := private.fin_distribute(v_total_disc, v_nets); else v_shares := array_fill(0::bigint, array[n]); end if;
  for i in 1..n loop
    if v_shares[i] > v_nets[i] then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
  end loop;

  insert into public.fin_sales (clinic_id, unit_id, patient_id, total_gross_cents, discount_cents, total_net_cents, seller_professional_id, referrer_professional_id, notes, created_by)
    values (p_clinic, p_unit, p_patient, v_sum_gross, (v_sum_gross - v_sum_net::integer) + v_total_disc, v_sum_gross - ((v_sum_gross - v_sum_net::integer) + v_total_disc),
            v_seller, p_referrer, nullif(btrim(coalesce(p_notes, '')), ''), private.current_profile_id())
    returning * into s;
  for i in 1..n loop
    insert into public.fin_sale_items (sale_id, position, item_type, service_id, package_id, stock_item_id, description, quantity, list_price_cents, unit_price_cents,
                                       gross_cents, discount_item_cents, discount_share_cents, net_cents)
      values (s.id, i, v_types[i], case when v_types[i] = 'service' then v_refs[i] end, case when v_types[i] = 'package' then v_refs[i] end,
              case when v_types[i] in ('product','compounded') then v_refs[i] end, v_names[i], v_qtys[i], v_lists[i], v_prices[i],
              v_grosses[i], v_discs[i], v_shares[i]::integer, (v_nets[i] - v_shares[i])::integer);
  end loop;
  perform private.fin_log(p_clinic, p_unit, 'sale', s.id, 'create', null,
    to_jsonb(s) || jsonb_build_object('items', (select jsonb_agg(jsonb_build_object('description', it.description, 'quantity', it.quantity, 'unit_price_cents', it.unit_price_cents,
        'discount_item_cents', it.discount_item_cents, 'discount_share_cents', it.discount_share_cents, 'net_cents', it.net_cents) order by it.position)
        from public.fin_sale_items it where it.sale_id = s.id)), p_notes);
  return s.id;
end $$;

-- 5.4 Lista de vendas (Recepção/Financeiro/Gestor: todas da unidade; Profissional: só as próprias).
create or replace function public.fin_sales_list(p_clinic uuid, p_unit uuid default null, p_status text default null, p_from date default null, p_to date default null,
                                                 p_limit integer default 200, p_offset integer default 0)
returns table (id uuid, created_at timestamptz, unit_id uuid, unit_name text, patient_id uuid, patient_name text, status text, total_gross_cents integer, discount_cents integer,
               total_net_cents integer, paid_cents integer, seller_id uuid, seller_name text, items_count bigint, cancel_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, s.created_at, s.unit_id, u.name, s.patient_id, ppr.full_name, s.status, s.total_gross_cents, s.discount_cents, s.total_net_cents, s.paid_cents,
           s.seller_professional_id, spr.full_name, (select count(*) from public.fin_sale_items it where it.sale_id = s.id), s.cancel_reason
      from public.fin_sales s
      join public.clinic_units u on u.id = s.unit_id
      join public.patients pt on pt.id = s.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
      left join public.professionals sp on sp.id = s.seller_professional_id
      left join public.profiles spr on spr.id = sp.profile_id
     where s.clinic_id = p_clinic
       and (p_unit is null or s.unit_id = p_unit)
       and (p_status is null or s.status = p_status)
       and (p_from is null or (s.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to is null or (s.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
       and (private.fin_can(p_clinic, 'sales', s.unit_id, false) or (s.seller_professional_id is not null and private.fin_is_self_professional(s.seller_professional_id)))
     order by s.created_at desc, s.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- 5.5 Detalhe da venda: itens; recebimentos (quem lança) e títulos (quem enxerga taxa).
create or replace function public.fin_sale_get(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.fin_sales; v_out jsonb; v_pay boolean; v_rec boolean;
begin
  select * into s from public.fin_sales where id = p_sale;
  if s.id is null or not private.fin_sale_visible(p_sale) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_pay := private.fin_can(s.clinic_id, 'sales', s.unit_id, false);
  v_rec := private.fin_can(s.clinic_id, 'receivables', s.unit_id, false);
  select to_jsonb(s)
    || jsonb_build_object(
         'unit_name', (select u.name from public.clinic_units u where u.id = s.unit_id),
         'patient_name', (select pr.full_name from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = s.patient_id),
         'seller_name', (select pr.full_name from public.professionals sp join public.profiles pr on pr.id = sp.profile_id where sp.id = s.seller_professional_id),
         'items', coalesce((select jsonb_agg(to_jsonb(it) order by it.position) from public.fin_sale_items it where it.sale_id = s.id), '[]'::jsonb),
         'payments', case when v_pay then coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('acquirer_name', a.name) order by p.created_at)
                                                       from public.fin_payments p join public.fin_acquirers a on a.id = p.acquirer_id where p.sale_id = s.id), '[]'::jsonb) else '[]'::jsonb end,
         'receivables', case when v_rec then coalesce((select jsonb_agg(to_jsonb(r) order by r.payment_id, r.installment_no) from public.fin_receivables r where r.sale_id = s.id), '[]'::jsonb) else '[]'::jsonb end)
    into v_out;
  return v_out;
end $$;

-- 5.6 Cancelar venda: motivo obrigatório; estorna recebimentos e títulos (nada é apagado) e deixa o evento pronto p/ o repasse (E5).
create or replace function public.fin_cancel_sale(p_sale uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.fin_sales; v_before jsonb; p public.fin_payments; r public.fin_receivables; v_reg_closed boolean;
begin
  select * into s from public.fin_sales where id = p_sale for update;
  if s.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(s.clinic_id, 'sale_cancel', s.unit_id, true);
  if s.status = 'canceled' then raise exception 'ALREADY_CANCELED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_before := to_jsonb(s);
  for p in select * from public.fin_payments where sale_id = s.id and status = 'active' order by created_at loop
    select coalesce(c.status <> 'open', false) into v_reg_closed from public.fin_cash_registers c where c.id = p.cash_register_id;
    update public.fin_payments set status = 'reversed', reversed_at = now(), reverse_reason = btrim(p_reason) where id = p.id;
    for r in select * from public.fin_receivables where payment_id = p.id and status <> 'reversed' order by installment_no loop
      update public.fin_receivables set status = 'reversed', reversed_at = now(), reverse_reason = btrim(p_reason), updated_at = now() where id = r.id;
      insert into public.fin_events (clinic_id, unit_id, event_type, sale_id, payment_id, receivable_id, payload, created_by)
        values (s.clinic_id, s.unit_id, 'receivable_reversed', s.id, p.id, r.id,
                jsonb_build_object('reason', 'sale_canceled', 'was_settled', r.status = 'settled', 'settled_date', r.settled_date, 'gross_cents', r.gross_cents, 'installment_no', r.installment_no), private.current_profile_id());
    end loop;
    insert into public.fin_events (clinic_id, unit_id, event_type, sale_id, payment_id, payload, created_by)
      values (s.clinic_id, s.unit_id, 'payment_reversed', s.id, p.id, jsonb_build_object('amount_cents', p.amount_cents, 'cash_register_closed', coalesce(v_reg_closed, false)), private.current_profile_id());
    perform private.fin_log(s.clinic_id, s.unit_id, 'payment', p.id, 'reverse', to_jsonb(p), jsonb_build_object('status', 'reversed'), p_reason);
  end loop;
  update public.fin_sales set status = 'canceled', paid_cents = 0, cancel_reason = btrim(p_reason), canceled_at = now(), canceled_by = private.current_profile_id(), updated_at = now()
   where id = s.id returning * into s;
  insert into public.fin_events (clinic_id, unit_id, event_type, sale_id, payload, created_by)
    values (s.clinic_id, s.unit_id, 'sale_canceled', s.id, jsonb_build_object('reason', s.cancel_reason, 'total_net_cents', s.total_net_cents), private.current_profile_id());
  perform private.fin_log(s.clinic_id, s.unit_id, 'sale', s.id, 'reverse', v_before, to_jsonb(s), p_reason);
end $$;

-- ---------- 6. RPCs: recebimento e títulos ----------
-- 6.1 Lançar recebimento (manual): gera títulos, distribui entre os itens, vincula ao caixa aberto do operador e liquida o que já venceu.
create or replace function public.fin_add_payment(p_sale uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.fin_sales; a public.fin_acquirers; v_acq uuid := nullif(p_data->>'acquirer_id', '')::uuid; v_amount integer := nullif(p_data->>'amount_cents', '')::integer;
  v_n integer := coalesce(nullif(p_data->>'installments', '')::integer, 1); v_mod text := nullif(p_data->>'modality', ''); v_brand text := nullif(btrim(coalesce(p_data->>'brand', '')), '');
  v_paid_on date := coalesce(nullif(p_data->>'paid_on', '')::date, private.fin_today()); v_method text; v_reg public.fin_cash_registers; v_staff boolean;
  p public.fin_payments; t record; v_item_ids uuid[]; v_nets bigint[]; v_alloc bigint[]; i integer; v_settings public.fin_settings; v_rec uuid; v_today date := private.fin_today();
begin
  select * into s from public.fin_sales where id = p_sale for update;
  if s.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(s.clinic_id, 'sales', s.unit_id, true);
  if s.status = 'canceled' then raise exception 'SALE_CANCELED' using errcode = '22023'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  if v_amount > s.total_net_cents - s.paid_cents then raise exception 'OVERPAYMENT' using errcode = '22023'; end if;
  if v_paid_on > v_today then raise exception 'PAID_ON_FUTURE' using errcode = '22023'; end if;
  if v_paid_on <> v_today and not private.fin_can(s.clinic_id, 'receivables_fix', s.unit_id, true) then raise exception 'PAST_DATE_NOT_ALLOWED' using errcode = '42501'; end if;
  select * into a from public.fin_acquirers where id = v_acq and clinic_id = s.clinic_id and is_active and (unit_id is null or unit_id = s.unit_id);
  if a.id is null then raise exception 'INVALID_ACQUIRER' using errcode = '22023'; end if;
  if a.kind = 'machine' and v_brand is null then raise exception 'BRAND_REQUIRED' using errcode = '22023'; end if;
  v_method := case a.kind when 'machine' then case when v_mod = 'debit' then 'debit' else 'credit' end else a.kind end;
  if a.kind <> 'machine' then v_mod := null; v_brand := null; end if;

  -- caixa aberto do operador nesta unidade; espécie e Recepção sem outro papel exigem caixa aberto.
  select * into v_reg from public.fin_cash_registers c where c.clinic_id = s.clinic_id and c.operator_profile_id = private.current_profile_id() and c.status = 'open' and c.unit_id = s.unit_id;
  v_staff := private.is_clinic_admin(s.clinic_id) or private.fin_has_role(s.clinic_id, array['gestor','financeiro'], s.unit_id);
  if v_reg.id is null and (a.kind = 'cash' or not v_staff) then raise exception 'CASH_REGISTER_REQUIRED' using errcode = '22023'; end if;

  insert into public.fin_payments (clinic_id, unit_id, sale_id, cash_register_id, acquirer_id, method, cash_key, cash_label, brand, modality, installments, amount_cents, paid_on, nsu, created_by)
    values (s.clinic_id, s.unit_id, s.id, v_reg.id, a.id, v_method, private.fin_cash_key(a.kind, a.id, v_brand),
            case when a.kind = 'machine' then a.name || ' · ' || v_brand else a.name end, v_brand, v_mod, v_n, v_amount, v_paid_on,
            nullif(btrim(coalesce(p_data->>'nsu', '')), ''), private.current_profile_id())
    returning * into p;

  select * into v_settings from public.fin_settings where clinic_id = s.clinic_id;
  for t in select * from private.fin_build_titles(a.id, v_brand, v_mod, v_n, v_amount, v_paid_on) loop
    insert into public.fin_receivables (clinic_id, unit_id, sale_id, payment_id, installment_no, installments, gross_cents, fee_cents, net_cents, expected_date)
      values (s.clinic_id, s.unit_id, s.id, p.id, t.installment_no, v_n, t.gross_cents, t.fee_cents, t.net_cents, t.expected_date) returning id into v_rec;
    if coalesce(v_settings.auto_settle, true) and t.expected_date <= v_today then
      perform private.fin_do_settle(v_rec, v_today, 'liquidação automática');
    end if;
  end loop;

  -- distribuição do recebimento entre os itens (proporcional ao líquido de desconto de cada item; resto no último)
  select array_agg(it.id order by it.position), array_agg(it.net_cents::bigint order by it.position) into v_item_ids, v_nets from public.fin_sale_items it where it.sale_id = s.id;
  v_alloc := private.fin_distribute(v_amount, v_nets);
  for i in 1..cardinality(v_item_ids) loop
    insert into public.fin_payment_allocations (payment_id, sale_item_id, amount_cents) values (p.id, v_item_ids[i], v_alloc[i]);
  end loop;

  perform private.fin_sale_recalc(s.id);
  perform private.fin_log(s.clinic_id, s.unit_id, 'payment', p.id, 'create', null,
    to_jsonb(p) || jsonb_build_object('titles', (select jsonb_agg(jsonb_build_object('n', r.installment_no, 'gross', r.gross_cents, 'fee', r.fee_cents, 'net', r.net_cents, 'expected', r.expected_date) order by r.installment_no)
                                                   from public.fin_receivables r where r.payment_id = p.id)), null);
  return p.id;
end $$;

create or replace function public.fin_settle_receivable(p_id uuid, p_settled_date date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.fin_receivables; v_date date := coalesce(p_settled_date, private.fin_today());
begin
  select * into r from public.fin_receivables where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(r.clinic_id, 'receivables', r.unit_id, true);
  if r.status <> 'expected' then raise exception 'NOT_EXPECTED' using errcode = '22023'; end if;
  if v_date > private.fin_today() then raise exception 'SETTLE_DATE_FUTURE' using errcode = '22023'; end if;
  perform private.fin_do_settle(r.id, v_date, 'liquidação manual');
end $$;

-- Gestor corrige data e/ou valor liquidado (com log e motivo).
create or replace function public.fin_correct_receivable(p_id uuid, p_settled_date date, p_settled_net_cents integer, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.fin_receivables; v_before jsonb;
begin
  select * into r from public.fin_receivables where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(r.clinic_id, 'receivables_fix', r.unit_id, true);
  if r.status <> 'settled' then raise exception 'NOT_SETTLED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if p_settled_date is null or p_settled_date > private.fin_today() or p_settled_net_cents is null or p_settled_net_cents < 0 or p_settled_net_cents > r.gross_cents then raise exception 'INVALID_CORRECTION' using errcode = '22023'; end if;
  v_before := to_jsonb(r);
  update public.fin_receivables set settled_date = p_settled_date, settled_net_cents = p_settled_net_cents, updated_at = now() where id = r.id returning * into r;
  perform private.fin_log(r.clinic_id, r.unit_id, 'receivable', r.id, 'update', v_before, to_jsonb(r), p_reason);
end $$;

-- Pagamento recusado / chargeback: título "estornado" + evento para a regra de estorno (E5).
create or replace function public.fin_reverse_receivable(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.fin_receivables; v_before jsonb; v_was text;
begin
  select * into r from public.fin_receivables where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(r.clinic_id, 'receivables', r.unit_id, true);
  if r.status = 'reversed' then raise exception 'ALREADY_REVERSED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_before := to_jsonb(r); v_was := r.status;
  update public.fin_receivables set status = 'reversed', reversed_at = now(), reverse_reason = btrim(p_reason), updated_at = now() where id = r.id returning * into r;
  insert into public.fin_events (clinic_id, unit_id, event_type, sale_id, payment_id, receivable_id, payload, created_by)
    values (r.clinic_id, r.unit_id, 'receivable_reversed', r.sale_id, r.payment_id, r.id,
            jsonb_build_object('reason', 'chargeback_or_refused', 'was_settled', v_was = 'settled', 'settled_date', r.settled_date, 'gross_cents', r.gross_cents, 'installment_no', r.installment_no), private.current_profile_id());
  perform private.fin_sale_recalc(r.sale_id);
  perform private.fin_log(r.clinic_id, r.unit_id, 'receivable', r.id, 'reverse', v_before, to_jsonb(r), p_reason);
end $$;

create or replace function public.fin_receivables_list(p_clinic uuid, p_unit uuid default null, p_status text default null, p_from date default null, p_to date default null,
                                                       p_limit integer default 300, p_offset integer default 0)
returns table (id uuid, sale_id uuid, payment_id uuid, unit_id uuid, patient_name text, acquirer_name text, method text, brand text, installment_no integer, installments integer,
               gross_cents integer, fee_cents integer, net_cents integer, expected_date date, settled_date date, settled_net_cents integer, status text, reverse_reason text, nsu text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'receivables', null, false);
  return query
    select r.id, r.sale_id, r.payment_id, r.unit_id, ppr.full_name, a.name, p.method, p.brand, r.installment_no, r.installments, r.gross_cents, r.fee_cents, r.net_cents,
           r.expected_date, r.settled_date, r.settled_net_cents, r.status, r.reverse_reason, p.nsu
      from public.fin_receivables r
      join public.fin_payments p on p.id = r.payment_id
      join public.fin_acquirers a on a.id = p.acquirer_id
      join public.fin_sales s on s.id = r.sale_id
      join public.patients pt on pt.id = s.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
     where r.clinic_id = p_clinic and (p_unit is null or r.unit_id = p_unit) and (p_status is null or r.status = p_status)
       and (p_from is null or r.expected_date >= p_from) and (p_to is null or r.expected_date <= p_to)
       and private.fin_can(p_clinic, 'receivables', r.unit_id, false)
     order by r.expected_date, r.id
     limit least(greatest(coalesce(p_limit, 300), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------- 7. RPCs: caixa diário ----------
create or replace function public.fin_open_cash(p_clinic uuid, p_unit uuid, p_opening_cents integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.fin_cash_registers; v_op uuid := private.current_profile_id();
begin
  perform private.fin_gate(p_clinic, 'cash', p_unit, true);
  if v_op is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic and u.is_active) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if p_opening_cents is null or p_opening_cents < 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  -- F20: não abre segundo caixa com outro aberto.
  if exists (select 1 from public.fin_cash_registers x where x.clinic_id = p_clinic and x.operator_profile_id = v_op and x.status = 'open') then
    raise exception 'CASH_ALREADY_OPEN' using errcode = '23505';
  end if;
  insert into public.fin_cash_registers (clinic_id, unit_id, operator_profile_id, business_date, opening_cash_cents)
    values (p_clinic, p_unit, v_op, private.fin_today(), p_opening_cents) returning * into c;
  perform private.fin_log(p_clinic, p_unit, 'cash_register', c.id, 'create', null, to_jsonb(c), 'abertura de caixa');
  return c.id;
end $$;

create or replace function public.fin_cash_movement(p_register uuid, p_type text, p_amount_cents integer, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.fin_cash_registers; m public.fin_cash_movements; v_cash integer;
begin
  select * into c from public.fin_cash_registers where id = p_register for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'cash', c.unit_id, true);
  if c.operator_profile_id <> private.current_profile_id() then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status <> 'open' then raise exception 'CASH_NOT_OPEN' using errcode = '22023'; end if;
  if p_type is null or p_type not in ('sangria','suprimento') then raise exception 'INVALID_TYPE' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_cash := (select (e->>'expected_cents')::integer from jsonb_array_elements(private.fin_cash_expected(c.id)) e where e->>'key' = 'cash');
  if p_type = 'sangria' and p_amount_cents > v_cash then raise exception 'CASH_INSUFFICIENT' using errcode = '22023'; end if;
  insert into public.fin_cash_movements (register_id, clinic_id, unit_id, type, amount_cents, reason, created_by)
    values (c.id, c.clinic_id, c.unit_id, p_type, p_amount_cents, btrim(p_reason), private.current_profile_id()) returning * into m;
  perform private.fin_log(c.clinic_id, c.unit_id, 'cash_movement', m.id, 'create', null, to_jsonb(m), p_reason);
  return m.id;
end $$;

-- Resumo do caixa (esperado por forma + movimentos). Operador vê o próprio; Gestor/Financeiro/Admin veem todos.
create or replace function public.fin_cash_summary(p_register uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.fin_cash_registers;
begin
  select * into c from public.fin_cash_registers where id = p_register;
  if c.id is null or not private.fin_cash_can_see(p_register) then raise exception 'forbidden' using errcode = '42501'; end if;
  return to_jsonb(c) || jsonb_build_object(
    'live_lines', case when c.status = 'open' then private.fin_cash_expected(c.id) else coalesce(c.expected_lines, '[]'::jsonb) end,
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.fin_cash_movements m where m.register_id = c.id), '[]'::jsonb),
    'unit_name', (select u.name from public.clinic_units u where u.id = c.unit_id),
    'operator_name', (select pr.full_name from public.profiles pr where pr.id = c.operator_profile_id));
end $$;

create or replace function public.fin_my_open_cash(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.fin_gate(p_clinic, 'cash', null, false);
  select c.id into v_id from public.fin_cash_registers c where c.clinic_id = p_clinic and c.operator_profile_id = private.current_profile_id() and c.status = 'open';
  if v_id is null then return null; end if;
  return public.fin_cash_summary(v_id);
end $$;

-- Fechamento: p_counted = {"cash": cents, "<chave>": cents...}. Forma não informada = igual ao esperado.
-- Diferença total (soma dos módulos) acima do limite da clínica → justificativa obrigatória e aprovação do gestor (F19).
create or replace function public.fin_close_cash(p_register uuid, p_counted jsonb, p_justification text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.fin_cash_registers; v_exp jsonb; e jsonb; v_lines jsonb := '[]'::jsonb; v_counted integer; v_diff integer; v_total_abs integer := 0; v_cash_diff integer := 0;
        v_cash_exp integer; v_cash_cnt integer; v_limit integer; v_status text; v_before jsonb; v_key text;
begin
  select * into c from public.fin_cash_registers where id = p_register for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'cash', c.unit_id, true);
  if c.operator_profile_id <> private.current_profile_id() then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status <> 'open' then raise exception 'CASH_NOT_OPEN' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_counted, 'null'::jsonb)) <> 'object' or nullif(p_counted->>'cash', '') is null then raise exception 'CASH_COUNT_REQUIRED' using errcode = '22023'; end if;
  v_before := to_jsonb(c);
  v_exp := private.fin_cash_expected(c.id);
  for e in select * from jsonb_array_elements(v_exp) loop
    v_key := e->>'key';
    v_counted := coalesce(nullif(p_counted->>v_key, '')::integer, (e->>'expected_cents')::integer);
    if v_counted < 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
    v_diff := v_counted - (e->>'expected_cents')::integer;
    v_total_abs := v_total_abs + abs(v_diff);
    if v_key = 'cash' then v_cash_diff := v_diff; v_cash_exp := (e->>'expected_cents')::integer; v_cash_cnt := v_counted; end if;
    v_lines := v_lines || jsonb_build_object('key', v_key, 'label', e->>'label', 'expected_cents', (e->>'expected_cents')::integer, 'counted_cents', v_counted, 'difference_cents', v_diff);
  end loop;
  select coalesce(cash_diff_limit_cents, 0) into v_limit from public.fin_settings where clinic_id = c.clinic_id;
  v_limit := coalesce(v_limit, 0);
  if v_total_abs > v_limit then
    if char_length(btrim(coalesce(p_justification, ''))) < 3 then raise exception 'JUSTIFICATION_REQUIRED' using errcode = '22023'; end if;
    v_status := 'pending_approval';
  else v_status := 'closed'; end if;
  update public.fin_cash_registers set status = v_status, closed_at = now(), expected_lines = v_lines, counted_cash_cents = v_cash_cnt, expected_cash_cents = v_cash_exp,
         difference_cents = v_total_abs, cash_difference_cents = v_cash_diff, justification = nullif(btrim(coalesce(p_justification, '')), '') where id = c.id returning * into c;
  perform private.fin_log(c.clinic_id, c.unit_id, 'cash_register', c.id, 'update', v_before, to_jsonb(c), coalesce(p_justification, 'fechamento de caixa'));
  return v_status;
end $$;

create or replace function public.fin_approve_cash(p_register uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.fin_cash_registers; v_before jsonb;
begin
  select * into c from public.fin_cash_registers where id = p_register for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'cash_approve', c.unit_id, true);
  if c.status <> 'pending_approval' then raise exception 'NOT_PENDING' using errcode = '22023'; end if;
  if c.operator_profile_id = private.current_profile_id() and not private.is_clinic_admin(c.clinic_id) then raise exception 'SELF_APPROVAL_NOT_ALLOWED' using errcode = '42501'; end if;
  v_before := to_jsonb(c);
  update public.fin_cash_registers set status = 'closed', approved_by = private.current_profile_id(), approved_at = now() where id = c.id returning * into c;
  perform private.fin_log(c.clinic_id, c.unit_id, 'cash_register', c.id, 'update', v_before, to_jsonb(c), coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'aprovação do fechamento'));
end $$;

-- Relatório: caixas por dia, operador e unidade. Operador comum vê só os próprios.
create or replace function public.fin_cash_report(p_clinic uuid, p_from date default null, p_to date default null, p_unit uuid default null, p_operator uuid default null)
returns table (id uuid, business_date date, unit_id uuid, unit_name text, operator_profile_id uuid, operator_name text, status text, opened_at timestamptz, closed_at timestamptz,
               opening_cash_cents integer, expected_cash_cents integer, counted_cash_cents integer, cash_difference_cents integer, difference_cents integer,
               justification text, approved_by_name text, stale boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.business_date, c.unit_id, u.name, c.operator_profile_id, opr.full_name, c.status, c.opened_at, c.closed_at, c.opening_cash_cents, c.expected_cash_cents,
           c.counted_cash_cents, c.cash_difference_cents, c.difference_cents, c.justification, apr.full_name,
           (c.status = 'open' and c.business_date < private.fin_today())          -- caixa de dia anterior não fechado = pendência
      from public.fin_cash_registers c
      join public.clinic_units u on u.id = c.unit_id
      left join public.profiles opr on opr.id = c.operator_profile_id
      left join public.profiles apr on apr.id = c.approved_by
     where c.clinic_id = p_clinic and (p_from is null or c.business_date >= p_from) and (p_to is null or c.business_date <= p_to)
       and (p_unit is null or c.unit_id = p_unit) and (p_operator is null or c.operator_profile_id = p_operator)
       and (c.operator_profile_id = private.current_profile_id() or private.fin_can(p_clinic, 'cash_all', c.unit_id, false))
     order by c.business_date desc, c.opened_at desc;
end $$;

-- ---------- 8. Permissões de execução ----------
revoke all on function private.fin_today(), private.fin_distribute(bigint, bigint[]), private.fin_cash_key(text, uuid, text),
  private.fin_build_titles(uuid, text, text, integer, integer, date), private.fin_sale_recalc(uuid), private.fin_cash_expected(uuid),
  private.fin_do_settle(uuid, date, text), private.fin_auto_settle_all() from public, anon, authenticated;
revoke all on function private.fin_sale_visible(uuid), private.fin_cash_can_see(uuid) from public, anon;

revoke all on function public.fin_sale_catalog(uuid, uuid), public.fin_payment_options(uuid, uuid), public.fin_sale_patients(uuid, text, integer), public.fin_accept_compliance(uuid, uuid, text), public.fin_compliance_status(uuid, uuid),
  public.fin_save_sale(uuid, uuid, uuid, jsonb, integer, numeric, uuid, uuid, text), public.fin_sales_list(uuid, uuid, text, date, date, integer, integer),
  public.fin_sale_get(uuid), public.fin_cancel_sale(uuid, text), public.fin_add_payment(uuid, jsonb), public.fin_settle_receivable(uuid, date),
  public.fin_correct_receivable(uuid, date, integer, text), public.fin_reverse_receivable(uuid, text),
  public.fin_receivables_list(uuid, uuid, text, date, date, integer, integer), public.fin_open_cash(uuid, uuid, integer),
  public.fin_cash_movement(uuid, text, integer, text), public.fin_cash_summary(uuid), public.fin_my_open_cash(uuid),
  public.fin_close_cash(uuid, jsonb, text), public.fin_approve_cash(uuid, text), public.fin_cash_report(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.fin_sale_catalog(uuid, uuid), public.fin_payment_options(uuid, uuid), public.fin_sale_patients(uuid, text, integer), public.fin_accept_compliance(uuid, uuid, text), public.fin_compliance_status(uuid, uuid),
  public.fin_save_sale(uuid, uuid, uuid, jsonb, integer, numeric, uuid, uuid, text), public.fin_sales_list(uuid, uuid, text, date, date, integer, integer),
  public.fin_sale_get(uuid), public.fin_cancel_sale(uuid, text), public.fin_add_payment(uuid, jsonb), public.fin_settle_receivable(uuid, date),
  public.fin_correct_receivable(uuid, date, integer, text), public.fin_reverse_receivable(uuid, text),
  public.fin_receivables_list(uuid, uuid, text, date, date, integer, integer), public.fin_open_cash(uuid, uuid, integer),
  public.fin_cash_movement(uuid, text, integer, text), public.fin_cash_summary(uuid), public.fin_my_open_cash(uuid),
  public.fin_close_cash(uuid, jsonb, text), public.fin_approve_cash(uuid, text), public.fin_cash_report(uuid, date, date, uuid, uuid) to authenticated;

-- ---------- 9. Rotina diária de liquidação automática (pg_cron) ----------
-- 00:10 em Brasília (03:10 UTC). Só agenda se a extensão existir; idempotente (reagenda pelo mesmo nome).
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fin-e2-auto-settle';
    perform cron.schedule('fin-e2-auto-settle', '10 3 * * *', $job$select private.fin_auto_settle_all();$job$);
  end if;
end $cron$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261113180000','20261113180000_fin_e2_vendas.sql','FIN-E2: vendas, recebimentos, títulos, distribuição por item, caixa diário (abertura, sangria, suprimento, fechamento, aprovação), aceites de conformidade e eventos para o repasse (aditiva).','FIN-E2');
