-- =====================================================================================
-- CALENDAR-02A-R1 · isolamento de leitura da Google Calendar pessoal.
-- JWT via request.jwt.claims; ROLLBACK. NÃO usa service_role como prova de cliente.
-- =====================================================================================
begin;
do $$
declare
  fails text := '';
  n int;
  email_seen text;
  title_seen text;
  ca constant uuid := 'c02a0000-0000-4000-8000-0000000000a1';
  cb constant uuid := 'c02a0000-0000-4000-8000-0000000000b1';
  pf_owner constant uuid := 'c02a0000-0000-4000-8000-000000000011';
  pf_admin constant uuid := 'c02a0000-0000-4000-8000-000000000012';
  pf_a constant uuid := 'c02a0000-0000-4000-8000-000000000013';
  pf_b constant uuid := 'c02a0000-0000-4000-8000-000000000014';
  pf_plat constant uuid := 'c02a0000-0000-4000-8000-000000000015';
  au_owner constant uuid := 'c02a0000-0000-4000-8000-000000000021';
  au_admin constant uuid := 'c02a0000-0000-4000-8000-000000000022';
  au_a constant uuid := 'c02a0000-0000-4000-8000-000000000023';
  au_b constant uuid := 'c02a0000-0000-4000-8000-000000000024';
  au_plat constant uuid := 'c02a0000-0000-4000-8000-000000000025';
  pr_admin constant uuid := 'c02a0000-0000-4000-8000-000000000031';
  pr_a constant uuid := 'c02a0000-0000-4000-8000-000000000032';
  pr_b constant uuid := 'c02a0000-0000-4000-8000-000000000033';
  conn_admin constant uuid := 'c02a0000-0000-4000-8000-000000000041';
  conn_a constant uuid := 'c02a0000-0000-4000-8000-000000000042';
  conn_b constant uuid := 'c02a0000-0000-4000-8000-000000000043';
  conn_orphan constant uuid := 'c02a0000-0000-4000-8000-000000000044';
