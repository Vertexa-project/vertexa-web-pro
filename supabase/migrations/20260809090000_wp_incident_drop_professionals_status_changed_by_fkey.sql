-- =====================================================================================
-- INCIDENTE (2026-07-30) · MITIGAÇÃO — remove SOMENTE a FK de professionals.status_changed_by.
--
-- ⚠️ A COLUNA FICA. Só a constraint sai. `status_changed_by` continua sendo gravada pelas RPCs
-- deactivate_professional/reactivate_professional (autor do servidor, via current_profile_id) e a
-- trilha imutável professional_status_events NÃO é tocada: quem desativou continua registrado, em
-- duas colunas e uma tabela de eventos.
--
-- O QUE QUEBROU, e por quê
-- A migration 20260808090000 (WP-TEAM-2b-ii) acrescentou:
--     alter table public.professionals add column status_changed_by uuid references public.profiles(id)
-- Isso criou o SEGUNDO caminho professionals -> profiles. A partir daí o PostgREST não consegue
-- mais decidir por qual relação embutir `profiles` a partir de `professionals`, e passou a
-- responder 300 / PGRST201 ("Could not embed because more than one relationship was found for
-- 'professionals' and 'profiles'") para TODO embed dessa dupla — inclusive o do caminho de
-- IDENTIDADE do painel:
--     professionals?select=id,profile_id,clinic_id,type,profile:profiles(full_name,role)
-- Com essa consulta em erro, `getCurrentProfessional` devolve erro, a identidade do profissional
-- não resolve e o painel trata todo mundo como acesso pendente — inclusive a dona da clínica.
-- Medido em produção: 6 consultas do painel em 300 (identidade, equipe, agenda, listagem de
-- pacientes, time de cuidado, profissionais da clínica).
--
-- POR QUE REMOVER A FK, E NÃO CONSERTAR O FRONTEND AGORA
-- O conserto certo é desambiguar os embeds pelo NOME da constraint
-- (`profile:profiles!professionals_profile_id_fkey(...)`) — provado: devolve 200. Mas isso é
-- frontend, exige build e deploy, e o deploy deste repositório está bloqueado por autor. Remover a
-- constraint restaura o comportamento do PostgREST SEM deploy e sem tocar em policy, função,
-- privilégio ou dado.
--
-- O QUE SE PERDE ENQUANTO ISSO DURA
-- A garantia declarativa de que `status_changed_by` aponta para um profile existente. Não há órfão
-- hoje (0 linhas com status_changed_by preenchido) e o valor só é escrito por RPC SECURITY DEFINER
-- a partir de private.current_profile_id() — não é forjável pelo cliente. A perda é de rede de
-- segurança, não de integridade atual.
--
-- REVERSÃO (Fase 2, depois que o frontend desambiguar os 6+ embeds):
--   alter table public.professionals
--     add constraint professionals_status_changed_by_fkey
--     foreign key (status_changed_by) references public.profiles(id);
--
-- NÃO ALTERA: nenhuma policy, nenhum helper de private, nenhuma âncora, nenhum privilégio,
-- nenhuma linha de dado. Só some 1 constraint.
-- =====================================================================================

alter table public.professionals drop constraint if exists professionals_status_changed_by_fkey;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260809090000','20260809090000_wp_incident_drop_professionals_status_changed_by_fkey.sql',
  'INCIDENTE 2026-07-30: remove APENAS a constraint professionals_status_changed_by_fkey (a COLUNA '
  'permanece). A FK criada pela 20260808090000 abriu um SEGUNDO caminho professionals->profiles e '
  'tornou ambiguo todo embed do PostgREST entre as duas tabelas (300 / PGRST201), derrubando o '
  'caminho de identidade do painel (getCurrentProfessional) e mais 5 consultas. A trilha de quem '
  'desativou continua: a coluna segue gravada pelas RPCs e professional_status_events esta intacta. '
  'A FK volta na Fase 2, depois que o frontend desambiguar os embeds pelo nome da constraint '
  '(profile:profiles!professionals_profile_id_fkey). Nenhuma policy, helper, privilegio ou dado alterado.',
  'INCIDENTE-EMBED-AMBIGUO')
on conflict (version) do nothing;
