-- WP-PATIENT-ADMIN-EDIT-01
-- Edição administrativa do cadastro do paciente + correção segura de e-mail ANTES do 1º login.
--
-- 1) private.identity_email_lock(text): chave canônica de serialização das decisões de
--    identidade por e-mail (lower(btrim(email))). Usada por:
--      handle_new_user, private.ensure_auth_profile, public.create_patient (claim paths)
--      e public.update_patient_registration (edição de e-mail).
--    Semântica funcional dos claim paths INALTERADA: só se serializa a decisão
--    "claim do profile existente x criar profile pending".
-- 2) public.patient_registration_events: auditoria mínima, SEM PII (só nomes de campos).
-- 3) public.get_patient_registration_access(uuid): leitura admin-only do estado de acesso.
-- 4) public.update_patient_registration(...): única operação canônica de edição.
--
-- Não toca billing / Asaas / entitlements. Não altera auth.users nem auth.identities.

-- =====================================================================================
-- 1. Lock canônico por e-mail normalizado
-- =====================================================================================
create or replace function private.identity_email_lock(p_email text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_email is null or btrim(p_email) = '' then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vertexa:identity-email:' || lower(btrim(p_email)), 0)
  );
end;
$$;

comment on function private.identity_email_lock(text) is
  'PATIENT-ADMIN-EDIT-01: chave canônica de lock transacional por lower(btrim(email)). '
  'Serializa claim de profile (primeiro login) x edição de e-mail. Sem efeito funcional próprio.';

revoke all on function private.identity_email_lock(text) from public, anon, authenticated, service_role;


-- =====================================================================================
-- 1a. handle_new_user — corpo de 20260912120000 + lock antes da decisão claim/pending
-- =====================================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_count int;
  v_profile_id  uuid;
  v_surface     text;
  v_outcome     text;
begin
  if exists (select 1 from public.profiles where auth_user_id = new.id) then
    return new;
  end if;

  v_surface := case
    when new.raw_user_meta_data ->> 'signup_surface' = 'patient_app' then 'patient_app'
    when new.raw_user_meta_data ->> 'signup_surface' = 'web'         then 'web'
    else 'other'
  end;

  -- Confirmed + trusted provider. Unconfirmed email never links.
  -- Outcome name kept for existing consumers / history.
  if not private.auth_identity_is_trusted(new.raw_app_meta_data, new.email_confirmed_at) then
    perform public.log_auth_trigger_event(new.id, v_surface, 'skipped_unverified_provider', null);
    return new;
  end if;

  -- PATIENT-ADMIN-EDIT-01: serializa a decisão de identidade com a edição de e-mail.
  perform private.identity_email_lock(new.email);

  select count(*)
    into v_match_count
  from public.profiles
  where auth_user_id is null
    and email is not null
    and new.email is not null
    and lower(btrim(email)) = lower(btrim(new.email));

  if v_match_count = 1 then
    select id
      into v_profile_id
    from public.profiles
    where auth_user_id is null
      and email is not null
      and new.email is not null
      and lower(btrim(email)) = lower(btrim(new.email))
    limit 1;
    update public.profiles set auth_user_id = new.id where id = v_profile_id;
    v_outcome := 'linked';
  else
    begin
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (
        new.id,
        'patient',
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
          new.email,
          'Novo usuário'
        ),
        new.email,
        'pending'
      );
      v_outcome := 'pending_patient';
    exception
      when unique_violation then
        return new;
    end;
  end if;

  perform public.log_auth_trigger_event(new.id, v_surface, v_outcome, null);
  return new;

exception
  when others then
    raise warning '[handle_new_user] falha assoc user=% sqlstate=%', new.id, sqlstate;
    perform public.log_auth_trigger_event(new.id, coalesce(v_surface, 'other'), 'error', sqlstate);
    return new;
end;
$$;

comment on function public.handle_new_user() is
  'AUTH-EMAIL-01: provider-agnostic confirmed identity. search_path empty. '
  'No-match still pending patient only. Never professional/clinic/patient/PA. '
  'PATIENT-ADMIN-EDIT-01: decisão claim/pending serializada por private.identity_email_lock.';

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;


