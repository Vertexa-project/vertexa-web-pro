-- =====================================================================================
-- PLATFORM-01 — governança global de onboarding de clínicas.
--
-- Política persistida (não .env): automatic | manual_review | closed.
-- Default fail-closed: closed.
-- Fila explícita: private.clinic_creation_requests.
--   NÃO usa profiles.status='pending' como fila (pacientes também passam por pending).
-- Grants: reutiliza private.clinic_creation_authorizations (SEC-02).
--   source novo: platform_policy (só o backend escreve; cliente não envia source).
-- Criação final: o usuário continua sendo o ator de create_clinic_with_owner.
--
-- Rollback manual (não aplicar automaticamente):
--   drop function public.get_clinic_onboarding_state();
--   drop function public.get_platform_clinic_onboarding_settings();
--   drop function public.set_clinic_onboarding_policy(text);
--   drop function public.request_clinic_creation(text);
--   drop function public.list_clinic_creation_requests();
--   drop function public.approve_clinic_creation_request(uuid);
--   drop function public.reject_clinic_creation_request(uuid, text);
--   drop function private.issue_clinic_creation_grant(uuid, text, uuid);
--   drop function private.clinic_onboarding_mode();
--   drop table private.clinic_creation_requests;
--   drop table private.clinic_onboarding_policy;
--   restaurar CHECK source para ('platform_admin','asaas');
--   restaurar authorize_clinic_creation + create_clinic_with_owner de 20260829090000.
-- =====================================================================================

create table private.clinic_onboarding_policy (
  id boolean primary key default true,
  mode text not null,
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  constraint clinic_onboarding_policy_singleton check (id = true),
  constraint clinic_onboarding_policy_mode_check
    check (mode in ('automatic', 'manual_review', 'closed'))
);

comment on table private.clinic_onboarding_policy is
  'PLATFORM-01: singleton da política global de entrada de clínicas. '
  'Schema private — sem PostgREST. Default closed (fail-closed).';

comment on column private.clinic_onboarding_policy.mode is
  'automatic | manual_review | closed. Só Platform Admin altera via RPC.';

insert into private.clinic_onboarding_policy (id, mode, updated_at, updated_by_profile_id)
values (true, 'closed', now(), null)
on conflict (id) do nothing;

alter table private.clinic_onboarding_policy enable row level security;

revoke all on table private.clinic_onboarding_policy
  from public, anon, authenticated, service_role;


create table private.clinic_creation_requests (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_clinic_name text not null,
  status text not null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  authorization_id uuid references private.clinic_creation_authorizations(id) on delete set null,
  created_clinic_id uuid references public.clinics(id) on delete set null,
  constraint clinic_creation_requests_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint clinic_creation_requests_name_len
    check (char_length(btrim(requested_clinic_name)) between 2 and 120),
  constraint clinic_creation_requests_reason_len
    check (rejection_reason is null or char_length(rejection_reason) <= 500),
  constraint clinic_creation_requests_decision_check
    check (
      (
        status = 'pending'
        and decided_at is null
        and decided_by_profile_id is null
        and rejection_reason is null
        and authorization_id is null
        and created_clinic_id is null
      )
      or (
        status = 'approved'
        and decided_at is not null
        and rejection_reason is null
      )
      or (
        status = 'rejected'
        and decided_at is not null
        and decided_by_profile_id is not null
        and authorization_id is null
        and created_clinic_id is null
      )
    )
);

comment on table private.clinic_creation_requests is
  'PLATFORM-01: solicitação explícita de criação de clínica. '
  'Não confundir com profiles.status=pending nem com clinic_join_requests.';

create unique index clinic_creation_requests_one_pending_idx
  on private.clinic_creation_requests (requester_profile_id)
  where status = 'pending';

create index clinic_creation_requests_requester_idx
  on private.clinic_creation_requests (requester_profile_id, requested_at desc);

create index clinic_creation_requests_status_idx
  on private.clinic_creation_requests (status, requested_at desc);

alter table private.clinic_creation_requests enable row level security;

revoke all on table private.clinic_creation_requests
  from public, anon, authenticated, service_role;


