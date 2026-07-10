-- =====================================================================================
-- WP-05B · FAMÍLIA 8 (legado `messages`) — APOSENTADORIA por DROP (destrutiva/contração).
-- ÚLTIMA família de banco da Fase B. Fecha a DÍVIDA #15.
--
-- VEREDITO DA PROVA (Passo 1, banco vivo + grep read-only):
--   • public.messages: 0 linhas (purgada na Fase A); só a policy sprint_read_all (SELECT); NÃO está em
--     supabase_realtime; grants anon/authenticated (irrelevantes após o drop).
--   • FK DE TERCEIROS apontando p/ messages: NENHUMA (pg_constraint confrelid=messages -> vazio) => drop FK-safe.
--   • Código WEB (vertexa-web-pro/src): 0 referências de uso — único match é um COMENTÁRIO em types/db.ts
--     ("substitui a tabela legada `messages`"); nenhum from('messages')/insert/update/select/subscribe.
--   • Código APP (vertexa-app-paciente/src): 0 referências (from('messages') -> nenhum match).
--   => messages está COMPROVADAMENTE MORTA. Substituída pelo chat_* (Família 4). Caminho A = DROP.
-- Dry-run do DROP em transação com ROLLBACK confirmou que nenhum dependente bloqueia.
--
-- Natureza: DESTRUTIVA/de CONTRAÇÃO (remove objeto de estrutura). Idempotente (guard: só dropa se existir).
--
-- ROLLBACK conhecido (recriar a tabela VAZIA a partir da definição original do base_schema
-- 20260617100000; não há dado a restaurar — 0 linhas):
--   create table if not exists public.messages (
--     id uuid primary key default gen_random_uuid(),
--     patient_id uuid references public.patients(id) on delete cascade,
--     sender_role user_role not null,
--     sender_professional_id uuid references public.professionals(id),
--     body text not null,
--     created_at timestamptz default now()
--   );
--   alter table public.messages enable row level security;
--   -- (NÃO recriar a sprint_read_all anon; se precisar, aplicar RLS real por família.)
-- =====================================================================================

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'messages') then
    drop table public.messages;  -- remove também a policy sprint_read_all e os grants da tabela
  end if;
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260718090000','20260718090000_wp05b_fam8_drop_legacy_messages.sql',
  'WP-05B Fam8: DROP da tabela legada public.messages (aposentadoria; DIVIDA #15). Prova: 0 linhas, 0 FK '
  'de terceiros, 0 uso no web e no app, fora do realtime -> MORTA (substituida por chat_*). Rollback = '
  'recriar tabela vazia (CREATE original no header). Ultima familia de banco da Fase B.',
  'WP-05B-FAM8')
on conflict (version) do nothing;
