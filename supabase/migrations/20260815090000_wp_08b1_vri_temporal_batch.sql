-- =====================================================================================
-- WP-08B1 — freshness funcional do VRI + batch privado. SEM cron.
--
-- A TESE: o app já chama public.recompute_adherence() por evento. Sem ação, o tempo
-- passa e o snapshot congela. O skip-if-unchanged só comparava score+level, então
-- status/streak/weekly/fatores podiam mudar no cálculo e não nascer linha nova.
-- Este WP endurece o SKIP e serializa por paciente; o cron fica no WP-08B2.
--
-- DELTA:
--   1) private.recompute_adherence_for(uuid) — MESMA fórmula; +lock xact por paciente;
--      SKIP só quando o estado persistido inteiro é idêntico.
--   2) private.recompute_adherence_all() — visita só quem JÁ tem snapshot;
--      delega ao motor; 1 falha não aborta o lote.
--
-- NÃO FAZ: cron, tabela nova, policy, índice, Edge, fórmula, backfill, frontend, APP.
-- ÂNCORAS INTOCADAS: can_see_profile, promote_to_professional, handle_new_user,
--   create_patient, create_clinic_with_owner. Job wp-rls2-recovery-decay INTOCADO.
--
-- NÃO APLICAR no remoto neste WP.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) private.recompute_adherence_for — lock + skip funcional
--
-- Corpo copiado da migration canônica 20260807090000 (motor vivo). Delta cirúrgico:
--   a) declare +5 campos do último snapshot (status, streak, weekly, risk, pos).
--   b) pg_advisory_xact_lock(808150901, hashtext(patient_id)) após a guarda de null.
--      Classe 808150901 = namespace estável Vertexa VRI. key2 por paciente: A não
--      bloqueia B. Colisão de hash só serializa a mais, nunca corrompe. Libera no
--      fim da transação. APP (RPC) e batch futuro passam pelo MESMO lock.
--   c) SKIP compara score, level, status, streak, weekly_completion_rate,
--      risk_factors, positive_factors (IS NOT DISTINCT FROM). id/calculated_at
--      NÃO entram na igualdade. Leitura do último: calculated_at desc, id desc
--      — desempate SÓ para escolher a linha de referência (DÍVIDA-SNAP-ORDER-1
--      nas leituras da UI permanece).
-- Fórmula, pesos, janelas, BRT, catálogo, fatores, weekly, streak: byte a byte iguais.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.recompute_adherence_for(p_patient uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_patient uuid := p_patient;
  v_today date := private.brt_date(now());
  v_most_recent timestamptz;
  v_most_recent_adherence timestamptz;
  v_days_without int;
  v_days_without_adherence int;
  v_habits_today int := 0;
  v_workouts_week int := 0;
  v_activity_week int := 0;
  v_last_weight timestamptz;
  v_last_photo timestamptz;
  v_weight_recent boolean;
  v_photo_recent boolean;
  v_plan_viewed boolean;
  v_streak int;
  v_meal_total int := 0; v_meal_done int := 0; v_meal_ratio double precision := 0;
  v_supp_total int := 0; v_supp_taken int := 0; v_supp_ratio double precision := 0;
  v_engagement int := 0;
  v_recency int;
  v_signal double precision;
  v_normalized double precision;
  v_score int;
  v_level text;
  v_status public.patient_status;
  v_weekly int;
  v_risk text[] := array[]::text[];
  v_pos  text[] := array[]::text[];
  v_last_score int; v_last_level text;
  v_last_status public.patient_status;
  v_last_streak int;
  v_last_weekly int;
  v_last_risk text[];
  v_last_pos text[];
begin
  -- Guarda de contrato, não de autorização (a autorização é do invólucro). Sem ela, um
  -- p_patient nulo cairia no caminho "sem eventos" e gravaria um snapshot órfão.
  if v_patient is null then
    raise exception 'recompute_adherence_for: p_patient is required' using errcode = '22023';
  end if;

  -- WP-08B1: serializa APP + batch no mesmo patient_id. Sem tabela de lock.
  perform pg_catalog.pg_advisory_xact_lock(808150901, pg_catalog.hashtext(v_patient::text));

  with ev as (
    select e.type, e.created_at, private.brt_date(e.created_at) as d, private.days_ago_brt(e.created_at, now()) as ago,
           coalesce(t.counts_as_interaction, false) as is_interaction,
           coalesce(t.counts_as_adherence,   false) as is_adherence
    from public.activity_events e
    left join public.activity_event_types t on t.type = e.type
    where e.patient_id = v_patient order by e.created_at desc limit 500
  )
  select max(created_at) filter (where is_interaction),
    max(created_at) filter (where is_adherence),
    count(*) filter (where type in ('hydration_logged','sleep_logged','mood_logged') and d = v_today),
    count(distinct d) filter (where type = 'workout_checked' and ago <= 6),
    count(distinct d) filter (where type = 'activity_logged' and ago <= 6)
  into v_most_recent, v_most_recent_adherence, v_habits_today, v_workouts_week, v_activity_week from ev;

  v_days_without := case when v_most_recent is null then 30 else private.days_ago_brt(v_most_recent, now()) end;
  v_days_without_adherence := case when v_most_recent_adherence is null then 30 else private.days_ago_brt(v_most_recent_adherence, now()) end;
  v_streak := private.event_streak_brt(v_patient);

  select max(measured_at) into v_last_weight from public.weight_logs where patient_id = v_patient;
  select max(taken_at)    into v_last_photo  from public.progress_photos where patient_id = v_patient;
  v_weight_recent := v_last_weight is not null and private.days_ago_brt(v_last_weight, now()) <= 7;
  v_photo_recent  := v_last_photo  is not null and private.days_ago_brt(v_last_photo,  now()) <= 30;
  v_plan_viewed   := v_days_without_adherence <= 3;

  with plan as (select id from public.nutrition_plans where patient_id = v_patient order by created_at desc limit 1),
  plan_meals as (select m.id from public.meals m where m.nutrition_plan_id = (select id from plan)),
  done as (select distinct meal_id from public.meal_logs where patient_id = v_patient and consumed_on = v_today)
  select count(pm.id), count(pm.id) filter (where d.meal_id is not null)
  into v_meal_total, v_meal_done from plan_meals pm left join done d on d.meal_id = pm.id;
  v_meal_ratio := case when v_meal_total > 0 then v_meal_done::double precision / v_meal_total else 0 end;

  with lst as (select id from public.supplements where patient_id = v_patient),
  taken as (select distinct supplement_id from public.supplement_intakes where patient_id = v_patient and taken_on = v_today)
  select count(l.id), count(l.id) filter (where t.supplement_id is not null)
  into v_supp_total, v_supp_taken from lst l left join taken t on t.supplement_id = l.id;
  v_supp_ratio := case when v_supp_total > 0 then v_supp_taken::double precision / v_supp_total else 0 end;

  v_engagement :=
      least(v_habits_today * 3, 12) + least(v_workouts_week * 4, 16)
    + (case when v_weight_recent then 5 else 0 end) + (case when v_photo_recent then 5 else 0 end)
    + (case when v_plan_viewed then 3 else 0 end)
    + (case when v_streak >= 30 then 10 when v_streak >= 14 then 7 when v_streak >= 7 then 4 else 0 end)
    + (case when v_meal_ratio > 0 then private.js_round(least(1, v_meal_ratio) * 6) else 0 end)
    + (case when v_activity_week > 0 then least(v_activity_week, 3) * 2 else 0 end)
    + (case when v_supp_ratio > 0 then private.js_round(least(1, v_supp_ratio) * 4) else 0 end);

  v_recency := case when v_days_without <= 1 then 12 when v_days_without <= 3 then 8
                    when v_days_without <= 6 then 4 when v_days_without <= 14 then 1 else 0 end;
  v_signal := v_recency + v_engagement;
  v_normalized := least(1, greatest(0, v_signal / 75.0));
  v_score := greatest(0, least(100, private.js_round(70 + 30 * power(v_normalized, 0.42))));
  v_level := case when v_score >= 80 then 'alta' when v_score >= 50 then 'moderada' when v_score >= 20 then 'baixa' else 'risco' end;
  v_status := (case when v_days_without >= 15 then 'inativo' when v_score < 20 then 'em_risco'
                    when v_score < 50 then 'atencao' else 'em_acompanhamento' end)::public.patient_status;
  v_weekly := private.js_round((v_workouts_week::double precision / 5) * 100);

  if v_days_without >= 3   then v_risk := array_append(v_risk, v_days_without || ' dias sem interação'); end if;
  if v_habits_today = 0    then v_risk := array_append(v_risk, 'Nenhum hábito registrado hoje'); end if;
  if v_workouts_week < 2   then v_risk := array_append(v_risk, 'Poucos treinos esta semana'); end if;
  if not v_weight_recent   then v_risk := array_append(v_risk, 'Peso não registrado recentemente'); end if;
  if not v_photo_recent    then v_risk := array_append(v_risk, 'Foto mensal pendente'); end if;

  if v_streak >= 7         then v_pos := array_append(v_pos, 'Sequência de ' || v_streak || ' dias'); end if;
  if v_habits_today >= 3   then v_pos := array_append(v_pos, 'Hábitos em dia'); end if;
  if v_workouts_week >= 3  then v_pos := array_append(v_pos, 'Treinos consistentes'); end if;
  if v_weight_recent       then v_pos := array_append(v_pos, 'Peso atualizado'); end if;
  if v_plan_viewed         then v_pos := array_append(v_pos, 'Plano acompanhado'); end if;
  if v_meal_ratio >= 0.6   then v_pos := array_append(v_pos, 'Refeições do dia em dia'); end if;
  if v_activity_week >= 2  then v_pos := array_append(v_pos, 'Atividades complementares na semana'); end if;
  if v_supp_ratio >= 0.6   then v_pos := array_append(v_pos, 'Suplementos em dia'); end if;

  select score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors
    into v_last_score, v_last_level, v_last_status, v_last_streak, v_last_weekly, v_last_risk, v_last_pos
  from public.adherence_snapshots
  where patient_id = v_patient
  order by calculated_at desc, id desc
  limit 1;
  if v_last_score is not distinct from v_score
     and v_last_level is not distinct from v_level
     and v_last_status is not distinct from v_status
     and v_last_streak is not distinct from v_streak
     and v_last_weekly is not distinct from v_weekly
     and v_last_risk is not distinct from v_risk
     and v_last_pos is not distinct from v_pos
  then
    return;
  end if;

  insert into public.adherence_snapshots
    (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
  values (v_patient, v_score, v_level, v_status, v_streak, v_weekly, v_risk, v_pos);
end $$;

revoke all on function private.recompute_adherence_for(uuid) from public, anon, authenticated;

comment on function private.recompute_adherence_for(uuid) is
  'WP-08B1: motor do VRI. Fórmula invariável desde WP-METRIC-1a. SECURITY INVOKER, '
  'sem execute para anon/authenticated. Lock xact por paciente (classe 808150901). '
  'SKIP só quando score/level/status/streak/weekly/risk_factors/positive_factors são '
  'idênticos ao último snapshot. Caminho de cliente: public.recompute_adherence().';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) private.recompute_adherence_all — lote. NÃO duplica fórmula.
--
-- Elegibilidade V1 (decisão fechada): DISTINCT patient_id em adherence_snapshots.
-- Paciente sem snapshot NÃO entra (não transformar "—" em 70/inativo).
-- SECURITY INVOKER + search_path='' + revoke cliente: o cron (WP-08B2) roda como
-- owner/postgres. NÃO copiar o EXECUTE PUBLIC de recompute_recovery_decay.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.recompute_adherence_all()
returns table(
  seen int,
  succeeded int,
  changed int,
  unchanged int,
  failed int
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  v_seen int := 0;
  v_ok int := 0;
  v_changed int := 0;
  v_unchanged int := 0;
  v_failed int := 0;
  v_antes int;
  v_depois int;
begin
  for r in
    select distinct s.patient_id
    from public.adherence_snapshots s
    where s.patient_id is not null
    order by s.patient_id
  loop
    v_seen := v_seen + 1;
    select count(*) into v_antes
      from public.adherence_snapshots s
     where s.patient_id = r.patient_id;
    begin
      perform private.recompute_adherence_for(r.patient_id);
      v_ok := v_ok + 1;
      select count(*) into v_depois
        from public.adherence_snapshots s
       where s.patient_id = r.patient_id;
      if v_depois > v_antes then
        v_changed := v_changed + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'WP-08B1 recompute_adherence_all: patient failed sqlstate=%', sqlstate;
    end;
  end loop;

  seen := v_seen;
  succeeded := v_ok;
  changed := v_changed;
  unchanged := v_unchanged;
  failed := v_failed;
  return next;

  raise notice 'WP-08B1 recompute_adherence_all: seen=% succeeded=% changed=% unchanged=% failed=%',
    v_seen, v_ok, v_changed, v_unchanged, v_failed;
end;
$$;

revoke all on function private.recompute_adherence_all() from public, anon, authenticated;

comment on function private.recompute_adherence_all() is
  'WP-08B1: lote de reconciliação do VRI. Só pacientes com ≥1 adherence_snapshot. '
  'Delega a private.recompute_adherence_for. SECURITY INVOKER, search_path vazio, '
  'sem execute para public/anon/authenticated. SEM cron neste WP.';


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260815090000',
  '20260815090000_wp_08b1_vri_temporal_batch.sql',
  'WP-08B1: skip funcional do VRI (status/streak/weekly/fatores) + lock xact por '
  'paciente em recompute_adherence_for. Batch private.recompute_adherence_all só '
  'para quem já tem snapshot. Sem cron, sem fórmula nova, sem apply remoto neste WP.',
  'WP-08B1'
)
on conflict (version) do nothing;
