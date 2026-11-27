-- =====================================================================================
-- Cartão 1568 — compra real pelo Asaas (Production) para clínica liberada.
--
-- Até aqui ensure_my_clinic_billing_account forçava 'sandbox' sempre, então nenhuma clínica
-- chegava a ter conta de cobrança de Production e billing_clinic_provider_environment
-- respondia 'sandbox' para todas, mesmo com a clínica no canary.
--
-- Agora o ambiente continua decidido só pelo servidor:
--   * write_mode locked                 -> sandbox (igual a antes)
--   * write_mode canary, clínica fora    -> sandbox (igual a antes)
--   * write_mode canary, clínica dentro  -> production
--   * write_mode open                    -> production
-- usando o mesmo private.billing_production_write_allowed que get_or_create_billing_account
-- já exige para criar a conta de Production. O navegador continua sem escolher ambiente.
-- =====================================================================================

create or replace function public.ensure_my_clinic_billing_account(p_clinic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_raw jsonb;
  v_env text := 'sandbox';
begin
  if v_me is null then
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

  -- Ambiente decidido no servidor: Production só para clínica liberada (canary) ou rollout aberto.
  if private.billing_production_write_allowed(p_clinic_id, 'ENSURE_CUSTOMER_FROM_IDENTITY') then
    v_env := 'production';
  end if;

  v_raw := public.get_or_create_billing_account('asaas', v_env, p_clinic_id);

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'exists', true,
    'created', coalesce((v_raw ->> 'created')::boolean, false)
  );
end;
$$;

revoke all on function public.ensure_my_clinic_billing_account(uuid) from public, anon;
grant execute on function public.ensure_my_clinic_billing_account(uuid) to authenticated;
