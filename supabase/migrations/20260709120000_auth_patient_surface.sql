-- =====================================================================================
-- AUTH-02 (WP-04 Parte A) — handle_new_user() CIENTE DE SUPERFÍCIE + FAIL-CLOSED + diagnóstico.
--
-- ADITIVA e NÃO-DESTRUTIVA. Estende o trigger do WP-03 (20260708120000). PRESERVA integralmente:
--   • o provider-gate Google (raw_app_meta_data — setado pelo GoTrue/OAuth, NÃO pelo client) contra
--     account-takeover;
--   • o MATCH por e-mail ROLE-AGNÓSTICO (casa 1 profile órfão e preserva o ROLE existente dele —
--     paciente semeado linka como 'patient', profissional como 'professional', admin como 'admin').
-- Nenhuma policy RLS sprint_* é alterada (fechar por papel/clínica = WP-05). Sem DROP/rename.
--
-- MUDANÇA (NO-MATCH → FAIL-CLOSED): antes o ramo sem match criava um pending 'professional'. Isso é
-- INSEGURO porque o único sinal de "superfície" (raw_user_meta_data.signup_surface) é USER_METADATA,
-- CONTROLÁVEL PELO CLIENT — um app paciente (ou um atacante) poderia omitir/forjar a superfície e
-- obter um pending de MAIOR privilégio. Regra nova: **NO-MATCH SEMPRE cria um pending NEUTRO de menor
-- privilégio ('patient'), NUNCA 'professional'**. `signup_surface` vira APENAS diagnóstico (telemetria
-- do outcome), jamais seleciona/concede role. Promoção a 'professional' passa a exigir mecanismo
-- CONFIÁVEL posterior (convite/admin/provisioning server-side), fora deste default.
--
-- DÍVIDA-AUTH-2 (observabilidade do trigger): o `EXCEPTION WHEN OTHERS then return new` mudo vira log
-- técnico SEM PII — RAISE WARNING com SQLSTATE (nunca SQLERRM, que pode conter e-mail) + uma linha em
-- public.auth_trigger_events (auth_user_id uuid opaco + surface + outcome + sqlstate; SEM e-mail/nome),
-- deny-all para anon/authenticated. Diagnóstico sem depender de Sentry no Postgres.
--
-- Endurecimento (revisão adversarial, 2 achados low corrigidos):
--   1) provider-gate FAIL-CLOSED em NULL: `coalesce(...='google', false)` evita a lógica de 3 valores
--      (provider ausente/NULL antes fazia o IF de skip não disparar = fail-OPEN). Não é alcançável por
--      client anon (o GoTrue sempre seta provider), mas fecha o vetor por defesa em profundidade.
--   2) `surface` NORMALIZADA a {web,patient_app,other} → o client não injeta texto livre/PII na tabela
--      de diagnóstico (antes gravava `signup_surface` verbatim, ilimitado).
--
-- Rollback (aditiva → reversível): restaurar a função do WP-03 (20260708120000); e opcionalmente
--   drop function if exists public.log_auth_trigger_event(uuid,text,text,text);
--   drop table if exists public.auth_trigger_events;
-- =====================================================================================

-- 1) Tabela de diagnóstico técnico (SEM PII). deny-all para anon/authenticated.
create table if not exists public.auth_trigger_events (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid,                    -- uuid OPACO (não é e-mail/nome); correlação técnica
  surface      text,                    -- signup_surface (diagnóstico; NÃO concede privilégio)
  outcome      text not null check (outcome in (
                 'linked', 'pending_patient', 'pending_professional',
                 'skipped_unverified_provider', 'error')),
  sqlstate     text,                    -- código técnico do erro (5 chars); JAMAIS SQLERRM/PII
  created_at   timestamptz not null default now()
);
comment on table public.auth_trigger_events is
  'AUTH-02: diagnóstico técnico do trigger handle_new_user. SEM PII (auth_user_id uuid opaco + surface '
  '+ outcome + sqlstate). RLS on, deny-all p/ anon/authenticated; só a função SECURITY DEFINER escreve.';
alter table public.auth_trigger_events enable row level security;
-- Sem policies → nega anon/authenticated. Revoga privilégios de tabela por segurança em profundidade.
revoke all on public.auth_trigger_events from anon;
revoke all on public.auth_trigger_events from authenticated;

