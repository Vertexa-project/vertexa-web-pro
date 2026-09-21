-- WP-BP07R2: provenance-only additive fixes.
-- Restores historical truth: 20260920230000 remains the originally applied SQL.
-- These two CREATE OR REPLACE bodies match the live Production functions
-- already applied after 20260920230000. Idempotent. No data rewrite.

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

  -- SELECT INTO with zero rows nullifies targets. Use FOUND, not a boolean
  -- written only on a matching contract row.
  select p.code, pv.max_professionals, pv.max_active_patients
    into v_code, v_included_prof, v_included_pat
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;

  if not found then
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
  update private.billing_founder_admissions
     set benefit_status = 'historical_only',
         ineligible_after_close_at = coalesce(ineligible_after_close_at, clock_timestamp())
   where campaign_id = v_campaign.id
     and benefit_status = 'returnable';
  insert into private.billing_commercial_governance_events (
    actor_id, actor_authority, action, payload
  ) values (v_me, 'platform_admin', 'founder_campaign_close', '{}'::jsonb);
  return jsonb_build_object('status', 'closed');
end;
$$;
