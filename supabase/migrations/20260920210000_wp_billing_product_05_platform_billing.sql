-- =====================================================================================
-- WP-BILLING-PRODUCT-05 — Platform Billing read model.
--
-- Cross-clinic operational views for Platform Admin only.
-- Reuses private BP04 derivation helpers. Does NOT call public.get_my_clinic_*.
-- Does NOT change assert_my_clinic_billing_reader.
-- No new financial tables. No provider HTTP. No entitlement grant. No QA mutation.
-- Not applied remotely in this WP.
-- =====================================================================================


create or replace function private.assert_platform_billing_reader()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_profile_id() is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
end;
$$;

comment on function private.assert_platform_billing_reader() is
  'WP-BILLING-PRODUCT-05: fail-closed Platform Admin only. Clinic membership is not a grant.';

revoke all on function private.assert_platform_billing_reader()
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_clamp_limit(p_limit integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_limit is null or p_limit < 1 then 50
    when p_limit > 50 then 50
    else p_limit
  end;
$$;

revoke all on function private.platform_billing_clamp_limit(integer)
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_clamp_offset(p_offset integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_offset is null or p_offset < 0 then 0
    else p_offset
  end;
$$;

revoke all on function private.platform_billing_clamp_offset(integer)
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_overdue_aging(
  p_due_date date,
  p_today date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_due_date is null or p_today is null or p_due_date >= p_today then null
    when (p_today - p_due_date) <= 7 then 'd1_7'
    when (p_today - p_due_date) <= 15 then 'd8_15'
    when (p_today - p_due_date) <= 30 then 'd16_30'
    else 'd31_plus'
  end;
$$;

comment on function private.platform_billing_overdue_aging(date, date) is
  'WP-BILLING-PRODUCT-05: overdue aging from civil dates. America/Sao_Paulo caller supplies today.';

revoke all on function private.platform_billing_overdue_aging(date, date)
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_charge_universe()
returns table (
  clinic_id uuid,
  charge_id uuid,
  source text,
  amount_cents integer,
  currency text,
  due_date date,
  paid_date date,
  display_state text,
  method text,
  occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select private.billing_hub_business_date() as d
  ),
  pay as (
    select
      a.clinic_id,
      p.id as charge_id,
      'payment'::text as source,
      p.value_cents::integer as amount_cents,
      'BRL'::text as currency,
      p.due_date,
      p.payment_date as paid_date,
      private.billing_hub_charge_state_from_payment(p.financial_state, p.due_date, t.d) as display_state,
      private.billing_hub_payment_method(p.billing_type) as method,
      p.created_at as occurred_at
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
    cross join today t
    where a.clinic_id is not null
      and p.financial_state not in ('voided', 'unknown')
  ),
  instr as (
    select
      cc.clinic_id,
      i.id as charge_id,
      'instruction'::text as source,
      cc.contracted_price_cents as amount_cents,
      cc.contracted_currency as currency,
      i.due_date,
      null::date as paid_date,
      'PROGRAMMED'::text as display_state,
      'PIX'::text as method,
      i.created_at as occurred_at
    from private.billing_pix_automatic_payment_instructions i
    join private.billing_pix_automatic_authorizations auth
      on auth.id = i.pix_authorization_id
    join private.billing_commercial_contracts cc
      on cc.id = auth.commercial_contract_id
    where i.status in ('AWAITING_REQUEST', 'SCHEDULED')
      and not exists (
        select 1
          from private.billing_payments p
         where p.pix_instruction_id = i.id
           and p.financial_state not in ('voided', 'unknown')
      )
  )
  select pay.clinic_id, pay.charge_id, pay.source, pay.amount_cents, pay.currency,
         pay.due_date, pay.paid_date, pay.display_state, pay.method, pay.occurred_at
    from pay
  union all
  select instr.clinic_id, instr.charge_id, instr.source, instr.amount_cents, instr.currency,
         instr.due_date, instr.paid_date, instr.display_state, instr.method, instr.occurred_at
    from instr;
$$;

comment on function private.platform_billing_charge_universe() is
  'WP-BILLING-PRODUCT-05: set-based charge projection for all clinics. Same facts as BP04.';

revoke all on function private.platform_billing_charge_universe()
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_clinic_facts()
returns table (
  clinic_id uuid,
  clinic_name text,
  plan_code text,
  plan_display_name text,
  plan_price_cents integer,
  plan_currency text,
  billing_cycle text,
  contract_status text,
  contract_effective_from date,
  identity_complete boolean,
  customer_bound boolean,
  pix_status text,
  pix_generation integer,
  financial_summary text,
  overdue_count integer,
  overdue_cents bigint,
  pending_cents bigint,
  charge_count integer,
  next_charge_due date,
  next_charge_cents integer,
  next_charge_state text,
  latest_payment_state text,
  latest_payment_date date,
  aging_bucket text,
  attention boolean,
  attention_reason text,
  entitlement_enforcement text,
  entitlement_granted boolean
)
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
    from private.platform_billing_charge_universe() u
    group by u.clinic_id
  ),
  next_charge as (
    select distinct on (u.clinic_id)
      u.clinic_id,
      u.due_date as next_charge_due,
      u.amount_cents as next_charge_cents,
      u.display_state as next_charge_state
    from private.platform_billing_charge_universe() u
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
    private.billing_customer_identity_complete(c.id) as identity_complete,
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
      or (ct.contract_id is not null and not private.billing_customer_identity_complete(c.id))
      or (ct.contract_id is not null and not coalesce(ac.customer_bound, false))
      or px.pix_status = 'REFUSED'
      or (ct.contract_status = 'active' and px.pix_status is null)
    ) as attention,
    case
      when coalesce(ca.overdue_count, 0) > 0 then 'overdue'
      when ct.contract_id is not null and not private.billing_customer_identity_complete(c.id)
        then 'identity_incomplete'
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
  left join charge_agg ca on ca.clinic_id = c.id
  left join next_charge nc on nc.clinic_id = c.id
  left join latest_pay lp on lp.clinic_id = c.id;
$$;

comment on function private.platform_billing_clinic_facts() is
  'WP-BILLING-PRODUCT-05: one row per clinic. Financial delinquency is overdue charges only.';

revoke all on function private.platform_billing_clinic_facts()
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_clinic_json(p_row private.platform_billing_clinic_facts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'clinic_id', p_row.clinic_id,
    'clinic_name', p_row.clinic_name,
    'plan_code', p_row.plan_code,
    'plan_display_name', p_row.plan_display_name,
    'plan_price_cents', p_row.plan_price_cents,
    'plan_currency', coalesce(p_row.plan_currency, 'BRL'),
    'billing_cycle', p_row.billing_cycle,
    'contract_status', p_row.contract_status,
    'contract_effective_from', p_row.contract_effective_from,
    'identity_complete', p_row.identity_complete,
    'customer_bound', p_row.customer_bound,
    'pix_status', p_row.pix_status,
    'pix_generation', p_row.pix_generation,
    'financial_summary', p_row.financial_summary,
    'overdue_count', p_row.overdue_count,
    'overdue_cents', case when p_row.overdue_count > 0 then p_row.overdue_cents else null end,
    'pending_cents', case when p_row.pending_cents > 0 then p_row.pending_cents else null end,
    'charge_count', p_row.charge_count,
    'next_charge', case
      when p_row.next_charge_due is null then null
      else jsonb_build_object(
        'due_date', p_row.next_charge_due,
        'amount_cents', p_row.next_charge_cents,
        'display_state', p_row.next_charge_state
      )
    end,
    'latest_payment_state', p_row.latest_payment_state,
    'latest_payment_date', p_row.latest_payment_date,
    'aging_bucket', p_row.aging_bucket,
    'attention', p_row.attention,
    'attention_reason', p_row.attention_reason,
    'entitlement_enforcement', 'OFF',
    'entitlement_granted', false
  );
$$;

revoke all on function private.platform_billing_clinic_json(private.platform_billing_clinic_facts)
  from public, anon, authenticated, service_role;


create or replace function public.get_platform_billing_overview()
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
  v_delinquent integer := 0;
  v_attention integer := 0;
  v_c17 integer := 0;
  v_c815 integer := 0;
  v_c1630 integer := 0;
  v_c31 integer := 0;
  v_a17 bigint := 0;
  v_a815 bigint := 0;
  v_a1630 bigint := 0;
  v_a31 bigint := 0;
  v_aging jsonb;
begin
  perform private.assert_platform_billing_reader();
  v_start := date_trunc('month', v_today::timestamp)::date;
  v_end := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;

  select
    count(*) filter (where f.financial_summary = 'overdue'),
    count(*) filter (where f.attention),
    count(*) filter (where f.aging_bucket = 'd1_7'),
    count(*) filter (where f.aging_bucket = 'd8_15'),
    count(*) filter (where f.aging_bucket = 'd16_30'),
    count(*) filter (where f.aging_bucket = 'd31_plus')
    into v_delinquent, v_attention, v_c17, v_c815, v_c1630, v_c31
    from private.platform_billing_clinic_facts() f;

  select
    coalesce(sum(u.amount_cents) filter (
      where private.platform_billing_overdue_aging(u.due_date, v_today) = 'd1_7'
    ), 0),
    coalesce(sum(u.amount_cents) filter (
      where private.platform_billing_overdue_aging(u.due_date, v_today) = 'd8_15'
    ), 0),
    coalesce(sum(u.amount_cents) filter (
      where private.platform_billing_overdue_aging(u.due_date, v_today) = 'd16_30'
    ), 0),
    coalesce(sum(u.amount_cents) filter (
      where private.platform_billing_overdue_aging(u.due_date, v_today) = 'd31_plus'
    ), 0)
    into v_a17, v_a815, v_a1630, v_a31
    from private.platform_billing_charge_universe() u
   where u.display_state = 'OVERDUE';

  v_aging := jsonb_build_object(
    'd1_7', jsonb_build_object('clinic_count', v_c17, 'amount_cents', v_a17),
    'd8_15', jsonb_build_object('clinic_count', v_c815, 'amount_cents', v_a815),
    'd16_30', jsonb_build_object('clinic_count', v_c1630, 'amount_cents', v_a1630),
    'd31_plus', jsonb_build_object('clinic_count', v_c31, 'amount_cents', v_a31)
  );

  return jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'period_start', v_start,
    'period_end', v_end,
    'received_in_period_cents', coalesce((
      select sum(p.value_cents)::bigint
        from private.billing_payments p
        join private.billing_accounts a on a.id = p.billing_account_id
       where a.clinic_id is not null
         and p.financial_state = 'received'
         and p.payment_date is not null
         and p.payment_date between v_start and v_end
    ), 0),
    'pending_amount_cents', coalesce((
      select sum(u.amount_cents)::bigint
        from private.platform_billing_charge_universe() u
       where u.display_state in ('PROGRAMMED', 'PENDING')
    ), 0),
    'overdue_amount_cents', coalesce((
      select sum(u.amount_cents)::bigint
        from private.platform_billing_charge_universe() u
       where u.display_state = 'OVERDUE'
    ), 0),
    'clinics_with_received', coalesce((
      select count(distinct a.clinic_id)::integer
        from private.billing_payments p
        join private.billing_accounts a on a.id = p.billing_account_id
       where a.clinic_id is not null
         and p.financial_state = 'received'
         and p.payment_date is not null
         and p.payment_date between v_start and v_end
    ), 0),
    'delinquent_clinics', coalesce(v_delinquent, 0),
    'active_commercial_contracts', coalesce((
      select count(*)::integer
        from private.billing_commercial_contracts cc
       where cc.status = 'active'
    ), 0),
    'active_pix_automatic_authorizations', coalesce((
      select count(*)::integer
        from private.billing_pix_automatic_authorizations auth
       where auth.is_primary
         and auth.provider_status = 'ACTIVE'
    ), 0),
    'payment_success_count', coalesce((
      select count(*)::integer
        from private.billing_payments p
        join private.billing_accounts a on a.id = p.billing_account_id
       where a.clinic_id is not null
         and p.financial_state = 'received'
         and p.payment_date is not null
         and p.payment_date between v_start and v_end
    ), 0),
    'attention_clinic_count', coalesce(v_attention, 0),
    'aging', coalesce(v_aging, '{}'::jsonb),
    'entitlement_enforcement', 'OFF'
  );
end;
$$;

comment on function public.get_platform_billing_overview() is
  'WP-BILLING-PRODUCT-05: Platform Admin month overview. No MRR label. America/Sao_Paulo.';

revoke all on function public.get_platform_billing_overview()
  from public, anon, service_role;
grant execute on function public.get_platform_billing_overview() to authenticated;


create or replace function public.list_platform_billing_clinics(
  p_clinic_query text default null,
  p_plan_code text default null,
  p_contract_status text default null,
  p_pix_status text default null,
  p_financial_status text default null,
  p_needs_attention boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.platform_billing_clamp_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_query text := nullif(btrim(coalesce(p_clinic_query, '')), '');
  v_plan text := nullif(btrim(coalesce(p_plan_code, '')), '');
  v_contract text := nullif(btrim(coalesce(p_contract_status, '')), '');
  v_pix text := nullif(btrim(coalesce(p_pix_status, '')), '');
  v_fin text := nullif(btrim(coalesce(p_financial_status, '')), '');
begin
  perform private.assert_platform_billing_reader();

  return jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(private.platform_billing_clinic_json(x) order by
        x.attention desc,
        x.overdue_cents desc,
        x.clinic_name asc,
        x.clinic_id asc
      )
      from (
        select f.*
          from private.platform_billing_clinic_facts() f
         where (v_query is null
                or f.clinic_name ilike '%' || v_query || '%'
                or f.clinic_id::text = v_query)
           and (v_plan is null or f.plan_code = v_plan)
           and (v_contract is null or f.contract_status = v_contract)
           and (
             v_pix is null
             or (v_pix = 'absent' and f.pix_status is null)
             or f.pix_status = v_pix
           )
           and (v_fin is null or f.financial_summary = v_fin)
           and (p_needs_attention is null or f.attention = p_needs_attention)
         order by f.attention desc, f.overdue_cents desc, f.clinic_name asc, f.clinic_id asc
         limit v_limit
         offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_clinics(text, text, text, text, text, boolean, integer, integer) is
  'WP-BILLING-PRODUCT-05: bounded clinic billing list. Attention first. Limit 50.';

revoke all on function public.list_platform_billing_clinics(text, text, text, text, text, boolean, integer, integer)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_clinics(text, text, text, text, text, boolean, integer, integer)
  to authenticated;


create or replace function public.get_platform_clinic_billing_detail(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.platform_billing_clinic_facts;
  v_today date := private.billing_hub_business_date();
begin
  perform private.assert_platform_billing_reader();
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;

  select f.* into v_row
    from private.platform_billing_clinic_facts() f
   where f.clinic_id = p_clinic_id
   limit 1;

  if v_row.clinic_id is null then
    return jsonb_build_object('found', false, 'clinic_id', p_clinic_id);
  end if;

  return jsonb_build_object(
    'found', true,
    'clinic', private.platform_billing_clinic_json(v_row),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.charge_id,
        'clinic_id', c.clinic_id,
        'amount_cents', c.amount_cents,
        'currency', c.currency,
        'due_date', c.due_date,
        'paid_date', c.paid_date,
        'display_state', c.display_state,
        'method', c.method
      ) order by
        case c.display_state
          when 'OVERDUE' then 0
          when 'PENDING' then 1
          when 'PROGRAMMED' then 2
          else 3
        end,
        c.due_date desc nulls last,
        c.occurred_at desc,
        c.charge_id desc
      )
      from (
        select *
          from private.platform_billing_charge_universe() u
         where u.clinic_id = p_clinic_id
         order by u.occurred_at desc, u.charge_id desc
         limit 50
      ) c
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'clinic_id', a.clinic_id,
        'amount_cents', p.value_cents,
        'currency', 'BRL',
        'due_date', p.due_date,
        'received_date', p.payment_date,
        'display_state', private.billing_hub_payment_display_state(
          p.financial_state, p.due_date, v_today
        ),
        'method', private.billing_hub_payment_method(p.billing_type)
      ) order by coalesce(p.payment_date, p.due_date) desc nulls last, p.created_at desc)
      from (
        select bp.*, ba.clinic_id
          from private.billing_payments bp
          join private.billing_accounts ba on ba.id = bp.billing_account_id
         where ba.clinic_id = p_clinic_id
           and bp.financial_state not in ('voided', 'unknown')
         order by bp.created_at desc, bp.id desc
         limit 50
      ) p
      join private.billing_accounts a on a.id = p.billing_account_id
    ), '[]'::jsonb),
    'business_timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.event_id,
        'occurred_at', t.occurred_at,
        'type', t.event_type
      ) order by t.occurred_at desc, t.event_type desc, t.event_id desc)
      from (
        select *
          from private.billing_hub_timeline_rows(p_clinic_id)
         order by occurred_at desc, event_type desc, event_id desc
         limit 50
      ) t
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'processing_status', e.processing_status,
        'received_at', e.received_at,
        'processed_at', e.processed_at,
        'failure_category', e.last_error_category,
        'clinic_id', e.clinic_id,
        'related_payment_id', e.related_payment_id,
        'related_entity_type', e.related_entity_type
      ) order by e.received_at desc, e.id desc)
      from (
        select
          ev.id,
          ev.event_type,
          ev.processing_status,
          ev.received_at,
          ev.processed_at,
          ev.last_error_category,
          coalesce(a.clinic_id, cc.clinic_id) as clinic_id,
          p.id as related_payment_id,
          case
            when p.id is not null then 'payment'
            when auth.id is not null then 'authorization'
            else 'unknown'
          end as related_entity_type
        from private.billing_provider_events ev
        left join private.billing_payments p
          on p.external_payment_id = ev.external_resource_id
        left join private.billing_accounts a
          on a.id = p.billing_account_id
        left join private.billing_pix_automatic_authorizations auth
          on auth.provider_contract_id = ev.external_resource_id
        left join private.billing_commercial_contracts cc
          on cc.id = auth.commercial_contract_id
        where coalesce(a.clinic_id, cc.clinic_id) = p_clinic_id
        order by ev.received_at desc, ev.id desc
        limit 50
      ) e
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_platform_clinic_billing_detail(uuid) is
  'WP-BILLING-PRODUCT-05: Platform Admin clinic billing detail. No tenant RPC. No QR.';

