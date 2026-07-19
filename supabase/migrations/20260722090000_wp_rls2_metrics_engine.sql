-- =====================================================================================
-- WP-RLS2 — MOTOR DE MÉTRICAS NO SERVIDOR (adesão/VRI, recuperação, conquistas).
-- Fecha a DÍVIDA-RLS-2: 3 tabelas de métricas DERIVADAS eram gravadas pelo PRÓPRIO paciente
-- (RLS impedia forjar a de OUTRO, mas não a PRÓPRIA). Aqui o cálculo passa a ser 100%
-- server-side, derivado dos dados BRUTOS (que o paciente legitimamente grava). O LOCKDOWN das
-- policies (paciente sem escrita) vem na migration seguinte (…_lockdown).
--
-- POR QUE SECURITY DEFINER (e por que NÃO é bypass): as RPCs/trigger escrevem em tabelas que o
-- paciente NÃO poderá mais escrever (pós-lockdown). Rodam como owner (bypassam RLS) MAS o valor
-- é SEMPRE derivado no servidor do bruto do PRÓPRIO paciente:
--   · RPCs: sem parâmetro de patient_id — derivam private.current_patient_id() (o do chamador).
--     Um profissional (current_patient_id NULL) não recalcula; só lê. Ninguém recalcula de outro.
--   · Trigger de recuperação: usa NEW.patient_id da linha bruta (já checada pela RLS no INSERT).
-- Nenhum valor vem do client — o client só dispara o RECÁLCULO (RPC) ou grava o BRUTO (evento).
--
-- FUSO (decisão do dono, WP-RLS2): "dia local" bucketizado em America/Sao_Paulo (BRT) — o app é
-- PT-BR. Divergência intencional vs o device-local do app: dispositivo fora de BRT pode ter ±1 dia
-- de fronteira (reportado). js_round replica Math.round do JS (half-up) p/ paridade exata.
--
-- RECUPERAÇÃO (divergência intencional REPORTADA): hoje o app grava status='fatigued' SEMPRE e
-- deriva o status real na LEITURA (recoveryRule por last_trained_at) — o web lê o persistido e
-- por isso mostra sempre 'fatigued' (bug latente). Aqui o status persistido vira VERDADEIRO:
-- trigger no evento de treino grava last_trained_at + status inicial, e um job pg_cron diário
-- recomputa o status por last_trained_at (decaimento fatigued→recovering→recovered→weakened).
--
-- NOTA (advisor 0029 authenticated_security_definer_function_executable): esperado/intencional —
-- estas funções SÃO o caminho de escrita das métricas; a segurança está na derivação server-side.
--
-- ROLLBACK:
--   drop trigger if exists trg_wp_rls2_recovery on public.activity_events;
--   select cron.unschedule('wp-rls2-recovery-decay');
--   drop function if exists public.recompute_adherence();
--   drop function if exists public.recompute_achievements();
--   drop function if exists private.recompute_recovery_on_event();
--   drop function if exists private.recompute_recovery_decay();
--   drop function if exists private.canonical_muscles_for_workout(uuid);
--   drop function if exists private.translate_pt_muscle(text);
--   drop function if exists private.recovery_status_for_days(int);
--   drop function if exists private.event_streak_brt(uuid);
--   drop function if exists private.brt_date(timestamptz);
--   drop function if exists private.js_round(double precision);
--   (o rollback COMPLETO reverte também o lockdown + a integração do app que passou a chamar as RPCs)
-- =====================================================================================

-- ───────────────────────── Helpers puros de bucketing (BRT) ─────────────────────────
create or replace function private.brt_date(p_ts timestamptz)
returns date language sql immutable set search_path = '' as $$
  select (p_ts at time zone 'America/Sao_Paulo')::date
$$;

-- Math.round do JS (half-up, toward +inf) — NÃO o round() bancário/half-even do double do Postgres.
create or replace function private.js_round(p double precision)
returns int language sql immutable set search_path = '' as $$
  select floor(p + 0.5)::int
$$;

-- days_ago local (BRT), clamp >= 0 — espelha daysAgoLocal (subtração de datas de calendário).
create or replace function private.days_ago_brt(p_ts timestamptz, p_ref timestamptz default now())
returns int language sql stable set search_path = '' as $$
  select greatest(0, private.brt_date(p_ref) - private.brt_date(p_ts))
