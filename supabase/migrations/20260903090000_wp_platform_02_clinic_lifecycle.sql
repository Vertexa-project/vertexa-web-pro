-- =====================================================================================
-- PLATFORM-02 — lifecycle administrativo de clínicas: active ↔ suspended.
--
-- UMA migration canônica. Não editar depois de aplicada.
--
-- Modelo:
--   public.clinics.status / status_changed_at / status_reason
--   SEM status_changed_by em clinics (evita 2ª FK clinics → profiles).
--   private.platform_clinic_status_events (append-only, actor → profiles OK aqui)
--   private.clinic_is_operational(uuid) fail-closed
--
-- Autorização: o predicado entra no grafo clínico (admin/owner/staff/member/links/chat).
-- Platform Admin NÃO entra em RLS clínica. Nunca is_platform_admin() em policy clínica.
--
-- Grants: PRESERVA UPDATE(name) em clinics. NÃO concede UPDATE de status*.
--
-- Asaas / billing: INTENCIONALMENTE NÃO ACOPLADO. Suspensão não cancela cobrança,
-- não escreve billing_accounts, não emite webhook, não revoga subscription.
--
-- Rollback / forward-fix: manter clinics active; revogar EXECUTE das RPCs PA;
-- corrigir via nova migration. Nunca DELETE de tenant. Nunca editar esta migration.
-- =====================================================================================

-- ── 1) Colunas de lifecycle em clinics ──────────────────────────────────────────────
alter table public.clinics
  add column if not exists status text not null default 'active',
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_reason text;

alter table public.clinics drop constraint if exists clinics_status_check;
alter table public.clinics
  add constraint clinics_status_check
  check (status in ('active', 'suspended'));

alter table public.clinics drop constraint if exists clinics_status_reason_len;
alter table public.clinics
  add constraint clinics_status_reason_len
  check (status_reason is null or char_length(status_reason) <= 500);

comment on column public.clinics.status is
  'PLATFORM-02: active | suspended. Default active. Só muda pelas RPCs de Platform Admin.';
comment on column public.clinics.status_changed_at is
  'PLATFORM-02: instante da última transição. Sem status_changed_by nesta tabela.';
comment on column public.clinics.status_reason is
  'PLATFORM-02: motivo da última transição. Visível ao PA; não expor a membro/paciente.';

-- Preserva o grant estreito de nome. Novas colunas NÃO entram nesse grant.
revoke update on public.clinics from authenticated, anon;
grant update (name) on public.clinics to authenticated;
revoke update (status, status_changed_at, status_reason)
  on public.clinics from authenticated, anon;


-- ── 2) Audit trail append-only ──────────────────────────────────────────────────────
create table if not exists private.platform_clinic_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  from_status text not null,
  to_status text not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint platform_clinic_status_events_from_check
    check (from_status in ('active', 'suspended')),
  constraint platform_clinic_status_events_to_check
    check (to_status in ('active', 'suspended')),
  constraint platform_clinic_status_events_transition_check
    check (from_status is distinct from to_status),
  constraint platform_clinic_status_events_reason_len
    check (reason is null or char_length(reason) <= 500)
);

comment on table private.platform_clinic_status_events is
  'PLATFORM-02: trilha append-only de suspensão/reativação. '
  'FK actor → profiles é NESTA tabela privada — não cria 2ª FK clinics→profiles (H5). '
  'Escrita só pelas RPCs administrativas.';

alter table private.platform_clinic_status_events enable row level security;
revoke all on table private.platform_clinic_status_events
  from public, anon, authenticated, service_role;

create or replace function private.tg_platform_clinic_status_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'platform_clinic_status_events is append-only'
    using errcode = '42501', hint = 'APPEND_ONLY';
end;
$$;

drop trigger if exists trg_platform_clinic_status_events_no_update
  on private.platform_clinic_status_events;
create trigger trg_platform_clinic_status_events_no_update
  before update on private.platform_clinic_status_events
  for each row
  execute function private.tg_platform_clinic_status_events_append_only();

drop trigger if exists trg_platform_clinic_status_events_no_delete
  on private.platform_clinic_status_events;
create trigger trg_platform_clinic_status_events_no_delete
  before delete on private.platform_clinic_status_events
  for each row
  execute function private.tg_platform_clinic_status_events_append_only();

revoke all on function private.tg_platform_clinic_status_events_append_only()
  from public, anon, authenticated, service_role;


-- ── 3) Predicado central ────────────────────────────────────────────────────────────
create or replace function private.clinic_is_operational(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clinics c
     where c.id = p_clinic_id
       and c.status = 'active'
  )
$$;

comment on function private.clinic_is_operational(uuid) is
  'PLATFORM-02: clinic exists AND status=active. NULL/missing/suspended → false. Fail-closed.';

revoke all on function private.clinic_is_operational(uuid)
  from public, anon, service_role;
