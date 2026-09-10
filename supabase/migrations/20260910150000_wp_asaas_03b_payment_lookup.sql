-- =====================================================================================
-- WP-ASAAS-03B — resolução server-side da subscription primary para payment lookup/confirm
-- (Sandbox homologação). Sem HTTP aqui (isso é Edge Function). Sem nova tabela: só leitura
-- do que ASAAS-03 já persiste (private.billing_accounts + private.billing_subscriptions).
--
-- NÃO edita 20260909090000. Forward migration só.
--
-- Superfície:
--   private.resolve_primary_asaas_subscription    + public wrapper (service_role only)
--
-- Motivo de existir: asaas-outbound (list_subscription_payments / confirm_sandbox_payment)
-- nunca aceita subscriptionId/customerId do browser — sempre resolve a partir da
-- subscription_scope='primary' já persistida pela própria conta autenticada. Isso mantém o
-- mesmo padrão de "server-derived" já usado pelo restante do ASAAS-03 (ver
-- 20260909090000, cabeçalho).
-- =====================================================================================

create or replace function private.resolve_primary_asaas_subscription(
  p_billing_account_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_external_customer_id text;
  v_external_subscription_id text;
begin
  if p_environment not in ('sandbox', 'production') then
    raise exception 'resolve_primary_asaas_subscription: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;

  select a.external_customer_id, s.external_subscription_id
    into v_external_customer_id, v_external_subscription_id
    from private.billing_accounts a
    left join private.billing_subscriptions s
      on s.billing_account_id = a.id
     and s.provider = 'asaas'
     and s.environment = p_environment
     and s.subscription_scope = 'primary'
   where a.id = p_billing_account_id
     and a.provider = 'asaas'
     and a.environment = p_environment;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'external_customer_id', v_external_customer_id,
    'external_subscription_id', v_external_subscription_id
  );
end;
$$;

comment on function private.resolve_primary_asaas_subscription(uuid, text) is
  'WP-ASAAS-03B: leitura só. Resolve external_customer_id (billing_accounts) e '
  'external_subscription_id (billing_subscriptions, subscription_scope=primary) para a '
  'billing_account+environment pedidos. found=false só quando a billing_account não existe '
  '(ou é de outro provider/environment) — subscription ausente ainda retorna found=true com '
  'external_subscription_id null (estado "customer existe, subscription ainda não").';

revoke all on function private.resolve_primary_asaas_subscription(uuid, text)
  from public, anon, authenticated, service_role;


create or replace function public.resolve_primary_asaas_subscription(
  p_billing_account_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.resolve_primary_asaas_subscription(p_billing_account_id, p_environment);
end;
$$;

comment on function public.resolve_primary_asaas_subscription(uuid, text) is
  'WP-ASAAS-03B: wrapper Edge Function. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.resolve_primary_asaas_subscription(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_primary_asaas_subscription(uuid, text) to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910150000',
  '20260910150000_wp_asaas_03b_payment_lookup.sql',
  'WP-ASAAS-03B: private.resolve_primary_asaas_subscription (service_role only, leitura só) '
  '— resolve external_customer_id/external_subscription_id da subscription primary para '
  'asaas-outbound list_subscription_payments/confirm_sandbox_payment nunca aceitarem '
  'subscriptionId/customerId do browser. Sem nova tabela.',
  'WP-ASAAS-03B'
)
on conflict (version) do nothing;
