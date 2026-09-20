-- =====================================================================================
-- WP-BILLING-PRODUCT-06 — Platform Billing reports + CSV source + BP05 hardening.
--
-- LOCAL ONLY in this WP. Tracked filename timestamp is canonical.
-- Future remote apply must use Supabase CLI and keep 20260920220000 exactly.
-- No new financial tables. No provider HTTP. No entitlement grant. No QA mutation.
-- =====================================================================================


-- ── Period contract ───────────────────────────────────────────────────────────

create or replace function private.platform_billing_resolve_report_period(
  p_start date,
  p_end date
)
returns table (
  period_start date,
  period_end date
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := private.billing_hub_business_date();
  v_start date;
  v_end date;
begin
  if p_start is null and p_end is null then
    v_start := date_trunc('month', v_today::timestamp)::date;
    v_end := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;
  elsif p_start is null or p_end is null then
    raise exception 'BILLING_REPORT_PERIOD_INVALID'
      using errcode = '22023', hint = 'BILLING_REPORT_PERIOD_INVALID';
  elsif p_start > p_end then
    raise exception 'BILLING_REPORT_PERIOD_INVALID'
      using errcode = '22023', hint = 'BILLING_REPORT_PERIOD_INVALID';
  elsif (p_end - p_start) > 366 then
    raise exception 'BILLING_REPORT_PERIOD_TOO_LONG'
      using errcode = '22023', hint = 'BILLING_REPORT_PERIOD_TOO_LONG';
  else
    v_start := p_start;
    v_end := p_end;
  end if;

  return query select v_start, v_end;
end;
$$;

comment on function private.platform_billing_resolve_report_period(date, date) is
  'WP-BILLING-PRODUCT-06: America/Sao_Paulo civil dates. Default = current month. Max 366 days. No unbounded history.';

revoke all on function private.platform_billing_resolve_report_period(date, date)
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_clamp_export_limit(p_limit integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_limit is null or p_limit < 1 then 200
    when p_limit > 500 then 500
    else p_limit
  end;
$$;

comment on function private.platform_billing_clamp_export_limit(integer) is
  'WP-BILLING-PRODUCT-06: CSV/export page size. Default 200, hard max 500.';

revoke all on function private.platform_billing_clamp_export_limit(integer)
  from public, anon, authenticated, service_role;


-- Historical plan from the contract attached to the payment fact — never "current plan".
create or replace function private.platform_billing_payment_plan_facts()
returns table (
  payment_id uuid,
  clinic_id uuid,
  clinic_name text,
  amount_cents integer,
  currency text,
  financial_state text,
  due_date date,
  payment_date date,
  billing_type text,
  method text,
  plan_code text,
  plan_display_name text,
  plan_attribution text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id as payment_id,
    a.clinic_id,
    c.name as clinic_name,
    p.value_cents::integer as amount_cents,
    'BRL'::text as currency,
    p.financial_state,
    p.due_date,
    p.payment_date,
    p.billing_type,
    private.billing_hub_payment_method(p.billing_type) as method,
    pl.code as plan_code,
    pl.display_name as plan_display_name,
    case
      when cc.id is not null then 'contract'
      else 'unattributed'
    end as plan_attribution
  from private.billing_payments p
  join private.billing_accounts a on a.id = p.billing_account_id
  join public.clinics c on c.id = a.clinic_id
  left join private.billing_pix_automatic_authorizations auth
    on auth.id = p.pix_authorization_id
  left join private.billing_subscriptions sub
    on sub.id = p.billing_subscription_id
  left join private.billing_commercial_contracts cc
    on cc.id = coalesce(auth.commercial_contract_id, sub.commercial_contract_id)
  left join private.billing_plan_versions pv on pv.id = cc.plan_version_id
  left join private.billing_plans pl on pl.id = pv.plan_id
  where a.clinic_id is not null
    and p.financial_state not in ('voided', 'unknown');
$$;

comment on function private.platform_billing_payment_plan_facts() is
  'WP-BILLING-PRODUCT-06: payment → historical contract/plan. Unattributed when no contract bind.';

revoke all on function private.platform_billing_payment_plan_facts()
  from public, anon, authenticated, service_role;


-- ── BP05 clinic facts hardening ───────────────────────────────────────────────
-- 1) identity completeness is one set scan, not per-clinic helper.
-- 2) charge universe is materialized once, then aggregated.

create or replace function private.platform_billing_clinic_facts()
returns setof private.platform_billing_clinic_facts
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select private.billing_hub_business_date() as d
  ),
  contract as (
    select distinct on (cc.clinic_id)
      cc.clinic_id,
      cc.status as contract_status,
      (timezone('America/Sao_Paulo', cc.effective_from))::date as contract_effective_from,
      p.code as plan_code,
      p.display_name as plan_display_name,
      cc.contracted_price_cents as plan_price_cents,
      cc.contracted_currency as plan_currency,
      cc.billing_cycle,
      cc.id as contract_id
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
    order by
      cc.clinic_id,
      case cc.status when 'active' then 0 when 'pending' then 1 else 2 end,
      cc.effective_from desc
  ),
  account as (
    select distinct on (a.clinic_id)
      a.clinic_id,
      a.external_customer_id is not null as customer_bound
    from private.billing_accounts a
    where a.clinic_id is not null
    order by a.clinic_id, a.created_at desc
  ),
  pix as (
    select distinct on (cc.clinic_id)
      cc.clinic_id,
      auth.provider_status as pix_status,
      auth.generation as pix_generation
    from private.billing_pix_automatic_authorizations auth
    join private.billing_commercial_contracts cc
      on cc.id = auth.commercial_contract_id
    where auth.is_primary
    order by cc.clinic_id, auth.generation desc
  ),
  identity as (
    select i.clinic_id
      from private.billing_customer_identities i
     where btrim(i.legal_name) <> ''
       and private.billing_tax_id_is_valid(i.tax_id)
       and private.billing_email_is_valid(i.email)
  ),
  charges as materialized (
    select * from private.platform_billing_charge_universe()
  ),
  charge_agg as (
    select
      u.clinic_id,
      count(*)::integer as charge_count,
      count(*) filter (where u.display_state = 'OVERDUE')::integer as overdue_count,
      coalesce(sum(u.amount_cents) filter (where u.display_state = 'OVERDUE'), 0)::bigint as overdue_cents,
      coalesce(sum(u.amount_cents) filter (where u.display_state in ('PROGRAMMED', 'PENDING')), 0)::bigint as pending_cents,
      count(*) filter (where u.display_state in ('PROGRAMMED', 'PENDING'))::integer as open_count,
      count(*) filter (where u.display_state = 'PAID')::integer as paid_count,
      min(u.due_date) filter (where u.display_state = 'OVERDUE') as oldest_overdue_due
    from charges u
    group by u.clinic_id
  ),
  next_charge as (
    select distinct on (u.clinic_id)
      u.clinic_id,
      u.due_date as next_charge_due,
      u.amount_cents as next_charge_cents,
      u.display_state as next_charge_state
    from charges u
    cross join today t
    where u.display_state in ('PROGRAMMED', 'PENDING')
      and u.due_date is not null
      and u.due_date >= t.d
    order by u.clinic_id, u.due_date asc, u.occurred_at asc, u.charge_id asc
  ),
  latest_pay as (
    select distinct on (a.clinic_id)
      a.clinic_id,
      private.billing_hub_payment_display_state(p.financial_state, p.due_date, t.d) as latest_payment_state,
      coalesce(p.payment_date, p.due_date) as latest_payment_date
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
    cross join today t
    where a.clinic_id is not null
      and p.financial_state not in ('voided', 'unknown')
    order by a.clinic_id, coalesce(p.payment_date, p.due_date, t.d) desc, p.created_at desc
  )
  select
    c.id as clinic_id,
    c.name as clinic_name,
    ct.plan_code,
    ct.plan_display_name,
    ct.plan_price_cents,
    ct.plan_currency,
    ct.billing_cycle,
    ct.contract_status,
    ct.contract_effective_from,
    (idn.clinic_id is not null) as identity_complete,
    coalesce(ac.customer_bound, false) as customer_bound,
    px.pix_status,
    px.pix_generation,
    case
      when ct.contract_id is null then 'no_plan'
      when coalesce(ca.overdue_count, 0) > 0 then 'overdue'
      when coalesce(ca.open_count, 0) > 0 then 'pending'
      when coalesce(ca.paid_count, 0) > 0 then 'current'
      else 'no_charges'
    end as financial_summary,
    coalesce(ca.overdue_count, 0) as overdue_count,
    coalesce(ca.overdue_cents, 0) as overdue_cents,
    coalesce(ca.pending_cents, 0) as pending_cents,
    coalesce(ca.charge_count, 0) as charge_count,
    nc.next_charge_due,
    nc.next_charge_cents,
    nc.next_charge_state,
    lp.latest_payment_state,
    lp.latest_payment_date,
    private.platform_billing_overdue_aging(ca.oldest_overdue_due, t.d) as aging_bucket,
    (
      coalesce(ca.overdue_count, 0) > 0
      or (ct.contract_id is not null and idn.clinic_id is null)
      or (ct.contract_id is not null and not coalesce(ac.customer_bound, false))
      or px.pix_status = 'REFUSED'
      or (ct.contract_status = 'active' and px.pix_status is null)
    ) as attention,
    case
      when coalesce(ca.overdue_count, 0) > 0 then 'overdue'
      when ct.contract_id is not null and idn.clinic_id is null then 'identity_incomplete'
      when ct.contract_id is not null and not coalesce(ac.customer_bound, false)
        then 'customer_unbound'
      when px.pix_status = 'REFUSED' then 'pix_refused'
      when ct.contract_status = 'active' and px.pix_status is null then 'pix_absent'
      else 'none'
    end as attention_reason,
    'OFF'::text as entitlement_enforcement,
    false as entitlement_granted
  from public.clinics c
  cross join today t
  left join contract ct on ct.clinic_id = c.id
  left join account ac on ac.clinic_id = c.id
  left join pix px on px.clinic_id = c.id
  left join identity idn on idn.clinic_id = c.id
  left join charge_agg ca on ca.clinic_id = c.id
  left join next_charge nc on nc.clinic_id = c.id
  left join latest_pay lp on lp.clinic_id = c.id;
