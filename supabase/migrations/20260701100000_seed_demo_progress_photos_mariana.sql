-- VERTEXA — SEED de DEMO: 2 fotos de progresso NEUTRAS da Mariana (antes/depois).
-- As imagens são SILHUETAS ilustrativas (sem pessoa real), geradas para a demo e já enviadas
-- ao bucket público progress-photos em demo/mariana/{antes,depois}.png. Aqui só registramos as
-- linhas em progress_photos (a web LÊ photo_url direto). taken_at dentro da janela de 90 dias
-- p/ aparecerem no Relatório de Evolução. captured_in_app=true (origem app, coerente com o fluxo).
--
-- IDEMPOTENTE: só insere a linha se ainda não houver foto da Mariana com aquela URL.
-- Rollback: delete from public.progress_photos where patient_id='10000000-0000-0000-0000-0000000000b1'
--   and photo_url like '%/demo/mariana/%';

insert into public.progress_photos (patient_id, photo_url, captured_in_app, taken_at)
select
  '10000000-0000-0000-0000-0000000000b1'::uuid,
  v.url,
  true,
  v.taken::timestamptz
from (values
  ('https://cdhjfyyuhmwrcuxqavib.supabase.co/storage/v1/object/public/progress-photos/demo/mariana/antes.png', '2026-04-02T09:00:00-03:00'),
  ('https://cdhjfyyuhmwrcuxqavib.supabase.co/storage/v1/object/public/progress-photos/demo/mariana/depois.png', '2026-06-25T09:00:00-03:00')
) as v(url, taken)
where not exists (
  select 1 from public.progress_photos
  where patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid and photo_url = v.url
);
