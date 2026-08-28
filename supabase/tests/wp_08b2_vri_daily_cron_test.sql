-- =====================================================================================
-- WP-08B2 · TESTES (Nível 1: BEGIN / DO pequeno / ROLLBACK).
-- HARNESS: NÃO é um DO monolítico. Exige a migration 20260816090000 aplicada.
-- NÃO chama private.recompute_adherence_all() — o batch já foi provado no WP-08B1.
-- Instalar o job ≠ executar o job.
-- VRI-LOCK-01: o lote permanece uma transação com advisory xact lock por paciente
-- até o COMMIT. Este WP não altera isso.
-- =====================================================================================


-- T1 pg_cron instalado.
begin;
do $$
declare
  v text;
begin
  select extversion into v from pg_extension where extname = 'pg_cron';
  if v is null then raise exception 'WP-08B2 T1 FAIL: pg_cron ausente'; end if;
  raise notice 'WP-08B2 T1: PASS version=%', v;
end $$;
rollback;


-- T2 recompute_adherence_all existe (entrada única do job).
begin;
do $$
begin
  if to_regprocedure('private.recompute_adherence_all()') is null then
    raise exception 'WP-08B2 T2 FAIL: batch ausente';
  end if;
  raise notice 'WP-08B2 T2: PASS';
end $$;
rollback;


-- T3 estado vazio de jobs VRI é possível (unschedule por NOME, rollback restaura).
begin;
do $$
declare
  n int;
begin
  if exists (select 1 from cron.job where jobname = 'wp-vri-recompute-daily') then
    perform cron.unschedule('wp-vri-recompute-daily');
  end if;
  select count(*) into n from cron.job where jobname like 'wp-vri-%';
  if n <> 0 then raise exception 'WP-08B2 T3 FAIL: n=%', n; end if;
  raise notice 'WP-08B2 T3: PASS';
end $$;
rollback;


-- T4 migration cria exatamente um wp-vri-recompute-daily.
begin;
do $$
declare
  n int;
begin
  select count(*) into n from cron.job where jobname = 'wp-vri-recompute-daily';
  if n <> 1 then raise exception 'WP-08B2 T4 FAIL: n=%', n; end if;
  raise notice 'WP-08B2 T4: PASS';
end $$;
rollback;


-- T5 schedule = 15 9 * * * UTC.
begin;
do $$
declare
  sched text;
begin
  select schedule into sched from cron.job where jobname = 'wp-vri-recompute-daily';
  if sched is distinct from '15 9 * * *' then
    raise exception 'WP-08B2 T5 FAIL: schedule=%', sched;
  end if;
  raise notice 'WP-08B2 T5: PASS';
end $$;
rollback;


-- T6 command aponta somente para private.recompute_adherence_all().
begin;
do $$
declare
  cmd text;
begin
  select command into cmd from cron.job where jobname = 'wp-vri-recompute-daily';
  if cmd is distinct from 'select private.recompute_adherence_all();' then
    raise exception 'WP-08B2 T6 FAIL: command=%', cmd;
  end if;
  raise notice 'WP-08B2 T6: PASS';
end $$;
rollback;


-- T7 active = true.
begin;
do $$
declare
  act boolean;
begin
  select active into act from cron.job where jobname = 'wp-vri-recompute-daily';
  if act is not true then raise exception 'WP-08B2 T7 FAIL: active=%', act; end if;
  raise notice 'WP-08B2 T7: PASS';
end $$;
rollback;


-- T8 recovery job continua existindo.
begin;
do $$
declare
  n int;
begin
  select count(*) into n from cron.job where jobname = 'wp-rls2-recovery-decay';
  if n <> 1 then raise exception 'WP-08B2 T8 FAIL: recovery jobs=%', n; end if;
  raise notice 'WP-08B2 T8: PASS';
end $$;
rollback;


