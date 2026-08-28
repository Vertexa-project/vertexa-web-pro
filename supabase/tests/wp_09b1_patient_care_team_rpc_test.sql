-- =====================================================================================
-- WP-09B1 · TESTES (Nível 1: BEGIN / DO pequeno / ROLLBACK).
-- HARNESS: NÃO é um DO monolítico. Exige a migration 20260817090000 aplicada.
-- Login simulado via request.jwt.claims (sub = auth_user_id) + set local role.
-- =====================================================================================

create or replace function pg_temp.wp09b1_seed()
returns table (
  a_p1 uuid, a_p2 uuid, a_adm uuid, a_pro uuid,
  p1 uuid, p2 uuid,
  prof_ana uuid, prof_bruno uuid, prof_carla uuid,
  prof_ext uuid, prof_ina uuid, prof_deadlink uuid, prof_beta uuid,
  pf_ana uuid, pf_bruno uuid, pf_carla uuid, pf_adm uuid
)
language plpgsql
as $seed$
declare
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_pf_ana uuid := gen_random_uuid(); v_a_ana uuid := gen_random_uuid();
  v_pf_bru uuid := gen_random_uuid(); v_a_bru uuid := gen_random_uuid();
  v_pf_car uuid := gen_random_uuid(); v_a_car uuid := gen_random_uuid();
  v_pf_ext uuid := gen_random_uuid(); v_a_ext uuid := gen_random_uuid();
  v_pf_ina uuid := gen_random_uuid(); v_a_ina uuid := gen_random_uuid();
  v_pf_dead uuid := gen_random_uuid(); v_a_dead uuid := gen_random_uuid();
  v_pf_p1 uuid := gen_random_uuid(); v_a_p1 uuid := gen_random_uuid();
  v_pf_p2 uuid := gen_random_uuid(); v_a_p2 uuid := gen_random_uuid();
  v_pf_beta uuid := gen_random_uuid(); v_a_beta uuid := gen_random_uuid();
  v_pr_own uuid; v_pr_ana uuid; v_pr_bru uuid; v_pr_car uuid;
  v_pr_ext uuid; v_pr_ina uuid; v_pr_dead uuid; v_pr_beta uuid;
  v_p1 uuid; v_p2 uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, avatar_url, status) values
    (v_pf_own,  v_a_own,  'professional', 'Dona Alfa',     'own-09b1@t.test',  null, 'active'),
    (v_pf_adm,  v_a_adm,  'professional', 'Admin SemLink', 'adm-09b1@t.test',  null, 'active'),
    (v_pf_ana,  v_a_ana,  'professional', 'Ana Nutri',     'ana-09b1@t.test',  null, 'active'),
    (v_pf_bru,  v_a_bru,  'professional', 'Bruno Med',     'bru-09b1@t.test',  'https://cdn.example/bruno.png', 'active'),
    (v_pf_car,  v_a_car,  'professional', 'Carla Fisio',   'car-09b1@t.test',  null, 'active'),
    (v_pf_ext,  v_a_ext,  'professional', 'Externo',       'ext-09b1@t.test',  null, 'active'),
    (v_pf_ina,  v_a_ina,  'professional', 'Inativo Prof',  'ina-09b1@t.test',  null, 'active'),
    (v_pf_dead, v_a_dead, 'professional', 'Link Morto',    'dead-09b1@t.test', null, 'active'),
    (v_pf_p1,   v_a_p1,   'patient',      'Paciente Um',   'p1-09b1@t.test',   null, 'active'),
    (v_pf_p2,   v_a_p2,   'patient',      'Paciente Dois', 'p2-09b1@t.test',   null, 'active'),
    (v_pf_beta, v_a_beta, 'professional', 'Beta SoB',      'beta-09b1@t.test', null, 'active');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1, 'Clinica Alfa 09B1', v_pf_own),
    (v_c2, 'Clinica Beta 09B1', v_pf_beta);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_own, v_c1, 'other', 'admin', 'active') returning id into v_pr_own;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_adm, v_c1, 'doctor', 'admin', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, specialty, status)
    values (v_pf_ana, v_c1, 'nutritionist', 'member', 'nutri clínica', 'active') returning id into v_pr_ana;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_bru, v_c1, 'doctor', 'member', 'active') returning id into v_pr_bru;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_car, v_c1, 'physiotherapist', 'member', 'active') returning id into v_pr_car;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_ext, v_c1, 'nutritionist', 'member', 'active') returning id into v_pr_ext;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_ina, v_c1, 'other', 'member', 'inactive') returning id into v_pr_ina;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_dead, v_c1, 'other', 'member', 'active') returning id into v_pr_dead;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_beta, v_c2, 'doctor', 'admin', 'active') returning id into v_pr_beta;

  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_p1, v_c1, 'meta') returning id into v_p1;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_p2, v_c2, 'meta') returning id into v_p2;

  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (v_pr_ana,  v_p1, false, 'active'),
    (v_pr_bru,  v_p1, false, 'active'),
    (v_pr_car,  v_p1, false, 'active'),
    (v_pr_ext,  v_p1, true,  'active'),
    (v_pr_ina,  v_p1, false, 'active'),
    (v_pr_dead, v_p1, false, 'inactive'),
    (v_pr_beta, v_p2, false, 'active');

  insert into public.professional_disciplines (professional_id, discipline) values
    (v_pr_ana, 'nutricionista'),
    (v_pr_ana, 'psicologo'),
    (v_pr_bru, 'medico');

  return query select
    v_a_p1, v_a_p2, v_a_adm, v_a_ana,
    v_p1, v_p2,
    v_pr_ana, v_pr_bru, v_pr_car,
    v_pr_ext, v_pr_ina, v_pr_dead, v_pr_beta,
    v_pf_ana, v_pf_bru, v_pf_car, v_pf_adm;
