-- =====================================================================================
-- WP-REPORT · B — Exportação multi-paciente (lote) + coluna batch_id na trilha.
--
-- DECISÃO DO DONO (lei): o LOTE NÃO cria função nova de agregação. O cliente chama a MESMA RPC já
-- auditada (export_patient_report) UMA VEZ POR PACIENTE — cada paciente gera sua própria linha na
-- trilha, a autorização é reavaliada individualmente, e não há superfície nova no banco. O batch_id
-- (gerado no cliente) apenas AGRUPA as linhas da mesma operação.
--
-- ESTA MIGRATION (mínima):
--  · public.report_exports ganha coluna ANULÁVEL batch_id uuid + índice.
--  · export_patient_report ganha parâmetro OPCIONAL p_batch_id (default null) — a versão de 5 args é
--    DROPADA (para não ficar órfã/ambígua). A LÓGICA DE AUTORIZAÇÃO NÃO MUDA (can_prescribe_for_patient).
--    Chamadas de UM paciente só (sem p_batch_id) continuam funcionando (default null).
--  · EXECUTE só authenticated (revoke public/anon). Nenhuma policy existente alterada.
--
-- ROLLBACK (kill switch — fail-closed):
--   -- restaura a RPC à versão de 5 args (Parte A) e remove o lote:
--   drop function if exists public.export_patient_report(uuid, date, date, text[], text, uuid);
--   -- (recriar a versão de 5 args da migration 20260728090000; revoke public/anon; grant authenticated)
--   drop index if exists public.idx_report_exports_batch;
--   alter table public.report_exports drop column if exists batch_id;
--   -- revoke execute ... from authenticated  => desativa a exportação inteira (lote e individual).
-- =====================================================================================

alter table public.report_exports add column if not exists batch_id uuid;
-- índice para agrupar/filtrar as linhas de um mesmo lote (auditoria e verificação).
create index if not exists idx_report_exports_batch on public.report_exports (batch_id) where batch_id is not null;

-- Recria a RPC com p_batch_id OPCIONAL. A versão de 5 args sai (senão uma chamada de 5 args ficaria
-- ambígua entre as duas). O corpo é IDÊNTICO ao da Parte A + grava/retorna batch_id.
drop function if exists public.export_patient_report(uuid, date, date, text[], text);

create or replace function public.export_patient_report(
  p_patient_id uuid,
  p_from       date,
  p_to         date,
  p_sections   text[],
  p_surface    text default 'web',
  p_batch_id   uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_known    constant text[] := array['identity','weight','anthropometry','workout_plan','nutrition_plan',
                                       'supplements','adherence','recovery','workout_execution','documents',
                                       'appointments','photos','achievements','timeline'];
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
  -- (1) AUTORIZAÇÃO — INALTERADA (externo/paciente/não-vinculado/outra-clínica/anon NEGADOS).
  if not private.can_prescribe_for_patient(p_patient_id) then
    raise exception 'export_patient_report: not authorized for this patient' using errcode = '42501';
  end if;

  -- (2) VALIDAÇÃO — período + seções (A2).
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
               'photo_url', photo_url, 'captured_in_app', captured_in_app) o,
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

  -- (4) TRILHA — 1 linha por exportação; batch_id AGRUPA as do mesmo lote (null = exportação individual).
  insert into public.report_exports
    (exported_by_profile_id, patient_id, clinic_id, period_from, period_to, sections, record_count, surface, batch_id)
  values
    (private.current_profile_id(), p_patient_id, v_clinic, p_from, p_to, v_sections, v_count,
     coalesce(nullif(btrim(p_surface),''),'web'), p_batch_id);

  -- (5) RETORNO
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
end $$;

revoke all     on function public.export_patient_report(uuid, date, date, text[], text, uuid) from public, anon;
grant  execute on function public.export_patient_report(uuid, date, date, text[], text, uuid) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260729090000','20260729090000_wp_report_b_batch.sql',
  'WP-REPORT B: exportacao multi-paciente. report_exports ganha batch_id (uuid, anulavel) + indice parcial. '
  'export_patient_report ganha p_batch_id OPCIONAL (default null); a versao de 5 args e dropada (sem orfa/ambiguidade). '
  'Autorizacao INALTERADA (can_prescribe_for_patient). O lote e N chamadas da MESMA RPC (1 linha/paciente, mesmo '
  'batch_id) — nenhuma funcao de agregacao nova. EXECUTE so authenticated. Nenhuma policy existente alterada.',
  'WP-REPORT')
on conflict (version) do nothing;
