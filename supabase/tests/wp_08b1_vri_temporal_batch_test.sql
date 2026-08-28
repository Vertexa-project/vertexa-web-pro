-- =====================================================================================
-- WP-08B1 · TESTES (Nível 1: jwt.claims + set local role; ROLLBACK).
-- HARNESS: NÃO é um DO monolítico (PG17 Docker SIGSEGV). Cada caso é
-- BEGIN / DO pequeno / ROLLBACK.
-- Exige a migration 20260815090000 aplicada.
-- =====================================================================================

create or replace function pg_temp.brt_ago(p_ago int)
returns timestamptz
language sql
as $$
  select (private.brt_date(now()) - p_ago + time '12:00') at time zone 'America/Sao_Paulo';
$$;

create or replace function pg_temp.wp08b1_patient()
returns table(ac uuid, da uuid)
language plpgsql
as $$
declare
  v_ac uuid := gen_random_uuid();
  v_da uuid := gen_random_uuid();
  v_fa uuid := gen_random_uuid();
  v_fp uuid := gen_random_uuid();
  v_cl uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (v_fa, gen_random_uuid(), 'admin', 'A08b1', 'active'),
    (v_fp, v_ac, 'patient', 'P08b1', 'active');
  insert into public.clinics (id, name, owner_profile_id) values (v_cl, 'C08b1', v_fa);
  insert into public.patients (id, profile_id, clinic_id) values (v_da, v_fp, v_cl);
  ac := v_ac; da := v_da; return next;
end;
$$;

-- Trigger helper for T10: lê wp08b1.fail_patient. Sem deformar o motor.
create or replace function pg_temp.wp08b1_boom()
returns trigger
language plpgsql
as $$
begin
  if NEW.patient_id::text = current_setting('wp08b1.fail_patient', true) then
    raise exception 'WP08B1_SYNTHETIC' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;


-- T1 fórmula/paridade TYPICAL (89/alta) invariável.
begin;
do $$
declare
  fails text := '';
  f record; r record;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  insert into public.weight_logs (patient_id, weight_kg, measured_at, source)
    values (f.da, 80, pg_temp.brt_ago(0), 'app');
  perform private.recompute_adherence_for(f.da);
  select * into r from public.adherence_snapshots where patient_id = f.da;
  if r.score <> 89 or r.level <> 'alta' or r.status::text <> 'em_acompanhamento'
     or r.streak <> 1 or r.weekly_completion_rate <> 20 then
    fails := fails || format('TYP=%s/%s/%s/st%s/wk%s ', r.score, r.level, r.status, r.streak, r.weekly_completion_rate);
  end if;
  if length(fails) > 0 then raise exception 'WP-08B1 T1 FAIL: %', fails;
  else raise notice 'WP-08B1 T1: PASS'; end if;
end $$;
rollback;


-- T2 estado idêntico → skip.
begin;
do $$
declare
  f record; n1 int; n2 int;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  perform private.recompute_adherence_for(f.da);
  select count(*) into n1 from public.adherence_snapshots where patient_id = f.da;
  perform private.recompute_adherence_for(f.da);
  select count(*) into n2 from public.adherence_snapshots where patient_id = f.da;
  if n1 <> 1 or n2 <> 1 then
    raise exception 'WP-08B1 T2 FAIL: n1=% n2=%', n1, n2;
  end if;
  raise notice 'WP-08B1 T2: PASS';
end $$;
rollback;


