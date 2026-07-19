-- =====================================================================================
-- WP-HARDENING · A5 (DÍVIDA-STORAGE-3) — progress_photos.photo_url passa a ser NULLABLE.
-- Contexto: o bucket progress-photos virou PRIVADO (WP-STORAGE P1). A coluna photo_url é NOT NULL e
-- guardava uma URL PÚBLICA que HOJE NÃO FUNCIONA (bucket privado). A leitura já usa storage_path +
-- signed URL, com photo_url só como FALLBACK legado. O app ainda é obrigado a gravar photo_url por
-- causa do NOT NULL — este WP tira essa obrigação.
--
-- AÇÃO: apenas afrouxa a constraint (DROP NOT NULL). NÃO dropa a coluna — registros legados podem ter
-- photo_url e a leitura mantém o fallback. Depois disto, o app (Parte B / B2) para de gravar photo_url
-- e passa a gravar só storage_path (as duas partes são PRs separados; A5 entra ANTES de B2).
--
-- ESTADO DOS DADOS (auditado agora, read-only): progress_photos tem 0 linhas (demo purgada) ⇒
-- alteração sem impacto em dados existentes. Nada a backfillar.
--
-- ROLLBACK (só se ninguém tiver gravado NULL ainda; caso contrário exige backfill antes):
--   alter table public.progress_photos alter column photo_url set not null;
-- =====================================================================================

alter table public.progress_photos alter column photo_url drop not null;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260723092000','20260723092000_wp_hardening_a5_progress_photos_photo_url_nullable.sql',
  'WP-HARDENING A5 (DIVIDA-STORAGE-3): progress_photos.photo_url DROP NOT NULL. Bucket privado desde '
  'WP-STORAGE P1; leitura usa storage_path+signed URL com photo_url so como fallback legado. Coluna '
  'NAO dropada (fallback de leitura). 0 linhas na tabela no momento da alteracao.',
  'WP-HARDENING')
on conflict (version) do nothing;
