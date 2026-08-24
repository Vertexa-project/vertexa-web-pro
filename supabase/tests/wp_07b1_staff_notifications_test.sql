-- =====================================================================================
-- WP-07B1 — TESTES (Nível 1: request.jwt.claims + set local role, ROLLBACK).
-- Exige a migration 20260814090000 aplicada.
--
-- HARNESS: NÃO é um DO monolítico (PG17 Docker SIGSEGV). Cada caso é
-- BEGIN / DO pequeno / ROLLBACK.
--
-- Fixture alcançável: create_clinic_with_owner / professionals + create_patient /
-- assign_patient_professional / get_or_create_channel / deactivate_patient_link.
-- INSERT direto só para estados que o produto já persiste (profiles, links).
-- =====================================================================================

-- Header SOS do APP: "Preciso de ajuda" + espaço + U+2014 + espaço + categoria.
create or replace function pg_temp.sos(p_cat text default 'Dieta')
returns text
language sql
as $$
  select 'Preciso de ajuda' || chr(32) || chr(8212) || ' ' || coalesce(p_cat, 'Dieta');
$$;

create or replace function pg_temp.wp07b1_seed()
returns table (
  c_a uuid, c_b uuid,
  p_own uuid, a_own uuid,
  p_a1 uuid, a_a1 uuid, prof_a1 uuid,
  p_a2 uuid, a_a2 uuid, prof_a2 uuid,
  p_a3 uuid, a_a3 uuid, prof_a3 uuid,
  p_ina uuid, a_ina uuid, prof_ina uuid,
  p_b1 uuid, a_b1 uuid, prof_b1 uuid,
  p_pat uuid, a_pat uuid, pat uuid,
  ch uuid
)
language plpgsql
as $seed$
declare
  v_c_a uuid; v_c_b uuid;
  v_p_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_p_a1 uuid := gen_random_uuid(); v_a_a1 uuid := gen_random_uuid(); v_prof_a1 uuid;
  v_p_a2 uuid := gen_random_uuid(); v_a_a2 uuid := gen_random_uuid(); v_prof_a2 uuid;
  v_p_a3 uuid := gen_random_uuid(); v_a_a3 uuid := gen_random_uuid(); v_prof_a3 uuid;
  v_p_ina uuid := gen_random_uuid(); v_a_ina uuid := gen_random_uuid(); v_prof_ina uuid;
  v_p_b1 uuid := gen_random_uuid(); v_a_b1 uuid := gen_random_uuid(); v_prof_b1 uuid;
  v_p_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid(); v_pat uuid;
  v_ch uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_p_own, v_a_own, 'professional', 'Dona A', 'own07b1@t.test', 'active'),
    (v_p_a1,  v_a_a1,  'professional', 'A1',     'a1@t07b1.test',  'active'),
    (v_p_a2,  v_a_a2,  'professional', 'A2',     'a2@t07b1.test',  'active'),
    (v_p_a3,  v_a_a3,  'professional', 'A3ext',  'a3@t07b1.test',  'active'),
    (v_p_ina, v_a_ina, 'professional', 'Aina',   'ina@t07b1.test', 'active'),
    (v_p_b1,  v_a_b1,  'professional', 'B1',     'b1@t07b1.test',  'active'),
    (v_p_pat, v_a_pat, 'patient',      'Pac A',  'pat@t07b1.test', 'active');

  insert into public.clinics (id, name, owner_profile_id) values
    (gen_random_uuid(), 'Clinica A 07B1', v_p_own) returning id into v_c_a;
  insert into public.clinics (id, name, owner_profile_id) values
    (gen_random_uuid(), 'Clinica B 07B1', v_p_b1) returning id into v_c_b;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_p_own, v_c_a, 'other', 'admin',  'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_p_a1,  v_c_a, 'doctor', 'member', 'active') returning id into v_prof_a1;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_p_a2,  v_c_a, 'nutritionist', 'member', 'active') returning id into v_prof_a2;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_p_a3,  v_c_a, 'other', 'member', 'active') returning id into v_prof_a3;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_p_ina, v_c_a, 'other', 'member', 'inactive') returning id into v_prof_ina;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_p_b1,  v_c_b, 'other', 'admin',  'active') returning id into v_prof_b1;

  insert into public.patients (profile_id, clinic_id, goal)
    values (v_p_pat, v_c_a, 'meta') returning id into v_pat;

  -- A1/A2: RPC real de atribuição (admin). A3: assign + is_external (estado que o produto persiste).
  -- Inativo: assign rejeita pr.status<>active — INSERT só na fixture, como 05A1.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(v_pat, v_prof_a1);
  perform public.assign_patient_professional(v_pat, v_prof_a2);
  perform public.assign_patient_professional(v_pat, v_prof_a3);
  reset role;
  update public.professional_patient_links
     set is_external = true
   where professional_id = v_prof_a3 and patient_id = v_pat;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_prof_ina, v_pat, false, 'active');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ch := public.get_or_create_channel(v_pat);
  reset role;

  return query select
    v_c_a, v_c_b,
    v_p_own, v_a_own,
    v_p_a1, v_a_a1, v_prof_a1,
    v_p_a2, v_a_a2, v_prof_a2,
    v_p_a3, v_a_a3, v_prof_a3,
    v_p_ina, v_a_ina, v_prof_ina,
    v_p_b1, v_a_b1, v_prof_b1,
    v_p_pat, v_a_pat, v_pat,
    v_ch;
