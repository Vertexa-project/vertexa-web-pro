-- =====================================================================================
-- WP-A2 (AUTH-#22) — CIFRAGEM EM REPOUSO dos tokens do Google Calendar.
-- calendar_connection_tokens é deny-all à Data API (RLS on, 0 policies), MAS refresh_token/
-- access_token estavam em TEXTO CLARO no banco. Aqui passam a ser bytea CIFRADO (pgcrypto
-- pgp_sym_*) com uma chave simétrica guardada no Supabase Vault. Acesso ao token só pelo motor
-- server-side (service_role) via funções SECURITY DEFINER; o client (anon/authenticated) segue
-- SEM qualquer caminho até o token — nem cifrado, nem em claro.
--
-- CHAVE (provisionamento):
--   · Guardada no Vault como secret 'calendar_token_key' (vault.create_secret).
--   · GERADA no APPLY por gen_random_bytes(32)→base64 — a chave NUNCA aparece no texto da migration
--     nem em qualquer bundle. Guard idempotente: só cria se ainda não existir (não regenera, senão
--     invalidaria dados já cifrados). Cada ambiente gera a sua.
--   · Lida só por private.calendar_token_key() (SECURITY DEFINER, fora de schema exposto, REVOKE de
--     anon/authenticated) — vault.decrypted_secrets é acessível ao owner (postgres), não ao client.
--
-- SUPERFÍCIE / EXPOSIÇÃO:
--   · set/get ficam em public (necessário p/ o service_role chamá-las via PostgREST/supabase-js —
--     RPC só alcança schema exposto), MAS com REVOKE ALL de public/anon/authenticated e GRANT EXECUTE
--     só a service_role. Logo NENHUM papel de client (anon/authenticated) executa (403). A lógica de
--     DECIFRA e a leitura da chave ficam server-side; o token decifrado só volta ao service_role.
--   · RLS de calendar_connection_tokens NÃO alterada (segue deny-all, 0 policies).
--
-- DADOS: 0 linhas no apply (janela de risco mínimo) ⇒ é migração de ESTRUTURA. O backfill
-- (decifra→cifra) fica no código por robustez, mas é no-op com 0 linhas.
--
-- ⚠️ DEPLOY COORDENADO (obrigatório): esta migration DROPA as colunas em claro. As Edge Functions
--   google-calendar-callback e google-calendar-sync precisam ser REDEPLOYADAS para a nova versão
--   (que usa set_calendar_tokens/get_calendar_refresh_token/set_calendar_access_token) NO MESMO
--   passo. Aplicar a migration com as functions antigas ainda no ar quebraria o fluxo do calendário
--   (referência a colunas inexistentes). Como há 0 conexões hoje, a janela é segura, mas a ordem
--   correta é: aplicar migration + deploy das 2 functions juntos.
--
-- ROLLBACK (coordenado com redeploy da versão antiga das functions):
--   alter table public.calendar_connection_tokens add column refresh_token text, add column access_token text;
--   update public.calendar_connection_tokens
--     set refresh_token = extensions.pgp_sym_decrypt(refresh_token_enc, private.calendar_token_key()),
--         access_token  = case when access_token_enc is null then null
--                              else extensions.pgp_sym_decrypt(access_token_enc, private.calendar_token_key()) end;
--   alter table public.calendar_connection_tokens
--     alter column refresh_token set not null, drop column refresh_token_enc, drop column access_token_enc;
--   drop function if exists public.set_calendar_tokens(uuid, text, text, timestamptz);
--   drop function if exists public.set_calendar_access_token(uuid, text, timestamptz);
--   drop function if exists public.get_calendar_refresh_token(uuid);
--   drop function if exists private.calendar_token_key();
--   -- a secret do Vault pode ser mantida (inócua) ou removida via vault.
-- =====================================================================================

-- ───────────────────────── 1) Chave no Vault (idempotente; chave nunca em claro aqui) ─────────────
do $prov$
begin
  if not exists (select 1 from vault.secrets where name = 'calendar_token_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'calendar_token_key',
      'WP-A2 (AUTH-#22): chave simetrica p/ cifrar tokens do Google Calendar em repouso (pgcrypto pgp_sym).'
    );
  end if;
end $prov$;

-- ───────────────────────── 2) Leitor da chave (private, fora da Data API) ─────────────────────────
create or replace function private.calendar_token_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'calendar_token_key' limit 1
$$;
revoke all on function private.calendar_token_key() from public, anon, authenticated;

-- ───────────────────────── 3) Colunas cifradas + drop das colunas em claro ────────────────────────
alter table public.calendar_connection_tokens
  add column if not exists refresh_token_enc bytea,
  add column if not exists access_token_enc  bytea;

