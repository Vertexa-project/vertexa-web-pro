-- =====================================================================================
-- FIN-E1 — Financeiro / Repasse / Estoque · Entrega 1 (base e cadastros). 100% ADITIVA:
-- só CRIA objetos novos (tabelas clinic_units, clinic_staff_roles, fin_*, stock_*; funções private.fin_* e
-- public.fin_*; 1 trigger novo em clinics). Nada existente é alterado ou removido.
--
-- Modelo de acesso (escopo-v1 §3): Owner/Admin = private.is_clinic_admin (tudo). Papéis ADICIONAIS por
-- membro em clinic_staff_roles (gestor | financeiro | recepcao | estoquista), com todas as unidades ou lista.
-- TODA RPC nova passa por private.fin_can(clinic, area, unit, write). Escrita só por RPC security definer
-- (search_path vazio); as tabelas não têm INSERT/UPDATE/DELETE para anon/authenticated.
-- Sem exclusão física dos cadastros: desativa-se (is_active) e a mudança vai para fin_audit_log na MESMA transação.
-- Dados bancários/fiscais do profissional: sem SELECT direto; leitura só pela RPC, que grava view_sensitive.
-- =====================================================================================

-- ---------- 1. Tabelas ----------
create table if not exists public.clinic_units (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  is_primary boolean not null default false,
  license_number text check (license_number is null or char_length(license_number) <= 60),
  license_valid_until date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (is_primary and not is_active))
);
create unique index if not exists clinic_units_one_primary_uq on public.clinic_units (clinic_id) where is_primary;
create unique index if not exists clinic_units_name_uq on public.clinic_units (clinic_id, lower(btrim(name)));

create table if not exists public.clinic_staff_roles (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  role text not null check (role in ('gestor','financeiro','recepcao','estoquista')),
  all_units boolean not null default true,
  unit_ids uuid[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professional_id, role),
  check (all_units or cardinality(unit_ids) > 0)
);
create index if not exists clinic_staff_roles_clinic_idx on public.clinic_staff_roles (clinic_id);

create table if not exists public.fin_audit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  unit_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null check (action in ('create','update','deactivate','reverse','view_sensitive')),
  before jsonb,
  after jsonb,
  reason text,
  user_profile_id uuid,
  at timestamptz not null default now()
);
create index if not exists fin_audit_log_clinic_at_idx on public.fin_audit_log (clinic_id, at desc);
create index if not exists fin_audit_log_entity_idx on public.fin_audit_log (clinic_id, entity, at desc);

create table if not exists public.fin_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  auto_settle boolean not null default true,
  deduct_fee boolean not null default true,
  deduct_tax boolean not null default false,
  deduct_material boolean not null default false,
  cash_diff_limit_cents integer not null default 0 check (cash_diff_limit_cents between 0 and 100000000),
  accept_days integer not null default 5 check (accept_days between 1 and 60),
  patient_display text not null default 'initials' check (patient_display in ('initials','full','hidden')),
  tier_base text not null default 'organization' check (tier_base in ('organization','unit')),
  updated_at timestamptz not null default now()
);

-- Itens de estoque (8.1)
create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  manufacturer text check (manufacturer is null or char_length(manufacturer) <= 120),
  item_type text not null check (item_type in ('medication','compounded','resale','consumable')),
  purchase_unit text not null check (char_length(btrim(purchase_unit)) between 1 and 30),
  stock_unit text not null check (char_length(btrim(stock_unit)) between 1 and 30),
  consumption_unit text not null check (char_length(btrim(consumption_unit)) between 1 and 30),
  purchase_to_stock_factor numeric(14,4) not null default 1 check (purchase_to_stock_factor > 0),
  stock_to_consumption_factor numeric(14,4) not null default 1 check (stock_to_consumption_factor > 0),
  fractional boolean not null default false,
  opened_validity_days integer check (opened_validity_days is null or opened_validity_days between 1 and 3650),
  individual_use boolean not null default false,
  lot_control boolean not null default false,
  sellable boolean not null default false,
  ean text check (ean is null or ean ~ '^[0-9]{8,14}$'),
  anvisa_reg text check (anvisa_reg is null or char_length(anvisa_reg) <= 40),
  sale_price_cents integer check (sale_price_cents is null or sale_price_cents between 0 and 100000000),
  controlled boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- defesa em profundidade (a RPC valida antes e devolve a mensagem certa):
  constraint stock_items_not_controlled check (controlled = false),
  constraint stock_items_lot_required check (item_type not in ('medication','compounded') or lot_control),
  constraint stock_items_medication_not_sellable check (item_type <> 'medication' or not sellable),
  constraint stock_items_consumable_not_sellable check (item_type <> 'consumable' or not sellable),
  constraint stock_items_fractional_validity check (not fractional or opened_validity_days is not null)
);
create unique index if not exists stock_items_name_uq on public.stock_items (clinic_id, lower(btrim(name)), lower(coalesce(manufacturer, '')));
create index if not exists stock_items_clinic_idx on public.stock_items (clinic_id, is_active);

create table if not exists public.stock_item_minimums (
  item_id uuid not null references public.stock_items(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete cascade,
  min_qty numeric(14,3) not null check (min_qty >= 0),
  primary key (item_id, unit_id)
);

-- Serviços (4.1)
create table if not exists public.fin_services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null check (category in ('consulta','procedimento','aplicacao','avaliacao','sessao','outro')),
  default_price_cents integer not null check (default_price_cents between 0 and 100000000),
  roles text[] not null default '{responsavel}',
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ('responsavel' = any (roles) and roles <@ array['responsavel','executor','auxiliar']::text[])
);
create unique index if not exists fin_services_name_uq on public.fin_services (clinic_id, lower(btrim(name)));

create table if not exists public.fin_service_unit_prices (
  service_id uuid not null references public.fin_services(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id) on delete cascade,
  price_cents integer not null check (price_cents between 0 and 100000000),
  primary key (service_id, unit_id)
);

create table if not exists public.fin_service_kit_items (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.fin_services(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unique (service_id, item_id)
);

-- Pacotes / programas (4.1 e 5.4)
create table if not exists public.fin_packages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  price_cents integer not null check (price_cents between 1 and 100000000),
  validity_days integer not null check (validity_days between 1 and 3650),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fin_packages_name_uq on public.fin_packages (clinic_id, lower(btrim(name)));

create table if not exists public.fin_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.fin_packages(id) on delete cascade,
  position integer not null,
  item_type text not null check (item_type in ('service','product')),
  service_id uuid references public.fin_services(id) on delete restrict,
  stock_item_id uuid references public.stock_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  reference_price_cents integer not null check (reference_price_cents between 0 and 100000000),
  allocated_unit_cents integer not null default 0,
  allocated_total_cents integer not null default 0,
  check ((item_type = 'service' and service_id is not null and stock_item_id is null)
      or (item_type = 'product' and stock_item_id is not null and service_id is null))
);
create index if not exists fin_package_items_pkg_idx on public.fin_package_items (package_id, position);

