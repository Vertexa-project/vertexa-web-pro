-- =====================================================================================
-- WP-08B2 — scheduler diário do VRI via pg_cron. SEM fórmula, SEM batch execute.
--
-- pg_cron → 15 9 * * * UTC (06:15 America/Sao_Paulo) → private.recompute_adherence_all()
-- 10 min após wp-rls2-recovery-decay (5 9 * * * / 06:05 BRT). Jobs separados.
--
-- NÃO FAZ: recriar motor/batch/brt_date, policy, tabela, grant clínico, Edge,
--   frontend, APP, cron de recovery, apply remoto, execução do lote.
--
-- IDEMPOTÊNCIA: pg_cron 1.6.4 expõe cron.schedule(job_name, schedule, command).
-- UNIQUE (jobname, username). Replay do mesmo nome devolve o mesmo jobid e
-- atualiza schedule/command — não cria duplicata. unschedule só por job name
-- explícito, nunca por padrão amplo.
--
-- OBSERVABILIDADE V1: cron.job_run_details + NOTICE do batch. Sem tabela nova.
-- VRI-LOCK-01: o lote continua uma transação com advisory xact lock por paciente
-- até o COMMIT. Aceito na V1. Sem redesign.
--
-- NÃO APLICAR no remoto neste WP. NÃO executar o batch em produção.
-- =====================================================================================

create extension if not exists pg_cron;

select cron.schedule(
  'wp-vri-recompute-daily',
  '15 9 * * *',
  $cron$select private.recompute_adherence_all();$cron$
);

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260816090000',
  '20260816090000_wp_08b2_vri_daily_cron.sql',
  'WP-08B2: pg_cron wp-vri-recompute-daily às 15 9 * * * UTC (06:15 BRT) chama '
  'somente private.recompute_adherence_all(). Recovery intacto. Sem fórmula, '
  'sem apply remoto, sem execução do lote neste WP.',
  'WP-08B2'
)
on conflict (version) do nothing;