$$;

-- streak: dias BRT consecutivos (terminando HOJE ou ONTEM) com >=1 activity_event. Espelha
-- deriveAdherenceConfig/deriveStreak. Janela dos 500 eventos mais recentes (igual ao app).
create or replace function private.event_streak_brt(p_patient uuid)
returns int language sql stable set search_path = '' as $$
  with recursive ev_days as (
    select distinct private.brt_date(created_at) as d
    from (
      select created_at from public.activity_events
      where patient_id = p_patient order by created_at desc limit 500
    ) s
  ),
  start_day as (
    select case
      when exists (select 1 from ev_days where d = private.brt_date(now()))     then private.brt_date(now())
      when exists (select 1 from ev_days where d = private.brt_date(now()) - 1) then private.brt_date(now()) - 1
      else null::date
    end as sd
  ),
  rec as (
    select sd as d, 1 as n from start_day where sd is not null
    union all
    select r.d - 1, r.n + 1 from rec r where exists (select 1 from ev_days where d = r.d - 1)
  )
  select coalesce(max(n), 0)::int from rec
$$;

-- ───────────────────────── Recuperação: mapa de músculo + regra ─────────────────────
-- Porta muscleMap.ts (RULES ordenadas, FIRST match vence) — normaliza (lower + sem acento) e
-- casa por substring. Retorna as chaves canônicas do BodyMap. Token não mapeado => {} (não inventa).
create or replace function private.translate_pt_muscle(p_token text)
returns text[] language plpgsql immutable set search_path = '' as $$
declare n text;
begin
  n := translate(lower(btrim(coalesce(p_token, ''))),
                 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  if n like '%pernas%'    then return array['quadriceps','hamstrings','glutes','calves']; end if;
  if n like '%deltoide%' or n like '%ombro%'                  then return array['shoulders']; end if;
  if n like '%peito%'                                          then return array['chest']; end if;
  if n like '%triceps%'                                        then return array['triceps']; end if;
  if n like '%biceps%' or n like '%braquial%'                  then return array['biceps']; end if;
  if n like '%dorsa%' or n like '%costas%' or n like '%romboide%' then return array['lats']; end if;
  if n like '%trapezio%'                                        then return array['traps']; end if;
  if n like '%antebraco%'                                       then return array['forearms']; end if;
  if n like '%quadriceps%'                                      then return array['quadriceps']; end if;
  if n like '%posterior%' or n like '%isquio%' or n like '%femoral%' then return array['hamstrings']; end if;
  if n like '%gluteo%'                                          then return array['glutes']; end if;
  if n like '%panturrilha%' or n like '%soleo%' or n like '%gastrocnemio%' then return array['calves']; end if;
  if n like '%lombar%'                                          then return array['lower_back']; end if;
  if n like '%abdomen%' or n like '%abdominal%' or n like '%core%' then return array['abs']; end if;
  return array[]::text[];
end $$;

-- Músculos canônicos treinados por um workout = união (dedup) dos muscle_groups dos seus exercícios,
-- traduzidos. Espelha musclesForWorkout (caminho do plano REAL: workout_exercises).
create or replace function private.canonical_muscles_for_workout(p_workout uuid)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct m order by m), array[]::text[])
  from (
    select unnest(private.translate_pt_muscle(tok)) as m
    from public.workout_exercises we
    cross join unnest(coalesce(we.muscle_groups, array[]::text[])) as tok
    where we.workout_id = p_workout
  ) x
$$;

-- Regra de decaimento (recoveryRule.ts): null→neutral, <=2 fatigued, 3 recovering, 4 recovered, >=5 weakened.
create or replace function private.recovery_status_for_days(p_days int)
returns public.muscle_status language sql immutable set search_path = '' as $$
  select (case
    when p_days is null            then 'neutral'
    when greatest(0, p_days) <= 2  then 'fatigued'
    when greatest(0, p_days) =  3  then 'recovering'
    when greatest(0, p_days) =  4  then 'recovered'
    else 'weakened'
  end)::public.muscle_status
$$;

