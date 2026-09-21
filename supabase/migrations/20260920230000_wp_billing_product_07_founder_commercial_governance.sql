-- =====================================================================================
-- WP-BILLING-PRODUCT-07 — Founder Member + commercial capacity governance.
-- LOCAL ONLY. Additive. No Asaas. No remote apply. Entitlement enforcement stays OFF.
-- =====================================================================================

alter table private.billing_plan_versions
  add column if not exists additional_professional_price_cents integer,
  add column if not exists additional_patient_price_cents integer;

alter table private.billing_plan_versions
  drop constraint if exists billing_plan_versions_addon_professional_check;
alter table private.billing_plan_versions
  add constraint billing_plan_versions_addon_professional_check
  check (additional_professional_price_cents is null or additional_professional_price_cents >= 0);

alter table private.billing_plan_versions
  drop constraint if exists billing_plan_versions_addon_patient_check;
alter table private.billing_plan_versions
  add constraint billing_plan_versions_addon_patient_check
  check (additional_patient_price_cents is null or additional_patient_price_cents >= 0);

comment on column private.billing_plan_versions.additional_professional_price_cents is
  'WP-BP07: explicit additional professional unit price. NULL = no paid overage (Pulse).';
comment on column private.billing_plan_versions.additional_patient_price_cents is
  'WP-BP07: explicit additional patient unit price. NULL = no paid overage (Pulse).';


create table if not exists private.billing_commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null,
  kind text not null,
  status text not null,
  max_admissions integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_commercial_campaigns_offer_fkey
    foreign key (offer_id) references private.billing_offers(id) on delete restrict,
  constraint billing_commercial_campaigns_kind_check
    check (kind = 'founder'),
  constraint billing_commercial_campaigns_status_check
    check (status in ('open', 'closed')),
  constraint billing_commercial_campaigns_max_check
    check (max_admissions > 0)
);

comment on table private.billing_commercial_campaigns is
  'WP-BP07: admission campaign. Founder is not a coupon. CLOSED blocks new admissions only.';

create unique index if not exists billing_commercial_campaigns_offer_uidx
  on private.billing_commercial_campaigns (offer_id);


create table if not exists private.billing_founder_admissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  clinic_id uuid not null,
  slot_number integer not null,
  admitted_at timestamptz not null default clock_timestamp(),
  initial_plan_code text not null,
  initial_plan_version_id uuid not null,
  initial_founder_price_cents integer not null,
  reference_price_cents integer not null,
  lock_months integer not null,
  lock_until date not null,
  lifetime_discount_bps integer not null,
  benefit_status text not null,
  cancelled_at timestamptz,
  returned_at timestamptz,
  ineligible_after_close_at timestamptz,
  admitted_by uuid,
  created_at timestamptz not null default now(),
  constraint billing_founder_admissions_campaign_fkey
    foreign key (campaign_id) references private.billing_commercial_campaigns(id) on delete restrict,
  constraint billing_founder_admissions_clinic_fkey
    foreign key (clinic_id) references public.clinics(id) on delete restrict,
  constraint billing_founder_admissions_plan_version_fkey
    foreign key (initial_plan_version_id) references private.billing_plan_versions(id) on delete restrict,
  constraint billing_founder_admissions_slot_check
    check (slot_number >= 1 and slot_number <= 50),
  constraint billing_founder_admissions_price_check
    check (initial_founder_price_cents >= 0 and reference_price_cents >= 0),
  constraint billing_founder_admissions_lock_check
    check (lock_months > 0),
  constraint billing_founder_admissions_discount_check
    check (lifetime_discount_bps >= 0 and lifetime_discount_bps <= 10000),
  constraint billing_founder_admissions_status_check
    check (benefit_status in ('eligible', 'returnable', 'historical_only'))
);

comment on table private.billing_founder_admissions is
  'WP-BP07: immutable historical Founder admission. Slot is never reused for a new clinic.';

create unique index if not exists billing_founder_admissions_campaign_slot_uidx
  on private.billing_founder_admissions (campaign_id, slot_number);
create unique index if not exists billing_founder_admissions_campaign_clinic_uidx
  on private.billing_founder_admissions (campaign_id, clinic_id);
create index if not exists billing_founder_admissions_clinic_idx
  on private.billing_founder_admissions (clinic_id);

create or replace function private.billing_founder_admissions_protect_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'BILLING_FOUNDER_HISTORY_IMMUTABLE'
      using errcode = '23514', hint = 'BILLING_FOUNDER_HISTORY_IMMUTABLE';
  end if;
  if new.campaign_id is distinct from old.campaign_id
     or new.clinic_id is distinct from old.clinic_id
     or new.slot_number is distinct from old.slot_number
     or new.admitted_at is distinct from old.admitted_at
     or new.initial_plan_code is distinct from old.initial_plan_code
     or new.initial_plan_version_id is distinct from old.initial_plan_version_id
     or new.initial_founder_price_cents is distinct from old.initial_founder_price_cents
     or new.reference_price_cents is distinct from old.reference_price_cents
     or new.lock_months is distinct from old.lock_months
     or new.lock_until is distinct from old.lock_until
     or new.lifetime_discount_bps is distinct from old.lifetime_discount_bps
     or new.admitted_by is distinct from old.admitted_by then
    raise exception 'BILLING_FOUNDER_HISTORY_IMMUTABLE'
      using errcode = '23514', hint = 'BILLING_FOUNDER_HISTORY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_founder_admissions_protect_history
  on private.billing_founder_admissions;
create trigger billing_founder_admissions_protect_history
  before update or delete on private.billing_founder_admissions
  for each row
  execute function private.billing_founder_admissions_protect_history();


create table if not exists private.billing_contract_capacity_units (
  commercial_contract_id uuid primary key,
  additional_professional_units integer not null default 0,
  additional_patient_units integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint billing_contract_capacity_units_contract_fkey
    foreign key (commercial_contract_id) references private.billing_commercial_contracts(id) on delete restrict,
  constraint billing_contract_capacity_units_prof_check
    check (additional_professional_units >= 0),
  constraint billing_contract_capacity_units_pat_check
    check (additional_patient_units >= 0)
);

comment on table private.billing_contract_capacity_units is
  'WP-BP07: explicitly contracted additional units. Not automatic overage. PA-managed.';


create table if not exists private.billing_commercial_adjustments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  kind text not null,
  percent_bps integer,
  amount_cents integer,
  starts_at date,
  ends_at date,
  reason text,
  admin_note text,
  granted_by uuid,
  revoked_by uuid,
  revoked_at timestamptz,
  stackable boolean not null default false,
  created_at timestamptz not null default now(),
  constraint billing_commercial_adjustments_clinic_fkey
    foreign key (clinic_id) references public.clinics(id) on delete restrict,
  constraint billing_commercial_adjustments_kind_check
    check (kind in ('percentage', 'fixed_cents')),
  constraint billing_commercial_adjustments_not_founder_check
    check (kind <> 'founder')
);

