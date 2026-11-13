-- =====================================================================================
-- VERTEXA — Consulta assistida (parte 1): atendimento clínico, gravação em pedaços, transcrição,
-- prontuário estruturado, revisão/finalização, adendos e envio dos combinados ao paciente.
-- 100% ADITIVA: só objetos NOVOS (tabelas clinical_*, bucket privado clinical-audio, funções
-- private.clinical_* e public.clinical_*). Não altera nem remove nada que já existe
-- (a única escrita em tabela existente é a RPC clinical_send_agreements inserindo UMA linha em
-- public.notifications, como o app do paciente já lê).
--
-- Quem acessa: SÓ equipe clínica da MESMA clínica do paciente = profissional ativo (professionals)
-- que é admin da clínica OU tem vínculo ativo, NÃO externo, com o paciente.
--   * o PRÓPRIO paciente NÃO lê (private.can_access_patient deixaria; por isso helper novo);
--   * quem só tem papel financeiro/recepção (clinic_staff_roles, sem linha em professionals) não lê;
--   * profissional externo convidado (is_external) não lê; outra clínica não lê.
-- Escritas só por RPC security definer (tabelas sem policy de insert/update/delete).
--
-- Rollback (nada disso toca dado antigo):
--   drop table if exists public.clinical_agreement_sends, public.clinical_record_versions,
--     public.clinical_addenda, public.clinical_records, public.clinical_transcript_segments,
--     public.clinical_audio_chunks, public.clinical_encounters, public.clinical_templates cascade;
--   drop function if exists public.clinical_*(...) ; drop function if exists private.clinical_*(...);
--   delete from storage.objects where bucket_id='clinical-audio'; delete from storage.buckets where id='clinical-audio';
-- =====================================================================================

