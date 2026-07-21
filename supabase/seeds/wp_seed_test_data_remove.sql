-- =====================================================================================
-- WP-SEED · REMOÇÃO — desfaz EXATAMENTE o que wp_seed_test_data.sql criou, na ordem de dependências,
-- sem tocar em nada fora do seed. Âncoras: as 2 clínicas determinísticas (md5('vseed:clinic:alfa'/'beta'));
-- tudo o mais é alcançado por FK (professionals/patients por clinic_id; filhos do paciente por patient_id;
-- perfis dos profissionais por id determinístico; perfis dos pacientes por patients.profile_id).
-- IDEMPOTENTE: se as clínicas não existem, não faz nada. NÃO altera schema/policies/funções.
-- =====================================================================================
do $rm$
declare
  clA uuid := md5('vseed:clinic:alfa')::uuid;
  clB uuid := md5('vseed:clinic:beta')::uuid;
  profprofiles uuid[] := array[
    md5('vseed:profile:alice')::uuid, md5('vseed:profile:bruno')::uuid, md5('vseed:profile:carlos')::uuid,
    md5('vseed:profile:dani')::uuid,  md5('vseed:profile:eva')::uuid,   md5('vseed:profile:bia')::uuid];
  pat uuid[]; patprofiles uuid[]; profs uuid[]; chans uuid[];
begin
  if not exists (select 1 from public.clinics where id in (clA, clB)) then
    raise notice 'WP-SEED remove: nada a remover (clínicas ausentes).';
    return;
  end if;

  select coalesce(array_agg(id),'{}'), coalesce(array_agg(profile_id) filter (where profile_id is not null),'{}')
    into pat, patprofiles from public.patients where clinic_id in (clA, clB);
  select coalesce(array_agg(id),'{}') into profs from public.professionals where clinic_id in (clA, clB);
  select coalesce(array_agg(id),'{}') into chans from public.chat_channels where patient_id = any(pat);

  -- chat (mensagens → participantes → canais)
  delete from public.chat_messages     where channel_id = any(chans);
  delete from public.chat_participants where channel_id = any(chans);
  delete from public.chat_channels     where patient_id = any(pat);
  -- jornada
  delete from public.journey_milestone_ack   where patient_id = any(pat);
  delete from public.patient_journey_moves    where patient_id = any(pat);
  delete from public.patient_journey_state    where patient_id = any(pat);
  -- execuções de treino (sets → sessões)
  delete from public.workout_set_logs where session_log_id in (select id from public.workout_session_logs where patient_id = any(pat));
  delete from public.workout_session_logs where patient_id = any(pat);
  -- prescrição alimentar (meal_logs → meals → planos)
  delete from public.meal_logs where patient_id = any(pat);
  delete from public.meals where nutrition_plan_id in (select id from public.nutrition_plans where patient_id = any(pat));
  delete from public.nutrition_plans where patient_id = any(pat);
  -- prescrição de treino (exercícios → treinos → planos)
  delete from public.workout_exercises where workout_id in (select id from public.workouts where workout_plan_id in (select id from public.workout_plans where patient_id = any(pat)));
  delete from public.workouts where workout_plan_id in (select id from public.workout_plans where patient_id = any(pat));
  delete from public.workout_plans where patient_id = any(pat);
  -- registros diversos
  delete from public.weight_logs      where patient_id = any(pat);
  delete from public.activity_events  where patient_id = any(pat);
  delete from public.body_assessments where patient_id = any(pat);
  -- vínculos
  delete from public.professional_patient_links where patient_id = any(pat) or professional_id = any(profs);
  -- pacientes
  delete from public.patients where id = any(pat);
  -- disciplinas + profissionais
  delete from public.professional_disciplines where professional_id = any(profs);
  delete from public.professionals where id = any(profs);
  -- colunas de jornada + clínicas
  delete from public.journey_columns where clinic_id in (clA, clB);
  delete from public.clinics where id in (clA, clB);
  -- perfis (profissionais determinísticos + perfis dos pacientes)
  delete from public.profiles where id = any(profprofiles) or id = any(patprofiles);

  raise notice 'WP-SEED remove: OK. pacientes removidos=% profissionais removidos=%',
    coalesce(array_length(pat,1),0), coalesce(array_length(profs,1),0);
end
$rm$;
