-- =====================================================================================
-- FIN-E9 — Documentos clínicos (receita · atestado · exames · relatório) com provedor em MODO DEMONSTRAÇÃO. 100% ADITIVA:
-- só CRIA objetos novos (tabelas clinical_documents, clinical_document_marks, clinical_document_sessions; funções private.doc_* e
-- public.doc_*; 1 coluna nova com padrão em fin_settings) e RECRIA fin_my_access (corpo da E8 + 5 chaves doc_*). Nada existente é removido.
--
-- A Vertexa NÃO é motor de prescrição (escopo-v1 §10): integra um provedor. Aqui tudo roda com o adaptador 'demo' (diálogo da própria Vertexa,
-- documento SEM validade legal, marcado is_demo). O caminho do provedor real já existe: sessão aberta pela Vertexa (doc_open_session) →
-- provedor assina → webhook chama doc_ingest_signed (só service_role, idempotente por external_id). Trocar o provedor = configurar (doc_set_provider) +
-- deixar private.doc_provider_ready devolver true para ele + publicar a edge function prescription-webhook. Ver docs/financeiro-estoque/entrega-9.md.
--
-- Modelo de acesso (escopo-v1 §10.3.5 e §3):
--   clinical = Owner/Admin ou profissional clínico (private.appt_is_pro): vê conteúdo dos pacientes a que tem acesso (private.can_access_patient);
--   front    = Recepção: vê a LISTA (sem conteúdo) de toda a clínica e pode REENVIAR documento assinado (baixa/abre o PDF; o reenvio vai ao log);
--   none     = Financeiro, Estoquista, Gestor sem vínculo clínico e todo o resto: não veem documento nenhum.
--   EMITIR: só profissional ativo com conselho/registro cadastrado (professionals.registry_number); Owner/Admin sem registro vê, não emite.
-- Documento assinado é IMUTÁVEL (gatilho bloqueia update/delete/truncate); invalidar = marca em tabela própria com motivo, nada é apagado.
-- Sem INSERT/UPDATE/DELETE direto para anon/authenticated; escrita só por RPC security definer (search_path vazio). Log em fin_audit_log
-- (entity 'clinical_document'; sem conteúdo clínico no log): sign→create, resend→update, view→view_sensitive, invalidate→deactivate.
-- =====================================================================================

-- ---------- 1. Configuração por clínica do provedor ('demo' por padrão; sem chave nem segredo no banco) ----------
alter table public.fin_settings add column if not exists doc_provider text not null default 'demo' check (doc_provider in ('demo','memed','nexodata'));

-- ---------- 2. Tabelas ----------
create table if not exists public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  encounter_id uuid references public.clinical_encounters(id) on delete restrict,
  appointment_id uuid references public.fin_appointments(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  doc_type text not null check (doc_type in ('receita','atestado','exames','relatorio')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content text not null default '' check (char_length(content) <= 20000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50),
  provider text not null check (provider in ('demo','memed','nexodata')),
  external_id text check (external_id is null or char_length(external_id) between 1 and 120),
  is_demo boolean not null,
  sncr_number text check (sncr_number is null or char_length(sncr_number) <= 60),
  provider_pdf_path text check (provider_pdf_path is null or char_length(provider_pdf_path) <= 300),
  signed_at timestamptz not null,
  patient_snapshot jsonb not null,
  professional_snapshot jsonb not null,
  clinic_name text not null,
  content_hash text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (is_demo = (provider = 'demo')),
  check (not is_demo or sncr_number is null)
);
create unique index if not exists clinical_documents_external_uq on public.clinical_documents (clinic_id, provider, external_id) where external_id is not null;
create index if not exists clinical_documents_clinic_idx on public.clinical_documents (clinic_id, signed_at desc);
create index if not exists clinical_documents_patient_idx on public.clinical_documents (patient_id, signed_at desc);
create index if not exists clinical_documents_encounter_idx on public.clinical_documents (encounter_id) where encounter_id is not null;
create index if not exists clinical_documents_appt_idx on public.clinical_documents (appointment_id) where appointment_id is not null;

create table if not exists public.clinical_document_marks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.clinical_documents(id) on delete restrict,
  clinic_id uuid not null,
  kind text not null check (kind in ('invalidated')),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  by_profile_id uuid,
  at timestamptz not null default now(),
  unique (document_id, kind)
);