-- Dados financeiros do profissional (4.1) e retenções (5.8) — SEM select direto (LGPD)
create table if not exists public.fin_professional_finance (
  professional_id uuid primary key references public.professionals(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  bond_type text not null check (bond_type in ('pj','autonomo','clt','socio')),
  tax_id text check (tax_id is null or tax_id ~ '^([0-9]{11}|[0-9]{14})$'),
  simples_optant boolean not null default false,
  pix_key text check (pix_key is null or char_length(pix_key) <= 140),
  bank_name text check (bank_name is null or char_length(bank_name) <= 80),
  bank_agency text check (bank_agency is null or char_length(bank_agency) <= 20),
  bank_account text check (bank_account is null or char_length(bank_account) <= 30),
  requires_invoice boolean not null default false,
  all_units boolean not null default true,
  unit_ids uuid[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (all_units or cardinality(unit_ids) > 0)
);
create index if not exists fin_professional_finance_clinic_idx on public.fin_professional_finance (clinic_id);

create table if not exists public.fin_withholding_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  rule_type text not null check (rule_type in ('irrf','pis_cofins_csll','iss','outra')),
  label text check (label is null or char_length(label) <= 60),
  rate_pct numeric(7,4) not null check (rate_pct >= 0 and rate_pct <= 100),
  min_base_cents integer not null default 0 check (min_base_cents between 0 and 100000000),
  waive_if_simples boolean not null default true,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists fin_withholding_rules_pro_idx on public.fin_withholding_rules (professional_id);

-- Meios de pagamento e taxas (4.1)
create table if not exists public.fin_acquirers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid references public.clinic_units(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('machine','pix','cash','transfer','boleto')),
  flat_fee_pct numeric(6,4) not null default 0 check (flat_fee_pct between 0 and 100),
  flat_fee_cents integer not null default 0 check (flat_fee_cents between 0 and 10000000),
  settle_days integer not null default 0 check (settle_days between 0 and 400),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fin_acquirers_name_uq on public.fin_acquirers (clinic_id, lower(btrim(name)));

create table if not exists public.fin_fee_rows (
  id uuid primary key default gen_random_uuid(),
  acquirer_id uuid not null references public.fin_acquirers(id) on delete cascade,
  brand text not null check (char_length(btrim(brand)) between 1 and 40),
  modality text not null check (modality in ('debit','credit_1','credit_2_6','credit_7_12')),
  fee_pct numeric(6,4) not null check (fee_pct between 0 and 100),
  settle_days integer not null default 0 check (settle_days between 0 and 400),
  anticipation boolean not null default false,
  anticipation_fee_pct numeric(6,4) not null default 0 check (anticipation_fee_pct between 0 and 100),
  anticipation_days integer not null default 1 check (anticipation_days between 0 and 400)
);
create unique index if not exists fin_fee_rows_uq on public.fin_fee_rows (acquirer_id, lower(btrim(brand)), modality);

-- Alíquota mensal (4.1, F21)
create table if not exists public.fin_tax_rates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid references public.clinic_units(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  rate_pct numeric(6,4) not null check (rate_pct between 0 and 100),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fin_tax_rates_uq on public.fin_tax_rates (clinic_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), period);

-- ---------- 2. Helpers de acesso ----------
create or replace function private.fin_area_roles(p_area text, p_write boolean) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_area = 'units'       then case when p_write then '{}'::text[] else array['gestor','financeiro','estoquista','recepcao'] end
    when p_area = 'staff'       then '{}'::text[]
    when p_area in ('services','packages','payment','tax','pro_finance') then array['gestor','financeiro']
    when p_area = 'settings'    then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'audit'       then case when p_write then '{}'::text[] else array['gestor'] end
    when p_area = 'stock_items' then case when p_write then array['gestor','estoquista'] else array['gestor','estoquista','financeiro'] end
    else '{}'::text[]
  end
$$;

create or replace function private.fin_has_role(p_clinic uuid, p_roles text[], p_unit uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.clinic_staff_roles r
      join public.professionals pr on pr.id = r.professional_id
     where r.clinic_id = p_clinic and pr.clinic_id = p_clinic
       and pr.profile_id = private.current_profile_id()
       and coalesce(pr.status, 'active') = 'active'
       and r.role = any (p_roles)
       and (p_unit is null or r.all_units or p_unit = any (r.unit_ids))
  )
$$;

-- Matriz da seção 3 (escopo-v1). Admin/Owner: tudo. Demais: papel adicional na lista da área (e unidade, quando informada).
create or replace function private.fin_can(p_clinic uuid, p_area text, p_unit uuid default null, p_write boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_clinic is not null
     and private.is_clinic_member(p_clinic)
     and (private.is_clinic_admin(p_clinic)
          or private.fin_has_role(p_clinic, private.fin_area_roles(p_area, p_write), p_unit))
$$;

create or replace function private.fin_gate(p_clinic uuid, p_area text, p_unit uuid default null, p_write boolean default false) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.fin_can(p_clinic, p_area, p_unit, p_write) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function private.fin_is_self_professional(p_professional uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.professionals pr
                  where pr.id = p_professional and pr.profile_id = private.current_profile_id())
$$;

create or replace function private.fin_log(p_clinic uuid, p_unit uuid, p_entity text, p_entity_id uuid, p_action text, p_before jsonb, p_after jsonb, p_reason text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.fin_audit_log (clinic_id, unit_id, entity, entity_id, action, before, after, reason, user_profile_id)
  values (p_clinic, p_unit, p_entity, p_entity_id, p_action, p_before, p_after, nullif(btrim(coalesce(p_reason, '')), ''), private.current_profile_id())
$$;

-- Ação de log a partir da mudança de is_active; motivo obrigatório ao desativar.
create or replace function private.fin_action(p_existing boolean, p_was_active boolean, p_is_active boolean, p_reason text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if not p_existing then return 'create'; end if;
  if p_was_active and not p_is_active then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
    return 'deactivate';
  end if;
  return 'update';
end $$;

create or replace function private.fin_valid_tax_id(p_digits text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s int; d int; i int; n int;
begin
  if p_digits is null or p_digits !~ '^[0-9]+$' then return false; end if;
  n := char_length(p_digits);
  if n not in (11, 14) or p_digits ~ '^(.)\1+$' then return false; end if;
  if n = 11 then
    for d in 1..2 loop
      s := 0;
      for i in 1..(8 + d) loop s := s + substr(p_digits, i, 1)::int * (10 + d - i); end loop;
      if ((s * 10) % 11) % 10 <> substr(p_digits, 9 + d, 1)::int then return false; end if;
    end loop;
  else
    for d in 1..2 loop
      s := 0;
      for i in 1..(11 + d) loop
        s := s + substr(p_digits, i, 1)::int * (case when ((11 + d - i) % 8) + 2 > 9 then ((11 + d - i) % 8) + 2 else ((11 + d - i) % 8) + 2 end);
      end loop;
      if (case when s % 11 < 2 then 0 else 11 - s % 11 end) <> substr(p_digits, 12 + d, 1)::int then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create or replace function private.fin_mask_sensitive(p_row jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_row is null then null else
    p_row
      || case when p_row ? 'tax_id' and p_row->>'tax_id' is not null then jsonb_build_object('tax_id', '•••' || right(p_row->>'tax_id', 2)) else '{}'::jsonb end
      || case when p_row ? 'pix_key' and p_row->>'pix_key' is not null then jsonb_build_object('pix_key', '(informado)') else '{}'::jsonb end
      || case when p_row ? 'bank_account' and p_row->>'bank_account' is not null then jsonb_build_object('bank_account', '(informado)') else '{}'::jsonb end
      || case when p_row ? 'bank_agency' and p_row->>'bank_agency' is not null then jsonb_build_object('bank_agency', '(informado)') else '{}'::jsonb end
  end
$$;

-- ---------- 3. Dados iniciais por clínica (backfill + trigger novo) ----------
create or replace function private.fin_seed_clinic(p_clinic uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.clinic_units (clinic_id, name, is_primary)
    select p_clinic, 'Unidade principal', true
     where not exists (select 1 from public.clinic_units u where u.clinic_id = p_clinic and u.is_primary);
  insert into public.fin_settings (clinic_id) values (p_clinic) on conflict (clinic_id) do nothing;
  insert into public.fin_acquirers (clinic_id, name, kind, flat_fee_pct, flat_fee_cents, settle_days)
    select p_clinic, v.name, v.kind, 0, 0, 0
      from (values ('Pix','pix'),('Dinheiro','cash'),('Transferência','transfer'),('Boleto','boleto')) as v(name, kind)
     where not exists (select 1 from public.fin_acquirers a where a.clinic_id = p_clinic and a.kind = v.kind);
end $$;
revoke all on function private.fin_seed_clinic(uuid) from public, anon, authenticated;

create or replace function private.fin_on_clinic_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fin_seed_clinic(new.id);
  return new;
end $$;
revoke all on function private.fin_on_clinic_insert() from public, anon, authenticated;

drop trigger if exists trg_fin_seed_clinic on public.clinics;
create trigger trg_fin_seed_clinic after insert on public.clinics
  for each row execute function private.fin_on_clinic_insert();

select private.fin_seed_clinic(c.id) from public.clinics c;

-- ---------- 4. RLS e grants (leitura; escrita só por RPC) ----------
alter table public.clinic_units enable row level security;
alter table public.clinic_staff_roles enable row level security;
alter table public.fin_audit_log enable row level security;
alter table public.fin_settings enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_item_minimums enable row level security;
alter table public.fin_services enable row level security;
alter table public.fin_service_unit_prices enable row level security;
alter table public.fin_service_kit_items enable row level security;
alter table public.fin_packages enable row level security;
alter table public.fin_package_items enable row level security;
alter table public.fin_professional_finance enable row level security;
alter table public.fin_withholding_rules enable row level security;
alter table public.fin_acquirers enable row level security;
alter table public.fin_fee_rows enable row level security;
alter table public.fin_tax_rates enable row level security;

revoke all on public.clinic_units, public.clinic_staff_roles, public.fin_audit_log, public.fin_settings, public.stock_items,
  public.stock_item_minimums, public.fin_services, public.fin_service_unit_prices, public.fin_service_kit_items,
  public.fin_packages, public.fin_package_items, public.fin_professional_finance, public.fin_withholding_rules,
  public.fin_acquirers, public.fin_fee_rows, public.fin_tax_rates from anon, authenticated;
grant select on public.clinic_units, public.clinic_staff_roles, public.fin_settings, public.stock_items,
  public.stock_item_minimums, public.fin_services, public.fin_service_unit_prices, public.fin_service_kit_items,
  public.fin_packages, public.fin_package_items, public.fin_acquirers, public.fin_fee_rows, public.fin_tax_rates to authenticated;
-- fin_audit_log: leitura só pela RPC fin_audit_list; fin_professional_finance e fin_withholding_rules: só por RPC.

grant execute on function private.fin_can(uuid, text, uuid, boolean) to authenticated;
grant execute on function private.fin_is_self_professional(uuid) to authenticated;

create policy clinic_units_select on public.clinic_units for select to authenticated
  using (private.fin_can(clinic_id, 'units', id, false));
create policy clinic_staff_roles_select on public.clinic_staff_roles for select to authenticated
  using (private.fin_can(clinic_id, 'staff', null, false) or private.fin_is_self_professional(professional_id));
create policy fin_settings_select on public.fin_settings for select to authenticated
  using (private.fin_can(clinic_id, 'settings', null, false));
create policy stock_items_select on public.stock_items for select to authenticated
  using (private.fin_can(clinic_id, 'stock_items', null, false));
create policy stock_item_minimums_select on public.stock_item_minimums for select to authenticated
  using (exists (select 1 from public.stock_items i where i.id = item_id and private.fin_can(i.clinic_id, 'stock_items', unit_id, false)));
create policy fin_services_select on public.fin_services for select to authenticated
  using (private.fin_can(clinic_id, 'services', null, false));
create policy fin_service_unit_prices_select on public.fin_service_unit_prices for select to authenticated
  using (exists (select 1 from public.fin_services s where s.id = service_id and private.fin_can(s.clinic_id, 'services', unit_id, false)));
create policy fin_service_kit_items_select on public.fin_service_kit_items for select to authenticated
  using (exists (select 1 from public.fin_services s where s.id = service_id and private.fin_can(s.clinic_id, 'services', null, false)));
create policy fin_packages_select on public.fin_packages for select to authenticated
  using (private.fin_can(clinic_id, 'packages', null, false));
create policy fin_package_items_select on public.fin_package_items for select to authenticated
  using (exists (select 1 from public.fin_packages p where p.id = package_id and private.fin_can(p.clinic_id, 'packages', null, false)));
create policy fin_acquirers_select on public.fin_acquirers for select to authenticated
  using (private.fin_can(clinic_id, 'payment', unit_id, false));
create policy fin_fee_rows_select on public.fin_fee_rows for select to authenticated
  using (exists (select 1 from public.fin_acquirers a where a.id = acquirer_id and private.fin_can(a.clinic_id, 'payment', a.unit_id, false)));
create policy fin_tax_rates_select on public.fin_tax_rates for select to authenticated
  using (private.fin_can(clinic_id, 'tax', unit_id, false));

-- ---------- 5. RPCs ----------
-- 5.1 Acesso do chamador (UI: menu e botões; a autoridade real continua nas RPCs/RLS)
create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items'];
        a text; v_can jsonb := '{}'::jsonb; v_roles jsonb;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then
    return jsonb_build_object('is_admin', false, 'roles', '[]'::jsonb, 'can', '{}'::jsonb);
  end if;
  foreach a in array v_areas loop
    v_can := v_can || jsonb_build_object(a || '_read', private.fin_can(p_clinic, a, null, false), a || '_write', private.fin_can(p_clinic, a, null, true));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids))), '[]'::jsonb)
    into v_roles
    from public.clinic_staff_roles r
    join public.professionals pr on pr.id = r.professional_id
   where r.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  return jsonb_build_object('is_admin', private.is_clinic_admin(p_clinic), 'roles', v_roles, 'can', v_can);
end $$;

-- 5.2 Unidades
create or replace function public.fin_save_unit(p_clinic uuid, p_id uuid, p_data jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u public.clinic_units; v_before jsonb; v_name text := btrim(coalesce(p_data->>'name', ''));
        v_active boolean := coalesce((p_data->>'is_active')::boolean, true); v_action text; v_id uuid;
begin
  perform private.fin_gate(p_clinic, 'units', null, true);
  if v_name = '' then raise exception 'NAME_REQUIRED' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.clinic_units (clinic_id, name, is_active, is_primary, license_number, license_valid_until, created_by)
      values (p_clinic, v_name, true, false, nullif(btrim(coalesce(p_data->>'license_number','')), ''), nullif(p_data->>'license_valid_until','')::date, private.current_profile_id())
      returning * into u;
    perform private.fin_log(p_clinic, u.id, 'unit', u.id, 'create', null, to_jsonb(u), p_reason);
    return u.id;
  end if;
  select * into u from public.clinic_units where id = p_id and clinic_id = p_clinic for update;
  if u.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if u.is_primary and not v_active then raise exception 'PRIMARY_UNIT_CANNOT_BE_DEACTIVATED' using errcode = '22023'; end if;
  v_before := to_jsonb(u);
  v_action := private.fin_action(true, u.is_active, v_active, p_reason);
  update public.clinic_units
     set name = v_name, is_active = v_active,
         license_number = nullif(btrim(coalesce(p_data->>'license_number','')), ''),
         license_valid_until = nullif(p_data->>'license_valid_until','')::date, updated_at = now()
   where id = u.id returning * into u;
  perform private.fin_log(p_clinic, u.id, 'unit', u.id, v_action, v_before, to_jsonb(u), p_reason);
  return u.id;
end $$;

-- 5.3 Papéis adicionais por membro
create or replace function public.fin_set_staff_roles(p_clinic uuid, p_professional uuid, p_roles jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_before jsonb; v_after jsonb; v_all boolean; v_units uuid[]; v_role text;
begin
  perform private.fin_gate(p_clinic, 'staff', null, true);
  if jsonb_typeof(coalesce(p_roles, 'null'::jsonb)) <> 'array' then raise exception 'INVALID_ROLES' using errcode = '22023'; end if;
  if not exists (select 1 from public.professionals pr where pr.id = p_professional and pr.clinic_id = p_clinic and coalesce(pr.status,'active') = 'active') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'all_units', all_units, 'unit_ids', to_jsonb(unit_ids)) order by role), '[]'::jsonb)
    into v_before from public.clinic_staff_roles where professional_id = p_professional;
  delete from public.clinic_staff_roles where professional_id = p_professional;
  for r in select * from jsonb_array_elements(p_roles) loop
    v_role := r->>'role';
    if v_role is null or v_role not in ('gestor','financeiro','recepcao','estoquista') then raise exception 'INVALID_ROLE' using errcode = '22023'; end if;
    v_all := coalesce((r->>'all_units')::boolean, true);
    select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(r->'unit_ids', '[]'::jsonb)) x;
    if not v_all and (cardinality(v_units) = 0
        or exists (select 1 from unnest(v_units) uid where not exists (select 1 from public.clinic_units cu where cu.id = uid and cu.clinic_id = p_clinic and cu.is_active))) then
      raise exception 'INVALID_UNITS' using errcode = '22023';
    end if;
    insert into public.clinic_staff_roles (clinic_id, professional_id, role, all_units, unit_ids, created_by)
      values (p_clinic, p_professional, v_role, v_all, case when v_all then '{}' else v_units end, private.current_profile_id())
      on conflict (professional_id, role) do update set all_units = excluded.all_units, unit_ids = excluded.unit_ids, updated_at = now();
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'all_units', all_units, 'unit_ids', to_jsonb(unit_ids)) order by role), '[]'::jsonb)
    into v_after from public.clinic_staff_roles where professional_id = p_professional;
  if v_before is distinct from v_after then
    perform private.fin_log(p_clinic, null, 'staff_roles', p_professional, 'update', jsonb_build_object('roles', v_before), jsonb_build_object('roles', v_after), p_reason);
  end if;