-- ───────────────────────── RPC: recompute_adherence (VRI) ───────────────────────────
-- Porta adherenceEngine.ts (deriveAdherenceConfig + computeScore + level/status/weekly/factors).
-- Insert append (mesma semântica do app) com skip-if-unchanged (score E level == último).
create or replace function public.recompute_adherence()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid := private.current_patient_id();
  v_today date := private.brt_date(now());
  v_most_recent timestamptz;
  v_days_without int;
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
begin
  if v_patient is null then
    raise exception 'recompute_adherence: not a patient / not authenticated' using errcode = '42501';
  end if;

  -- Agregados dos eventos (janela dos 500 mais recentes, igual ao app).
  with ev as (
    select type, created_at,
           private.brt_date(created_at) as d,
           private.days_ago_brt(created_at, now()) as ago
    from public.activity_events
    where patient_id = v_patient
    order by created_at desc
    limit 500
  )
  select
    max(created_at),
    count(*) filter (where type in ('hydration_logged','sleep_logged','mood_logged') and d = v_today),
    count(distinct d) filter (where type = 'workout_checked' and ago <= 6),
    count(distinct d) filter (where type = 'activity_logged' and ago <= 6)
  into v_most_recent, v_habits_today, v_workouts_week, v_activity_week
  from ev;

  v_days_without := case when v_most_recent is null then 30
                         else private.days_ago_brt(v_most_recent, now()) end;
  v_streak := private.event_streak_brt(v_patient);

  select max(measured_at) into v_last_weight from public.weight_logs where patient_id = v_patient;
  select max(taken_at)    into v_last_photo  from public.progress_photos where patient_id = v_patient;
  v_weight_recent := v_last_weight is not null and private.days_ago_brt(v_last_weight, now()) <= 7;
  v_photo_recent  := v_last_photo  is not null and private.days_ago_brt(v_last_photo,  now()) <= 30;
  v_plan_viewed   := v_days_without <= 3;

  -- Adesão alimentar de HOJE: plano ativo = nutrition_plan mais recente; done = meals do plano com log hoje.
  with plan as (
    select id from public.nutrition_plans where patient_id = v_patient order by created_at desc limit 1
  ),
  plan_meals as (
    select m.id from public.meals m where m.nutrition_plan_id = (select id from plan)
  ),
  done as (
    select distinct meal_id from public.meal_logs where patient_id = v_patient and consumed_on = v_today
  )
  select count(pm.id), count(pm.id) filter (where d.meal_id is not null)
  into v_meal_total, v_meal_done
  from plan_meals pm left join done d on d.meal_id = pm.id;
  v_meal_ratio := case when v_meal_total > 0 then v_meal_done::double precision / v_meal_total else 0 end;

  -- Adesão a suplementos de HOJE.
  with lst as (select id from public.supplements where patient_id = v_patient),
  taken as (select distinct supplement_id from public.supplement_intakes where patient_id = v_patient and taken_on = v_today)
  select count(l.id), count(l.id) filter (where t.supplement_id is not null)
  into v_supp_total, v_supp_taken
  from lst l left join taken t on t.supplement_id = l.id;
  v_supp_ratio := case when v_supp_total > 0 then v_supp_taken::double precision / v_supp_total else 0 end;

  -- engagement (mesmos tiers do app; parcelas >= 0). js_round p/ os fatores round(...).
  v_engagement :=
      least(v_habits_today * 3, 12)
    + least(v_workouts_week * 4, 16)
    + (case when v_weight_recent then 5 else 0 end)
    + (case when v_photo_recent  then 5 else 0 end)
    + (case when v_plan_viewed   then 3 else 0 end)
    + (case when v_streak >= 30 then 10 when v_streak >= 14 then 7 when v_streak >= 7 then 4 else 0 end)
    + (case when v_meal_ratio > 0 then private.js_round(least(1, v_meal_ratio) * 6) else 0 end)
    + (case when v_activity_week > 0 then least(v_activity_week, 3) * 2 else 0 end)
    + (case when v_supp_ratio > 0 then private.js_round(least(1, v_supp_ratio) * 4) else 0 end);

  v_recency := case
    when v_days_without <= 1 then 12
    when v_days_without <= 3 then 8
    when v_days_without <= 6 then 4
    when v_days_without <= 14 then 1
    else 0 end;

  v_signal := v_recency + v_engagement;
  v_normalized := least(1, greatest(0, v_signal / 75.0));
  v_score := greatest(0, least(100, private.js_round(70 + 30 * power(v_normalized, 0.42))));

  v_level := case when v_score >= 80 then 'alta' when v_score >= 50 then 'moderada'
                  when v_score >= 20 then 'baixa' else 'risco' end;
  v_status := (case when v_days_without >= 15 then 'inativo'
                    when v_score < 20 then 'em_risco'
                    when v_score < 50 then 'atencao'
                    else 'em_acompanhamento' end)::public.patient_status;
  v_weekly := private.js_round((v_workouts_week::double precision / 5) * 100);

  -- risk_factors (ordem do app). array_append evita ambiguidade text[] || unknown.
  if v_days_without >= 3   then v_risk := array_append(v_risk, v_days_without || ' dias sem interação'); end if;
  if v_habits_today = 0    then v_risk := array_append(v_risk, 'Nenhum hábito registrado hoje'); end if;
  if v_workouts_week < 2   then v_risk := array_append(v_risk, 'Poucos treinos esta semana'); end if;
  if not v_weight_recent   then v_risk := array_append(v_risk, 'Peso não registrado recentemente'); end if;
  if not v_photo_recent    then v_risk := array_append(v_risk, 'Foto mensal pendente'); end if;

  -- positive_factors (ordem do app)
  if v_streak >= 7         then v_pos := array_append(v_pos, 'Sequência de ' || v_streak || ' dias'); end if;
  if v_habits_today >= 3   then v_pos := array_append(v_pos, 'Hábitos em dia'); end if;
  if v_workouts_week >= 3  then v_pos := array_append(v_pos, 'Treinos consistentes'); end if;
  if v_weight_recent       then v_pos := array_append(v_pos, 'Peso atualizado'); end if;
  if v_plan_viewed         then v_pos := array_append(v_pos, 'Plano acompanhado'); end if;
  if v_meal_ratio >= 0.6   then v_pos := array_append(v_pos, 'Refeições do dia em dia'); end if;
  if v_activity_week >= 2  then v_pos := array_append(v_pos, 'Atividades complementares na semana'); end if;
  if v_supp_ratio >= 0.6   then v_pos := array_append(v_pos, 'Suplementos em dia'); end if;

  -- skip-if-unchanged (score E level == último snapshot)
  select score, level into v_last_score, v_last_level
  from public.adherence_snapshots where patient_id = v_patient
  order by calculated_at desc limit 1;
  if v_last_score is not distinct from v_score and v_last_level is not distinct from v_level then
    return;
  end if;

  insert into public.adherence_snapshots
    (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
  values (v_patient, v_score, v_level, v_status, v_streak, v_weekly, v_risk, v_pos);
end $$;

-- ───────────────────────── RPC: recompute_achievements ──────────────────────────────
-- Porta achievementsEngine.ts (evaluateAchievements + facts). Upsert monotônico (ON CONFLICT DO NOTHING).
create or replace function public.recompute_achievements()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid := private.current_patient_id();
  v_workout_days int := 0;
  v_streak int;
  v_start numeric; v_current numeric; v_target numeric;
  v_kg_lost numeric; v_reached boolean;
  v_codes text[] := array[]::text[];
begin
  if v_patient is null then
    raise exception 'recompute_achievements: not a patient / not authenticated' using errcode = '42501';
  end if;

  with ev as (
    select type, private.brt_date(created_at) as d
    from public.activity_events where patient_id = v_patient order by created_at desc limit 500
  )
  select count(distinct d) filter (where type = 'workout_checked') into v_workout_days from ev;
  v_streak := private.event_streak_brt(v_patient);

  select start_weight, current_weight, target_weight into v_start, v_current, v_target
  from public.patients where id = v_patient;
  v_kg_lost := case when v_start is not null and v_current is not null then greatest(0, v_start - v_current) else 0 end;
  v_reached := case when v_current is not null and v_target is not null then v_current <= v_target else false end;

  if v_workout_days >= 1 then v_codes := array_append(v_codes, 'first_workout'); end if;
  if exists (select 1 from public.weight_logs        where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_weight'); end if;
  if exists (select 1 from public.progress_photos    where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_photo'); end if;
  if exists (select 1 from public.meal_logs          where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_meal_day'); end if;
  if exists (select 1 from public.activity_sessions  where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_activity'); end if;
  if exists (select 1 from public.supplement_intakes where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_supplement'); end if;
  if v_streak >= 7  then v_codes := array_append(v_codes, 'streak_7');  end if;
  if v_streak >= 14 then v_codes := array_append(v_codes, 'streak_14'); end if;
  if v_streak >= 30 then v_codes := array_append(v_codes, 'streak_30'); end if;
  if v_kg_lost >= 3 then v_codes := array_append(v_codes, 'weight_3kg'); end if;
  if v_kg_lost >= 5 then v_codes := array_append(v_codes, 'weight_5kg'); end if;
  if v_reached      then v_codes := array_append(v_codes, 'weight_target'); end if;

  if array_length(v_codes, 1) is null then return; end if;

  insert into public.patient_achievements (patient_id, achievement_code, source)
  select v_patient, code, 'engine' from unnest(v_codes) as code
  on conflict (patient_id, achievement_code) do nothing;
end $$;

-- ───────────────────────── Recuperação: trigger (evento) + decay (cron) ─────────────
-- Sinal bruto REAL de "treino concluído" = activity_events(type=workout_checked, action=completed,
-- workoutId). Resolve os músculos do workout REAL e faz upsert do estado de recuperação.
create or replace function private.recompute_recovery_on_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_workout uuid;
  v_muscles text[];
  v_trained_at timestamptz := coalesce(NEW.created_at, now());
  m text;
begin
  -- workoutId precisa ser uuid de um workout REAL; senão (mock/legado) ignora (espelha musclesForWorkout=[]).
  begin
    v_workout := (NEW.payload->>'workoutId')::uuid;
  exception when others then
    return NEW;
  end;
  if v_workout is null then return NEW; end if;

  v_muscles := private.canonical_muscles_for_workout(v_workout);
  if array_length(v_muscles, 1) is null then return NEW; end if;

  foreach m in array v_muscles loop
    insert into public.muscle_recovery_states
      (patient_id, muscle_group, last_trained_at, last_intensity, status, calculated_at)
    values (NEW.patient_id, m, v_trained_at, 70,
            private.recovery_status_for_days(private.days_ago_brt(v_trained_at, now())), now())
    on conflict (patient_id, muscle_group) do update
      set last_trained_at = excluded.last_trained_at,
          last_intensity  = excluded.last_intensity,
          status          = excluded.status,
          calculated_at   = excluded.calculated_at;
  end loop;
  return NEW;
end $$;

drop trigger if exists trg_wp_rls2_recovery on public.activity_events;
create trigger trg_wp_rls2_recovery
  after insert on public.activity_events
  for each row
  when (NEW.type = 'workout_checked'
        and NEW.payload->>'action' = 'completed'
        and NEW.payload->>'workoutId' is not null)
  execute function private.recompute_recovery_on_event();

-- Decaimento temporal: recomputa status por last_trained_at (só as linhas que mudariam).
create or replace function private.recompute_recovery_decay()
returns void language sql security definer set search_path = '' as $$
  update public.muscle_recovery_states s
  set status = private.recovery_status_for_days(private.days_ago_brt(s.last_trained_at, now())),
      calculated_at = now()
  where s.status is distinct from private.recovery_status_for_days(private.days_ago_brt(s.last_trained_at, now()))
$$;

-- pg_cron: job diário ~06:05 BRT (09:05 UTC) p/ o decaimento. Idempotente por nome.
create extension if not exists pg_cron;
select cron.schedule('wp-rls2-recovery-decay', '5 9 * * *', $cron$select private.recompute_recovery_decay();$cron$);

-- ───────────────────────── Grants / revokes ────────────────────────────────────────
revoke all on function public.recompute_adherence()    from public, anon;
revoke all on function public.recompute_achievements()  from public, anon;
grant execute on function public.recompute_adherence()   to authenticated;
grant execute on function public.recompute_achievements() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260722090000','20260722090000_wp_rls2_metrics_engine.sql',
  'WP-RLS2 motor server-side: RPCs SECURITY DEFINER recompute_adherence/recompute_achievements (derivam '
  'do bruto do proprio paciente via current_patient_id; execute so authenticated), trigger de recuperacao '
  'em activity_events(workout_checked/completed) + decaimento por pg_cron. Helpers BRT/js_round/streak/muscle. '
  'Portam adherenceEngine/achievementsEngine/recoveryRule (paridade provada). RLS NAO afrouxada (lockdown a seguir).',
  'WP-RLS2')
on conflict (version) do nothing;