-- Sessão com o provedor: nasce na Vertexa (quem pode emitir, para qual paciente/atendimento) e é o elo que o provedor devolve no webhook.
create table if not exists public.clinical_document_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  encounter_id uuid references public.clinical_encounters(id) on delete set null,
  appointment_id uuid references public.fin_appointments(id) on delete set null,
  doc_type text not null check (doc_type in ('receita','atestado','exames','relatorio')),
  provider text not null check (provider in ('demo','memed','nexodata')),
  status text not null default 'open' check (status in ('open','signed')),
  document_id uuid references public.clinical_documents(id) on delete restrict,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists clinical_document_sessions_clinic_idx on public.clinical_document_sessions (clinic_id, opened_at desc);

-- ---------- 3. Imutabilidade ----------
create or replace function private.doc_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'DOCUMENT_IMMUTABLE: documento assinado não se altera nem se apaga; para invalidar use a marca com motivo' using errcode = '55000';
end $$;

drop trigger if exists clinical_documents_immutable on public.clinical_documents;
create trigger clinical_documents_immutable before update or delete on public.clinical_documents for each row execute function private.doc_immutable();
drop trigger if exists clinical_documents_no_truncate on public.clinical_documents;
create trigger clinical_documents_no_truncate before truncate on public.clinical_documents for each statement execute function private.doc_immutable();
drop trigger if exists clinical_document_marks_immutable on public.clinical_document_marks;
create trigger clinical_document_marks_immutable before update or delete on public.clinical_document_marks for each row execute function private.doc_immutable();
drop trigger if exists clinical_document_marks_no_truncate on public.clinical_document_marks;
create trigger clinical_document_marks_no_truncate before truncate on public.clinical_document_marks for each statement execute function private.doc_immutable();