end $$;

-- 5.4 Histórico (leitura do log)
create or replace function public.fin_audit_list(p_clinic uuid, p_entity text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 100, p_offset integer default 0)
returns table (id uuid, entity text, entity_id uuid, action text, before jsonb, after jsonb, reason text, user_name text, at timestamptz, unit_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'audit', null, false);
  return query
    select l.id, l.entity, l.entity_id, l.action, l.before, l.after, l.reason, pr.full_name, l.at, l.unit_id
      from public.fin_audit_log l
      left join public.profiles pr on pr.id = l.user_profile_id
     where l.clinic_id = p_clinic
       and (p_entity is null or l.entity = p_entity)
       and (p_from is null or l.at >= p_from) and (p_to is null or l.at < p_to)
       and private.fin_can(p_clinic, 'audit', l.unit_id, false)
     order by l.at desc, l.id
     limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- 5.5 Configurações financeiras da clínica
create or replace function public.fin_save_settings(p_clinic uuid, p_data jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.fin_settings; v_before jsonb;
begin
  perform private.fin_gate(p_clinic, 'settings', null, true);
  perform private.fin_seed_clinic(p_clinic);
  select * into s from public.fin_settings where clinic_id = p_clinic for update;
  v_before := to_jsonb(s);
  update public.fin_settings set
    auto_settle = coalesce((p_data->>'auto_settle')::boolean, auto_settle),
    deduct_fee = coalesce((p_data->>'deduct_fee')::boolean, deduct_fee),
    deduct_tax = coalesce((p_data->>'deduct_tax')::boolean, deduct_tax),
    deduct_material = coalesce((p_data->>'deduct_material')::boolean, deduct_material),
    cash_diff_limit_cents = coalesce((p_data->>'cash_diff_limit_cents')::integer, cash_diff_limit_cents),
    accept_days = coalesce((p_data->>'accept_days')::integer, accept_days),
    patient_display = coalesce(p_data->>'patient_display', patient_display),
    tier_base = coalesce(p_data->>'tier_base', tier_base),
    updated_at = now()
   where clinic_id = p_clinic returning * into s;
  if v_before is distinct from to_jsonb(s) then
    perform private.fin_log(p_clinic, null, 'settings', p_clinic, 'update', v_before, to_jsonb(s), p_reason);
  end if;
end $$;

-- 5.6 Alíquota mensal
create or replace function public.fin_set_tax_rate(p_clinic uuid, p_period text, p_rate_pct numeric, p_unit uuid default null, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.fin_tax_rates; v_before jsonb; v_existing boolean;
begin
  perform private.fin_gate(p_clinic, 'tax', p_unit, true);
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  if p_rate_pct is null or p_rate_pct < 0 or p_rate_pct > 100 then raise exception 'INVALID_RATE' using errcode = '22023'; end if;
  if p_unit is not null and not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into t from public.fin_tax_rates
   where clinic_id = p_clinic and period = p_period and coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_unit, '00000000-0000-0000-0000-000000000000'::uuid) for update;
  v_existing := t.id is not null;
  v_before := case when v_existing then to_jsonb(t) end;
  if v_existing then
    update public.fin_tax_rates set rate_pct = p_rate_pct, updated_at = now() where id = t.id returning * into t;
  else
    insert into public.fin_tax_rates (clinic_id, unit_id, period, rate_pct, created_by) values (p_clinic, p_unit, p_period, p_rate_pct, private.current_profile_id()) returning * into t;
  end if;
  if not v_existing or v_before is distinct from to_jsonb(t) then
    perform private.fin_log(p_clinic, p_unit, 'tax_rate', t.id, case when v_existing then 'update' else 'create' end, v_before, to_jsonb(t), p_reason);
  end if;
  return t.id;
end $$;

-- Alíquota efetiva do mês: a do próprio mês, ou a mais recente anterior (herdada). F21.
create or replace function public.fin_effective_tax_rate(p_clinic uuid, p_period text, p_unit uuid default null)
returns table (rate_pct numeric, inherited boolean, source_period text, has_rate boolean)
language plpgsql stable security definer set search_path = '' as $$
declare t public.fin_tax_rates;
begin
  perform private.fin_gate(p_clinic, 'tax', p_unit, false);
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  select * into t from public.fin_tax_rates r
   where r.clinic_id = p_clinic and r.period <= p_period and (r.unit_id is null or r.unit_id = p_unit)
   order by r.period desc, (r.unit_id is null) asc limit 1;
  if t.id is null then
    return query select null::numeric, false, null::text, false;
  else
    return query select t.rate_pct, (t.period <> p_period), t.period, true;
  end if;
end $$;

-- 5.7 Itens de estoque (8.1) — regras validadas no servidor
create or replace function public.fin_save_stock_item(p_clinic uuid, p_id uuid, p_data jsonb, p_minimums jsonb default '[]'::jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.stock_items; v_before jsonb; v_existing boolean := p_id is not null;
  v_type text := p_data->>'item_type'; v_name text := btrim(coalesce(p_data->>'name',''));
  v_cat text := btrim(coalesce(p_data->>'category','')); v_frac boolean := coalesce((p_data->>'fractional')::boolean, false);
  v_lot boolean := coalesce((p_data->>'lot_control')::boolean, false); v_sell boolean := coalesce((p_data->>'sellable')::boolean, false);
  v_price integer := nullif(p_data->>'sale_price_cents','')::integer; v_open integer := nullif(p_data->>'opened_validity_days','')::integer;
  v_active boolean := coalesce((p_data->>'is_active')::boolean, true); v_action text; m jsonb; v_minimums jsonb;
  v_pf numeric := coalesce(nullif(p_data->>'purchase_to_stock_factor','')::numeric, 1);
  v_cf numeric := coalesce(nullif(p_data->>'stock_to_consumption_factor','')::numeric, 1);
begin
  perform private.fin_gate(p_clinic, 'stock_items', null, true);
  if coalesce((p_data->>'controlled')::boolean, false) then raise exception 'STOCK_CONTROLLED_BLOCKED' using errcode = '22023'; end if;
  if v_name = '' or v_cat = '' then raise exception 'NAME_AND_CATEGORY_REQUIRED' using errcode = '22023'; end if;
  if v_type is null or v_type not in ('medication','compounded','resale','consumable') then raise exception 'INVALID_TYPE' using errcode = '22023'; end if;
  if v_pf <= 0 or v_cf <= 0 then raise exception 'INVALID_FACTOR' using errcode = '22023'; end if;
  if v_type in ('medication','compounded') and not v_lot then raise exception 'LOT_CONTROL_REQUIRED' using errcode = '22023'; end if;
  if v_type = 'medication' and v_sell then raise exception 'MEDICATION_NOT_SELLABLE' using errcode = '22023'; end if;
  if v_type = 'consumable' and v_sell then raise exception 'CONSUMABLE_NOT_SELLABLE' using errcode = '22023'; end if;
  if v_type = 'resale' then v_sell := true; end if;
  if (v_type = 'resale' or (v_type = 'compounded' and v_sell)) and v_price is null then raise exception 'SALE_PRICE_REQUIRED' using errcode = '22023'; end if;
  if v_frac and (v_open is null or v_open < 1) then raise exception 'OPENED_VALIDITY_REQUIRED' using errcode = '22023'; end if;
  if not v_frac then v_open := null; end if;
  if nullif(btrim(coalesce(p_data->>'ean','')), '') is not null and (p_data->>'ean') !~ '^[0-9]{8,14}$' then raise exception 'INVALID_EAN' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_minimums, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_MINIMUMS' using errcode = '22023'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_minimums, '[]'::jsonb)) loop
    if not exists (select 1 from public.clinic_units u where u.id = (m->>'unit_id')::uuid and u.clinic_id = p_clinic) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
    if (m->>'min_qty')::numeric < 0 then raise exception 'INVALID_MINIMUMS' using errcode = '22023'; end if;
  end loop;

  if v_existing then
    select * into i from public.stock_items where id = p_id and clinic_id = p_clinic for update;
    if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    select to_jsonb(i) || jsonb_build_object('minimums', coalesce((select jsonb_agg(jsonb_build_object('unit_id', unit_id, 'min_qty', min_qty) order by unit_id) from public.stock_item_minimums where item_id = i.id), '[]'::jsonb)) into v_before;
    v_action := private.fin_action(true, i.is_active, v_active, p_reason);
    update public.stock_items set name = v_name, category = v_cat, manufacturer = nullif(btrim(coalesce(p_data->>'manufacturer','')), ''),
      item_type = v_type, purchase_unit = btrim(coalesce(p_data->>'purchase_unit','un')), stock_unit = btrim(coalesce(p_data->>'stock_unit','un')),
      consumption_unit = btrim(coalesce(p_data->>'consumption_unit','un')), purchase_to_stock_factor = v_pf, stock_to_consumption_factor = v_cf,
      fractional = v_frac, opened_validity_days = v_open, individual_use = coalesce((p_data->>'individual_use')::boolean, false),
      lot_control = v_lot, sellable = v_sell, ean = nullif(btrim(coalesce(p_data->>'ean','')), ''), anvisa_reg = nullif(btrim(coalesce(p_data->>'anvisa_reg','')), ''),
      sale_price_cents = v_price, is_active = v_active, updated_at = now()
     where id = i.id returning * into i;
  else
    v_action := 'create';
    insert into public.stock_items (clinic_id, name, category, manufacturer, item_type, purchase_unit, stock_unit, consumption_unit, purchase_to_stock_factor,
        stock_to_consumption_factor, fractional, opened_validity_days, individual_use, lot_control, sellable, ean, anvisa_reg, sale_price_cents, is_active, created_by)
      values (p_clinic, v_name, v_cat, nullif(btrim(coalesce(p_data->>'manufacturer','')), ''), v_type, btrim(coalesce(p_data->>'purchase_unit','un')),
        btrim(coalesce(p_data->>'stock_unit','un')), btrim(coalesce(p_data->>'consumption_unit','un')), v_pf, v_cf, v_frac, v_open,
        coalesce((p_data->>'individual_use')::boolean, false), v_lot, v_sell, nullif(btrim(coalesce(p_data->>'ean','')), ''),
        nullif(btrim(coalesce(p_data->>'anvisa_reg','')), ''), v_price, v_active, private.current_profile_id())
      returning * into i;
  end if;

  delete from public.stock_item_minimums where item_id = i.id;
  insert into public.stock_item_minimums (item_id, unit_id, min_qty)
    select i.id, (x->>'unit_id')::uuid, round((x->>'min_qty')::numeric, 3) from jsonb_array_elements(coalesce(p_minimums, '[]'::jsonb)) x
    on conflict (item_id, unit_id) do update set min_qty = excluded.min_qty;
  select to_jsonb(i) || jsonb_build_object('minimums', coalesce((select jsonb_agg(jsonb_build_object('unit_id', unit_id, 'min_qty', min_qty) order by unit_id) from public.stock_item_minimums where item_id = i.id), '[]'::jsonb)) into v_minimums;
  if v_action <> 'update' or v_before is distinct from v_minimums then
    perform private.fin_log(p_clinic, null, 'stock_item', i.id, v_action, v_before, v_minimums, p_reason);
  end if;
  return i.id;
end $$;

-- 5.8 Serviços e kit
create or replace function private.fin_service_snapshot(p_service uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object(
    'unit_prices', coalesce((select jsonb_agg(jsonb_build_object('unit_id', unit_id, 'price_cents', price_cents) order by unit_id) from public.fin_service_unit_prices where service_id = s.id), '[]'::jsonb))
  from public.fin_services s where s.id = p_service
$$;

create or replace function public.fin_save_service(p_clinic uuid, p_id uuid, p_data jsonb, p_unit_prices jsonb default '[]'::jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.fin_services; v_before jsonb; v_existing boolean := p_id is not null; v_name text := btrim(coalesce(p_data->>'name',''));
  v_cat text := p_data->>'category'; v_price integer := nullif(p_data->>'default_price_cents','')::integer;
  v_active boolean := coalesce((p_data->>'is_active')::boolean, true); v_roles text[]; v_action text; x jsonb;
begin
  perform private.fin_gate(p_clinic, 'services', null, true);
  if v_name = '' then raise exception 'NAME_REQUIRED' using errcode = '22023'; end if;
  if v_cat is null or v_cat not in ('consulta','procedimento','aplicacao','avaliacao','sessao','outro') then raise exception 'INVALID_CATEGORY' using errcode = '22023'; end if;
  if v_price is null or v_price < 0 then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct r), '{}') into v_roles from jsonb_array_elements_text(coalesce(p_data->'roles', '["responsavel"]'::jsonb)) r;
  v_roles := array(select distinct r from unnest(v_roles || array['responsavel']) r);
  if not (v_roles <@ array['responsavel','executor','auxiliar']::text[]) then raise exception 'INVALID_ROLES' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_unit_prices, '[]'::jsonb)) loop
    if not exists (select 1 from public.clinic_units u where u.id = (x->>'unit_id')::uuid and u.clinic_id = p_clinic) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
    if (x->>'price_cents')::integer < 0 then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end loop;
  if v_existing then
    select * into s from public.fin_services where id = p_id and clinic_id = p_clinic for update;
    if s.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_before := private.fin_service_snapshot(s.id);
    v_action := private.fin_action(true, s.is_active, v_active, p_reason);
    update public.fin_services set name = v_name, category = v_cat, default_price_cents = v_price, roles = v_roles, is_active = v_active, updated_at = now() where id = s.id returning * into s;
  else
    v_action := 'create';
    insert into public.fin_services (clinic_id, name, category, default_price_cents, roles, is_active, created_by)
      values (p_clinic, v_name, v_cat, v_price, v_roles, v_active, private.current_profile_id()) returning * into s;
  end if;
  delete from public.fin_service_unit_prices where service_id = s.id;
  insert into public.fin_service_unit_prices (service_id, unit_id, price_cents)
    select s.id, (u->>'unit_id')::uuid, (u->>'price_cents')::integer from jsonb_array_elements(coalesce(p_unit_prices, '[]'::jsonb)) u
    on conflict (service_id, unit_id) do update set price_cents = excluded.price_cents;
  perform private.fin_log(p_clinic, null, 'service', s.id, v_action, v_before, private.fin_service_snapshot(s.id), p_reason);
  return s.id;