comment on table private.billing_commercial_adjustments is
  'WP-BP07: future clinic discount/coupon seam. Not applied in current price resolution. '
  'Founder is never a row here. Do not mutate plan table prices.';

create index if not exists billing_commercial_adjustments_clinic_idx
  on private.billing_commercial_adjustments (clinic_id);


create table if not exists private.billing_commercial_governance_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_authority text not null,
  action text not null,
  clinic_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_commercial_governance_events_authority_check
    check (actor_authority in ('platform_admin', 'system'))
);

comment on table private.billing_commercial_governance_events is
  'WP-BP07: PA commercial audit. No secrets. No Asaas payloads.';

alter table private.billing_commercial_campaigns enable row level security;
alter table private.billing_founder_admissions enable row level security;
alter table private.billing_contract_capacity_units enable row level security;
alter table private.billing_commercial_adjustments enable row level security;
alter table private.billing_commercial_governance_events enable row level security;

revoke all on table private.billing_commercial_campaigns from public, anon, authenticated, service_role;
revoke all on table private.billing_founder_admissions from public, anon, authenticated, service_role;
revoke all on table private.billing_contract_capacity_units from public, anon, authenticated, service_role;
revoke all on table private.billing_commercial_adjustments from public, anon, authenticated, service_role;
revoke all on table private.billing_commercial_governance_events from public, anon, authenticated, service_role;


-- Catalog v2: current campaign capacities. v1 rows stay intact.
insert into private.billing_plan_versions (
  plan_id, version, currency_code, standard_price_cents,
  max_professionals, max_active_patients,
  additional_professional_price_cents, additional_patient_price_cents,
  tagline, marketing_message
)
select
  p.id,
  2,
  pv.currency_code,
  pv.standard_price_cents,
  case p.code when 'pulse' then 2 when 'sync' then 3 when 'apex' then 5 else pv.max_professionals end,
  case p.code when 'pulse' then 50 when 'sync' then 100 when 'apex' then 150 else pv.max_active_patients end,
  case p.code when 'sync' then 3900 when 'apex' then 3900 else null end,
  case p.code when 'sync' then 1800 when 'apex' then 1200 else null end,
  pv.tagline,
  pv.marketing_message
from private.billing_plans p
join private.billing_plan_versions pv
  on pv.plan_id = p.id
 and pv.version = 1
where p.code in ('pulse', 'sync', 'apex')
  and not exists (
    select 1 from private.billing_plan_versions x
     where x.plan_id = p.id and x.version = 2
  );

insert into private.billing_plan_version_features (plan_version_id, feature_id)
select n.id, f.feature_id
  from private.billing_plan_versions o
  join private.billing_plans p on p.id = o.plan_id
  join private.billing_plan_versions n
    on n.plan_id = o.plan_id and n.version = 2
  join private.billing_plan_version_features f on f.plan_version_id = o.id
 where o.version = 1
   and p.code in ('pulse', 'sync', 'apex')
on conflict do nothing;

insert into private.billing_plan_version_entitlements (plan_version_id, entitlement_id, enabled)
select n.id, e.entitlement_id, e.enabled
  from private.billing_plan_versions o
  join private.billing_plans p on p.id = o.plan_id
  join private.billing_plan_versions n
    on n.plan_id = o.plan_id and n.version = 2
  join private.billing_plan_version_entitlements e on e.plan_version_id = o.id
 where o.version = 1
   and p.code in ('pulse', 'sync', 'apex')
on conflict do nothing;

insert into private.billing_offer_plan_prices (offer_id, plan_version_id, price_cents)
select opp.offer_id, n.id, opp.price_cents
  from private.billing_offers o
  join private.billing_offer_plan_prices opp on opp.offer_id = o.id
  join private.billing_plan_versions ov on ov.id = opp.plan_version_id
  join private.billing_plan_versions n
    on n.plan_id = ov.plan_id and n.version = 2
 where o.code = 'founder_2026'
on conflict do nothing;

insert into private.billing_commercial_campaigns (offer_id, kind, status, max_admissions)
select o.id, 'founder', 'open', 50
  from private.billing_offers o
 where o.code = 'founder_2026'
on conflict (offer_id) do nothing;


create or replace function private.billing_founder_campaign()
returns private.billing_commercial_campaigns
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from private.billing_commercial_campaigns c
    join private.billing_offers o on o.id = c.offer_id
   where o.code = 'founder_2026'
   limit 1
$$;