alter table private.clinic_creation_authorizations
  drop constraint clinic_creation_authorizations_source_check;

alter table private.clinic_creation_authorizations
  add constraint clinic_creation_authorizations_source_check
    check (source in ('platform_admin', 'asaas', 'platform_policy'));

alter table private.clinic_creation_authorizations
  add constraint clinic_creation_authorizations_policy_grantor_check
    check (source <> 'platform_policy' or granted_by_profile_id is null);

comment on column private.clinic_creation_authorizations.source is
  'platform_admin | asaas (reservado) | platform_policy (PLATFORM-01, só backend).';


create or replace function private.clinic_onboarding_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.mode from private.clinic_onboarding_policy p where p.id = true),
    'closed'
  );
$$;

comment on function private.clinic_onboarding_mode() is
  'PLATFORM-01: lê o modo vigente. Linha ausente ⇒ closed (fail-closed).';

revoke all on function private.clinic_onboarding_mode()
  from public, anon, authenticated, service_role;


create or replace function private.issue_clinic_creation_grant(
  p_target_profile_id uuid,
  p_source text,
  p_granted_by_profile_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source text := btrim(coalesce(p_source, ''));
  v_grantor uuid := p_granted_by_profile_id;
  v_expires timestamptz := clock_timestamp() + interval '7 days';
  v_id uuid;
  v_auth_uid uuid;
  v_status text;
begin
  if v_source is distinct from 'platform_admin' and v_source is distinct from 'platform_policy' then
    raise exception 'issue_clinic_creation_grant: invalid source'
      using errcode = '22023', hint = 'INVALID_GRANT_SOURCE';
  end if;

  if v_source = 'platform_policy' then
    v_grantor := null;
  elsif v_grantor is null then
    raise exception 'issue_clinic_creation_grant: grantor required'
      using errcode = '42501', hint = 'GRANTOR_REQUIRED';
  end if;

  if p_target_profile_id is null then
    raise exception 'issue_clinic_creation_grant: target required'
      using errcode = '22023', hint = 'TARGET_REQUIRED';
  end if;

  select pr.auth_user_id, pr.status
    into v_auth_uid, v_status
    from public.profiles pr
   where pr.id = p_target_profile_id;

  if not found then
    raise exception 'issue_clinic_creation_grant: target profile not found'
      using errcode = '22023', hint = 'TARGET_NOT_FOUND';
  end if;

  if v_auth_uid is null then
    raise exception 'issue_clinic_creation_grant: target has no auth user'
      using errcode = '22023', hint = 'TARGET_NOT_USABLE';
  end if;

  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'issue_clinic_creation_grant: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  if exists (
    select 1
      from public.clinics c
     where c.owner_profile_id = p_target_profile_id
  ) then
    raise exception 'issue_clinic_creation_grant: target already owns a clinic'
      using errcode = '42501', hint = 'TARGET_ALREADY_OWNS_CLINIC';
  end if;

  insert into private.clinic_creation_authorizations (
    target_profile_id,
    granted_by_profile_id,
    source,
    granted_at,
    expires_at
  ) values (
    p_target_profile_id,
    v_grantor,
    v_source,
    clock_timestamp(),
    v_expires
  )
  on conflict (target_profile_id) where consumed_at is null
  do update set
    granted_by_profile_id = excluded.granted_by_profile_id,
    source = excluded.source,
    granted_at = excluded.granted_at,
    expires_at = excluded.expires_at
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.issue_clinic_creation_grant(uuid, text, uuid) is
  'PLATFORM-01: emite/renova grant one-time. Chamada só por RPCs SECDEF. '
  'Cliente não escolhe source.';

revoke all on function private.issue_clinic_creation_grant(uuid, text, uuid)
  from public, anon, authenticated, service_role;


