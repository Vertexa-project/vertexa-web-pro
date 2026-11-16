-- Redesign P5 (ajuste): apagar um documento que veio de uma importação (Documentos) não pode travar.
-- vertexa_doc_reads.document_id é "on delete set null"; o guarda de imutabilidade recusava essa troca em linha já decidida.
-- Agora a única mudança aceita numa linha decidida é o document_id virar NULL (o documento foi apagado); o resto continua imutável.
create or replace function private.vertexa_doc_reads_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'lido' then
    if new.document_id is null and old.document_id is not null
       and (to_jsonb(new) - 'document_id') = (to_jsonb(old) - 'document_id') then
      return new;
    end if;
    raise exception 'vertexa_doc_reads já decidido é imutável' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id
     or new.kind is distinct from old.kind or new.mode is distinct from old.mode or new.uploaded_by is distinct from old.uploaded_by
     or new.doc_path is distinct from old.doc_path or new.fields_total is distinct from old.fields_total
     or new.fields_uncertain is distinct from old.fields_uncertain or new.created_at is distinct from old.created_at then
    raise exception 'vertexa_doc_reads: só os campos de decisão podem mudar' using errcode = '42501';
  end if;
  return new;
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261121110000', '20261121110000_redesign_p5_doc_reads_allow_document_unlink.sql',
        'Redesign P5: apagar documento importado não trava (guarda aceita só document_id -> NULL em linha decidida).',
        'REDESIGN-P5')
on conflict (version) do nothing;