end;
$seed$;

-- Matcher V1: header do APP (espaço + U+2014), não hífen ASCII.
begin;
do $$
begin
  if not private.staff_help_request_body_matches('Preciso de ajuda') then
    raise exception 'MATCH_exact';
  end if;
  if not private.staff_help_request_body_matches('Preciso de ajuda' || chr(32) || chr(8212) || ' Dieta') then
    raise exception 'MATCH_header';
  end if;
  if private.staff_help_request_body_matches('Preciso de ajuda - Dieta') then
    raise exception 'MATCH_hyphen';
  end if;
  if private.staff_help_request_body_matches('Preciso de ajuda agora') then
    raise exception 'MATCH_loose';
  end if;
  raise notice 'WP-07B1 MATCHER PASSED';
end $$;
rollback;

-- T1 T2 T3 T4 T5 T6: SOS do paciente → só A1 e A2
begin;
do $$
declare
  s record; v_msg uuid; v_n int; v_a1 int; v_a2 int; v_a3 int; v_ina int; v_b1 int; v_own int;
begin
  select * into s from pg_temp.wp07b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Dificuldade com dieta'))
    returning id into v_msg;
  reset role;

  select count(*) into v_n from public.staff_notifications where message_id = v_msg;
  if v_n <> 2 then raise exception 'T3_n(%)', v_n; end if;
  select count(*) into v_a1 from public.staff_notifications
    where message_id = v_msg and recipient_profile_id = s.p_a1
      and type = 'help_requested' and severity = 'critical';
  if v_a1 <> 1 then raise exception 'T1_a1(%)', v_a1; end if;
  select count(*) into v_a2 from public.staff_notifications
    where message_id = v_msg and recipient_profile_id = s.p_a2
      and type = 'help_requested' and severity = 'critical';
  if v_a2 <> 1 then raise exception 'T2_a2(%)', v_a2; end if;
  select count(*) into v_a3 from public.staff_notifications
    where message_id = v_msg and recipient_profile_id = s.p_a3;
  if v_a3 <> 0 then raise exception 'T4_a3(%)', v_a3; end if;
  select count(*) into v_ina from public.staff_notifications
    where message_id = v_msg and recipient_profile_id = s.p_ina;
  if v_ina <> 0 then raise exception 'T5_ina(%)', v_ina; end if;
  select count(*) into v_b1 from public.staff_notifications
    where message_id = v_msg and recipient_profile_id = s.p_b1;
  if v_b1 <> 0 then raise exception 'T6_b1(%)', v_b1; end if;
  select count(*) into v_own from public.staff_notifications
    where message_id = v_msg and recipient_profile_id = s.p_own;
  if v_own <> 0 then raise exception 'T3_admin_sem_vinculo(%)', v_own; end if;
  raise notice 'WP-07B1 T1-T6 PASSED';
