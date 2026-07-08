-- =====================================================================================
-- AUTH-01 (WP-03) — Associação auth.users <-> profiles para login REAL (Google OAuth).
--
-- ADITIVA e NÃO-DESTRUTIVA. Não há DROP/rename/coluna removida; a RLS existente (sprint_*)
-- fica INTOCADA (fechar RLS por papel/clínica é o WP-05 / PENDENCIAS #11-#14). A ÚNICA razão
-- do trigger: `profiles` só tem policy INSERT(role='patient')+SELECT — SEM UPDATE — então o
-- client NÃO consegue setar `auth_user_id`; a associação é feita server-side por uma função
-- SECURITY DEFINER (roda como owner → bypassa RLS SEM alterar policy).
--
-- Contrato de identidade resultante (ver docs/CONTRATO_INTEGRACAO.md):
--   auth.uid() -> profiles.auth_user_id -> profiles.id -> professionals(profile_id) -> clinic.
--
-- Estratégia de 1º login (genérica p/ o app paciente herdar no futuro — item 9 do WP):
--   match-by-email PRIMEIRO (só se houver EXATAMENTE 1 profile órfão com aquele e-mail);
--   SENÃO cria um profile 'pending' (sem professional/clinic → tela PendingAccess na web).
--   ⚠️ Enquanto o app paciente NÃO usa auth real (só a web faz signup hoje), um e-mail novo =
--   profissional novo. Quando o app adotar auth real, revisar o role do 'pending' (usar
--   raw_user_meta_data), pois um paciente novo NÃO deve virar 'professional'.
--
-- Rollback (é aditiva → reversível):
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_user();
--   drop index if exists public.profiles_auth_user_id_key;
--   alter table public.profiles drop column if exists status;
-- =====================================================================================

-- 1) Índice ÚNICO PARCIAL: 1 profile por auth user + acelera o lookup por auth_user_id.
--    (Antes: nenhum índice/unique em auth_user_id → scan + risco de 2 profiles p/ 1 user.)
create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

-- 2) Coluna de estado (opcional, recomendada). Default 'active' → todos os profiles atuais
--    (seed) viram 'active'; só o profile criado no 1º login sem match vira 'pending'.
alter table public.profiles add column if not exists status text not null default 'active';
comment on column public.profiles.status is
  'active | pending. pending = profissional criado no 1o login (Google) sem match por e-mail: '
  'sem professional/clinic vinculados -> a web mostra PendingAccess. RLS real por papel/clinica = WP-05.';

-- 3) Função de associação (SECURITY DEFINER, search_path fixo, idempotente, NUNCA aborta o
--    signup). Roda como owner (postgres) → bypassa a RLS permissiva SEM alterar nenhuma policy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match_count int;
  v_profile_id  uuid;
begin
  -- Idempotência: se este auth user já está associado, nada a fazer.
  if exists (select 1 from public.profiles where auth_user_id = new.id) then
    return new;
  end if;

  -- Match por e-mail (case/trim-insensitive) — SOMENTE se houver EXATAMENTE 1 profile órfão.
  -- (NÃO usar min(id): não existe agregado min(uuid) no Postgres — quebraria a função.)
  select count(*)
    into v_match_count
  from public.profiles
  where auth_user_id is null
    and email is not null
    and new.email is not null
    and lower(btrim(email)) = lower(btrim(new.email));

  if v_match_count = 1 then
    select id
      into v_profile_id
    from public.profiles
    where auth_user_id is null
      and email is not null
      and new.email is not null
      and lower(btrim(email)) = lower(btrim(new.email))
    limit 1;
    -- Vincula o profile já existente (profissional semeado/convidado) ao auth user.
    update public.profiles set auth_user_id = new.id where id = v_profile_id;
  else
    -- Sem match único → cria um profile 'pending' (sem professional/clinic).
    insert into public.profiles (auth_user_id, role, full_name, email, status)
    values (
      new.id,
      'professional',
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        new.email,
        'Novo profissional'
      ),
      new.email,
      'pending'
    );
  end if;

  return new;
exception
  when others then
    -- NUNCA abortar o signup por causa da associação — apenas registra e segue.
    raise warning '[handle_new_user] associacao ignorada para %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- É função de trigger — não deve ser chamável diretamente por anon/authenticated.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- 4) Trigger no signup de auth.users (idempotente).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Ledger técnico interno (companion legível; não substitui a tabela do CLI).
insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260708120000',
  '20260708120000_auth_user_link.sql',
  'AUTH-01/WP-03: associacao auth.users<->profiles p/ login Google. Indice unico parcial em '
  'profiles(auth_user_id) + coluna status + funcao/trigger handle_new_user SECURITY DEFINER '
  '(match-by-email; senao cria pending). ADITIVA; RLS sprint intocada.',
  'AUTH-01'
)
on conflict (version) do nothing;
