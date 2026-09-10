-- =====================================================================================
-- WP-ASAAS-04 — backfill único (Sandbox) de eventos sintéticos históricos.
--
-- NÃO edita migrations anteriores. Forward migration só.
--
-- CORREÇÃO OBRIGATÓRIA 4 (safe historical replay): antes de qualquer drain, os eventos
-- sintéticos deixados por smoke tests de WPs anteriores (external_event_id 'WP_ASAAS_*') são
-- marcados como ignored com last_error_category='historical_test_fixture'. São test fixtures,
-- não fatos financeiros reais — não devem virar billing_payments nem disparar GET no Asaas.
--
-- Isto é um BACKFILL Sandbox-específico e único, NÃO uma regra permanente do processor. O
-- processor NUNCA usa "não começa com evt_ => ignora" como regra de negócio. Quem separa
-- sintético de real aqui é este one-off; o processor em si é agnóstico a prefixo de id.
--
-- Garantias: sem DELETE; sem alterar external_event_id/payload_hash; idempotente (só afeta
-- rows ainda em 'received'); no-op em production (filtro environment='sandbox').
-- =====================================================================================

update private.billing_provider_events
   set processing_status = 'ignored',
       processed_at = now(),
       last_error_category = 'historical_test_fixture'
 where provider = 'asaas'
   and environment = 'sandbox'
   and processing_status = 'received'
   and external_event_id like 'WP\_ASAAS%' escape '\';


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910183000',
  '20260910183000_wp_asaas_04_historical_fixture_backfill.sql',
  'WP-ASAAS-04: backfill único Sandbox — eventos sintéticos WP_ASAAS_* ainda em received viram '
  'ignored/historical_test_fixture. Sem delete, sem alterar external_event_id, idempotente, '
  'no-op em production. NÃO é regra permanente do processor.',
  'WP-ASAAS-04'
)
on conflict (version) do nothing;
