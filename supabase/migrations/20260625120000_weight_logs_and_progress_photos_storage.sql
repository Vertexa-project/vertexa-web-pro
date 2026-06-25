-- =====================================================================================
-- VERTEXA — Spine de dados (Sessão 1): peso real + storage de fotos de evolução
-- ADITIVA e reversível. NÃO altera tabelas existentes.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md): o app paciente precisa gravar PESO, FOTO e ÁGUA
-- "de verdade". Hoje o app só dispara activity_events SEM valor confiável
-- (weight_logged: {source:'records'} | {weight:..}; progress_photo_uploaded: {}; hydration: {amount}).
-- Esta migration define os pontos canônicos que a web LÊ.
--
-- Rollback:
--   drop table if exists public.weight_logs cascade;
--   delete from storage.buckets where id = 'progress-photos';
--   drop policy if exists sprint_progress_photos_write on storage.objects;
-- =====================================================================================

-- weight_logs: tabela CANÔNICA do VALOR de peso auto-reportado pelo paciente (app).
-- O gráfico de peso da web (Antropometria) lê daqui + de body_assessments (avaliações clínicas).
-- activity_events(type='weight_logged') permanece apenas como MARCADOR de Timeline.
create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  weight_kg numeric not null,
  measured_at timestamptz not null default now(),
  source text not null default 'app',  -- 'app' (paciente) | 'web' (profissional) | outros
  created_at timestamptz not null default now()
);

create index if not exists weight_logs_patient_measured_idx
  on public.weight_logs (patient_id, measured_at desc);

alter table public.weight_logs enable row level security;

-- Policies PERMISSIVAS de sprint (seed fictício). Substituir por RLS por clínica/vínculo (#11–#14).
drop policy if exists sprint_weight_read on public.weight_logs;
create policy sprint_weight_read on public.weight_logs
  for select to anon, authenticated using (true);

drop policy if exists sprint_weight_write on public.weight_logs;
create policy sprint_weight_write on public.weight_logs
  for insert to anon, authenticated with check (true);

-- -------------------------------------------------------------------------------------
-- Storage: bucket PÚBLICO de fotos de evolução (demo).
-- Dívida da Sessão 8: tornar privado + servir via signed URL.
insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', true)
on conflict (id) do nothing;

-- Bucket público já serve DOWNLOAD via URL pública (sem precisar de policy de SELECT).
-- Não criamos policy de SELECT de propósito: evita listagem/enumeração dos arquivos.
-- Só habilitamos o INSERT (upload) para o app na sprint.
drop policy if exists sprint_progress_photos_write on storage.objects;
create policy sprint_progress_photos_write on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'progress-photos');
