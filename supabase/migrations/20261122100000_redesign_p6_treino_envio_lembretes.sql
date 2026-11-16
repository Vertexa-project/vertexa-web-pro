-- =====================================================================================
-- REDESIGN P6 — Treino publicado (sem amarra de dia) · Envio ao app do paciente (PDF com a marca) · Lembretes A2
--
-- SÓ OBJETOS NOVOS (ou colunas novas com default seguro). Nada existente é recriado:
--   1) workout_plans ganha is_draft (default false = TODO plano existente continua publicado e visível),
--      published_at e published_by. Policies RESTRITIVAS novas escondem o rascunho SÓ do próprio paciente
--      (a equipe com acesso vê tudo). RPCs novas: publish_workout_plan e save_workout_plan_v2 (esta chama a
--      save_workout_plan que já existe e só acerta o estado de publicação, tudo na mesma transação).
--   2) patient_deliveries (envios ao app do paciente: quem enviou, quando, quando o paciente abriu) +
--      RPCs send_document_to_patient / revoke_delivery / mark_delivery_opened.
--   3) patient_reminders (A2: exame e retorno, uma linha por lembrete; a data mudou = a MESMA linha muda, sem
--      duplicar; o aviso é DERIVADO na leitura em America/Sao_Paulo, sem cron) + RPCs upsert/delete/complete.
--
-- Permissão (decisão P6): publicar treino = disciplina educador_fisico ou fisioterapeuta (can_write_discipline, a mesma
-- do salvar treino); enviar plano alimentar = nutricionista; enviar documento/relatório e cadastrar lembrete =
-- acesso clínico ao paciente (can_prescribe_for_patient: profissional vinculado ou admin da clínica). Recepção e
-- Financeiro não abrem a ficha (patients_select = can_access_patient), então não cadastram lembrete nem enviam.
-- O paciente só lê o que é dele (can_access_patient_internal) e nunca escreve.
--
-- streak_walk (invoker) lê workout_plans como o paciente: com o rascunho escondido pela policy restritiva, o plano
-- ainda não publicado não entra nos dias planejados da sequência.
--
-- Reversão: drop das 3 funções public + 2 tabelas + 3 policies restritivas + helpers private; alter table workout_plans
-- drop column is_draft, published_at, published_by.
-- =====================================================================================

-- ───────────────────────── 1) Treino publicado / rascunho
alter table public.workout_plans
  add column if not exists is_draft boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.professionals(id) on delete set null;

create or replace function private.workout_plan_hidden_from_patient(p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workout_plans wp
                  where wp.id = p_plan and wp.is_draft and private.is_self_patient(wp.patient_id))
$$;
create or replace function private.workout_hidden_from_patient(p_workout uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workouts w
                   join public.workout_plans wp on wp.id = w.workout_plan_id
                  where w.id = p_workout and wp.is_draft and private.is_self_patient(wp.patient_id))
$$;
revoke all on function private.workout_plan_hidden_from_patient(uuid), private.workout_hidden_from_patient(uuid) from public, anon;
grant execute on function private.workout_plan_hidden_from_patient(uuid), private.workout_hidden_from_patient(uuid) to authenticated;

drop policy if exists workout_plans_hide_draft_from_patient on public.workout_plans;
create policy workout_plans_hide_draft_from_patient on public.workout_plans as restrictive for select to authenticated
  using ( not (is_draft and private.is_self_patient(patient_id)) );
drop policy if exists workouts_hide_draft_from_patient on public.workouts;
create policy workouts_hide_draft_from_patient on public.workouts as restrictive for select to authenticated
  using ( not private.workout_plan_hidden_from_patient(workout_plan_id) );
drop policy if exists workout_exercises_hide_draft_from_patient on public.workout_exercises;
create policy workout_exercises_hide_draft_from_patient on public.workout_exercises as restrictive for select to authenticated
  using ( not private.workout_hidden_from_patient(workout_id) );

