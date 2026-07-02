-- =====================================================================================
-- VERTEXA — Seed CONVERGENTE da Mariana (fecha a pendência #3b)
-- ADITIVO/reversível. NÃO altera schema. NÃO renomeia colunas. NÃO toca tabelas web-only.
--
-- Problema (#3b): o snapshot autoral dizia streak=18/weekly=80%/score≈88, mas a Mariana só tinha
-- 4 activity_events esparsos (jun 25–29). Com a engine CALIBRADA (S15/C7) o recompute VIVO dava
-- streak≈0-1 / weekly≈20% — então na 1ª ação dela o painel via a sequência despencar 18→1.
--
-- Solução: plantar uma janela ROLANTE de 18 dias de eventos REAIS, RELATIVA a now(), de modo que a
-- ENGINE CALCULE streak=18, weekly=80% e score na banda ~95/alta (o "88" autoral é INCOMPATÍVEL com
-- um perfil engajado sob a engine calibrada — decisão aprovada: adotar o valor engine-honesto ~95).
-- O baseline (snapshot que o web LÊ) é ESCRITO PELA ENGINE (app/eventSync), não cravado aqui.
--
-- DRIFT: datas fixas envelhecem (o streak colapsa em ~2 dias). Por isso o seed é uma FUNÇÃO
-- refreshável (fonte única, versionada). Ritual pré-demo (via MCP + app):
--     select public.refresh_demo_mariana_streak();   -- replanta 18 dias relativos a now()
--     + 1 ação real da Mariana no app (ex.: registrar água)  -> eventSync recomputa e grava o snapshot
--
-- A função é DONA do estado de activity_events da Mariana (delete-all + replant determinístico):
--   * 18 dias consecutivos (D0=hoje .. D17), 1 hydration_logged/dia em D1..D17 (mantém o streak);
--   * workout_checked em D0,D2,D4,D6 -> 4 treinos nos últimos 7 dias -> weekly 80%;
--   * marcadores de timeline (weight_logged @D1, progress_photo_uploaded @D7) — não afetam a engine
--     (recência de peso/foto vem das TABELAS weight_logs/progress_photos), só a Timeline.
-- Eventos marcados com payload->>'seed'='demo_mariana_streak'.
--
-- Rollback:
--   drop function if exists public.refresh_demo_mariana_streak();
--   delete from public.activity_events
--     where patient_id = '10000000-0000-0000-0000-0000000000b1'
--       and payload->>'seed' = 'demo_mariana_streak';
--   -- (opcional) restaurar os 4 eventos esparsos originais do seed base:
--   --   ver migration 20260617110000_seed_base_demo (workout/hydration @29/06, weight @28/06, foto @25/06).
-- =====================================================================================

create or replace function public.refresh_demo_mariana_streak()
returns void
language plpgsql
as $$
declare
  v_patient uuid := '10000000-0000-0000-0000-0000000000b1'; -- Mariana (patients.id)
  k int;
  d int;
begin
  -- A função é dona do estado de demo: reseta TODOS os activity_events da Mariana e replanta.
  delete from public.activity_events where patient_id = v_patient;

  -- 18 dias consecutivos: hidratação em D1..D17 (D0 fica p/ a ação do dia; o streak termina hoje
  -- pelo workout de D0 abaixo). Água canônica -> payload.liters.
  for k in 1..17 loop
    insert into public.activity_events (patient_id, type, payload, created_at)
    values (
      v_patient,
      'hydration_logged',
      jsonb_build_object('liters', 2.0, 'seed', 'demo_mariana_streak'),
      now() - make_interval(days => k)
    );
  end loop;

  -- 4 treinos nos últimos 7 dias (D0, D2, D4, D6) -> workoutsThisWeek=4 -> weekly_completion_rate=80%.
  foreach d in array array[0, 2, 4, 6] loop
    insert into public.activity_events (patient_id, type, payload, created_at)
    values (
      v_patient,
      'workout_checked',
      jsonb_build_object('seed', 'demo_mariana_streak'),
      now() - make_interval(days => d)
    );
  end loop;

  -- Marcadores de Timeline (cosméticos; a recência de peso/foto vem das tabelas, não daqui).
  insert into public.activity_events (patient_id, type, payload, created_at) values
    (v_patient, 'weight_logged',            jsonb_build_object('seed', 'demo_mariana_streak'), now() - make_interval(days => 1)),
    (v_patient, 'progress_photo_uploaded',  jsonb_build_object('seed', 'demo_mariana_streak'), now() - make_interval(days => 7));
end;
$$;

-- Sem EXECUTE para o client (espelha 20260630234139_revoke_rls_auto_enable_public_execute):
-- a função é chamada só por ops via MCP (service_role). NÃO expor a anon/authenticated.
revoke execute on function public.refresh_demo_mariana_streak() from public;
revoke execute on function public.refresh_demo_mariana_streak() from anon;
revoke execute on function public.refresh_demo_mariana_streak() from authenticated;

-- Planta o seed uma vez no apply.
select public.refresh_demo_mariana_streak();