-- ---------- 4. Helpers de acesso ----------
-- Profissional clínico: a definição da E4 (private.appt_is_pro) E, quando o cadastro é do tipo 'other' (Gestor e afins), só se tiver conselho/registro cadastrado.
create or replace function private.doc_is_clinician(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.appt_is_pro(p_clinic) and exists (
    select 1 from public.professionals pr
     where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'
       and (pr.type is distinct from 'other' or char_length(btrim(coalesce(pr.registry_number, ''))) >= 3))
$$;

-- 'clinical' | 'front' | 'none'
create or replace function private.doc_kind(p_clinic uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_clinic is null or not private.is_clinic_member(p_clinic) then 'none'
    when private.is_clinic_admin(p_clinic) or private.doc_is_clinician(p_clinic) then 'clinical'
    when private.fin_has_role(p_clinic, array['recepcao']) then 'front'
    else 'none' end
$$;

-- Profissional (professionals.id) do chamador COM conselho/registro; nulo se não for profissional ativo ou se faltar o registro.
create or replace function private.doc_emitter(p_clinic uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pr.id from public.professionals pr
   where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'
     and char_length(btrim(coalesce(pr.registry_number, ''))) >= 3
     and private.doc_kind(p_clinic) = 'clinical'
   order by pr.id limit 1
$$;

create or replace function private.doc_can_content(p_clinic uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.doc_kind(p_clinic) = 'clinical' and private.patient_clinic(p_patient) = p_clinic and private.can_access_patient(p_patient)
$$;

-- provedores que a Vertexa já sabe operar; o real entra aqui (e na edge function) quando for escolhido (pendência P1).
create or replace function private.doc_provider_ready(p_provider text) returns boolean
language sql immutable set search_path = '' as $$ select p_provider = 'demo' $$;

create or replace function private.doc_provider(p_clinic uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.doc_provider from public.fin_settings s where s.clinic_id = p_clinic), 'demo')
$$;

create or replace function private.doc_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g'))
$$;

-- Itens prescritos: valida a forma. Receita exige medicamento, dose, posologia e quantidade em cada item; exames aceita só o nome; atestado e relatório não têm itens.
create or replace function private.doc_check_items(p_type text, p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare e jsonb; k text; v jsonb := '[]'::jsonb; lim jsonb := '{"name":160,"dose":80,"posology":200,"quantity":40}'::jsonb; t text;
begin
  p_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then raise exception 'ITEMS_INVALID' using errcode = '22023'; end if;
  if p_type in ('atestado','relatorio') then
    if jsonb_array_length(p_items) > 0 then raise exception 'ITEMS_NOT_ALLOWED' using errcode = '22023'; end if;
    return '[]'::jsonb;
  end if;
  if p_type = 'receita' and jsonb_array_length(p_items) = 0 then raise exception 'ITEMS_REQUIRED' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'ITEMS_INVALID' using errcode = '22023'; end if;
    for k in select key from jsonb_each(e) loop
      if k not in ('name','dose','posology','quantity') then raise exception 'ITEMS_INVALID' using errcode = '22023'; end if;
    end loop;
    for k in select * from jsonb_object_keys(lim) loop
      t := btrim(coalesce(e->>k, ''));
      if jsonb_typeof(e->k) not in ('string') and e ? k and jsonb_typeof(e->k) <> 'null' then raise exception 'ITEMS_INVALID' using errcode = '22023'; end if;
      if char_length(t) > (lim->>k)::int then raise exception 'ITEMS_INVALID' using errcode = '22023'; end if;
      if p_type = 'receita' and t = '' then raise exception 'ITEMS_INCOMPLETE' using errcode = '22023'; end if;
    end loop;
    if btrim(coalesce(e->>'name', '')) = '' then raise exception 'ITEMS_INCOMPLETE' using errcode = '22023'; end if;
    v := v || jsonb_build_array(jsonb_build_object('name', btrim(e->>'name'), 'dose', btrim(coalesce(e->>'dose', '')),
                                                     'posology', btrim(coalesce(e->>'posology', '')), 'quantity', btrim(coalesce(e->>'quantity', ''))));
  end loop;
  return v;
end $$;

-- Linha pública do documento (sem conteúdo): o que a lista e a Recepção enxergam.
create or replace function private.doc_row(d public.clinical_documents, p_with_reason boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'clinic_id', d.clinic_id, 'patient_id', d.patient_id, 'patient_name', d.patient_snapshot->>'name',
    'encounter_id', d.encounter_id, 'appointment_id', d.appointment_id, 'doc_type', d.doc_type, 'title', d.title,
    'signed_at', d.signed_at, 'professional_name', d.professional_snapshot->>'name', 'professional_registry', d.professional_snapshot->>'registry_number',
    'provider', d.provider, 'is_demo', d.is_demo, 'sncr_number', d.sncr_number, 'item_count', jsonb_array_length(d.items),
    'invalidated', m.id is not null, 'invalidated_at', m.at, 'invalidated_reason', case when p_with_reason then m.reason end,
    'resend_count', (select count(*) from public.fin_audit_log a where a.clinic_id = d.clinic_id and a.entity = 'clinical_document' and a.entity_id = d.id and a.after->>'event' = 'resend'))
  from (select 1) x left join public.clinical_document_marks m on m.document_id = d.id and m.kind = 'invalidated'
$$;

-- ---------- 5. Linha comum de gravação (demo e provedor real) ----------
create or replace function private.doc_insert(p_session public.clinical_document_sessions, p_external text, p_title text, p_content text, p_items jsonb,
                                              p_signed_at timestamptz, p_sncr text, p_pdf text, p_patient_extra jsonb, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pat jsonb; v_pro jsonb; v_clinic text; v_items jsonb; v_cpf text; v_addr text; v_content text := coalesce(p_content, '');
begin
  v_items := private.doc_check_items(p_session.doc_type, p_items);
  if p_session.doc_type <> 'receita' and char_length(btrim(v_content)) < 3 then raise exception 'CONTENT_REQUIRED' using errcode = '22023'; end if;
  if p_session.doc_type = 'receita' and char_length(btrim(v_content)) = 0 and jsonb_array_length(v_items) = 0 then raise exception 'CONTENT_REQUIRED' using errcode = '22023'; end if;
  if char_length(v_content) > 20000 then raise exception 'CONTENT_TOO_LONG' using errcode = '22023'; end if;
  v_cpf := nullif(regexp_replace(coalesce(p_patient_extra->>'cpf', ''), '\D', '', 'g'), '');
  if v_cpf is not null and (char_length(v_cpf) <> 11 or not private.fin_valid_tax_id(v_cpf)) then raise exception 'CPF_INVALID' using errcode = '22023'; end if;
  v_addr := nullif(btrim(coalesce(p_patient_extra->>'address', '')), '');
  if char_length(coalesce(v_addr, '')) > 240 then raise exception 'ADDRESS_TOO_LONG' using errcode = '22023'; end if;
  select jsonb_build_object('name', pf.full_name, 'birth_date', pt.birth_date, 'cpf', v_cpf, 'address', v_addr) into v_pat
    from public.patients pt join public.profiles pf on pf.id = pt.profile_id where pt.id = p_session.patient_id;
  select jsonb_build_object('name', pf.full_name, 'registry_number', pr.registry_number, 'specialty', pr.specialty, 'type', pr.type) into v_pro
    from public.professionals pr join public.profiles pf on pf.id = pr.profile_id where pr.id = p_session.professional_id;
  select c.name into v_clinic from public.clinics c where c.id = p_session.clinic_id;
  if v_pat is null or v_pro is null or v_clinic is null then raise exception 'SESSION_INVALID' using errcode = '22023'; end if;
  insert into public.clinical_documents (clinic_id, patient_id, encounter_id, appointment_id, professional_id, doc_type, title, content, items, provider, external_id,
                                         is_demo, sncr_number, provider_pdf_path, signed_at, patient_snapshot, professional_snapshot, clinic_name, content_hash, created_by)
  values (p_session.clinic_id, p_session.patient_id, p_session.encounter_id, p_session.appointment_id, p_session.professional_id, p_session.doc_type,
          btrim(p_title), v_content, v_items, p_session.provider, p_external, p_session.provider = 'demo', p_sncr, p_pdf, p_signed_at, v_pat, v_pro, v_clinic,
          encode(sha256(convert_to(p_session.doc_type || '|' || btrim(p_title) || '|' || v_content || '|' || v_items::text || '|' || p_signed_at::text, 'UTF8')), 'hex'), p_user)
  returning id into v_id;
  update public.clinical_document_sessions set status = 'signed', document_id = v_id where id = p_session.id;
  perform private.fin_log(p_session.clinic_id, null, 'clinical_document', v_id, 'create', null,
    jsonb_build_object('doc_type', p_session.doc_type, 'provider', p_session.provider, 'is_demo', p_session.provider = 'demo', 'patient_id', p_session.patient_id,
                       'encounter_id', p_session.encounter_id, 'appointment_id', p_session.appointment_id), null);
  insert into public.activity_events (patient_id, type, payload)
  values (p_session.patient_id, 'document_signed', jsonb_build_object('document_id', v_id, 'doc_type', p_session.doc_type, 'is_demo', p_session.provider = 'demo'));
  return v_id;
end $$;

-- ---------- 6. RPCs ----------
create or replace function public.doc_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := private.doc_kind(p_clinic); v_prov text; v_emit uuid; v_pro boolean;
begin
  if v_kind = 'none' then
    return jsonb_build_object('kind', 'none', 'can_emit', false, 'can_list', false, 'can_content', false, 'can_resend', false, 'registry_missing', false,
                              'provider', null, 'provider_ready', false, 'is_demo', false);
  end if;
  v_prov := private.doc_provider(p_clinic); v_emit := private.doc_emitter(p_clinic);
  select exists (select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active') into v_pro;
  return jsonb_build_object('kind', v_kind, 'can_emit', v_emit is not null and private.doc_provider_ready(v_prov), 'can_list', true, 'can_content', v_kind = 'clinical',
    'can_resend', true, 'registry_missing', v_kind = 'clinical' and v_pro and v_emit is null, 'provider', v_prov, 'provider_ready', private.doc_provider_ready(v_prov), 'is_demo', v_prov = 'demo');
end $$;

create or replace function public.doc_set_provider(p_clinic uuid, p_provider text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform private.fin_gate(p_clinic, 'settings', null, true);
  if p_provider is null or p_provider not in ('demo','memed','nexodata') then raise exception 'PROVIDER_INVALID' using errcode = '22023'; end if;
  if not private.doc_provider_ready(p_provider) then raise exception 'PROVIDER_NOT_AVAILABLE' using errcode = '22023'; end if;
  v_old := private.doc_provider(p_clinic);
  insert into public.fin_settings (clinic_id, doc_provider) values (p_clinic, p_provider)
    on conflict (clinic_id) do update set doc_provider = excluded.doc_provider, updated_at = now();
  if v_old is distinct from p_provider then
    perform private.fin_log(p_clinic, null, 'doc_provider', p_clinic, 'update', jsonb_build_object('provider', v_old), jsonb_build_object('provider', p_provider), p_reason);
  end if;
end $$;

-- Abre a sessão com o provedor já com paciente, profissional e clínica preenchidos.
create or replace function public.doc_open_session(p_clinic uuid, p_patient uuid, p_type text, p_encounter uuid default null, p_appointment uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pro uuid; v_prov text := private.doc_provider(p_clinic); s public.clinical_document_sessions; v_pat jsonb; v_prof jsonb; v_clinic text;
begin
  if private.doc_kind(p_clinic) <> 'clinical' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_type is null or p_type not in ('receita','atestado','exames','relatorio') then raise exception 'TYPE_INVALID' using errcode = '22023'; end if;
  v_pro := private.doc_emitter(p_clinic);
  if v_pro is null then raise exception 'REGISTRY_REQUIRED' using errcode = '42501'; end if;
  if not private.doc_can_content(p_clinic, p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not private.doc_provider_ready(v_prov) then raise exception 'PROVIDER_NOT_AVAILABLE' using errcode = '22023'; end if;
  if p_encounter is not null and not exists (select 1 from public.clinical_encounters e where e.id = p_encounter and e.clinic_id = p_clinic and e.patient_id = p_patient) then
    raise exception 'ENCOUNTER_INVALID' using errcode = '22023'; end if;
  if p_appointment is not null and not exists (select 1 from public.fin_appointments a where a.id = p_appointment and a.clinic_id = p_clinic and a.patient_id = p_patient) then
    raise exception 'APPOINTMENT_INVALID' using errcode = '22023'; end if;
  insert into public.clinical_document_sessions (clinic_id, patient_id, professional_id, encounter_id, appointment_id, doc_type, provider, opened_by)
  values (p_clinic, p_patient, v_pro, p_encounter, p_appointment, p_type, v_prov, private.current_profile_id()) returning * into s;
  select jsonb_build_object('name', pf.full_name, 'birth_date', pt.birth_date, 'cpf', null, 'address', null) into v_pat
    from public.patients pt join public.profiles pf on pf.id = pt.profile_id where pt.id = p_patient;
  select jsonb_build_object('id', pr.id, 'name', pf.full_name, 'registry_number', pr.registry_number, 'specialty', pr.specialty) into v_prof
    from public.professionals pr join public.profiles pf on pf.id = pr.profile_id where pr.id = v_pro;
  select c.name into v_clinic from public.clinics c where c.id = p_clinic;
  return jsonb_build_object('session_id', s.id, 'provider', s.provider, 'is_demo', s.provider = 'demo', 'doc_type', s.doc_type, 'expires_at', s.expires_at,
    'patient', v_pat, 'professional', v_prof, 'clinic', jsonb_build_object('id', p_clinic, 'name', v_clinic),
    'encounter_id', s.encounter_id, 'appointment_id', s.appointment_id);
end $$;

-- Assinatura do adaptador DEMONSTRAÇÃO. Idempotente: repetir a chamada com a mesma sessão devolve o mesmo documento.
create or replace function public.doc_sign_demo(p_session uuid, p_title text, p_content text, p_items jsonb default '[]'::jsonb, p_patient_extra jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.clinical_document_sessions; v_id uuid; v_pro uuid;
begin
  select * into s from public.clinical_document_sessions where id = p_session for update;
  if not found or s.opened_by is distinct from private.current_profile_id() then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.provider <> 'demo' then raise exception 'SESSION_INVALID' using errcode = '22023'; end if;
  if s.status = 'signed' then return jsonb_build_object('document_id', s.document_id, 'already', true); end if;
  if s.expires_at < now() then raise exception 'SESSION_EXPIRED' using errcode = '22023'; end if;
  -- revalida na hora de assinar (registro pode ter sido removido, acesso ao paciente revogado)
  v_pro := private.doc_emitter(s.clinic_id);
  if v_pro is null or v_pro <> s.professional_id then raise exception 'REGISTRY_REQUIRED' using errcode = '42501'; end if;
  if not private.doc_can_content(s.clinic_id, s.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_title is null or char_length(btrim(p_title)) = 0 then raise exception 'TITLE_REQUIRED' using errcode = '22023'; end if;
  v_id := private.doc_insert(s, 'demo-' || s.id::text, p_title, p_content, p_items, now(), null, null, coalesce(p_patient_extra, '{}'::jsonb), private.current_profile_id());
  return jsonb_build_object('document_id', v_id, 'already', false);
end $$;

-- Webhook do provedor REAL (só service_role). Idempotente por (clínica, provedor, id externo); sessão já assinada devolve o mesmo documento.
create or replace function public.doc_ingest_signed(p_session uuid, p_provider text, p_external_id text, p_title text, p_content text, p_items jsonb,
                                                    p_signed_at timestamptz, p_sncr text default null, p_pdf_path text default null, p_patient_extra jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.clinical_document_sessions; v_id uuid;
begin
  if p_provider is null or p_provider = 'demo' or p_provider not in ('memed','nexodata') then raise exception 'PROVIDER_INVALID' using errcode = '22023'; end if;
  if p_external_id is null or char_length(btrim(p_external_id)) = 0 then raise exception 'EXTERNAL_ID_REQUIRED' using errcode = '22023'; end if;
  select * into s from public.clinical_document_sessions where id = p_session for update;
  if not found or s.provider <> p_provider then raise exception 'SESSION_INVALID' using errcode = '22023'; end if;
  select d.id into v_id from public.clinical_documents d where d.clinic_id = s.clinic_id and d.provider = p_provider and d.external_id = p_external_id;
  if v_id is not null then return jsonb_build_object('document_id', v_id, 'duplicate', true); end if;
  if s.status = 'signed' then return jsonb_build_object('document_id', s.document_id, 'duplicate', true); end if;
  v_id := private.doc_insert(s, btrim(p_external_id), coalesce(nullif(btrim(p_title), ''), 'Documento'), p_content, p_items, coalesce(p_signed_at, now()),
                             nullif(btrim(coalesce(p_sncr, '')), ''), p_pdf_path, coalesce(p_patient_extra, '{}'::jsonb), null);
  return jsonb_build_object('document_id', v_id, 'duplicate', false);
end $$;

-- Lista (sem conteúdo). Paciente informado, atendimento (clínico) ou agenda do financeiro; sem filtro = documentos da clínica a que o chamador tem acesso.
create or replace function public.doc_list(p_clinic uuid, p_patient uuid default null, p_encounter uuid default null, p_appointment uuid default null,
                                           p_limit integer default 100, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := private.doc_kind(p_clinic); v_out jsonb;
begin
  if v_kind = 'none' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_patient is not null and v_kind = 'clinical' and not private.doc_can_content(p_clinic, p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r.j order by r.signed_at desc, r.id), '[]'::jsonb) into v_out from (
    select d.signed_at, d.id, private.doc_row(d, v_kind = 'clinical') as j
      from public.clinical_documents d
     where d.clinic_id = p_clinic
       and (p_patient is null or d.patient_id = p_patient)
       and (p_encounter is null or d.encounter_id = p_encounter)
       and (p_appointment is null or d.appointment_id = p_appointment)
       and (v_kind = 'front' or private.can_access_patient(d.patient_id))
     order by d.signed_at desc, d.id
     limit least(greatest(coalesce(p_limit, 100), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r;
  return v_out;
end $$;

-- Documento completo (conteúdo, itens, dados do momento da assinatura). Só quem tem acesso clínico ao paciente; cada abertura vai ao log.
create or replace function public.doc_get(p_doc uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.clinical_documents; v jsonb;
begin
  select * into d from public.clinical_documents where id = p_doc;
  if not found or not private.doc_can_content(d.clinic_id, d.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.fin_log(d.clinic_id, null, 'clinical_document', d.id, 'view_sensitive', null, jsonb_build_object('event', 'view'), null);
  v := private.doc_row(d, true) || jsonb_build_object('content', d.content, 'items', d.items, 'patient', d.patient_snapshot, 'professional', d.professional_snapshot,
                                                       'clinic_name', d.clinic_name, 'content_hash', d.content_hash);
  return v;
end $$;

-- Reenviar (Recepção e clínico): devolve o documento para baixar/abrir o PDF e REGISTRA o reenvio. NÃO dispara WhatsApp nem e-mail (modo demonstração).
create or replace function public.doc_resend(p_doc uuid, p_channel text default 'download') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.clinical_documents; v_kind text; v jsonb;
begin
  select * into d from public.clinical_documents where id = p_doc;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  v_kind := private.doc_kind(d.clinic_id);
  if v_kind = 'none' or (v_kind = 'clinical' and not private.doc_can_content(d.clinic_id, d.patient_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_kind = 'front' and private.patient_clinic(d.patient_id) <> d.clinic_id then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from public.clinical_document_marks m where m.document_id = d.id) then raise exception 'DOCUMENT_INVALIDATED' using errcode = '22023'; end if;
  perform private.fin_log(d.clinic_id, null, 'clinical_document', d.id, 'update', null,
    jsonb_build_object('event', 'resend', 'channel', case when p_channel in ('download','whatsapp','email') then p_channel else 'download' end, 'delivered', false, 'demo', d.is_demo), null);
  v := private.doc_row(d, false) || jsonb_build_object('content', d.content, 'items', d.items, 'patient', d.patient_snapshot, 'professional', d.professional_snapshot,
                                                        'clinic_name', d.clinic_name, 'content_hash', d.content_hash);
  return v;
end $$;

-- Invalidar (cancelar) com motivo: cria a marca; o documento continua guardado. Quem emitiu ou Owner/Admin.
create or replace function public.doc_invalidate(p_doc uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.clinical_documents;
begin
  select * into d from public.clinical_documents where id = p_doc;
  if not found or not private.doc_can_content(d.clinic_id, d.patient_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not (private.is_clinic_admin(d.clinic_id) or exists (select 1 from public.professionals pr where pr.id = d.professional_id and pr.profile_id = private.current_profile_id())) then
    raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if exists (select 1 from public.clinical_document_marks m where m.document_id = d.id and m.kind = 'invalidated') then raise exception 'ALREADY_INVALIDATED' using errcode = '22023'; end if;
  insert into public.clinical_document_marks (document_id, clinic_id, kind, reason, by_profile_id) values (d.id, d.clinic_id, 'invalidated', btrim(p_reason), private.current_profile_id());
  perform private.fin_log(d.clinic_id, null, 'clinical_document', d.id, 'deactivate', jsonb_build_object('status', 'signed'), jsonb_build_object('status', 'invalidated'), p_reason);
  insert into public.activity_events (patient_id, type, payload) values (d.patient_id, 'document_invalidated', jsonb_build_object('document_id', d.id, 'doc_type', d.doc_type));
end $$;

-- Itens prescritos como dado (para «Preparar retorno» e cruzamento com o estoque). A sugestão NÃO baixa estoque: só indica o item da clínica.
create or replace function public.doc_prescribed_items(p_clinic uuid, p_patient uuid, p_encounter uuid default null, p_appointment uuid default null, p_since date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not private.doc_can_content(p_clinic, p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r.j order by r.signed_at desc, r.id, r.idx), '[]'::jsonb) into v_out from (
    select d.signed_at, d.id, e.ord as idx, jsonb_build_object(
        'document_id', d.id, 'signed_at', d.signed_at, 'is_demo', d.is_demo, 'encounter_id', d.encounter_id, 'appointment_id', d.appointment_id,
        'name', e.item->>'name', 'dose', e.item->>'dose', 'posology', e.item->>'posology', 'quantity', e.item->>'quantity',
        'stock_suggestion', (select jsonb_build_object('item_id', s.id, 'name', s.name, 'stock_unit', s.stock_unit)
                               from public.stock_items s
                              where s.clinic_id = p_clinic and s.is_active and s.item_type in ('medication','compounded')
                                and char_length(private.doc_norm(s.name)) >= 4
                                and (private.doc_norm(e.item->>'name') = private.doc_norm(s.name)
                                     or private.doc_norm(e.item->>'name') like private.doc_norm(s.name) || ' %'
                                     or private.doc_norm(s.name) like private.doc_norm(e.item->>'name') || ' %')
                              order by char_length(s.name) desc, s.id limit 1)) as j
      from public.clinical_documents d
      cross join lateral jsonb_array_elements(d.items) with ordinality as e(item, ord)
     where d.clinic_id = p_clinic and d.patient_id = p_patient and d.doc_type = 'receita'
       and not exists (select 1 from public.clinical_document_marks m where m.document_id = d.id)
       and (p_encounter is null or d.encounter_id = p_encounter)
       and (p_appointment is null or d.appointment_id = p_appointment)
       and (p_since is null or d.signed_at >= p_since::timestamptz)) r;
  return v_out;
end $$;

-- Área do paciente: o paciente logado vê os PRÓPRIOS documentos (o app do paciente é outro repositório; a RPC fica pronta para ele).
create or replace function public.doc_my_documents() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.doc_row(d, false) || jsonb_build_object('content', d.content, 'items', d.items, 'professional', d.professional_snapshot, 'clinic_name', d.clinic_name)
                            order by d.signed_at desc), '[]'::jsonb)
    from public.clinical_documents d where private.is_self_patient(d.patient_id)
$$;

-- ---------- 7. RLS e permissões ----------
alter table public.clinical_documents enable row level security;
alter table public.clinical_document_marks enable row level security;
alter table public.clinical_document_sessions enable row level security;
drop policy if exists clinical_documents_select on public.clinical_documents;
create policy clinical_documents_select on public.clinical_documents for select to authenticated
  using (private.doc_can_content(clinic_id, patient_id) or private.is_self_patient(patient_id));
drop policy if exists clinical_document_marks_select on public.clinical_document_marks;
create policy clinical_document_marks_select on public.clinical_document_marks for select to authenticated
  using (exists (select 1 from public.clinical_documents d where d.id = document_id and (private.doc_can_content(d.clinic_id, d.patient_id) or private.is_self_patient(d.patient_id))));
revoke all on public.clinical_documents, public.clinical_document_marks, public.clinical_document_sessions from public, anon, authenticated;
grant select on public.clinical_documents, public.clinical_document_marks to authenticated;

revoke all on function private.doc_immutable(), private.doc_is_clinician(uuid), private.doc_kind(uuid), private.doc_emitter(uuid), private.doc_can_content(uuid, uuid), private.doc_provider_ready(text),
  private.doc_provider(uuid), private.doc_norm(text), private.doc_check_items(text, jsonb), private.doc_row(public.clinical_documents, boolean),
  private.doc_insert(public.clinical_document_sessions, text, text, text, jsonb, timestamptz, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.doc_kind(uuid), private.doc_emitter(uuid), private.doc_can_content(uuid, uuid), private.doc_provider(uuid) to authenticated;

revoke all on function public.doc_my_access(uuid), public.doc_set_provider(uuid, text, text), public.doc_open_session(uuid, uuid, text, uuid, uuid),
  public.doc_sign_demo(uuid, text, text, jsonb, jsonb), public.doc_list(uuid, uuid, uuid, uuid, integer, integer), public.doc_get(uuid), public.doc_resend(uuid, text),
  public.doc_invalidate(uuid, text), public.doc_prescribed_items(uuid, uuid, uuid, uuid, date), public.doc_my_documents(),
  public.doc_ingest_signed(uuid, text, text, text, text, jsonb, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.doc_my_access(uuid), public.doc_set_provider(uuid, text, text), public.doc_open_session(uuid, uuid, text, uuid, uuid),
  public.doc_sign_demo(uuid, text, text, jsonb, jsonb), public.doc_list(uuid, uuid, uuid, uuid, integer, integer), public.doc_get(uuid), public.doc_resend(uuid, text),
  public.doc_invalidate(uuid, text), public.doc_prescribed_items(uuid, uuid, uuid, uuid, date), public.doc_my_documents() to authenticated;
-- webhook do provedor real: só a service_role (edge function prescription-webhook); nunca o navegador.
grant execute on function public.doc_ingest_signed(uuid, text, text, text, text, jsonb, timestamptz, text, text, jsonb) to service_role;

-- ---------- 8. fin_my_access (corpo da E8 + permissões de documentos) ----------
create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move',
                                'appt','patient_pkg','package_deliver','share_rules','share_lines','share_recalc',
                                'close_prepare','close_decide','close_pay','dash','inv_manage'];
        a text; v_can jsonb := '{}'::jsonb; v_roles jsonb; v_pro boolean; v_kind text; v_emit uuid;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then
    return jsonb_build_object('is_admin', false, 'roles', '[]'::jsonb, 'can', '{}'::jsonb);
  end if;
  foreach a in array v_areas loop
    v_can := v_can || jsonb_build_object(a || '_read', private.fin_can(p_clinic, a, null, false), a || '_write', private.fin_can(p_clinic, a, null, true));
  end loop;
  select exists (select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active') into v_pro;
  -- Profissional (sem papel financeiro) vê só a PRÓPRIA produção: vendas em que é vendedor e atendimentos em que participa.
  v_can := v_can || jsonb_build_object('own_sales_read', v_pro, 'own_appt', private.appt_is_pro(p_clinic), 'own_share', private.appt_is_pro(p_clinic));
  -- E9: documentos clínicos (a autoridade real continua nas RPCs doc_*).
  v_kind := private.doc_kind(p_clinic); v_emit := private.doc_emitter(p_clinic);
  v_can := v_can || jsonb_build_object('doc_list', v_kind in ('clinical','front'), 'doc_content', v_kind = 'clinical', 'doc_resend', v_kind in ('clinical','front'),
    'doc_emit', v_emit is not null and private.doc_provider_ready(private.doc_provider(p_clinic)), 'doc_registry_missing', v_kind = 'clinical' and v_pro and v_emit is null);
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids))), '[]'::jsonb)
    into v_roles
    from public.clinic_staff_roles r
    join public.professionals pr on pr.id = r.professional_id
   where r.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  return jsonb_build_object('is_admin', private.is_clinic_admin(p_clinic), 'roles', v_roles, 'can', v_can);
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261118100000', '20261118100000_fin_e9_documentos.sql',
        'FIN-E9: documentos clínicos (receita, atestado, exames, relatório) com provedor em modo demonstração, imutáveis, com RLS, ingestão idempotente de webhook e itens prescritos como dado', 'FIN-E9')
on conflict (version) do nothing;