-- T3 status muda, score/level iguais → INSERT.
-- Prova: 14→15d muda recência 1→0 e o score (75→70). O casal status-sem-score
-- NÃO é produzido pelo motor; fixture equivalente semeia snapshot 70/moderada
-- com status errado (em_acompanhamento) no estado vazio (inativo).
begin;
do $$
declare
  f record; n int; r record;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.adherence_snapshots
    (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
  values (
    f.da, 70, 'moderada', 'em_acompanhamento', 0, 0,
    array['30 dias sem interação','Nenhum hábito registrado hoje','Poucos treinos esta semana',
          'Peso não registrado recentemente','Foto mensal pendente']::text[],
    array[]::text[]
  );
  perform private.recompute_adherence_for(f.da);
  select count(*) into n from public.adherence_snapshots where patient_id = f.da;
  select * into r from public.adherence_snapshots
   where patient_id = f.da order by calculated_at desc, id desc limit 1;
  if n <> 2 then raise exception 'WP-08B1 T3 FAIL: n=% (esperado 2)', n; end if;
  if r.score <> 70 or r.level <> 'moderada' or r.status::text <> 'inativo' then
    raise exception 'WP-08B1 T3 FAIL: got %/%/%', r.score, r.level, r.status;
  end if;
  raise notice 'WP-08B1 T3: PASS';
end $$;
rollback;


-- T4 weekly muda, score/level iguais → INSERT.
-- 4 treinos dias 0–3 (weekly 80, engagement no cap 16) + treino no dia 6
-- (weekly 100, streak continua 4, engagement ainda 16).
begin;
do $$
declare
  f record; n1 int; n2 int; s1 int; s2 int; l1 text; l2 text; w1 int; w2 int;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at) values
    (f.da, 'workout_checked', '{}', pg_temp.brt_ago(0)),
    (f.da, 'workout_checked', '{}', pg_temp.brt_ago(1)),
    (f.da, 'workout_checked', '{}', pg_temp.brt_ago(2)),
    (f.da, 'workout_checked', '{}', pg_temp.brt_ago(3));
  perform private.recompute_adherence_for(f.da);
  select count(*), max(score), max(level), max(weekly_completion_rate)
    into n1, s1, l1, w1
    from public.adherence_snapshots where patient_id = f.da;
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'workout_checked', '{}', pg_temp.brt_ago(6));
  perform private.recompute_adherence_for(f.da);
  select count(*) into n2 from public.adherence_snapshots where patient_id = f.da;
  select score, level, weekly_completion_rate into s2, l2, w2
    from public.adherence_snapshots
   where patient_id = f.da order by calculated_at desc, id desc limit 1;
  if n1 <> 1 or n2 <> 2 then raise exception 'WP-08B1 T4 FAIL: n1=% n2=%', n1, n2; end if;
  if s1 is distinct from s2 or l1 is distinct from l2 then
    raise exception 'WP-08B1 T4 FAIL: score/level mudaram %/% -> %/%', s1, l1, s2, l2;
  end if;
  if w1 = w2 then raise exception 'WP-08B1 T4 FAIL: weekly não mudou (%)', w1; end if;
  raise notice 'WP-08B1 T4: PASS weekly % -> % score=%', w1, w2, s2;
end $$;
rollback;


-- T5 fator muda, score/level iguais → INSERT.
-- Hidratação há 2 dias (recência 8, sem "N dias") → mover para 3 dias
-- (recência ainda 8, nasce "3 dias sem interação").
begin;
do $$
declare
  f record; n1 int; n2 int; s1 int; s2 int; ev uuid;
  has_risk boolean;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'hydration_logged', '{}', pg_temp.brt_ago(2))
    returning id into ev;
  perform private.recompute_adherence_for(f.da);
  select count(*), max(score) into n1, s1 from public.adherence_snapshots where patient_id = f.da;
  if exists (select 1 from public.adherence_snapshots s, unnest(s.risk_factors) x
             where s.patient_id = f.da and x like '%dias sem interação%') then
    raise exception 'WP-08B1 T5 FAIL: risco de sumiço já no snapshot de 2d';
  end if;
  update public.activity_events set created_at = pg_temp.brt_ago(3) where id = ev;
  perform private.recompute_adherence_for(f.da);
  select count(*) into n2 from public.adherence_snapshots where patient_id = f.da;
  select score into s2 from public.adherence_snapshots
   where patient_id = f.da order by calculated_at desc, id desc limit 1;
  select exists (
    select 1 from public.adherence_snapshots s, unnest(s.risk_factors) x
     where s.patient_id = f.da and s.calculated_at = (
       select max(calculated_at) from public.adherence_snapshots where patient_id = f.da)
       and x like '3 dias sem interação'
  ) into has_risk;
  if n2 <> 2 then raise exception 'WP-08B1 T5 FAIL: n1=% n2=%', n1, n2; end if;
  if s1 is distinct from s2 then raise exception 'WP-08B1 T5 FAIL: score % -> %', s1, s2; end if;
  if not has_risk then raise exception 'WP-08B1 T5 FAIL: fator de 3d ausente'; end if;
  raise notice 'WP-08B1 T5: PASS';