end;
$seed$;


-- T24 RPC sem parâmetros.
begin;
do $$
begin
  if pg_get_function_identity_arguments('public.get_my_care_team()'::regprocedure) <> '' then
    raise exception 'WP-09B1 T24 FAIL: args=%',
      pg_get_function_identity_arguments('public.get_my_care_team()'::regprocedure);
  end if;
  raise notice 'WP-09B1 T24: PASS';
end $$;
rollback;


-- T20 retorno sem campos administrativos.
begin;
do $$
declare
  r text;
begin
  select pg_get_function_result('public.get_my_care_team()'::regprocedure) into r;
  if r ~* 'email|auth_user|registry|clinic_role|clinic_id|status_reason|status_changed' then
    raise exception 'WP-09B1 T20 FAIL: %', r;
  end if;
  if r not like '%professional_id%' or r not like '%display_name%' or r not like '%disciplines%' then
    raise exception 'WP-09B1 T20 FAIL: colunas mínimas ausentes %', r;
  end if;
  raise notice 'WP-09B1 T20: PASS %', r;
end $$;
rollback;


-- T13 zero dependência de chat.
begin;
do $$
declare
  def text;
begin
  select pg_get_functiondef('public.get_my_care_team()'::regprocedure) into def;
  if def ~* 'chat_channels|chat_participants|channel_professionals|get_or_create_channel|channel_id' then
    raise exception 'WP-09B1 T13 FAIL: chat na definição';
  end if;
  raise notice 'WP-09B1 T13: PASS';
end $$;
rollback;


-- T17 anon sem execute. T18 authenticated possui execute. T19 PUBLIC revogado.
begin;
do $$
declare
  n_pub int;
begin
  if has_function_privilege('anon', 'public.get_my_care_team()', 'execute') then
    raise exception 'WP-09B1 T17 FAIL: anon execute';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_care_team()', 'execute') then
    raise exception 'WP-09B1 T18 FAIL: authenticated sem execute';
  end if;
  select count(*) into n_pub
    from information_schema.routine_privileges
   where specific_schema = 'public'
     and routine_name = 'get_my_care_team'
     and grantee = 'PUBLIC';
  if n_pub <> 0 then raise exception 'WP-09B1 T19 FAIL: PUBLIC grants=%', n_pub; end if;
  raise notice 'WP-09B1 T17 T18 T19: PASS';