revoke all on function public.get_platform_clinic_billing_detail(uuid)
  from public, anon, service_role;
grant execute on function public.get_platform_clinic_billing_detail(uuid) to authenticated;


create or replace function public.list_platform_billing_charges(
  p_clinic_id uuid default null,
  p_display_state text default null,
  p_method text default null,
  p_plan_code text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.platform_billing_clamp_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_state text := nullif(btrim(coalesce(p_display_state, '')), '');
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
  v_plan text := nullif(btrim(coalesce(p_plan_code, '')), '');
begin
  perform private.assert_platform_billing_reader();

  return jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.charge_id,
        'clinic_id', x.clinic_id,
        'clinic_name', x.clinic_name,
        'amount_cents', x.amount_cents,
        'currency', x.currency,
        'due_date', x.due_date,
        'paid_date', x.paid_date,
        'display_state', x.display_state,
        'method', x.method
      ) order by
        case x.display_state
          when 'OVERDUE' then 0
          when 'PENDING' then 1
          when 'PROGRAMMED' then 2
          else 3
        end,
        x.due_date desc nulls last,
        x.occurred_at desc,
        x.charge_id desc
      )
      from (
        select
          u.*,
          c.name as clinic_name
        from private.platform_billing_charge_universe() u
        join public.clinics c on c.id = u.clinic_id
        where (p_clinic_id is null or u.clinic_id = p_clinic_id)
          and (v_state is null or u.display_state = v_state)
          and (v_method is null or u.method = v_method)
          and (
            v_plan is null
            or exists (
              select 1
                from private.billing_commercial_contracts cc
                join private.billing_plan_versions pv on pv.id = cc.plan_version_id
                join private.billing_plans p on p.id = pv.plan_id
               where cc.clinic_id = u.clinic_id
                 and cc.status = 'active'
                 and p.code = v_plan
            )
          )
        order by
          case u.display_state
            when 'OVERDUE' then 0
            when 'PENDING' then 1
            when 'PROGRAMMED' then 2
            else 3
          end,
          u.due_date desc nulls last,
          u.occurred_at desc,
          u.charge_id desc
        limit v_limit
        offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_charges(uuid, text, text, text, integer, integer) is
  'WP-BILLING-PRODUCT-05: bounded cross-clinic charges. No Create Charge.';

revoke all on function public.list_platform_billing_charges(uuid, text, text, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_charges(uuid, text, text, text, integer, integer)
  to authenticated;


create or replace function public.list_platform_billing_payments(
  p_clinic_id uuid default null,
  p_display_state text default null,
  p_method text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.platform_billing_clamp_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_state text := nullif(btrim(coalesce(p_display_state, '')), '');
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
  v_today date := private.billing_hub_business_date();
begin
  perform private.assert_platform_billing_reader();

  return jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'clinic_id', x.clinic_id,
        'clinic_name', x.clinic_name,
        'amount_cents', x.value_cents,
        'currency', 'BRL',
        'due_date', x.due_date,
        'received_date', x.payment_date,
        'display_state', x.display_state,
        'method', x.method
      ) order by coalesce(x.payment_date, x.due_date) desc nulls last, x.created_at desc, x.id desc)
      from (
        select
          p.id,
          a.clinic_id,
          c.name as clinic_name,
          p.value_cents,
          p.due_date,
          p.payment_date,
          p.created_at,
          private.billing_hub_payment_display_state(p.financial_state, p.due_date, v_today) as display_state,
          private.billing_hub_payment_method(p.billing_type) as method
        from private.billing_payments p
        join private.billing_accounts a on a.id = p.billing_account_id
        join public.clinics c on c.id = a.clinic_id
        where p.financial_state not in ('voided', 'unknown')
          and (p_clinic_id is null or a.clinic_id = p_clinic_id)
          and (
            v_state is null
            or private.billing_hub_payment_display_state(p.financial_state, p.due_date, v_today) = v_state
          )
          and (
            v_method is null
            or private.billing_hub_payment_method(p.billing_type) = v_method
          )
        order by coalesce(p.payment_date, p.due_date) desc nulls last, p.created_at desc, p.id desc
        limit v_limit
        offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_payments(uuid, text, text, integer, integer) is
  'WP-BILLING-PRODUCT-05: bounded cross-clinic payments. No provider payment ids.';

revoke all on function public.list_platform_billing_payments(uuid, text, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_payments(uuid, text, text, integer, integer)
  to authenticated;


create or replace function public.list_platform_billing_events(
  p_clinic_id uuid default null,
  p_processing_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.platform_billing_clamp_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_status text := nullif(btrim(coalesce(p_processing_status, '')), '');
begin
  perform private.assert_platform_billing_reader();

  return jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'event_type', x.event_type,
        'processing_status', x.processing_status,
        'received_at', x.received_at,
        'processed_at', x.processed_at,
        'failure_category', x.last_error_category,
        'clinic_id', x.clinic_id,
        'clinic_name', x.clinic_name,
        'related_payment_id', x.related_payment_id,
        'related_entity_type', x.related_entity_type
      ) order by x.received_at desc, x.id desc)
      from (
        select
          ev.id,
          ev.event_type,
          ev.processing_status,
          ev.received_at,
          ev.processed_at,
          ev.last_error_category,
          coalesce(a.clinic_id, cc.clinic_id) as clinic_id,
          cl.name as clinic_name,
          p.id as related_payment_id,
          case
            when p.id is not null then 'payment'
            when auth.id is not null then 'authorization'
            else 'unknown'
          end as related_entity_type
        from private.billing_provider_events ev
        left join private.billing_payments p
          on p.external_payment_id = ev.external_resource_id
        left join private.billing_accounts a
          on a.id = p.billing_account_id
        left join private.billing_pix_automatic_authorizations auth
          on auth.provider_contract_id = ev.external_resource_id
        left join private.billing_commercial_contracts cc
          on cc.id = auth.commercial_contract_id
        left join public.clinics cl
          on cl.id = coalesce(a.clinic_id, cc.clinic_id)
        where (p_clinic_id is null or coalesce(a.clinic_id, cc.clinic_id) = p_clinic_id)
          and (v_status is null or ev.processing_status = v_status)
        order by ev.received_at desc, ev.id desc
        limit v_limit
        offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_events(uuid, text, integer, integer) is
  'WP-BILLING-PRODUCT-05: sanitized provider-event metadata. No payload, QR, or external ids.';

revoke all on function public.list_platform_billing_events(uuid, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_events(uuid, text, integer, integer)
  to authenticated;
