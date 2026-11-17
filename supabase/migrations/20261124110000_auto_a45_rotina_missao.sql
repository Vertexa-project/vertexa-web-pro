-- =====================================================================================
-- AUTOMAÇÕES A4 + A5 (Vertexa V1) — Rotina por paciente + Missão da 1ª semana
--
-- SÓ OBJETOS NOVOS. Nada existente é alterado. Tudo NASCE DESLIGADO (clínica sem linha = desligado).
--   A4  clinic_routine_settings        padrão da clínica: foto / peso / feedback (desligado | semanal | mensal) + dia da semana
--       patient_routine_overrides      exceção por paciente (personalizada ou desligada)
--       patient_routine_entries        o que o paciente envia e que ainda não existe em outro lugar:
--                                      feedback da semana (texto), foto dos suplementos, foto da bioimpedância, "não tenho bio"
--       get_patient_routine()          rotina EFETIVA + o que foi feito / está pendente (derivado dos registros reais, em Brasília)
--   A5  patient_missions               começo / conclusão / "parabéns já mostrado" da missão do paciente
--       get_patient_mission()          checklist com progresso x de y, medido por fotos (frente/lado/costas) e peso REAIS
--       (passos editáveis por clínica em clinic_routine_settings.mission_steps)
--
-- Medição sem duplo registro: foto de frente/lado/costas = progress_photos.pose; peso = weight_logs (não recusado);
-- só suplementos / bioimpedância / feedback usam patient_routine_entries (não existiam no app).
--
-- Permissão: configurar a clínica = admin da clínica; exceção por paciente e (re)iniciar missão = acesso clínico
-- (can_prescribe_for_patient); ler = can_access_patient_internal (paciente lê o dele; Recepção e Financeiro NÃO
-- abrem dado clínico — regra E9). O paciente só escreve por RPC dele (log_my_routine_entry / mark_my_mission_celebrated).
-- Nada dispara mensagem externa: o aviso ao paciente é o cartão no Início do app (sem cron).
--
-- Reversão: drop das funções public.* e private.a45_* abaixo e das 4 tabelas (todas novas).
-- NÃO APLICAR sem ordem do pai.
-- =====================================================================================

-- ───────────────────────── Configuração por clínica
create table if not exists public.clinic_routine_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  routine_enabled boolean not null default false,
  routine_enabled_on date,
  photo_period text not null default 'monthly' check (photo_period in ('off','weekly','monthly')),
  photo_weekday smallint not null default 5 check (photo_weekday between 0 and 6),
  weight_period text not null default 'monthly' check (weight_period in ('off','weekly','monthly')),
  weight_weekday smallint not null default 5 check (weight_weekday between 0 and 6),
  feedback_period text not null default 'weekly' check (feedback_period in ('off','weekly','monthly')),
  feedback_weekday smallint not null default 5 check (feedback_weekday between 0 and 6),
  mission_enabled boolean not null default false,
  mission_enabled_at timestamptz,
  mission_days smallint not null default 7 check (mission_days between 1 and 30),
  mission_steps jsonb not null default '[
    {"key":"photo_front","label":"Foto de frente","enabled":true,"allow_skip":false},
    {"key":"photo_side","label":"Foto de lado","enabled":true,"allow_skip":false},
    {"key":"photo_back","label":"Foto de costas","enabled":true,"allow_skip":false},
    {"key":"weight","label":"Peso na balança, em jejum","enabled":true,"allow_skip":false},
    {"key":"supplements_photo","label":"Foto dos suplementos que você usa","enabled":true,"allow_skip":true},
    {"key":"bio","label":"Bioimpedância (se você tiver)","enabled":true,"allow_skip":true}
  ]'::jsonb,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.clinic_routine_settings enable row level security;
revoke all on public.clinic_routine_settings from anon, authenticated;
grant select on public.clinic_routine_settings to authenticated;
drop policy if exists clinic_routine_settings_select on public.clinic_routine_settings;
create policy clinic_routine_settings_select on public.clinic_routine_settings for select to authenticated
  using ( private.is_clinic_member(clinic_id) );

