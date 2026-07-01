-- VERTEXA — SEED de DEMO: auto-reportes de peso da Mariana (weight_logs, source='app').
-- Dá vida ao gráfico do Relatório de Evolução (PDF) e à aba Antropometria: 8 pontos semanais
-- decrescentes (~71,5 → 68,4 kg), coerentes com o "peso atual" (68,4) e a meta (62) do cadastro.
-- history de emagrecimento saudável. NÃO altera schema; só dado de seed.
--
-- IDEMPOTENTE: só insere se a Mariana ainda não tiver NENHUM weight_log de origem 'app'
--   (re-rodar não duplica). Rollback do lote:
--   delete from public.weight_logs where patient_id='10000000-0000-0000-0000-0000000000b1' and source='app';

insert into public.weight_logs (patient_id, weight_kg, measured_at, source)
select
  '10000000-0000-0000-0000-0000000000b1'::uuid,
  v.kg,
  (now() - make_interval(weeks => v.wk)),
  'app'
from (values
  (7, 71.5),
  (6, 71.0),
  (5, 70.3),
  (4, 69.6),
  (3, 69.1),
  (2, 68.8),
  (1, 68.6),
  (0, 68.4)
) as v(wk, kg)
where not exists (
  select 1 from public.weight_logs
  where patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid and source = 'app'
);
