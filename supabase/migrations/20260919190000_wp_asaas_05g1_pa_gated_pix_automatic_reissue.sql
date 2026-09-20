-- =====================================================================================
-- WP-ASAAS-05G1 — PA-gated Pix Automatic REISSUE wrapper + audit.
--
-- Local Vertexa state only. Zero HTTP Asaas. Zero QR. Zero entitlement.
-- Reuses private.billing_reissue_pix_automatic_authorization as transition authority.
-- Does NOT grant EXECUTE on the private function to authenticated/anon/service_role.
-- Does NOT apply remotely in this WP.
-- =====================================================================================

create table private.billing_pix_automatic_reissue_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  commercial_contract_id uuid not null
    references private.billing_commercial_contracts(id) on delete restrict,
  old_authorization_id uuid not null
    references private.billing_pix_automatic_authorizations(id) on delete restrict,
  new_authorization_id uuid not null
    references private.billing_pix_automatic_authorizations(id) on delete restrict,
  old_generation integer not null,
  new_generation integer not null,
  old_status text not null,
  new_status text not null,
  outcome text not null,
  environment text not null,
  reason text,
  constraint billing_pix_reissue_events_generation_check
    check (old_generation >= 1 and new_generation >= 1),
  constraint billing_pix_reissue_events_status_check
    check (
      old_status in ('INTENT', 'CREATED', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'REFUSED')
      and new_status in ('INTENT', 'CREATED', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'REFUSED')
    ),
  constraint billing_pix_reissue_events_outcome_check
    check (outcome in ('reissued', 'already_reissued')),
  constraint billing_pix_reissue_events_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_pix_reissue_events_reason_len
    check (reason is null or char_length(reason) <= 500),
  constraint billing_pix_reissue_events_transition_shape
    check (
      (outcome = 'reissued'
        and old_authorization_id is distinct from new_authorization_id
        and old_status = 'REFUSED'
        and new_status = 'INTENT'
        and new_generation = old_generation + 1)
      or
      (outcome = 'already_reissued'
        and old_authorization_id = new_authorization_id
        and old_generation = new_generation
        and old_status = new_status)
    )
);

comment on table private.billing_pix_automatic_reissue_events is
  'WP-ASAAS-05G1: append-only PA reissue audit. '
  'outcome=reissued is a real REFUSED→INTENT transition. '
  'outcome=already_reissued is an invocation record, not a second transition. '
  'No QR, payload, provider secrets, or JWT.';

comment on column private.billing_pix_automatic_reissue_events.outcome is
  'reissued = state transition. already_reissued = repeat invocation of an INTENT primary.';

create index billing_pix_automatic_reissue_events_clinic_idx
  on private.billing_pix_automatic_reissue_events (clinic_id, created_at desc);
create index billing_pix_automatic_reissue_events_contract_idx
  on private.billing_pix_automatic_reissue_events (commercial_contract_id, created_at desc);

alter table private.billing_pix_automatic_reissue_events enable row level security;
revoke all on table private.billing_pix_automatic_reissue_events
  from public, anon, authenticated, service_role;


