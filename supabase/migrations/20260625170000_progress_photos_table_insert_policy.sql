-- =====================================================================================
-- VERTEXA — Sessão 2 (app): policy de INSERT na TABELA public.progress_photos
-- ADITIVA e reversível. NÃO altera tabelas existentes.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md #16): o app paciente passa a subir o binário da
-- foto de evolução para o bucket Storage 'progress-photos' (já tem policy de INSERT em
-- 20260625120000) e a inserir a linha em public.progress_photos (patient_id, photo_url,
-- taken_at). A tabela tinha RLS habilitada com apenas SELECT (sprint_read_all) — o INSERT
-- anon era NEGADO. Esta policy fecha o gap simétrico ao bucket. PERMISSIVA de sprint
-- (seed fictício); travar por paciente/clínica antes de dado real (#11–#14).
--
-- Rollback:
--   drop policy if exists sprint_progress_photos_insert on public.progress_photos;
-- =====================================================================================
drop policy if exists sprint_progress_photos_insert on public.progress_photos;
create policy sprint_progress_photos_insert on public.progress_photos
  for insert to anon, authenticated with check (true);