begin
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (pf_owner, au_owner, 'admin',        'Owner no-prof', 'active'),
    (pf_admin, au_admin, 'professional', 'Clinic admin',  'active'),
    (pf_a,     au_a,     'professional', 'Prof A',        'active'),
    (pf_b,     au_b,     'professional', 'Prof B other',  'active'),
    (pf_plat,  au_plat,  'professional', 'Platform Admin','active');

  insert into public.clinics (id, name, owner_profile_id) values
    (ca, 'Clinic A R1', pf_owner),
    (cb, 'Clinic B R1', pf_b);

  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role, status) values
    (pr_admin, pf_admin, ca, 'doctor',       'admin',  'active'),
    (pr_a,     pf_a,     ca, 'nutritionist', 'member', 'active'),
    (pr_b,     pf_b,     cb, 'doctor',       'admin',  'active');

  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (pf_plat, 'active', now(), null);

  insert into public.calendar_connections (
    id, clinic_id, professional_id, provider, google_account_email, google_calendar_id, calendar_name, status
  ) values
    (conn_admin, ca, pr_admin, 'google', 'admin-own@secret.test', 'cal-admin', 'Agenda Admin', 'connected'),
    (conn_a,     ca, pr_a,     'google', 'profa@secret.test',     'cal-a',     'Agenda A',     'connected'),
    (conn_b,     cb, pr_b,     'google', 'profb@secret.test',     'cal-b',     'Agenda B',     'connected'),
    (conn_orphan,ca, null,     'google', 'orphan@secret.test',    'cal-orph',  'Agenda Orph',  'connected');

  insert into public.calendar_event_cache (id, connection_id, clinic_id, google_event_id, starts_at, title) values
    ('c02a0000-0000-4000-8000-000000000051', conn_admin, ca, 'g-admin', now(), 'Admin pessoal'),
    ('c02a0000-0000-4000-8000-000000000052', conn_a,     ca, 'g-a',     now(), 'Paciente Ana 09:00'),
    ('c02a0000-0000-4000-8000-000000000053', conn_b,     cb, 'g-b',     now(), 'Paciente Beta');

  insert into public.calendar_connection_tokens (connection_id, refresh_token_enc)
    values (conn_a, decode('deadbeef','hex'));

  insert into public.campaigns (id, clinic_id, name) values
    ('c02a0000-0000-4000-8000-000000000061', ca, 'CampA-R1');

  execute 'set local role authenticated';

  -- CAL02AR1-01 / 02 / 10: Prof A lê SÓ a própria conexão e cache (metadado próprio ok)
  perform set_config('request.jwt.claims', json_build_object('sub', au_a)::text, true);
  if (select count(*) from public.calendar_connections) <> 1 then fails := fails || 'A_OWN_CONN '; end if;
  if (select count(*) from public.calendar_event_cache) <> 1 then fails := fails || 'A_OWN_CACHE '; end if;
  select google_account_email into email_seen from public.calendar_connections;
  if email_seen is distinct from 'profa@secret.test' then fails := fails || 'A_OWN_EMAIL '; end if;
  select title into title_seen from public.calendar_event_cache;
  if title_seen is distinct from 'Paciente Ana 09:00' then fails := fails || 'A_OWN_TITLE '; end if;

  -- CAL02AR1-03 / 04 / metadata de B
  if exists (select 1 from public.calendar_connections where id = conn_b or google_account_email = 'profb@secret.test')
    then fails := fails || 'A_READ_B_CONN '; end if;
  if exists (select 1 from public.calendar_event_cache where connection_id = conn_b or title = 'Paciente Beta')
    then fails := fails || 'A_READ_B_CACHE '; end if;
  if exists (select 1 from public.calendar_connections where id = conn_admin or google_account_email = 'admin-own@secret.test')
    then fails := fails || 'A_READ_ADMIN_CONN '; end if;
  if exists (select 1 from public.calendar_connections where id = conn_orphan)
    then fails := fails || 'A_READ_ORPHAN '; end if;

  -- CAL02AR1-05 / 06: clinic_role=admin NÃO lê Calendar de A (só a própria)
  perform set_config('request.jwt.claims', json_build_object('sub', au_admin)::text, true);
  if (select count(*) from public.calendar_connections) <> 1 then fails := fails || 'ADMIN_OWN_CONN '; end if;
  if (select google_account_email from public.calendar_connections) is distinct from 'admin-own@secret.test'
    then fails := fails || 'ADMIN_OWN_EMAIL '; end if;
  if exists (select 1 from public.calendar_connections where id = conn_a or google_account_email = 'profa@secret.test')
    then fails := fails || 'ADMIN_READ_A_CONN '; end if;
  if exists (select 1 from public.calendar_event_cache where connection_id = conn_a or title = 'Paciente Ana 09:00')
    then fails := fails || 'ADMIN_READ_A_CACHE '; end if;
  if (select count(*) from public.campaigns) <> 1 then fails := fails || 'ADMIN_STILL_CAMP '; end if;

  -- Owner sem professional (is_clinic_admin via owner_profile_id): Calendar deny; campanha allow
  perform set_config('request.jwt.claims', json_build_object('sub', au_owner)::text, true);
  if (select count(*) from public.calendar_connections) <> 0 then fails := fails || 'OWNER_CONN0 '; end if;
  if (select count(*) from public.calendar_event_cache) <> 0 then fails := fails || 'OWNER_CACHE0 '; end if;
  if (select count(*) from public.campaigns) <> 1 then fails := fails || 'OWNER_STILL_CAMP '; end if;

  -- CAL02AR1-07: cross-clinic
  perform set_config('request.jwt.claims', json_build_object('sub', au_b)::text, true);
  if exists (select 1 from public.calendar_connections where clinic_id = ca)
    then fails := fails || 'B_CROSS_CONN '; end if;
  if exists (select 1 from public.calendar_event_cache where clinic_id = ca)
    then fails := fails || 'B_CROSS_CACHE '; end if;
  if (select count(*) from public.calendar_connections) <> 1 then fails := fails || 'B_OWN_CONN '; end if;

  -- CAL02AR1-08: Platform Admin sem professional
  perform set_config('request.jwt.claims', json_build_object('sub', au_plat)::text, true);
  if (select count(*) from public.calendar_connections) <> 0 then fails := fails || 'PA_CONN0 '; end if;
  if (select count(*) from public.calendar_event_cache) <> 0 then fails := fails || 'PA_CACHE0 '; end if;

  -- CAL02AR1-11: token table
  perform set_config('request.jwt.claims', json_build_object('sub', au_a)::text, true);
  begin
    select count(*) into n from public.calendar_connection_tokens;
    if n > 0 then fails := fails || 'TOKENS_VISIBLE '; end if;
  exception when insufficient_privilege then null;
  end;

  -- CAL02AR1-09: anon
  execute 'reset role';
  execute 'set local role anon';
  if (select count(*) from public.calendar_connections) <> 0
     or (select count(*) from public.calendar_event_cache) <> 0
    then fails := fails || 'ANON_DENIED '; end if;

  if length(fails) > 0 then
    raise exception 'CALENDAR-02A-R1 TESTS FAILED: %', fails;
  else
    raise notice 'CALENDAR-02A-R1: ALL ASSERTIONS PASSED';
  end if;
end $$;
rollback;