create or replace function public.reissue_pix_automatic_authorization(
  p_clinic_id uuid,
  p_commercial_contract_id uuid,
  p_authorization_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_profile_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_environment text;
  v_contract_clinic uuid;
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_result jsonb;
  v_outcome text;
  v_new_id uuid;
  v_new_gen integer;
  v_new_status text;
  v_op_id uuid;
begin
  if v_actor is null or not private.is_platform_admin() then
    raise exception 'reissue_pix_automatic_authorization: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  if p_clinic_id is null
     or p_commercial_contract_id is null
     or p_authorization_id is null then
    raise exception 'reissue_pix_automatic_authorization: ids required'
      using errcode = '22023', hint = 'REISSUE_IDS_REQUIRED';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;

  select a.environment
    into v_environment
    from private.billing_accounts a
   where a.clinic_id = p_clinic_id;

  if v_environment is null then
    raise exception 'reissue_pix_automatic_authorization: billing account unknown'
      using errcode = 'P0002', hint = 'BILLING_ACCOUNT_UNKNOWN';
  end if;

  select cc.clinic_id
    into v_contract_clinic
    from private.billing_commercial_contracts cc
   where cc.id = p_commercial_contract_id;

  if v_contract_clinic is null then
    raise exception 'reissue_pix_automatic_authorization: contract unknown'
      using errcode = 'P0002', hint = 'BILLING_CONTRACT_UNKNOWN';
  end if;

  if v_contract_clinic is distinct from p_clinic_id then
    raise exception 'reissue_pix_automatic_authorization: clinic mismatch'
      using errcode = '42501', hint = 'BILLING_CLINIC_MISMATCH';
  end if;

  select *
    into v_auth
    from private.billing_pix_automatic_authorizations a
   where a.id = p_authorization_id;

  if not found then
    raise exception 'reissue_pix_automatic_authorization: authorization unknown'
      using errcode = 'P0002', hint = 'BILLING_AUTHORIZATION_UNKNOWN';
  end if;

  if v_auth.commercial_contract_id is distinct from p_commercial_contract_id then
    raise exception 'reissue_pix_automatic_authorization: contract mismatch'
      using errcode = '42501', hint = 'BILLING_CONTRACT_MISMATCH';
  end if;

  if v_auth.environment is distinct from v_environment then
    raise exception 'reissue_pix_automatic_authorization: environment mismatch'
      using errcode = '42501', hint = 'BILLING_ENVIRONMENT_MISMATCH';
  end if;

  if v_auth.is_primary is not true then
    raise exception 'reissue_pix_automatic_authorization: not current primary'
      using errcode = '22023', hint = 'BILLING_REISSUE_NOT_PRIMARY';
  end if;

  v_result := private.billing_reissue_pix_automatic_authorization(
    p_commercial_contract_id,
    v_environment
  );

  v_outcome := v_result->>'outcome';
  v_new_id := (v_result->>'authorization_id')::uuid;
  v_new_gen := (v_result->>'generation')::integer;
  v_new_status := v_result->>'provider_status';
  v_op_id := (v_result->'authorization_operation'->>'operation_id')::uuid;

  if v_outcome is distinct from 'reissued'
     and v_outcome is distinct from 'already_reissued' then
    raise exception 'reissue_pix_automatic_authorization: unexpected outcome'
      using errcode = '22023', hint = 'BILLING_REISSUE_UNEXPECTED_OUTCOME';
  end if;

  if v_outcome = 'reissued' then
    insert into private.billing_pix_automatic_reissue_events (
      actor_profile_id,
      clinic_id,
      commercial_contract_id,
      old_authorization_id,
      new_authorization_id,
      old_generation,
      new_generation,
      old_status,
      new_status,
      outcome,
      environment,
      reason
    ) values (
      v_actor,
      p_clinic_id,
      p_commercial_contract_id,
      p_authorization_id,
      v_new_id,
      v_auth.generation,
      v_new_gen,
      'REFUSED',
      'INTENT',
      'reissued',
      v_environment,
      v_reason
    );
  else
    -- Invocation audit only. Same authorization/generation/status. Not a fabricated transition.
    insert into private.billing_pix_automatic_reissue_events (
      actor_profile_id,
      clinic_id,
      commercial_contract_id,
      old_authorization_id,
      new_authorization_id,
      old_generation,
      new_generation,
      old_status,
      new_status,
      outcome,
      environment,
      reason
    ) values (
      v_actor,
      p_clinic_id,
      p_commercial_contract_id,
      v_new_id,
      v_new_id,
      v_new_gen,
      v_new_gen,
      coalesce(v_new_status, 'INTENT'),
      coalesce(v_new_status, 'INTENT'),
      'already_reissued',
      v_environment,
      v_reason
    );
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'clinic_id', p_clinic_id,
    'commercial_contract_id', p_commercial_contract_id,
    'old_authorization_id',
      case when v_outcome = 'reissued' then p_authorization_id else v_new_id end,
    'new_authorization_id', v_new_id,
    'old_generation',
      case when v_outcome = 'reissued' then v_auth.generation else v_new_gen end,
    'new_generation', v_new_gen,
    'new_status', v_new_status,
    'operation_id', v_op_id
  );
end;
$$;

comment on function public.reissue_pix_automatic_authorization(uuid, uuid, uuid, text) is
  'WP-ASAAS-05G1: PA-only Vertexa local REISSUE. Environment derived from billing_account. '
  'Calls private.billing_reissue_pix_automatic_authorization. Audits in the same transaction. '
  'No HTTP. No QR. EXECUTE authenticated only.';

revoke all on function public.reissue_pix_automatic_authorization(uuid, uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.reissue_pix_automatic_authorization(uuid, uuid, uuid, text)
  to authenticated;


create or replace function public.list_platform_clinic_pix_automatic_statuses()
returns table (
  clinic_id uuid,
  commercial_contract_id uuid,
  authorization_id uuid,
  provider_status text,
  generation integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'list_platform_clinic_pix_automatic_statuses: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  return query
  select
    cc.clinic_id,
    cc.id,
    a.id,
    a.provider_status,
    a.generation
  from private.billing_commercial_contracts cc
  join private.billing_pix_automatic_authorizations a
    on a.commercial_contract_id = cc.id
   and a.is_primary
  where cc.status = 'active'
  order by cc.clinic_id, cc.id;
end;
$$;

comment on function public.list_platform_clinic_pix_automatic_statuses() is
  'WP-ASAAS-05G1: PA read-only sanitized Pix Automatic primary status per active contract. '
  'No provider ids, QR, payload, or environment.';

revoke all on function public.list_platform_clinic_pix_automatic_statuses()
  from public, anon, service_role;
grant execute on function public.list_platform_clinic_pix_automatic_statuses()
  to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260919190000',
  '20260919190000_wp_asaas_05g1_pa_gated_pix_automatic_reissue.sql',
  'WP-ASAAS-05G1: PA-gated public reissue wrapper + append-only audit + sanitized read RPC. '
  'Private reissue remains transition authority. No HTTP. Not applied remotely in this WP.',
  'asaas-05g1'
)
on conflict (version) do nothing;
