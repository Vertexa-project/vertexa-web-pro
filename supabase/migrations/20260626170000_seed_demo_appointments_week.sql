-- =====================================================================================
-- VERTEXA — Sessão 12.1 (web): SEED da SEMANA p/ a demo do calendário ficar VIVO.
-- ADITIVA, idempotente e reversível. Só dado de SEED (não altera schema). COMPLEMENTA o seed da
-- S6 (`20260626093000`, marcador [seed-demo]); NÃO apaga nada existente.
--
-- ~17 compromissos plausíveis na SEMANA CORRENTE e na próxima, ancorados em
-- `date_trunc('week', now() at time zone 'America/Sao_Paulo')` (segunda 00:00, fuso da clínica) +
-- offsets de dia/hora — assim a semana parece sempre "atual" na demo. Só entidades do seed:
-- clínica c1; pacientes b1 Mariana / b2 Ricardo / b3 Beatriz; profissionais e1 Dra. Juliana (médica)
-- / e2 Dra. Camila (nutri). Mix de type (consulta/retorno/previsao_retorno/outros) e status
-- (confirmado/pendente/desmarcado) p/ todas as cores e a risca aparecerem. Horários 08:00–19:00,
-- durações clínicas (30–60min). Eventos 'outros' (bloqueio/reunião) NÃO têm paciente.
--
-- Idempotência: marcador próprio `[seed-s12.1]` + `where not exists` — re-rodar não duplica.
-- Rollback (remove só este lote): delete from public.appointments where notes like '%[seed-s12.1]%';
-- =====================================================================================

insert into public.appointments (clinic_id, patient_id, professional_id, title, type, status, starts_at, ends_at, notes)
select
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  nullif(v.patient_id, '')::uuid,
  v.professional_id::uuid,
  v.title,
  v.type,
  v.status,
  (base.wk + make_interval(days => v.day_off, hours => v.sh, mins => v.sm)) at time zone 'America/Sao_Paulo',
  (base.wk + make_interval(days => v.day_off, hours => v.sh, mins => v.sm + v.dur)) at time zone 'America/Sao_Paulo',
  '[seed-s12.1]'
from (select date_trunc('week', now() at time zone 'America/Sao_Paulo') as wk) base,
(values
  -- patient_id, professional_id, title, type, status, day_off, start_hour, start_min, dur_min
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 'Consulta nutricional · Mariana', 'consulta', 'confirmado', 0, 8, 30, 45),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Retorno · Ricardo', 'retorno', 'pendente', 0, 11, 0, 30),
  ('', '00000000-0000-0000-0000-0000000000e1', 'Bloqueio: emissão de laudos', 'outros', 'confirmado', 0, 15, 0, 60),
  ('10000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e2', 'Consulta nutricional · Beatriz', 'consulta', 'confirmado', 1, 9, 0, 45),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Retorno · Mariana', 'retorno', 'confirmado', 1, 14, 30, 30),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2', 'Previsão de retorno · Ricardo', 'previsao_retorno', 'pendente', 2, 10, 0, 30),
  ('', '00000000-0000-0000-0000-0000000000e2', 'Reunião de equipe da clínica', 'outros', 'confirmado', 2, 16, 0, 60),
  ('10000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 'Consulta · Beatriz', 'consulta', 'confirmado', 3, 8, 0, 45),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 'Retorno · Mariana', 'retorno', 'desmarcado', 3, 13, 0, 30),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Consulta · Ricardo', 'consulta', 'pendente', 4, 10, 30, 45),
  ('10000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e2', 'Previsão de retorno · Beatriz', 'previsao_retorno', 'confirmado', 5, 9, 0, 30),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 'Consulta nutricional · Mariana', 'consulta', 'confirmado', 7, 9, 30, 45),
  ('', '00000000-0000-0000-0000-0000000000e1', 'Bloqueio: estudo de caso', 'outros', 'confirmado', 7, 14, 0, 60),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Retorno · Ricardo', 'retorno', 'confirmado', 8, 11, 0, 30),
  ('10000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e2', 'Consulta · Beatriz', 'consulta', 'pendente', 9, 15, 30, 45),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Previsão de retorno · Mariana', 'previsao_retorno', 'desmarcado', 10, 10, 0, 30),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2', 'Retorno · Ricardo', 'retorno', 'confirmado', 11, 16, 0, 30)
) as v(patient_id, professional_id, title, type, status, day_off, sh, sm, dur)
where not exists (
  select 1 from public.appointments
  where clinic_id = '00000000-0000-0000-0000-0000000000c1'::uuid and notes like '%[seed-s12.1]%'
);

-- Ledger humano (companion PT-BR; deny-all, só alimentado por migration).
insert into public.schema_migration_log (version, filename, description, session) values
  (
    '20260626170000',
    '20260626170000_seed_demo_appointments_week.sql',
    'Sessao 12.1 (web): seed da semana corrente + proxima (~17 compromissos, type/status variados, 08-19h, fuso America/Sao_Paulo) p/ a demo do calendario FullCalendar ficar vivo. Idempotente (marcador [seed-s12.1]); complementa o seed da S6.',
    'S12'
  )
on conflict (version) do update set
  filename = excluded.filename,
  description = excluded.description,
  session = excluded.session;
