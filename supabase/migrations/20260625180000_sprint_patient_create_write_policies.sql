-- =====================================================================================
-- VERTEXA — Sessão 4 (web): policies de INSERT para CADASTRO de paciente pela web pro.
-- ADITIVA e reversível. NÃO altera tabelas/colunas existentes (só cria policies).
--
-- Contexto: a tela de Pacientes ganha "Cadastrar novo paciente", que cria de verdade no
-- banco. O nome do paciente vive em profiles.full_name (não há name em patients), então o
-- fluxo insere: profiles (role='patient') -> patients -> professional_patient_links
-- (vincula o profissional logado) -> body_assessments (anamnese/pré-consulta, opcional).
-- Essas 4 tabelas tinham RLS habilitada com apenas SELECT (sprint_read_all) — o INSERT
-- anon/authenticated era NEGADO. Estas policies fecham o gap, no MESMO padrão permissivo
-- de sprint já usado por activity_events/muscle/planos/chat (with check (true)).
--
-- ⚠️ TEMPORÁRIA — SPRINT. Só com seed/dados fictícios. Antes de dado real, trocar por RLS
-- por papel/clínica/vínculo (admin vê a clínica; profissional via professional_patient_links;
-- externo só o vinculado) — ver docs/PENDENCIAS.md #11–#14. Isolamento de clínica HOJE é
-- aplicado no client (clinic_id do profissional logado); validar no servidor antes de produção.
--
-- Rollback:
--   drop policy if exists sprint_profile_write on public.profiles;
--   drop policy if exists sprint_patient_write on public.patients;
--   drop policy if exists sprint_patient_link_write on public.professional_patient_links;
--   drop policy if exists sprint_body_assessment_write on public.body_assessments;
-- =====================================================================================

-- profiles — o cadastro cria o profile (role='patient', full_name) do novo paciente.
-- Restringimos o INSERT a role='patient': profiles é a ÚNICA das 4 tabelas que controla
-- PAPEL, e o único uso legítimo do INSERT pela web é criar paciente. Sem isso, um client
-- anon poderia forjar role='admin'/'professional' (escalonamento dentro do modelo de
-- permissão). RLS por papel/clínica de verdade segue como dívida (#11–#14).
drop policy if exists sprint_profile_write on public.profiles;
create policy sprint_profile_write on public.profiles
  for insert to anon, authenticated with check (role = 'patient');

-- patients — a linha do paciente em si (profile_id, clinic_id, goal, antropometria base).
drop policy if exists sprint_patient_write on public.patients;
create policy sprint_patient_write on public.patients
  for insert to anon, authenticated with check (true);

-- professional_patient_links — vincula o profissional logado ao novo paciente.
drop policy if exists sprint_patient_link_write on public.professional_patient_links;
create policy sprint_patient_link_write on public.professional_patient_links
  for insert to anon, authenticated with check (true);

-- body_assessments — anamnese/pré-consulta + antropometria inicial (opcional no cadastro).
drop policy if exists sprint_body_assessment_write on public.body_assessments;
create policy sprint_body_assessment_write on public.body_assessments
  for insert to anon, authenticated with check (true);