-- ───────────────────────── Exceção por paciente
create table if not exists public.patient_routine_overrides (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  mode text not null check (mode in ('custom','off')),
  photo_period text not null default 'monthly' check (photo_period in ('off','weekly','monthly')),
  photo_weekday smallint not null default 5 check (photo_weekday between 0 and 6),
  weight_period text not null default 'monthly' check (weight_period in ('off','weekly','monthly')),
  weight_weekday smallint not null default 5 check (weight_weekday between 0 and 6),
  feedback_period text not null default 'weekly' check (feedback_period in ('off','weekly','monthly')),
  feedback_weekday smallint not null default 5 check (feedback_weekday between 0 and 6),
  start_on date not null default current_date,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.patient_routine_overrides enable row level security;
revoke all on public.patient_routine_overrides from anon, authenticated;
grant select on public.patient_routine_overrides to authenticated;
drop policy if exists patient_routine_overrides_select on public.patient_routine_overrides;
create policy patient_routine_overrides_select on public.patient_routine_overrides for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );

-- ───────────────────────── O que o paciente envia (só o que não existe em outra tabela)
create table if not exists public.patient_routine_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  kind text not null check (kind in ('feedback','supplements_photo','bio_photo','bio_na')),
  note text check (note is null or char_length(note) <= 1000),
  storage_path text,
  created_at timestamptz not null default now(),
  constraint patient_routine_entries_feedback_text check (kind <> 'feedback' or char_length(btrim(coalesce(note,''))) >= 1),
  constraint patient_routine_entries_photo_path check (kind not in ('supplements_photo','bio_photo') or storage_path is not null)
);
create index if not exists patient_routine_entries_patient_idx on public.patient_routine_entries (patient_id, kind, created_at desc);
alter table public.patient_routine_entries enable row level security;
revoke all on public.patient_routine_entries from anon, authenticated;
grant select on public.patient_routine_entries to authenticated;
drop policy if exists patient_routine_entries_select on public.patient_routine_entries;
create policy patient_routine_entries_select on public.patient_routine_entries for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );

-- ───────────────────────── Missão da 1ª semana (uma por paciente)
create table if not exists public.patient_missions (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  started_on date not null,
  completed_at timestamptz,
  celebrated_at timestamptz,
  started_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.patient_missions enable row level security;
revoke all on public.patient_missions from anon, authenticated;
grant select on public.patient_missions to authenticated;
drop policy if exists patient_missions_select on public.patient_missions;
create policy patient_missions_select on public.patient_missions for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );

-- ───────────────────────── Helpers (private)
-- Início do dia de Brasília como timestamptz.
create or replace function private.a45_day_start(p_day date)
returns timestamptz language sql immutable set search_path = '' as $$
  select (p_day::timestamp) at time zone 'America/Sao_Paulo'
$$;

-- 1ª data (Brasília) com registro do tipo no intervalo [p_from, p_to). null = nada feito.
create or replace function private.a45_first_done(p_kind text, p_patient uuid, p_from date, p_to date)
returns date language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := private.a45_day_start(p_from); v_to timestamptz := private.a45_day_start(p_to); v timestamptz;
begin
  if p_kind = 'photo' then
    select min(taken_at) into v from public.progress_photos where patient_id = p_patient and taken_at >= v_from and taken_at < v_to;
  elsif p_kind = 'weight' then
    select min(measured_at) into v from public.weight_logs
     where patient_id = p_patient and measured_at >= v_from and measured_at < v_to and review_status is distinct from 'rejected';
  elsif p_kind = 'feedback' then
    select min(created_at) into v from public.patient_routine_entries where patient_id = p_patient and kind = 'feedback' and created_at >= v_from and created_at < v_to;
  end if;
  return private.brt_date(v);
end $$;