-- 2) Helper de log best-effort: SWALLOW próprio (uma falha de diagnóstico NUNCA aborta o signup).
create or replace function public.log_auth_trigger_event(
  p_auth_user_id uuid,
  p_surface      text,
  p_outcome      text,
  p_sqlstate     text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.auth_trigger_events (auth_user_id, surface, outcome, sqlstate)
  values (p_auth_user_id, p_surface, p_outcome, p_sqlstate);
exception
  when others then
    null; -- diagnóstico é best-effort; nunca propaga (não pode abortar o signup).
end;
$$;
revoke all on function public.log_auth_trigger_event(uuid, text, text, text) from public;
revoke all on function public.log_auth_trigger_event(uuid, text, text, text) from anon;
revoke all on function public.log_auth_trigger_event(uuid, text, text, text) from authenticated;

-- 3) Função de associação — CIENTE DE SUPERFÍCIE + FAIL-CLOSED + diagnóstico.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match_count int;
  v_profile_id  uuid;
  v_surface     text;
  v_is_google   boolean;
  v_outcome     text;
begin
  -- Idempotência: já associado → nada a fazer (não loga re-disparos).
  if exists (select 1 from public.profiles where auth_user_id = new.id) then
    return new;
  end if;

  -- Superfície de signup — DIAGNÓSTICO apenas. user_metadata é CONTROLÁVEL PELO CLIENT, então
  -- NUNCA seleciona/concede role. NORMALIZADA a um conjunto FIXO ({web,patient_app,other}) para o
  -- client NÃO conseguir injetar texto livre/PII na tabela de diagnóstico.
  v_surface := case
    when new.raw_user_meta_data ->> 'signup_surface' = 'patient_app' then 'patient_app'
    when new.raw_user_meta_data ->> 'signup_surface' = 'web'         then 'web'
    else 'other'
  end;

  -- Gate de segurança (PRESERVADO do WP-03), agora FAIL-CLOSED em NULL: só provedor CONFIÁVEL
  -- (Google) + e-mail confirmado. raw_app_meta_data é setado pelo GoTrue/OAuth, NÃO pelo client.
  -- `coalesce(... = 'google', false)` evita a lógica de 3 valores: provider ausente/NULL → false →
  -- NÃO associa (antes, `NULL = 'google'` = NULL fazia o IF de skip não disparar = fail-OPEN).
  v_is_google :=
    coalesce(new.raw_app_meta_data ->> 'provider' = 'google', false)
    or coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google';

  if new.email_confirmed_at is null or not v_is_google then
    perform public.log_auth_trigger_event(new.id, v_surface, 'skipped_unverified_provider', null);
    return new;
  end if;

  -- MATCH por e-mail ROLE-AGNÓSTICO (PRESERVADO): casa EXATAMENTE 1 profile órfão (case/trim) e
  -- preserva o ROLE existente dele (paciente→patient, profissional→professional, admin→admin).
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
    update public.profiles set auth_user_id = new.id where id = v_profile_id;
    v_outcome := 'linked';
  else
    -- NO-MATCH → FAIL-CLOSED. SEMPRE cria um pending NEUTRO de MENOR privilégio ('patient'),
    -- NUNCA 'professional'. O único sinal aqui (superfície) é CONTROLÁVEL PELO CLIENT → não pode
    -- elevar privilégio. Promoção a 'professional' exige mecanismo CONFIÁVEL posterior
    -- (convite/admin/provisioning server-side), jamais este default.
    insert into public.profiles (auth_user_id, role, full_name, email, status)
    values (
      new.id,
      'patient',
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        new.email,
        'Novo usuário'
      ),
      new.email,
      'pending'
    );
    v_outcome := 'pending_patient';
  end if;

  perform public.log_auth_trigger_event(new.id, v_surface, v_outcome, null);
  return new;

exception
  when others then
    -- NUNCA abortar o signup. Log técnico SEM PII: só id + SQLSTATE (jamais SQLERRM/e-mail/nome).
    raise warning '[handle_new_user] falha assoc user=% sqlstate=%', new.id, sqlstate;
    perform public.log_auth_trigger_event(new.id, coalesce(v_surface, 'other'), 'error', sqlstate);
    return new;
end;
$$;

-- REVOKE mantido (função de trigger; não chamável por anon/authenticated).
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- 4) Ledger técnico interno.
insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260709120000',
  '20260709120000_auth_patient_surface.sql',
  'AUTH-02/WP-04: handle_new_user ciente de superficie (FAIL-CLOSED) — NO-MATCH sempre cria patient '
  'pending neutro (nunca professional via metadata controlavel pelo client); provider-gate Google e '
  'match por e-mail role-agnostico PRESERVADOS. Tabela de diagnostico auth_trigger_events (deny-all, '
  'sem PII) + helper log best-effort. DIVIDA-AUTH-2 (log SQLSTATE, nao SQLERRM). ADITIVA; RLS intocada.',
  'AUTH-02'
)
on conflict (version) do nothing;
