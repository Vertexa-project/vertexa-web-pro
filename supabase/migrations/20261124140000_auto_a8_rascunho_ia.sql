-- =====================================================================================
-- AUTOMAÇÃO A8 (V1, modo demonstração) — Primeira versão de dieta e treino pela Vertexa IA.
--
-- SÓ OBJETOS NOVOS (e um alargamento de CHECK). Nada existente é recriado ou apagado:
--   1) clinic_plan_draft_config: por clínica, a lista editável de "tipos de paciente" e o "método da clínica"
--      (texto que vai no prompt quando existir OPENAI_API_KEY). Sem linha = lista padrão da reunião de 28/10 (no código).
--      Leitura: equipe da clínica. Escrita: só admin da clínica, pela RPC save_plan_draft_config.
--   2) ai_plan_drafts: o RASCUNHO gerado (dieta ou treino) FICA AQUI, fora de nutrition_plans/workout_plans.
--      Por isso o paciente nunca vê o rascunho e o plano já publicado NÃO é substituído até o profissional abrir o
--      editor e salvar/publicar. Leitura: quem tem acesso clínico ao paciente (admin da clínica ou profissional
--      vinculado; o próprio paciente e Recepção/Financeiro NÃO). Escrita: só a Edge Function vertexa-plan-draft (service_role).
--   3) public.plan_draft_can_generate(paciente, tipo): quem pode gerar = quem tem a disciplina do plano
--      (nutricionista p/ dieta; educador_fisico ou fisioterapeuta p/ treino) e vínculo clínico com o paciente.
--   4) vertexa_ai_events.draft_kind aceita 'plano_dieta' e 'plano_treino' (rastro de quem pediu/usou/descartou).
--
-- Reversão: drop das 2 tabelas, da função public.plan_draft_can_generate e save_plan_draft_config; restaurar o CHECK
-- de vertexa_ai_events.draft_kind aos 3 valores originais.
-- =====================================================================================

-- ───────────────────────── 1) Configuração por clínica
create table if not exists public.clinic_plan_draft_config (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  patient_types jsonb check (patient_types is null or (jsonb_typeof(patient_types) = 'array' and jsonb_array_length(patient_types) between 1 and 60)),
  method_dieta text check (method_dieta is null or char_length(method_dieta) <= 4000),
  method_treino text check (method_treino is null or char_length(method_treino) <= 4000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.clinic_plan_draft_config enable row level security;
revoke all on public.clinic_plan_draft_config from public, anon, authenticated;
grant select on public.clinic_plan_draft_config to authenticated;
drop policy if exists clinic_plan_draft_config_select on public.clinic_plan_draft_config;
create policy clinic_plan_draft_config_select on public.clinic_plan_draft_config for select to authenticated
  using (exists (select 1 from public.professionals pr
                  where pr.clinic_id = clinic_plan_draft_config.clinic_id
                    and pr.profile_id = private.current_profile_id()
                    and coalesce(pr.status, 'active') = 'active'));

create or replace function public.save_plan_draft_config(p_patient_types jsonb, p_method_dieta text default null, p_method_treino text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid; t jsonb; v_keys text[] := '{}';
begin
  if private.current_profile_id() is null then
    raise exception 'save_plan_draft_config: not authenticated' using errcode = '42501';
  end if;
  select x.clinic_id into v_clinic from (
      select pr.clinic_id from public.professionals pr
       where pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'
      union select c.id from public.clinics c where c.owner_profile_id = private.current_profile_id()
    ) x
   where x.clinic_id is not null and private.is_clinic_admin(x.clinic_id)
   limit 1;
  if v_clinic is null then raise exception 'forbidden: requires clinic admin' using errcode = '42501'; end if;
  if p_patient_types is not null then
    if jsonb_typeof(p_patient_types) <> 'array' or jsonb_array_length(p_patient_types) not between 1 and 60 then
      raise exception 'patient_types: lista de 1 a 60 tipos' using errcode = '22023';
    end if;
    for t in select value from jsonb_array_elements(p_patient_types) loop
      if jsonb_typeof(t) <> 'object' or coalesce(btrim(t->>'key'), '') !~ '^[a-z0-9_]{2,40}$'
         or char_length(btrim(coalesce(t->>'label', ''))) not between 2 and 80
         or coalesce(t->>'base', '') not in ('emagrecimento','hipertrofia','recomposicao','cardiometabolico','abaixo_peso','pre_diabetico','retomada','manutencao')
         or char_length(coalesce(t->>'hint', '')) > 400 then
        raise exception 'patient_types: tipo inválido' using errcode = '22023';
      end if;
      if (t->>'key') = any(v_keys) then raise exception 'patient_types: chave repetida' using errcode = '22023'; end if;
      v_keys := v_keys || (t->>'key');
    end loop;
  end if;
  insert into public.clinic_plan_draft_config (clinic_id, patient_types, method_dieta, method_treino, updated_by, updated_at)
  values (v_clinic, p_patient_types, nullif(btrim(coalesce(p_method_dieta, '')), ''), nullif(btrim(coalesce(p_method_treino, '')), ''), private.current_profile_id(), now())
  on conflict (clinic_id) do update
    set patient_types = excluded.patient_types, method_dieta = excluded.method_dieta, method_treino = excluded.method_treino,
        updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.save_plan_draft_config(jsonb, text, text) from public, anon;
grant execute on function public.save_plan_draft_config(jsonb, text, text) to authenticated;

-- ───────────────────────── 2) Rascunhos gerados
create table if not exists public.ai_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  kind text not null check (kind in ('dieta', 'treino')),
  patient_type text not null check (char_length(patient_type) between 2 and 40),
  patient_type_label text not null check (char_length(patient_type_label) between 2 and 80),
  mode text not null check (mode in ('demo', 'openai')),
  payload jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'usado', 'descartado', 'substituido')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);