end $$;
rollback;

-- T7 T8 T9: profissional / texto SOS de prof / mensagem comum do paciente
begin;
do $$
declare
  s record; v_before int; v_after int;
begin
  select * into s from pg_temp.wp07b1_seed();
  select count(*) into v_before from public.staff_notifications;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_a1, 'professional', 'oi, tudo bem?');
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_a1, 'professional', pg_temp.sos('spoof'));
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', 'oi equipe');
  reset role;

  -- Admin/owner com o mesmo prefixo (INSERT direto: admin não é participante).
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_own, 'admin', pg_temp.sos('spoof admin'));

  select count(*) into v_after from public.staff_notifications;
  if v_after <> v_before then raise exception 'T7T8T9_delta(%)', v_after - v_before; end if;
  raise notice 'WP-07B1 T7 T8 T9 PASSED';
end $$;
rollback;

-- T10 T11: idempotência + segundo SOS
begin;
do $$
declare
  s record; v_msg uuid; v_n1 int; v_n2 int; v_total int;
begin
  select * into s from pg_temp.wp07b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Dieta'))
    returning id into v_msg;
  reset role;

  insert into public.staff_notifications (
    clinic_id, recipient_profile_id, actor_profile_id, patient_id, channel_id,
    message_id, type, severity
  )
  select s.c_a, r.profile_id, s.p_pat, s.pat, s.ch, v_msg, 'help_requested', 'critical'
    from private.staff_help_request_recipient_profile_ids(s.pat) r
  on conflict (type, message_id, recipient_profile_id) do nothing;

  select count(*) into v_n1 from public.staff_notifications where message_id = v_msg;
  if v_n1 <> 2 then raise exception 'T10_dup(%)', v_n1; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Estou viajando'));
  reset role;

  select count(*) into v_total from public.staff_notifications
    where patient_id = s.pat and type = 'help_requested';
  if v_total <> 4 then raise exception 'T11_total(%)', v_total; end if;
  select count(distinct message_id) into v_n2 from public.staff_notifications
    where patient_id = s.pat;
  if v_n2 <> 2 then raise exception 'T11_msgs(%)', v_n2; end if;
  raise notice 'WP-07B1 T10 T11 PASSED';
end $$;
rollback;

-- T12 T13 T14 T15: isolamento de SELECT
begin;
do $$
declare
  s record; v_msg uuid; v_n int;
begin
  select * into s from pg_temp.wp07b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Dieta'))
    returning id into v_msg;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.staff_notifications;
  if v_n <> 1 then raise exception 'T12_a1(%)', v_n; end if;
  select count(*) into v_n from public.staff_notifications
    where recipient_profile_id = s.p_a2;
  if v_n <> 0 then raise exception 'T13_a1_viu_a2'; end if;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.staff_notifications;
  if v_n <> 0 then raise exception 'T14_b1(%)', v_n; end if;
  reset role;

  set local role anon;
  begin
    select count(*) into v_n from public.staff_notifications;
    if v_n <> 0 then raise exception 'T15_anon_count(%)', v_n; end if;
  exception
    when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'WP-07B1 T12-T15 PASSED';
end $$;
rollback;

-- T16 T17 T18: read_at próprio; negar mutate de metadado e da inbox alheia
begin;
do $$
declare
  s record; v_mine uuid; v_theirs uuid;
begin
  select * into s from pg_temp.wp07b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Dieta'));
  reset role;

  select id into v_mine from public.staff_notifications where recipient_profile_id = s.p_a1;
  select id into v_theirs from public.staff_notifications where recipient_profile_id = s.p_a2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.staff_notifications set read_at = now() where id = v_mine;
  if not exists (
    select 1 from public.staff_notifications where id = v_mine and read_at is not null
  ) then raise exception 'T16_nao_marcou'; end if;

  begin
    update public.staff_notifications set type = type where id = v_mine;
    raise exception 'T17_type_passou';
  exception
    when insufficient_privilege then null;
  end;
  begin
    update public.staff_notifications set severity = severity where id = v_mine;
    raise exception 'T17_severity_passou';
  exception
    when insufficient_privilege then null;
  end;
  begin
    update public.staff_notifications set recipient_profile_id = recipient_profile_id where id = v_mine;
    raise exception 'T17_recipient_passou';
  exception
    when insufficient_privilege then null;
  end;
  begin
    update public.staff_notifications set clinic_id = clinic_id where id = v_mine;
    raise exception 'T17_clinic_passou';
  exception
    when insufficient_privilege then null;
  end;

  update public.staff_notifications set read_at = now() where id = v_theirs;
  reset role;
  if exists (
    select 1 from public.staff_notifications where id = v_theirs and read_at is not null
  ) then raise exception 'T18_marcou_a2'; end if;
  raise notice 'WP-07B1 T16 T17 T18 PASSED';
