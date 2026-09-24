-- =====================================================================================
-- WP-BILLING-SQL-REGRESSION-MAINTENANCE-02
-- Platform billing workbench: attention rows sort before unknown/no-plan rows.
-- =====================================================================================

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
        x.attention desc nulls last,
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
             or (
               v_pix = 'absent'
               and f.provider_facts#>>'{sandbox,pix_status}' is null
               and f.provider_facts#>>'{production,pix_status}' is null
             )
             or f.provider_facts#>>'{sandbox,pix_status}' = v_pix
             or f.provider_facts#>>'{production,pix_status}' = v_pix
           )
           and (v_fin is null or f.financial_summary = v_fin)
           and (p_needs_attention is null or f.attention = p_needs_attention)
         order by f.attention desc nulls last, f.overdue_cents desc, f.clinic_name asc, f.clinic_id asc
         limit v_limit
         offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_clinics(text, text, text, text, text, boolean, integer, integer) is
  'WP-BILLING-SQL-REGRESSION-MAINTENANCE-02: Platform Admin list; attention true first, null attention last, with environment-aware Pix filtering.';
