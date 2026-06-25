-- =====================================================================================
-- VERTEXA — Sessão 6 (web): SEED fictício de compromissos p/ a agenda da demo.
-- ADITIVA, idempotente e reversível. Só dado de SEED (não altera schema).
--
-- 3 compromissos da Clínica Vértice (c1), ancorados no DIA LOCAL (America/Sao_Paulo, fuso da
-- clínica) para caírem em "hoje/semana" e exibirem horário comercial (09:00/14:30/10:00) no
-- navegador BR. O banco guarda timestamptz (UTC); o `AT TIME ZONE 'America/Sao_Paulo'` converte
-- o horário local desejado para o instante UTC correto. Pacientes/profissionais = IDs do seed.
--
-- Idempotência: só insere se a clínica ainda não tiver nenhum compromisso.
-- Rollback (remove só estes seeds fictícios):
--   delete from public.appointments where clinic_id = '00000000-0000-0000-0000-0000000000c1'
--     and notes like '%[seed-demo]%';
-- =====================================================================================

insert into public.appointments (clinic_id, patient_id, professional_id, title, starts_at, ends_at, notes)
select v.clinic_id, v.patient_id, v.professional_id, v.title, v.starts_at, v.ends_at, v.notes
from (values
  (
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '10000000-0000-0000-0000-0000000000b1'::uuid, -- Mariana
    '00000000-0000-0000-0000-0000000000e2'::uuid, -- Dra. Camila (nutri)
    'Consulta nutricional · Mariana',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '9 hours') at time zone 'America/Sao_Paulo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '9 hours 45 minutes') at time zone 'America/Sao_Paulo',
    'Revisar plano alimentar e metas da semana. [seed-demo]'
  ),
  (
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '10000000-0000-0000-0000-0000000000b2'::uuid, -- Ricardo
    '00000000-0000-0000-0000-0000000000e1'::uuid, -- Dra. Juliana (médica)
    'Retorno · Ricardo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '14 hours 30 minutes') at time zone 'America/Sao_Paulo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '15 hours 15 minutes') at time zone 'America/Sao_Paulo',
    'Avaliar adesão e ajustar acompanhamento. [seed-demo]'
  ),
  (
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '10000000-0000-0000-0000-0000000000b3'::uuid, -- Beatriz
    '00000000-0000-0000-0000-0000000000e2'::uuid, -- Dra. Camila
    'Avaliação física · Beatriz',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day 10 hours') at time zone 'America/Sao_Paulo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day 11 hours') at time zone 'America/Sao_Paulo',
    'Bioimpedância + dobras. [seed-demo]'
  )
) as v(clinic_id, patient_id, professional_id, title, starts_at, ends_at, notes)
-- Guarda alinhada ao escopo do rollback (só os seeds marcados [seed-demo]): re-rodar não
-- duplica os seeds e não é bloqueada por compromissos reais criados pela demo.
where not exists (
  select 1 from public.appointments
  where clinic_id = '00000000-0000-0000-0000-0000000000c1'::uuid and notes like '%[seed-demo]%'
);