end $$;
rollback;

-- T19 T20: INSERT/DELETE authenticated negados
begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.wp07b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.staff_notifications (
      clinic_id, recipient_profile_id, message_id, type, severity
    ) values (s.c_a, s.p_a1, gen_random_uuid(), 'help_requested', 'critical');
    raise exception 'T19_insert_passou';
  exception
    when insufficient_privilege then null;
  end;
  begin
    delete from public.staff_notifications;
    if found then raise exception 'T20_delete_passou'; end if;
  exception
    when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'WP-07B1 T19 T20 PASSED';
end $$;
rollback;

-- T21: desativar vínculo depois; histórico fica; chat não reabre
begin;
do $$
declare
  s record; v_hist int; v_chat int;
begin
  select * into s from pg_temp.wp07b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Dieta'));
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.deactivate_patient_link(s.prof_a1, s.pat, 'teste 07b1');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_hist from public.staff_notifications
    where recipient_profile_id = s.p_a1;
  if v_hist <> 1 then raise exception 'T21_hist(%)', v_hist; end if;
  select count(*) into v_chat from public.chat_messages where channel_id = s.ch;
  if v_chat <> 0 then raise exception 'T21_ainda_le_chat(%)', v_chat; end if;
  if private.can_access_patient(s.pat) then
    raise exception 'T21_ainda_acessa_paciente';
  end if;
  if private.can_read_channel(s.ch) then
    raise exception 'T21_ainda_le_canal';
  end if;
  reset role;
  raise notice 'WP-07B1 T21 PASSED';
end $$;
rollback;

-- T22 T23 T24: invariants notifications / mentions / publication
begin;
do $$
declare
  s record; v_pol int; v_ment_before int; v_ment_after int; v_pub int;
begin
  select count(*) into v_pol
    from pg_policies
   where schemaname = 'public' and tablename = 'notifications'
     and policyname in ('notifications_select', 'notifications_update_read');
  if v_pol <> 2 then raise exception 'T22_policies(%)', v_pol; end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'notifications'
       and qual not like '%is_self_patient%'
  ) then raise exception 'T22_qual_mudou'; end if;

  select * into s from pg_temp.wp07b1_seed();
  select count(*) into v_ment_before from public.chat_mentions;
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch, s.p_pat, 'patient', pg_temp.sos('Dieta'));
  reset role;
  select count(*) into v_ment_after from public.chat_mentions;
  if v_ment_after <> v_ment_before then raise exception 'T23_mencionou'; end if;

  select count(*) into v_pub
    from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename = 'staff_notifications';
  if v_pub <> 1 then raise exception 'T24_pub(%)', v_pub; end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then raise exception 'T24_removeu_chat'; end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'chat_mentions'
  ) then raise exception 'T24_removeu_mentions'; end if;

  if has_table_privilege('authenticated', 'public.staff_notifications', 'insert')
     or has_table_privilege('authenticated', 'public.staff_notifications', 'delete')
     or has_table_privilege('anon', 'public.staff_notifications', 'select')
     or not has_table_privilege('authenticated', 'public.staff_notifications', 'select')
     or not has_column_privilege('authenticated', 'public.staff_notifications', 'read_at', 'update')
     or has_column_privilege('authenticated', 'public.staff_notifications', 'severity', 'update')
  then
    raise exception 'T_grants_staff';
  end if;
  raise notice 'WP-07B1 T22 T23 T24 PASSED';
end $$;
rollback;