create or replace function public.publish_workout_plan(p_plan_id uuid, p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; v_draft boolean; v_pub timestamptz; v_prof uuid; v_w int; v_ex int;
begin
  if private.current_profile_id() is null then
    raise exception 'publish_workout_plan: not authenticated' using errcode = '42501';
  end if;
  select patient_id, is_draft, published_at into v_patient, v_draft, v_pub from public.workout_plans where id = p_plan_id;
  if v_patient is null then raise exception 'publish_workout_plan: plan not found' using errcode = 'P0002'; end if;
  if not private.can_write_discipline(v_patient, array['educador_fisico','fisioterapeuta']) then
    raise exception 'forbidden: requires educador_fisico or fisioterapeuta discipline' using errcode = '42501';
  end if;
  select count(distinct w.id), count(e.id) into v_w, v_ex
    from public.workouts w left join public.workout_exercises e on e.workout_id = w.id where w.workout_plan_id = p_plan_id;
  if v_ex = 0 then raise exception 'workout_plan_empty' using errcode = '22023'; end if;
  if not v_draft then
    return jsonb_build_object('already_published', true, 'published_at', v_pub, 'workouts', v_w, 'exercises', v_ex);
  end if;
  select pr.id into v_prof from public.professionals pr
   where pr.profile_id = private.current_profile_id() and pr.clinic_id = private.patient_clinic(v_patient) limit 1;
  update public.workout_plans set is_draft = false, published_at = now(), published_by = v_prof where id = p_plan_id
    returning published_at into v_pub;
  if p_notify then
    insert into public.notifications (patient_id, type, title, body)
    values (v_patient, 'professional', 'Treino novo liberado',
            'Seu treino já está no app. Você pode abrir qualquer dia e fazer quando quiser.');
  end if;
  return jsonb_build_object('already_published', false, 'published_at', v_pub, 'workouts', v_w, 'exercises', v_ex);
end $$;

-- Salvar com estado de publicação: rascunho até a 1ª publicação; plano que o paciente já vê continua visível
-- (editar um plano publicado vale na hora, como era antes); p_publish = true publica junto.
create or replace function public.save_workout_plan_v2(
  p_patient_id uuid, p_title text, p_goal text default null, p_workouts jsonb default '[]'::jsonb, p_publish boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev_draft boolean; v_prev_at timestamptz; v_prev_by uuid; v_has boolean := false; v_plan uuid; v_prof uuid;
begin
  if not private.can_write_discipline(p_patient_id, array['educador_fisico','fisioterapeuta']) then
    raise exception 'forbidden: requires educador_fisico or fisioterapeuta discipline' using errcode = '42501';
  end if;
  select true, wp.is_draft, wp.published_at, wp.published_by into v_has, v_prev_draft, v_prev_at, v_prev_by
    from public.workout_plans wp where wp.patient_id = p_patient_id order by wp.created_at desc limit 1;
  v_plan := public.save_workout_plan(p_patient_id, p_title, p_goal, p_workouts);
  select pr.id into v_prof from public.professionals pr
   where pr.profile_id = private.current_profile_id() and pr.clinic_id = private.patient_clinic(p_patient_id) limit 1;
  if p_publish then
    update public.workout_plans set is_draft = false, published_at = now(), published_by = v_prof where id = v_plan;
  elsif coalesce(v_has, false) and not v_prev_draft then
    update public.workout_plans set is_draft = false, published_at = v_prev_at, published_by = v_prev_by where id = v_plan;
  else
    update public.workout_plans set is_draft = true, published_at = null, published_by = null where id = v_plan;
  end if;
  return v_plan;
end $$;

revoke all on function public.publish_workout_plan(uuid, boolean), public.save_workout_plan_v2(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.publish_workout_plan(uuid, boolean), public.save_workout_plan_v2(uuid, text, text, jsonb, boolean) to authenticated;

-- ───────────────────────── 2) Envios ao app do paciente (PDF com a marca da clínica e documentos)
create table if not exists public.patient_deliveries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  document_id uuid not null references public.patient_documents(id) on delete cascade,
  kind text not null check (kind in ('treino','plano_alimentar','documento','relatorio')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  file_path text not null,
  mime_type text,
  file_size_bytes bigint,
  sent_by_professional_id uuid references public.professionals(id) on delete set null,
  sent_by_profile_id uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  first_opened_at timestamptz,
  revoked_at timestamptz,
  constraint patient_deliveries_one_per_document unique (document_id)
);
create index if not exists patient_deliveries_patient_idx on public.patient_deliveries (patient_id, sent_at desc);
alter table public.patient_deliveries enable row level security;
revoke all on public.patient_deliveries from anon, authenticated;
grant select on public.patient_deliveries to authenticated;
drop policy if exists patient_deliveries_select on public.patient_deliveries;
create policy patient_deliveries_select on public.patient_deliveries for select to authenticated
  using ( private.can_access_patient_internal(patient_id)
          and (revoked_at is null or not private.is_self_patient(patient_id)) );

create or replace function public.send_document_to_patient(p_document_id uuid, p_kind text, p_title text default null, p_notify boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.patient_documents%rowtype; v_id uuid; v_prof uuid; v_title text; v_ok boolean;
begin
  if private.current_profile_id() is null then
    raise exception 'send_document_to_patient: not authenticated' using errcode = '42501';
  end if;
  if p_kind not in ('treino','plano_alimentar','documento','relatorio') then
    raise exception 'send_document_to_patient: invalid kind' using errcode = '22023';
  end if;
  select * into d from public.patient_documents where id = p_document_id;
  if d.id is null then raise exception 'send_document_to_patient: document not found' using errcode = 'P0002'; end if;
  v_ok := case p_kind
    when 'treino' then private.can_write_discipline(d.patient_id, array['educador_fisico','fisioterapeuta'])
    when 'plano_alimentar' then private.can_write_discipline(d.patient_id, array['nutricionista'])
    else private.can_prescribe_for_patient(d.patient_id) end;
  if not coalesce(v_ok, false) then
    raise exception 'forbidden: not allowed to send this to the patient' using errcode = '42501';
  end if;
  if d.uploaded_by_role <> 'professional' then
    raise exception 'send_document_to_patient: only documents from the clinic can be sent' using errcode = '22023';
  end if;
  select id into v_id from public.patient_deliveries where document_id = d.id;
  if v_id is not null then
    update public.patient_deliveries set revoked_at = null where id = v_id and revoked_at is not null;
    return v_id;
  end if;
  v_title := coalesce(nullif(btrim(coalesce(p_title,'')), ''), nullif(btrim(coalesce(d.title,'')), ''), 'Documento da clínica');
  select pr.id into v_prof from public.professionals pr
   where pr.profile_id = private.current_profile_id() and pr.clinic_id = private.patient_clinic(d.patient_id) limit 1;
  insert into public.patient_deliveries (patient_id, clinic_id, document_id, kind, title, file_path, mime_type, file_size_bytes,
                                         sent_by_professional_id, sent_by_profile_id)
  values (d.patient_id, private.patient_clinic(d.patient_id), d.id, p_kind, left(v_title, 160), d.file_path, d.mime_type,
          d.file_size_bytes, v_prof, private.current_profile_id())
  returning id into v_id;
  if p_notify then
    insert into public.notifications (patient_id, type, title, body)
    values (d.patient_id, 'professional', 'Novo documento da clínica', left(v_title, 120) || ' já está em Meus documentos.');
  end if;
  return v_id;
end $$;

create or replace function public.revoke_delivery(p_delivery_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.patient_deliveries%rowtype; v_ok boolean;
begin
  select * into v from public.patient_deliveries where id = p_delivery_id;
  if v.id is null then raise exception 'revoke_delivery: not found' using errcode = 'P0002'; end if;
  v_ok := case v.kind
    when 'treino' then private.can_write_discipline(v.patient_id, array['educador_fisico','fisioterapeuta'])
    when 'plano_alimentar' then private.can_write_discipline(v.patient_id, array['nutricionista'])
    else private.can_prescribe_for_patient(v.patient_id) end;
  if not coalesce(v_ok, false) then raise exception 'forbidden: not allowed to withdraw this delivery' using errcode = '42501'; end if;
  update public.patient_deliveries set revoked_at = now() where id = p_delivery_id and revoked_at is null;
end $$;

create or replace function public.mark_delivery_opened(p_delivery_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.patient_deliveries set first_opened_at = now()
   where id = p_delivery_id and first_opened_at is null and revoked_at is null and private.is_self_patient(patient_id);
end $$;

revoke all on function public.send_document_to_patient(uuid, text, text, boolean), public.revoke_delivery(uuid), public.mark_delivery_opened(uuid) from public, anon;
grant execute on function public.send_document_to_patient(uuid, text, text, boolean), public.revoke_delivery(uuid), public.mark_delivery_opened(uuid) to authenticated;

-- ───────────────────────── 3) Lembretes de exame e retorno (A2)
create table if not exists public.patient_reminders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  kind text not null check (kind in ('exam','return')),
  title text check (title is null or char_length(btrim(title)) between 1 and 80),
  due_on date not null,
  notify_patient boolean not null default true,
  notify_days_before int not null default 7 check (notify_days_before between 0 and 90),
  pro_notify_days_before int not null default 7 check (pro_notify_days_before between 0 and 90),
  message_template text check (message_template is null or char_length(message_template) <= 500),
  done_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_reminders_exam_has_title check (kind <> 'exam' or title is not null)
);
create unique index if not exists patient_reminders_one_open_return on public.patient_reminders (patient_id) where kind = 'return' and done_at is null;
create unique index if not exists patient_reminders_one_open_exam_name on public.patient_reminders (patient_id, lower(btrim(title))) where kind = 'exam' and done_at is null;
create index if not exists patient_reminders_clinic_due_idx on public.patient_reminders (clinic_id, due_on) where done_at is null;
create index if not exists patient_reminders_patient_idx on public.patient_reminders (patient_id);
alter table public.patient_reminders enable row level security;
revoke all on public.patient_reminders from anon, authenticated;
grant select on public.patient_reminders to authenticated;
drop policy if exists patient_reminders_select on public.patient_reminders;
create policy patient_reminders_select on public.patient_reminders for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );

create or replace function public.upsert_patient_reminder(
  p_patient_id uuid, p_kind text, p_title text, p_due_on date,
  p_notify_days int default 7, p_pro_notify_days int default 7, p_message text default null,
  p_notify_patient boolean default true, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text := nullif(btrim(coalesce(p_title,'')), ''); v_msg text := nullif(btrim(coalesce(p_message,'')), '');
        v_today date := private.brt_date(now()); v_old date;
begin
  if private.current_profile_id() is null then raise exception 'upsert_patient_reminder: not authenticated' using errcode = '42501'; end if;
  if not private.can_prescribe_for_patient(p_patient_id) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  if p_kind not in ('exam','return') then raise exception 'upsert_patient_reminder: invalid kind' using errcode = '22023'; end if;
  if p_due_on is null or p_due_on < v_today - 365 or p_due_on > v_today + 3650 then
    raise exception 'upsert_patient_reminder: invalid date' using errcode = '22023';
  end if;
  if p_kind = 'exam' and v_title is null then raise exception 'upsert_patient_reminder: exam name required' using errcode = '22023'; end if;
  if p_kind = 'return' then v_title := null; end if;
  if p_notify_days not between 0 and 90 or p_pro_notify_days not between 0 and 90 then
    raise exception 'upsert_patient_reminder: invalid notice window' using errcode = '22023';
  end if;
  if p_id is not null then
    select id, due_on into v_id, v_old from public.patient_reminders where id = p_id and patient_id = p_patient_id;
    if v_id is null then raise exception 'upsert_patient_reminder: reminder not found' using errcode = 'P0002'; end if;
  elsif p_kind = 'return' then
    select id, due_on into v_id, v_old from public.patient_reminders where patient_id = p_patient_id and kind = 'return' and done_at is null;
  else
    select id, due_on into v_id, v_old from public.patient_reminders
     where patient_id = p_patient_id and kind = 'exam' and done_at is null and lower(btrim(title)) = lower(v_title);
  end if;
  if v_id is null then
    insert into public.patient_reminders (patient_id, clinic_id, kind, title, due_on, notify_patient, notify_days_before,
           pro_notify_days_before, message_template, created_by_profile_id, updated_by_profile_id)
    values (p_patient_id, private.patient_clinic(p_patient_id), p_kind, v_title, p_due_on, p_notify_patient, p_notify_days,
            p_pro_notify_days, v_msg, private.current_profile_id(), private.current_profile_id())
    returning id into v_id;
  else
    update public.patient_reminders set kind = p_kind, title = v_title, due_on = p_due_on, notify_patient = p_notify_patient,
           notify_days_before = p_notify_days, pro_notify_days_before = p_pro_notify_days, message_template = v_msg,
           done_at = case when v_old is distinct from p_due_on then null else done_at end,
           updated_by_profile_id = private.current_profile_id(), updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_patient_reminder(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.patient_reminders where id = p_id;
  if v_patient is null then return; end if;
  if not private.can_prescribe_for_patient(v_patient) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  delete from public.patient_reminders where id = p_id;
end $$;

create or replace function public.complete_patient_reminder(p_id uuid, p_done boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.patient_reminders where id = p_id;
  if v_patient is null then raise exception 'complete_patient_reminder: not found' using errcode = 'P0002'; end if;
  if not private.can_prescribe_for_patient(v_patient) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  update public.patient_reminders set done_at = case when p_done then now() else null end, updated_at = now(),
         updated_by_profile_id = private.current_profile_id() where id = p_id;
end $$;

revoke all on function public.upsert_patient_reminder(uuid, text, text, date, int, int, text, boolean, uuid),
  public.delete_patient_reminder(uuid), public.complete_patient_reminder(uuid, boolean) from public, anon;
grant execute on function public.upsert_patient_reminder(uuid, text, text, date, int, int, text, boolean, uuid),
  public.delete_patient_reminder(uuid), public.complete_patient_reminder(uuid, boolean) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261122100000','20261122100000_redesign_p6_treino_envio_lembretes.sql',
  'Redesign P6: workout_plans.is_draft/published_at/published_by (default = publicado; backfill implicito) + policies restritivas que escondem '
  'rascunho so do proprio paciente + publish_workout_plan/save_workout_plan_v2; patient_deliveries + send_document_to_patient/revoke_delivery/'
  'mark_delivery_opened (PDF com a marca no app); patient_reminders (A2 exame/retorno, aviso derivado na leitura) + upsert/delete/complete. '
  'So objetos novos; RLS: paciente le o que e dele e nunca escreve.',
  'REDESIGN-P6')
on conflict (version) do nothing;
