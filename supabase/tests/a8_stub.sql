-- Complementos do p6_stub para a prova SQL da A8 (rascunho de dieta/treino pela Vertexa IA). Só local; NÃO vai para produção.
create function private.clinical_can_access_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_patient is not null and exists (
    select 1 from public.patients pt join public.professionals pr on pr.clinic_id = pt.clinic_id
     where pt.id = p_patient and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'
       and (private.is_clinic_admin(pt.clinic_id) or exists (select 1 from public.professional_patient_links l
             where l.patient_id = pt.id and l.professional_id = pr.id and coalesce(l.status,'active') = 'active' and coalesce(l.is_external,false) = false))) $$;
grant execute on function private.clinical_can_access_patient(uuid) to authenticated;
-- vertexa_ai_events como na migration 20261119100000 (mesmo CHECK de draft_kind original, que a A8 alarga)
create table public.vertexa_ai_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('pedido', 'rascunho_usado', 'rascunho_descartado')),
  parent_id uuid references public.vertexa_ai_events(id) on delete cascade,
  screen text, patient_id uuid references public.patients(id) on delete set null,
  mode text check (mode in ('demo', 'openai')), intent text,
  draft_kind text check (draft_kind in ('mensagem', 'resumo_retorno', 'lista_ligacoes')),
  blocked text check (blocked in ('sem_acesso', 'fora_do_escopo')),
  created_at timestamptz not null default now()
);
alter table public.professionals add column if not exists created_at timestamptz default now();
