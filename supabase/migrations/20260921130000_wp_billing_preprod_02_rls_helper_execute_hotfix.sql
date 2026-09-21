-- =====================================================================================
-- WP-BILLING-PREPROD-02 FIX-02 — RLS helper EXECUTE privilege hotfix.
--
-- Incident: OBSERVE + product_allowed=true still yielded 42501 on
--   GET /rest/v1/patients
--   GET /rest/v1/professional_patient_links
-- because policies billing_preprod_clinical_access invoke
--   private.billing_clinical_product_permitted(uuid)
-- while EXECUTE was revoked from authenticated in 20260921120000.
--
-- This migration grants ONLY the minimum EXECUTE needed for RLS evaluation.
-- Does NOT change commercial semantics, rollout, write mode, canary, Founder,
-- contracts, exemptions, or Production Asaas.
-- Does NOT edit 20260921120000.
-- =====================================================================================

revoke all on function private.billing_clinical_product_permitted(uuid)
  from public, anon;

grant execute on function private.billing_clinical_product_permitted(uuid)
  to authenticated;

comment on function private.billing_clinical_product_permitted(uuid) is
  'PREPROD-02 FIX-02: STABLE SECURITY DEFINER commercial product gate for clinical RLS. search_path=''''. EXECUTE to authenticated only so policy expressions can evaluate; private schema is not exposed via PostgREST. Returns boolean only — no mutation, no secrets.';
