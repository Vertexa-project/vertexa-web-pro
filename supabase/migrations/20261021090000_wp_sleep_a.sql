-- =====================================================================================
-- WP-SLEEP · A — registro de sono do paciente (app) + seção 'sleep' no relatório.
-- sleep_logs: 1 registro por paciente por dia (slept_on = dia em que acordou), horas 0.5–24, qualidade 1–5
-- opcional. Segue o modelo de self-logs: SELECT = can_access_patient; INSERT/UPDATE/DELETE = is_self_patient.
-- UPDATE só em hours/quality (patient_id e dia imutáveis). anon: sem acesso.
-- =====================================================================================
create table if not exists public.sleep_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  slept_on date not null,
  hours numeric(4,2) not null check (hours >= 0.5 and hours <= 24),
  quality smallint check (quality between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, slept_on)
);
create index if not exists sleep_logs_patient_day_idx on public.sleep_logs (patient_id, slept_on desc);
alter table public.sleep_logs enable row level security;
revoke all on public.sleep_logs from anon, authenticated;
grant select, insert, delete on public.sleep_logs to authenticated;
grant update (hours, quality, updated_at) on public.sleep_logs to authenticated;
drop policy if exists sleep_logs_select on public.sleep_logs;
drop policy if exists sleep_logs_insert_self on public.sleep_logs;
drop policy if exists sleep_logs_update_self on public.sleep_logs;
drop policy if exists sleep_logs_delete_self on public.sleep_logs;
create policy sleep_logs_select on public.sleep_logs for select to authenticated using ( private.can_access_patient(patient_id) );
create policy sleep_logs_insert_self on public.sleep_logs for insert to authenticated
  with check ( private.is_self_patient(patient_id) and slept_on <= (now() at time zone 'America/Sao_Paulo')::date );
create policy sleep_logs_update_self on public.sleep_logs for update to authenticated
  using ( private.is_self_patient(patient_id) ) with check ( private.is_self_patient(patient_id) );
create policy sleep_logs_delete_self on public.sleep_logs for delete to authenticated using ( private.is_self_patient(patient_id) );

