-- =====================================================================================
-- WP-KANBAN · A — Jornada do paciente: modelo de dados, colunas e marcos (SÓ BANCO).
--
-- DECISÕES DO DONO (lei):
--  · Colunas por clínica (journey_columns) — 1 coluna inicial/clínica (índice único parcial). Padrão
--    semeado ("Novos"/"Em acompanhamento"/"Retorno"/"Concluídos"). Backfill + trigger em clinics.
--    Administração das colunas = is_clinic_admin (CRUD direto). Profissional comum só USA.
--  · Estado atual (patient_journey_state, 1/paciente) + histórico append-only (patient_journey_moves).
--    Paciente SEM estado ⇒ derivado para a coluna is_initial (sem backfill de pacientes).
--  · Marcos DERIVADOS (start_date/birth_date); materializa só o RECONHECIMENTO (journey_milestone_ack).
--    Offsets de dias = CONSTANTE EXTENSÍVEL private.journey_day_offsets() (add 180/365 depois = 1 linha).
--  · MARCO NÃO MOVE CARTÃO (isto é só dado; o move é humano).
--
-- AUTORIZAÇÃO (reusa helpers; NENHUMA policy existente afrouxada):
--  · journey_columns: SELECT is_clinic_member ; INSERT/UPDATE/DELETE is_clinic_admin.
--  · state/moves/ack: SELECT can_access_patient ; ESCRITA só via RPC SECDEF (sem policy de escrita p/ cliente).
--  · MOVER/ACK: is_clinic_admin OU is_common_professional_of_patient (EXTERNO NÃO move/ack). moved_by/acked_by
--    derivados do SERVIDOR (current_profile_id), nunca do cliente. moves é IMUTÁVEL (sem UPDATE/DELETE).
--
-- K1: create_patient ganha p_start_date OPCIONAL (default null ⇒ mantém CURRENT_DATE). Recusa data FUTURA.
--     A versão de 13 args é DROPADA (sem órfã/ambiguidade); revoke/grant reaplicados; autorização inalterada.
--
-- ROLLBACK (kill switch — fail-closed):
--   -- restaura create_patient à versão de 13 args (migration 20260719192529) e remove a jornada:
--   drop function if exists public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date);
--   drop function if exists public.move_patient_journey(uuid,uuid);
--   drop function if exists public.ack_journey_milestone(uuid,text);
--   drop trigger if exists trg_seed_journey_columns on public.clinics;
--   drop function if exists private.tg_seed_journey_columns();
--   drop function if exists private.seed_journey_columns(uuid);
--   drop function if exists private.journey_day_offsets();
--   drop table if exists public.journey_milestone_ack, public.patient_journey_moves,
--     public.patient_journey_state, public.journey_columns cascade;
-- =====================================================================================