$$;

comment on function private.platform_billing_clinic_facts() is
  'WP-BILLING-PRODUCT-06: set-based identity + materialized charge universe. Delinquency remains overdue charges only.';

revoke all on function private.platform_billing_clinic_facts()
  from public, anon, authenticated, service_role;


-- ── Report reads ──────────────────────────────────────────────────────────────

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
    'export_max_rows', 500
  );
end;
$$;

comment on function public.get_platform_billing_report(date, date) is
  'WP-BILLING-PRODUCT-06: Platform Admin period report. Received by payment_date; pending/overdue by due_date. Not MRR.';

revoke all on function public.get_platform_billing_report(date, date)
  from public, anon, service_role;
grant execute on function public.get_platform_billing_report(date, date) to authenticated;


create or replace function public.list_platform_billing_report_export(
  p_period_start date default null,
  p_period_end date default null,
  p_kind text default 'payments',
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
  v_limit integer := private.platform_billing_clamp_export_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_kind text := lower(coalesce(p_kind, 'payments'));
  v_items jsonb := '[]'::jsonb;
begin
  perform private.assert_platform_billing_reader();

  select r.period_start, r.period_end
    into v_start, v_end
    from private.platform_billing_resolve_report_period(p_period_start, p_period_end) r;

  if v_kind not in ('payments', 'delinquent', 'received_by_plan') then
    raise exception 'BILLING_REPORT_KIND_INVALID'
      using errcode = '22023', hint = 'BILLING_REPORT_KIND_INVALID';
  end if;

  if v_kind = 'payments' then
    select coalesce(jsonb_agg(row_obj order by sort_date desc, clinic_name, payment_id), '[]'::jsonb)
      into v_items
      from (
        select
          jsonb_build_object(
            'row_kind', 'payment',
            'clinic_name', f.clinic_name,
            'plan_code', f.plan_code,
            'plan_attribution', f.plan_attribution,
            'amount_cents', f.amount_cents,
            'currency', f.currency,
            'financial_state', f.financial_state,
            'due_date', f.due_date,
            'payment_date', f.payment_date,
            'method', f.method
          ) as row_obj,
          coalesce(f.payment_date, f.due_date) as sort_date,
          f.clinic_name,
          f.payment_id
        from private.platform_billing_payment_plan_facts() f
        where (
            f.payment_date between v_start and v_end
            or (f.payment_date is null and f.due_date between v_start and v_end)
          )
        order by coalesce(f.payment_date, f.due_date) desc, f.clinic_name, f.payment_id
        limit v_limit
        offset v_offset
      ) rows;
  elsif v_kind = 'delinquent' then
    select coalesce(jsonb_agg(row_obj order by overdue_cents desc, clinic_name), '[]'::jsonb)
      into v_items
      from (
        select
          jsonb_build_object(
            'row_kind', 'delinquent',
            'clinic_name', f.clinic_name,
            'plan_code', f.plan_code,
            'overdue_count', f.overdue_count,
            'overdue_cents', f.overdue_cents,
            'aging_bucket', f.aging_bucket,
            'pix_status', f.pix_status
          ) as row_obj,
          f.overdue_cents,
          f.clinic_name
        from private.platform_billing_clinic_facts() f
        where f.financial_summary = 'overdue'
        order by f.overdue_cents desc, f.clinic_name
        limit v_limit
        offset v_offset
      ) rows;
  else
    select coalesce(jsonb_agg(row_obj order by received_cents desc, plan_label), '[]'::jsonb)
      into v_items
      from (
        select
          jsonb_build_object(
            'row_kind', 'received_by_plan',
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
        order by sum(f.amount_cents) desc, coalesce(f.plan_code, 'unattributed')
        limit v_limit
        offset v_offset
      ) rows;
  end if;

  return jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'period_start', v_start,
    'period_end', v_end,
    'kind', v_kind,
    'limit', v_limit,
    'offset', v_offset,
    'max_limit', 500,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_report_export(date, date, text, integer, integer) is
  'WP-BILLING-PRODUCT-06: bounded CSV source. Max 500 rows. No tax id, QR, webhook, or provider payload.';

revoke all on function public.list_platform_billing_report_export(date, date, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_report_export(date, date, text, integer, integer) to authenticated;
