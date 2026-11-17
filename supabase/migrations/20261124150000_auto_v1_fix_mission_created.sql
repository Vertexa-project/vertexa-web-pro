-- Correção D83: patients não tem created_at; a data de entrada vem de profiles.created_at.
create or replace function public.get_patient_mission(p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.clinic_routine_settings%rowtype; m public.patient_missions%rowtype; v_today date := private.brt_date(now());
  v_self boolean := private.is_self_patient(p_patient_id); st jsonb; v_steps jsonb := '[]'::jsonb; v_done date; v_n int := 0; v_ok int := 0;
  v_last date; v_completed boolean; v_completed_on date; v_created timestamptz; v_ends date;
begin
  if not private.can_access_patient_internal(p_patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.clinic_routine_settings where clinic_id = private.patient_clinic(p_patient_id);
  if s.clinic_id is null or not s.mission_enabled then return jsonb_build_object('enabled', false, 'started', false); end if;
  select * into m from public.patient_missions where patient_id = p_patient_id;
  if m.patient_id is null then
    select pr.created_at into v_created from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = p_patient_id;
    -- começa sozinha para quem entrou DEPOIS de a clínica ligar a missão; os demais, só se o profissional iniciar
    if v_self and v_created >= coalesce(s.mission_enabled_at, 'infinity'::timestamptz) then
      insert into public.patient_missions (patient_id, clinic_id, started_on) values (p_patient_id, private.patient_clinic(p_patient_id), v_today)
      on conflict (patient_id) do nothing;
      select * into m from public.patient_missions where patient_id = p_patient_id;
    else
      return jsonb_build_object('enabled', true, 'started', false, 'days', s.mission_days);
    end if;
  end if;
  for st in select value from jsonb_array_elements(s.mission_steps) where coalesce((value->>'enabled')::boolean, true) loop
    v_done := private.a45_step_done_on(st->>'key', p_patient_id, m.started_on);
    v_n := v_n + 1;
    if v_done is not null then v_ok := v_ok + 1; v_last := greatest(coalesce(v_last, v_done), v_done); end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('key', st->>'key', 'label', st->>'label',
      'allow_skip', coalesce((st->>'allow_skip')::boolean, false), 'done', v_done is not null, 'done_on', v_done));
  end loop;
  v_completed := (v_n > 0 and v_ok = v_n) or m.completed_at is not null;
  if v_completed and m.completed_at is null and v_self then
    update public.patient_missions set completed_at = now() where patient_id = p_patient_id returning * into m;
  end if;
  v_completed_on := case when m.completed_at is not null then private.brt_date(m.completed_at) when v_completed then v_last end;
  v_ends := m.started_on + s.mission_days - 1;
  return jsonb_build_object('enabled', true, 'started', true, 'started_on', m.started_on, 'days', s.mission_days, 'ends_on', v_ends,
    'overdue', (not v_completed and v_today > v_ends), 'steps', v_steps, 'done_count', v_ok, 'total', v_n,
    'completed', v_completed, 'completed_on', v_completed_on, 'celebrated', m.celebrated_at is not null);
end $$;