create or replace function private.billing_founder_is_currently_eligible(p_clinic_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists(
    select 1
      from private.billing_founder_admissions a
     where a.clinic_id = p_clinic_id
       and a.benefit_status in ('eligible', 'returnable')
  )
$$;

create or replace function private.billing_current_plan_version(p_plan_id uuid)
returns private.billing_plan_versions
language sql
stable
security invoker
set search_path = ''
as $$
  select pv.*
    from private.billing_plan_versions pv
   where pv.plan_id = p_plan_id
   order by pv.version desc
   limit 1
$$;

create or replace function private.billing_resolve_commercial_price(
  p_clinic_id uuid,
  p_as_of timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, clock_timestamp());
  v_as_of_date date := (v_as_of at time zone 'America/Sao_Paulo')::date;
  v_contract record;
  v_plan record;
  v_current private.billing_plan_versions;
  v_adm record;
  v_add_prof integer := 0;
  v_add_pat integer := 0;
  v_table integer := 0;
  v_base integer := 0;
  v_reason text := 'standard_snapshot';
  v_founder_adj integer := 0;
  v_locked integer := null;
  v_add_cents integer := 0;
  v_unit_prof integer := null;
  v_unit_pat integer := null;
begin
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;

  select cc.id, cc.plan_version_id, cc.contracted_price_cents, cc.status, cc.commercial_offer_id
    into v_contract
    from private.billing_commercial_contracts cc
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;

  if v_contract.id is null then
    return jsonb_build_object(
      'clinic_id', p_clinic_id,
      'has_active_contract', false,
      'pricing_reason', 'no_active_contract',
      'final_projected_cents', 0,
      'adjustments_applied', 0
    );
  end if;

  select p.id as plan_id, p.code, pv.standard_price_cents, pv.version,
         pv.max_professionals, pv.max_active_patients,
         pv.additional_professional_price_cents, pv.additional_patient_price_cents
    into v_plan
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where pv.id = v_contract.plan_version_id;

  v_current := private.billing_current_plan_version(v_plan.plan_id);
  v_table := v_current.standard_price_cents;
  v_unit_prof := v_current.additional_professional_price_cents;
  v_unit_pat := v_current.additional_patient_price_cents;

  select coalesce(u.additional_professional_units, 0), coalesce(u.additional_patient_units, 0)
    into v_add_prof, v_add_pat
    from private.billing_contract_capacity_units u
   where u.commercial_contract_id = v_contract.id;

  select a.*
    into v_adm
    from private.billing_founder_admissions a
   where a.clinic_id = p_clinic_id
   limit 1;

  if v_adm.id is not null and v_adm.benefit_status = 'eligible' then
    if v_as_of_date < v_adm.lock_until then
      v_base := v_adm.initial_founder_price_cents;
      v_locked := v_adm.initial_founder_price_cents;
      v_founder_adj := v_table - v_base;
      v_reason := 'founder_lock';
    else
      v_base := (v_table * (10000 - v_adm.lifetime_discount_bps)) / 10000;
      v_founder_adj := v_table - v_base;
      v_reason := 'founder_lifetime_table';
    end if;
  else
    v_base := v_contract.contracted_price_cents;
    v_reason := 'standard_snapshot';
  end if;

  if v_add_prof > 0 then
    if v_unit_prof is null then
      raise exception 'BILLING_PULSE_NO_ADDON'
        using errcode = '22023', hint = 'BILLING_PULSE_NO_ADDON';
    end if;
    v_add_cents := v_add_cents + (v_add_prof * v_unit_prof);
  end if;
  if v_add_pat > 0 then
    if v_unit_pat is null then
      raise exception 'BILLING_PULSE_NO_ADDON'
        using errcode = '22023', hint = 'BILLING_PULSE_NO_ADDON';
    end if;
    v_add_cents := v_add_cents + (v_add_pat * v_unit_pat);
  end if;

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'has_active_contract', true,
    'plan_code', v_plan.code,
    'contracted_plan_version', v_plan.version,
    'current_table_version', v_current.version,
    'table_price_cents', v_table,
    'locked_price_cents', v_locked,
    'founder_adjustment_cents', v_founder_adj,
    'additional_capacity_cents', v_add_cents,
    'final_projected_cents', v_base + v_add_cents,
    'pricing_reason', v_reason,
    'founder_eligible', coalesce(v_adm.benefit_status = 'eligible', false),
    'lock_until', v_adm.lock_until,
    'lifetime_discount_bps', v_adm.lifetime_discount_bps,
    'additional_professional_units', coalesce(v_add_prof, 0),
    'additional_patient_units', coalesce(v_add_pat, 0),
    'adjustments_applied', 0,
    'future_adjustment_seam', 'billing_commercial_adjustments',
    'projection_not_charge', true
  );
end;
$$;

revoke all on function private.billing_resolve_commercial_price(uuid, timestamptz)
  from public, anon, authenticated;