end $$;
rollback;


-- T1 um ativo interno. T11 nome/profile. T14 avatar null não remove. T22/T21 side effects.
begin;
do $$
declare
  s record; n int; n_links int; n_ch int; n_cp int; n_msg int; n_notif int;
  r record;
begin
  select * into s from pg_temp.wp09b1_seed();
  delete from public.professional_patient_links
   where patient_id = s.p1 and professional_id <> s.prof_ana;
  select count(*) into n_links from public.professional_patient_links;
  select count(*) into n_ch from public.chat_channels;
  select count(*) into n_cp from public.chat_participants;
  select count(*) into n_msg from public.chat_messages;
  select count(*) into n_notif from public.staff_notifications;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_care_team();
  select * into r from public.get_my_care_team();
  reset role;

  if n <> 1 then raise exception 'WP-09B1 T1 FAIL: n=%', n; end if;
  if r.professional_id is distinct from s.prof_ana then
    raise exception 'WP-09B1 T11 FAIL: professional_id';
  end if;
  if r.profile_id is distinct from s.pf_ana then
    raise exception 'WP-09B1 T11 FAIL: profile_id';
  end if;
  if r.display_name is distinct from 'Ana Nutri' then
    raise exception 'WP-09B1 T11 FAIL: name=%', r.display_name;
  end if;
  if r.avatar_url is not null then
    raise exception 'WP-09B1 T14 FAIL: avatar deveria ser null';
  end if;
  if (select count(*) from public.professional_patient_links) <> n_links then
    raise exception 'WP-09B1 T22 FAIL: links';
  end if;
  if (select count(*) from public.chat_channels) <> n_ch
     or (select count(*) from public.chat_participants) <> n_cp
     or (select count(*) from public.chat_messages) <> n_msg
     or (select count(*) from public.staff_notifications) <> n_notif then
    raise exception 'WP-09B1 T21 FAIL: chat/notif';
  end if;
  raise notice 'WP-09B1 T1 T11 T14 T21 T22: PASS';
end $$;
rollback;


-- T2 três ativos. T5 inactive link. T6 external. T7 professional inactive. T8 admin. T12 disciplines. T23 ordem.
begin;
do $$
declare
  s record; n int; ids uuid[]; names text[]; disc text[];
begin
  select * into s from pg_temp.wp09b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_care_team();
  select array_agg(professional_id order by display_name, professional_id),
         array_agg(display_name order by display_name, professional_id)
    into ids, names
    from public.get_my_care_team();
  select disciplines into disc from public.get_my_care_team()
   where professional_id = s.prof_ana;

  if n <> 3 then raise exception 'WP-09B1 T2 FAIL: n=%', n; end if;
  if s.prof_deadlink = any (ids) then raise exception 'WP-09B1 T5 FAIL: inactive link'; end if;
  if s.prof_ext = any (ids) then raise exception 'WP-09B1 T6 FAIL: external'; end if;
  if s.prof_ina = any (ids) then raise exception 'WP-09B1 T7 FAIL: inactive professional'; end if;
  if names <> array['Ana Nutri','Bruno Med','Carla Fisio']::text[] then
    raise exception 'WP-09B1 T23 FAIL: %', names;
  end if;
  if disc is distinct from array['nutricionista','psicologo']::text[] then
    raise exception 'WP-09B1 T12 FAIL: %', disc;
  end if;
  if cardinality(disc) <> 2 then
    raise exception 'WP-09B1 T12 FAIL: duplicata cardinality=%', cardinality(disc);
  end if;
  if exists (select 1 from public.get_my_care_team() where profile_id = s.pf_adm) then
    raise exception 'WP-09B1 T8 FAIL: admin sem vínculo';
  end if;
  if (select count(*) from public.get_my_care_team())
       <> (select count(distinct professional_id) from public.get_my_care_team()) then
    raise exception 'WP-09B1 T21-dup FAIL: professional_id repetido';
  end if;
  reset role;
  raise notice 'WP-09B1 T2 T5 T6 T7 T8 T12 T23: PASS';
