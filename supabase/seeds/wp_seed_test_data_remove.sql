-- =====================================================================================
-- WP-SEED · REMOÇÃO (v2) — desfaz EXATAMENTE o que wp_seed_test_data.sql criou.
--
-- ⚠️ NÃO É MIGRATION (mesma pasta supabase/seeds/, fora de supabase/migrations/, fora do ledger).
--
-- ÂNCORA (o mesmo critério declarado no seed): os 6 profiles de PROFISSIONAL têm id determinístico
--   md5('wp-seed:v2:'||<chave>)::uuid. A partir deles:
--     clínicas    = as que têm owner_profile_id nesse conjunto
--     profissionais = professionals.clinic_id nessas clínicas
--     pacientes   = patients.clinic_id nessas clínicas
--     resto       = filhos por FK (planos, registros, chat, jornada, vínculos, colunas da jornada)
--   Nada é apagado por nome/heurística — só pelo fecho transitivo dessas 6 âncoras.
--
-- IDEMPOTENTE: se as âncoras não existem, não faz nada. NÃO altera schema, policies ou funções.
-- Roda como `postgres` (bypassrls). Ordem = dependências (filhos antes dos pais).
-- =====================================================================================
do $rm$
declare
  ns constant text := 'wp-seed:v2:';
  anchors uuid[] := array[
    md5(ns||'prof:alfa:owner')::uuid, md5(ns||'prof:alfa:edu')::uuid,
    md5(ns||'prof:alfa:med')::uuid,   md5(ns||'prof:alfa:nodisc')::uuid,
    md5(ns||'prof:alfa:ext')::uuid,   md5(ns||'prof:beta:owner')::uuid];
  clinics_ uuid[]; profs uuid[]; pats uuid[]; patprofiles uuid[]; chans uuid[];
  wplans uuid[]; nplans uuid[]; sessions uuid[];
  n_removidos int := 0;
begin
  select coalesce(array_agg(id), '{}') into clinics_
    from public.clinics where owner_profile_id = any(anchors);

  if array_length(clinics_, 1) is null and not exists (select 1 from public.profiles where id = any(anchors)) then
    raise notice 'WP-SEED REMOVE: nada encontrado (seed nao aplicado) - nada a fazer.';
    return;
  end if;

  select coalesce(array_agg(id), '{}') into profs from public.professionals where clinic_id = any(clinics_);
  select coalesce(array_agg(id), '{}') into pats  from public.patients      where clinic_id = any(clinics_);
  select coalesce(array_agg(profile_id), '{}') into patprofiles from public.patients where id = any(pats);
  select coalesce(array_agg(id), '{}') into chans from public.chat_channels where patient_id = any(pats);
  select coalesce(array_agg(id), '{}') into wplans from public.workout_plans   where patient_id = any(pats);
  select coalesce(array_agg(id), '{}') into nplans from public.nutrition_plans where patient_id = any(pats);
  select coalesce(array_agg(id), '{}') into sessions from public.workout_session_logs where patient_id = any(pats);

  -- ── registros do paciente ──
  delete from public.workout_set_logs      where session_log_id = any(sessions);
  delete from public.workout_session_logs  where patient_id = any(pats);
  delete from public.meal_logs             where patient_id = any(pats);
  delete from public.activity_events       where patient_id = any(pats);
  delete from public.weight_logs           where patient_id = any(pats);
  delete from public.body_assessments      where patient_id = any(pats);   -- anamnese do create_patient

  -- ── chat ──
  delete from public.chat_messages     where channel_id = any(chans);
  delete from public.chat_participants where channel_id = any(chans);
  delete from public.chat_channels     where id = any(chans);

  -- ── jornada ──
  delete from public.patient_journey_moves where patient_id = any(pats);
  delete from public.patient_journey_state where patient_id = any(pats);

  -- ── prescrições ──
  delete from public.workout_exercises where workout_id in (select id from public.workouts where workout_plan_id = any(wplans));
  delete from public.workouts          where workout_plan_id = any(wplans);
  delete from public.workout_plans     where id = any(wplans);
  delete from public.meals             where nutrition_plan_id = any(nplans);
  delete from public.nutrition_plans   where id = any(nplans);

  -- ── vínculos e pacientes ──
  delete from public.professional_patient_links where patient_id = any(pats) or professional_id = any(profs);
  delete from public.patients where id = any(pats);
  delete from public.profiles where id = any(patprofiles);

  -- ── equipe e clínicas ──
  delete from public.professional_disciplines where professional_id = any(profs);
  delete from public.professionals            where id = any(profs);
  delete from public.journey_columns          where clinic_id = any(clinics_);   -- criadas pelo trigger da clínica
  delete from public.clinics                  where id = any(clinics_);

  -- ── profiles âncora dos profissionais ──
  delete from public.profiles where id = any(anchors);
  get diagnostics n_removidos = row_count;

  raise notice 'WP-SEED REMOVE OK: % clinicas, % profissionais, % pacientes, % profiles-ancora.',
    coalesce(array_length(clinics_,1),0), coalesce(array_length(profs,1),0),
    coalesce(array_length(pats,1),0), n_removidos;
end
$rm$;