-- Backfill (no-op com 0 linhas; robustez se houver dado legado em claro).
update public.calendar_connection_tokens
  set refresh_token_enc = extensions.pgp_sym_encrypt(refresh_token, private.calendar_token_key())
  where refresh_token is not null and refresh_token_enc is null;
update public.calendar_connection_tokens
  set access_token_enc = extensions.pgp_sym_encrypt(access_token, private.calendar_token_key())
  where access_token is not null and access_token_enc is null;

alter table public.calendar_connection_tokens drop column refresh_token;
alter table public.calendar_connection_tokens drop column access_token;
alter table public.calendar_connection_tokens alter column refresh_token_enc set not null;

-- ───────────────────────── 4) set/get (public, SECDEF, SÓ service_role) ───────────────────────────
-- Grava (upsert) refresh + access cifrados. Usada pelo callback (1ª autorização).
create or replace function public.set_calendar_tokens(
  p_connection_id uuid,
  p_refresh_token text,
  p_access_token  text default null,
  p_token_expires_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := private.calendar_token_key();
begin
  if v_key is null then
    raise exception 'set_calendar_tokens: calendar_token_key not provisioned' using errcode = '55000';
  end if;
  if p_refresh_token is null then
    raise exception 'set_calendar_tokens: refresh_token is required' using errcode = '22004';
  end if;
  insert into public.calendar_connection_tokens
    (connection_id, refresh_token_enc, access_token_enc, token_expires_at, updated_at)
  values (
    p_connection_id,
    extensions.pgp_sym_encrypt(p_refresh_token, v_key),
    case when p_access_token is null then null else extensions.pgp_sym_encrypt(p_access_token, v_key) end,
    p_token_expires_at,
    now()
  )
  on conflict (connection_id) do update set
    refresh_token_enc = excluded.refresh_token_enc,
    access_token_enc  = excluded.access_token_enc,
    token_expires_at  = excluded.token_expires_at,
    updated_at        = now();
end $$;

-- Atualiza SÓ o access_token cifrado (+ expiração). Usada pelo sync após renovar no Google.
create or replace function public.set_calendar_access_token(
  p_connection_id uuid,
  p_access_token  text,
  p_token_expires_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := private.calendar_token_key();
begin
  if v_key is null then
    raise exception 'set_calendar_access_token: calendar_token_key not provisioned' using errcode = '55000';
  end if;
  update public.calendar_connection_tokens set
    access_token_enc = case when p_access_token is null then null else extensions.pgp_sym_encrypt(p_access_token, v_key) end,
    token_expires_at = p_token_expires_at,
    updated_at       = now()
  where connection_id = p_connection_id;
end $$;

-- Devolve o refresh_token DECIFRADO (só ao service_role). null se não houver linha.
create or replace function public.get_calendar_refresh_token(p_connection_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_key text := private.calendar_token_key(); v_enc bytea;
begin
  if v_key is null then
    raise exception 'get_calendar_refresh_token: calendar_token_key not provisioned' using errcode = '55000';
  end if;
  select refresh_token_enc into v_enc from public.calendar_connection_tokens where connection_id = p_connection_id;
  if v_enc is null then return null; end if;
  return extensions.pgp_sym_decrypt(v_enc, v_key);
end $$;

-- Grants: NENHUM papel de client. Só service_role (o motor server-side) executa.
revoke all on function public.set_calendar_tokens(uuid, text, text, timestamptz)      from public, anon, authenticated;
revoke all on function public.set_calendar_access_token(uuid, text, timestamptz)       from public, anon, authenticated;
revoke all on function public.get_calendar_refresh_token(uuid)                         from public, anon, authenticated;
grant execute on function public.set_calendar_tokens(uuid, text, text, timestamptz)    to service_role;
grant execute on function public.set_calendar_access_token(uuid, text, timestamptz)    to service_role;
grant execute on function public.get_calendar_refresh_token(uuid)                      to service_role;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260724090000','20260724090000_wp_a2_calendar_token_encryption.sql',
  'WP-A2 (AUTH-#22): tokens do Google Calendar cifrados em repouso. refresh_token/access_token (texto '
  'claro) viram bytea cifrado (pgcrypto pgp_sym) com chave no Vault (calendar_token_key). Leitura da '
  'chave por private.calendar_token_key (SECDEF, fora da Data API). set/get em public SECDEF com EXECUTE '
  'so p/ service_role (client sem caminho). RLS deny-all preservada. Requer redeploy coordenado das '
  'Edge Functions callback/sync. 0 linhas no apply.',
  'WP-A2')
on conflict (version) do nothing;