-- ------------------------------------------------------------------ helpers (private)
create or replace function private.clinical_current_professional(p_clinic uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select pr.id
    from public.professionals pr
   where pr.clinic_id = p_clinic
     and pr.profile_id = private.current_profile_id()
     and coalesce(pr.status, 'active') = 'active'
   order by pr.id
   limit 1
$$;

create or replace function private.clinical_is_team_of_clinic(p_clinic uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null
     and private.clinic_is_operational(p_clinic)
     and private.clinical_current_professional(p_clinic) is not null
$$;

create or replace function private.clinical_can_access_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_patient is not null and exists (
    select 1
      from public.patients pt
      join public.professionals pr on pr.clinic_id = pt.clinic_id
     where pt.id = p_patient
       and pr.profile_id = private.current_profile_id()
       and coalesce(pr.status, 'active') = 'active'
       and private.clinic_is_operational(pt.clinic_id)
       and (
         pr.clinic_role = 'admin'
         or exists (
           select 1 from public.professional_patient_links l
            where l.patient_id = pt.id
              and l.professional_id = pr.id
              and coalesce(l.status, 'active') = 'active'
              and coalesce(l.is_external, false) = false
         )
       )
  )
$$;

-- ------------------------------------------------------------------ tabelas
create table if not exists public.clinical_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,   -- null = padrão da plataforma
  name text not null,
  version int not null default 1,
  is_default boolean not null default false,
  sections jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clinical_templates_one_default_per_clinic
  on public.clinical_templates (coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_default;

create table if not exists public.clinical_encounters (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  template_id uuid references public.clinical_templates(id) on delete set null,
  template_snapshot jsonb not null,
  status text not null default 'rascunho'
    check (status in ('gravando','processando','rascunho','finalizado','cancelado')),
  started_at timestamptz not null default now(),
  recording_started_at timestamptz,
  ended_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid references public.professionals(id) on delete set null,
  final_fields jsonb,
  -- consentimento (texto e versão guardados como foram mostrados)
  consent_version text,
  consent_text text,
  consent_given_at timestamptz,
  consent_marked_by uuid references public.professionals(id) on delete set null,
  is_demo boolean not null default false,
  processing_error text,
  audio_delete_after timestamptz,
  audio_deleted_at timestamptz,
  agreements_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinical_encounters_patient_idx on public.clinical_encounters (patient_id, started_at desc);
create index if not exists clinical_encounters_clinic_idx on public.clinical_encounters (clinic_id, started_at desc);
create index if not exists clinical_encounters_audio_due_idx on public.clinical_encounters (audio_delete_after)
  where audio_deleted_at is null and audio_delete_after is not null;

create table if not exists public.clinical_audio_chunks (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.clinical_encounters(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  seq int not null check (seq >= 0),
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  duration_ms int,
  status text not null default 'uploaded' check (status in ('uploaded','transcribing','done','failed')),
  attempts int not null default 0,
  error text,
  audio_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (encounter_id, seq)
);

create table if not exists public.clinical_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.clinical_encounters(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  chunk_id uuid references public.clinical_audio_chunks(id) on delete set null,
  ord int not null,                 -- ordem global no atendimento (seq do pedaço * 1000 + índice)
  speaker text,
  text text not null,
  start_ms int not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (encounter_id, ord)
);

create table if not exists public.clinical_records (
  encounter_id uuid primary key references public.clinical_encounters(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  -- { "<secao>.<campo>": {"value": text, "sources": [ord...], "locked": bool, "by": "ai"|"manual", "updated_at": ts} }
  fields jsonb not null default '{}'::jsonb,
  version int not null default 1,
  ai_warning text,
  ai_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.clinical_record_versions (
  id bigint generated always as identity primary key,
  encounter_id uuid not null references public.clinical_encounters(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  action text not null check (action in ('ai','manual','unlock','finalize','addendum','consent','status')),
  field_key text,
  before_value jsonb,
  after_value jsonb,
  actor_professional_id uuid references public.professionals(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists clinical_record_versions_enc_idx on public.clinical_record_versions (encounter_id, id);

create table if not exists public.clinical_addenda (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.clinical_encounters(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  author_professional_id uuid not null references public.professionals(id) on delete restrict,
  text text not null check (length(btrim(text)) > 0 and length(text) <= 8000),
  created_at timestamptz not null default now()
);
create index if not exists clinical_addenda_enc_idx on public.clinical_addenda (encounter_id, created_at);

create table if not exists public.clinical_agreement_sends (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.clinical_encounters(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  notification_id uuid,
  text text not null,
  sent_by_professional_id uuid references public.professionals(id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists clinical_agreement_sends_enc_idx on public.clinical_agreement_sends (encounter_id, sent_at desc);

-- ------------------------------------------------------------------ helper por atendimento (depende da tabela)
create or replace function private.clinical_can_access_encounter(p_encounter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clinical_encounters e
     where e.id = p_encounter and private.clinical_can_access_patient(e.patient_id)
  )
$$;

-- ------------------------------------------------------------------ RLS: só leitura, só equipe clínica
alter table public.clinical_templates enable row level security;
alter table public.clinical_encounters enable row level security;
alter table public.clinical_audio_chunks enable row level security;
alter table public.clinical_transcript_segments enable row level security;
alter table public.clinical_records enable row level security;
alter table public.clinical_record_versions enable row level security;
alter table public.clinical_addenda enable row level security;
alter table public.clinical_agreement_sends enable row level security;

revoke all on public.clinical_templates, public.clinical_encounters, public.clinical_audio_chunks,
  public.clinical_transcript_segments, public.clinical_records, public.clinical_record_versions,
  public.clinical_addenda, public.clinical_agreement_sends from public, anon, authenticated;
grant select on public.clinical_templates, public.clinical_encounters, public.clinical_audio_chunks,
  public.clinical_transcript_segments, public.clinical_records, public.clinical_record_versions,
  public.clinical_addenda, public.clinical_agreement_sends to authenticated;

drop policy if exists clinical_templates_select on public.clinical_templates;
create policy clinical_templates_select on public.clinical_templates for select to authenticated
  using (
    (clinic_id is null and exists (
       select 1 from public.professionals pr
        where pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'))
    or (clinic_id is not null and private.clinical_is_team_of_clinic(clinic_id))
  );

drop policy if exists clinical_encounters_select on public.clinical_encounters;
create policy clinical_encounters_select on public.clinical_encounters for select to authenticated
  using (private.clinical_can_access_patient(patient_id));

drop policy if exists clinical_audio_chunks_select on public.clinical_audio_chunks;
create policy clinical_audio_chunks_select on public.clinical_audio_chunks for select to authenticated
  using (private.clinical_can_access_encounter(encounter_id));

drop policy if exists clinical_transcript_segments_select on public.clinical_transcript_segments;
create policy clinical_transcript_segments_select on public.clinical_transcript_segments for select to authenticated
  using (private.clinical_can_access_encounter(encounter_id));

drop policy if exists clinical_records_select on public.clinical_records;
create policy clinical_records_select on public.clinical_records for select to authenticated
  using (private.clinical_can_access_encounter(encounter_id));

drop policy if exists clinical_record_versions_select on public.clinical_record_versions;
create policy clinical_record_versions_select on public.clinical_record_versions for select to authenticated
  using (private.clinical_can_access_encounter(encounter_id));

drop policy if exists clinical_addenda_select on public.clinical_addenda;
create policy clinical_addenda_select on public.clinical_addenda for select to authenticated
  using (private.clinical_can_access_encounter(encounter_id));

drop policy if exists clinical_agreement_sends_select on public.clinical_agreement_sends;
create policy clinical_agreement_sends_select on public.clinical_agreement_sends for select to authenticated
  using (private.clinical_can_access_encounter(encounter_id));

-- ------------------------------------------------------------------ imutabilidade (cinto e suspensório)
create or replace function private.clinical_encounter_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalizado' then raise exception 'ENCOUNTER_FINALIZED' using errcode = '22023'; end if;
    return old;
  end if;
  if old.status = 'finalizado' then
    if new.status is distinct from old.status
       or new.finalized_at is distinct from old.finalized_at
       or new.final_fields is distinct from old.final_fields
       or new.template_snapshot is distinct from old.template_snapshot
       or new.patient_id is distinct from old.patient_id
       or new.professional_id is distinct from old.professional_id
       or new.consent_given_at is distinct from old.consent_given_at then
      raise exception 'ENCOUNTER_FINALIZED' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists clinical_encounter_guard on public.clinical_encounters;
create trigger clinical_encounter_guard before update or delete on public.clinical_encounters
  for each row execute function private.clinical_encounter_guard();

create or replace function private.clinical_child_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text; v_enc uuid;
begin
  v_enc := case when tg_op = 'DELETE' then old.encounter_id else new.encounter_id end;
  select status into v_status from public.clinical_encounters where id = v_enc;
  if v_status = 'finalizado' and tg_table_name in ('clinical_records','clinical_transcript_segments') then
    raise exception 'ENCOUNTER_FINALIZED' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists clinical_records_guard on public.clinical_records;
create trigger clinical_records_guard before update or delete on public.clinical_records
  for each row execute function private.clinical_child_guard();
drop trigger if exists clinical_segments_guard on public.clinical_transcript_segments;
create trigger clinical_segments_guard before insert or update or delete on public.clinical_transcript_segments
  for each row execute function private.clinical_child_guard();

-- ------------------------------------------------------------------ RPCs (security definer)
create or replace function public.clinical_check_encounter_access(p_encounter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.clinical_can_access_encounter(p_encounter)
$$;

create or replace function public.clinical_start_encounter(p_patient uuid, p_template uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid; v_prof uuid; v_tpl public.clinical_templates; v_id uuid;
begin
  if not private.clinical_can_access_patient(p_patient) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select clinic_id into v_clinic from public.patients where id = p_patient;
  v_prof := private.clinical_current_professional(v_clinic);
  if v_prof is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_tpl from public.clinical_templates t
   where (p_template is not null and t.id = p_template and (t.clinic_id = v_clinic or t.clinic_id is null))
      or (p_template is null and t.is_default and t.clinic_id = v_clinic)
   order by t.created_at desc limit 1;
  if v_tpl.id is null and p_template is null then
    select * into v_tpl from public.clinical_templates t where t.is_default and t.clinic_id is null limit 1;
  end if;
  if v_tpl.id is null then raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.clinical_encounters (clinic_id, patient_id, professional_id, template_id, template_snapshot)
  values (v_clinic, p_patient, v_prof, v_tpl.id,
          jsonb_build_object('name', v_tpl.name, 'version', v_tpl.version, 'sections', v_tpl.sections))
  returning id into v_id;
  insert into public.clinical_records (encounter_id, clinic_id) values (v_id, v_clinic);
  return v_id;
end $$;

create or replace function public.clinical_record_consent(p_encounter uuid, p_version text, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status in ('finalizado','cancelado') then raise exception 'ENCOUNTER_NOT_EDITABLE' using errcode = '22023'; end if;
  if coalesce(btrim(p_version), '') = '' or coalesce(btrim(p_text), '') = '' then
    raise exception 'INVALID_CONSENT' using errcode = '22023';
  end if;
  update public.clinical_encounters
     set consent_version = p_version, consent_text = p_text, consent_given_at = now(),
         consent_marked_by = private.clinical_current_professional(e.clinic_id)
   where id = p_encounter and consent_given_at is null;
  insert into public.clinical_record_versions (encounter_id, clinic_id, action, after_value, actor_professional_id)
  values (p_encounter, e.clinic_id, 'consent', jsonb_build_object('version', p_version),
          private.clinical_current_professional(e.clinic_id));
end $$;

create or replace function public.clinical_set_status(p_encounter uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters;
begin
  if p_status not in ('gravando','processando','rascunho') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status in ('finalizado','cancelado') then raise exception 'ENCOUNTER_NOT_EDITABLE' using errcode = '22023'; end if;
  if p_status = 'gravando' and e.consent_given_at is null then
    raise exception 'CONSENT_REQUIRED' using errcode = '22023';
  end if;
  update public.clinical_encounters
     set status = p_status,
         recording_started_at = case when p_status = 'gravando' then coalesce(recording_started_at, now()) else recording_started_at end,
         ended_at = case when p_status = 'processando' then now() else ended_at end,
         processing_error = case when p_status = 'rascunho' then null else processing_error end
   where id = p_encounter;
end $$;

create or replace function public.clinical_cancel_encounter(p_encounter uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status = 'finalizado' then raise exception 'ENCOUNTER_FINALIZED' using errcode = '22023'; end if;
  update public.clinical_encounters set status = 'cancelado', ended_at = coalesce(ended_at, now()),
         audio_delete_after = coalesce(audio_delete_after, now() + interval '30 days') where id = p_encounter;
end $$;

create or replace function private.clinical_template_has_key(p_snapshot jsonb, p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select exists (
    select 1
      from jsonb_array_elements(p_snapshot -> 'sections') s,
           jsonb_array_elements(s -> 'fields') f
     where (s ->> 'id') || '.' || (f ->> 'id') = p_key
  )
$$;

create or replace function public.clinical_save_field(p_encounter uuid, p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; r public.clinical_records; v_before jsonb; v_new jsonb; v_prof uuid;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status in ('finalizado','cancelado') then raise exception 'ENCOUNTER_NOT_EDITABLE' using errcode = '22023'; end if;
  if not private.clinical_template_has_key(e.template_snapshot, p_key) then
    raise exception 'INVALID_FIELD' using errcode = '22023';
  end if;
  if length(coalesce(p_value, '')) > 8000 then raise exception 'VALUE_TOO_LONG' using errcode = '22023'; end if;
  select * into r from public.clinical_records where encounter_id = p_encounter for update;
  v_prof := private.clinical_current_professional(e.clinic_id);
  v_before := r.fields -> p_key;
  v_new := jsonb_build_object(
    'value', coalesce(p_value, ''),
    'sources', coalesce(v_before -> 'sources', '[]'::jsonb),
    'locked', true, 'by', 'manual', 'updated_at', now());
  update public.clinical_records
     set fields = jsonb_set(fields, array[p_key], v_new, true), version = version + 1, updated_at = now()
   where encounter_id = p_encounter;
  insert into public.clinical_record_versions (encounter_id, clinic_id, action, field_key, before_value, after_value, actor_professional_id)
  values (p_encounter, e.clinic_id, 'manual', p_key, v_before, v_new, v_prof);
  return v_new;
end $$;

create or replace function public.clinical_unlock_field(p_encounter uuid, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; r public.clinical_records; v_before jsonb;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status in ('finalizado','cancelado') then raise exception 'ENCOUNTER_NOT_EDITABLE' using errcode = '22023'; end if;
  select * into r from public.clinical_records where encounter_id = p_encounter for update;
  v_before := r.fields -> p_key;
  if v_before is null then return; end if;
  update public.clinical_records
     set fields = jsonb_set(fields, array[p_key], v_before || '{"locked": false}'::jsonb, true),
         version = version + 1, updated_at = now()
   where encounter_id = p_encounter;
  insert into public.clinical_record_versions (encounter_id, clinic_id, action, field_key, before_value, after_value, actor_professional_id)
  values (p_encounter, e.clinic_id, 'unlock', p_key, v_before, v_before || '{"locked": false}'::jsonb,
          private.clinical_current_professional(e.clinic_id));
end $$;

-- Só a Edge Function (service_role) chama: aplica o rascunho da IA PULANDO campo travado (editado à mão).
create or replace function public.clinical_apply_ai_fields(p_encounter uuid, p_fields jsonb, p_warning text, p_demo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; r public.clinical_records; k text; v jsonb; cur jsonb; v_new text;
        applied int := 0; skipped int := 0; v_entry jsonb;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if e.status in ('finalizado','cancelado') then raise exception 'ENCOUNTER_NOT_EDITABLE' using errcode = '22023'; end if;
  select * into r from public.clinical_records where encounter_id = p_encounter for update;
  cur := r.fields;
  for k, v in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    v_new := btrim(coalesce(v ->> 'value', ''));
    if not private.clinical_template_has_key(e.template_snapshot, k)
       or v_new = ''
       or coalesce((cur -> k ->> 'locked')::boolean, false) then
      skipped := skipped + 1; continue;
    end if;
    if (cur -> k ->> 'value') is not distinct from v_new then continue; end if;
    v_entry := jsonb_build_object('value', v_new, 'sources', coalesce(v -> 'sources', '[]'::jsonb),
                                  'locked', false, 'by', 'ai', 'updated_at', now());
    insert into public.clinical_record_versions (encounter_id, clinic_id, action, field_key, before_value, after_value)
    values (p_encounter, e.clinic_id, 'ai', k, cur -> k, v_entry);
    cur := jsonb_set(cur, array[k], v_entry, true);
    applied := applied + 1;
  end loop;
  update public.clinical_records
     set fields = cur, version = version + (case when applied > 0 then 1 else 0 end),
         ai_warning = p_warning, ai_updated_at = now(), updated_at = now()
   where encounter_id = p_encounter;
  if coalesce(p_demo, false) and not e.is_demo then
    update public.clinical_encounters set is_demo = true where id = p_encounter;
  end if;
  return jsonb_build_object('applied', applied, 'skipped', skipped);
end $$;

create or replace function public.clinical_register_chunk(
  p_encounter uuid, p_seq int, p_path text, p_mime text, p_size bigint, p_duration_ms int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; v_id uuid;
begin
  select * into e from public.clinical_encounters where id = p_encounter;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status in ('finalizado','cancelado') then raise exception 'ENCOUNTER_NOT_EDITABLE' using errcode = '22023'; end if;
  if e.consent_given_at is null then raise exception 'CONSENT_REQUIRED' using errcode = '22023'; end if;
  if p_path !~ ('^' || e.clinic_id::text || '/' || e.id::text || '/' || p_seq::text || '\.[a-z0-9]+$') then
    raise exception 'INVALID_PATH' using errcode = '22023';
  end if;
  insert into public.clinical_audio_chunks (encounter_id, clinic_id, seq, storage_path, mime_type, size_bytes, duration_ms)
  values (p_encounter, e.clinic_id, p_seq, p_path, p_mime, p_size, p_duration_ms)
  on conflict (encounter_id, seq) do update set updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.clinical_finalize(p_encounter uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; r public.clinical_records; v_prof uuid;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status <> 'rascunho' then raise exception 'ENCOUNTER_NOT_READY' using errcode = '22023'; end if;
  select * into r from public.clinical_records where encounter_id = p_encounter for update;
  v_prof := private.clinical_current_professional(e.clinic_id);
  update public.clinical_encounters
     set status = 'finalizado', finalized_at = now(), finalized_by = v_prof, final_fields = r.fields,
         ended_at = coalesce(ended_at, now()), audio_delete_after = now() + interval '30 days'
   where id = p_encounter;
  insert into public.clinical_record_versions (encounter_id, clinic_id, action, after_value, actor_professional_id)
  values (p_encounter, e.clinic_id, 'finalize', r.fields, v_prof);
end $$;

create or replace function public.clinical_add_addendum(p_encounter uuid, p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; v_prof uuid; v_id uuid;
begin
  select * into e from public.clinical_encounters where id = p_encounter;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status <> 'finalizado' then raise exception 'ENCOUNTER_NOT_FINALIZED' using errcode = '22023'; end if;
  if coalesce(btrim(p_text), '') = '' or length(p_text) > 8000 then raise exception 'INVALID_TEXT' using errcode = '22023'; end if;
  v_prof := private.clinical_current_professional(e.clinic_id);
  insert into public.clinical_addenda (encounter_id, clinic_id, author_professional_id, text)
  values (p_encounter, e.clinic_id, v_prof, btrim(p_text)) returning id into v_id;
  insert into public.clinical_record_versions (encounter_id, clinic_id, action, after_value, actor_professional_id)
  values (p_encounter, e.clinic_id, 'addendum', jsonb_build_object('addendum_id', v_id), v_prof);
  return v_id;
end $$;

-- Envia os combinados como notificação do app do paciente (tabela notifications, tipo 'professional').
create or replace function public.clinical_send_agreements(p_encounter uuid, p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.clinical_encounters; v_notif uuid; v_title text; v_prof uuid;
begin
  select * into e from public.clinical_encounters where id = p_encounter for update;
  if not found or not private.clinical_can_access_patient(e.patient_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if e.status <> 'finalizado' then raise exception 'ENCOUNTER_NOT_FINALIZED' using errcode = '22023'; end if;
  if coalesce(btrim(p_text), '') = '' or length(p_text) > 4000 then raise exception 'INVALID_TEXT' using errcode = '22023'; end if;
  v_prof := private.clinical_current_professional(e.clinic_id);
  v_title := case when e.is_demo then '[Demonstração] Combinados da sua consulta' else 'Combinados da sua consulta' end;
  insert into public.notifications (patient_id, type, title, body)
  values (e.patient_id, 'professional', v_title, btrim(p_text)) returning id into v_notif;
  insert into public.clinical_agreement_sends (encounter_id, clinic_id, patient_id, notification_id, text, sent_by_professional_id)
  values (p_encounter, e.clinic_id, e.patient_id, v_notif, btrim(p_text), v_prof);
  update public.clinical_encounters set agreements_sent_at = now() where id = p_encounter;
  return v_notif;
end $$;

create or replace function public.clinical_list_encounters(p_patient uuid)
returns table (id uuid, status text, started_at timestamptz, ended_at timestamptz, finalized_at timestamptz,
               professional_name text, is_demo boolean, agreements_sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.status, e.started_at, e.ended_at, e.finalized_at,
         (select pf.full_name from public.professionals pr join public.profiles pf on pf.id = pr.profile_id
           where pr.id = e.professional_id) as professional_name,
         e.is_demo, e.agreements_sent_at
    from public.clinical_encounters e
   where e.patient_id = p_patient and private.clinical_can_access_patient(p_patient)
   order by e.started_at desc
$$;

-- Nome do profissional do atendimento e dos autores dos adendos (lido pela tela do atendimento).
create or replace function public.clinical_encounter_people(p_encounter uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.clinical_can_access_encounter(p_encounter) then
    jsonb_build_object(
      'professional', (select pf.full_name from public.clinical_encounters e
                         join public.professionals pr on pr.id = e.professional_id
                         join public.profiles pf on pf.id = pr.profile_id where e.id = p_encounter),
      'addenda', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text, 'created_at', a.created_at,
                    'author', (select pf.full_name from public.professionals pr join public.profiles pf on pf.id = pr.profile_id
                                where pr.id = a.author_professional_id)) order by a.created_at)
                  from public.clinical_addenda a where a.encounter_id = p_encounter), '[]'::jsonb))
  else null end
$$;

-- ------------------------------------------------------------------ grants das RPCs
do $$
declare f text;
begin
  foreach f in array array[
    'clinical_check_encounter_access(uuid)', 'clinical_start_encounter(uuid,uuid)',
    'clinical_record_consent(uuid,text,text)', 'clinical_set_status(uuid,text)',
    'clinical_cancel_encounter(uuid)', 'clinical_save_field(uuid,text,text)',
    'clinical_unlock_field(uuid,text)', 'clinical_register_chunk(uuid,int,text,text,bigint,int)',
    'clinical_finalize(uuid)', 'clinical_add_addendum(uuid,text)', 'clinical_send_agreements(uuid,text)',
    'clinical_list_encounters(uuid)', 'clinical_encounter_people(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.clinical_apply_ai_fields(uuid,jsonb,text,boolean) from public, anon, authenticated';
  execute 'grant execute on function public.clinical_apply_ai_fields(uuid,jsonb,text,boolean) to service_role';
end $$;

grant execute on function private.clinical_can_access_patient(uuid), private.clinical_can_access_encounter(uuid),
  private.clinical_is_team_of_clinic(uuid), private.clinical_current_professional(uuid) to authenticated;

-- ------------------------------------------------------------------ Storage: bucket PRIVADO clinical-audio
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-audio', 'clinical-audio', false, 52428800,
        array['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','audio/x-m4a'])
on conflict (id) do nothing;

-- caminho: <clinica>/<atendimento>/<n>.<ext>; só equipe com acesso, só atendimento em andamento e com aceite
create or replace function private.clinical_audio_path_ok(p_name text, p_writing boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+\.[a-z0-9]+$'
    then exists (
      select 1 from public.clinical_encounters e
       where e.id = split_part(p_name, '/', 2)::uuid
         and e.clinic_id = split_part(p_name, '/', 1)::uuid
         and private.clinical_can_access_patient(e.patient_id)
         and (not p_writing or (e.status in ('rascunho','gravando','processando') and e.consent_given_at is not null)))
    else false end
$$;
grant execute on function private.clinical_audio_path_ok(text, boolean) to authenticated;

drop policy if exists clinical_audio_insert on storage.objects;
create policy clinical_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinical-audio' and private.clinical_audio_path_ok(name, true));
drop policy if exists clinical_audio_select on storage.objects;
create policy clinical_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'clinical-audio' and private.clinical_audio_path_ok(name, false));

-- ------------------------------------------------------------------ modelo padrão (seed)
insert into public.clinical_templates (clinic_id, name, version, is_default, sections)
select null, 'Consulta de emagrecimento (padrão)', 1, true, $json$[
 {"id":"identificacao","title":"Identificação e objetivo","fields":[
   {"id":"objetivo","label":"Objetivo do paciente"}]},
 {"id":"queixa","title":"Queixa principal e história","fields":[
   {"id":"queixa_principal","label":"Queixa principal"},
   {"id":"historia","label":"História da doença atual"}]},
 {"id":"antecedentes_pessoais","title":"Antecedentes pessoais","fields":[
   {"id":"doencas","label":"Doenças"},
   {"id":"cirurgias","label":"Cirurgias"}]},
 {"id":"medicacoes","title":"Medicações em uso","fields":[
   {"id":"medicacoes_em_uso","label":"Medicações em uso"}]},
 {"id":"suplementos_hormonios","title":"Suplementos e hormônios","fields":[
   {"id":"uso_atual","label":"Uso atual"},
   {"id":"uso_anterior","label":"Uso anterior"}]},
 {"id":"antecedentes_familiares","title":"Antecedentes familiares","fields":[
   {"id":"antecedentes_familiares","label":"Antecedentes familiares"}]},
 {"id":"habitos","title":"Hábitos","fields":[
   {"id":"atividade_fisica","label":"Atividade física"},
   {"id":"sono","label":"Sono"},
   {"id":"agua","label":"Água"},
   {"id":"intestino","label":"Intestino"},
   {"id":"alimentacao","label":"Alimentação"},
   {"id":"intolerancias","label":"Intolerâncias"},
   {"id":"alcool_tabaco","label":"Álcool e tabaco"},
   {"id":"estresse","label":"Estresse"}]},
 {"id":"exames","title":"Exames trazidos","fields":[
   {"id":"exames_trazidos","label":"Exames trazidos"}]},
 {"id":"avaliacao","title":"Avaliação e hipóteses","fields":[
   {"id":"avaliacao_hipoteses","label":"Avaliação e hipóteses"}]},
 {"id":"conduta","title":"Conduta","fields":[
   {"id":"exames_solicitados","label":"Exames solicitados"},
   {"id":"medicacao_manipulados","label":"Medicação e manipulados"},
   {"id":"encaminhamentos","label":"Encaminhamentos (nutricionista, personal)"}]},
 {"id":"combinados","title":"Combinados com o paciente","fields":[
   {"id":"combinados","label":"O que cada um vai enviar e até quando"}]},
 {"id":"retorno","title":"Próximo retorno","fields":[
   {"id":"proximo_retorno","label":"Próximo retorno"}]}
]$json$::jsonb
where not exists (select 1 from public.clinical_templates where clinic_id is null and is_default);

-- ------------------------------------------------------------------ ledger nosso
insert into public.schema_migration_log (version, filename, description, session)
values ('20261113120000', '20261113120000_clinical_encounters.sql',
        'Consulta assistida parte 1: clinical_* (atendimento, pedaços de áudio, transcrição, prontuário, versões, adendos, envios), bucket privado clinical-audio, RPCs e RLS só equipe clínica (aditiva).',
        'CONSULTA-ASSISTIDA-1');