-- Data em que o passo da missão foi cumprido a partir de p_from (null = pendente).
create or replace function private.a45_step_done_on(p_step text, p_patient uuid, p_from date)
returns date language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := private.a45_day_start(p_from); v timestamptz;
begin
  if p_step in ('photo_front','photo_side','photo_back') then
    select min(taken_at) into v from public.progress_photos
     where patient_id = p_patient and taken_at >= v_from and pose = case p_step when 'photo_front' then 'front' when 'photo_side' then 'side' else 'back' end;
  elsif p_step = 'weight' then
    select min(measured_at) into v from public.weight_logs
     where patient_id = p_patient and measured_at >= v_from and review_status is distinct from 'rejected';
  elsif p_step = 'supplements_photo' then
    select min(created_at) into v from public.patient_routine_entries where patient_id = p_patient and kind = 'supplements_photo' and created_at >= v_from;
  elsif p_step = 'bio' then
    select min(created_at) into v from public.patient_routine_entries where patient_id = p_patient and kind in ('bio_photo','bio_na') and created_at >= v_from;
  end if;
  return private.brt_date(v);
end $$;

revoke all on function private.a45_day_start(date), private.a45_first_done(text, uuid, date, date), private.a45_step_done_on(text, uuid, date) from public, anon;
grant execute on function private.a45_day_start(date), private.a45_first_done(text, uuid, date, date), private.a45_step_done_on(text, uuid, date) to authenticated;