-- no máximo UM rascunho pendente por paciente e tipo (gerar de novo substitui o anterior)
create unique index if not exists ai_plan_drafts_one_pending on public.ai_plan_drafts (patient_id, kind) where status = 'pendente';
create index if not exists ai_plan_drafts_clinic_idx on public.ai_plan_drafts (clinic_id, created_at desc);

alter table public.ai_plan_drafts enable row level security;
revoke all on public.ai_plan_drafts from public, anon, authenticated;
grant select on public.ai_plan_drafts to authenticated;
drop policy if exists ai_plan_drafts_select on public.ai_plan_drafts;
create policy ai_plan_drafts_select on public.ai_plan_drafts for select to authenticated
  using (private.clinical_can_access_patient(patient_id));

-- ───────────────────────── 3) Quem pode gerar
create or replace function public.plan_draft_can_generate(p_patient uuid, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'dieta'  then private.clinical_can_access_patient(p_patient) and private.can_write_discipline(p_patient, array['nutricionista'])
    when 'treino' then private.clinical_can_access_patient(p_patient) and private.can_write_discipline(p_patient, array['educador_fisico','fisioterapeuta'])
    else false end
$$;
revoke all on function public.plan_draft_can_generate(uuid, text) from public, anon;
grant execute on function public.plan_draft_can_generate(uuid, text) to authenticated;

-- ───────────────────────── 4) Rastro: tipos novos de rascunho
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.vertexa_ai_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%draft_kind%' loop
    execute format('alter table public.vertexa_ai_events drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.vertexa_ai_events add constraint vertexa_ai_events_draft_kind_check
  check (draft_kind is null or draft_kind in ('mensagem', 'resumo_retorno', 'lista_ligacoes', 'plano_dieta', 'plano_treino'));

comment on table public.ai_plan_drafts is 'A8: rascunho de dieta/treino gerado pela Vertexa IA. Fora das tabelas de plano: o paciente não vê e o plano publicado não é substituído até o profissional salvar/publicar no editor.';

insert into public.schema_migration_log (version, filename, description, session)
values ('20261124140000', '20261124140000_auto_a8_rascunho_ia.sql',
        'A8: ai_plan_drafts (rascunho de dieta/treino pela Vertexa IA, fora dos planos publicados), clinic_plan_draft_config (tipos de paciente e método por clínica), plan_draft_can_generate, save_plan_draft_config; vertexa_ai_events.draft_kind ganha plano_dieta/plano_treino (aditiva).',
        'AUTO-A8')
on conflict (version) do nothing;