-- T9 recovery schedule continua 5 9 * * *.
begin;
do $$
declare
  sched text;
begin
  select schedule into sched from cron.job where jobname = 'wp-rls2-recovery-decay';
  if sched is distinct from '5 9 * * *' then
    raise exception 'WP-08B2 T9 FAIL: schedule=%', sched;
  end if;
  raise notice 'WP-08B2 T9: PASS';
end $$;
rollback;


-- T10 recovery command invariável.
begin;
do $$
declare
  cmd text;
begin
  select command into cmd from cron.job where jobname = 'wp-rls2-recovery-decay';
  if cmd is distinct from 'select private.recompute_recovery_decay();' then
    raise exception 'WP-08B2 T10 FAIL: command=%', cmd;
  end if;
  raise notice 'WP-08B2 T10: PASS';
end $$;
rollback;


-- T11 total jobs = baseline recovery + 1 VRI.
begin;
do $$
declare
  n int; n_rec int; n_vri int;
begin
  select count(*) into n from cron.job;
  select count(*) into n_rec from cron.job where jobname = 'wp-rls2-recovery-decay';
  select count(*) into n_vri from cron.job where jobname = 'wp-vri-recompute-daily';
  if n_rec <> 1 or n_vri <> 1 then
    raise exception 'WP-08B2 T11 FAIL: rec=% vri=%', n_rec, n_vri;
  end if;
  if n <> 2 then raise exception 'WP-08B2 T11 FAIL: total=%', n; end if;
  raise notice 'WP-08B2 T11: PASS total=%', n;
end $$;
rollback;


-- T12 replay do schedule(job_name) não duplica (mesmo jobid).
begin;
do $$
declare
  id1 bigint; id2 bigint; n int;
begin
  select jobid into id1 from cron.job where jobname = 'wp-vri-recompute-daily';
  perform cron.schedule(
    'wp-vri-recompute-daily',
    '15 9 * * *',
    $cron$select private.recompute_adherence_all();$cron$
  );
  select jobid into id2 from cron.job where jobname = 'wp-vri-recompute-daily';
  select count(*) into n from cron.job where jobname = 'wp-vri-recompute-daily';
  if n <> 1 then raise exception 'WP-08B2 T12 FAIL: n=%', n; end if;
  if id1 is distinct from id2 then
    raise exception 'WP-08B2 T12 FAIL: jobid % -> %', id1, id2;
  end if;
  raise notice 'WP-08B2 T12: PASS jobid=%', id1;
end $$;
rollback;


-- T13 nenhuma função VRI recriada: comentários e hashes do WP-08B1 permanecem.
begin;
do $$
declare
  c_for text; c_all text; c_brt text;
  def_all text;
begin
  select obj_description('private.recompute_adherence_for(uuid)'::regprocedure) into c_for;
  select obj_description('private.recompute_adherence_all()'::regprocedure) into c_all;
  select obj_description('private.brt_date(timestamptz)'::regprocedure) into c_brt;
  if c_for not like '%WP-08B1%' then
    raise exception 'WP-08B2 T13 FAIL: motor comment=%', c_for;
  end if;
  if c_all not like '%WP-08B1%' then
    raise exception 'WP-08B2 T13 FAIL: batch comment=%', c_all;
  end if;
  if coalesce(c_for, '') like '%WP-08B2%' or coalesce(c_all, '') like '%WP-08B2%' then
    raise exception 'WP-08B2 T13 FAIL: comentário 08B2 em função VRI';
  end if;
  select pg_get_functiondef('private.recompute_adherence_all()'::regprocedure) into def_all;
  if def_all like '%cron.schedule%' then
    raise exception 'WP-08B2 T13 FAIL: cron no batch';
  end if;
  raise notice 'WP-08B2 T13: PASS';
end $$;
rollback;


-- T14 nenhuma policy nova.
begin;
do $$
declare
  n int; n_vri int;
