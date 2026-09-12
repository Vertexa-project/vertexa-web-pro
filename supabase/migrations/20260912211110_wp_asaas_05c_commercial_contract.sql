-- =====================================================================================
-- WP-ASAAS-05C — contrato comercial Vertexa (clinic → plan_version → offer opcional).
--
-- ASAAS = verdade financeira. billing_subscriptions.value_cents continua fato do provedor.
-- VERTEXA = verdade comercial. Este contrato é a autoridade do plano/preço contratado.
--
-- NÃO exige billing_account. NÃO chama Asaas. NÃO faz checkout.
-- NÃO backfill de clínicas. NÃO consome vaga Founder (offer_id ≠ claim).
-- NÃO altera create_patient / assign / join / create_clinic.
-- NÃO cria RPC pública. NÃO esconde menu. Sem seed de contrato.
--
-- Fecha: CONTRACTED_PRICE_SNAPSHOT_REQUIRED_FOR_05C
-- NÃO fecha: PLAN_ENFORCEMENT, FOUNDER_CLAIM, FUTURE_ADJUSTMENT_FORMULA
-- =====================================================================================


create table private.billing_commercial_contracts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  plan_version_id uuid not null,
  commercial_offer_id uuid,
  contracted_price_cents integer not null,
  contracted_currency text not null,
  billing_cycle text not null,
  status text not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_commercial_contracts_clinic_fkey
    foreign key (clinic_id) references public.clinics(id) on delete restrict,
  constraint billing_commercial_contracts_plan_version_fkey
    foreign key (plan_version_id) references private.billing_plan_versions(id) on delete restrict,
  constraint billing_commercial_contracts_offer_fkey
    foreign key (commercial_offer_id) references private.billing_offers(id) on delete restrict,
  constraint billing_commercial_contracts_price_check
    check (contracted_price_cents >= 0),
  constraint billing_commercial_contracts_currency_check
    check (contracted_currency = 'BRL'),
  constraint billing_commercial_contracts_cycle_check
    check (billing_cycle = 'monthly'),
  constraint billing_commercial_contracts_status_check
    check (status in ('pending', 'active', 'ended', 'cancelled')),
  constraint billing_commercial_contracts_window_check
    check (effective_until is null or effective_until > effective_from)
);

comment on table private.billing_commercial_contracts is
  'WP-ASAAS-05C: contrato comercial Vertexa. FK direta em clinics. '
  'Independente de billing_accounts/Asaas. Sem enforcement de produto. Sem seed.';

comment on column private.billing_commercial_contracts.contracted_price_cents is
  'SNAPSHOT server-side do catálogo no create. Nunca input do client. '
  'offer NULL → plan_version.standard_price_cents; offer set → offer_plan_prices. '
  'Fecha CONTRACTED_PRICE_SNAPSHOT_REQUIRED_FOR_05C. NÃO recalcular em leitura.';

comment on column private.billing_commercial_contracts.commercial_offer_id is
  'Referência de oferta no snapshot. NÃO é claim Founder. Sem consumo de slot. ASAAS-05H.';

comment on column private.billing_commercial_contracts.billing_cycle is
  'monthly apenas. Catálogo 05A não tem periodicidade. Dívida: ciclo anual futuro.';

comment on column private.billing_commercial_contracts.status is
  'pending|active|ended|cancelled. Comercial, NÃO past_due/paid (isso é provedor).';

comment on column private.billing_commercial_contracts.contracted_currency is
  'Snapshot da plan_version.currency_code. Hoje só BRL.';

create unique index billing_commercial_contracts_clinic_active_uidx
  on private.billing_commercial_contracts (clinic_id)
  where status = 'active';

create index billing_commercial_contracts_clinic_id_idx
  on private.billing_commercial_contracts (clinic_id);

create index billing_commercial_contracts_plan_version_id_idx
  on private.billing_commercial_contracts (plan_version_id);

create index billing_commercial_contracts_offer_id_idx
  on private.billing_commercial_contracts (commercial_offer_id)
  where commercial_offer_id is not null;


create or replace function private.billing_commercial_contracts_protect_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id
       or new.plan_version_id is distinct from old.plan_version_id
       or new.commercial_offer_id is distinct from old.commercial_offer_id
       or new.contracted_price_cents is distinct from old.contracted_price_cents
       or new.contracted_currency is distinct from old.contracted_currency
       or new.billing_cycle is distinct from old.billing_cycle
       or new.effective_from is distinct from old.effective_from then
      raise exception 'BILLING_CONTRACT_SNAPSHOT_IMMUTABLE'
        using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function private.billing_commercial_contracts_protect_snapshot() is
  'WP-ASAAS-05C: snapshot comercial imutável. Upgrade futuro = novo contrato. '
  'SECURITY INVOKER. Sem RPC pública.';

revoke all on function private.billing_commercial_contracts_protect_snapshot()
  from public, anon, authenticated, service_role;

create trigger billing_commercial_contracts_protect_snapshot
  before update on private.billing_commercial_contracts
  for each row
  execute function private.billing_commercial_contracts_protect_snapshot();