end $$;

create or replace function public.fin_set_service_kit(p_service uuid, p_items jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.fin_services; x jsonb; v_before jsonb; v_after jsonb;
begin
  select * into s from public.fin_services where id = p_service for update;
  if s.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(s.clinic_id, 'services', null, true);
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then raise exception 'INVALID_KIT' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.stock_items i where i.id = (x->>'item_id')::uuid and i.clinic_id = s.clinic_id and i.is_active) then raise exception 'INVALID_KIT_ITEM' using errcode = '22023'; end if;
    if (x->>'quantity')::numeric <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity) order by item_id), '[]'::jsonb) into v_before from public.fin_service_kit_items where service_id = s.id;
  delete from public.fin_service_kit_items where service_id = s.id;
  insert into public.fin_service_kit_items (service_id, item_id, quantity)
    select s.id, (e->>'item_id')::uuid, round((e->>'quantity')::numeric, 3) from jsonb_array_elements(p_items) e
    on conflict (service_id, item_id) do update set quantity = excluded.quantity;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity) order by item_id), '[]'::jsonb) into v_after from public.fin_service_kit_items where service_id = s.id;
  if v_before is distinct from v_after then
    perform private.fin_log(s.clinic_id, null, 'service_kit', s.id, 'update', jsonb_build_object('kit', v_before), jsonb_build_object('kit', v_after), p_reason);
  end if;