-- =====================================================================================
-- 1b. private.ensure_auth_profile — corpo de 20260912120000 + lock
-- =====================================================================================
create or replace function private.ensure_auth_profile(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_app jsonb;
  v_user_meta jsonb;
  v_deleted timestamptz;
  v_banned timestamptz;
  v_match_count int;
  v_profile_id uuid;
begin
  if p_uid is null then
    return;
  end if;

  if exists (select 1 from public.profiles p where p.auth_user_id = p_uid) then
    return;
  end if;

  select u.email, u.email_confirmed_at, u.raw_app_meta_data, u.raw_user_meta_data,
         u.deleted_at, u.banned_until
    into v_email, v_confirmed, v_app, v_user_meta, v_deleted, v_banned
  from auth.users u
  where u.id = p_uid;

  if not found then
    return;
  end if;

  if v_deleted is not null then
    return;
  end if;

  if v_banned is not null and v_banned > clock_timestamp() then
    return;
  end if;

  if not private.auth_identity_is_trusted(v_app, v_confirmed) then
    return;
  end if;

  -- PATIENT-ADMIN-EDIT-01: serializa a decisão de identidade com a edição de e-mail.
  perform private.identity_email_lock(v_email);

  select count(*)
    into v_match_count
  from public.profiles
  where auth_user_id is null
    and email is not null
    and v_email is not null
    and lower(btrim(email)) = lower(btrim(v_email));

  if v_match_count = 1 then
    select id
      into v_profile_id
    from public.profiles
    where auth_user_id is null
      and email is not null
      and v_email is not null
      and lower(btrim(email)) = lower(btrim(v_email))
    limit 1;
    update public.profiles set auth_user_id = p_uid where id = v_profile_id;
    return;
  end if;

  insert into public.profiles (auth_user_id, role, full_name, email, status)
  values (
    p_uid,
    'patient',
    coalesce(
      nullif(btrim(v_user_meta ->> 'full_name'), ''),
      nullif(btrim(v_user_meta ->> 'name'), ''),
      v_email,
      'Novo usuário'
    ),
    v_email,
    'pending'
  );
exception
  when unique_violation then
    return;
end;
$$;

comment on function private.ensure_auth_profile(uuid) is
  'AUTH-EMAIL-01: same rules as handle_new_user for confirmed trusted providers. '
  'Owner-only. Never professional. Never platform admin. '
  'PATIENT-ADMIN-EDIT-01: decisão claim/pending serializada por private.identity_email_lock.';

revoke all on function private.ensure_auth_profile(uuid)
  from public, anon, authenticated, service_role;


-- =====================================================================================
-- 1c. public.create_patient — corpo de 20260917214500 + lock (assinatura/grants inalterados)
-- =====================================================================================
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
  if not private.clinic_is_operational(p_clinic_id) then
    raise exception 'forbidden: caller is not staff of clinic'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'forbidden: PATIENT_CREATE_ADMIN_REQUIRED'
      using errcode = '42501', hint = 'PATIENT_CREATE_ADMIN_REQUIRED';
  end if;
  select pr.id into v_caller_prof
    from public.professionals pr
   where pr.clinic_id = p_clinic_id
     and pr.profile_id = v_caller_profile
     and coalesce(pr.status, 'active') = 'active'
   limit 1;

  v_email := nullif(btrim(coalesce(p_email,'')),'');

  -- PATIENT-ADMIN-EDIT-01: serializa a decisão de identidade com first-login / edição de e-mail.
  perform private.identity_email_lock(v_email);

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
        and private.auth_identity_is_trusted(u.raw_app_meta_data, u.email_confirmed_at)
        and not exists (select 1 from public.profiles p where p.auth_user_id = u.id);

      if v_match_count = 1 then
        select u.id
          into v_auth_user_id
        from auth.users u
        where u.email is not null
          and lower(btrim(u.email)) = lower(btrim(v_email))
          and u.email_confirmed_at is not null
          and private.auth_identity_is_trusted(u.raw_app_meta_data, u.email_confirmed_at)
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

comment on function public.create_patient(uuid, text, text, date, text, numeric, text, numeric, numeric, text, numeric, numeric, text, date) is
  'ACCESS-PARTNER-01A: creation requires private.is_clinic_admin (owner or clinic_role=admin). '
  'AUTH-EMAIL-01 VINCULO-1/2 identity logic unchanged. Member/staff cannot create. '
  'PATIENT-ADMIN-EDIT-01: decisão de identidade por e-mail serializada por private.identity_email_lock.';


-- =====================================================================================
-- 2. Auditoria mínima (sem PII, sem valores)
-- =====================================================================================
create table if not exists public.patient_registration_events (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null,
  profile_id       uuid not null,
  clinic_id        uuid not null,
  actor_profile_id uuid not null,
  changed_fields   text[] not null,
  email_changed    boolean not null default false,
  created_at       timestamptz not null default now()
);

comment on table public.patient_registration_events is
  'PATIENT-ADMIN-EDIT-01: append-only. Só nomes de campos alterados; nunca valores, e-mail, '
  'payload clínico, tokens ou credenciais. Sem FK de propósito: a trilha sobrevive ao paciente.';

create index if not exists patient_registration_events_patient_idx
  on public.patient_registration_events (patient_id, created_at desc);

alter table public.patient_registration_events enable row level security;

drop policy if exists patient_registration_events_select_admin on public.patient_registration_events;
create policy patient_registration_events_select_admin
  on public.patient_registration_events
  for select
  to authenticated
  using (private.is_clinic_admin(clinic_id));

revoke all on table public.patient_registration_events from public, anon, authenticated;
grant select on table public.patient_registration_events to authenticated;


-- =====================================================================================
-- 3. Leitura admin-only do estado de acesso (autoridade server-side; sem PII)
-- =====================================================================================
create or replace function public.get_patient_registration_access(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := private.current_profile_id();
  v_clinic   uuid;
  v_profile  uuid;
  v_auth     uuid;
  v_reg_mail text;
  v_auth_mail text;
begin
  if (select auth.uid()) is null or v_actor is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;
  if p_patient_id is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;

  select pt.clinic_id, pt.profile_id into v_clinic, v_profile
    from public.patients pt where pt.id = p_patient_id;
  if v_clinic is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'forbidden: PATIENT_EDIT_ADMIN_REQUIRED'
      using errcode = '42501', hint = 'PATIENT_EDIT_ADMIN_REQUIRED';
  end if;

  select pr.auth_user_id, lower(btrim(coalesce(pr.email, '')))
    into v_auth, v_reg_mail
    from public.profiles pr where pr.id = v_profile;

  if v_auth is null then
    return jsonb_build_object('has_login_account', false, 'login_email_matches_registration', null);
  end if;

  select lower(btrim(coalesce(u.email, ''))) into v_auth_mail
    from auth.users u where u.id = v_auth;

  return jsonb_build_object(
    'has_login_account', true,
    'login_email_matches_registration', v_auth_mail is not distinct from v_reg_mail
  );
end;
$$;

comment on function public.get_patient_registration_access(uuid) is
  'PATIENT-ADMIN-EDIT-01: admin da clínica do paciente. Devolve só booleanos (sem e-mail, sem ids). '
  'login_email_matches_registration=false sinaliza LEGACY_AUTH_EMAIL_DRIFT (detecção, sem correção).';

revoke all on function public.get_patient_registration_access(uuid) from public, anon;
grant execute on function public.get_patient_registration_access(uuid) to authenticated;


-- =====================================================================================
-- 4. update_patient_registration — operação canônica de edição cadastral
-- =====================================================================================
create or replace function public.update_patient_registration(
  p_patient_id     uuid,
  p_full_name      text,
  p_email          text    default null,
  p_birth_date     date    default null,
  p_sex            text    default null,
  p_height_cm      numeric default null,
  p_goal           text    default null,
  p_start_weight   numeric default null,
  p_target_weight  numeric default null,
  p_start_date     date    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := private.current_profile_id();
  v_clinic       uuid;
  v_profile      uuid;
  v_pat          public.patients%rowtype;
  v_auth         uuid;
  v_cur_email    text;
  v_cur_name     text;
  v_cur_norm     text;
  v_new_email    text;
  v_new_norm     text;
  v_name         text;
  v_goal         text;
  v_start        date;
  v_changed      text[] := '{}';
  v_email_changed boolean := false;
  v_n            int;
  v_k1           text;
  v_k2           text;
  v_final_email  text;
begin
  -- 1. autenticação
  if (select auth.uid()) is null or v_actor is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;
  if p_patient_id is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;

  -- 2. autoridade derivada do paciente no servidor (nunca da clínica vinda do browser)
  select pt.clinic_id, pt.profile_id into v_clinic, v_profile
    from public.patients pt where pt.id = p_patient_id;
  if v_clinic is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;
  if not private.clinic_is_operational(v_clinic) then
    raise exception 'forbidden: clinic not operational'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'forbidden: PATIENT_EDIT_ADMIN_REQUIRED'
      using errcode = '42501', hint = 'PATIENT_EDIT_ADMIN_REQUIRED';
  end if;

  -- 3. validação de entrada (antes de qualquer lock)
  v_name := btrim(coalesce(p_full_name, ''));
  if v_name = '' then
    raise exception 'full_name required' using errcode = '22023', hint = 'PATIENT_NAME_REQUIRED';
  end if;
  if p_sex is not null and p_sex not in ('feminino', 'masculino', 'outro') then
    raise exception 'invalid sex' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;
  if p_height_cm is not null and (p_height_cm <= 0 or p_height_cm > 300) then
    raise exception 'invalid height_cm' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;
  if p_start_weight is not null and (p_start_weight <= 0 or p_start_weight > 700) then
    raise exception 'invalid start_weight' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;
  if p_target_weight is not null and (p_target_weight <= 0 or p_target_weight > 700) then
    raise exception 'invalid target_weight' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;
  if p_birth_date is not null and (p_birth_date > current_date or p_birth_date < date '1900-01-01') then
    raise exception 'invalid birth_date' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;
  -- start_date: mesma regra do create_patient (não pode ser futura); nulo = manter o atual.
  if p_start_date is not null and p_start_date > current_date then
    raise exception 'start_date cannot be in the future' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;
  if p_start_date is not null and p_birth_date is not null and p_start_date < p_birth_date then
    raise exception 'start_date before birth_date' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;

  v_new_email := nullif(btrim(coalesce(p_email, '')), '');
  v_new_norm  := lower(v_new_email);
  if v_new_email is not null and v_new_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023', hint = 'PATIENT_EMAIL_INVALID';
  end if;

  -- 4. serialização de identidade: lê o e-mail atual SEM lock apenas para descobrir as chaves,
  --    toma os locks (ordem determinística, antes de qualquer lock de linha: mesma ordem do
  --    trigger/claim, que tomam advisory e só depois a linha) e RELÊ sob lock.
  select lower(btrim(coalesce(pr.email, ''))) into v_cur_norm
    from public.profiles pr where pr.id = v_profile;
  v_cur_norm := nullif(v_cur_norm, '');

  if v_new_norm is distinct from v_cur_norm then
    v_k1 := least(coalesce(v_cur_norm, ''), coalesce(v_new_norm, ''));
    v_k2 := greatest(coalesce(v_cur_norm, ''), coalesce(v_new_norm, ''));
    perform private.identity_email_lock(nullif(v_k1, ''));
    if v_k2 is distinct from v_k1 then
      perform private.identity_email_lock(nullif(v_k2, ''));
    end if;
  end if;

  select * into v_pat from public.patients pt where pt.id = p_patient_id for update;
  select pr.auth_user_id, pr.email, pr.full_name
    into v_auth, v_cur_email, v_cur_name
    from public.profiles pr where pr.id = v_profile for update;

  if v_pat.id is null or v_pat.clinic_id is distinct from v_clinic or v_pat.profile_id is distinct from v_profile
     or nullif(lower(btrim(coalesce(v_cur_email, ''))), '') is distinct from v_cur_norm then
    raise exception 'registration changed concurrently'
      using errcode = '40001', hint = 'PATIENT_CHANGED_CONCURRENTLY';
  end if;

  -- 5. e-mail
  if v_new_norm is distinct from v_cur_norm then
    if v_new_norm is null then
      raise exception 'email cannot be cleared' using errcode = '22023', hint = 'PATIENT_EMAIL_INVALID';
    end if;
    if v_auth is not null then
      raise exception 'login email already claimed'
        using errcode = '42501', hint = 'PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED';
    end if;
    select count(*) into v_n
      from public.profiles o
     where o.id <> v_profile
       and o.email is not null
       and lower(btrim(o.email)) = v_new_norm;
    if v_n > 0 then
      raise exception 'email already in use' using errcode = '23505', hint = 'PATIENT_EMAIL_IN_USE';
    end if;
    select count(*) into v_n
      from auth.users u
     where u.email is not null
       and lower(btrim(u.email)) = v_new_norm;
    if v_n > 0 then
      raise exception 'email already in use' using errcode = '23505', hint = 'PATIENT_EMAIL_IN_USE';
    end if;
    v_email_changed := true;
    v_changed := array_append(v_changed, 'email');
  end if;

  -- 6. diff dos demais campos (nunca current_weight, clinic_id, profile_id, auth_user_id)
  v_goal  := nullif(btrim(coalesce(p_goal, '')), '');
  v_start := coalesce(p_start_date, v_pat.start_date);
  if v_start is not null and v_start > current_date then
    -- dado legado futuro mantido como está só se não foi tocado
    if p_start_date is not null then
      raise exception 'start_date cannot be in the future' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
    end if;
  end if;
  if v_start is not null and p_birth_date is not null and v_start < p_birth_date then
    raise exception 'start_date before birth_date' using errcode = '22023', hint = 'PATIENT_FIELD_INVALID';
  end if;

  if v_name is distinct from v_cur_name           then v_changed := array_append(v_changed, 'full_name'); end if;
  if p_birth_date    is distinct from v_pat.birth_date    then v_changed := array_append(v_changed, 'birth_date'); end if;
  if p_sex           is distinct from v_pat.sex           then v_changed := array_append(v_changed, 'sex'); end if;
  if p_height_cm     is distinct from v_pat.height_cm     then v_changed := array_append(v_changed, 'height_cm'); end if;
  if v_goal          is distinct from v_pat.goal          then v_changed := array_append(v_changed, 'goal'); end if;
  if p_start_weight  is distinct from v_pat.start_weight  then v_changed := array_append(v_changed, 'start_weight'); end if;
  if p_target_weight is distinct from v_pat.target_weight then v_changed := array_append(v_changed, 'target_weight'); end if;
  if v_start         is distinct from v_pat.start_date    then v_changed := array_append(v_changed, 'start_date'); end if;

  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return jsonb_build_object(
      'patient_id', p_patient_id,
      'changed_fields', '[]'::jsonb,
      'login_email_locked', v_auth is not null
    );
  end if;

  -- 7. aplica somente campos permitidos
  update public.profiles
     set full_name = v_name,
         email     = case when v_email_changed then v_new_email else email end
   where id = v_profile;

  update public.patients
     set birth_date    = p_birth_date,
         sex           = p_sex,
         height_cm     = p_height_cm,
         goal          = v_goal,
         start_weight  = p_start_weight,
         target_weight = p_target_weight,
         start_date    = v_start
   where id = p_patient_id;

  -- 8. auditoria (sem valores)
  insert into public.patient_registration_events
    (patient_id, profile_id, clinic_id, actor_profile_id, changed_fields, email_changed)
  values
    (p_patient_id, v_profile, v_clinic, v_actor, v_changed, v_email_changed);

  -- 9. invariantes (qualquer falha desfaz tudo)
  -- (só quando o e-mail mudou: edição de outro campo não pode falhar por duplicidade LEGADA)
  select pr.email into v_final_email from public.profiles pr where pr.id = v_profile;
  if v_email_changed and v_final_email is not null and btrim(v_final_email) <> '' then
    select count(*) into v_n from public.profiles o
     where o.email is not null and lower(btrim(o.email)) = lower(btrim(v_final_email));
    if v_n <> 1 then
      raise exception 'invariant: matching profiles=%', v_n using errcode = 'XX001';
    end if;
  end if;
  select count(*) into v_n from public.patients pt
   where pt.id = p_patient_id and pt.profile_id = v_profile and pt.clinic_id = v_clinic;
  if v_n <> 1 then
    raise exception 'invariant: patient/profile/clinic changed' using errcode = 'XX001';
  end if;
  select count(*) into v_n from public.patients pt where pt.profile_id = v_profile;
  if v_n <> 1 then
    raise exception 'invariant: patients per profile=%', v_n using errcode = 'XX001';
  end if;
  select count(*) into v_n from public.profiles pr
   where pr.id = v_profile and pr.auth_user_id is not distinct from v_auth;
  if v_n <> 1 then
    raise exception 'invariant: auth_user_id changed' using errcode = 'XX001';
  end if;

  return jsonb_build_object(
    'patient_id', p_patient_id,
    'changed_fields', to_jsonb(v_changed),
    'login_email_locked', v_auth is not null
  );
end;
$$;

comment on function public.update_patient_registration(uuid, text, text, date, text, numeric, text, numeric, numeric, date) is
  'PATIENT-ADMIN-EDIT-01: edição cadastral por admin da clínica do paciente (derivada no servidor). '
  'E-mail só editável sem auth_user_id (PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED com Auth). Conflito com '
  'profiles/auth.users => PATIENT_EMAIL_IN_USE (sem merge). Nunca altera auth_user_id, clinic_id, '
  'profile_id, current_weight, billing. start_date nulo = manter. Retorno sem PII.';

revoke all on function public.update_patient_registration(uuid, text, text, date, text, numeric, text, numeric, numeric, date)
  from public, anon;
grant execute on function public.update_patient_registration(uuid, text, text, date, text, numeric, text, numeric, numeric, date)
  to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260926120000',
  '20260926120000_wp_patient_admin_edit_01_update_registration.sql',
  'PATIENT-ADMIN-EDIT-01: update_patient_registration + get_patient_registration_access + auditoria; '
  'lock canônico de identidade por e-mail em handle_new_user/ensure_auth_profile/create_patient.',
  'PATIENT-ADMIN-EDIT-01'
);
