# Apply S7 Ledger Hardening

Status: `APLICADA` — aplicada no Supabase remoto em 2026-06-26 (Sessão 8) via MCP administrativo.

> Resultado pós-aplicação (validado): `schema_migration_log` com **12 linhas**; **nenhuma** policy
> `anon`/`authenticated` (`miglog_read` removida); `has_table_privilege('anon'|'authenticated', …, 'select')`
> = **false**; `relrowsecurity` = **true**. Não foram usados `supabase db push` nem `supabase db reset`.
>
> Este runbook é mantido como registro reproduzível. Na sessão anterior o status era
> `BLOCKED_REMOTE_MIGRATION` (sem MCP admin); a S8 obteve acesso MCP e aplicou.

This runbook is for the Supabase project owner or an operator with administrative SQL access. Do not use `supabase db push` or `supabase db reset`.

## Context

The web repository already contains and pushed:

```text
supabase/migrations/20260626123000_schema_migration_log_internal_only.sql
```

The SQL below was applied exactly once through the MCP admin channel. Re-running it is idempotent
(`on conflict do update` on the ledger row; `revoke`/`drop policy if exists` are safe to repeat).

## SQL To Apply

```sql
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
```

## Validation Queries

Run after applying the SQL:

```sql
select count(*) as ledger_rows
from public.schema_migration_log;
```

Expected: equals the number of local `.sql` files in `supabase/migrations/` (`12` as of `20260626123000`).

```sql
select policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'schema_migration_log';
```

Expected: no public read policy for `anon` or `authenticated`; specifically, no `miglog_read`.

```sql
select
  has_table_privilege('anon', 'public.schema_migration_log', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.schema_migration_log', 'select') as authenticated_can_select;
```

Expected:

```text
anon_can_select = false
authenticated_can_select = false
```

```sql
select relrowsecurity
from pg_class
where oid = 'public.schema_migration_log'::regclass;
```

Expected:

```text
relrowsecurity = true
```

```sql
select version, filename, session
from public.schema_migration_log
where version = '20260626123000';
```

Expected: one row for `20260626123000_schema_migration_log_internal_only.sql`.

## Do Not

- Do not run `supabase db push`.
- Do not run `supabase db reset`.
- Do not edit old migrations.
- Do not delete `public.schema_migration_log`.
- Do not delete existing ledger rows.
- Do not change clinical, patient, plan, chat, photo, or agenda policies in this operation.