create or replace function private.billing_create_commercial_contract(
  p_clinic_id uuid,
  p_plan_version_id uuid,
  p_offer_id uuid default null,
  p_effective_from timestamptz default null,
  p_effective_until timestamptz default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_from timestamptz;
  v_plan_status text;
  v_currency text;
  v_standard integer;
  v_offer_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_price integer;
  v_id uuid;
begin
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023';
  end if;
  if p_plan_version_id is null then
    raise exception 'BILLING_PLAN_VERSION_REQUIRED' using errcode = '22023';
  end if;

  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'BILLING_CLINIC_UNKNOWN' using errcode = 'P0002';
  end if;

  v_from := coalesce(p_effective_from, v_now);
  if p_effective_until is not null and p_effective_until <= v_from then
    raise exception 'BILLING_EFFECTIVE_WINDOW_INVALID' using errcode = '22023';
  end if;

  select p.status, pv.currency_code, pv.standard_price_cents
    into v_plan_status, v_currency, v_standard
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where pv.id = p_plan_version_id;
  if v_standard is null then
    raise exception 'BILLING_PLAN_VERSION_UNKNOWN' using errcode = 'P0002';
  end if;
  if v_plan_status is distinct from 'active' then
    raise exception 'BILLING_PLAN_NOT_ELIGIBLE' using errcode = '22023';
  end if;

  if p_offer_id is null then
    v_price := v_standard;
  else
    select o.status, o.starts_at, o.ends_at
      into v_offer_status, v_starts, v_ends
      from private.billing_offers o
     where o.id = p_offer_id;
    if v_offer_status is null then
      raise exception 'BILLING_OFFER_UNKNOWN' using errcode = 'P0002';
    end if;
    if v_offer_status is distinct from 'active'
       or (v_starts is not null and v_now < v_starts)
       or (v_ends is not null and v_now >= v_ends)
       or (v_starts is not null and v_from < v_starts)
       or (v_ends is not null and v_from >= v_ends) then
      raise exception 'BILLING_OFFER_NOT_ELIGIBLE' using errcode = '22023';
    end if;

    select opp.price_cents into v_price
      from private.billing_offer_plan_prices opp
     where opp.offer_id = p_offer_id
       and opp.plan_version_id = p_plan_version_id;
    if v_price is null then
      raise exception 'BILLING_OFFER_PRICE_MISSING' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1
      from private.billing_commercial_contracts cc
     where cc.clinic_id = p_clinic_id
       and cc.status = 'active'
  ) then
    raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS' using errcode = '23505';
  end if;

  insert into private.billing_commercial_contracts (
    clinic_id,
    plan_version_id,
    commercial_offer_id,
    contracted_price_cents,
    contracted_currency,
    billing_cycle,
    status,
    effective_from,
    effective_until
  ) values (
    p_clinic_id,
    p_plan_version_id,
    p_offer_id,
    v_price,
    v_currency,
    'monthly',
    'active',
    v_from,
    p_effective_until
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.billing_create_commercial_contract(uuid, uuid, uuid, timestamptz, timestamptz) is
  'WP-ASAAS-05C: cria contrato ativo. Preço/moeda derivados do catálogo. '
  'Sem preço do caller. Sem claim Founder. Sem RPC pública. SECURITY INVOKER.';


create or replace function private.billing_clinic_active_contract(
  p_clinic_id uuid
)
returns table (
  contract_id uuid,
  clinic_id uuid,
  plan_version_id uuid,
  plan_code text,
  plan_version integer,
  contracted_price_cents integer,
  currency text,
  offer_id uuid,
  offer_code text,
  billing_cycle text,
  effective_from timestamptz,
  effective_until timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023';
  end if;

  return query
    select
      cc.id,
      cc.clinic_id,
      cc.plan_version_id,
      p.code,
      pv.version,
      cc.contracted_price_cents,
      cc.contracted_currency,
      cc.commercial_offer_id,
      o.code,
      cc.billing_cycle,
      cc.effective_from,
      cc.effective_until
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
    left join private.billing_offers o on o.id = cc.commercial_offer_id
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;
end;
$$;

comment on function private.billing_clinic_active_contract(uuid) is
  'WP-ASAAS-05C: contrato ativo da clínica, ou vazio. Sem fallback Pulse. '
  'Sem Asaas/PII. SECURITY INVOKER. Sem RPC pública.';


alter table private.billing_commercial_contracts enable row level security;

revoke all on table private.billing_commercial_contracts
  from public, anon, authenticated, service_role;
revoke all on function private.billing_create_commercial_contract(uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.billing_clinic_active_contract(uuid)
  from public, anon, authenticated, service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260912211110',
  '20260912211110_wp_asaas_05c_commercial_contract.sql',
  'WP-ASAAS-05C: contrato comercial Vertexa (clinic→plan_version→offer opcional). '
  'Snapshot de preço server-side. private, RLS ON, 0 policies, sem RPC pública, '
  'sem backfill, sem Asaas, sem claim Founder, sem enforcement.',
  'WP-ASAAS-05C'
)
on conflict (version) do nothing;
