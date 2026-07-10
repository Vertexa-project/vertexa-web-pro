-- =====================================================================================
-- WP-APP-1 — RPCs de provisionamento server-side (transacionais, seguras) sob a RLS real (WP-05B).
-- Fecha as dívidas #16/#28/#13: createPatient (inseria profiles direto -> negado pela RLS) e save*Plan
-- (DELETE+INSERT não-atômico) migram para RPCs SECURITY DEFINER que RESPEITAM o modelo de autorização.
--
-- POR QUE SECURITY DEFINER (e por que NÃO é bypass): a criação de paciente precisa inserir em `profiles`,
-- que o client NÃO pode (nasce via trigger). A RPC roda como owner (bypassa RLS) MAS REVALIDA a autorização
-- internamente com os helpers private.* — faz as MESMAS checagens que a RLS faria. Anti-escalação: role
-- SEMPRE 'patient' (hardcoded), auth_user_id NUNCA setado (o login liga depois via handle_new_user
-- match-by-email), provider-gate intocado. search_path=''; EXECUTE só authenticated (revogado public/anon).
--
-- NOTA (advisor 0029 authenticated_security_definer_function_executable): esperado/intencional — estas RPCs
-- SÃO o caminho de escrita do profissional autenticado via /rpc; a segurança está na revalidação interna.
--
-- ATOMICIDADE: cada save_*_plan é UMA função -> DELETE+INSERT viram uma transação (erro no meio => tudo
-- revertido; sem plano parcial). Provado por teste Nível 1 (payload que falha -> plano antigo sobrevive).
--
-- KILL SWITCH / ROLLBACK: drop das 3 RPCs volta ao estado anterior (mas o estado anterior é o fluxo
-- QUEBRADO sob RLS — o rollback REAL é reverter também a integração do web que passou a chamá-las):
--   drop function if exists public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text);
--   drop function if exists public.save_workout_plan(uuid,text,text,jsonb);
--   drop function if exists public.save_nutrition_plan(uuid,text,jsonb);
-- =====================================================================================

-- ---- create_patient ----
create or replace function public.create_patient(
  p_clinic_id uuid, p_full_name text, p_email text default null,
  p_birth_date date default null, p_sex text default null, p_height_cm numeric default null,
  p_goal text default null, p_start_weight numeric default null, p_target_weight numeric default null,
  p_anamnese_method text default null, p_anamnese_weight numeric default null,
  p_anamnese_body_fat_pct numeric default null, p_anamnese_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_caller_profile uuid := private.current_profile_id();
  v_caller_prof uuid;
  v_profile_id uuid;
  v_patient_id uuid;
begin
  if v_caller_profile is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if btrim(coalesce(p_full_name,'')) = '' then raise exception 'full_name required' using errcode = '22023'; end if;
  if p_clinic_id is null then raise exception 'clinic_id required' using errcode = '22023'; end if;

  -- AUTORIZAÇÃO INTERNA: chamador deve ser PROFISSIONAL da clínica-alvo OU admin dela.
  select pr.id into v_caller_prof
  from public.professionals pr
  where pr.clinic_id = p_clinic_id and pr.profile_id = v_caller_profile
  limit 1;
  if v_caller_prof is null and not private.is_clinic_admin(p_clinic_id) then
    raise exception 'forbidden: caller is not staff of clinic' using errcode = '42501';
  end if;

  -- 1) profile do paciente. ANTI-ESCALAÇÃO: role SEMPRE 'patient'; auth_user_id NUNCA setado.
  insert into public.profiles (role, full_name, email, status)
  values ('patient', btrim(p_full_name), nullif(btrim(coalesce(p_email,'')),''), 'active')
  returning id into v_profile_id;

  -- 2) patients
  insert into public.patients (profile_id, clinic_id, goal, birth_date, sex, height_cm, start_weight, current_weight, target_weight)
  values (v_profile_id, p_clinic_id, nullif(btrim(coalesce(p_goal,'')),''), p_birth_date, p_sex, p_height_cm,
          p_start_weight, p_start_weight, p_target_weight)
  returning id into v_patient_id;

  -- 3) vínculo AMARRADO AO CHAMADOR (professional row dele nesta clínica). Admin sem prof row -> sem vínculo automático.
  if v_caller_prof is not null then
    insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_caller_prof, v_patient_id, false, 'active');
  end if;

  -- 4) anamnese opcional -> body_assessments (autoria = chamador)
  if p_anamnese_weight is not null or p_anamnese_body_fat_pct is not null
     or nullif(btrim(coalesce(p_anamnese_method,'')),'') is not null
     or nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then
    insert into public.body_assessments (patient_id, professional_id, method, weight, body_fat_pct, measurements)
    values (v_patient_id, v_caller_prof, nullif(btrim(coalesce(p_anamnese_method,'')),''), p_anamnese_weight, p_anamnese_body_fat_pct,
            case when nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null
                 then jsonb_build_object('notes', btrim(p_anamnese_notes)) else null end);
  end if;

  return v_patient_id;