CREATE OR REPLACE FUNCTION public.export_patient_report(p_patient_id uuid, p_from date, p_to date, p_sections text[], p_surface text DEFAULT 'web'::text, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_known    constant text[] := array['identity','weight','anthropometry','workout_plan','nutrition_plan',
                                       'supplements','adherence','recovery','workout_execution','documents',
                                       'appointments','photos','achievements','timeline',
                                       'hydration','supplement_intakes','sleep'];
  v_cap_series constant int := 1000;
  v_cap_std    constant int := 500;
  v_cap_docs   constant int := 200;
  v_cap_photos constant int := 24;
  v_sections text[];
  v_section  text;
  v_clinic   uuid;
  v_result   jsonb := '{}'::jsonb;
  v_patient  jsonb;
  v_data     jsonb;
  v_total    int;
  v_count    int := 0;
  v_trunc    boolean := false;
begin
  if not private.can_prescribe_for_patient(p_patient_id) then
    raise exception 'export_patient_report: not authorized for this patient' using errcode = '42501';
  end if;

  if p_from is null or p_to is null then
    raise exception 'export_patient_report: period (p_from, p_to) is required' using errcode = '22023';
  end if;
  if p_from > p_to then
    raise exception 'export_patient_report: p_from is after p_to' using errcode = '22023';
  end if;
  if (p_to - p_from) > 366 then
    raise exception 'export_patient_report: period exceeds 366 days' using errcode = '22023';
  end if;

  v_sections := coalesce(nullif(p_sections, '{}'::text[]), array['identity','weight','anthropometry']);
  foreach v_section in array v_sections loop
    if not (v_section = any(v_known)) then
      raise exception 'export_patient_report: unknown section "%"', v_section using errcode = '22023';
    end if;
  end loop;

  v_clinic := private.patient_clinic(p_patient_id);

  select jsonb_build_object(
           'patient_id', pt.id, 'full_name', pr.full_name, 'sex', pt.sex, 'birth_date', pt.birth_date,
           'height_cm', pt.height_cm, 'goal', pt.goal, 'start_date', pt.start_date,
           'start_weight', pt.start_weight, 'current_weight', pt.current_weight, 'target_weight', pt.target_weight,
           'clinic', jsonb_build_object('id', cl.id, 'name', cl.name))
    into v_patient
    from public.patients pt
    left join public.profiles pr on pr.id = pt.profile_id
    left join public.clinics  cl on cl.id = pt.clinic_id
   where pt.id = p_patient_id;

  if 'identity' = any(v_sections) then
    v_result := v_result || jsonb_build_object('identity', v_patient);
    v_count  := v_count + 1;
  end if;

  if 'weight' = any(v_sections) then
    select count(*) into v_total from public.weight_logs w
      where w.patient_id = p_patient_id and w.measured_at::date between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('measured_at', measured_at, 'weight_kg', weight_kg, 'source', source) o,
             row_number() over (order by measured_at) rn
        from public.weight_logs
       where patient_id = p_patient_id and measured_at::date between p_from and p_to
       order by measured_at limit v_cap_series) s;
    v_result := v_result || jsonb_build_object('weight', v_data);
    v_count := v_count + least(v_total, v_cap_series);
    if v_total > v_cap_series then v_trunc := true; end if;
  end if;

  if 'anthropometry' = any(v_sections) then
    select count(*) into v_total from public.body_assessments b
      where b.patient_id = p_patient_id and b.assessed_at between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('assessed_at', assessed_at, 'method', method, 'weight', weight,
               'body_fat_pct', body_fat_pct, 'measurements', measurements) o,
             row_number() over (order by assessed_at) rn
        from public.body_assessments
       where patient_id = p_patient_id and assessed_at between p_from and p_to
       order by assessed_at limit v_cap_std) s;
    v_result := v_result || jsonb_build_object('anthropometry', v_data);
    v_count := v_count + least(v_total, v_cap_std);
    if v_total > v_cap_std then v_trunc := true; end if;
  end if;

  if 'workout_plan' = any(v_sections) then
    select jsonb_build_object('title', wp.title, 'goal', wp.goal, 'created_at', wp.created_at,
             'workouts', coalesce((select jsonb_agg(jsonb_build_object(
                 'letter', w.letter, 'name', w.name, 'primary_muscle_group', w.primary_muscle_group, 'day_index', w.day_index,
                 'exercises', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'sets', e.sets,
                     'reps', e.reps, 'load_kg', e.load_kg, 'muscle_groups', e.muscle_groups) order by e.order_index)
                   from public.workout_exercises e where e.workout_id = w.id), '[]'::jsonb)
               ) order by w.day_index) from public.workouts w where w.workout_plan_id = wp.id), '[]'::jsonb))
      into v_data from public.workout_plans wp
     where wp.patient_id = p_patient_id order by wp.created_at desc limit 1;
    if v_data is not null then v_result := v_result || jsonb_build_object('workout_plan', v_data); v_count := v_count + 1; end if;
  end if;

  if 'nutrition_plan' = any(v_sections) then
    select jsonb_build_object('title', np.title, 'created_at', np.created_at,
             'meals', coalesce((select jsonb_agg(jsonb_build_object('time', m.time, 'name', m.name,
                 'items', m.items, 'calories', m.calories) order by m.order_index)
               from public.meals m where m.nutrition_plan_id = np.id), '[]'::jsonb))
      into v_data from public.nutrition_plans np
     where np.patient_id = p_patient_id order by np.created_at desc limit 1;
    if v_data is not null then v_result := v_result || jsonb_build_object('nutrition_plan', v_data); v_count := v_count + 1; end if;
  end if;

  if 'supplements' = any(v_sections) then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'dose', dose, 'time_label', time_label) order by order_index), '[]'::jsonb)
      into v_data from public.supplements where patient_id = p_patient_id;
    v_result := v_result || jsonb_build_object('supplements', v_data);
    v_count := v_count + jsonb_array_length(v_data);
  end if;

  if 'adherence' = any(v_sections) then
    select jsonb_build_object('score', score, 'level', level, 'status', status, 'streak', streak,
             'weekly_completion_rate', weekly_completion_rate, 'risk_factors', risk_factors,
             'positive_factors', positive_factors, 'calculated_at', calculated_at)
      into v_data from public.adherence_snapshots
     where patient_id = p_patient_id order by calculated_at desc limit 1;
    if v_data is not null then v_result := v_result || jsonb_build_object('adherence', v_data); v_count := v_count + 1; end if;
  end if;

  if 'recovery' = any(v_sections) then
    select coalesce(jsonb_agg(jsonb_build_object('muscle_group', muscle_group, 'status', status,
             'last_trained_at', last_trained_at, 'last_intensity', last_intensity) order by muscle_group), '[]'::jsonb)
      into v_data from public.muscle_recovery_states where patient_id = p_patient_id;
    v_result := v_result || jsonb_build_object('recovery', v_data);
    v_count := v_count + jsonb_array_length(v_data);
  end if;

  if 'workout_execution' = any(v_sections) then
    select count(*) into v_total from public.workout_session_logs s
      where s.patient_id = p_patient_id and s.performed_on between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('performed_on', performed_on, 'workout_name', workout_name,
               'total_duration_min', total_duration_min, 'notes', notes) o,
             row_number() over (order by performed_on) rn
        from public.workout_session_logs
       where patient_id = p_patient_id and performed_on between p_from and p_to
       order by performed_on limit v_cap_std) s;
    v_result := v_result || jsonb_build_object('workout_execution', v_data);
    v_count := v_count + least(v_total, v_cap_std);
    if v_total > v_cap_std then v_trunc := true; end if;
  end if;

  if 'documents' = any(v_sections) then
    select count(*) into v_total from public.patient_documents d
      where d.patient_id = p_patient_id and d.uploaded_at::date between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('kind', kind, 'title', title, 'mime_type', mime_type,
               'file_size_bytes', file_size_bytes, 'file_path', file_path, 'uploaded_at', uploaded_at) o,
             row_number() over (order by uploaded_at desc) rn
        from public.patient_documents
       where patient_id = p_patient_id and uploaded_at::date between p_from and p_to
       order by uploaded_at desc limit v_cap_docs) s;
    v_result := v_result || jsonb_build_object('documents', v_data);
    v_count := v_count + least(v_total, v_cap_docs);
    if v_total > v_cap_docs then v_trunc := true; end if;
  end if;

  if 'appointments' = any(v_sections) then
    select count(*) into v_total from public.appointments a
      where a.patient_id = p_patient_id and a.starts_at::date between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('title', title, 'starts_at', starts_at, 'ends_at', ends_at,
               'type', type, 'status', status) o,
             row_number() over (order by starts_at) rn
        from public.appointments
       where patient_id = p_patient_id and starts_at::date between p_from and p_to
       order by starts_at limit v_cap_std) s;
    v_result := v_result || jsonb_build_object('appointments', v_data);
    v_count := v_count + least(v_total, v_cap_std);
    if v_total > v_cap_std then v_trunc := true; end if;
  end if;

  if 'photos' = any(v_sections) then
    select count(*) into v_total from public.progress_photos p
      where p.patient_id = p_patient_id and p.taken_at::date between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('taken_at', taken_at, 'storage_path', storage_path,
               'photo_url', photo_url, 'captured_in_app', captured_in_app, 'pose', pose) o,
             row_number() over (order by taken_at) rn
        from public.progress_photos
       where patient_id = p_patient_id and taken_at::date between p_from and p_to
       order by taken_at limit v_cap_photos) s;
    v_result := v_result || jsonb_build_object('photos', v_data);
    v_count := v_count + least(v_total, v_cap_photos);
    if v_total > v_cap_photos then v_trunc := true; end if;
  end if;

  if 'achievements' = any(v_sections) then
    select count(*) into v_total from public.patient_achievements pa
      where pa.patient_id = p_patient_id and pa.unlocked_at::date between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('code', pa.achievement_code, 'title', ac.title, 'unlocked_at', pa.unlocked_at) o,
             row_number() over (order by pa.unlocked_at) rn
        from public.patient_achievements pa
        left join public.achievements ac on ac.code = pa.achievement_code
       where pa.patient_id = p_patient_id and pa.unlocked_at::date between p_from and p_to
       order by pa.unlocked_at limit v_cap_std) s;
    v_result := v_result || jsonb_build_object('achievements', v_data);
    v_count := v_count + least(v_total, v_cap_std);
    if v_total > v_cap_std then v_trunc := true; end if;
  end if;

  if 'timeline' = any(v_sections) then
    select count(*) into v_total from public.activity_events e
      where e.patient_id = p_patient_id and e.created_at::date between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('type', type, 'payload', payload, 'created_at', created_at) o,
             row_number() over (order by created_at desc) rn
        from public.activity_events
       where patient_id = p_patient_id and created_at::date between p_from and p_to
       order by created_at desc limit v_cap_std) s;
    v_result := v_result || jsonb_build_object('timeline', v_data);
    v_count := v_count + least(v_total, v_cap_std);
    if v_total > v_cap_std then v_trunc := true; end if;
  end if;

  if 'hydration' = any(v_sections) then
    -- Água por dia (America/Sao_Paulo): soma dos registros hydration_logged do app (payload.liters;
    -- alias legado payload.amount). Valores não numéricos são ignorados, nunca quebram o relatório.
    select count(*) into v_total from (
      select 1 from public.activity_events e
       where e.patient_id = p_patient_id and e.type = 'hydration_logged'
         and (e.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       group by (e.created_at at time zone 'America/Sao_Paulo')::date) d;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('day', day, 'liters', liters, 'entries', entries) o,
             row_number() over (order by day) rn
        from (
          select (e.created_at at time zone 'America/Sao_Paulo')::date as day,
                 round(sum(case
                   when coalesce(e.payload->>'liters', e.payload->>'amount') ~ '^[0-9]+([.][0-9]+)?$'
                   then coalesce(e.payload->>'liters', e.payload->>'amount')::numeric else 0 end), 2) as liters,
                 count(*) as entries
            from public.activity_events e
           where e.patient_id = p_patient_id and e.type = 'hydration_logged'
             and (e.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
           group by 1 order by 1 limit v_cap_series) g
       order by day) s;
    v_result := v_result || jsonb_build_object('hydration', v_data);
    v_count := v_count + least(v_total, v_cap_series);
    if v_total > v_cap_series then v_trunc := true; end if;
  end if;

  if 'supplement_intakes' = any(v_sections) then
    -- Suplementação marcada por dia: quantos suplementos distintos foram marcados como tomados,
    -- contra o total de suplementos hoje cadastrados (o histórico de cadastro não é versionado).
    select count(*) into v_total from (
      select 1 from public.supplement_intakes i
       where i.patient_id = p_patient_id and i.taken_on between p_from and p_to
       group by i.taken_on) d;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('day', day, 'taken', taken,
               'total', (select count(*) from public.supplements sp where sp.patient_id = p_patient_id)) o,
             row_number() over (order by day) rn
        from (
          select i.taken_on as day, count(distinct i.supplement_id) as taken
            from public.supplement_intakes i
           where i.patient_id = p_patient_id and i.taken_on between p_from and p_to
           group by i.taken_on order by i.taken_on limit v_cap_series) g
       order by day) s;
    v_result := v_result || jsonb_build_object('supplement_intakes', v_data);
    v_count := v_count + least(v_total, v_cap_series);
    if v_total > v_cap_series then v_trunc := true; end if;
  end if;

  if 'sleep' = any(v_sections) then
    -- Sono por noite: registros do paciente no app (sleep_logs). slept_on = dia em que acordou.
    select count(*) into v_total from public.sleep_logs s
     where s.patient_id = p_patient_id and s.slept_on between p_from and p_to;
    select coalesce(jsonb_agg(o order by rn), '[]'::jsonb) into v_data from (
      select jsonb_build_object('day', slept_on, 'hours', hours, 'quality', quality) o,
             row_number() over (order by slept_on) rn
        from (
          select s.slept_on, s.hours, s.quality from public.sleep_logs s
           where s.patient_id = p_patient_id and s.slept_on between p_from and p_to
           order by s.slept_on limit v_cap_series) g
       order by slept_on) s;
    v_result := v_result || jsonb_build_object('sleep', v_data);
    v_count := v_count + least(v_total, v_cap_series);
    if v_total > v_cap_series then v_trunc := true; end if;
  end if;

  insert into public.report_exports
    (exported_by_profile_id, patient_id, clinic_id, period_from, period_to, sections, record_count, surface, batch_id)
  values
    (private.current_profile_id(), p_patient_id, v_clinic, p_from, p_to, v_sections, v_count,
     coalesce(nullif(btrim(p_surface),''),'web'), p_batch_id);

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'patient_id', p_patient_id, 'from', p_from, 'to', p_to,
      'sections', to_jsonb(v_sections), 'record_count', v_count, 'truncated', v_trunc,
      'batch_id', p_batch_id, 'generated_at', now(),
      'exported_by', jsonb_build_object('profile_id', private.current_profile_id(),
        'name', (select full_name from public.profiles where id = private.current_profile_id()))
    ),
    'patient', v_patient,
    'sections', v_result
  );
end $function$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261021090000','20261021090000_wp_sleep_a.sql',
  'SLEEP-A: tabela sleep_logs (RLS self-log) + seção sleep em export_patient_report.','SLEEP-A');
