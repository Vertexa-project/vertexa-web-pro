-- =====================================================================================
-- VERTEXA — coerência temporal do seed da Mariana (#S5-JORNADA): start_date + datas de
-- unlock das conquistas. DADO DE EXIBIÇÃO apenas — NÃO altera o cálculo do VRI/streak.
--
-- Contexto: a narrativa mostrava start_date=30/06 (2 dias) e as 7 conquistas com unlocked_at
-- "hoje" (02/07), contradizendo o histórico real (avaliações desde 15/01, fotos desde 02/04,
-- pesos desde 13/05, 5,8 kg eliminados, streak 18d). Esta migration alinha as datas de EXIBIÇÃO
-- à realidade do dado, sem tocar em activity_events (fonte do streak) nem no adherenceEngine.
--
-- start_date -> 2026-01-15 (1ª body_assessment = início real do acompanhamento; <= 1ª foto 02/04).
-- unlocked_at -> data REAL em que cada critério foi 1ª vez satisfeito (derivada do seed):
--   first_photo 02/04 (1ª progress_photo) · first_weight 13/05 (1º weight_log) ·
--   weight_3kg 20/05 (1º peso <= 71,2) · weight_5kg 10/06 (1º peso <= 69,2) ·
--   streak_7 21/06 (dia 7 da janela 15/06) · first_workout 26/06 (1º workout_checked) ·
--   streak_14 28/06 (dia 14 da janela).
--
-- INVARIANTE: start_date e patient_achievements.unlocked_at NÃO são inputs do adherenceEngine
-- (streak vem só de activity_events). VRI da Mariana segue 96/alta (a232d1a4) — provado por SELECT
-- antes/depois. Idempotente (UPDATEs determinísticos). Escopo: só a Mariana (patients.id ...b1).
-- Aplicada via apply_migration (ledger 20260702220213).
--
-- Rollback:
--   update public.patients set start_date = '2026-06-30'
--     where id = '10000000-0000-0000-0000-0000000000b1';
--   update public.patient_achievements set unlocked_at = '2026-07-02 21:31:00.346242+00'
--     where patient_id = '10000000-0000-0000-0000-0000000000b1';
-- =====================================================================================

update public.patients
  set start_date = '2026-01-15'
  where id = '10000000-0000-0000-0000-0000000000b1';

update public.patient_achievements as pa
  set unlocked_at = v.ts
  from (values
    ('first_photo',   timestamptz '2026-04-02 12:00:00+00'),
    ('first_weight',  timestamptz '2026-05-13 01:24:09+00'),
    ('weight_3kg',    timestamptz '2026-05-20 01:24:09+00'),
    ('weight_5kg',    timestamptz '2026-06-10 01:24:09+00'),
    ('streak_7',      timestamptz '2026-06-21 15:00:00+00'),
    ('first_workout', timestamptz '2026-06-26 15:00:00+00'),
    ('streak_14',     timestamptz '2026-06-28 15:00:00+00')
  ) as v(code, ts)
  where pa.patient_id = '10000000-0000-0000-0000-0000000000b1'
    and pa.achievement_code = v.code;
