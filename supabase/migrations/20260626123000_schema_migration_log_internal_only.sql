-- =====================================================================================
-- VERTEXA - Sessao 7 (correcao): schema_migration_log interno ao Supabase.
-- ADITIVA e reversivel. Nao altera dados clinicos, nao remove tabela e nao apaga historico.
--
-- Rollback:
--   -- Restaura somente o estado anterior de leitura publica do ledger; nao apaga a tabela.
--   grant select on table public.schema_migration_log to anon, authenticated;
--   drop policy if exists miglog_read on public.schema_migration_log;
--   create policy miglog_read on public.schema_migration_log
--     for select to anon, authenticated using (true);
--
-- Motivo:
--   O ledger deve ser registro tecnico interno no Supabase/MCP/migrations, sem API client,
--   rota, hook, componente ou leitura por usuarios do portal.
-- =====================================================================================

alter table public.schema_migration_log enable row level security;

drop policy if exists miglog_read on public.schema_migration_log;

revoke all on table public.schema_migration_log from anon, authenticated;

insert into public.schema_migration_log (version, filename, description, session) values
  (
    '20260626123000',
    '20260626123000_schema_migration_log_internal_only.sql',
    'Correcao S7: remove leitura publica do schema_migration_log e mantem o ledger restrito ao uso tecnico via Supabase/MCP; sem interface no portal.',
    'S7'
  )
on conflict (version) do update set
  filename = excluded.filename,
  description = excluded.description,
  session = excluded.session;