-- ── Tabelas ──────────────────────────────────────────────────────────────────────────
create table if not exists public.journey_columns (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  name       text not null,
  position   integer not null,
  color      text,
  is_initial boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_journey_columns_clinic_pos on public.journey_columns (clinic_id, position);
-- UMA coluna inicial por clínica:
create unique index if not exists uq_journey_columns_one_initial on public.journey_columns (clinic_id) where is_initial;

create table if not exists public.patient_journey_state (
  patient_id          uuid primary key references public.patients(id) on delete cascade,
  column_id           uuid not null references public.journey_columns(id),
  moved_at            timestamptz not null default now(),
  moved_by_profile_id uuid references public.profiles(id)
);
create index if not exists idx_patient_journey_state_column on public.patient_journey_state (column_id);

create table if not exists public.patient_journey_moves (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete cascade,
  from_column_id      uuid references public.journey_columns(id),
  to_column_id        uuid not null references public.journey_columns(id),
  moved_by_profile_id uuid references public.profiles(id),
  moved_at            timestamptz not null default now()
);
create index if not exists idx_patient_journey_moves_patient on public.patient_journey_moves (patient_id, moved_at desc);

create table if not exists public.journey_milestone_ack (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete cascade,
  milestone_key       text not null,
  acked_by_profile_id uuid references public.profiles(id),
  acked_at            timestamptz not null default now(),
  unique (patient_id, milestone_key)
);

-- ── Constante extensível de offsets de dias (add 180/365 depois = 1 linha) ──
create or replace function private.journey_day_offsets()
returns int[] language sql immutable set search_path = '' as $$ select array[30,60,90] $$;

-- ── RLS + grants + policies ──────────────────────────────────────────────────────────
alter table public.journey_columns       enable row level security;
alter table public.patient_journey_state enable row level security;
alter table public.patient_journey_moves enable row level security;
alter table public.journey_milestone_ack enable row level security;

revoke all on public.journey_columns       from anon, authenticated;
revoke all on public.patient_journey_state from anon, authenticated;
revoke all on public.patient_journey_moves from anon, authenticated;
revoke all on public.journey_milestone_ack from anon, authenticated;

-- colunas: cliente admin faz CRUD direto; todos os membros leem.
grant select, insert, update, delete on public.journey_columns to authenticated;
-- estado/histórico/ack: cliente só LÊ; escrita é exclusiva das RPCs definer.
grant select on public.patient_journey_state to authenticated;
grant select on public.patient_journey_moves to authenticated;
grant select on public.journey_milestone_ack to authenticated;

create policy journey_columns_select on public.journey_columns
  for select to authenticated using (private.is_clinic_member(clinic_id));
create policy journey_columns_admin_insert on public.journey_columns
  for insert to authenticated with check (private.is_clinic_admin(clinic_id));
create policy journey_columns_admin_update on public.journey_columns
  for update to authenticated using (private.is_clinic_admin(clinic_id)) with check (private.is_clinic_admin(clinic_id));
create policy journey_columns_admin_delete on public.journey_columns
  for delete to authenticated using (private.is_clinic_admin(clinic_id));

create policy patient_journey_state_select on public.patient_journey_state
  for select to authenticated using (private.can_access_patient(patient_id));
create policy patient_journey_moves_select on public.patient_journey_moves
  for select to authenticated using (private.can_access_patient(patient_id));
create policy journey_milestone_ack_select on public.journey_milestone_ack
  for select to authenticated using (private.can_access_patient(patient_id));

-- ── Seed + backfill + trigger ──────────────────────────────────────────────────────────
create or replace function private.seed_journey_columns(p_clinic uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if exists (select 1 from public.journey_columns where clinic_id = p_clinic) then return; end if;
  insert into public.journey_columns (clinic_id, name, position, color, is_initial) values
    (p_clinic, 'Novos',              1, '#94A3B8', true),
    (p_clinic, 'Em acompanhamento',  2, '#3B82F6', false),
    (p_clinic, 'Retorno',            3, '#F59E0B', false),
    (p_clinic, 'Concluídos',         4, '#22C55E', false);
end $$;

-- Backfill: cada clínica existente SEM colunas recebe o padrão.
do $$ declare c uuid; begin
  for c in select id from public.clinics loop perform private.seed_journey_columns(c); end loop;
end $$;

create or replace function private.tg_seed_journey_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.seed_journey_columns(new.id); return new; end $$;

drop trigger if exists trg_seed_journey_columns on public.clinics;
create trigger trg_seed_journey_columns after insert on public.clinics
  for each row execute function private.tg_seed_journey_columns();

-- ── RPC: mover paciente de coluna (estado + histórico atômicos; moved_by do servidor) ──
create or replace function public.move_patient_journey(p_patient_id uuid, p_to_column_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_clinic uuid; v_col_clinic uuid; v_from uuid; v_me uuid := private.current_profile_id();
begin
  v_clinic := private.patient_clinic(p_patient_id);
  if v_clinic is null then raise exception 'move_patient_journey: patient not found' using errcode = '22023'; end if;
  -- EXTERNO NÃO move: só admin da clínica OU profissional comum (vinculado) do paciente.
  if not (private.is_clinic_admin(v_clinic) or private.is_common_professional_of_patient(p_patient_id)) then
    raise exception 'move_patient_journey: not authorized' using errcode = '42501';
  end if;
  -- a coluna destino tem de ser da MESMA clínica do paciente.
  select clinic_id into v_col_clinic from public.journey_columns where id = p_to_column_id;
  if v_col_clinic is null then raise exception 'move_patient_journey: column not found' using errcode = '22023'; end if;
  if v_col_clinic <> v_clinic then raise exception 'move_patient_journey: column belongs to another clinic' using errcode = '42501'; end if;
  -- from = estado atual OU coluna inicial (derivado).
  select column_id into v_from from public.patient_journey_state where patient_id = p_patient_id;
  if v_from is null then
    select id into v_from from public.journey_columns where clinic_id = v_clinic and is_initial limit 1;
  end if;
  insert into public.patient_journey_state (patient_id, column_id, moved_at, moved_by_profile_id)
    values (p_patient_id, p_to_column_id, now(), v_me)
    on conflict (patient_id) do update
      set column_id = excluded.column_id, moved_at = excluded.moved_at, moved_by_profile_id = excluded.moved_by_profile_id;
  insert into public.patient_journey_moves (patient_id, from_column_id, to_column_id, moved_by_profile_id)
    values (p_patient_id, v_from, p_to_column_id, v_me);
  return jsonb_build_object('patient_id', p_patient_id, 'from_column_id', v_from, 'to_column_id', p_to_column_id,
                            'moved_by', v_me, 'moved_at', now());
end $$;
revoke all     on function public.move_patient_journey(uuid, uuid) from public, anon;
grant  execute on function public.move_patient_journey(uuid, uuid) to authenticated;

-- ── RPC: reconhecer marco (acked_by do servidor; chave canônica validada) ──
create or replace function public.ack_journey_milestone(p_patient_id uuid, p_milestone_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := private.current_profile_id(); v_ok boolean := false; v_day int;
begin
  if not (private.is_clinic_admin(private.patient_clinic(p_patient_id)) or private.is_common_professional_of_patient(p_patient_id)) then
    raise exception 'ack_journey_milestone: not authorized' using errcode = '42501';
  end if;
  -- chave canônica: 'start' | 'birthday:YYYY' | 'day_<offset conhecido>'
  if p_milestone_key = 'start' then v_ok := true;
  elsif p_milestone_key ~ '^birthday:[0-9]{4}$' then v_ok := true;
  elsif p_milestone_key ~ '^day_[0-9]+$' then
    v_day := substring(p_milestone_key from 5)::int;
    if v_day = any(private.journey_day_offsets()) then v_ok := true; end if;
  end if;
  if not v_ok then raise exception 'ack_journey_milestone: unknown milestone_key "%"', p_milestone_key using errcode = '22023'; end if;
  insert into public.journey_milestone_ack (patient_id, milestone_key, acked_by_profile_id)
    values (p_patient_id, p_milestone_key, v_me)
    on conflict (patient_id, milestone_key) do nothing;
  return jsonb_build_object('patient_id', p_patient_id, 'milestone_key', p_milestone_key, 'acked_by', v_me);
end $$;
revoke all     on function public.ack_journey_milestone(uuid, text) from public, anon;
grant  execute on function public.ack_journey_milestone(uuid, text) to authenticated;

-- ── K1: create_patient ganha p_start_date OPCIONAL (recusa data futura). Corpo idêntico + start_date. ──
drop function if exists public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text);

create or replace function public.create_patient(
  p_clinic_id uuid, p_full_name text, p_email text default null, p_birth_date date default null,
  p_sex text default null, p_height_cm numeric default null, p_goal text default null,
  p_start_weight numeric default null, p_target_weight numeric default null,
  p_anamnese_method text default null, p_anamnese_weight numeric default null,
  p_anamnese_body_fat_pct numeric default null, p_anamnese_notes text default null,
  p_start_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_caller_profile uuid := private.current_profile_id(); v_caller_prof uuid; v_profile_id uuid; v_patient_id uuid;
begin
  if v_caller_profile is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if btrim(coalesce(p_full_name,'')) = '' then raise exception 'full_name required' using errcode = '22023'; end if;
  if p_clinic_id is null then raise exception 'clinic_id required' using errcode = '22023'; end if;
  -- K1: data de início informada não pode ser FUTURA (marcos 30/60/90 nasceriam errados).
  if p_start_date is not null and p_start_date > current_date then
    raise exception 'create_patient: p_start_date cannot be in the future' using errcode = '22023';
  end if;
  select pr.id into v_caller_prof from public.professionals pr where pr.clinic_id = p_clinic_id and pr.profile_id = v_caller_profile limit 1;
  if v_caller_prof is null and not private.is_clinic_admin(p_clinic_id) then raise exception 'forbidden: caller is not staff of clinic' using errcode = '42501'; end if;
  insert into public.profiles (role, full_name, email, status) values ('patient', btrim(p_full_name), nullif(btrim(coalesce(p_email,'')),''), 'active') returning id into v_profile_id;
  insert into public.patients (profile_id, clinic_id, goal, birth_date, sex, height_cm, start_weight, current_weight, target_weight, start_date)
  values (v_profile_id, p_clinic_id, nullif(btrim(coalesce(p_goal,'')),''), p_birth_date, p_sex, p_height_cm, p_start_weight, p_start_weight, p_target_weight, coalesce(p_start_date, current_date)) returning id into v_patient_id;
  if v_caller_prof is not null then insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values (v_caller_prof, v_patient_id, false, 'active'); end if;
  if p_anamnese_weight is not null or p_anamnese_body_fat_pct is not null or nullif(btrim(coalesce(p_anamnese_method,'')),'') is not null or nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then
    insert into public.body_assessments (patient_id, professional_id, method, weight, body_fat_pct, measurements)
    values (v_patient_id, v_caller_prof, nullif(btrim(coalesce(p_anamnese_method,'')),''), p_anamnese_weight, p_anamnese_body_fat_pct,
            case when nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then jsonb_build_object('notes', btrim(p_anamnese_notes)) else null end);
  end if;
  return v_patient_id;
end $function$;

revoke all     on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date) from public, anon;
grant  execute on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date) to authenticated;

-- Ledger humano.
insert into public.schema_migration_log (version, filename, description, session)
values ('20260730090000','20260730090000_wp_kanban_a_journey.sql',
  'WP-KANBAN A: jornada do paciente. Tabelas journey_columns (colunas/clinica, 1 inicial via indice unico parcial), '
  'patient_journey_state (atual), patient_journey_moves (append-only), journey_milestone_ack (reconhecimento). '
  'Offsets extensiveis private.journey_day_offsets(). Seed/backfill + trigger em clinics. RLS: colunas SELECT '
  'is_clinic_member / escrita is_clinic_admin; state/moves/ack SELECT can_access_patient, escrita so via RPC. '
  'RPCs move_patient_journey e ack_journey_milestone (SECDEF, moved_by/acked_by do servidor, externo nao move/ack; '
  'moves imutavel). K1: create_patient ganha p_start_date OPCIONAL (recusa futuro; 13-args dropada; autz inalterada). '
  'Nenhuma policy existente alterada.',
  'WP-KANBAN')
on conflict (version) do nothing;