create or replace function public.get_clinic_onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_req record;
begin
  if v_me is null then
    raise exception 'get_clinic_onboarding_state: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  select r.id, r.requested_clinic_name, r.status, r.requested_at, r.decided_at, r.rejection_reason
    into v_req
    from private.clinic_creation_requests r
   where r.requester_profile_id = v_me
   order by
     case when r.status = 'pending' then 0 when r.status = 'approved' then 1 else 2 end,
     r.requested_at desc
   limit 1;

  return jsonb_build_object(
    'mode', private.clinic_onboarding_mode(),
    'request', case
      when v_req.id is null then null
      else jsonb_build_object(
        'id', v_req.id,
        'requested_clinic_name', v_req.requested_clinic_name,
        'status', v_req.status,
        'requested_at', v_req.requested_at,
        'decided_at', v_req.decided_at,
        'rejection_reason', v_req.rejection_reason
      )
    end
  );
end;
$$;

comment on function public.get_clinic_onboarding_state() is
  'PLATFORM-01: modo vigente + solicitação do chamador. Sem dados de terceiros.';

revoke all on function public.get_clinic_onboarding_state() from public, anon;
grant execute on function public.get_clinic_onboarding_state() to authenticated;


create or replace function public.get_platform_clinic_onboarding_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_pending bigint;
begin
  if not private.is_platform_admin() then
    raise exception 'get_platform_clinic_onboarding_settings: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  select p.mode, p.updated_at, p.updated_by_profile_id, pr.full_name as updated_by_name
    into v_row
    from private.clinic_onboarding_policy p
    left join public.profiles pr on pr.id = p.updated_by_profile_id
   where p.id = true;

  select count(*)
    into v_pending
    from private.clinic_creation_requests r
   where r.status = 'pending';

  return jsonb_build_object(
    'mode', coalesce(v_row.mode, 'closed'),
    'updated_at', v_row.updated_at,
    'updated_by_profile_id', v_row.updated_by_profile_id,
    'updated_by_name', v_row.updated_by_name,
    'pending_request_count', coalesce(v_pending, 0)
  );
end;
$$;

comment on function public.get_platform_clinic_onboarding_settings() is
  'PLATFORM-01: settings da política para Platform Admin. Sem dado clínico individual.';

revoke all on function public.get_platform_clinic_onboarding_settings() from public, anon;
grant execute on function public.get_platform_clinic_onboarding_settings() to authenticated;


