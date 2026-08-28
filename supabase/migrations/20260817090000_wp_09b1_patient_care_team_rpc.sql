-- =====================================================================================
-- WP-09B1 — RPC pública get_my_care_team(): equipe clínica ATIVA do paciente autenticado.
-- Independente de chat/canal. SEM fórmula, SEM policy, SEM cron, SEM APP.
--
-- CARE TEAM  = professional_patient_links ativos e internos (+ professional.status ativo)
-- CHAT ROSTER = chat_participants / channel_professionals (NÃO entra nesta query)
--
-- Identidade: private.current_patient_id() (JWT → profiles → patients). Zero parâmetros.
-- Não-paciente / não autenticado → zero rows (fail-closed, sem 42501).
--
-- SECURITY DEFINER + search_path='' : atravessa RLS de professionals (paciente não lê a
-- tabela). A barreira de exposição é o RETURN TYPE (projection mínima).
--
-- NÃO APLICAR no remoto neste WP. NÃO alterar APP. NÃO tocar SOS/cron/VRI.
-- =====================================================================================

create or replace function public.get_my_care_team()
returns table (
  professional_id uuid,
  profile_id uuid,
  display_name text,
  avatar_url text,
  type public.professional_type,
  specialty text,
  disciplines text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.profile_id,
    pf.full_name,
    pf.avatar_url,
    pr.type,
    pr.specialty,
    coalesce(
      (
        select array_agg(distinct pd.discipline order by pd.discipline)
          from public.professional_disciplines pd
          join public.disciplines d on d.code = pd.discipline
         where pd.professional_id = pr.id
      ),
      '{}'::text[]
    )
  from public.professional_patient_links l
  join public.professionals pr on pr.id = l.professional_id
  join public.profiles pf on pf.id = pr.profile_id
  where l.patient_id = private.current_patient_id()
    and coalesce(l.status, 'active') = 'active'
    and coalesce(l.is_external, false) = false
    and coalesce(pr.status, 'active') = 'active'
  order by pf.full_name nulls last, pr.id;
$$;

comment on function public.get_my_care_team() is
  'WP-09B1: equipe clínica ATIVA do paciente autenticado. Deriva patient_id de '
  'private.current_patient_id() (JWT). Sem parâmetros. Sem chat. External/inactive ocultos. '
  'Projection mínima (sem email/registry/clínica). STABLE SECURITY DEFINER search_path=''''.';

revoke all on function public.get_my_care_team() from public, anon;
grant execute on function public.get_my_care_team() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260817090000',
  '20260817090000_wp_09b1_patient_care_team_rpc.sql',
  'WP-09B1: public.get_my_care_team() — care team por links ativos internos, JWT-derived, '
  'sem chat, sem policy widening, sem apply remoto.',
  'WP-09B1'
)
on conflict (version) do nothing;