end $$;
rollback;


-- T3 sem canal → equipe aparece. T15 sem vínculo → [].
begin;
do $$
declare
  s record; n int; n_ch int;
begin
  select * into s from pg_temp.wp09b1_seed();
  select count(*) into n_ch from public.chat_channels where patient_id = s.p1;
  if n_ch <> 0 then raise exception 'WP-09B1 T3 FAIL: canal pré-existente'; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_care_team();
  reset role;
  if n <> 3 then raise exception 'WP-09B1 T3 FAIL: n=%', n; end if;
  if (select count(*) from public.chat_channels where patient_id = s.p1) <> 0 then
    raise exception 'WP-09B1 T3 FAIL: RPC criou canal';
  end if;

  delete from public.professional_patient_links where patient_id = s.p1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_care_team();
  reset role;
  if n <> 0 then raise exception 'WP-09B1 T15 FAIL: n=%', n; end if;
  raise notice 'WP-09B1 T3 T15: PASS';
end $$;
rollback;


-- T4 profissional fora do roster continua na care team.
-- Prova mínima: insert direto no roster (NÃO chama get_or_create_channel, que sincronizaria todos).
begin;
do $$
declare
  s record; ch uuid := gen_random_uuid(); n_team int; n_roster int; n_carla int;
begin
  select * into s from pg_temp.wp09b1_seed();
  insert into public.chat_channels (id, patient_id) values (ch, s.p1);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (ch, s.pf_ana, 'professional'),
    (ch, s.pf_bruno, 'professional');
  select count(*) into n_roster
    from public.chat_participants
   where channel_id = ch and role = 'professional';
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_team from public.get_my_care_team();
  select count(*) into n_carla from public.get_my_care_team()
   where professional_id = s.prof_carla;
  reset role;
  if n_team <> 3 then raise exception 'WP-09B1 T4 FAIL: team=%', n_team; end if;
  if n_roster <> 2 then raise exception 'WP-09B1 T4 FAIL: roster=%', n_roster; end if;
  if n_carla <> 1 then raise exception 'WP-09B1 T4 FAIL: Carla ausente da care team'; end if;
  raise notice 'WP-09B1 T4: PASS team=3 roster=2';
end $$;
rollback;


-- T9 outro paciente zero leak. T10 outra clínica.
begin;
do $$
declare
  s record; n int; ids uuid[];
begin
  select * into s from pg_temp.wp09b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select array_agg(professional_id) into ids from public.get_my_care_team();
  reset role;
  if s.prof_beta = any (ids) then raise exception 'WP-09B1 T10 FAIL: leak clínica B'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_p2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_care_team();
  select array_agg(professional_id) into ids from public.get_my_care_team();
  reset role;
  if n <> 1 then raise exception 'WP-09B1 T9 FAIL: p2 n=%', n; end if;
  if ids is distinct from array[s.prof_beta] then
    raise exception 'WP-09B1 T9 FAIL: p2 ids=%', ids;
  end if;
  if s.prof_ana = any (ids) then raise exception 'WP-09B1 T9 FAIL: leak p1'; end if;
  raise notice 'WP-09B1 T9 T10: PASS';
end $$;
rollback;


-- T16 authenticated que não é patient → zero rows.
begin;
do $$
declare
  s record; n int;
begin
  select * into s from pg_temp.wp09b1_seed();
  perform set_config('request.jwt.claims',
    json_build_object('sub', s.a_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_care_team();
  reset role;
  if n <> 0 then raise exception 'WP-09B1 T16 FAIL: n=%', n; end if;
  raise notice 'WP-09B1 T16: PASS';
end $$;
rollback;


-- T17 runtime (SET ROLE anon + nested EXCEPTION) omitted: no isolador PG 17.6
-- isso provoca SIGSEGV. Prova de execute = T17 has_function_privilege + PostgREST anon.


select 1 as ok;
select pg_is_in_recovery() as in_recovery;
