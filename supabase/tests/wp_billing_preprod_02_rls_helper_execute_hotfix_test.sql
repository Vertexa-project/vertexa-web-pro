-- =====================================================================================
-- WP-BILLING-PREPROD-02 FIX-02 · RLS helper EXECUTE privilege tests.
-- BEGIN / DO / ROLLBACK. Local harness. No remote apply. No live QA mutation.
-- Requires migration 20260921130000 (hotfix GRANT) to be applied on the target DB.
-- =====================================================================================

begin;

do $fix02$
declare
  v_clinic uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_auth_owner uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_access jsonb;
  v_allowed boolean;
  v_exemption uuid;
  v_err text;
begin
  -- ── Privilege matrix (post-hotfix) ──────────────────────────────────────────
  if not has_function_privilege(
    'authenticated',
    'private.billing_clinical_product_permitted(uuid)',
    'EXECUTE'
  ) then
    raise exception 'FIX02 FAIL: authenticated lacks EXECUTE on billing_clinical_product_permitted';
  end if;

  if has_function_privilege(
    'anon',
    'private.billing_clinical_product_permitted(uuid)',
    'EXECUTE'
  ) then
    raise exception 'FIX02 FAIL: anon gained EXECUTE on billing_clinical_product_permitted';
  end if;

  if has_function_privilege(
    'public',
    'private.billing_clinical_product_permitted(uuid)',
    'EXECUTE'
  ) then
    raise exception 'FIX02 FAIL: PUBLIC gained EXECUTE on billing_clinical_product_permitted';
  end if;

  -- patient_clinic must remain executable (pre-existing); do not regress.
  if not has_function_privilege(
    'authenticated',
    'private.patient_clinic(uuid)',
    'EXECUTE'
  ) then
    raise exception 'FIX02 FAIL: authenticated lost EXECUTE on patient_clinic';
  end if;

  -- Nested resolver must NOT become a client-callable surface.
  if has_function_privilege(
    'authenticated',
    'private.billing_resolve_commercial_access(uuid)',
    'EXECUTE'
  ) then
    raise exception 'FIX02 FAIL: authenticated gained EXECUTE on billing_resolve_commercial_access';
  end if;

  -- Write/config helpers must not receive new EXECUTE from this hotfix.
  if has_function_privilege(
    'authenticated',
    'private.billing_production_write_allowed(uuid, text)',
    'EXECUTE'
  ) then
    raise exception 'FIX02 FAIL: authenticated can EXECUTE billing_production_write_allowed';
  end if;

  -- ── Fixtures ────────────────────────────────────────────────────────────────
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner, v_auth_owner, 'professional', 'FIX02 Owner', 'fix02-own@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'FIX02 PA', 'fix02-pa@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Clinica FIX02 Privilege', v_owner);

  insert into public.clinics (id, name, owner_profile_id)
  values (v_other, 'Clinica FIX02 Other', v_owner);

  insert into private.platform_admins (profile_id, status) values (v_pa, 'active');

  -- Ensure OBSERVE for semantic checks (restore at end of block via rollback).
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_pa::text)::text, true);
  perform public.set_platform_commercial_access_mode('observe');

  -- ── Authenticated-role: callable without 42501; OBSERVE → true ─────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_owner::text)::text, true);
  execute 'set local role authenticated';

  begin
    v_allowed := private.billing_clinical_product_permitted(v_clinic);
  exception
    when insufficient_privilege then
      raise exception 'FIX02 FAIL: authenticated still gets 42501 on billing_clinical_product_permitted';
    when others then
      get stacked diagnostics v_err = message_text;
      raise exception 'FIX02 FAIL: unexpected error calling helper as authenticated: %', v_err;
  end;

  if v_allowed is not true then
    raise exception 'FIX02 FAIL: OBSERVE no-contract should be true, got %', v_allowed;
  end if;

  -- The resolver is intentionally not client-callable. The public contract is
  -- the permitted boolean above; inspect resolver semantics only as postgres.
  reset role;
  v_access := private.billing_resolve_commercial_access(v_clinic);
  if v_access->>'reason' is distinct from 'OBSERVE_ONLY'
     or (v_access->>'product_allowed')::boolean is not true then
    raise exception 'FIX02 FAIL: OBSERVE semantics drifted: %', v_access;
  end if;

  -- ── ENFORCE no-contract → false (callable, not 42501) ──────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_pa::text)::text, true);
  perform public.set_platform_commercial_access_mode('enforce');

  execute 'set local role authenticated';
  begin
    v_allowed := private.billing_clinical_product_permitted(v_clinic);
  exception
    when insufficient_privilege then
      raise exception 'FIX02 FAIL: ENFORCE path still 42501 instead of semantic false';
  end;
  if v_allowed is not false then
    raise exception 'FIX02 FAIL: ENFORCE no-contract should be false, got %', v_allowed;
  end if;
  reset role;

  -- ── Active contract remains allowed ────────────────────────────────────────
  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  )
  select gen_random_uuid(), v_clinic, pv.id, 9900, 'BRL', 'monthly', 'active', now()
    from private.billing_plan_versions pv
   order by pv.created_at desc nulls last
   limit 1;

  if not exists (
    select 1 from private.billing_commercial_contracts
     where clinic_id = v_clinic and status = 'active'
  ) then
    raise exception 'FIX02 FAIL: could not seed active contract (missing plan_version)';
  end if;

  execute 'set local role authenticated';
  v_allowed := private.billing_clinical_product_permitted(v_clinic);
  reset role;
  if v_allowed is not true then
    raise exception 'FIX02 FAIL: active contract should be allowed';
  end if;

  -- ── Valid exemption remains allowed (under ENFORCE) ────────────────────────
  delete from private.billing_commercial_contracts where clinic_id = v_clinic;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_pa::text)::text, true);
  v_exemption := (
    select (public.grant_platform_commercial_access_exemption(
      v_clinic, 'fix02 harness exemption', null
    )->>'exemption_id')::uuid
  );
  execute 'set local role authenticated';
  v_allowed := private.billing_clinical_product_permitted(v_clinic);
  reset role;
  if v_allowed is not true then
    raise exception 'FIX02 FAIL: active exemption should be allowed';
  end if;
  perform public.revoke_platform_commercial_access_exemption(v_exemption);

  -- ── Cross-clinic: other clinic identity does not auto-grant under ENFORCE ──
  perform public.set_platform_commercial_access_mode('enforce');
  execute 'set local role authenticated';
  v_allowed := private.billing_clinical_product_permitted(v_other);
  reset role;
  if v_allowed is not false then
    raise exception 'FIX02 FAIL: unrelated no-contract clinic should be denied under ENFORCE';
  end if;

  -- Restore OBSERVE for safety of any leftover session (txn rolls back anyway).
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_pa::text)::text, true);
  perform public.set_platform_commercial_access_mode('observe');

  raise notice 'FIX02 PASS: privilege + semantics harness';
end;
$fix02$;

rollback;