end $$;
rollback;


-- T6 segunda chamada sem nova mudança → skip (depois de T3-like insert).
begin;
do $$
declare
  f record; n2 int; n3 int;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.adherence_snapshots
    (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
  values (
    f.da, 70, 'moderada', 'em_acompanhamento', 0, 0,
    array['30 dias sem interação','Nenhum hábito registrado hoje','Poucos treinos esta semana',
          'Peso não registrado recentemente','Foto mensal pendente']::text[],
    array[]::text[]
  );
  perform private.recompute_adherence_for(f.da);
  select count(*) into n2 from public.adherence_snapshots where patient_id = f.da;
  perform private.recompute_adherence_for(f.da);
  select count(*) into n3 from public.adherence_snapshots where patient_id = f.da;
  if n2 <> 2 or n3 <> 2 then raise exception 'WP-08B1 T6 FAIL: n2=% n3=%', n2, n3; end if;
  raise notice 'WP-08B1 T6: PASS';
end $$;
rollback;


-- T7 paciente sem snapshot → batch NÃO cria.
begin;
do $$
declare
  f record; n int; rec record;
begin
  select * into f from pg_temp.wp08b1_patient();
  select * into rec from private.recompute_adherence_all();
  select count(*) into n from public.adherence_snapshots where patient_id = f.da;
  if n <> 0 then raise exception 'WP-08B1 T7 FAIL: n=% seen=%', n, rec.seen; end if;
  raise notice 'WP-08B1 T7: PASS seen=%', rec.seen;
end $$;
rollback;


-- T8 paciente com snapshot elegível → batch processa (seen>=1, sem duplicar se idêntico).
begin;
do $$
declare
  f record; n1 int; n2 int; rec record;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  perform private.recompute_adherence_for(f.da);
  select count(*) into n1 from public.adherence_snapshots where patient_id = f.da;
  select * into rec from private.recompute_adherence_all();
  select count(*) into n2 from public.adherence_snapshots where patient_id = f.da;
  if rec.seen < 1 then raise exception 'WP-08B1 T8 FAIL: seen=%', rec.seen; end if;
  if n1 <> 1 or n2 <> 1 then raise exception 'WP-08B1 T8 FAIL: n1=% n2=%', n1, n2; end if;
  raise notice 'WP-08B1 T8: PASS';
end $$;
rollback;


-- T9 2 pacientes elegíveis → ambos processados.
begin;
do $$
declare
  a record; b record; rec record; na int; nb int;
begin
  select * into a from pg_temp.wp08b1_patient();
  select * into b from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at) values
    (a.da, 'workout_checked', '{}', pg_temp.brt_ago(0)),
    (b.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  perform private.recompute_adherence_for(a.da);
  perform private.recompute_adherence_for(b.da);
  select * into rec from private.recompute_adherence_all();
  select count(*) into na from public.adherence_snapshots where patient_id = a.da;
  select count(*) into nb from public.adherence_snapshots where patient_id = b.da;
  if rec.seen < 2 then raise exception 'WP-08B1 T9 FAIL: seen=%', rec.seen; end if;
  if na <> 1 or nb <> 1 then raise exception 'WP-08B1 T9 FAIL: na=% nb=%', na, nb; end if;
  raise notice 'WP-08B1 T9: PASS seen=%', rec.seen;
end $$;
rollback;


-- T10 falha sintética de P1 não impede P2 (trigger de teste, motor intacto).
begin;
do $$
declare
  a record; b record; rec record; na int; nb int;
begin
  select * into a from pg_temp.wp08b1_patient();
  select * into b from pg_temp.wp08b1_patient();
  insert into public.adherence_snapshots
    (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
  values (
    a.da, 70, 'moderada', 'em_acompanhamento', 0, 0,
    array['30 dias sem interação','Nenhum hábito registrado hoje','Poucos treinos esta semana',
          'Peso não registrado recentemente','Foto mensal pendente']::text[],
    array[]::text[]
  );
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (b.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  perform private.recompute_adherence_for(b.da);
  perform set_config('wp08b1.fail_patient', a.da::text, true);
  execute 'create trigger wp08b1_boom before insert on public.adherence_snapshots '
       || 'for each row execute function pg_temp.wp08b1_boom()';
  select * into rec from private.recompute_adherence_all();
  select count(*) into na from public.adherence_snapshots where patient_id = a.da;
  select count(*) into nb from public.adherence_snapshots where patient_id = b.da;
  if rec.failed < 1 then raise exception 'WP-08B1 T10 FAIL: failed=%', rec.failed; end if;
  if rec.succeeded < 1 then raise exception 'WP-08B1 T10 FAIL: succeeded=%', rec.succeeded; end if;
  if na <> 1 then raise exception 'WP-08B1 T10 FAIL: P1 n=%', na; end if;
  if nb <> 1 then raise exception 'WP-08B1 T10 FAIL: P2 n=%', nb; end if;
  raise notice 'WP-08B1 T10: PASS failed=% succeeded=%', rec.failed, rec.succeeded;
end $$;
rollback;


-- T11 batch não duplica fórmula.
begin;
do $$
declare
  def text;
begin
  select pg_get_functiondef('private.recompute_adherence_all()'::regprocedure) into def;
  if def not like '%recompute_adherence_for%' then
    raise exception 'WP-08B1 T11 FAIL: batch não delega';
  end if;
  if def like '%v_engagement%' or def like '%js_round%' or def like '%power(%' then
    raise exception 'WP-08B1 T11 FAIL: fórmula no batch';
  end if;
  raise notice 'WP-08B1 T11: PASS';
end $$;
rollback;


-- T12 authenticated não executa batch.
-- SET ROLE + PERFORM em RETURNS TABLE já derrubou PG17 neste stack (SIGSEGV).
-- Prova = catálogo de privilégio (mesmo 42501 que a chamada levantaria).
begin;
do $$
begin
  if has_function_privilege('authenticated', 'private.recompute_adherence_all()', 'execute') then
    raise exception 'WP-08B1 T12 FAIL: grant authenticated';
  end if;
  raise notice 'WP-08B1 T12: PASS';
end $$;
rollback;


-- T13 anon não executa batch.
begin;
do $$
begin
  if has_function_privilege('anon', 'private.recompute_adherence_all()', 'execute') then
    raise exception 'WP-08B1 T13 FAIL: grant anon';
  end if;
  raise notice 'WP-08B1 T13: PASS';
end $$;
rollback;


-- T14 PUBLIC não executa batch.
begin;
do $$
declare
  n int;
begin
  select count(*) into n
    from information_schema.routine_privileges
   where routine_schema = 'private'
     and routine_name = 'recompute_adherence_all'
     and grantee = 'PUBLIC';
  if n <> 0 then raise exception 'WP-08B1 T14 FAIL: PUBLIC grants=%', n; end if;
  raise notice 'WP-08B1 T14: PASS';
end $$;
rollback;


-- T15 postgres/owner executa.
begin;
do $$
declare
  rec record;
begin
  select * into rec from private.recompute_adherence_all();
  if rec.seen is null or rec.failed is null then
    raise exception 'WP-08B1 T15 FAIL: retorno nulo';
  end if;
  raise notice 'WP-08B1 T15: PASS seen=%', rec.seen;
end $$;
rollback;


-- T16 RPC pública do paciente continua funcionando.
begin;
do $$
declare
  f record; r record;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  insert into public.weight_logs (patient_id, weight_kg, measured_at, source)
    values (f.da, 80, pg_temp.brt_ago(0), 'app');
  perform set_config('request.jwt.claims', json_build_object('sub', f.ac::text)::text, true);
  set local role authenticated;
  perform public.recompute_adherence();
  reset role;
  select * into r from public.adherence_snapshots where patient_id = f.da;
  if r.score <> 89 or r.level <> 'alta' then
    raise exception 'WP-08B1 T16 FAIL: %/%', r.score, r.level;
  end if;
  raise notice 'WP-08B1 T16: PASS';
end $$;
rollback;


-- T17 timezone BRT invariável.
begin;
do $$
declare
  def_brt text; def_for text; d1 date; d2 date;
begin
  select pg_get_functiondef('private.brt_date(timestamptz)'::regprocedure) into def_brt;
  select pg_get_functiondef('private.recompute_adherence_for(uuid)'::regprocedure) into def_for;
  if def_brt not like '%America/Sao_Paulo%' then
    raise exception 'WP-08B1 T17 FAIL: brt_date sem BRT';
  end if;
  if def_for not like '%private.brt_date%' then
    raise exception 'WP-08B1 T17 FAIL: motor sem brt_date';
  end if;
  d1 := private.brt_date('2026-08-15 12:00:00+00');
  d2 := private.brt_date('2026-08-15 02:00:00+00');
  if d1 <> date '2026-08-15' then raise exception 'WP-08B1 T17 FAIL: d1=%', d1; end if;
  if d2 <> date '2026-08-14' then raise exception 'WP-08B1 T17 FAIL: d2=%', d2; end if;
  raise notice 'WP-08B1 T17: PASS';
end $$;
rollback;


-- T18 duas chamadas batch sem mudança → sem snapshots extras.
begin;
do $$
declare
  f record; rec1 record; rec2 record; n1 int; n2 int; n3 int;
begin
  select * into f from pg_temp.wp08b1_patient();
  insert into public.activity_events (patient_id, type, payload, created_at)
    values (f.da, 'workout_checked', '{}', pg_temp.brt_ago(0));
  perform private.recompute_adherence_for(f.da);
  select count(*) into n1 from public.adherence_snapshots where patient_id = f.da;
  select * into rec1 from private.recompute_adherence_all();
  select count(*) into n2 from public.adherence_snapshots where patient_id = f.da;
  select * into rec2 from private.recompute_adherence_all();
  select count(*) into n3 from public.adherence_snapshots where patient_id = f.da;
  if n1 <> 1 or n2 <> 1 or n3 <> 1 then
    raise exception 'WP-08B1 T18 FAIL: n=%/%/%', n1, n2, n3;
  end if;
  raise notice 'WP-08B1 T18: PASS';
end $$;
rollback;


-- T19 lock por paciente presente (prova estrutural; harness multi-session frágil).
begin;
do $$
declare
  def text;
begin
  select pg_get_functiondef('private.recompute_adherence_for(uuid)'::regprocedure) into def;
  if def not like '%pg_advisory_xact_lock%(808150901%' then
    raise exception 'WP-08B1 T19 FAIL: lock ausente';
  end if;
  if def not like '%hashtext%(v_patient%' then
    raise exception 'WP-08B1 T19 FAIL: lock não é por paciente';
  end if;
  raise notice 'WP-08B1 T19: PASS';
end $$;
rollback;


-- T20 H6 cron inalterado. Nenhum job VRI.
begin;
do $$
declare
  n_rec int; n_vri int; sched text; cmd text;
begin
  if to_regclass('cron.job') is null then
    raise exception 'WP-08B1 T20 FAIL: cron.job ausente';
  end if;
  select count(*) into n_rec from cron.job where jobname = 'wp-rls2-recovery-decay';
  select count(*) into n_vri from cron.job
   where jobname like 'wp-vri-%' or jobname like '%adherence%';
  select schedule, command into sched, cmd
    from cron.job where jobname = 'wp-rls2-recovery-decay';
  if n_rec <> 1 then raise exception 'WP-08B1 T20 FAIL: recovery jobs=%', n_rec; end if;
  if n_vri <> 0 then raise exception 'WP-08B1 T20 FAIL: job VRI indevido n=%', n_vri; end if;
  if sched is distinct from '5 9 * * *' then
    raise exception 'WP-08B1 T20 FAIL: schedule=%', sched;
  end if;
  if cmd is distinct from 'select private.recompute_recovery_decay();' then
    raise exception 'WP-08B1 T20 FAIL: command=%', cmd;
  end if;
  raise notice 'WP-08B1 T20: PASS';
end $$;
rollback;

select 1 as ok;
select pg_is_in_recovery() as in_recovery;
