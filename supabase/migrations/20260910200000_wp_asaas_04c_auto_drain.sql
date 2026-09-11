-- =====================================================================================
-- WP-ASAAS-04C — auto-drain do processor financeiro via pg_cron + pg_net + Vault.
--
-- Cron (1/min) → private.invoke_asaas_processor_cron() → net.http_post
--   → Edge asaas-processor-cron (named secret asaas_processor_cron)
--   → drainBillingEvents (mesmo core do drain humano).
--
-- Vault NAMES only (valores NUNCA nesta migration):
--   vertexa_project_url
--   vertexa_asaas_processor_cron_key
--
-- Sandbox lock vive no Edge (environment != sandbox → 503). Esta migration NÃO
-- habilita Production Asaas.
--
-- IDEMPOTÊNCIA: unschedule SOMENTE o job 'vertexa-asaas-financial-drain' se já
-- existir, depois cron.schedule do mesmo nome. UNIQUE (jobname, username) no
-- pg_cron 1.6.4 também impede duplicata. NUNCA unschedule wp-rls2 / wp-vri / outros.
--
-- KILL SWITCH (emergência, não executar se verde):
--   select cron.unschedule('vertexa-asaas-financial-drain');
-- Não deleta events/payments, não toca Asaas, não altera clínica.
-- =====================================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ── Vault: client roles sem acesso a decrypted_secrets ───────────────────────────────

revoke all on table vault.secrets from public, anon, authenticated, service_role;
revoke all on table vault.decrypted_secrets from public, anon, authenticated, service_role;


-- ── Invoker interno (só o job Vertexa). Sem URL/key literais. ────────────────────────

create or replace function private.invoke_asaas_processor_cron()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  select ds.decrypted_secret into v_url
    from vault.decrypted_secrets ds
   where ds.name = 'vertexa_project_url'
   limit 1;
  select ds.decrypted_secret into v_key
    from vault.decrypted_secrets ds
   where ds.name = 'vertexa_asaas_processor_cron_key'
   limit 1;

  v_url := btrim(coalesce(v_url, ''));
  v_key := btrim(coalesce(v_key, ''));
  if v_url = '' or v_key = '' then
    raise exception 'invoke_asaas_processor_cron: vault names missing'
      using errcode = 'P0001', hint = 'VAULT_NOT_PROVISIONED';
  end if;

  select net.http_post(
    url := v_url || '/functions/v1/asaas-processor-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function private.invoke_asaas_processor_cron() is
  'WP-ASAAS-04C: pg_net POST no asaas-processor-cron. Lê Vault por NOME '
  '(vertexa_project_url, vertexa_asaas_processor_cron_key). Sem literais. '
  'EXECUTE só postgres (cron). anon/authenticated = false.';

revoke all on function private.invoke_asaas_processor_cron()
  from public, anon, authenticated, service_role;
grant execute on function private.invoke_asaas_processor_cron() to postgres;


-- ── Job único ────────────────────────────────────────────────────────────────────────

do $unsched$
begin
  if exists (
    select 1 from cron.job where jobname = 'vertexa-asaas-financial-drain'
  ) then
    perform cron.unschedule('vertexa-asaas-financial-drain');
  end if;
end
$unsched$;

select cron.schedule(
  'vertexa-asaas-financial-drain',
  '* * * * *',
  $cron$select private.invoke_asaas_processor_cron();$cron$
);


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910200000',
  '20260910200000_wp_asaas_04c_auto_drain.sql',
  'WP-ASAAS-04C: cron vertexa-asaas-financial-drain (* * * * *) chama '
  'private.invoke_asaas_processor_cron → Edge asaas-processor-cron. '
  'Vault names only. Kill: cron.unschedule(''vertexa-asaas-financial-drain'').',
  'WP-ASAAS-04C'
)
on conflict (version) do nothing;
