-- =====================================================================================
-- WP-CLINIC-ADMIN-SIGNAL — sinal de "sou admin da clínica?" exposto ao client.
--
-- PROBLEMA (AUTH-ADMIN-1): a UI decidia "é admin?" por profiles.role = 'admin'. Esse é o
-- anti-padrão que o banco proíbe desde a Família 1: a autoridade REAL é ser DONO
-- (clinics.owner_profile_id) OU co-admin (professionals.clinic_role = 'admin'). No fluxo real o
-- admin de verdade frequentemente NÃO tem profiles.role='admin' — e por isso não via a tela de
-- disciplinas, travando o sistema (só admin atribui disciplinas).
--
-- SOLUÇÃO: expor UMA função booleana que responde a pergunta com a MESMA lógica de
-- private.is_clinic_admin — sem vazar nada além do booleano. A função DELEGA a
-- private.is_clinic_admin (não copia a regra: impossível divergir). Quando p_clinic é null,
-- resolve a clínica do usuário logado (profissional/co-admin via professionals; senão dono via
-- clinics.owner_profile_id).
--
-- ESCOPO/SEGURANÇA:
--  · SECURITY DEFINER + set search_path='' (padrão do projeto; referências totalmente qualificadas).
--  · EXECUTE só para authenticated; revoke de public/anon (não é endpoint anônimo).
--  · SÓ retorna boolean — não expõe id de clínica, papéis, nem linhas.
--  · NÃO altera NENHUMA policy existente. NÃO cria tabela. Apenas 1 função nova em public.
--  · Idempotente (create or replace).
--
-- ROLLBACK (kill switch): a função é puramente aditiva e não muda autorização de nada no banco
-- (a RLS já é a barreira real). Para reverter, basta removê-la — a UI cai no fallback fail-closed
-- (não mostra a área de admin), o que é seguro:
--   revoke all on function public.am_i_clinic_admin(uuid) from authenticated;
--   drop function if exists public.am_i_clinic_admin(uuid);
-- =====================================================================================

create or replace function public.am_i_clinic_admin(p_clinic uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- MESMA lógica de autoridade: delega ao helper canônico (dono OU clinic_role='admin').
  select private.is_clinic_admin(
    coalesce(
      p_clinic,
      -- clínica do PROFISSIONAL logado (co-admin ou profissional comum)
      (select pr.clinic_id
         from public.professionals pr
        where pr.profile_id = private.current_profile_id()
        limit 1),
      -- ou clínica da qual o usuário logado é DONO (owner que não é professional)
      (select c.id
         from public.clinics c
        where c.owner_profile_id = private.current_profile_id()
        limit 1)
    )
  )
$$;

-- Não é endpoint público: só authenticated executa.
revoke all     on function public.am_i_clinic_admin(uuid) from public, anon;
grant  execute on function public.am_i_clinic_admin(uuid) to authenticated;

-- Ledger humano (companion PT-BR; deny-all, só alimentado por migration).
insert into public.schema_migration_log (version, filename, description, session)
values ('20260726090000','20260726090000_wp_clinic_admin_signal.sql',
  'WP-CLINIC-ADMIN-SIGNAL: expõe public.am_i_clinic_admin(uuid default null) -> boolean (SECDEF, '
  'search_path='''', só authenticated) que DELEGA a private.is_clinic_admin (dono OU clinic_role=admin). '
  'p_clinic null resolve a clínica do logado (professionals; senão clinics.owner_profile_id). Corrige '
  'AUTH-ADMIN-1 (UI decidia admin por profiles.role). Aditiva: nenhuma policy tocada; só retorna boolean.',
  'WP-CLINIC-ADMIN-SIGNAL')
on conflict (version) do nothing;
