-- =====================================================================================
-- AUTOMAÇÃO A1 — PRÉ-CONSULTA (Versão 1). Só objetos novos (tabelas, funções, 1 trigger, policies de storage novas).
--
--   1) pre_consulta_settings: por clínica, liga/desliga o envio automático ao marcar a consulta (nasce DESLIGADO) e guarda
--      as perguntas editadas (null = perguntas padrão do roteiro de anamnese, em private.pre_consulta_default_questions()).
--   2) pre_consultas: um pedido por consulta (índice único parcial = não duplica); guarda um RETRATO das perguntas do momento
--      do envio, as respostas, o status (enviada | rascunho | respondida | cancelada) e as datas.
--   3) pre_consulta_files: liga o pedido aos exames que o paciente enviou (os arquivos também viram linhas em patient_documents,
--      uploaded_by_role='patient', e por isso aparecem em Documentos da ficha).
--   4) RPCs do profissional: send_pre_consulta (manual) / cancel_pre_consulta / set_pre_consulta_settings (admin).
--      RPCs do paciente: save_pre_consulta_draft / submit_pre_consulta / attach_pre_consulta_file / remove_pre_consulta_file.
--   5) Trigger em appointments (AFTER INSERT/UPDATE/DELETE, nunca bloqueia a agenda): consulta marcada => pedido (se ligado);
--      consulta desmarcada/excluída => cancela o pedido ainda não respondido; horário mudou => atualiza a data do pedido.
--   6) storage.objects: o PACIENTE sobe/apaga só em <patient_id>/pre-consulta/... do bucket patient-documents (hoje só quem
--      prescreve sobe). Leitura continua pela policy existente (can_access_patient_internal).
--
-- Permissão (E9): respostas e exames só para quem tem acesso clínico ao paciente (profissional vinculado ou admin da clínica:
-- can_access_patient_internal) e para o próprio paciente. Recepção/Financeiro sem vínculo não leem. Paciente nunca escreve direto.
-- Sem cron: o envio nasce do trigger (e do botão). Resumo para a consulta: determinístico no app (modo demonstração).
--
-- Reversão: drop trigger trg_appointments_pre_consulta and trg_appointments_pre_consulta_del on public.appointments; drop das funções public/private *pre_consulta*;
-- drop table pre_consulta_files, pre_consultas, pre_consulta_settings; drop das 2 policies storage_pre_consulta_*.
-- =====================================================================================

-- ───────────────────────── Perguntas padrão (roteiro de anamnese da reunião)
create or replace function private.pre_consulta_default_questions()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('id','objetivo','label','Qual é o seu principal objetivo com o acompanhamento?','type','long'),
    jsonb_build_object('id','peso_atual','label','Quanto você pesa e mede hoje? (pode ser aproximado)','type','short'),
    jsonb_build_object('id','historico_peso','label','Como seu peso variou nos últimos anos? Teve fases de ganho ou perda?','type','long'),
    jsonb_build_object('id','rotina','label','Como é a sua rotina de trabalho e de sono? (horários e horas de sono por noite)','type','long'),
    jsonb_build_object('id','alimentacao','label','Como é a sua alimentação em um dia comum? Quantas refeições faz e em que horários?','type','long'),
    jsonb_build_object('id','alimentacao_emocional','label','Passa por períodos de pouca comida, exagero ou de comer por ansiedade ou emoção? Conte como acontece.','type','long'),
    jsonb_build_object('id','atividade','label','Que atividade física você pratica hoje e quantas vezes por semana?','type','short'),
    jsonb_build_object('id','saude','label','Tem alguma doença, cirurgia ou sintoma que a equipe deva saber? (ex.: gastrite, refluxo, pressão)','type','long'),
    jsonb_build_object('id','medicacoes','label','Usa medicamentos, suplementos ou hormônios? Quais e em que dose?','type','long'),
    jsonb_build_object('id','exames','label','Fez exames de sangue ou de imagem recentes? Se tiver, anexe nesta tela.','type','short'),
    jsonb_build_object('id','emocional','label','Como estão seu estresse, humor e ansiedade ultimamente?','type','long'),
    jsonb_build_object('id','duvidas','label','Tem mais alguma coisa que queira contar ou perguntar na consulta?','type','long')
  )
$$;