begin
  select count(*) into n from pg_policies where schemaname = 'public';
  if n <> 113 then raise exception 'WP-08B2 T14 FAIL: policies=%', n; end if;
  select count(*) into n_vri from pg_policies
   where schemaname = 'public' and (policyname ilike '%08b2%' or policyname ilike '%vri%');
  if n_vri <> 0 then raise exception 'WP-08B2 T14 FAIL: policy VRI n=%', n_vri; end if;
  raise notice 'WP-08B2 T14: PASS n=%', n;
end $$;
rollback;


-- T15 nenhuma tabela nova.
begin;
do $$
begin
  if to_regclass('public.vri_job_runs') is not null
     or to_regclass('public.scheduler_logs') is not null then
    raise exception 'WP-08B2 T15 FAIL: tabela de log indevida';
  end if;
  raise notice 'WP-08B2 T15: PASS';
end $$;
rollback;


-- T16 nenhum grant clínico novo (cliente continua sem execute no batch/motor).
begin;
do $$
begin
  if has_function_privilege('anon', 'private.recompute_adherence_all()', 'execute')
     or has_function_privilege('authenticated', 'private.recompute_adherence_all()', 'execute')
     or has_function_privilege('anon', 'private.recompute_adherence_for(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.recompute_adherence_for(uuid)', 'execute') then
    raise exception 'WP-08B2 T16 FAIL: grant cliente';
  end if;
  raise notice 'WP-08B2 T16: PASS';
end $$;
rollback;


-- T17 instalar/replay do cron não cria snapshot.
begin;
do $$
declare
  n1 int; n2 int;
begin
  select count(*) into n1 from public.adherence_snapshots;
  perform cron.schedule(
    'wp-vri-recompute-daily',
    '15 9 * * *',
    $cron$select private.recompute_adherence_all();$cron$
  );
  select count(*) into n2 from public.adherence_snapshots;
  if n1 <> n2 then raise exception 'WP-08B2 T17 FAIL: snaps % -> %', n1, n2; end if;
  raise notice 'WP-08B2 T17: PASS n=%', n1;
end $$;
rollback;


-- T18 nenhum activity_event criado pelo schedule.
begin;
do $$
declare
  n1 int; n2 int;
begin
  select count(*) into n1 from public.activity_events;
  perform cron.schedule(
    'wp-vri-recompute-daily',
    '15 9 * * *',
    $cron$select private.recompute_adherence_all();$cron$
  );
  select count(*) into n2 from public.activity_events;
  if n1 <> n2 then raise exception 'WP-08B2 T18 FAIL: events % -> %', n1, n2; end if;
  raise notice 'WP-08B2 T18: PASS n=%', n1;
end $$;
rollback;


-- T19 schedule() não dispara execução imediata.
begin;
do $$
declare
  jid bigint; n1 int; n2 int;
begin
  select jobid into jid from cron.job where jobname = 'wp-vri-recompute-daily';
  select count(*) into n1 from cron.job_run_details where jobid = jid;
  perform cron.schedule(
    'wp-vri-recompute-daily',
    '15 9 * * *',
    $cron$select private.recompute_adherence_all();$cron$
  );
  select count(*) into n2 from cron.job_run_details where jobid = jid;
  if n1 <> n2 then raise exception 'WP-08B2 T19 FAIL: runs % -> %', n1, n2; end if;
  raise notice 'WP-08B2 T19: PASS runs=%', n1;
end $$;
rollback;


-- T20 cron.job_run_details disponível.
begin;
do $$
declare
  n int;
begin
  if to_regclass('cron.job_run_details') is null then
    raise exception 'WP-08B2 T20 FAIL: job_run_details ausente';
  end if;
  select count(*) into n from cron.job_run_details;
  raise notice 'WP-08B2 T20: PASS n=%', n;
end $$;
rollback;

select 1 as ok;
select pg_is_in_recovery() as in_recovery;
