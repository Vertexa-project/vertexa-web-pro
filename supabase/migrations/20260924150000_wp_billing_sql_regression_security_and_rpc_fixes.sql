-- =====================================================================================
-- WP-BILLING-SQL-REGRESSION-MAINTENANCE-02
-- Final-state RPC compatibility repair discovered by a clean local rebuild.
-- No data migration; no provider call; no entitlement or commercial-state mutation.
-- =====================================================================================

-- PREPROD-02 added an environment-aware six-argument export function while
-- retaining the five-argument compatibility wrapper. Defaults on both made a
-- direct five-argument call ambiguous. Keep the existing implementation as a
-- private worker and expose exact, non-overlapping public signatures.
alter function public.list_platform_billing_report_export(
  date, date, text, integer, integer, text
) set schema private;

revoke all on function private.list_platform_billing_report_export(
  date, date, text, integer, integer, text
) from public, anon, authenticated, service_role;

create function public.list_platform_billing_report_export(
  p_period_start date,
  p_period_end date,
  p_kind text,
  p_limit integer,
  p_offset integer,
  p_environment text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.list_platform_billing_report_export(
    p_period_start, p_period_end, p_kind, p_limit, p_offset, p_environment
  );
$$;

revoke all on function public.list_platform_billing_report_export(
  date, date, text, integer, integer, text
) from public, anon, service_role;
grant execute on function public.list_platform_billing_report_export(
  date, date, text, integer, integer, text
) to authenticated;

comment on function public.list_platform_billing_report_export(
  date, date, text, integer, integer, text
) is
  'WP-BILLING-SQL-REGRESSION-MAINTENANCE-02: exact six-argument environment-aware export wrapper; no defaults so legacy five-argument calls remain unambiguous.';