-- Valida a lista de perguntas (1 a 20; id minúsculo único; texto até 240; tipo short|long). Devolve a lista limpa.
create or replace function private.pre_consulta_clean_questions(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare q jsonb; out jsonb := '[]'::jsonb; v_id text; v_label text; v_type text; seen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 20 then
    raise exception 'pre_consulta: lista de perguntas inválida (1 a 20)' using errcode = '22023';
  end if;
  for q in select value from jsonb_array_elements(p) loop
    v_id := lower(btrim(coalesce(q->>'id','')));
    v_label := btrim(coalesce(q->>'label',''));
    v_type := coalesce(nullif(q->>'type',''), 'long');
    if v_id !~ '^[a-z0-9_]{1,40}$' or v_id = any(seen) then raise exception 'pre_consulta: id de pergunta inválido ou repetido' using errcode = '22023'; end if;
    if char_length(v_label) not between 3 and 240 then raise exception 'pre_consulta: texto da pergunta inválido' using errcode = '22023'; end if;
    if v_type not in ('short','long') then raise exception 'pre_consulta: tipo de pergunta inválido' using errcode = '22023'; end if;
    seen := seen || v_id;
    out := out || jsonb_build_array(jsonb_build_object('id', v_id, 'label', v_label, 'type', v_type));
  end loop;
  return out;
end $$;

-- ───────────────────────── 1) Configuração por clínica
create table if not exists public.pre_consulta_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  auto_send boolean not null default false,
  questions jsonb check (questions is null or jsonb_typeof(questions) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null
);
alter table public.pre_consulta_settings enable row level security;
revoke all on public.pre_consulta_settings from anon, authenticated;
grant select on public.pre_consulta_settings to authenticated;
drop policy if exists pre_consulta_settings_select on public.pre_consulta_settings;
create policy pre_consulta_settings_select on public.pre_consulta_settings for select to authenticated
  using ( private.is_clinic_admin(clinic_id)
          or exists (select 1 from public.professionals pr where pr.clinic_id = pre_consulta_settings.clinic_id
                       and pr.profile_id = private.current_profile_id()) );