-- Future coupon/discount preview. NOT called by billing_resolve_commercial_price.
-- Founder is never a row in billing_commercial_adjustments.
create or replace function private.billing_preview_future_adjustments(
  p_clinic_id uuid,
  p_base_cents integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_row private.billing_commercial_adjustments;
  v_out integer;
begin
  if p_base_cents is null or p_base_cents < 0 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_base');
  end if;
  select a.*
    into v_row
    from private.billing_commercial_adjustments a
   where a.clinic_id = p_clinic_id
     and a.revoked_at is null
   order by a.created_at desc
   limit 1;
  if v_row.id is null then
    return jsonb_build_object(
      'applied', false,
      'reason', 'no_adjustment',
      'stackable_default', false,
      'founder_is_not_coupon', true
    );
  end if;
  v_out := p_base_cents;
  if v_row.kind = 'percentage' and v_row.percent_bps is not null then
    v_out := (p_base_cents * (10000 - v_row.percent_bps)) / 10000;
  elsif v_row.kind = 'fixed_cents' and v_row.amount_cents is not null then
    v_out := greatest(p_base_cents - v_row.amount_cents, 0);
  end if;
  return jsonb_build_object(
    'applied', true,
    'reason', 'preview_only',
    'base_cents', p_base_cents,
    'adjusted_cents', v_out,
    'stackable', v_row.stackable,
    'founder_is_not_coupon', true
  );
end;
$$;

revoke all on function private.billing_preview_future_adjustments(uuid, integer)
  from public, anon, authenticated;


create or replace function private.billing_commercial_capacity(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_billable integer := 0;
  v_patients integer := 0;
  v_included_prof integer := 0;
  v_included_pat integer := 0;
  v_add_prof integer := 0;
  v_add_pat integer := 0;
  v_allowed_prof integer := 0;
  v_allowed_pat integer := 0;
  v_code text;
  v_has_contract boolean := false;
begin
  select c.owner_profile_id into v_owner from public.clinics c where c.id = p_clinic_id;
  if v_owner is null and not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'BILLING_CLINIC_UNKNOWN' using errcode = 'P0002', hint = 'BILLING_CLINIC_UNKNOWN';
  end if;

  select count(*)::integer
    into v_billable
    from public.professionals pr
   where pr.clinic_id = p_clinic_id
     and coalesce(pr.status, 'active') = 'active'
     and pr.profile_id is distinct from v_owner;

  select count(distinct pat.id)::integer
    into v_patients
    from public.patients pat
    join public.professional_patient_links l
      on l.patient_id = pat.id
     and l.status = 'active'
    join public.professionals pr
      on pr.id = l.professional_id
     and pr.clinic_id = pat.clinic_id
   where pat.clinic_id = p_clinic_id;

  select p.code, pv.max_professionals, pv.max_active_patients, true
    into v_code, v_included_prof, v_included_pat, v_has_contract
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;

  if not v_has_contract then
    return jsonb_build_object(
      'clinic_id', p_clinic_id,
      'has_active_contract', false,
      'owner_exempt', 1,
      'billable_professionals', v_billable,
      'active_patients', v_patients,
      'enforced', false
    );
  end if;

  select coalesce(u.additional_professional_units, 0), coalesce(u.additional_patient_units, 0)
    into v_add_prof, v_add_pat
    from private.billing_contract_capacity_units u
    join private.billing_commercial_contracts cc on cc.id = u.commercial_contract_id
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active';

  v_allowed_prof := v_included_prof + coalesce(v_add_prof, 0);
  v_allowed_pat := v_included_pat + coalesce(v_add_pat, 0);

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'has_active_contract', true,
    'plan_code', v_code,
    'owner_exempt', 1,
    'billable_professionals', v_billable,
    'included_professionals', v_included_prof,
    'additional_professional_units', coalesce(v_add_prof, 0),
    'allowed_professionals', v_allowed_prof,
    'remaining_professionals', greatest(v_allowed_prof - v_billable, 0),
    'professionals_exceeded', v_billable > v_allowed_prof,
    'active_patients', v_patients,
    'included_patients', v_included_pat,
    'additional_patient_units', coalesce(v_add_pat, 0),
    'allowed_patients', v_allowed_pat,
    'remaining_patients', greatest(v_allowed_pat - v_patients, 0),
    'patients_exceeded', v_patients > v_allowed_pat,
    'enforced', true
  );
end;
$$;

revoke all on function private.billing_commercial_capacity(uuid)
  from public, anon, authenticated;


create or replace function private.billing_assert_professional_capacity(p_clinic_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_cap jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(90701, pg_catalog.hashtext(p_clinic_id::text));
  v_cap := private.billing_commercial_capacity(p_clinic_id);
  if coalesce((v_cap->>'enforced')::boolean, false)
     and coalesce((v_cap->>'remaining_professionals')::integer, 0) <= 0 then
    raise exception 'BILLING_PROFESSIONAL_CAPACITY'
      using errcode = '23514', hint = 'BILLING_PROFESSIONAL_CAPACITY';
  end if;
end;
$$;

create or replace function private.billing_assert_patient_capacity(p_clinic_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_cap jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(90702, pg_catalog.hashtext(p_clinic_id::text));
  v_cap := private.billing_commercial_capacity(p_clinic_id);
  if coalesce((v_cap->>'enforced')::boolean, false)
     and coalesce((v_cap->>'remaining_patients')::integer, 0) <= 0 then
    raise exception 'BILLING_PATIENT_CAPACITY'
      using errcode = '23514', hint = 'BILLING_PATIENT_CAPACITY';
  end if;
end;
$$;

revoke all on function private.billing_assert_professional_capacity(uuid)
  from public, anon, authenticated;
revoke all on function private.billing_assert_patient_capacity(uuid)
  from public, anon, authenticated;


create or replace function private.billing_professionals_capacity_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new_owner uuid;
  v_old_owner uuid;
  v_new_billable boolean;
  v_old_billable boolean := false;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  select c.owner_profile_id into v_new_owner from public.clinics c where c.id = new.clinic_id;
  v_new_billable := v_new_owner is null or new.profile_id is distinct from v_new_owner;
  if tg_op = 'UPDATE' then
    select c.owner_profile_id into v_old_owner from public.clinics c where c.id = old.clinic_id;
    v_old_billable := old.status is not distinct from 'active'
      and (v_old_owner is null or old.profile_id is distinct from v_old_owner);
  end if;
  if v_new_billable
     and (tg_op = 'INSERT' or not v_old_billable or old.clinic_id is distinct from new.clinic_id) then
    perform private.billing_assert_professional_capacity(new.clinic_id);
  end if;
  return new;
end;
$$;

drop trigger if exists billing_professionals_capacity_guard on public.professionals;
create trigger billing_professionals_capacity_guard
  before insert or update of status, clinic_id, profile_id on public.professionals
  for each row
  execute function private.billing_professionals_capacity_guard();


create or replace function private.billing_patient_capacity_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_already boolean := false;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then
    return new;
  end if;
  select pat.clinic_id into v_clinic from public.patients pat where pat.id = new.patient_id;
  if v_clinic is null then
    return new;
  end if;
  select exists(
    select 1
      from public.professional_patient_links l
      join public.professionals pr on pr.id = l.professional_id and pr.clinic_id = v_clinic
     where l.patient_id = new.patient_id
       and l.status = 'active'
       and l.id is distinct from new.id
  ) into v_already;
  if v_already then
    return new;
  end if;
  perform private.billing_assert_patient_capacity(v_clinic);
  return new;
end;
$$;

drop trigger if exists billing_patient_capacity_guard on public.professional_patient_links;
create trigger billing_patient_capacity_guard
  before insert or update of status, patient_id, professional_id on public.professional_patient_links
  for each row
  execute function private.billing_patient_capacity_guard();


create or replace function private.billing_clinic_owner_capacity_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.owner_profile_id is distinct from old.owner_profile_id
     and exists (
       select 1
         from private.billing_commercial_contracts cc
        where cc.clinic_id = new.id
          and cc.status = 'active'
     ) then
    raise exception 'BILLING_OWNER_LOCKED_FOR_CAPACITY'
      using errcode = '23514', hint = 'BILLING_OWNER_LOCKED_FOR_CAPACITY';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_clinic_owner_capacity_guard on public.clinics;
create trigger billing_clinic_owner_capacity_guard
  before update of owner_profile_id on public.clinics
  for each row
  execute function private.billing_clinic_owner_capacity_guard();


create or replace function private.billing_admit_founder(
  p_clinic_id uuid,
  p_plan_version_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_campaign private.billing_commercial_campaigns;
  v_plan_code text;
  v_founder integer;
  v_ref integer;
  v_used integer;
  v_slot integer;
  v_id uuid;
  v_lock date;
  v_from date;
begin
  v_campaign := private.billing_founder_campaign();
  if v_campaign.id is null then
    raise exception 'BILLING_FOUNDER_CAMPAIGN_MISSING'
      using errcode = 'P0002', hint = 'BILLING_FOUNDER_CAMPAIGN_MISSING';
  end if;
  if v_campaign.status is distinct from 'open' then
    raise exception 'BILLING_FOUNDER_CAMPAIGN_CLOSED'
      using errcode = '22023', hint = 'BILLING_FOUNDER_CAMPAIGN_CLOSED';
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'BILLING_CLINIC_UNKNOWN' using errcode = 'P0002', hint = 'BILLING_CLINIC_UNKNOWN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90707, pg_catalog.hashtext(v_campaign.id::text));

  if exists (
    select 1 from private.billing_founder_admissions a
     where a.campaign_id = v_campaign.id and a.clinic_id = p_clinic_id
  ) then
    raise exception 'BILLING_FOUNDER_ALREADY_ADMITTED'
      using errcode = '23505', hint = 'BILLING_FOUNDER_ALREADY_ADMITTED';
  end if;

  select count(*)::integer into v_used
    from private.billing_founder_admissions a
   where a.campaign_id = v_campaign.id;
  if v_used >= v_campaign.max_admissions then
    raise exception 'BILLING_FOUNDER_SLOTS_EXHAUSTED'
      using errcode = '23514', hint = 'BILLING_FOUNDER_SLOTS_EXHAUSTED';
  end if;

  select coalesce(max(a.slot_number), 0) + 1 into v_slot
    from private.billing_founder_admissions a
   where a.campaign_id = v_campaign.id;
  if v_slot > 50 then
    raise exception 'BILLING_FOUNDER_SLOTS_EXHAUSTED'
      using errcode = '23514', hint = 'BILLING_FOUNDER_SLOTS_EXHAUSTED';
  end if;

  select p.code, opp.price_cents, pv.standard_price_cents
    into v_plan_code, v_founder, v_ref
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
    join private.billing_offer_plan_prices opp
      on opp.plan_version_id = pv.id
     and opp.offer_id = v_campaign.offer_id
   where pv.id = p_plan_version_id;
  if v_founder is null then
    raise exception 'BILLING_FOUNDER_PRICE_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_FOUNDER_PRICE_UNKNOWN';
  end if;

  select (cc.effective_from at time zone 'America/Sao_Paulo')::date
    into v_from
    from private.billing_commercial_contracts cc
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;
  v_from := coalesce(v_from, (clock_timestamp() at time zone 'America/Sao_Paulo')::date);
  v_lock := private.billing_add_calendar_months(v_from, 12);

  insert into private.billing_founder_admissions (
    campaign_id, clinic_id, slot_number, initial_plan_code, initial_plan_version_id,
    initial_founder_price_cents, reference_price_cents, lock_months, lock_until,
    lifetime_discount_bps, benefit_status, admitted_by
  ) values (
    v_campaign.id, p_clinic_id, v_slot, v_plan_code, p_plan_version_id,
    v_founder, v_ref, 12, v_lock, 3000, 'eligible', p_actor
  ) returning id into v_id;

  insert into private.billing_commercial_governance_events (
    actor_id, actor_authority, action, clinic_id, payload
  ) values (
    p_actor, 'platform_admin', 'founder_admit', p_clinic_id,
    jsonb_build_object('slot', v_slot, 'plan_code', v_plan_code)
  );

  return v_id;
end;
$$;

revoke all on function private.billing_admit_founder(uuid, uuid, uuid)
  from public, anon, authenticated;


create or replace function public.admit_platform_founder_clinic(
  p_clinic_id uuid,
  p_plan_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_plan_version uuid;
  v_contract_code text;
  v_id uuid;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  if p_plan_code not in ('pulse', 'sync', 'apex') then
    raise exception 'BILLING_PLAN_CODE_INVALID'
      using errcode = '22023', hint = 'BILLING_PLAN_CODE_INVALID';
  end if;
  select pv.id
    into v_plan_version
    from private.billing_plans p
    join private.billing_plan_versions pv on pv.plan_id = p.id
   where p.code = p_plan_code
   order by pv.version desc
   limit 1;
  if v_plan_version is null then
    raise exception 'BILLING_PLAN_VERSION_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_PLAN_VERSION_UNKNOWN';
  end if;
  select p.code
    into v_contract_code
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;
  if v_contract_code is not null and v_contract_code is distinct from p_plan_code then
    raise exception 'BILLING_FOUNDER_PLAN_MISMATCH'
      using errcode = '22023', hint = 'BILLING_FOUNDER_PLAN_MISMATCH';
  end if;
  v_id := private.billing_admit_founder(p_clinic_id, v_plan_version, v_me);
  return jsonb_build_object('admission_id', v_id, 'outcome', 'admitted', 'plan_code', p_plan_code);
end;
$$;

comment on function public.admit_platform_founder_clinic(uuid, text) is
  'WP-BP07: Platform Admin Founder admission. Clinic Admin cannot self-grant. '
  'Server picks current plan version and catalog Founder price.';

revoke all on function public.admit_platform_founder_clinic(uuid, text)
  from public, anon, service_role;
grant execute on function public.admit_platform_founder_clinic(uuid, text) to authenticated;


create or replace function public.close_platform_founder_campaign()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_campaign private.billing_commercial_campaigns;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  v_campaign := private.billing_founder_campaign();
  update private.billing_commercial_campaigns
     set status = 'closed', updated_at = clock_timestamp()
   where id = v_campaign.id;
  insert into private.billing_commercial_governance_events (
    actor_id, actor_authority, action, payload
  ) values (v_me, 'platform_admin', 'founder_campaign_close', '{}'::jsonb);
  return jsonb_build_object('status', 'closed');
end;
$$;

revoke all on function public.close_platform_founder_campaign()
  from public, anon, service_role;
grant execute on function public.close_platform_founder_campaign() to authenticated;


create or replace function public.mark_platform_founder_clinic_cancelled(p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_campaign private.billing_commercial_campaigns;
  v_next text;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  v_campaign := private.billing_founder_campaign();
  v_next := case when v_campaign.status = 'open' then 'returnable' else 'historical_only' end;
  update private.billing_founder_admissions
     set benefit_status = v_next,
         cancelled_at = coalesce(cancelled_at, clock_timestamp()),
         ineligible_after_close_at = case
           when v_next = 'historical_only' then coalesce(ineligible_after_close_at, clock_timestamp())
           else ineligible_after_close_at
         end
   where clinic_id = p_clinic_id;
  update private.billing_commercial_contracts
     set status = 'cancelled',
         effective_until = coalesce(effective_until, clock_timestamp()),
         updated_at = clock_timestamp()
   where clinic_id = p_clinic_id
     and status = 'active';
  insert into private.billing_commercial_governance_events (
    actor_id, actor_authority, action, clinic_id, payload
  ) values (v_me, 'platform_admin', 'founder_cancel', p_clinic_id, jsonb_build_object('next', v_next));
  return jsonb_build_object('benefit_status', v_next);
end;
$$;

revoke all on function public.mark_platform_founder_clinic_cancelled(uuid)
  from public, anon, service_role;
grant execute on function public.mark_platform_founder_clinic_cancelled(uuid) to authenticated;


create or replace function public.restore_platform_founder_clinic_eligibility(p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_campaign private.billing_commercial_campaigns;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  v_campaign := private.billing_founder_campaign();
  if v_campaign.status is distinct from 'open' then
    update private.billing_founder_admissions
       set benefit_status = 'historical_only',
           ineligible_after_close_at = coalesce(ineligible_after_close_at, clock_timestamp())
     where clinic_id = p_clinic_id
       and benefit_status = 'returnable';
    raise exception 'BILLING_FOUNDER_RETURN_AFTER_CLOSE'
      using errcode = '22023', hint = 'BILLING_FOUNDER_RETURN_AFTER_CLOSE';
  end if;
  if not exists (
    select 1 from private.billing_founder_admissions a
     where a.clinic_id = p_clinic_id
  ) then
    raise exception 'BILLING_FOUNDER_ADMISSION_MISSING'
      using errcode = 'P0002', hint = 'BILLING_FOUNDER_ADMISSION_MISSING';
  end if;
  update private.billing_founder_admissions
     set benefit_status = 'eligible',
         returned_at = clock_timestamp()
   where clinic_id = p_clinic_id
     and benefit_status = 'returnable';
  insert into private.billing_commercial_governance_events (
    actor_id, actor_authority, action, clinic_id, payload
  ) values (v_me, 'platform_admin', 'founder_return_open', p_clinic_id, '{}'::jsonb);
  return jsonb_build_object('benefit_status', 'eligible', 'same_slot', true);
end;
$$;

revoke all on function public.restore_platform_founder_clinic_eligibility(uuid)
  from public, anon, service_role;
grant execute on function public.restore_platform_founder_clinic_eligibility(uuid) to authenticated;


create or replace function public.set_platform_clinic_additional_capacity(
  p_clinic_id uuid,
  p_additional_professionals integer,
  p_additional_patients integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_contract uuid;
  v_code text;
  v_prof_price integer;
  v_pat_price integer;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  if coalesce(p_additional_professionals, -1) < 0 or coalesce(p_additional_patients, -1) < 0 then
    raise exception 'BILLING_CAPACITY_UNITS_INVALID'
      using errcode = '22023', hint = 'BILLING_CAPACITY_UNITS_INVALID';
  end if;
  select cc.id, p.code, cur.additional_professional_price_cents, cur.additional_patient_price_cents
    into v_contract, v_code, v_prof_price, v_pat_price
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
    join private.billing_plan_versions cur
      on cur.plan_id = p.id
     and cur.version = (select max(x.version) from private.billing_plan_versions x where x.plan_id = p.id)
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;
  if v_contract is null then
    raise exception 'BILLING_ACTIVE_CONTRACT_REQUIRED'
      using errcode = 'P0002', hint = 'BILLING_ACTIVE_CONTRACT_REQUIRED';
  end if;
  if (p_additional_professionals > 0 and v_prof_price is null)
     or (p_additional_patients > 0 and v_pat_price is null) then
    raise exception 'BILLING_PULSE_NO_ADDON'
      using errcode = '22023', hint = 'BILLING_PULSE_NO_ADDON';
  end if;
  insert into private.billing_contract_capacity_units (
    commercial_contract_id, additional_professional_units, additional_patient_units, updated_by
  ) values (v_contract, p_additional_professionals, p_additional_patients, v_me)
  on conflict (commercial_contract_id) do update
    set additional_professional_units = excluded.additional_professional_units,
        additional_patient_units = excluded.additional_patient_units,
        updated_at = clock_timestamp(),
        updated_by = excluded.updated_by;
  insert into private.billing_commercial_governance_events (
    actor_id, actor_authority, action, clinic_id, payload
  ) values (
    v_me, 'platform_admin', 'set_additional_capacity', p_clinic_id,
    jsonb_build_object('professionals', p_additional_professionals, 'patients', p_additional_patients)
  );
  return private.billing_resolve_commercial_price(p_clinic_id, clock_timestamp());
end;
$$;

revoke all on function public.set_platform_clinic_additional_capacity(uuid, integer, integer)
  from public, anon, service_role;
grant execute on function public.set_platform_clinic_additional_capacity(uuid, integer, integer)
  to authenticated;


create or replace function public.get_my_clinic_commercial_usage(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_price jsonb;
  v_cap jsonb;
  v_adm record;
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;
  v_price := private.billing_resolve_commercial_price(p_clinic_id, clock_timestamp());
  v_cap := private.billing_commercial_capacity(p_clinic_id);
  select a.slot_number, a.benefit_status, a.lock_until, a.lifetime_discount_bps,
         a.initial_founder_price_cents, a.cancelled_at
    into v_adm
    from private.billing_founder_admissions a
   where a.clinic_id = p_clinic_id
   limit 1;
  return jsonb_build_object(
    'capacity', v_cap,
    'price', v_price,
    'founder', case
      when v_adm.slot_number is null then null
      else jsonb_build_object(
        'badge', v_adm.benefit_status = 'eligible',
        'benefit_status', v_adm.benefit_status,
        'slot_number', v_adm.slot_number,
        'lock_until', v_adm.lock_until,
        'lifetime_discount_bps', v_adm.lifetime_discount_bps,
        'initial_founder_price_cents', v_adm.initial_founder_price_cents,
        'historical', true
      )
    end,
    'entitlement_enforcement', 'OFF',
    'projection_not_charge', true
  );
end;
$$;

revoke all on function public.get_my_clinic_commercial_usage(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_clinic_commercial_usage(uuid) to authenticated;


create or replace function private.billing_commercial_report_metrics()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_campaign private.billing_commercial_campaigns;
  v_used integer := 0;
  v_eligible integer := 0;
  v_historical integer := 0;
  v_by_plan jsonb := '{}'::jsonb;
  v_table bigint := 0;
  v_projected bigint := 0;
  v_discount bigint := 0;
  v_add_prof integer := 0;
  v_add_pat integer := 0;
  v_add_rev bigint := 0;
  v_used_prof integer := 0;
  v_allowed_prof integer := 0;
  v_used_pat integer := 0;
  v_allowed_pat integer := 0;
begin
  v_campaign := private.billing_founder_campaign();
  select count(*)::integer into v_used
    from private.billing_founder_admissions a
   where a.campaign_id = v_campaign.id;
  select count(*)::integer into v_eligible
    from private.billing_founder_admissions a
   where a.campaign_id = v_campaign.id
     and a.benefit_status = 'eligible';
  select count(*)::integer into v_historical
    from private.billing_founder_admissions a
   where a.campaign_id = v_campaign.id
     and a.benefit_status is distinct from 'eligible';
  select coalesce(jsonb_object_agg(plan_code, cnt), '{}'::jsonb)
    into v_by_plan
    from (
      select a.initial_plan_code as plan_code, count(*)::integer as cnt
        from private.billing_founder_admissions a
       where a.campaign_id = v_campaign.id
         and a.benefit_status = 'eligible'
       group by a.initial_plan_code
    ) p;

  select
    coalesce(sum((x.price->>'table_price_cents')::bigint), 0),
    coalesce(sum((x.price->>'final_projected_cents')::bigint), 0),
    coalesce(sum((x.price->>'founder_adjustment_cents')::bigint), 0),
    coalesce(sum((x.price->>'additional_capacity_cents')::bigint), 0),
    coalesce(sum((x.price->>'additional_professional_units')::integer), 0),
    coalesce(sum((x.price->>'additional_patient_units')::integer), 0),
    coalesce(sum((x.cap->>'billable_professionals')::integer), 0),
    coalesce(sum((x.cap->>'allowed_professionals')::integer), 0),
    coalesce(sum((x.cap->>'active_patients')::integer), 0),
    coalesce(sum((x.cap->>'allowed_patients')::integer), 0)
    into v_table, v_projected, v_discount, v_add_rev, v_add_prof, v_add_pat,
         v_used_prof, v_allowed_prof, v_used_pat, v_allowed_pat
    from (
      select
        private.billing_resolve_commercial_price(cc.clinic_id, clock_timestamp()) as price,
        private.billing_commercial_capacity(cc.clinic_id) as cap
        from private.billing_commercial_contracts cc
       where cc.status = 'active'
    ) x;

  return jsonb_build_object(
    'founder_campaign_status', coalesce(v_campaign.status, 'missing'),
    'founder_admissions_used', v_used,
    'founder_admissions_remaining', greatest(coalesce(v_campaign.max_admissions, 50) - v_used, 0),
    'founder_active', v_eligible,
    'founder_historical', v_historical,
    'founder_clinics_by_plan', coalesce(v_by_plan, '{}'::jsonb),
    'standard_projected_base_cents', v_table,
    'founder_projected_base_cents', v_projected - v_add_rev,
    'projected_commercial_discount_cents', v_discount,
    'additional_professional_units', v_add_prof,
    'additional_patient_units', v_add_pat,
    'projected_additional_revenue_cents', v_add_rev,
    'professional_capacity_used', v_used_prof,
    'professional_capacity_allowed', v_allowed_prof,
    'patient_capacity_used', v_used_pat,
    'patient_capacity_allowed', v_allowed_pat,
    'projection_not_received', true
  );
end;
$$;


create or replace function public.get_platform_commercial_governance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_metrics jsonb;
  v_clinics jsonb;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  v_metrics := private.billing_commercial_report_metrics();
  select coalesce(jsonb_agg(row_obj order by slot_number), '[]'::jsonb)
    into v_clinics
    from (
      select jsonb_build_object(
        'clinic_id', a.clinic_id,
        'clinic_name', c.name,
        'slot_number', a.slot_number,
        'benefit_status', a.benefit_status,
        'plan_code', a.initial_plan_code,
        'lock_until', a.lock_until,
        'lifetime_discount_bps', a.lifetime_discount_bps,
        'cancelled_at', a.cancelled_at
      ) as row_obj,
      a.slot_number
      from private.billing_founder_admissions a
      join public.clinics c on c.id = a.clinic_id
    ) rows;
  return v_metrics || jsonb_build_object('admissions', coalesce(v_clinics, '[]'::jsonb));
end;
$$;

revoke all on function public.get_platform_commercial_governance()
  from public, anon, service_role;
grant execute on function public.get_platform_commercial_governance() to authenticated;


create or replace function public.get_platform_clinic_commercial_detail(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  return jsonb_build_object(
    'price', private.billing_resolve_commercial_price(p_clinic_id, clock_timestamp()),
    'capacity', private.billing_commercial_capacity(p_clinic_id)
  );
end;
$$;

revoke all on function public.get_platform_clinic_commercial_detail(uuid)
  from public, anon, service_role;
grant execute on function public.get_platform_clinic_commercial_detail(uuid) to authenticated;


-- Clinic Admin contract create: server attaches Founder offer only when currently eligible.
create or replace function public.create_my_clinic_commercial_contract(
  p_clinic_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_existing_id uuid;
  v_existing_version uuid;
  v_created_id uuid;
  v_offer uuid := null;
  v_campaign private.billing_commercial_campaigns;
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if p_plan_version_id is null then
    raise exception 'BILLING_PLAN_VERSION_REQUIRED'
      using errcode = '22023', hint = 'BILLING_PLAN_VERSION_REQUIRED';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;
  if not private.billing_customer_identity_complete(p_clinic_id) then
    raise exception 'BILLING_IDENTITY_INCOMPLETE'
      using errcode = '22023', hint = 'BILLING_IDENTITY_INCOMPLETE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90301, pg_catalog.hashtext(p_clinic_id::text));

  select cc.id, cc.plan_version_id
    into v_existing_id, v_existing_version
    from private.billing_commercial_contracts cc
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;

  if v_existing_id is not null then
    if v_existing_version is not distinct from p_plan_version_id then
      perform public.ensure_my_clinic_billing_account(p_clinic_id);
      return private.billing_clinic_checkout_snapshot(p_clinic_id);
    end if;
    raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS'
      using errcode = '23505', hint = 'BILLING_ACTIVE_CONTRACT_EXISTS';
  end if;

  if private.billing_founder_is_currently_eligible(p_clinic_id) then
    v_campaign := private.billing_founder_campaign();
    v_offer := v_campaign.offer_id;
  end if;

  begin
    v_created_id := private.billing_create_commercial_contract(
      p_clinic_id,
      p_plan_version_id,
      v_offer,
      null,
      null
    );
  exception
    when unique_violation then
      select cc.id, cc.plan_version_id
        into v_existing_id, v_existing_version
        from private.billing_commercial_contracts cc
       where cc.clinic_id = p_clinic_id
         and cc.status = 'active'
       limit 1;
      if v_existing_version is not distinct from p_plan_version_id then
        perform public.ensure_my_clinic_billing_account(p_clinic_id);
        return private.billing_clinic_checkout_snapshot(p_clinic_id);
      end if;
      raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS'
        using errcode = '23505', hint = 'BILLING_ACTIVE_CONTRACT_EXISTS';
  end;

  if v_created_id is null then
    raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS'
      using errcode = '23505', hint = 'BILLING_ACTIVE_CONTRACT_EXISTS';
  end if;

  perform public.ensure_my_clinic_billing_account(p_clinic_id);
  return private.billing_clinic_checkout_snapshot(p_clinic_id);
end;
$$;

comment on function public.create_my_clinic_commercial_contract(uuid, uuid) is
  'WP-BP07: Clinic Admin contract. Server snapshots catalog or eligible Founder offer. '
  'No client price, slot, or discount.';


create or replace function public.get_platform_billing_report(
  p_period_start date default null,
  p_period_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.billing_hub_business_date();
  v_start date;
  v_end date;
  v_received bigint := 0;
  v_pending bigint := 0;
  v_overdue bigint := 0;
  v_received_count integer := 0;
  v_pending_count integer := 0;
  v_overdue_count integer := 0;
  v_delinquent integer := 0;
  v_active_pix integer := 0;
  v_by_plan jsonb := '[]'::jsonb;
  v_by_status jsonb := '[]'::jsonb;
  v_delinquent_items jsonb := '[]'::jsonb;
begin
  perform private.assert_platform_billing_reader();

  select r.period_start, r.period_end
    into v_start, v_end
    from private.platform_billing_resolve_report_period(p_period_start, p_period_end) r;

  select
    coalesce(sum(f.amount_cents) filter (
      where f.financial_state = 'received'
        and f.payment_date between v_start and v_end
    ), 0),
    count(*) filter (
      where f.financial_state = 'received'
        and f.payment_date between v_start and v_end
    )
    into v_received, v_received_count
    from private.platform_billing_payment_plan_facts() f;

  select
    coalesce(sum(u.amount_cents) filter (
      where u.display_state in ('PROGRAMMED', 'PENDING')
        and u.due_date between v_start and v_end
    ), 0),
    count(*) filter (
      where u.display_state in ('PROGRAMMED', 'PENDING')
        and u.due_date between v_start and v_end
    ),
    coalesce(sum(u.amount_cents) filter (
      where u.display_state = 'OVERDUE'
        and u.due_date between v_start and v_end
    ), 0),
    count(*) filter (
      where u.display_state = 'OVERDUE'
        and u.due_date between v_start and v_end
    )
    into v_pending, v_pending_count, v_overdue, v_overdue_count
    from private.platform_billing_charge_universe() u;

  select count(*) filter (where f.financial_summary = 'overdue')
    into v_delinquent
    from private.platform_billing_clinic_facts() f;

  select count(*)::integer
    into v_active_pix
    from private.billing_pix_automatic_authorizations auth
   where auth.is_primary
     and auth.provider_status = 'ACTIVE';

  select coalesce(jsonb_agg(row_obj order by received_cents desc, plan_label), '[]'::jsonb)
    into v_by_plan
    from (
      select
        jsonb_build_object(
          'plan_code', f.plan_code,
          'plan_display_name', f.plan_display_name,
          'plan_attribution', f.plan_attribution,
          'received_cents', sum(f.amount_cents),
          'payment_count', count(*)
        ) as row_obj,
        sum(f.amount_cents) as received_cents,
        coalesce(f.plan_code, 'unattributed') as plan_label
      from private.platform_billing_payment_plan_facts() f
      where f.financial_state = 'received'
        and f.payment_date between v_start and v_end
      group by f.plan_code, f.plan_display_name, f.plan_attribution
    ) plan_rows;

  select coalesce(jsonb_agg(row_obj order by status), '[]'::jsonb)
    into v_by_status
    from (
      select
        jsonb_build_object(
          'status', f.financial_state,
          'payment_count', count(*),
          'amount_cents', sum(f.amount_cents)
        ) as row_obj,
        f.financial_state as status
      from private.platform_billing_payment_plan_facts() f
      where (
          f.payment_date between v_start and v_end
          or (f.payment_date is null and f.due_date between v_start and v_end)
        )
      group by f.financial_state
    ) status_rows;

  select coalesce(
      jsonb_agg(row_obj order by overdue_cents desc, clinic_name)
        filter (where overdue_count > 0),
      '[]'::jsonb
    )
    into v_delinquent_items
    from (
      select
        jsonb_build_object(
          'clinic_id', f.clinic_id,
          'clinic_name', f.clinic_name,
          'overdue_count', f.overdue_count,
          'overdue_cents', f.overdue_cents,
          'aging_bucket', f.aging_bucket,
          'pix_status', f.pix_status
        ) as row_obj,
        f.overdue_count,
        f.overdue_cents,
        f.clinic_name
      from private.platform_billing_clinic_facts() f
      order by f.overdue_cents desc, f.clinic_name
      limit 50
    ) delinq;

  return jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'period_start', v_start,
    'period_end', v_end,
    'as_of', v_today,
    'not_mrr', true,
    'entitlement_enforcement', 'OFF',
    'received_in_period_cents', coalesce(v_received, 0),
    'received_in_period_count', coalesce(v_received_count, 0),
    'pending_in_period_cents', coalesce(v_pending, 0),
    'pending_in_period_count', coalesce(v_pending_count, 0),
    'overdue_in_period_cents', coalesce(v_overdue, 0),
    'overdue_in_period_count', coalesce(v_overdue_count, 0),
    'received_by_plan', coalesce(v_by_plan, '[]'::jsonb),
    'payments_by_status', coalesce(v_by_status, '[]'::jsonb),
    'active_pix_automatic_authorizations', coalesce(v_active_pix, 0),
    'delinquent_clinics', coalesce(v_delinquent, 0),
    'delinquent_items', coalesce(v_delinquent_items, '[]'::jsonb),
    'export_max_rows', 500,
    'commercial', private.billing_commercial_report_metrics()
  );
end;
$$;

comment on function public.get_platform_billing_report(date, date) is
  'WP-BP07: financial period report plus commercial projection metrics. Projection != received.';

revoke all on function public.get_platform_billing_report(date, date)
  from public, anon, service_role;
grant execute on function public.get_platform_billing_report(date, date) to authenticated;


create or replace function public.list_platform_commercial_plan_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_plans jsonb;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  select coalesce(jsonb_agg(row_obj order by code), '[]'::jsonb)
    into v_plans
    from (
      select jsonb_build_object(
        'code', p.code,
        'display_name', p.display_name,
        'table_price_cents', pv.standard_price_cents,
        'founder_price_cents', opp.price_cents,
        'included_professionals', pv.max_professionals,
        'included_patients', pv.max_active_patients,
        'additional_professional_price_cents', pv.additional_professional_price_cents,
        'additional_patient_price_cents', pv.additional_patient_price_cents
      ) as row_obj,
      p.code
      from private.billing_plans p
      join private.billing_plan_versions pv
        on pv.plan_id = p.id
       and pv.version = (
         select max(x.version) from private.billing_plan_versions x where x.plan_id = p.id
       )
      join private.billing_commercial_campaigns c on c.kind = 'founder'
      left join private.billing_offer_plan_prices opp
        on opp.offer_id = c.offer_id
       and opp.plan_version_id = pv.id
     where p.status = 'active'
    ) rows;
  return jsonb_build_object('plans', coalesce(v_plans, '[]'::jsonb));
end;
$$;

revoke all on function public.list_platform_commercial_plan_options()
  from public, anon, service_role;
grant execute on function public.list_platform_commercial_plan_options() to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260920230000',
  '20260920230000_wp_billing_product_07_founder_commercial_governance.sql',
  'WP-BILLING-PRODUCT-07: Founder admissions, capacity governance, commercial projection. Local only.',
  'WP-BILLING-PRODUCT-07'
)
on conflict (version) do nothing;