grant execute on function private.clinic_is_operational(uuid) to authenticated;


-- ── 4) Guard de colunas de status (só RPC PA) ───────────────────────────────────────
create or replace function private.tg_clinics_status_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (
       new.status is distinct from old.status
       or new.status_changed_at is distinct from old.status_changed_at
       or new.status_reason is distinct from old.status_reason
     )
     and current_setting('vertexa.clinic_status_rpc', true) is distinct from '1'
  then
    raise exception 'clinic status columns are RPC-only'
      using errcode = '42501', hint = 'CLINIC_STATUS_RPC_ONLY';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinics_status_guard on public.clinics;
create trigger trg_clinics_status_guard
  before update on public.clinics
  for each row
  execute function private.tg_clinics_status_guard();

revoke all on function private.tg_clinics_status_guard()
  from public, anon, authenticated, service_role;


-- ── 5) Grafo de autorização — owner TAMBÉM perde operação ───────────────────────────
create or replace function private.is_clinic_admin(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic is not null
    and private.clinic_is_operational(p_clinic)
    and (
      exists(
        select 1 from public.clinics c
         where c.id = p_clinic
           and c.owner_profile_id = private.current_profile_id()
      )
      or exists(
        select 1 from public.professionals pr
         where pr.clinic_id = p_clinic
           and pr.clinic_role = 'admin'
           and pr.profile_id = private.current_profile_id()
           and coalesce(pr.status, 'active') = 'active'
      )
    )
$$;

comment on function private.is_clinic_admin(uuid) is
  'PLATFORM-02: owner E admin profissional exigem clinic_is_operational. '
  'Suspensão retira autoridade operacional do dono. Sem bypass de Platform Admin.';

create or replace function private.owns_professional(p_prof uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.professionals pr
     where pr.id = p_prof
       and pr.profile_id = private.current_profile_id()
       and coalesce(pr.status, 'active') = 'active'
       and private.clinic_is_operational(pr.clinic_id)
  )
$$;

create or replace function private.is_clinic_staff(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic is not null
    and private.clinic_is_operational(p_clinic)
    and (
      private.is_clinic_admin(p_clinic)
      or exists(
        select 1 from public.professionals pr
         where pr.clinic_id = p_clinic
           and pr.profile_id = private.current_profile_id()
           and coalesce(pr.status, 'active') = 'active'
      )
    )
$$;

create or replace function private.is_common_professional_of_patient(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
      from public.professional_patient_links l
      join public.professionals pr on pr.id = l.professional_id
     where l.patient_id = p_patient
       and coalesce(l.status, 'active') = 'active'
       and coalesce(l.is_external, false) = false
       and pr.profile_id = private.current_profile_id()
       and coalesce(pr.status, 'active') = 'active'
       and private.clinic_is_operational(pr.clinic_id)
  )
$$;

create or replace function private.is_external_professional_of_patient(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
      from public.professional_patient_links l
      join public.professionals pr on pr.id = l.professional_id
     where l.patient_id = p_patient
       and coalesce(l.status, 'active') = 'active'
       and coalesce(l.is_external, false) = true
       and pr.profile_id = private.current_profile_id()
       and coalesce(pr.status, 'active') = 'active'
       and private.clinic_is_operational(pr.clinic_id)
  )
$$;

create or replace function private.is_clinic_member(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic is not null
    and private.clinic_is_operational(p_clinic)
    and (
      private.is_clinic_admin(p_clinic)
      or exists(
        select 1 from public.professionals pr
         where pr.clinic_id = p_clinic
           and pr.profile_id = private.current_profile_id()
           and coalesce(pr.status, 'active') = 'active'
      )
      or exists(
        select 1 from public.patients pt
         where pt.clinic_id = p_clinic
           and pt.profile_id = private.current_profile_id()
      )
    )
$$;

comment on function private.is_clinic_member(uuid) is
  'PLATFORM-02: membro só se a clínica estiver operational. '
  'Paciente de clínica suspensa NÃO lê clinics (join_code). Identidade via is_self_patient / RPC.';

create or replace function private.can_access_patient(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.clinic_is_operational(private.patient_clinic(p_patient))
     and (
       private.is_self_patient(p_patient)
       or private.is_common_professional_of_patient(p_patient)
       or private.is_external_professional_of_patient(p_patient)
       or private.is_clinic_admin(private.patient_clinic(p_patient))
     )
$$;

create or replace function private.can_access_patient_internal(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.clinic_is_operational(private.patient_clinic(p_patient))
     and (
       private.is_self_patient(p_patient)
       or private.is_common_professional_of_patient(p_patient)
       or private.is_clinic_admin(private.patient_clinic(p_patient))
     )
$$;

create or replace function private.can_see_profile(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_target = private.current_profile_id()
    or exists(
      select 1 from public.patients pt
       where pt.profile_id = p_target
         and private.can_access_patient(pt.id)
    )
    or exists(
      select 1 from public.professionals pr
       where pr.profile_id = p_target
         and private.is_clinic_admin(pr.clinic_id)
    )
    or exists(
      select 1
        from public.professional_patient_links l
        join public.professionals pr on pr.id = l.professional_id
        join public.patients pt on pt.id = l.patient_id
       where pr.profile_id = p_target
         and pt.profile_id = private.current_profile_id()
         and coalesce(l.status, 'active') = 'active'
         and private.clinic_is_operational(pt.clinic_id)
    )
$$;

create or replace function private.is_channel_participant(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
      from public.chat_participants cp
      join public.chat_channels ch on ch.id = cp.channel_id
     where cp.channel_id = p_channel
       and cp.profile_id = private.current_profile_id()
       and private.clinic_is_operational(private.patient_clinic(ch.patient_id))
  )
$$;

-- can_read_channel / can_prescribe / can_write_discipline herdam via helpers acima.


-- ── 6) Policies de identidade / self-write ──────────────────────────────────────────
-- Paciente continua lendo a PRÓPRIA linha (identidade). Dado clínico extra via can_access.
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
  for select to authenticated
  using (private.is_self_patient(id) or private.can_access_patient(id));

drop policy if exists weight_logs_insert_self on public.weight_logs;
create policy weight_logs_insert_self on public.weight_logs
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists activity_events_insert_self on public.activity_events;
create policy activity_events_insert_self on public.activity_events
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists activity_sessions_insert_self on public.activity_sessions;
create policy activity_sessions_insert_self on public.activity_sessions
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists meal_logs_insert_self on public.meal_logs;
create policy meal_logs_insert_self on public.meal_logs
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists meal_logs_delete_self on public.meal_logs;
create policy meal_logs_delete_self on public.meal_logs
  for delete to authenticated
  using (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists supplement_intakes_insert_self on public.supplement_intakes;
create policy supplement_intakes_insert_self on public.supplement_intakes
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists supplement_intakes_delete_self on public.supplement_intakes;
create policy supplement_intakes_delete_self on public.supplement_intakes
  for delete to authenticated
  using (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists muscle_states_insert_self on public.muscle_recovery_states;
create policy muscle_states_insert_self on public.muscle_recovery_states
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists muscle_states_update_self on public.muscle_recovery_states;
create policy muscle_states_update_self on public.muscle_recovery_states
  for update to authenticated
  using (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  )
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists adherence_insert_self on public.adherence_snapshots;
create policy adherence_insert_self on public.adherence_snapshots
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists wsl_insert_self on public.workout_session_logs;
create policy wsl_insert_self on public.workout_session_logs
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists wset_insert_self on public.workout_set_logs;
create policy wset_insert_self on public.workout_set_logs
  for insert to authenticated
  with check (
    private.is_self_patient(private.session_log_patient(session_log_id))
    and private.clinic_is_operational(
      private.patient_clinic(private.session_log_patient(session_log_id))
    )
  );

drop policy if exists progress_photos_insert_self on public.progress_photos;
create policy progress_photos_insert_self on public.progress_photos
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

drop policy if exists patient_achievements_insert_self on public.patient_achievements;
create policy patient_achievements_insert_self on public.patient_achievements
  for insert to authenticated
  with check (
    private.is_self_patient(patient_id)
    and private.clinic_is_operational(private.patient_clinic(patient_id))
  );

-- Signed URLs já emitidas (TTL curto, criadas no clique) NÃO são invalidadas:
-- a infra atual não tem denylist. Risco residual até o TTL expirar.
drop policy if exists storage_progress_photos_insert_self on storage.objects;
create policy storage_progress_photos_insert_self on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and private.storage_object_patient(name) = private.current_patient_id()
    and private.clinic_is_operational(private.patient_clinic(private.current_patient_id()))
  );


-- ── 7) RPCs Platform Admin ──────────────────────────────────────────────────────────
create or replace function public.suspend_platform_clinic(
  p_clinic_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_profile_id();
  v_from text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null or not private.is_platform_admin() then
    raise exception 'suspend_platform_clinic: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;
  if p_clinic_id is null then
    raise exception 'suspend_platform_clinic: clinic id required'
      using errcode = '22023', hint = 'CLINIC_ID_REQUIRED';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'suspend_platform_clinic: reason required'
      using errcode = '22023', hint = 'REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(90204, hashtext(p_clinic_id::text));

  select c.status
    into v_from
    from public.clinics c
   where c.id = p_clinic_id
     for update;

  if v_from is null then
    raise exception 'suspend_platform_clinic: clinic not found'
      using errcode = 'P0002', hint = 'CLINIC_NOT_FOUND';
  end if;
  if v_from is not distinct from 'suspended' then
    raise exception 'suspend_platform_clinic: already suspended'
      using errcode = '22023', hint = 'CLINIC_ALREADY_SUSPENDED';
  end if;

  perform set_config('vertexa.clinic_status_rpc', '1', true);

  update public.clinics c
     set status = 'suspended',
         status_changed_at = now(),
         status_reason = v_reason
   where c.id = p_clinic_id;

  insert into private.platform_clinic_status_events (
    clinic_id, actor_profile_id, from_status, to_status, reason
  ) values (
    p_clinic_id, v_actor, v_from, 'suspended', v_reason
  );
end;
$$;

comment on function public.suspend_platform_clinic(uuid, text) is
  'PLATFORM-02: PA only. active→suspended. Reason obrigatório. 1 event. FOR UPDATE + advisory 90204. '
  'Não altera billing, professionals.status, links, patients.';

revoke all on function public.suspend_platform_clinic(uuid, text) from public, anon;
grant execute on function public.suspend_platform_clinic(uuid, text) to authenticated;


create or replace function public.reactivate_platform_clinic(
  p_clinic_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_profile_id();
  v_from text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not private.is_platform_admin() then
    raise exception 'reactivate_platform_clinic: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;
  if p_clinic_id is null then
    raise exception 'reactivate_platform_clinic: clinic id required'
      using errcode = '22023', hint = 'CLINIC_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(90204, hashtext(p_clinic_id::text));

  select c.status
    into v_from
    from public.clinics c
   where c.id = p_clinic_id
     for update;

  if v_from is null then
    raise exception 'reactivate_platform_clinic: clinic not found'
      using errcode = 'P0002', hint = 'CLINIC_NOT_FOUND';
  end if;
  if v_from is not distinct from 'active' then
    raise exception 'reactivate_platform_clinic: already active'
      using errcode = '22023', hint = 'CLINIC_ALREADY_ACTIVE';
  end if;

  perform set_config('vertexa.clinic_status_rpc', '1', true);

  update public.clinics c
     set status = 'active',
         status_changed_at = now(),
         status_reason = v_reason
   where c.id = p_clinic_id;

  insert into private.platform_clinic_status_events (
    clinic_id, actor_profile_id, from_status, to_status, reason
  ) values (
    p_clinic_id, v_actor, v_from, 'active', v_reason
  );
end;
$$;

comment on function public.reactivate_platform_clinic(uuid, text) is
  'PLATFORM-02: PA only. suspended→active. Reason opcional. NÃO altera lifecycle interno '
  '(professional.status, links, patients). Não toca billing.';

revoke all on function public.reactivate_platform_clinic(uuid, text) from public, anon;
grant execute on function public.reactivate_platform_clinic(uuid, text) to authenticated;


-- ── 8) list_platform_clinics — projeção mínima + status ─────────────────────────────
drop function if exists public.list_platform_clinics();

create function public.list_platform_clinics()
returns table (
  clinic_id uuid,
  clinic_name text,
  created_at timestamptz,
  owner_profile_id uuid,
  professional_count bigint,
  patient_count bigint,
  status text,
  status_changed_at timestamptz,
  status_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'list_platform_clinics: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  return query
  select
    c.id,
    c.name,
    c.created_at,
    c.owner_profile_id,
    (select count(*) from public.professionals pr where pr.clinic_id = c.id),
    (select count(*) from public.patients pt where pt.clinic_id = c.id),
    c.status,
    c.status_changed_at,
    c.status_reason
  from public.clinics c
  order by c.created_at asc nulls last, c.id;
end;
$$;

comment on function public.list_platform_clinics() is
  'PLATFORM-02: catálogo PA + lifecycle. Sem join_code, sem dado clínico.';

revoke all on function public.list_platform_clinics() from public, anon;
grant execute on function public.list_platform_clinics() to authenticated;


-- ── 9) my_clinic_memberships + get_my_clinic_access_state ───────────────────────────
drop function if exists public.my_clinic_memberships();

create function public.my_clinic_memberships()
returns table(
  clinic_id uuid,
  clinic_name text,
  status text,
  clinic_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
begin
  if v_me is null then
    return;
  end if;

  return query
    select pr.clinic_id,
           c.name,
           coalesce(pr.status, 'active'),
           c.status
      from public.professionals pr
      join public.clinics c on c.id = pr.clinic_id
     where pr.profile_id = v_me
     order by c.name nulls last;
end;
$$;

comment on function public.my_clinic_memberships() is
  'PLATFORM-02: clinic_id, nome, status do PROFISSIONAL, clinic_status. Sem join_code.';

revoke all on function public.my_clinic_memberships() from public, anon;
grant execute on function public.my_clinic_memberships() to authenticated;


create or replace function public.get_my_clinic_access_state()
returns table(
  clinic_id uuid,
  clinic_name text,
  clinic_status text,
  access_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
begin
  if v_me is null then
    clinic_id := null;
    clinic_name := null;
    clinic_status := null;
    access_state := 'none';
    return next;
    return;
  end if;

  select c.id, c.name, c.status
    into clinic_id, clinic_name, clinic_status
    from public.professionals pr
    join public.clinics c on c.id = pr.clinic_id
   where pr.profile_id = v_me
     and coalesce(pr.status, 'active') = 'active'
     and c.status = 'active'
   order by c.name nulls last
   limit 1;
  if clinic_id is not null then
    access_state := 'operational';
    return next;
    return;
  end if;

  select c.id, c.name, c.status
    into clinic_id, clinic_name, clinic_status
    from public.patients pt
    join public.clinics c on c.id = pt.clinic_id
   where pt.profile_id = v_me
     and c.status = 'active'
   limit 1;
  if clinic_id is not null then
    access_state := 'operational';
    return next;
    return;
  end if;

  select c.id, c.name, c.status
    into clinic_id, clinic_name, clinic_status
    from public.professionals pr
    join public.clinics c on c.id = pr.clinic_id
   where pr.profile_id = v_me
     and coalesce(pr.status, 'active') = 'active'
     and c.status = 'suspended'
   order by c.name nulls last
   limit 1;
  if clinic_id is not null then
    access_state := 'clinic_suspended';
    return next;
    return;
  end if;

  select c.id, c.name, c.status
    into clinic_id, clinic_name, clinic_status
    from public.patients pt
    join public.clinics c on c.id = pt.clinic_id
   where pt.profile_id = v_me
     and c.status = 'suspended'
   limit 1;
  if clinic_id is not null then
    access_state := 'clinic_suspended';
    return next;
    return;
  end if;

  clinic_id := null;
  clinic_name := null;
  clinic_status := null;
  access_state := 'none';
  return next;
end;
$$;

comment on function public.get_my_clinic_access_state() is
  'PLATFORM-02: WEB+APP. operational | clinic_suspended | none. Sem join_code, sem dado clínico.';

revoke all on function public.get_my_clinic_access_state() from public, anon;
grant execute on function public.get_my_clinic_access_state() to authenticated;


-- ── 10) Join: código de clínica suspensa é inválido (neutro) ─────────────────────────
create or replace function public.request_clinic_access(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_profile_id();
  v_clinic uuid;
  v_status text;
  v_name   text;
  v_email  text;
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'request_clinic_access: not authenticated' using errcode = '42501';
  end if;

  select c.id into v_clinic
    from public.clinics c
   where c.join_code = upper(btrim(coalesce(p_join_code, '')));

  if v_clinic is null or not private.clinic_is_operational(v_clinic) then
    raise exception 'request_clinic_access: invalid join code' using errcode = 'P0002';
  end if;

  select p.status, p.full_name, p.email
    into v_status, v_name, v_email
    from public.profiles p where p.id = v_caller;
  if v_status is distinct from 'pending' then
    raise exception 'request_clinic_access: caller is not pending' using errcode = '22023';
  end if;

  select r.id into v_id
    from public.clinic_join_requests r
   where r.profile_id = v_caller and r.clinic_id = v_clinic and r.status = 'pending';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.clinic_join_requests
    (profile_id, clinic_id, requester_name, requester_email)
  values (v_caller, v_clinic, v_name, v_email)
  returning id into v_id;

  return v_id;
end;
$$;


-- ── 11) Care team + métricas + SOS + recovery ───────────────────────────────────────
create or replace function public.get_my_care_team()
returns table (
  professional_id uuid,
  profile_id uuid,
  display_name text,
  avatar_url text,
  type public.professional_type,
  specialty text,
  disciplines text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.profile_id,
    pf.full_name,
    pf.avatar_url,
    pr.type,
    pr.specialty,
    coalesce(
      (
        select array_agg(distinct pd.discipline order by pd.discipline)
          from public.professional_disciplines pd
          join public.disciplines d on d.code = pd.discipline
         where pd.professional_id = pr.id
      ),
      '{}'::text[]
    )
  from public.professional_patient_links l
  join public.professionals pr on pr.id = l.professional_id
  join public.profiles pf on pf.id = pr.profile_id
  where l.patient_id = private.current_patient_id()
    and coalesce(l.status, 'active') = 'active'
    and coalesce(l.is_external, false) = false
    and coalesce(pr.status, 'active') = 'active'
    and private.clinic_is_operational(pr.clinic_id)
  order by pf.full_name nulls last, pr.id;
$$;


create or replace function public.recompute_adherence()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid := private.current_patient_id();
begin
  if v_patient is null then
    raise exception 'recompute_adherence: not a patient / not authenticated' using errcode = '42501';
  end if;
  if not private.clinic_is_operational(private.patient_clinic(v_patient)) then
    raise exception 'recompute_adherence: clinic is not operational'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  perform private.recompute_adherence_for(v_patient);
end $$;


create or replace function public.recompute_achievements()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid := private.current_patient_id();
  v_workout_days int := 0;
  v_streak int;
  v_start numeric; v_current numeric; v_target numeric;
  v_kg_lost numeric; v_reached boolean;
  v_codes text[] := array[]::text[];
begin
  if v_patient is null then
    raise exception 'recompute_achievements: not a patient / not authenticated' using errcode = '42501';
  end if;
  if not private.clinic_is_operational(private.patient_clinic(v_patient)) then
    raise exception 'recompute_achievements: clinic is not operational'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;

  with ev as (
    select type, private.brt_date(created_at) as d
    from public.activity_events where patient_id = v_patient order by created_at desc limit 500
  )
  select count(distinct d) filter (where type = 'workout_checked') into v_workout_days from ev;
  v_streak := private.event_streak_brt(v_patient);

  select start_weight, current_weight, target_weight into v_start, v_current, v_target
  from public.patients where id = v_patient;
  v_kg_lost := case when v_start is not null and v_current is not null then greatest(0, v_start - v_current) else 0 end;
  v_reached := case when v_current is not null and v_target is not null then v_current <= v_target else false end;

  if v_workout_days >= 1 then v_codes := array_append(v_codes, 'first_workout'); end if;
  if exists (select 1 from public.weight_logs        where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_weight'); end if;
  if exists (select 1 from public.progress_photos    where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_photo'); end if;
  if exists (select 1 from public.meal_logs          where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_meal_day'); end if;
  if exists (select 1 from public.activity_sessions  where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_activity'); end if;
  if exists (select 1 from public.supplement_intakes where patient_id = v_patient) then v_codes := array_append(v_codes, 'first_supplement'); end if;
  if v_streak >= 7  then v_codes := array_append(v_codes, 'streak_7');  end if;
  if v_streak >= 14 then v_codes := array_append(v_codes, 'streak_14'); end if;
  if v_streak >= 30 then v_codes := array_append(v_codes, 'streak_30'); end if;
  if v_kg_lost >= 3 then v_codes := array_append(v_codes, 'weight_3kg'); end if;
  if v_kg_lost >= 5 then v_codes := array_append(v_codes, 'weight_5kg'); end if;
  if v_reached      then v_codes := array_append(v_codes, 'weight_target'); end if;

  if array_length(v_codes, 1) is null then return; end if;

  insert into public.patient_achievements (patient_id, achievement_code, source)
  select v_patient, code, 'engine' from unnest(v_codes) as code
  on conflict (patient_id, achievement_code) do nothing;
end $$;


create or replace function private.recompute_adherence_all()
returns table(
  seen int,
  succeeded int,
  changed int,
  unchanged int,
  failed int
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  v_seen int := 0;
  v_ok int := 0;
  v_changed int := 0;
  v_unchanged int := 0;
  v_failed int := 0;
  v_antes int;
  v_depois int;
begin
  for r in
    select distinct s.patient_id
      from public.adherence_snapshots s
      join public.patients pt on pt.id = s.patient_id
     where s.patient_id is not null
       and private.clinic_is_operational(pt.clinic_id)
     order by s.patient_id
  loop
    v_seen := v_seen + 1;
    select count(*) into v_antes
      from public.adherence_snapshots s
     where s.patient_id = r.patient_id;
    begin
      perform private.recompute_adherence_for(r.patient_id);
      v_ok := v_ok + 1;
      select count(*) into v_depois
        from public.adherence_snapshots s
       where s.patient_id = r.patient_id;
      if v_depois > v_antes then
        v_changed := v_changed + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'WP-08B1 recompute_adherence_all: patient failed sqlstate=%', sqlstate;
    end;
  end loop;

  seen := v_seen;
  succeeded := v_ok;
  changed := v_changed;
  unchanged := v_unchanged;
  failed := v_failed;
  return next;
end;
$$;

revoke all on function private.recompute_adherence_all() from public, anon, authenticated;


create or replace function private.recompute_recovery_decay()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.muscle_recovery_states s
     set status = private.recovery_status_for_days(private.days_ago_brt(s.last_trained_at, now())),
         calculated_at = now()
    from public.patients pt
   where s.patient_id = pt.id
     and private.clinic_is_operational(pt.clinic_id)
     and s.status is distinct from private.recovery_status_for_days(private.days_ago_brt(s.last_trained_at, now()))
$$;


create or replace function private.recompute_recovery_on_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_workout uuid;
  v_muscles text[];
  v_trained_at timestamptz := coalesce(NEW.created_at, now());
  m text;
begin
  if not private.clinic_is_operational(private.patient_clinic(NEW.patient_id)) then
    return NEW;
  end if;
  begin
    v_workout := (NEW.payload->>'workoutId')::uuid;
  exception when others then
    return NEW;
  end;
  if v_workout is null then return NEW; end if;

  v_muscles := private.canonical_muscles_for_workout(v_workout);
  if array_length(v_muscles, 1) is null then return NEW; end if;

  foreach m in array v_muscles loop
    insert into public.muscle_recovery_states
      (patient_id, muscle_group, last_trained_at, last_intensity, status, calculated_at)
    values (NEW.patient_id, m, v_trained_at, 70,
            private.recovery_status_for_days(private.days_ago_brt(v_trained_at, now())), now())
    on conflict (patient_id, muscle_group) do update
      set last_trained_at = excluded.last_trained_at,
          last_intensity  = excluded.last_intensity,
          status          = excluded.status,
          calculated_at   = excluded.calculated_at;
  end loop;
  return NEW;
end $$;


create or replace function private.tg_chat_messages_fanout_staff_help_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
  v_clinic uuid;
  v_patient_profile uuid;
begin
  if tg_op is distinct from 'INSERT' then
    return new;
  end if;

  if new.sender_role is distinct from 'patient'::public.user_role then
    return new;
  end if;
  if new.channel_id is null or new.sender_profile_id is null then
    return new;
  end if;

  select cc.patient_id
    into v_patient
    from public.chat_channels cc
   where cc.id = new.channel_id;
  if v_patient is null then
    return new;
  end if;

  select pt.profile_id, pt.clinic_id
    into v_patient_profile, v_clinic
    from public.patients pt
   where pt.id = v_patient;
  if v_patient_profile is null
     or v_patient_profile is distinct from new.sender_profile_id then
    return new;
  end if;
  if v_clinic is null then
    return new;
  end if;
  if not private.clinic_is_operational(v_clinic) then
    return new;
  end if;

  if not private.staff_help_request_body_matches(new.body) then
    return new;
  end if;

  insert into public.staff_notifications (
    clinic_id,
    recipient_profile_id,
    actor_profile_id,
    patient_id,
    channel_id,
    message_id,
    type,
    severity
  )
  select
    v_clinic,
    r.profile_id,
    new.sender_profile_id,
    v_patient,
    new.channel_id,
    new.id,
    'help_requested',
    'critical'
  from private.staff_help_request_recipient_profile_ids(v_patient) r
  on conflict (type, message_id, recipient_profile_id) do nothing;

  return new;
end;
$$;


-- ── 12) Explicit DEFINER checks (save/media/channel/create_patient) ──────────────────
-- save_* / media herdam via can_write_discipline / can_prescribe / can_access_patient_internal.
-- create_patient NÃO: o lookup cru da row em professionals ignorava clinic_is_operational.

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
declare
  v_caller_profile uuid := private.current_profile_id();
  v_caller_prof uuid;
  v_profile_id uuid;
  v_patient_id uuid;
  v_email text;
  v_match_count int;
  v_auth_user_id uuid;
  v_claim_count int;
  v_claim_profile uuid;
begin
  if v_caller_profile is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if btrim(coalesce(p_full_name,'')) = '' then raise exception 'full_name required' using errcode = '22023'; end if;
  if p_clinic_id is null then raise exception 'clinic_id required' using errcode = '22023'; end if;
  if p_start_date is not null and p_start_date > current_date then
    raise exception 'create_patient: p_start_date cannot be in the future' using errcode = '22023';
  end if;
  -- PLATFORM-02: staff-row lookup sozinho NÃO fecha suspensão. is_clinic_staff exige operational.
  if not private.clinic_is_operational(p_clinic_id)
     or not private.is_clinic_staff(p_clinic_id) then
    raise exception 'forbidden: caller is not staff of clinic'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  select pr.id into v_caller_prof
    from public.professionals pr
   where pr.clinic_id = p_clinic_id
     and pr.profile_id = v_caller_profile
     and coalesce(pr.status, 'active') = 'active'
   limit 1;

  v_email := nullif(btrim(coalesce(p_email,'')),'');

  if v_email is not null then
    select count(*)
      into v_claim_count
    from public.profiles p
    where p.email is not null
      and lower(btrim(p.email)) = lower(btrim(v_email))
      and p.auth_user_id is not null
      and p.role = 'patient'
      and p.status = 'pending'
      and not exists (select 1 from public.patients pt where pt.profile_id = p.id)
      and not exists (select 1 from public.professionals pr where pr.profile_id = p.id);

    if v_claim_count = 1 then
      select p.id
        into v_claim_profile
      from public.profiles p
      where p.email is not null
        and lower(btrim(p.email)) = lower(btrim(v_email))
        and p.auth_user_id is not null
        and p.role = 'patient'
        and p.status = 'pending'
        and not exists (select 1 from public.patients pt where pt.profile_id = p.id)
        and not exists (select 1 from public.professionals pr where pr.profile_id = p.id)
      limit 1
      for update;
    end if;
  end if;

  if v_claim_profile is not null then
    update public.profiles
       set full_name = btrim(p_full_name),
           status    = 'active'
     where id = v_claim_profile
    returning id into v_profile_id;
  else
    if v_email is not null then
      select count(*)
        into v_match_count
      from auth.users u
      where u.email is not null
        and lower(btrim(u.email)) = lower(btrim(v_email))
        and u.email_confirmed_at is not null
        and (coalesce(u.raw_app_meta_data ->> 'provider' = 'google', false)
             or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google')
        and not exists (select 1 from public.profiles p where p.auth_user_id = u.id);

      if v_match_count = 1 then
        select u.id
          into v_auth_user_id
        from auth.users u
        where u.email is not null
          and lower(btrim(u.email)) = lower(btrim(v_email))
          and u.email_confirmed_at is not null
          and (coalesce(u.raw_app_meta_data ->> 'provider' = 'google', false)
               or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google')
          and not exists (select 1 from public.profiles p where p.auth_user_id = u.id)
        limit 1;
      end if;
    end if;

    begin
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (v_auth_user_id, 'patient', btrim(p_full_name), v_email, 'active')
      returning id into v_profile_id;
    exception when unique_violation then
      if v_auth_user_id is null then raise; end if;
      v_auth_user_id := null;
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (null, 'patient', btrim(p_full_name), v_email, 'active')
      returning id into v_profile_id;
    end;
  end if;

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


create or replace function public.get_or_create_channel(p_patient_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel uuid;
begin
  if p_patient_id is null then
    raise exception 'Paciente nao informado.' using errcode = '22023';
  end if;

  if not private.clinic_is_operational(private.patient_clinic(p_patient_id))
     or not private.can_access_patient_internal(p_patient_id) then
    raise exception 'Sem acesso a este paciente.' using errcode = '42501';
  end if;

  insert into public.chat_channels (patient_id)
  values (p_patient_id)
  on conflict (patient_id) do nothing;

  select cc.id
    into v_channel
    from public.chat_channels cc
   where cc.patient_id = p_patient_id;

  if v_channel is null then
    raise exception 'Nao foi possivel obter o canal do paciente.' using errcode = 'P0001';
  end if;

  perform private.sync_existing_channel_roster(p_patient_id);

  return v_channel;
end;
$$;


-- ── 12b) S37 — clínica suspensa NÃO é “sem clínica” ─────────────────────────────────
-- create_clinic_with_owner no remoto é PLATFORM-01R (não substituir o corpo).
-- O INSERT em clinics é o ponto único: se o owner já tem membership, recusa.
create or replace function private.tg_clinics_owner_must_be_clinicless()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op is distinct from 'INSERT' then
    return new;
  end if;
  if new.owner_profile_id is not null
     and exists (
       select 1
         from public.professionals pr
        where pr.profile_id = new.owner_profile_id
     )
  then
    raise exception 'create clinic: profile already has a clinic membership'
      using errcode = '42501', hint = 'ALREADY_HAS_CLINIC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinics_owner_must_be_clinicless on public.clinics;
create trigger trg_clinics_owner_must_be_clinicless
  before insert on public.clinics
  for each row
  execute function private.tg_clinics_owner_must_be_clinicless();

revoke all on function private.tg_clinics_owner_must_be_clinicless()
  from public, anon, authenticated, service_role;

do $s37$
begin
  if to_regclass('private.clinic_creation_requests') is null then
    raise notice 'PLATFORM-02: clinic_creation_requests ausente — skip S37 request trigger';
    return;
  end if;

  execute $fn$
    create or replace function private.tg_clinic_creation_requests_must_be_clinicless()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $t$
    begin
      if new.requester_profile_id is not null
         and exists (
           select 1
             from public.professionals pr
            where pr.profile_id = new.requester_profile_id
         )
      then
        raise exception 'request clinic: profile already has a clinic membership'
          using errcode = '42501', hint = 'ALREADY_HAS_CLINIC';
      end if;
      return new;
    end;
    $t$;
  $fn$;

  execute 'drop trigger if exists trg_clinic_creation_requests_must_be_clinicless on private.clinic_creation_requests';
  execute $tr$
    create trigger trg_clinic_creation_requests_must_be_clinicless
      before insert on private.clinic_creation_requests
      for each row
      execute function private.tg_clinic_creation_requests_must_be_clinicless()
  $tr$;
  execute 'revoke all on function private.tg_clinic_creation_requests_must_be_clinicless() from public, anon, authenticated, service_role';
end;
$s37$;


-- ── 13) Log ─────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260903090000',
  '20260903090000_wp_platform_02_clinic_lifecycle.sql',
  'PLATFORM-02: clinics.status active|suspended, audit append-only, clinic_is_operational '
  'no grafo clínico (owner incluso), RPCs PA suspend/reactivate, list/memberships/access_state, '
  'join/VRI/SOS/calendar-ready. Sem Asaas. Sem status_changed_by em clinics. UPDATE(name) preservado.',
  'PLATFORM-02'
)
on conflict (version) do nothing;