-- ───────────────────────── 2) Pedidos de pré-consulta
create table if not exists public.pre_consultas (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  appointment_starts_at timestamptz,
  status text not null default 'enviada' check (status in ('enviada','rascunho','respondida','cancelada')),
  source text not null default 'manual' check (source in ('auto','manual')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  sent_at timestamptz not null default now(),
  sent_by_profile_id uuid references public.profiles(id) on delete set null,
  draft_saved_at timestamptz,
  answered_at timestamptz,
  canceled_at timestamptz
);
create unique index if not exists pre_consultas_one_per_appointment on public.pre_consultas (appointment_id)
  where appointment_id is not null and status <> 'cancelada';
create unique index if not exists pre_consultas_one_open_manual on public.pre_consultas (patient_id)
  where appointment_id is null and status in ('enviada','rascunho');
create index if not exists pre_consultas_patient_idx on public.pre_consultas (patient_id, sent_at desc);
create index if not exists pre_consultas_clinic_idx on public.pre_consultas (clinic_id, status);
alter table public.pre_consultas enable row level security;
revoke all on public.pre_consultas from anon, authenticated;
grant select on public.pre_consultas to authenticated;
drop policy if exists pre_consultas_select on public.pre_consultas;
create policy pre_consultas_select on public.pre_consultas for select to authenticated
  using ( private.can_access_patient_internal(patient_id)
          and (status <> 'cancelada' or not private.is_self_patient(patient_id)) );

create table if not exists public.pre_consulta_files (
  id uuid primary key default gen_random_uuid(),
  pre_consulta_id uuid not null references public.pre_consultas(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_id uuid not null unique references public.patient_documents(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists pre_consulta_files_pc_idx on public.pre_consulta_files (pre_consulta_id);
alter table public.pre_consulta_files enable row level security;
revoke all on public.pre_consulta_files from anon, authenticated;
grant select on public.pre_consulta_files to authenticated;
drop policy if exists pre_consulta_files_select on public.pre_consulta_files;
create policy pre_consulta_files_select on public.pre_consulta_files for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );

-- ───────────────────────── Núcleo: abrir pedido (usado pelo trigger e pelo botão). Não duplica.
create or replace function private.pre_consulta_open(p_patient uuid, p_appointment uuid, p_starts timestamptz, p_source text, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid := private.patient_clinic(p_patient); v_id uuid; v_q jsonb; v_when text;
begin
  if v_clinic is null then raise exception 'pre_consulta: patient not found' using errcode = 'P0002'; end if;
  if p_appointment is not null then
    select id into v_id from public.pre_consultas where appointment_id = p_appointment and status <> 'cancelada';
  else
    select id into v_id from public.pre_consultas where patient_id = p_patient and appointment_id is null and status in ('enviada','rascunho');
  end if;
  if v_id is not null then return jsonb_build_object('id', v_id, 'created', false); end if;
  select coalesce(s.questions, private.pre_consulta_default_questions()) into v_q from (select 1) x
    left join public.pre_consulta_settings s on s.clinic_id = v_clinic;
  begin
    insert into public.pre_consultas (clinic_id, patient_id, appointment_id, appointment_starts_at, source, questions, sent_by_profile_id)
    values (v_clinic, p_patient, p_appointment, p_starts, p_source, coalesce(v_q, private.pre_consulta_default_questions()), p_profile)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.pre_consultas
     where patient_id = p_patient and status <> 'cancelada' and appointment_id is not distinct from p_appointment
     order by sent_at desc limit 1;
    return jsonb_build_object('id', v_id, 'created', false);
  end;
  v_when := case when p_starts is null then null else to_char(p_starts at time zone 'America/Sao_Paulo', 'DD/MM') end;
  insert into public.notifications (patient_id, type, title, body)
  values (p_patient, 'professional',
          case when v_when is null then 'Pré-consulta' else 'Pré-consulta da sua consulta de ' || v_when end,
          'Responda a ficha rápida e envie seus exames antes da consulta. Está no Início do app.');
  return jsonb_build_object('id', v_id, 'created', true);
end $$;

-- ───────────────────────── Trigger da agenda (nunca derruba o salvamento da agenda)
create or replace function private.tg_appointments_pre_consulta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_auto boolean;
begin
  begin
    if tg_op = 'DELETE' then
      update public.pre_consultas set status = 'cancelada', canceled_at = now()
       where appointment_id = old.id and status in ('enviada','rascunho');
      return old;
    end if;
    select coalesce(s.auto_send, false) into v_auto from (select 1) x left join public.pre_consulta_settings s on s.clinic_id = new.clinic_id;
    if tg_op = 'INSERT' then
      if v_auto and new.type = 'consulta' and new.patient_id is not null and new.status <> 'desmarcado' and new.starts_at > now() then
        perform private.pre_consulta_open(new.patient_id, new.id, new.starts_at, 'auto', null);
      end if;
    else
      if new.status = 'desmarcado' or new.type <> 'consulta' or new.patient_id is distinct from old.patient_id then
        update public.pre_consultas set status = 'cancelada', canceled_at = now()
         where appointment_id = new.id and status in ('enviada','rascunho');
      elsif new.starts_at is distinct from old.starts_at then
        update public.pre_consultas set appointment_starts_at = new.starts_at where appointment_id = new.id and status <> 'cancelada';
      end if;
      if v_auto and new.type = 'consulta' and new.patient_id is not null and new.status <> 'desmarcado' and new.starts_at > now()
         and (old.status = 'desmarcado' or old.type <> 'consulta' or old.patient_id is distinct from new.patient_id) then
        perform private.pre_consulta_open(new.patient_id, new.id, new.starts_at, 'auto', null);
      end if;
    end if;
  exception when others then
    raise warning 'pre_consulta trigger ignorado: %', sqlerrm;
  end;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_appointments_pre_consulta on public.appointments;
create trigger trg_appointments_pre_consulta after insert or update on public.appointments
  for each row execute function private.tg_appointments_pre_consulta();
-- DELETE roda ANTES (a FK on delete set null apagaria o vínculo antes de o trigger achar o pedido).
drop trigger if exists trg_appointments_pre_consulta_del on public.appointments;
create trigger trg_appointments_pre_consulta_del before delete on public.appointments
  for each row execute function private.tg_appointments_pre_consulta();

-- ───────────────────────── RPCs do profissional
create or replace function public.send_pre_consulta(p_patient_id uuid, p_appointment_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_appt uuid := p_appointment_id; v_starts timestamptz; v_res jsonb;
begin
  if private.current_profile_id() is null then raise exception 'send_pre_consulta: not authenticated' using errcode = '42501'; end if;
  if not private.can_prescribe_for_patient(p_patient_id) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  if v_appt is not null then
    select starts_at into v_starts from public.appointments
     where id = v_appt and patient_id = p_patient_id and clinic_id = private.patient_clinic(p_patient_id) and status <> 'desmarcado';
    if v_starts is null then raise exception 'send_pre_consulta: appointment not found for patient' using errcode = 'P0002'; end if;
  else
    select id, starts_at into v_appt, v_starts from public.appointments
     where patient_id = p_patient_id and clinic_id = private.patient_clinic(p_patient_id) and type = 'consulta'
       and status <> 'desmarcado' and starts_at > now()
     order by starts_at limit 1;
  end if;
  v_res := private.pre_consulta_open(p_patient_id, v_appt, v_starts, 'manual', private.current_profile_id());
  return v_res || jsonb_build_object('appointment_id', v_appt, 'appointment_starts_at', v_starts);
end $$;

create or replace function public.cancel_pre_consulta(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.pre_consultas where id = p_id;
  if v_patient is null then raise exception 'cancel_pre_consulta: not found' using errcode = 'P0002'; end if;
  if not private.can_prescribe_for_patient(v_patient) then raise exception 'forbidden: clinical access required' using errcode = '42501'; end if;
  update public.pre_consultas set status = 'cancelada', canceled_at = now() where id = p_id and status in ('enviada','rascunho');
end $$;

create or replace function public.set_pre_consulta_settings(p_clinic_id uuid, p_auto_send boolean, p_questions jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_q jsonb;
begin
  if private.current_profile_id() is null then raise exception 'set_pre_consulta_settings: not authenticated' using errcode = '42501'; end if;
  if not private.is_clinic_admin(p_clinic_id) then raise exception 'forbidden: clinic admin required' using errcode = '42501'; end if;
  v_q := case when p_questions is null or p_questions = 'null'::jsonb then null else private.pre_consulta_clean_questions(p_questions) end;
  insert into public.pre_consulta_settings (clinic_id, auto_send, questions, updated_by_profile_id)
  values (p_clinic_id, coalesce(p_auto_send, false), v_q, private.current_profile_id())
  on conflict (clinic_id) do update set auto_send = excluded.auto_send, questions = excluded.questions,
    updated_at = now(), updated_by_profile_id = excluded.updated_by_profile_id;
end $$;

-- ───────────────────────── RPCs do paciente
create or replace function private.pre_consulta_clean_answers(p_questions jsonb, p_answers jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare out jsonb := '{}'::jsonb; q jsonb; v text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'pre_consulta: respostas inválidas' using errcode = '22023'; end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    v := btrim(coalesce(p_answers->>(q->>'id'), ''));
    if v <> '' then
      if char_length(v) > 2000 then raise exception 'pre_consulta: resposta longa demais' using errcode = '22023'; end if;
      out := out || jsonb_build_object(q->>'id', v);
    end if;
  end loop;
  return out;
end $$;

create or replace function public.save_pre_consulta_draft(p_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.pre_consultas%rowtype;
begin
  select * into r from public.pre_consultas where id = p_id;
  if r.id is null or not private.is_self_patient(r.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.status not in ('enviada','rascunho') then raise exception 'pre_consulta: pedido já respondido ou cancelado' using errcode = '22023'; end if;
  update public.pre_consultas set answers = private.pre_consulta_clean_answers(r.questions, p_answers), status = 'rascunho', draft_saved_at = now() where id = p_id;
end $$;

create or replace function public.submit_pre_consulta(p_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.pre_consultas%rowtype; v_ans jsonb; v_files int;
begin
  select * into r from public.pre_consultas where id = p_id for update;
  if r.id is null or not private.is_self_patient(r.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.status not in ('enviada','rascunho') then raise exception 'pre_consulta: pedido já respondido ou cancelado' using errcode = '22023'; end if;
  v_ans := private.pre_consulta_clean_answers(r.questions, p_answers);
  select count(*) into v_files from public.pre_consulta_files where pre_consulta_id = p_id;
  if v_ans = '{}'::jsonb and v_files = 0 then raise exception 'pre_consulta: responda ao menos uma pergunta ou anexe um exame' using errcode = '22023'; end if;
  update public.pre_consultas set answers = v_ans, status = 'respondida', answered_at = now() where id = p_id;
end $$;

create or replace function public.attach_pre_consulta_file(p_id uuid, p_path text, p_name text, p_mime text, p_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.pre_consultas%rowtype; v_doc uuid; v_n int; v_title text := left(nullif(btrim(coalesce(p_name,'')), ''), 120);
begin
  select * into r from public.pre_consultas where id = p_id for update;
  if r.id is null or not private.is_self_patient(r.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.status not in ('enviada','rascunho') then raise exception 'pre_consulta: pedido já respondido ou cancelado' using errcode = '22023'; end if;
  if p_path is null or p_path not like (r.patient_id::text || '/pre-consulta/%') or p_path like '%..%' or char_length(p_path) > 300 then
    raise exception 'pre_consulta: caminho de arquivo inválido' using errcode = '22023';
  end if;
  if p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') then raise exception 'pre_consulta: tipo de arquivo não aceito' using errcode = '22023'; end if;
  if p_size is null or p_size <= 0 or p_size > 15 * 1024 * 1024 then raise exception 'pre_consulta: arquivo grande demais (máx. 15 MB)' using errcode = '22023'; end if;
  select count(*) into v_n from public.pre_consulta_files where pre_consulta_id = p_id;
  if v_n >= 10 then raise exception 'pre_consulta: no máximo 10 arquivos' using errcode = '22023'; end if;
  insert into public.patient_documents (patient_id, uploaded_by_role, kind, title, file_path, mime_type, file_size_bytes)
  values (r.patient_id, 'patient', 'exam', coalesce(v_title, 'Exame da pré-consulta'), p_path, p_mime, p_size)
  returning id into v_doc;
  insert into public.pre_consulta_files (pre_consulta_id, patient_id, document_id) values (p_id, r.patient_id, v_doc);
  return v_doc;
end $$;

-- Devolve o caminho do objeto para o app apagar do storage (o paciente só apaga em <patient_id>/pre-consulta/).
create or replace function public.remove_pre_consulta_file(p_document_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare f public.pre_consulta_files%rowtype; v_status text; v_path text;
begin
  select * into f from public.pre_consulta_files where document_id = p_document_id;
  if f.id is null or not private.is_self_patient(f.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select status into v_status from public.pre_consultas where id = f.pre_consulta_id;
  if v_status not in ('enviada','rascunho') then raise exception 'pre_consulta: pedido já respondido ou cancelado' using errcode = '22023'; end if;
  select file_path into v_path from public.patient_documents where id = p_document_id;
  delete from public.patient_documents where id = p_document_id;
  return v_path;
end $$;

revoke all on function private.pre_consulta_open(uuid, uuid, timestamptz, text, uuid), private.tg_appointments_pre_consulta(),
  private.pre_consulta_default_questions(), private.pre_consulta_clean_questions(jsonb), private.pre_consulta_clean_answers(jsonb, jsonb) from public, anon;
grant execute on function private.pre_consulta_default_questions() to authenticated;
revoke all on function public.send_pre_consulta(uuid, uuid), public.cancel_pre_consulta(uuid), public.set_pre_consulta_settings(uuid, boolean, jsonb),
  public.save_pre_consulta_draft(uuid, jsonb), public.submit_pre_consulta(uuid, jsonb),
  public.attach_pre_consulta_file(uuid, text, text, text, bigint), public.remove_pre_consulta_file(uuid) from public, anon;
grant execute on function public.send_pre_consulta(uuid, uuid), public.cancel_pre_consulta(uuid), public.set_pre_consulta_settings(uuid, boolean, jsonb),
  public.save_pre_consulta_draft(uuid, jsonb), public.submit_pre_consulta(uuid, jsonb),
  public.attach_pre_consulta_file(uuid, text, text, text, bigint), public.remove_pre_consulta_file(uuid) to authenticated;

-- ───────────────────────── 6) Storage: o paciente sobe/apaga só na própria pasta de pré-consulta
drop policy if exists storage_pre_consulta_insert_self on storage.objects;
create policy storage_pre_consulta_insert_self on storage.objects for insert to authenticated
  with check ( bucket_id = 'patient-documents'
               and private.is_self_patient(private.storage_object_patient(name))
               and split_part(name, '/', 2) = 'pre-consulta' and name not like '%..%' );
drop policy if exists storage_pre_consulta_delete_self on storage.objects;
create policy storage_pre_consulta_delete_self on storage.objects for delete to authenticated
  using ( bucket_id = 'patient-documents'
          and private.is_self_patient(private.storage_object_patient(name))
          and split_part(name, '/', 2) = 'pre-consulta' );

insert into public.schema_migration_log (version, filename, description, session)
values ('20261124100000','20261124100000_auto_a1_pre_consulta.sql',
  'Automação A1 Pré-consulta (V1): pre_consulta_settings (liga/desliga + perguntas por clínica, nasce desligado), pre_consultas (um por consulta, '
  'retrato das perguntas, respostas, status), pre_consulta_files (exames -> patient_documents), RPCs send/cancel/settings (profissional) e '
  'save_draft/submit/attach/remove (paciente), trigger em appointments (cria/cancela/atualiza sem bloquear a agenda), policies de storage do paciente '
  'em <patient_id>/pre-consulta/. So objetos novos; resposta so para acesso clinico (nao Recepcao) e o proprio paciente.',
  'AUTO-A1')
on conflict (version) do nothing;