end $$;

-- 5.9 Pacotes / programas (rateio 5.4: valor da linha = referência × (preço ÷ Σ referência×qtd); resto na última linha)
create or replace function private.fin_package_snapshot(p_package uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) || jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('item_type', i.item_type, 'service_id', i.service_id, 'stock_item_id', i.stock_item_id, 'quantity', i.quantity,
      'reference_price_cents', i.reference_price_cents, 'allocated_unit_cents', i.allocated_unit_cents, 'allocated_total_cents', i.allocated_total_cents) order by i.position)
    from public.fin_package_items i where i.package_id = p.id), '[]'::jsonb))
  from public.fin_packages p where p.id = p_package
$$;

create or replace function public.fin_save_package(p_clinic uuid, p_id uuid, p_data jsonb, p_items jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.fin_packages; v_before jsonb; v_existing boolean := p_id is not null; v_name text := btrim(coalesce(p_data->>'name',''));
  v_price integer := nullif(p_data->>'price_cents','')::integer; v_days integer := nullif(p_data->>'validity_days','')::integer;
  v_active boolean := coalesce((p_data->>'is_active')::boolean, true); v_action text; x jsonb; n integer; k integer := 0;
  v_sum numeric := 0; v_total integer := 0; v_unit integer; v_line integer;
  rows_t jsonb[] := '{}'; v_type text; v_ref integer; v_qty numeric;
begin
  perform private.fin_gate(p_clinic, 'packages', null, true);
  if v_name = '' then raise exception 'NAME_REQUIRED' using errcode = '22023'; end if;
  if v_price is null or v_price < 1 then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  if v_days is null or v_days < 1 then raise exception 'INVALID_VALIDITY' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'PACKAGE_ITEMS_REQUIRED' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_type := x->>'item_type'; v_qty := (x->>'quantity')::numeric; v_ref := (x->>'reference_price_cents')::integer;
    if v_qty is null or v_qty <= 0 or v_ref is null or v_ref < 0 then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    if v_type = 'service' then
      if not exists (select 1 from public.fin_services s where s.id = (x->>'service_id')::uuid and s.clinic_id = p_clinic) then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    elsif v_type = 'product' then
      if not exists (select 1 from public.stock_items i where i.id = (x->>'stock_item_id')::uuid and i.clinic_id = p_clinic and i.item_type in ('resale','compounded')) then raise exception 'INVALID_PRODUCT' using errcode = '22023'; end if;
    else raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    v_sum := v_sum + v_ref * round(v_qty, 3);
  end loop;
  if v_sum <= 0 then raise exception 'REFERENCE_SUM_REQUIRED' using errcode = '22023'; end if;

  if v_existing then
    select * into p from public.fin_packages where id = p_id and clinic_id = p_clinic for update;
    if p.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_before := private.fin_package_snapshot(p.id);
    v_action := private.fin_action(true, p.is_active, v_active, p_reason);
    update public.fin_packages set name = v_name, price_cents = v_price, validity_days = v_days, is_active = v_active, updated_at = now() where id = p.id returning * into p;
  else
    v_action := 'create';
    insert into public.fin_packages (clinic_id, name, price_cents, validity_days, is_active, created_by)
      values (p_clinic, v_name, v_price, v_days, v_active, private.current_profile_id()) returning * into p;
  end if;
  delete from public.fin_package_items where package_id = p.id;
  n := jsonb_array_length(p_items);
  for x in select * from jsonb_array_elements(p_items) loop
    k := k + 1;
    v_qty := round((x->>'quantity')::numeric, 3); v_ref := (x->>'reference_price_cents')::integer;
    v_unit := round(v_ref::numeric * v_price / v_sum);              -- meio-para-cima (valores positivos)
    v_line := round(v_unit::numeric * v_qty);
    v_total := v_total + v_line;
    if k = n then v_line := v_line + (v_price - v_total); end if;    -- diferença de arredondamento na última linha
    insert into public.fin_package_items (package_id, position, item_type, service_id, stock_item_id, quantity, reference_price_cents, allocated_unit_cents, allocated_total_cents)
      values (p.id, k, x->>'item_type', nullif(x->>'service_id','')::uuid, nullif(x->>'stock_item_id','')::uuid, v_qty, v_ref, v_unit, v_line);
  end loop;
  perform private.fin_log(p_clinic, null, 'package', p.id, v_action, v_before, private.fin_package_snapshot(p.id), p_reason);
  return p.id;
end $$;

-- 5.10 Dados financeiros do profissional (sensíveis)
create or replace function public.fin_list_professional_finance(p_clinic uuid)
returns table (professional_id uuid, full_name text, bond_type text, simples_optant boolean, requires_invoice boolean, has_tax_id boolean, has_payment_data boolean, retentions_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'pro_finance', null, false);
  return query
    select pr.id, prof.full_name, f.bond_type, f.simples_optant, f.requires_invoice, (f.tax_id is not null),
           (f.pix_key is not null or f.bank_account is not null),
           (select count(*) from public.fin_withholding_rules w where w.professional_id = pr.id and w.is_active)
      from public.professionals pr
      join public.profiles prof on prof.id = pr.profile_id
      left join public.fin_professional_finance f on f.professional_id = pr.id
     where pr.clinic_id = p_clinic and coalesce(pr.status, 'active') = 'active'
     order by prof.full_name;
end $$;

create or replace function public.fin_get_professional_finance(p_professional uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pr public.professionals; f public.fin_professional_finance; v_out jsonb;
begin
  select * into pr from public.professionals where id = p_professional;
  if pr.id is null or pr.clinic_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- admin/gestor/financeiro (da clínica) OU o próprio profissional
  if not (private.fin_can(pr.clinic_id, 'pro_finance', null, false)
          or (private.fin_is_self_professional(p_professional) and private.is_clinic_member(pr.clinic_id))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into f from public.fin_professional_finance where professional_id = p_professional;
  perform private.fin_log(pr.clinic_id, null, 'professional_finance', p_professional, 'view_sensitive', null, null, null);
  select jsonb_build_object(
    'data', case when f.professional_id is null then null else to_jsonb(f) end,
    'withholdings', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.fin_withholding_rules w where w.professional_id = p_professional), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;

create or replace function public.fin_save_professional_finance(p_professional uuid, p_data jsonb, p_withholdings jsonb default '[]'::jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare pr public.professionals; f public.fin_professional_finance; v_before jsonb; v_after jsonb; v_existing boolean; w jsonb; v_ids uuid[] := '{}'; v_id uuid;
  v_bond text := p_data->>'bond_type'; v_tax text := nullif(regexp_replace(coalesce(p_data->>'tax_id',''), '[^0-9]', '', 'g'), '');
  v_all boolean := coalesce((p_data->>'all_units')::boolean, true); v_units uuid[]; v_type text; v_wsnap jsonb;
begin
  select * into pr from public.professionals where id = p_professional;
  if pr.id is null or pr.clinic_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(pr.clinic_id, 'pro_finance', null, true);
  if v_bond is null or v_bond not in ('pj','autonomo','clt','socio') then raise exception 'INVALID_BOND' using errcode = '22023'; end if;
  if v_tax is not null and not private.fin_valid_tax_id(v_tax) then raise exception 'INVALID_TAX_ID' using errcode = '22023'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p_data->'unit_ids', '[]'::jsonb)) x;
  if not v_all and (cardinality(v_units) = 0
      or exists (select 1 from unnest(v_units) uid where not exists (select 1 from public.clinic_units cu where cu.id = uid and cu.clinic_id = pr.clinic_id))) then
    raise exception 'INVALID_UNITS' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_withholdings, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_WITHHOLDINGS' using errcode = '22023'; end if;
  for w in select * from jsonb_array_elements(coalesce(p_withholdings, '[]'::jsonb)) loop
    v_type := w->>'rule_type';
    if v_type is null or v_type not in ('irrf','pis_cofins_csll','iss','outra') then raise exception 'INVALID_WITHHOLDING' using errcode = '22023'; end if;
    if (w->>'rate_pct')::numeric < 0 or (w->>'rate_pct')::numeric > 100 or nullif(w->>'valid_from','') is null then raise exception 'INVALID_WITHHOLDING' using errcode = '22023'; end if;
    if nullif(w->>'valid_to','') is not null and (w->>'valid_to')::date < (w->>'valid_from')::date then raise exception 'INVALID_WITHHOLDING' using errcode = '22023'; end if;
  end loop;

  select * into f from public.fin_professional_finance where professional_id = p_professional for update;
  v_existing := f.professional_id is not null;
  v_before := case when v_existing then private.fin_mask_sensitive(to_jsonb(f)) end;
  v_before := case when v_before is null then null else v_before || jsonb_build_object('withholdings', coalesce((select jsonb_agg(jsonb_build_object('rule_type', rule_type, 'label', label, 'rate_pct', rate_pct, 'min_base_cents', min_base_cents, 'waive_if_simples', waive_if_simples, 'valid_from', valid_from, 'valid_to', valid_to, 'is_active', is_active) order by created_at) from public.fin_withholding_rules where professional_id = p_professional), '[]'::jsonb)) end;

  insert into public.fin_professional_finance (professional_id, clinic_id, bond_type, tax_id, simples_optant, pix_key, bank_name, bank_agency, bank_account, requires_invoice, all_units, unit_ids, created_by)
    values (p_professional, pr.clinic_id, v_bond, v_tax, coalesce((p_data->>'simples_optant')::boolean, false), nullif(btrim(coalesce(p_data->>'pix_key','')), ''),
      nullif(btrim(coalesce(p_data->>'bank_name','')), ''), nullif(btrim(coalesce(p_data->>'bank_agency','')), ''), nullif(btrim(coalesce(p_data->>'bank_account','')), ''),
      coalesce((p_data->>'requires_invoice')::boolean, false), v_all, case when v_all then '{}' else v_units end, private.current_profile_id())
  on conflict (professional_id) do update set bond_type = excluded.bond_type, tax_id = excluded.tax_id, simples_optant = excluded.simples_optant,
      pix_key = excluded.pix_key, bank_name = excluded.bank_name, bank_agency = excluded.bank_agency, bank_account = excluded.bank_account,
      requires_invoice = excluded.requires_invoice, all_units = excluded.all_units, unit_ids = excluded.unit_ids, updated_at = now();

  for w in select * from jsonb_array_elements(coalesce(p_withholdings, '[]'::jsonb)) loop
    v_id := nullif(w->>'id','')::uuid;
    if v_id is not null and exists (select 1 from public.fin_withholding_rules r where r.id = v_id and r.professional_id = p_professional) then
      update public.fin_withholding_rules set rule_type = w->>'rule_type', label = nullif(btrim(coalesce(w->>'label','')), ''), rate_pct = (w->>'rate_pct')::numeric,
        min_base_cents = coalesce((w->>'min_base_cents')::integer, 0), waive_if_simples = coalesce((w->>'waive_if_simples')::boolean, true),
        valid_from = (w->>'valid_from')::date, valid_to = nullif(w->>'valid_to','')::date, is_active = coalesce((w->>'is_active')::boolean, true), updated_at = now()
       where id = v_id;
    else
      insert into public.fin_withholding_rules (clinic_id, professional_id, rule_type, label, rate_pct, min_base_cents, waive_if_simples, valid_from, valid_to, is_active)
        values (pr.clinic_id, p_professional, w->>'rule_type', nullif(btrim(coalesce(w->>'label','')), ''), (w->>'rate_pct')::numeric, coalesce((w->>'min_base_cents')::integer, 0),
          coalesce((w->>'waive_if_simples')::boolean, true), (w->>'valid_from')::date, nullif(w->>'valid_to','')::date, coalesce((w->>'is_active')::boolean, true))
        returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  -- regra que saiu da lista não é apagada: é desativada
  update public.fin_withholding_rules set is_active = false, updated_at = now() where professional_id = p_professional and is_active and not (id = any (v_ids));

  select f2.* into f from public.fin_professional_finance f2 where f2.professional_id = p_professional;
  v_after := private.fin_mask_sensitive(to_jsonb(f)) || jsonb_build_object('withholdings', coalesce((select jsonb_agg(jsonb_build_object('rule_type', rule_type, 'label', label, 'rate_pct', rate_pct, 'min_base_cents', min_base_cents, 'waive_if_simples', waive_if_simples, 'valid_from', valid_from, 'valid_to', valid_to, 'is_active', is_active) order by created_at) from public.fin_withholding_rules where professional_id = p_professional), '[]'::jsonb));
  if v_before is distinct from v_after then
    perform private.fin_log(pr.clinic_id, null, 'professional_finance', p_professional, case when v_existing then 'update' else 'create' end, v_before, v_after, p_reason);
  end if;
end $$;

-- 5.11 Meios de pagamento e taxas
create or replace function private.fin_acquirer_snapshot(p_acquirer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(a) || jsonb_build_object('fees', coalesce((
    select jsonb_agg(jsonb_build_object('brand', f.brand, 'modality', f.modality, 'fee_pct', f.fee_pct, 'settle_days', f.settle_days, 'anticipation', f.anticipation,
      'anticipation_fee_pct', f.anticipation_fee_pct, 'anticipation_days', f.anticipation_days) order by f.brand, f.modality)
    from public.fin_fee_rows f where f.acquirer_id = a.id), '[]'::jsonb))
  from public.fin_acquirers a where a.id = p_acquirer
$$;

create or replace function public.fin_save_acquirer(p_clinic uuid, p_id uuid, p_data jsonb, p_fees jsonb default '[]'::jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.fin_acquirers; v_before jsonb; v_existing boolean := p_id is not null; v_name text := btrim(coalesce(p_data->>'name',''));
  v_active boolean := coalesce((p_data->>'is_active')::boolean, true); v_action text; v_unit uuid := nullif(p_data->>'unit_id','')::uuid; f jsonb; v_kind text;
begin
  perform private.fin_gate(p_clinic, 'payment', v_unit, true);
  if v_name = '' then raise exception 'NAME_REQUIRED' using errcode = '22023'; end if;
  if v_unit is not null and not exists (select 1 from public.clinic_units u where u.id = v_unit and u.clinic_id = p_clinic) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if v_existing then
    select * into a from public.fin_acquirers where id = p_id and clinic_id = p_clinic for update;
    if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_kind := a.kind;
  else
    v_kind := coalesce(p_data->>'kind', 'machine');
    if v_kind <> 'machine' then raise exception 'ONLY_MACHINE_CAN_BE_CREATED' using errcode = '22023'; end if;
  end if;
  if v_kind = 'machine' then
    if jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_FEES' using errcode = '22023'; end if;
    for f in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
      if (f->>'modality') is null or (f->>'modality') not in ('debit','credit_1','credit_2_6','credit_7_12') or btrim(coalesce(f->>'brand','')) = ''
         or (f->>'fee_pct')::numeric < 0 or (f->>'fee_pct')::numeric > 100 then raise exception 'INVALID_FEES' using errcode = '22023'; end if;
    end loop;
  end if;
  if v_existing then
    v_before := private.fin_acquirer_snapshot(a.id);
    v_action := private.fin_action(true, a.is_active, v_active, p_reason);
    update public.fin_acquirers set name = v_name, unit_id = v_unit, is_active = v_active,
      flat_fee_pct = case when v_kind in ('pix','cash','transfer') then coalesce((p_data->>'flat_fee_pct')::numeric, flat_fee_pct) else flat_fee_pct end,
      flat_fee_cents = case when v_kind = 'boleto' then coalesce((p_data->>'flat_fee_cents')::integer, flat_fee_cents) else flat_fee_cents end,
      settle_days = case when v_kind <> 'machine' then coalesce((p_data->>'settle_days')::integer, settle_days) else settle_days end, updated_at = now()
     where id = a.id returning * into a;
  else
    v_action := 'create';
    insert into public.fin_acquirers (clinic_id, unit_id, name, kind, is_active, created_by) values (p_clinic, v_unit, v_name, 'machine', v_active, private.current_profile_id()) returning * into a;
  end if;
  if v_kind = 'machine' then
    delete from public.fin_fee_rows where acquirer_id = a.id;
    insert into public.fin_fee_rows (acquirer_id, brand, modality, fee_pct, settle_days, anticipation, anticipation_fee_pct, anticipation_days)
      select a.id, btrim(x->>'brand'), x->>'modality', (x->>'fee_pct')::numeric, coalesce((x->>'settle_days')::integer, 0), coalesce((x->>'anticipation')::boolean, false),
             coalesce((x->>'anticipation_fee_pct')::numeric, 0), coalesce((x->>'anticipation_days')::integer, 1)
        from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) x
      on conflict (acquirer_id, lower(btrim(brand)), modality) do update set fee_pct = excluded.fee_pct, settle_days = excluded.settle_days,
        anticipation = excluded.anticipation, anticipation_fee_pct = excluded.anticipation_fee_pct, anticipation_days = excluded.anticipation_days;
  end if;
  perform private.fin_log(p_clinic, v_unit, 'acquirer', a.id, v_action, v_before, private.fin_acquirer_snapshot(a.id), p_reason);
  return a.id;
end $$;

-- ---------- 6. Permissões de execução (autenticados; anon e público fora) ----------
revoke all on function private.fin_area_roles(text, boolean), private.fin_has_role(uuid, text[], uuid), private.fin_gate(uuid, text, uuid, boolean),
  private.fin_log(uuid, uuid, text, uuid, text, jsonb, jsonb, text), private.fin_action(boolean, boolean, boolean, text), private.fin_valid_tax_id(text),
  private.fin_mask_sensitive(jsonb), private.fin_service_snapshot(uuid), private.fin_package_snapshot(uuid), private.fin_acquirer_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function private.fin_can(uuid, text, uuid, boolean), private.fin_is_self_professional(uuid) from public, anon;

revoke all on function public.fin_my_access(uuid), public.fin_save_unit(uuid, uuid, jsonb, text), public.fin_set_staff_roles(uuid, uuid, jsonb, text),
  public.fin_audit_list(uuid, text, timestamptz, timestamptz, integer, integer), public.fin_save_settings(uuid, jsonb, text),
  public.fin_set_tax_rate(uuid, text, numeric, uuid, text), public.fin_effective_tax_rate(uuid, text, uuid),
  public.fin_save_stock_item(uuid, uuid, jsonb, jsonb, text), public.fin_save_service(uuid, uuid, jsonb, jsonb, text),
  public.fin_set_service_kit(uuid, jsonb, text), public.fin_save_package(uuid, uuid, jsonb, jsonb, text),
  public.fin_list_professional_finance(uuid), public.fin_get_professional_finance(uuid),
  public.fin_save_professional_finance(uuid, jsonb, jsonb, text), public.fin_save_acquirer(uuid, uuid, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.fin_my_access(uuid), public.fin_save_unit(uuid, uuid, jsonb, text), public.fin_set_staff_roles(uuid, uuid, jsonb, text),
  public.fin_audit_list(uuid, text, timestamptz, timestamptz, integer, integer), public.fin_save_settings(uuid, jsonb, text),
  public.fin_set_tax_rate(uuid, text, numeric, uuid, text), public.fin_effective_tax_rate(uuid, text, uuid),
  public.fin_save_stock_item(uuid, uuid, jsonb, jsonb, text), public.fin_save_service(uuid, uuid, jsonb, jsonb, text),
  public.fin_set_service_kit(uuid, jsonb, text), public.fin_save_package(uuid, uuid, jsonb, jsonb, text),
  public.fin_list_professional_finance(uuid), public.fin_get_professional_finance(uuid),
  public.fin_save_professional_finance(uuid, jsonb, jsonb, text), public.fin_save_acquirer(uuid, uuid, jsonb, jsonb, text)
  to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261113100000','20261113100000_fin_e1_base.sql','FIN-E1: unidades, papéis financeiros, log de auditoria, serviços, pacotes, dados financeiros do profissional, meios de pagamento, alíquota mensal e itens de estoque (aditiva).','FIN-E1');
