-- =====================================================================================
-- VERTEXA — Sessão 12 (web): TIPO + STATUS do compromisso na agenda interna.
-- ADITIVA, idempotente e reversível. NÃO altera colunas existentes nem toca tabelas
-- sensíveis (calendar_connection_tokens / calendar_oauth_state seguem DENY-ALL intactas).
--
-- Acrescenta a public.appointments duas colunas de domínio CLÍNICO:
--   • type   text — {consulta, retorno, previsao_retorno, outros}  (default 'consulta')
--   • status text — {confirmado, pendente, desmarcado}             (default 'confirmado')
-- com CHECK constraints idempotentes. Linhas existentes recebem os defaults (backfill).
-- A RLS de sprint de appointments (permissiva) fica INTACTA — RLS real por clínica é a S9.
--
-- ⚠️ 'status' aqui é o CICLO CLÍNICO do compromisso (confirmado/pendente/desmarcado) e NÃO
--    se confunde com calendar_connections.status (saúde OAuth: connected/revoked/error/stale)
--    nem com calendar_event_cache.status (valor cru do Google). São três domínios distintos.
--
-- Rollback:
--   alter table public.appointments drop constraint if exists appointments_status_check;
--   alter table public.appointments drop constraint if exists appointments_type_check;
--   alter table public.appointments drop column if exists status;
--   alter table public.appointments drop column if exists type;
-- =====================================================================================

alter table public.appointments add column if not exists type   text not null default 'consulta';
alter table public.appointments add column if not exists status text not null default 'confirmado';

-- CHECK idempotente (Postgres não tem ADD CONSTRAINT IF NOT EXISTS).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_type_check') then
    alter table public.appointments
      add constraint appointments_type_check
      check (type in ('consulta','retorno','previsao_retorno','outros'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_status_check') then
    alter table public.appointments
      add constraint appointments_status_check
      check (status in ('confirmado','pendente','desmarcado'));
  end if;
end $$;

-- Backfill explícito (linhas pré-existentes, incl. as criadas em runtime sem os campos).
update public.appointments set type   = 'consulta'   where type   is null;
update public.appointments set status = 'confirmado' where status is null;

-- Seed da demo: distribui type/status variados nos 3 compromissos [seed-demo] da clínica c1,
-- para as cores das duas legendas aparecerem no calendário. Idempotente (re-rodar reafirma).
update public.appointments set type = 'consulta', status = 'confirmado'
  where clinic_id = '00000000-0000-0000-0000-0000000000c1'::uuid
    and patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid
    and notes like '%[seed-demo]%';
update public.appointments set type = 'retorno', status = 'pendente'
  where clinic_id = '00000000-0000-0000-0000-0000000000c1'::uuid
    and patient_id = '10000000-0000-0000-0000-0000000000b2'::uuid
    and notes like '%[seed-demo]%';
update public.appointments set type = 'outros', status = 'desmarcado'
  where clinic_id = '00000000-0000-0000-0000-0000000000c1'::uuid
    and patient_id = '10000000-0000-0000-0000-0000000000b3'::uuid
    and notes like '%[seed-demo]%';

-- Ledger humano (companion PT-BR; deny-all, só alimentado por migration).
insert into public.schema_migration_log (version, filename, description, session) values
  (
    '20260626160000',
    '20260626160000_appointments_type_status.sql',
    'Sessao 12 (web): adiciona type (consulta/retorno/previsao_retorno/outros) e status (confirmado/pendente/desmarcado) em appointments, com CHECK e defaults; backfill + seed variado p/ a agenda virar calendario FullCalendar. RLS sprint intacta.',
    'S12'
  )
on conflict (version) do update set
  filename = excluded.filename,
  description = excluded.description,
  session = excluded.session;
