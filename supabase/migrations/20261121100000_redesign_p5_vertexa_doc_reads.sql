-- Redesign parte 5 — Ler PDF/foto com Conferência: rastro de quem enviou, quem confirmou e quantos campos foram corrigidos.
-- SÓ CRIA objetos novos (tabela public.vertexa_doc_reads + função/trigger private.vertexa_doc_reads_guard).
-- NÃO guarda os valores lidos nem o texto do documento (dado de saúde fica fora do log): só tipo, modo, contagens e quem decidiu.
-- Escrita: somente pela Edge Function vertexa-doc-read (service_role). Leitura: admin da clínica vê tudo; cada um vê o que enviou/confirmou.

create table if not exists public.vertexa_doc_reads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  kind text not null check (kind in ('bioimpedancia', 'dieta', 'treino')),
  mode text not null check (mode in ('demo', 'openai')),
  status text not null default 'lido' check (status in ('lido', 'confirmado', 'descartado')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  doc_path text not null,
  document_id uuid references public.patient_documents(id) on delete set null,
  fields_total int not null default 0 check (fields_total >= 0),
  fields_uncertain int not null default 0 check (fields_uncertain >= 0),
  fields_corrected int check (fields_corrected is null or fields_corrected >= 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists vertexa_doc_reads_clinic_idx on public.vertexa_doc_reads (clinic_id, created_at desc);
create index if not exists vertexa_doc_reads_patient_idx on public.vertexa_doc_reads (patient_id) where patient_id is not null;

alter table public.vertexa_doc_reads enable row level security;
revoke all on public.vertexa_doc_reads from public, anon, authenticated;
grant select on public.vertexa_doc_reads to authenticated;

drop policy if exists vertexa_doc_reads_select on public.vertexa_doc_reads;
create policy vertexa_doc_reads_select on public.vertexa_doc_reads for select to authenticated
  using (private.is_clinic_admin(clinic_id) or uploaded_by = private.current_profile_id() or resolved_by = private.current_profile_id());

-- A linha só muda UMA vez ('lido' -> 'confirmado'|'descartado') e só nos campos de decisão.
create or replace function private.vertexa_doc_reads_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'lido' then
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
drop trigger if exists vertexa_doc_reads_guard on public.vertexa_doc_reads;
create trigger vertexa_doc_reads_guard before update on public.vertexa_doc_reads
  for each row execute function private.vertexa_doc_reads_guard();

insert into public.schema_migration_log (version, filename, description, session)
values ('20261121100000', '20261121100000_redesign_p5_vertexa_doc_reads.sql',
        'Redesign P5: vertexa_doc_reads (rastro de leitura de PDF/foto: quem enviou, quem confirmou, campos corrigidos; sem valores), RLS por clínica, decisão única (aditiva).',
        'REDESIGN-P5')
on conflict (version) do nothing;
