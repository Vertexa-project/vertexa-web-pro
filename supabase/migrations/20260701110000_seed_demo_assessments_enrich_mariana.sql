-- VERTEXA — SEED de DEMO: enriquece as avaliações da Mariana DENTRO da janela de 90 dias
-- (abr→jul/2026) para o Relatório de Evolução nascer CHEIO e COERENTE com a curva de peso:
--   • peso monotônico DESCENDENTE (alinhado à série weight_logs do app: ~71,5 → 68,4)
--   • body_fat_pct em ≥2 avaliações (29,0% → 25,8%) → "Variação" de gordura deixa de ser "—"
--   • measurements (jsonb) com circunferências (cintura/quadril/abdômen, em cm) caindo levemente
--     → tabela de antropometria ganha linhas de medidas.
--
-- Corrige a INCOERÊNCIA anterior: a avaliação de 2026-06-10 tinha 71,2 kg (SUBINDO contra a
-- tendência). Aqui as duas avaliações de junho já existentes são AJUSTADAS para valores coerentes,
-- e três novas (abr/mai/jun) são inseridas. Chaves de measurements: cintura|quadril|abdomen
-- (nenhum consumidor no código depende de chaves específicas — livre para definir).
--
-- Série clínica final no período (por data): 71,5 → 70,5 → 69,6 → 69,1 → 68,5 (todas descendo).
-- IDEMPOTENTE: updates por (paciente, data) reaplicam o mesmo valor; inserts guardados por data.
-- Rollback dos inserts: delete from public.body_assessments where patient_id='10000000-0000-0000-0000-0000000000b1'
--   and assessed_at in ('2026-04-10','2026-05-25','2026-06-28');

-- 1) AJUSTA as duas avaliações de junho já existentes (corrige o pico de 71,2 e adiciona gordura/medidas).
update public.body_assessments
set weight = 69.6, body_fat_pct = 27.0,
    measurements = '{"cintura":85,"quadril":102,"abdomen":88}'::jsonb
where patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid and assessed_at = '2026-06-01';

update public.body_assessments
set weight = 69.1, body_fat_pct = 26.6,
    measurements = '{"cintura":84,"quadril":101,"abdomen":87}'::jsonb
where patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid and assessed_at = '2026-06-10';

-- 2) INSERE três avaliações no período (idempotente por data).
insert into public.body_assessments
  (patient_id, professional_id, assessed_at, method, weight, body_fat_pct, measurements)
select
  '10000000-0000-0000-0000-0000000000b1'::uuid,
  '00000000-0000-0000-0000-0000000000e1'::uuid,
  v.d::date, 'bioimpedancia', v.w, v.bf, v.m::jsonb
from (values
  ('2026-04-10', 71.5, 29.0, '{"cintura":89,"quadril":106,"abdomen":93}'),
  ('2026-05-25', 70.5, 28.0, '{"cintura":87,"quadril":104,"abdomen":90}'),
  ('2026-06-28', 68.5, 25.8, '{"cintura":82,"quadril":99,"abdomen":85}')
) as v(d, w, bf, m)
where not exists (
  select 1 from public.body_assessments
  where patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid and assessed_at = v.d::date
);