create or replace function public.set_clinic_onboarding_policy(p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_mode text := btrim(coalesce(p_mode, ''));
begin
  if not private.is_platform_admin() then
    raise exception 'set_clinic_onboarding_policy: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  if v_me is null then
    raise exception 'set_clinic_onboarding_policy: grantor profile missing'
      using errcode = '42501', hint = 'GRANTOR_REQUIRED';
  end if;

  if v_mode not in ('automatic', 'manual_review', 'closed') then
    raise exception 'set_clinic_onboarding_policy: invalid mode'
      using errcode = '22023', hint = 'INVALID_POLICY_MODE';
  end if;

  insert into private.clinic_onboarding_policy (id, mode, updated_at, updated_by_profile_id)
  values (true, v_mode, clock_timestamp(), v_me)
  on conflict (id) do update set
    mode = excluded.mode,
    updated_at = excluded.updated_at,
    updated_by_profile_id = excluded.updated_by_profile_id;

  return public.get_platform_clinic_onboarding_settings();
end;
$$;

comment on function public.set_clinic_onboarding_policy(text) is
  'PLATFORM-01: Platform Admin altera a política global. Auditável.';

revoke all on function public.set_clinic_onboarding_policy(text) from public, anon;
grant execute on function public.set_clinic_onboarding_policy(text) to authenticated;


create or replace function public.request_clinic_creation(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_mode text;
  v_status text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'request_clinic_creation: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90203, pg_catalog.hashtext(v_me::text));

  v_mode := private.clinic_onboarding_mode();

  if v_mode = 'closed' then
    raise exception 'request_clinic_creation: onboarding closed'
      using errcode = '42501', hint = 'ONBOARDING_CLOSED';
  end if;

  if v_mode = 'automatic' then
    raise exception 'request_clinic_creation: request not needed'
      using errcode = '42501', hint = 'REQUEST_NOT_NEEDED';
  end if;

  if exists (select 1 from public.clinics c where c.owner_profile_id = v_me) then
    raise exception 'request_clinic_creation: profile already owns a clinic'
      using errcode = '42501', hint = 'ALREADY_OWNS_CLINIC';
  end if;

  if v_name = '' then
    raise exception 'request_clinic_creation: clinic name is required'
      using errcode = '22023', hint = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'request_clinic_creation: clinic name too short (min 2)'
      using errcode = '22023', hint = 'NAME_TOO_SHORT';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'request_clinic_creation: clinic name too long (max 120)'
      using errcode = '22023', hint = 'NAME_TOO_LONG';
  end if;

  select pr.status into v_status from public.profiles pr where pr.id = v_me;
  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'request_clinic_creation: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  begin
    insert into private.clinic_creation_requests (
      requester_profile_id,
      requested_clinic_name,
      status
    ) values (
      v_me,
      v_name,
      'pending'
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'request_clinic_creation: already pending'
        using errcode = '42501', hint = 'REQUEST_ALREADY_PENDING';
  end;

  return jsonb_build_object(
    'request_id', v_id,
    'status', 'pending',
    'requested_clinic_name', v_name
  );
end;
$$;

comment on function public.request_clinic_creation(text) is
  'PLATFORM-01: usuário solicita criação. Só em manual_review. '
  'Requester = current_profile_id(). Uma pending por perfil.';

revoke all on function public.request_clinic_creation(text) from public, anon;
grant execute on function public.request_clinic_creation(text) to authenticated;


create or replace function public.list_clinic_creation_requests()
returns table (
  request_id uuid,
  requested_clinic_name text,
  requester_profile_id uuid,
  requester_name text,
  requester_email text,
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  rejection_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'list_clinic_creation_requests: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  return query
  select
    r.id,
    r.requested_clinic_name,
    r.requester_profile_id,
    pr.full_name,
    pr.email,
    r.status,
    r.requested_at,
    r.decided_at,
    r.rejection_reason
  from private.clinic_creation_requests r
  join public.profiles pr on pr.id = r.requester_profile_id
  order by
    case when r.status = 'pending' then 0 when r.status = 'approved' then 1 else 2 end,
    r.requested_at desc,
    r.id;
end;
$$;

comment on function public.list_clinic_creation_requests() is
  'PLATFORM-01: fila de solicitações para Platform Admin. '
  'Nome/e-mail do responsável — sem pacientes, chat ou dado clínico.';

revoke all on function public.list_clinic_creation_requests() from public, anon;
grant execute on function public.list_clinic_creation_requests() to authenticated;


create or replace function public.approve_clinic_creation_request(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_req record;
  v_auth uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'approve_clinic_creation_request: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  if v_me is null then
    raise exception 'approve_clinic_creation_request: grantor profile missing'
      using errcode = '42501', hint = 'GRANTOR_REQUIRED';
  end if;

  if p_request_id is null then
    raise exception 'approve_clinic_creation_request: request required'
      using errcode = '22023', hint = 'REQUEST_REQUIRED';
  end if;

  if private.clinic_onboarding_mode() = 'closed' then
    raise exception 'approve_clinic_creation_request: onboarding closed'
      using errcode = '42501', hint = 'ONBOARDING_CLOSED';
  end if;

  select r.id, r.requester_profile_id, r.status, r.authorization_id, r.requested_clinic_name
    into v_req
    from private.clinic_creation_requests r
   where r.id = p_request_id
   for update;

  if not found then
    raise exception 'approve_clinic_creation_request: request not found'
      using errcode = '22023', hint = 'REQUEST_NOT_FOUND';
  end if;

  if v_req.status = 'rejected' then
    raise exception 'approve_clinic_creation_request: request already decided'
      using errcode = '42501', hint = 'REQUEST_ALREADY_DECIDED';
  end if;

  if v_req.status = 'approved' then
    return jsonb_build_object(
      'request_id', v_req.id,
      'status', 'approved',
      'authorization_id', v_req.authorization_id,
      'requested_clinic_name', v_req.requested_clinic_name
    );
  end if;

  v_auth := private.issue_clinic_creation_grant(
    v_req.requester_profile_id,
    'platform_admin',
    v_me
  );

  update private.clinic_creation_requests
     set status = 'approved',
         decided_at = clock_timestamp(),
         decided_by_profile_id = v_me,
         authorization_id = v_auth
   where id = v_req.id;

  return jsonb_build_object(
    'request_id', v_req.id,
    'status', 'approved',
    'authorization_id', v_auth,
    'requested_clinic_name', v_req.requested_clinic_name
  );
end;
$$;

comment on function public.approve_clinic_creation_request(uuid) is
  'PLATFORM-01: PA aprova → grant SEC-02 (source=platform_admin). '
  'Não cria a clínica. Double-approve é idempotente.';

revoke all on function public.approve_clinic_creation_request(uuid) from public, anon;
grant execute on function public.approve_clinic_creation_request(uuid) to authenticated;


create or replace function public.reject_clinic_creation_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_req record;
begin
  if not private.is_platform_admin() then
    raise exception 'reject_clinic_creation_request: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  if v_me is null then
    raise exception 'reject_clinic_creation_request: grantor profile missing'
      using errcode = '42501', hint = 'GRANTOR_REQUIRED';
  end if;

  if p_request_id is null then
    raise exception 'reject_clinic_creation_request: request required'
      using errcode = '22023', hint = 'REQUEST_REQUIRED';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reject_clinic_creation_request: reason too long'
      using errcode = '22023', hint = 'REASON_TOO_LONG';
  end if;

  select r.id, r.status, r.rejection_reason, r.requested_clinic_name
    into v_req
    from private.clinic_creation_requests r
   where r.id = p_request_id
   for update;

  if not found then
    raise exception 'reject_clinic_creation_request: request not found'
      using errcode = '22023', hint = 'REQUEST_NOT_FOUND';
  end if;

  if v_req.status = 'approved' then
    raise exception 'reject_clinic_creation_request: request already decided'
      using errcode = '42501', hint = 'REQUEST_ALREADY_DECIDED';
  end if;

  if v_req.status = 'rejected' then
    return jsonb_build_object(
      'request_id', v_req.id,
      'status', 'rejected',
      'rejection_reason', v_req.rejection_reason
    );
  end if;

  update private.clinic_creation_requests
     set status = 'rejected',
         decided_at = clock_timestamp(),
         decided_by_profile_id = v_me,
         rejection_reason = v_reason
   where id = v_req.id;

  return jsonb_build_object(
    'request_id', v_req.id,
    'status', 'rejected',
    'rejection_reason', v_reason
  );
end;
$$;

comment on function public.reject_clinic_creation_request(uuid, text) is
  'PLATFORM-01: PA recusa solicitação. Motivo opcional. Double-reject é idempotente.';

revoke all on function public.reject_clinic_creation_request(uuid, text) from public, anon;
grant execute on function public.reject_clinic_creation_request(uuid, text) to authenticated;


create or replace function public.authorize_clinic_creation(p_target_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_id uuid;
  v_expires timestamptz;
begin
  if not private.is_platform_admin() then
    raise exception 'authorize_clinic_creation: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  if v_me is null then
    raise exception 'authorize_clinic_creation: grantor profile missing'
      using errcode = '42501', hint = 'GRANTOR_REQUIRED';
  end if;

  if private.clinic_onboarding_mode() = 'closed' then
    raise exception 'authorize_clinic_creation: onboarding closed'
      using errcode = '42501', hint = 'ONBOARDING_CLOSED';
  end if;

  v_id := private.issue_clinic_creation_grant(
    p_target_profile_id,
    'platform_admin',
    v_me
  );

  select a.expires_at
    into v_expires
    from private.clinic_creation_authorizations a
   where a.id = v_id;

  return jsonb_build_object(
    'authorization_id', v_id,
    'target_profile_id', p_target_profile_id,
    'expires_at', v_expires,
    'source', 'platform_admin'
  );
end;
$$;

comment on function public.authorize_clinic_creation(uuid) is
  'WP-SEC-02 + PLATFORM-01: PA concede/renova grant one-time (7d). '
  'Bloqueado quando a política global é closed. NÃO cria clínica.';

revoke all on function public.authorize_clinic_creation(uuid) from public, anon;
grant execute on function public.authorize_clinic_creation(uuid) to authenticated;


create or replace function public.create_clinic_with_owner(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_profile_id();
  v_name   text := btrim(coalesce(p_name, ''));
  v_clinic uuid;
  v_prof   uuid;
  v_auth   uuid;
  v_status text;
  v_mode   text;
begin
  if v_me is null then
    raise exception 'create_clinic_with_owner: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90202, pg_catalog.hashtext(v_me::text));

  if exists (select 1 from public.clinics c where c.owner_profile_id = v_me) then
    raise exception 'create_clinic_with_owner: profile already owns a clinic'
      using errcode = '42501', hint = 'ALREADY_OWNS_CLINIC';
  end if;

  if v_name = '' then
    raise exception 'create_clinic_with_owner: clinic name is required'
      using errcode = '22023', hint = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'create_clinic_with_owner: clinic name too short (min 2)'
      using errcode = '22023', hint = 'NAME_TOO_SHORT';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'create_clinic_with_owner: clinic name too long (max 120)'
      using errcode = '22023', hint = 'NAME_TOO_LONG';
  end if;

  select pr.status
    into v_status
    from public.profiles pr
   where pr.id = v_me;

  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'create_clinic_with_owner: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  v_mode := private.clinic_onboarding_mode();

  if v_mode = 'closed' then
    raise exception 'create_clinic_with_owner: onboarding closed'
      using errcode = '42501', hint = 'ONBOARDING_CLOSED';
  end if;

  if v_mode = 'automatic' then
    perform private.issue_clinic_creation_grant(v_me, 'platform_policy', null);
  end if;

  update private.clinic_creation_authorizations a
     set consumed_at = clock_timestamp()
   where a.id = (
     select x.id
       from private.clinic_creation_authorizations x
      where x.target_profile_id = v_me
        and x.consumed_at is null
        and x.expires_at > clock_timestamp()
      order by x.granted_at asc, x.id
      limit 1
      for update
   )
  returning a.id into v_auth;

  if v_auth is null then
    raise exception 'create_clinic_with_owner: onboarding not permitted'
      using errcode = '42501', hint = 'ONBOARDING_NOT_ALLOWED';
  end if;

  insert into public.clinics (name, owner_profile_id)
  values (v_name, v_me)
  returning id into v_clinic;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_me, v_clinic, 'other', 'admin')
  returning id into v_prof;

  update public.profiles
     set role = 'professional', status = 'active'
   where id = v_me;

  update private.clinic_creation_authorizations
     set consumed_clinic_id = v_clinic
   where id = v_auth;

  update private.clinic_creation_requests r
     set created_clinic_id = v_clinic,
         status = case when r.status = 'pending' then 'approved' else r.status end,
         decided_at = coalesce(r.decided_at, clock_timestamp()),
         authorization_id = coalesce(r.authorization_id, v_auth)
   where r.requester_profile_id = v_me
     and r.created_clinic_id is null
     and r.status in ('pending', 'approved')
     and r.id = (
       select x.id
         from private.clinic_creation_requests x
        where x.requester_profile_id = v_me
          and x.created_clinic_id is null
          and x.status in ('pending', 'approved')
        order by case when x.status = 'approved' then 0 else 1 end, x.requested_at desc
        limit 1
     );

  return jsonb_build_object('clinic_id', v_clinic, 'professional_id', v_prof);
end
$$;

comment on function public.create_clinic_with_owner(text) is
  'SEC-02 + PLATFORM-01: cria a PRÓPRIA clínica. closed ⇒ ONBOARDING_CLOSED. '
  'automatic emite grant platform_policy e consome. '
  'manual_review exige grant prévio. Nome inválido não consome.';

revoke all on function public.create_clinic_with_owner(text) from public, anon;
grant execute on function public.create_clinic_with_owner(text) to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260901090000',
  '20260901090000_wp_platform_01_clinic_onboarding_governance.sql',
  'PLATFORM-01: política global de onboarding (automatic/manual_review/closed), '
  'fila private.clinic_creation_requests, RPCs de policy/request/approve/reject, '
  'source platform_policy, create_clinic_with_owner ciente da política.',
  'PLATFORM-01'
)
on conflict (version) do nothing;