-- ───────────────────────── A4 · salvar o padrão da clínica (admin)
create or replace function public.save_clinic_routine_settings(p_clinic_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.clinic_routine_settings%rowtype; v_old public.clinic_routine_settings%rowtype; v_today date := private.brt_date(now());
  k text; v_steps jsonb; st jsonb; seen text[] := '{}'; v_label text; v_n int := 0;
begin
  if private.current_profile_id() is null then raise exception 'save_clinic_routine_settings: not authenticated' using errcode = '42501'; end if;
  if not private.is_clinic_admin(p_clinic_id) then raise exception 'forbidden: only the clinic admin configures the routine' using errcode = '42501'; end if;
  p_settings := coalesce(p_settings, '{}'::jsonb);
  select * into v_old from public.clinic_routine_settings where clinic_id = p_clinic_id;
  s := v_old;
  if s.clinic_id is null then s.clinic_id := p_clinic_id; s.routine_enabled := false; s.mission_enabled := false;
    s.photo_period := 'monthly'; s.photo_weekday := 5; s.weight_period := 'monthly'; s.weight_weekday := 5;
    s.feedback_period := 'weekly'; s.feedback_weekday := 5; s.mission_days := 7;
    s.mission_steps := null; end if;
  if s.mission_steps is null then
    s.mission_steps := '[{"key":"photo_front","label":"Foto de frente","enabled":true,"allow_skip":false},{"key":"photo_side","label":"Foto de lado","enabled":true,"allow_skip":false},{"key":"photo_back","label":"Foto de costas","enabled":true,"allow_skip":false},{"key":"weight","label":"Peso na balança, em jejum","enabled":true,"allow_skip":false},{"key":"supplements_photo","label":"Foto dos suplementos que você usa","enabled":true,"allow_skip":true},{"key":"bio","label":"Bioimpedância (se você tiver)","enabled":true,"allow_skip":true}]'::jsonb;
  end if;
  if p_settings ? 'routine_enabled' then s.routine_enabled := (p_settings->>'routine_enabled')::boolean; end if;
  if p_settings ? 'mission_enabled' then s.mission_enabled := (p_settings->>'mission_enabled')::boolean; end if;
  foreach k in array array['photo','weight','feedback'] loop
    if p_settings ? (k || '_period') then
      if p_settings->>(k || '_period') not in ('off','weekly','monthly') then raise exception 'invalid period' using errcode = '22023'; end if;
    end if;
    if p_settings ? (k || '_weekday') then
      if (p_settings->>(k || '_weekday'))::int not between 0 and 6 then raise exception 'invalid weekday' using errcode = '22023'; end if;
    end if;
  end loop;
  s.photo_period := coalesce(p_settings->>'photo_period', s.photo_period);
  s.weight_period := coalesce(p_settings->>'weight_period', s.weight_period);
  s.feedback_period := coalesce(p_settings->>'feedback_period', s.feedback_period);
  s.photo_weekday := coalesce((p_settings->>'photo_weekday')::int, s.photo_weekday);
  s.weight_weekday := coalesce((p_settings->>'weight_weekday')::int, s.weight_weekday);
  s.feedback_weekday := coalesce((p_settings->>'feedback_weekday')::int, s.feedback_weekday);
  if p_settings ? 'mission_days' then
    if (p_settings->>'mission_days')::int not between 1 and 30 then raise exception 'invalid mission days' using errcode = '22023'; end if;
    s.mission_days := (p_settings->>'mission_days')::int;
  end if;
  if p_settings ? 'mission_steps' then
    v_steps := p_settings->'mission_steps';
    if jsonb_typeof(v_steps) <> 'array' or jsonb_array_length(v_steps) = 0 or jsonb_array_length(v_steps) > 6 then
      raise exception 'invalid mission steps' using errcode = '22023'; end if;
    for st in select value from jsonb_array_elements(v_steps) loop
      if (st->>'key') is null or (st->>'key') not in ('photo_front','photo_side','photo_back','weight','supplements_photo','bio') or (st->>'key') = any(seen) then
        raise exception 'invalid mission step key' using errcode = '22023'; end if;
      seen := seen || (st->>'key');
      v_label := btrim(coalesce(st->>'label',''));
      if char_length(v_label) not between 1 and 80 then raise exception 'invalid mission step label' using errcode = '22023'; end if;
      if coalesce((st->>'enabled')::boolean, true) then v_n := v_n + 1; end if;
    end loop;
    s.mission_steps := (select jsonb_agg(jsonb_build_object('key', x->>'key', 'label', btrim(x->>'label'),
        'enabled', coalesce((x->>'enabled')::boolean, true), 'allow_skip', coalesce((x->>'allow_skip')::boolean, false)))
      from jsonb_array_elements(v_steps) x);
  else
    select count(*) into v_n from jsonb_array_elements(s.mission_steps) x where coalesce((x->>'enabled')::boolean, true);
  end if;
  if s.mission_enabled and v_n = 0 then raise exception 'mission needs at least one step' using errcode = '22023'; end if;
  -- "desde quando": ligar guarda o dia (rotina) e o instante (missão: só vale para quem entrou depois)
  if s.routine_enabled and (v_old.clinic_id is null or not v_old.routine_enabled or v_old.routine_enabled_on is null) then s.routine_enabled_on := v_today;
  else s.routine_enabled_on := coalesce(v_old.routine_enabled_on, case when s.routine_enabled then v_today end); end if;
  if s.mission_enabled and (v_old.clinic_id is null or not v_old.mission_enabled or v_old.mission_enabled_at is null) then s.mission_enabled_at := now();
  else s.mission_enabled_at := v_old.mission_enabled_at; end if;
  insert into public.clinic_routine_settings (clinic_id, routine_enabled, routine_enabled_on, photo_period, photo_weekday, weight_period, weight_weekday,
      feedback_period, feedback_weekday, mission_enabled, mission_enabled_at, mission_days, mission_steps, updated_by_profile_id, updated_at)
  values (p_clinic_id, s.routine_enabled, s.routine_enabled_on, s.photo_period, s.photo_weekday, s.weight_period, s.weight_weekday,
      s.feedback_period, s.feedback_weekday, s.mission_enabled, s.mission_enabled_at, s.mission_days, s.mission_steps, private.current_profile_id(), now())
  on conflict (clinic_id) do update set routine_enabled = excluded.routine_enabled, routine_enabled_on = excluded.routine_enabled_on,
      photo_period = excluded.photo_period, photo_weekday = excluded.photo_weekday, weight_period = excluded.weight_period, weight_weekday = excluded.weight_weekday,
      feedback_period = excluded.feedback_period, feedback_weekday = excluded.feedback_weekday, mission_enabled = excluded.mission_enabled,
      mission_enabled_at = excluded.mission_enabled_at, mission_days = excluded.mission_days, mission_steps = excluded.mission_steps,
      updated_by_profile_id = excluded.updated_by_profile_id, updated_at = now();
  return (select to_jsonb(c) from public.clinic_routine_settings c where c.clinic_id = p_clinic_id);
end $$;

-- ───────────────────────── A4 · exceção por paciente
create or replace function public.save_patient_routine_override(p_patient_id uuid, p_mode text, p_settings jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; v_today date := private.brt_date(now()); s public.clinic_routine_settings%rowtype; o public.patient_routine_overrides%rowtype;
begin
  if private.current_profile_id() is null then raise exception 'save_patient_routine_override: not authenticated' using errcode = '42501'; end if;
  if not private.can_prescribe_for_patient(p_patient_id) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  if p_mode not in ('custom','off') then raise exception 'invalid mode' using errcode = '22023'; end if;
  p_settings := coalesce(p_settings, '{}'::jsonb);
  foreach k in array array['photo','weight','feedback'] loop
    if p_settings ? (k || '_period') and p_settings->>(k || '_period') not in ('off','weekly','monthly') then raise exception 'invalid period' using errcode = '22023'; end if;
    if p_settings ? (k || '_weekday') and (p_settings->>(k || '_weekday'))::int not between 0 and 6 then raise exception 'invalid weekday' using errcode = '22023'; end if;
  end loop;
  select * into s from public.clinic_routine_settings where clinic_id = private.patient_clinic(p_patient_id);
  select * into o from public.patient_routine_overrides where patient_id = p_patient_id;
  insert into public.patient_routine_overrides (patient_id, clinic_id, mode, photo_period, photo_weekday, weight_period, weight_weekday,
      feedback_period, feedback_weekday, start_on, updated_by_profile_id, updated_at)
  values (p_patient_id, private.patient_clinic(p_patient_id), p_mode,
      coalesce(p_settings->>'photo_period', o.photo_period, s.photo_period, 'monthly'),
      coalesce((p_settings->>'photo_weekday')::int, o.photo_weekday, s.photo_weekday, 5),
      coalesce(p_settings->>'weight_period', o.weight_period, s.weight_period, 'monthly'),
      coalesce((p_settings->>'weight_weekday')::int, o.weight_weekday, s.weight_weekday, 5),
      coalesce(p_settings->>'feedback_period', o.feedback_period, s.feedback_period, 'weekly'),
      coalesce((p_settings->>'feedback_weekday')::int, o.feedback_weekday, s.feedback_weekday, 5),
      v_today, private.current_profile_id(), now())
  on conflict (patient_id) do update set mode = excluded.mode, photo_period = excluded.photo_period, photo_weekday = excluded.photo_weekday,
      weight_period = excluded.weight_period, weight_weekday = excluded.weight_weekday, feedback_period = excluded.feedback_period,
      feedback_weekday = excluded.feedback_weekday, updated_by_profile_id = excluded.updated_by_profile_id, updated_at = now(),
      start_on = case when public.patient_routine_overrides.mode = 'custom' then public.patient_routine_overrides.start_on else excluded.start_on end;
end $$;

create or replace function public.clear_patient_routine_override(p_patient_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.current_profile_id() is null then raise exception 'clear_patient_routine_override: not authenticated' using errcode = '42501'; end if;
  if not private.can_prescribe_for_patient(p_patient_id) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  delete from public.patient_routine_overrides where patient_id = p_patient_id;
end $$;

-- ───────────────────────── A4 · rotina efetiva e o que foi cumprido
-- source: clinic_off | patient_off | clinic (padrão da clínica) | custom (exceção do paciente).
-- Cada item (photo|weight|feedback) traz as ocorrências (dia da rotina) dos últimos p_weeks, cada uma com state:
--   done | due_today (hoje e falta) | overdue (passou e falta, é a ocorrência atual) | missed (passou e já veio outra depois).
-- "Cumprida" = existe registro real de Brasília entre a ocorrência e a próxima (ou hoje). O paciente pode fazer depois do dia.
-- current = ocorrências atuais ainda abertas (o cartão do app e o "pendente" do profissional).
create or replace function public.get_patient_routine(p_patient_id uuid, p_weeks int default 4)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.clinic_routine_settings%rowtype; o public.patient_routine_overrides%rowtype; v_cfg jsonb;
  v_today date := private.brt_date(now()); v_source text; v_since date; v_back int := greatest(least(coalesce(p_weeks, 4), 12), 1) * 7;
  k text; v_period text; v_wd int; dates date[]; i int; d date; nxt date; v_done date; v_state text;
  v_items jsonb := '[]'::jsonb; v_occ jsonb; v_current jsonb := '[]'::jsonb; v_clinic uuid;
  v_label jsonb := '{"photo":"Foto","weight":"Peso (balança em jejum)","feedback":"Feedback da semana"}'::jsonb;
begin
  if not private.can_access_patient_internal(p_patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_clinic := private.patient_clinic(p_patient_id);
  select * into s from public.clinic_routine_settings where clinic_id = v_clinic;
  select * into o from public.patient_routine_overrides where patient_id = p_patient_id;
  if s.clinic_id is null or not s.routine_enabled then
    return jsonb_build_object('enabled', false, 'source', 'clinic_off', 'items', '[]'::jsonb, 'current', '[]'::jsonb, 'today', v_today);
  end if;
  if o.patient_id is not null and o.mode = 'off' then
    return jsonb_build_object('enabled', false, 'source', 'patient_off', 'items', '[]'::jsonb, 'current', '[]'::jsonb, 'today', v_today);
  end if;
  if o.patient_id is not null then v_source := 'custom'; v_cfg := to_jsonb(o); v_since := greatest(coalesce(s.routine_enabled_on, o.start_on), o.start_on);
  else v_source := 'clinic'; v_cfg := to_jsonb(s); v_since := coalesce(s.routine_enabled_on, v_today); end if;

  foreach k in array array['photo','weight','feedback'] loop
    v_period := v_cfg->>(k || '_period'); v_wd := (v_cfg->>(k || '_weekday'))::int;
    if v_period = 'off' then continue; end if;
    select coalesce(array_agg(g::date order by g), '{}') into dates
      from generate_series(greatest(v_since, v_today - 45)::timestamp, v_today::timestamp, interval '1 day') g
     where extract(dow from g)::int = v_wd and (v_period = 'weekly' or extract(day from g)::int <= 7);
    v_occ := '[]'::jsonb;
    for i in 1 .. coalesce(array_length(dates, 1), 0) loop
      d := dates[i]; nxt := case when i < array_length(dates, 1) then dates[i + 1] else v_today + 1 end;
      v_done := private.a45_first_done(k, p_patient_id, d, nxt);
      v_state := case when v_done is not null then 'done' when d = v_today then 'due_today' when i = array_length(dates, 1) then 'overdue' else 'missed' end;
      if d >= v_today - v_back or i = array_length(dates, 1) then
        v_occ := v_occ || jsonb_build_array(jsonb_build_object('date', d, 'state', v_state, 'done_on', v_done));
      end if;
      if i = array_length(dates, 1) and v_state in ('due_today','overdue') then
        v_current := v_current || jsonb_build_array(jsonb_build_object('key', k, 'label', v_label->>k, 'due_on', d, 'state', v_state));
      end if;
    end loop;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', k, 'label', v_label->>k, 'period', v_period, 'weekday', v_wd, 'occurrences', v_occ));
  end loop;
  return jsonb_build_object('enabled', true, 'source', v_source, 'since', v_since, 'today', v_today, 'items', v_items, 'current', v_current,
    'last_feedback', (select jsonb_build_object('note', e.note, 'at', e.created_at) from public.patient_routine_entries e
                       where e.patient_id = p_patient_id and e.kind = 'feedback' order by e.created_at desc limit 1));
end $$;

-- ───────────────────────── Registro do paciente (feedback, foto dos suplementos, bioimpedância)
create or replace function public.log_my_routine_entry(p_kind text, p_note text default null, p_storage_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if private.current_profile_id() is null then raise exception 'log_my_routine_entry: not authenticated' using errcode = '42501'; end if;
  select id into v_patient from public.patients where profile_id = private.current_profile_id() limit 1;
  if v_patient is null then raise exception 'forbidden: only the patient registers this' using errcode = '42501'; end if;
  if p_kind not in ('feedback','supplements_photo','bio_photo','bio_na') then raise exception 'invalid kind' using errcode = '22023'; end if;
  if p_kind = 'feedback' and v_note is null then raise exception 'feedback text required' using errcode = '22023'; end if;
  if p_kind in ('supplements_photo','bio_photo') and (p_storage_path is null or p_storage_path not like v_patient::text || '/%' or p_storage_path like '%..%') then
    raise exception 'invalid file path' using errcode = '22023'; end if;
  if p_kind = 'bio_na' then
    select id into v_id from public.patient_routine_entries where patient_id = v_patient and kind = 'bio_na' limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.patient_routine_entries (patient_id, clinic_id, kind, note, storage_path)
  values (v_patient, private.patient_clinic(v_patient), p_kind, left(v_note, 1000), case when p_kind in ('supplements_photo','bio_photo') then p_storage_path end)
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── A5 · missão
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
    select created_at into v_created from public.patients where id = p_patient_id;
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

create or replace function public.mark_my_mission_celebrated()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.current_profile_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.patient_missions m set celebrated_at = now()
   where m.completed_at is not null and m.celebrated_at is null and private.is_self_patient(m.patient_id);
end $$;

-- Profissional inicia (ou reinicia, p_restart) a missão de um paciente — vale para quem já era paciente antes de a clínica ligar a missão.
create or replace function public.start_patient_mission(p_patient_id uuid, p_restart boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_today date := private.brt_date(now()); v_on boolean;
begin
  if private.current_profile_id() is null then raise exception 'start_patient_mission: not authenticated' using errcode = '42501'; end if;
  if not private.can_prescribe_for_patient(p_patient_id) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  select mission_enabled into v_on from public.clinic_routine_settings where clinic_id = private.patient_clinic(p_patient_id);
  if not coalesce(v_on, false) then raise exception 'mission_disabled' using errcode = '22023'; end if;
  insert into public.patient_missions (patient_id, clinic_id, started_on, started_by_profile_id)
  values (p_patient_id, private.patient_clinic(p_patient_id), v_today, private.current_profile_id())
  on conflict (patient_id) do update set started_on = v_today, completed_at = null, celebrated_at = null, started_by_profile_id = private.current_profile_id()
    where p_restart;
end $$;

revoke all on function public.save_clinic_routine_settings(uuid, jsonb), public.save_patient_routine_override(uuid, text, jsonb),
  public.clear_patient_routine_override(uuid), public.get_patient_routine(uuid, int), public.log_my_routine_entry(text, text, text),
  public.get_patient_mission(uuid), public.mark_my_mission_celebrated(), public.start_patient_mission(uuid, boolean) from public, anon;
grant execute on function public.save_clinic_routine_settings(uuid, jsonb), public.save_patient_routine_override(uuid, text, jsonb),
  public.clear_patient_routine_override(uuid), public.get_patient_routine(uuid, int), public.log_my_routine_entry(text, text, text),
  public.get_patient_mission(uuid), public.mark_my_mission_celebrated(), public.start_patient_mission(uuid, boolean) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261124110000','20261124110000_auto_a45_rotina_missao.sql',
  'A4+A5: clinic_routine_settings (rotina foto/peso/feedback + missão da 1a semana, nasce desligado), patient_routine_overrides, patient_routine_entries, '
  'patient_missions + RPCs save_clinic_routine_settings/save_patient_routine_override/clear_patient_routine_override/get_patient_routine/'
  'log_my_routine_entry/get_patient_mission/mark_my_mission_celebrated/start_patient_mission. So objetos novos; RLS por can_access_patient_internal.',
  'AUTO-A45')
on conflict (version) do nothing;
