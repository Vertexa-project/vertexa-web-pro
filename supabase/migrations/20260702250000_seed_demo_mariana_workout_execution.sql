-- =====================================================================================
-- VERTEXA — Seed RETROATIVO de EXECUÇÃO da Mariana (workout_session_logs + workout_set_logs)
-- ADITIVO/reversível. NÃO altera schema. NÃO renomeia colunas. DISPLAY/fixture — VRI-INVARIANTE.
--
-- Contexto (#S-EXEC): a Mariana tem 4 workout_checked de seed (janela rolante), mas SEM execução.
-- Os blocos religados do Progresso (volume/nº-exs-séries-reps-carga/tempo/regiões%) ficariam vazios
-- na demo até ela treinar no app. Este seed planta 2 sessões DISPLAY-only nos 2 treinos reais dela.
--
-- INVARIANTE VRI: workout_session_logs/workout_set_logs NÃO são inputs do adherenceEngine (que lê só
-- activity_events.type/created_at). Este seed NÃO cria activity_events -> streak/weekly/score da Mariana
-- (≈96/alta) ficam INTACTOS. É fixture de leitura, não marcador.
--
-- RELATIVO A now() (não datas fixas): as 2 sessões caem em D0 (hoje) e D2 (2 dias atrás), ambas dentro
-- dos 7d p/ o "volume semanal" enxergar. Alinha-se aos workout_checked D0/D2 do refresh_demo_mariana_streak.
-- Resolve workout_id / workout_exercise_id DINAMICAMENTE (letra do treino + order_index) — NÃO hardcoda
-- os uuids aleatórios de workout_exercises. Snapshots workout_name/exercise_name gravados p/ durabilidade.
--
-- OWNERSHIP/IDEMPOTÊNCIA: source='seed' marca as linhas de fixture; a função é DONA delas
-- (delete-all + replant). O E2E do app grava source='app' (limpo à parte por id). set_logs somem por
-- cascade ao deletar a sessão.
--
-- RITUAL DE DEMO consolidado (2 passos) — ver refresh_demo_mariana() no fim:
--     select public.refresh_demo_mariana();   -- streak (activity_events) + execução (session/set logs)
--     + 1 ação real da Mariana no app          -> eventSync recomputa e grava o snapshot fresco
--
-- Rollback:
--   drop function if exists public.refresh_demo_mariana();
--   drop function if exists public.refresh_demo_mariana_workout_execution();
--   delete from public.workout_session_logs
--     where patient_id = '10000000-0000-0000-0000-0000000000b1' and source = 'seed';
--   -- (set_logs somem por ON DELETE CASCADE)
-- =====================================================================================

create or replace function public.refresh_demo_mariana_workout_execution()
returns void
language plpgsql
as $$
declare
  v_patient uuid := '10000000-0000-0000-0000-0000000000b1'; -- Mariana (patients.id)
  v_plan uuid;
  v_session uuid;
  rec_w record;
  rec_e record;
  s int;
  v_reps int;
begin
  -- A função é dona da execução de DEMO da Mariana: reseta as linhas de seed e replanta.
  delete from public.workout_session_logs
    where patient_id = v_patient and source = 'seed';

  select id into v_plan from public.workout_plans
    where patient_id = v_patient order by created_at desc limit 1;
  if v_plan is null then return; end if;

  -- 2 sessões: treino A (letra 'A') em D2, treino B (letra 'B') em D0 (ambas dentro dos 7 dias).
  for rec_w in
    select w.id, w.name, w.letter,
           case w.letter when 'A' then 2 when 'B' then 0 else null end as day_off
    from public.workouts w
    where w.workout_plan_id = v_plan and w.letter in ('A', 'B')
  loop
    if rec_w.day_off is null then continue; end if;

    insert into public.workout_session_logs
      (patient_id, workout_id, workout_name, performed_on, started_at, completed_at,
       total_duration_min, source, notes)
    values
      (v_patient, rec_w.id, rec_w.name,
       -- performed_on = data LOCAL (America/Sao_Paulo), NÃO a data UTC de now() (que vira o dia seguinte à noite).
       ((now() at time zone 'America/Sao_Paulo') - make_interval(days => rec_w.day_off))::date,
       now() - make_interval(days => rec_w.day_off) - make_interval(mins => 52),
       now() - make_interval(days => rec_w.day_off),
       52, 'seed', 'demo_mariana_workout_execution')
    returning id into v_session;

    -- 1 set_log por série prescrita, pré-preenchido do plano com variação crível (última série -1 rep).
    for rec_e in
      select we.id, we.name, coalesce(we.sets, 1) as sets, coalesce(we.reps, 10) as reps,
             coalesce(we.load_kg, 0) as load_kg
      from public.workout_exercises we
      where we.workout_id = rec_w.id
      order by we.order_index
    loop
      for s in 1..rec_e.sets loop
        v_reps := case when s = rec_e.sets then greatest(rec_e.reps - 1, 1) else rec_e.reps end;
        insert into public.workout_set_logs
          (session_log_id, workout_exercise_id, exercise_name, set_index, weight_kg, reps_done, rest_seconds)
        values
          (v_session, rec_e.id, rec_e.name, s, rec_e.load_kg, v_reps, null);
      end loop;
    end loop;
  end loop;
end;
$$;

-- Guarda-chuva: consolida o ritual de demo em 1 chamada (streak + execução). Escolha guarda-chuva em vez
-- de acoplar dentro de refresh_demo_mariana_streak() para NÃO reescrever o corpo da função do baseline VRI.
create or replace function public.refresh_demo_mariana()
returns void
language plpgsql
as $$
begin
  perform public.refresh_demo_mariana_streak();
  perform public.refresh_demo_mariana_workout_execution();
end;
$$;

-- Sem EXECUTE para o client (espelha refresh_demo_mariana_streak): só ops via MCP (service_role).
revoke execute on function public.refresh_demo_mariana_workout_execution() from public;
revoke execute on function public.refresh_demo_mariana_workout_execution() from anon;
revoke execute on function public.refresh_demo_mariana_workout_execution() from authenticated;
revoke execute on function public.refresh_demo_mariana() from public;
revoke execute on function public.refresh_demo_mariana() from anon;
revoke execute on function public.refresh_demo_mariana() from authenticated;

-- Planta a execução de demo uma vez no apply (NÃO re-roda o streak aqui p/ não exigir recompute agora).
select public.refresh_demo_mariana_workout_execution();
