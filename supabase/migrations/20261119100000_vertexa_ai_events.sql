-- Redesign parte 3 — Vertexa IA: rastro de quem pediu e de quem usou/descartou o rascunho.
-- SÓ CRIA objetos novos (tabela public.vertexa_ai_events + função public.vertexa_ai_can_access_patient).
-- Não guarda o texto da conversa nem do rascunho (dado de saúde fica fora do log): só tela, intenção, modo e decisão.
-- Escrita: somente pela Edge Function vertexa-ai (service_role). Leitura: admin da clínica vê tudo; cada um vê os próprios.

create table if not exists public.vertexa_ai_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('pedido', 'rascunho_usado', 'rascunho_descartado')),
  parent_id uuid references public.vertexa_ai_events(id) on delete cascade,
  screen text,
  patient_id uuid references public.patients(id) on delete set null,
  mode text check (mode in ('demo', 'openai')),
  intent text,
  draft_kind text check (draft_kind in ('mensagem', 'resumo_retorno', 'lista_ligacoes')),
  blocked text check (blocked in ('sem_acesso', 'fora_do_escopo')),
  created_at timestamptz not null default now()
);
create index if not exists vertexa_ai_events_clinic_idx on public.vertexa_ai_events (clinic_id, created_at desc);
create index if not exists vertexa_ai_events_parent_idx on public.vertexa_ai_events (parent_id) where parent_id is not null;

alter table public.vertexa_ai_events enable row level security;
revoke all on public.vertexa_ai_events from public, anon, authenticated;
grant select on public.vertexa_ai_events to authenticated;

drop policy if exists vertexa_ai_events_select on public.vertexa_ai_events;
create policy vertexa_ai_events_select on public.vertexa_ai_events for select to authenticated
  using (private.is_clinic_admin(clinic_id) or profile_id = private.current_profile_id());

-- Imutável contra edição (update). Delete só por cascata de clínica/pedido; nenhuma policy de escrita para usuários.
create or replace function private.vertexa_ai_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'vertexa_ai_events é imutável' using errcode = '42501';
end $$;
drop trigger if exists vertexa_ai_events_no_change on public.vertexa_ai_events;
create trigger vertexa_ai_events_no_change before update on public.vertexa_ai_events
  for each row execute function private.vertexa_ai_events_immutable();

-- Mesma regra da consulta assistida: admin da clínica ou profissional vinculado (Recepção e Financeiro não passam).
create or replace function public.vertexa_ai_can_access_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.clinical_can_access_patient(p_patient)
$$;
revoke all on function public.vertexa_ai_can_access_patient(uuid) from public, anon;
grant execute on function public.vertexa_ai_can_access_patient(uuid) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261119100000', '20261119100000_vertexa_ai_events.sql',
        'Redesign P3: vertexa_ai_events (rastro imutável de pedido/uso/descarte da Vertexa IA, RLS por clínica, sem texto de conversa) e vertexa_ai_can_access_patient (aditiva).',
        'REDESIGN-P3')
on conflict (version) do nothing;
