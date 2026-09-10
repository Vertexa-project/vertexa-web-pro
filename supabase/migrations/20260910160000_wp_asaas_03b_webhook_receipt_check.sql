-- =====================================================================================
-- WP-ASAAS-03B — verificação read-only de recebimento de webhook (Gate 19: ASAAS -> Asaas
-- -> asaas-webhook -> private.billing_provider_events). Homologação técnica só.
--
-- NÃO edita 20260909090000 nem 20260910150000. Forward migration só.
--
-- Superfície:
--   private.find_billing_provider_events_for_resource  + public wrapper (service_role only)
--
-- Motivo de existir: private.billing_provider_events não é exposta via PostgREST (nenhuma
-- tabela private.* é). Igual ao restante do ASAAS-03/03B, o único acesso possível é uma RPC
-- SECURITY DEFINER explícita, service_role only. p_external_resource_id é sempre resolvido
-- server-side pelo próprio asaas-outbound (nunca aceito do client) — ver
-- resolve_primary_asaas_subscription (20260910150000) para o mesmo padrão.
-- =====================================================================================

create or replace function private.find_billing_provider_events_for_resource(
  p_provider text,
  p_environment text,
  p_resource_type text,
  p_external_resource_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', e.event_type,
        'external_event_id', e.external_event_id,
        'processing_status', e.processing_status,
        'received_at', e.received_at
      )
      order by e.received_at asc
    ),
    '[]'::jsonb
  )
  from private.billing_provider_events e
  where e.provider = p_provider
    and e.environment = p_environment
    and e.external_resource_type = p_resource_type
    and e.external_resource_id = p_external_resource_id;
$$;

comment on function private.find_billing_provider_events_for_resource(text, text, text, text) is
  'WP-ASAAS-03B: leitura só, homologação. Lista (event_type, external_event_id, '
  'processing_status, received_at) de private.billing_provider_events para um recurso '
  'externo específico. Nunca devolve payload_hash nem qualquer campo bruto do webhook. '
  'p_external_resource_id sempre resolvido server-side pelo caller (asaas-outbound), nunca '
  'aceito do browser.';

revoke all on function private.find_billing_provider_events_for_resource(text, text, text, text)
  from public, anon, authenticated, service_role;


create or replace function public.find_billing_provider_events_for_resource(
  p_provider text,
  p_environment text,
  p_resource_type text,
  p_external_resource_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.find_billing_provider_events_for_resource(
    p_provider, p_environment, p_resource_type, p_external_resource_id
  );
end;
$$;

comment on function public.find_billing_provider_events_for_resource(text, text, text, text) is
  'WP-ASAAS-03B: wrapper Edge Function. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.find_billing_provider_events_for_resource(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.find_billing_provider_events_for_resource(text, text, text, text)
  to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910160000',
  '20260910160000_wp_asaas_03b_webhook_receipt_check.sql',
  'WP-ASAAS-03B: private.find_billing_provider_events_for_resource (service_role only, '
  'leitura só) — verificação Gate 19 de que um webhook real da Asaas chegou em '
  'billing_provider_events para o payment resolvido server-side. Nunca devolve payload '
  'bruto. Sem nova tabela.',
  'WP-ASAAS-03B'
)
on conflict (version) do nothing;
