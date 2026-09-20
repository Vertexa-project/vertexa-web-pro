-- =====================================================================================
-- WP-BILLING-PRODUCT-04 — Clinic Billing Hub read model.
--
-- Derive charges, payments, next charge and business timeline from the existing
-- private ledger. No invoice table. No timeline table. No provider HTTP.
-- No entitlement grant. No QA mutation. Not applied remotely in this WP.
-- =====================================================================================


create or replace function private.assert_my_clinic_billing_reader(p_clinic_id uuid)
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
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;
end;
$$;

comment on function private.assert_my_clinic_billing_reader(uuid) is
  'WP-BILLING-PRODUCT-04: fail-closed Clinic Admin/owner of own clinic. No Platform Admin bypass.';

revoke all on function private.assert_my_clinic_billing_reader(uuid)
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_business_date()
returns date
language sql
stable
set search_path = ''
as $$
  select (timezone('America/Sao_Paulo', now()))::date;
$$;

comment on function private.billing_hub_business_date() is
  'WP-BILLING-PRODUCT-04: calendar date for overdue/next-charge. America/Sao_Paulo only.';

revoke all on function private.billing_hub_business_date()
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_payment_method(p_billing_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when upper(btrim(coalesce(p_billing_type, ''))) in ('PIX', 'BOLETO', 'CREDIT_CARD')
      then upper(btrim(p_billing_type))
    else 'UNDEFINED'
  end;
$$;

revoke all on function private.billing_hub_payment_method(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_charge_state_from_payment(
  p_financial_state text,
  p_due_date date,
  p_today date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_financial_state = 'received' then 'PAID'
    when p_financial_state = 'overdue' then 'OVERDUE'
    when p_financial_state in ('pending', 'authorized', 'confirmed')
         and p_due_date is not null
         and p_today is not null
         and p_due_date < p_today then 'OVERDUE'
    when p_financial_state in ('pending', 'authorized', 'confirmed') then 'PENDING'
    when p_financial_state in (
      'refund_in_progress', 'refunded', 'partially_refunded'
    ) then 'PAID'
    else 'PENDING'
  end;
$$;

comment on function private.billing_hub_charge_state_from_payment(text, date, date) is
  'WP-BILLING-PRODUCT-04: server-side charge display state. Browser never decides overdue.';

revoke all on function private.billing_hub_charge_state_from_payment(text, date, date)
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_payment_display_state(
  p_financial_state text,
  p_due_date date,
  p_today date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_financial_state = 'received' then 'received'
    when p_financial_state = 'overdue' then 'overdue'
    when p_financial_state in ('pending', 'authorized', 'confirmed')
         and p_due_date is not null
         and p_today is not null
         and p_due_date < p_today then 'overdue'
    when p_financial_state in (
      'refund_in_progress', 'refunded', 'partially_refunded'
    ) then 'received'
    else 'pending'
  end;
$$;

revoke all on function private.billing_hub_payment_display_state(text, date, date)
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_charge_rows(p_clinic_id uuid)
returns table (
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
    where a.clinic_id = p_clinic_id
      and p.financial_state not in ('voided', 'unknown')
  ),
  instr as (
    select
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
    where cc.clinic_id = p_clinic_id
      and i.status in ('AWAITING_REQUEST', 'SCHEDULED')
      and not exists (
        select 1
          from private.billing_payments p
         where p.pix_instruction_id = i.id
           and p.financial_state not in ('voided', 'unknown')
      )
  )
  select pay.charge_id, pay.source, pay.amount_cents, pay.currency, pay.due_date,
         pay.paid_date, pay.display_state, pay.method, pay.occurred_at
    from pay
  union all
  select instr.charge_id, instr.source, instr.amount_cents, instr.currency, instr.due_date,
         instr.paid_date, instr.display_state, instr.method, instr.occurred_at
    from instr;
$$;

comment on function private.billing_hub_charge_rows(uuid) is
  'WP-BILLING-PRODUCT-04: cobrança = instruction without payment, or existing payment. No invented rows.';

revoke all on function private.billing_hub_charge_rows(uuid)
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_next_charge(p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when x.charge_id is null then null
    else jsonb_build_object(
      'amount_cents', x.amount_cents,
      'currency', x.currency,
      'due_date', x.due_date,
      'display_state', x.display_state
    )
  end
  from (
    select c.charge_id, c.amount_cents, c.currency, c.due_date, c.display_state
      from private.billing_hub_charge_rows(p_clinic_id) c
     where c.display_state in ('PROGRAMMED', 'PENDING')
       and c.due_date is not null
       and c.due_date >= private.billing_hub_business_date()
     order by c.due_date asc, c.occurred_at asc, c.charge_id asc
     limit 1
  ) x;
$$;

comment on function private.billing_hub_next_charge(uuid) is
  'WP-BILLING-PRODUCT-04: next non-received future charge only. Null when not derivable.';

revoke all on function private.billing_hub_next_charge(uuid)
  from public, anon, authenticated, service_role;


create or replace function private.billing_hub_timeline_rows(p_clinic_id uuid)
returns table (
  event_id text,
  occurred_at timestamptz,
  event_type text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with plan_events as (
    select
      'plan_contracted:' || cc.id::text as event_id,
      cc.created_at as occurred_at,
      'plan_contracted'::text as event_type
    from private.billing_commercial_contracts cc
    where cc.clinic_id = p_clinic_id
  ),
  pix_events as (
    select
      case a.provider_status
        when 'INTENT' then 'pix_prepared:'
        when 'CREATED' then 'pix_created:'
        when 'ACTIVE' then 'pix_active:'
        when 'REFUSED' then 'pix_refused:'
        else null
      end || a.id::text as event_id,
      case
        when a.provider_status = 'INTENT' then a.created_at
        else coalesce(a.updated_at, a.created_at)
      end as occurred_at,
      case a.provider_status
        when 'INTENT' then 'pix_prepared'
        when 'CREATED' then 'pix_created'
        when 'ACTIVE' then 'pix_active'
        when 'REFUSED' then 'pix_refused'
        else null
      end as event_type
    from private.billing_pix_automatic_authorizations a
    join private.billing_commercial_contracts cc on cc.id = a.commercial_contract_id
    where cc.clinic_id = p_clinic_id
      and a.provider_status in ('INTENT', 'CREATED', 'ACTIVE', 'REFUSED')
  ),
  programmed as (
    select
      'charge_programmed:' || i.id::text as event_id,
      i.created_at as occurred_at,
      'charge_programmed'::text as event_type
    from private.billing_pix_automatic_payment_instructions i
    join private.billing_pix_automatic_authorizations a on a.id = i.pix_authorization_id
    join private.billing_commercial_contracts cc on cc.id = a.commercial_contract_id
    where cc.clinic_id = p_clinic_id
      and i.status in ('AWAITING_REQUEST', 'SCHEDULED')
  ),
  pay_events as (
    select
      'charge_created:' || p.id::text as event_id,
      p.created_at as occurred_at,
      'charge_created'::text as event_type
    from private.billing_payments p
    join private.billing_accounts acc on acc.id = p.billing_account_id
    where acc.clinic_id = p_clinic_id
      and p.financial_state not in ('voided', 'unknown')
    union all
    select
      'payment_received:' || p.id::text as event_id,
      coalesce(
        (p.payment_date::timestamp at time zone 'America/Sao_Paulo'),
        p.updated_at,
        p.created_at
      ) as occurred_at,
      'payment_received'::text as event_type
    from private.billing_payments p
    join private.billing_accounts acc on acc.id = p.billing_account_id
    where acc.clinic_id = p_clinic_id
      and p.financial_state = 'received'
    union all
    select
      'payment_overdue:' || p.id::text as event_id,
      coalesce(
        (p.due_date::timestamp at time zone 'America/Sao_Paulo'),
        p.updated_at,
        p.created_at
      ) as occurred_at,
      'payment_overdue'::text as event_type
    from private.billing_payments p
    join private.billing_accounts acc on acc.id = p.billing_account_id
    where acc.clinic_id = p_clinic_id
      and private.billing_hub_charge_state_from_payment(
            p.financial_state,
            p.due_date,
            private.billing_hub_business_date()
          ) = 'OVERDUE'
  )
  select event_id, occurred_at, event_type
    from plan_events
  union all
  select event_id, occurred_at, event_type
    from pix_events
   where event_type is not null
  union all
  select event_id, occurred_at, event_type
    from programmed
  union all
  select event_id, occurred_at, event_type
    from pay_events;
$$;

comment on function private.billing_hub_timeline_rows(uuid) is
  'WP-BILLING-PRODUCT-04: derived clinic business events only. No webhook JSON, no QR, no provider ids.';

revoke all on function private.billing_hub_timeline_rows(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.get_my_clinic_billing_overview(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_checkout jsonb;
  v_next jsonb;
  v_overdue_count integer := 0;
  v_overdue_cents bigint := 0;
  v_open_count integer := 0;
  v_paid_count integer := 0;
  v_charge_count integer := 0;
  v_summary text;
  v_latest_payment text;
  v_today date := private.billing_hub_business_date();
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  v_checkout := private.billing_clinic_checkout_snapshot(p_clinic_id);
  v_next := private.billing_hub_next_charge(p_clinic_id);

  select
    count(*)::integer,
    count(*) filter (where c.display_state = 'OVERDUE')::integer,
    coalesce(sum(c.amount_cents) filter (where c.display_state = 'OVERDUE'), 0),
    count(*) filter (where c.display_state in ('PROGRAMMED', 'PENDING'))::integer,
    count(*) filter (where c.display_state = 'PAID')::integer
    into v_charge_count, v_overdue_count, v_overdue_cents, v_open_count, v_paid_count
    from private.billing_hub_charge_rows(p_clinic_id) c;

  select private.billing_hub_payment_display_state(p.financial_state, p.due_date, v_today)
    into v_latest_payment
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
   where a.clinic_id = p_clinic_id
     and p.financial_state not in ('voided', 'unknown')
   order by coalesce(p.payment_date, p.due_date, v_today) desc, p.created_at desc
   limit 1;

  if v_checkout->'commercial_contract' is null
     or v_checkout->>'commercial_contract' = 'null' then
    v_summary := 'no_plan';
  elsif v_overdue_count > 0 then
    v_summary := 'overdue';
  elsif v_open_count > 0 then
    v_summary := 'pending';
  elsif v_paid_count > 0 then
    v_summary := 'current';
  else
    v_summary := 'no_charges';
  end if;

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'plan', case
      when v_checkout->'commercial_contract' is null
           or v_checkout->>'commercial_contract' = 'null' then null
      else jsonb_build_object(
        'status', v_checkout#>>'{commercial_contract,status}',
        'plan_display_name', v_checkout#>>'{commercial_contract,plan_display_name}',
        'price_cents', (v_checkout#>>'{commercial_contract,price_cents}')::integer,
        'currency', v_checkout#>>'{commercial_contract,currency}',
        'billing_cycle', v_checkout#>>'{commercial_contract,billing_cycle}'
      )
    end,
    'pix_authorization_status', v_checkout->'pix_authorization_status',
    'pix_generation', v_checkout->'pix_generation',
    'identity_complete', coalesce((v_checkout->>'identity_complete')::boolean, false),
    'next_charge', v_next,
    'financial_situation', jsonb_build_object(
      'summary_code', v_summary,
      'attention', v_summary = 'overdue',
      'overdue_count', v_overdue_count,
      'overdue_cents', case when v_overdue_count > 0 then v_overdue_cents else null end
    ),
    'latest_payment_display_state', v_latest_payment,
    'charge_count', v_charge_count,
    'entitlement_enforcement', 'OFF',
    'entitlement_granted', false
  );
end;
$$;

comment on function public.get_my_clinic_billing_overview(uuid) is
  'WP-BILLING-PRODUCT-04: Clinic Admin billing overview. Own clinic. No QR. No provider ids.';

revoke all on function public.get_my_clinic_billing_overview(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_clinic_billing_overview(uuid) to authenticated;


create or replace function public.list_my_clinic_billing_charges(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.charge_id,
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
          from private.billing_hub_charge_rows(p_clinic_id)
         order by occurred_at desc, charge_id desc
         limit 50
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_my_clinic_billing_charges(uuid) is
  'WP-BILLING-PRODUCT-04: own-clinic charge projection. No Create Charge. No provider ids.';

revoke all on function public.list_my_clinic_billing_charges(uuid)
  from public, anon, service_role;
grant execute on function public.list_my_clinic_billing_charges(uuid) to authenticated;


create or replace function public.list_my_clinic_billing_payments(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.billing_hub_business_date();
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
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
        select bp.*
          from private.billing_payments bp
          join private.billing_accounts a on a.id = bp.billing_account_id
         where a.clinic_id = p_clinic_id
           and bp.financial_state not in ('voided', 'unknown')
         order by bp.created_at desc, bp.id desc
         limit 50
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_my_clinic_billing_payments(uuid) is
  'WP-BILLING-PRODUCT-04: own-clinic payment history. No raw webhook. No secrets. No provider ids.';

revoke all on function public.list_my_clinic_billing_payments(uuid)
  from public, anon, service_role;
grant execute on function public.list_my_clinic_billing_payments(uuid) to authenticated;


create or replace function public.list_my_clinic_billing_timeline(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.event_id,
        'occurred_at', t.occurred_at,
        'type', t.event_type
      ) order by t.occurred_at desc, t.event_type desc, t.event_id desc)
      from (
        select *
          from private.billing_hub_timeline_rows(p_clinic_id)
         where event_type in (
           'plan_contracted',
           'pix_prepared',
           'pix_created',
           'pix_active',
           'pix_refused',
           'charge_programmed',
           'charge_created',
           'payment_received',
           'payment_overdue'
         )
           and occurred_at is not null
         order by occurred_at desc, event_type desc, event_id desc
         limit 40
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_my_clinic_billing_timeline(uuid) is
  'WP-BILLING-PRODUCT-04: derived clinic business timeline. Newest first. No webhook payload.';

revoke all on function public.list_my_clinic_billing_timeline(uuid)
  from public, anon, service_role;
grant execute on function public.list_my_clinic_billing_timeline(uuid) to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260920200000',
  '20260920200000_wp_billing_product_04_clinic_billing_hub.sql',
  'WP-BILLING-PRODUCT-04: Clinic Billing Hub read RPCs derived from existing ledger. '
  'No invoice/timeline table. No Asaas HTTP. Not applied remotely in this WP.',
  'WP-BILLING-PRODUCT-04'
)
on conflict (version) do nothing;
