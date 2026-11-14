-- FIN-E9 (achados D49): Exames assina só com a lista de exames; sugestão de estoque casa qualquer item ativo; lista de documentos com filtros.
create or replace function private.doc_insert(p_session public.clinical_document_sessions, p_external text, p_title text, p_content text, p_items jsonb,
                                              p_signed_at timestamptz, p_sncr text, p_pdf text, p_patient_extra jsonb, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pat jsonb; v_pro jsonb; v_clinic text; v_items jsonb; v_cpf text; v_addr text; v_content text := coalesce(p_content, '');
begin
  v_items := private.doc_check_items(p_session.doc_type, p_items);
  if p_session.doc_type in ('atestado','relatorio') and char_length(btrim(v_content)) < 3 then raise exception 'CONTENT_REQUIRED' using errcode = '22023'; end if;
  if p_session.doc_type = 'exames' and char_length(btrim(v_content)) < 3 and jsonb_array_length(v_items) = 0 then raise exception 'CONTENT_REQUIRED' using errcode = '22023'; end if;
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

create or replace function public.doc_prescribed_items(p_clinic uuid, p_patient uuid, p_encounter uuid default null, p_appointment uuid default null, p_since date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not private.doc_can_content(p_clinic, p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  with st as materialized (
    select x.* from (
      select s.id, s.name, s.stock_unit, private.doc_norm(s.name) as norm, char_length(s.name) as len
        from public.stock_items s
       where s.clinic_id = p_clinic and s.is_active offset 0) x
     where char_length(x.norm) >= 4),
  it as (
    select d.id as doc_id, d.signed_at, d.is_demo, d.encounter_id, d.appointment_id, e.ord, e.item, private.doc_norm(e.item->>'name') as norm
      from public.clinical_documents d
      cross join lateral jsonb_array_elements(d.items) with ordinality as e(item, ord)
     where d.clinic_id = p_clinic and d.patient_id = p_patient and d.doc_type = 'receita'
       and not exists (select 1 from public.clinical_document_marks m where m.document_id = d.id)
       and (p_encounter is null or d.encounter_id = p_encounter)
       and (p_appointment is null or d.appointment_id = p_appointment)
       and (p_since is null or d.signed_at >= p_since::timestamptz))
  select coalesce(jsonb_agg(jsonb_build_object(
      'document_id', it.doc_id, 'signed_at', it.signed_at, 'is_demo', it.is_demo, 'encounter_id', it.encounter_id, 'appointment_id', it.appointment_id,
      'name', it.item->>'name', 'dose', it.item->>'dose', 'posology', it.item->>'posology', 'quantity', it.item->>'quantity',
      'stock_suggestion', (select jsonb_build_object('item_id', st.id, 'name', st.name, 'stock_unit', st.stock_unit) from st
                            where it.norm = st.norm or it.norm like st.norm || ' %' or st.norm like it.norm || ' %'
                            order by st.len desc, st.id limit 1))
    order by it.signed_at desc, it.doc_id, it.ord), '[]'::jsonb) into v_out
    from it;
  return v_out;
end $$;

drop function if exists public.doc_list(uuid, uuid, uuid, uuid, integer, integer);
create or replace function public.doc_list(p_clinic uuid, p_patient uuid default null, p_encounter uuid default null, p_appointment uuid default null,
                                           p_limit integer default 100, p_offset integer default 0,
                                           p_type text default null, p_from date default null, p_to date default null, p_status text default null, p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := private.doc_kind(p_clinic); v_all boolean := private.is_clinic_admin(p_clinic) or private.doc_kind(p_clinic) = 'front';
        v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_skip integer := greatest(coalesce(p_offset, 0), 0);
        v_ok jsonb := '{}'::jsonb; v_rows jsonb := '[]'::jsonb; v_n integer := 0; v_b boolean; r public.clinical_documents;
begin
  if v_kind = 'none' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_patient is not null and v_kind = 'clinical' and not private.doc_can_content(p_clinic, p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in
    select * from public.clinical_documents d
     where d.clinic_id = p_clinic and (p_patient is null or d.patient_id = p_patient)
       and (p_encounter is null or d.encounter_id = p_encounter) and (p_appointment is null or d.appointment_id = p_appointment)
       and (p_type is null or d.doc_type = p_type)
       and (p_from is null or (d.signed_at at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to is null or (d.signed_at at time zone 'America/Sao_Paulo')::date <= p_to)
       and (p_status is null or (p_status = 'invalidated') = exists (select 1 from public.clinical_document_marks m where m.document_id = d.id and m.kind = 'invalidated'))
       and (nullif(btrim(coalesce(p_search, '')), '') is null or (d.patient_snapshot->>'name') ilike '%' || btrim(p_search) || '%' or d.title ilike '%' || btrim(p_search) || '%')
     order by d.signed_at desc, d.id
  loop
    if not v_all then
      v_b := (v_ok ->> r.patient_id::text)::boolean;
      if v_b is null then v_b := private.can_access_patient(r.patient_id); v_ok := v_ok || jsonb_build_object(r.patient_id::text, v_b); end if;
      if not v_b then continue; end if;
    end if;
    if v_skip > 0 then v_skip := v_skip - 1; continue; end if;
    v_rows := v_rows || jsonb_build_array(private.doc_row(r, v_kind = 'clinical'));
    v_n := v_n + 1;
    exit when v_n >= v_limit;
  end loop;
  return v_rows;
end $$;
revoke all on function public.doc_list(uuid, uuid, uuid, uuid, integer, integer, text, date, date, text, text) from public, anon;
grant execute on function public.doc_list(uuid, uuid, uuid, uuid, integer, integer, text, date, date, text, text) to authenticated;
revoke all on function private.doc_insert(public.clinical_document_sessions, text, text, text, jsonb, timestamptz, text, text, jsonb, uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';

insert into public.schema_migration_log (version, filename, description, session)
values ('20261118140000','20261118140000_fin_e9_docs_fixes.sql','FIN-E9: Exames sem observação, sugestão de estoque e filtros da lista de documentos (achados D49).','FIN-E9');