end $$;

-- ---- save_workout_plan (transacional) ----
create or replace function public.save_workout_plan(
  p_patient_id uuid, p_title text, p_goal text default null, p_workouts jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_plan_id uuid; v_prof uuid; w jsonb; ex jsonb; v_workout_id uuid; i int := 0; j int;
begin
  if not private.can_prescribe_for_patient(p_patient_id) then
    raise exception 'forbidden: cannot prescribe for patient' using errcode = '42501';
  end if;
  if btrim(coalesce(p_title,'')) = '' then raise exception 'title required' using errcode = '22023'; end if;
  select pr.id into v_prof from public.professionals pr
    where pr.profile_id = private.current_profile_id()
      and pr.clinic_id = (select clinic_id from public.patients where id = p_patient_id) limit 1;

  delete from public.workout_plans where patient_id = p_patient_id;  -- atômico com os inserts abaixo
  insert into public.workout_plans (patient_id, professional_id, title, goal)
  values (p_patient_id, v_prof, btrim(p_title), nullif(btrim(coalesce(p_goal,'')),''))
  returning id into v_plan_id;

  for w in select value from jsonb_array_elements(coalesce(p_workouts,'[]'::jsonb)) loop
    i := i + 1;
    insert into public.workouts (workout_plan_id, letter, name, primary_muscle_group, day_index, estimated_minutes)
    values (v_plan_id, w->>'letter', w->>'name', w->>'primary_muscle_group', i, (w->>'estimated_minutes')::int)
    returning id into v_workout_id;
    j := 0;
    for ex in select value from jsonb_array_elements(coalesce(w->'exercises','[]'::jsonb)) loop
      j := j + 1;
      insert into public.workout_exercises (workout_id, name, muscle_groups, sets, reps, load_kg, order_index)
      values (v_workout_id, ex->>'name',
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(ex->'muscle_groups','[]'::jsonb)) x), '{}'),
              (ex->>'sets')::int, (ex->>'reps')::int, (ex->>'load_kg')::numeric, j);
    end loop;
  end loop;
  return v_plan_id;
end $$;

-- ---- save_nutrition_plan (transacional) ----
create or replace function public.save_nutrition_plan(
  p_patient_id uuid, p_title text, p_meals jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_plan_id uuid; v_prof uuid; m jsonb; i int := 0;
begin
  if not private.can_prescribe_for_patient(p_patient_id) then
    raise exception 'forbidden: cannot prescribe for patient' using errcode = '42501';
  end if;
  if btrim(coalesce(p_title,'')) = '' then raise exception 'title required' using errcode = '22023'; end if;
  select pr.id into v_prof from public.professionals pr
    where pr.profile_id = private.current_profile_id()
      and pr.clinic_id = (select clinic_id from public.patients where id = p_patient_id) limit 1;

  delete from public.nutrition_plans where patient_id = p_patient_id;
  insert into public.nutrition_plans (patient_id, professional_id, title, status)
  values (p_patient_id, v_prof, btrim(p_title), 'active')
  returning id into v_plan_id;

  for m in select value from jsonb_array_elements(coalesce(p_meals,'[]'::jsonb)) loop
    i := i + 1;
    insert into public.meals (nutrition_plan_id, time, name, items, calories, order_index)
    values (v_plan_id, m->>'time', m->>'name',
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(m->'items','[]'::jsonb)) x), '{}'),
            (m->>'calories')::int, i);
  end loop;
  return v_plan_id;
end $$;

revoke all on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text) from public, anon;
revoke all on function public.save_workout_plan(uuid,text,text,jsonb) from public, anon;
revoke all on function public.save_nutrition_plan(uuid,text,jsonb) from public, anon;
grant execute on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text) to authenticated;
grant execute on function public.save_workout_plan(uuid,text,text,jsonb) to authenticated;
grant execute on function public.save_nutrition_plan(uuid,text,jsonb) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260719090000','20260719090000_wp_app1_server_provisioning_rpcs.sql',
  'WP-APP-1: RPCs SECURITY DEFINER create_patient/save_workout_plan/save_nutrition_plan (transacionais, '
  'autorizacao interna via private.*; role sempre patient, auth_user_id nunca setado; search_path vazio; '
  'execute so authenticated). Fecha #16/#28/#13. RLS NAO afrouxada.',
  'WP-APP-1')
on conflict (version) do nothing;
