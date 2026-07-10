-- =====================================================================================
-- WP-05B · FAMÍLIA 1 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Executável em um shot (psql -f / supabase db query / MCP execute_sql).
-- Semântica: se TUDO passar, o bloco termina em silêncio e o ROLLBACK final limpa as fixtures
--   (sem erro). Se algo falhar, RAISE EXCEPTION lista as asserções quebradas (e reprova).
-- Fixtures (A5): 2 clínicas, admin owner + co-admin(A2), P1(vinc X), P2(sem vínculo, mesma clínica),
--   P3(clínica B), externo PE(is_external→X), pacientes X/Y(clínica A)/Z(clínica B), + PENDING.
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  A_uid  constant text := 'aa000000-0000-0000-0000-000000000001'; -- admin/owner A
  A2_uid constant text := 'aa000000-0000-0000-0000-000000000002'; -- co-admin A (membership)
  P1_uid constant text := 'a1000000-0000-0000-0000-000000000001';
  P2_uid constant text := 'a2000000-0000-0000-0000-000000000001';
  P3_uid constant text := 'a3000000-0000-0000-0000-000000000001';
  PE_uid constant text := 'ae000000-0000-0000-0000-000000000001';
  X_uid  constant text := 'ac000000-0000-0000-0000-000000000001';
  PEND_uid constant text := 'ad000000-0000-0000-0000-000000000001';
  X  constant uuid := 'da000000-0000-0000-0000-000000000001';
  Y  constant uuid := 'da000000-0000-0000-0000-000000000002';
  Z  constant uuid := 'db000000-0000-0000-0000-000000000001';
  procedure_noop int; -- filler
begin
  -- ---------- fixtures (como superuser do teste; RLS bypass no seed) ----------
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','Admin A','aa@t','active'),
    ('fa000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000002','professional','CoAdmin A2','a2@t','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','p1@t','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','p2@t','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','Admin B','ab@t','active'),
    ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','professional','P3','p3@t','active'),
    ('fe000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001','professional','Ext','e@t','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','x@t','active'),
    ('fc000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','patient','Y','y@t','active'),
    ('fc000000-0000-0000-0000-000000000003','ac000000-0000-0000-0000-000000000003','patient','Z','z@t','active'),
    ('fd000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000001','patient','Pend','pd@t','pending');
  insert into public.clinics (id, name, owner_profile_id) values
    ('ca000000-0000-0000-0000-000000000001','Clinica A','fa000000-0000-0000-0000-000000000001'),
    ('cb000000-0000-0000-0000-000000000001','Clinica B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    ('ea000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','doctor','admin'),
    ('ea000000-0000-0000-0000-000000000002','fa000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001','doctor','admin'),
    ('e1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','physiotherapist','member'),
    ('e3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','doctor','member'),
    ('ee000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','personal_trainer','member');
  insert into public.patients (id, profile_id, clinic_id) values
    (X,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),
    (Y,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001'),
    (Z,'fc000000-0000-0000-0000-000000000003','cb000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    ('e1000000-0000-0000-0000-000000000001',X,false,'active'),
    ('e3000000-0000-0000-0000-000000000001',Z,false,'active'),
    ('ee000000-0000-0000-0000-000000000001',X,true,'active');

  execute 'set local role authenticated';

  -- ===================== POSITIVOS / NEGATIVOS de LEITURA =====================
  perform set_config('request.jwt.claims', json_build_object('sub',P1_uid)::text, true);
  if (select count(*) from public.patients where id=X)<>1 then fails:=fails||'p1_sees_X '; end if;
  if (select count(*) from public.patients)<>1            then fails:=fails||'p1_patients_only_1 '; end if;   -- não vê Y/Z
  if (select count(*) from public.profiles where id='f2000000-0000-0000-0000-000000000001')<>0 then fails:=fails||'p1_not_P2_profile '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',P2_uid)::text, true);
  if (select count(*) from public.patients where id=X)<>0 then fails:=fails||'p2_not_X_SAME_CLINIC '; end if;  -- mesma clínica ≠ acesso
  if (select count(*) from public.patients)<>0            then fails:=fails||'p2_patients_0 '; end if;
  if (select count(*) from public.clinics where id='ca000000-0000-0000-0000-000000000001')<>1 then fails:=fails||'p2_sees_clinicA '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',A_uid)::text, true);
  if (select count(*) from public.patients)<>2 then fails:=fails||'admin_sees_2_patients '; end if;
  if (select count(*) from public.patients where id=Z)<>0 then fails:=fails||'admin_not_Z '; end if;
  if (select count(*) from public.professionals)<>4 then fails:=fails||'admin_sees_4_profs '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',A2_uid)::text, true); -- co-admin por membership
  if (select count(*) from public.patients)<>2 then fails:=fails||'coadmin_sees_2 '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',PE_uid)::text, true);  -- externo = mínimo
  if (select count(*) from public.patients where id=X)<>1 then fails:=fails||'ext_sees_X '; end if;
  if (select count(*) from public.patients)<>1 then fails:=fails||'ext_only_X '; end if;
  if (select count(*) from public.clinics where id='ca000000-0000-0000-0000-000000000001')<>0 then fails:=fails||'ext_not_clinicA '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',X_uid)::text, true);   -- paciente
  if (select count(*) from public.patients)<>1 then fails:=fails||'x_only_self '; end if;
  if (select count(*) from public.profiles where id='f1000000-0000-0000-0000-000000000001')<>1 then fails:=fails||'x_sees_careteam_P1 '; end if;
  if (select count(*) from public.profiles where id='f2000000-0000-0000-0000-000000000001')<>0 then fails:=fails||'x_not_P2 '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',PEND_uid)::text, true); -- pending fail-closed
  if (select count(*) from public.patients)<>0 then fails:=fails||'pending_no_patients '; end if;
  if (select count(*) from public.clinics)<>0 then fails:=fails||'pending_no_clinics '; end if;
  if (select count(*) from public.profiles)<>1 then fails:=fails||'pending_only_own_profile '; end if;

  -- ===================== NEGATIVOS de ESCRITA (auto-promoção) =====================
  perform set_config('request.jwt.claims', json_build_object('sub',P1_uid)::text, true);
  begin insert into public.professional_patient_links(professional_id,patient_id) values('e1000000-0000-0000-0000-000000000001',Y);
        fails:=fails||'NEG_p1_self_grant_link '; exception when others then null; end;
  begin insert into public.professionals(profile_id,clinic_id,type) values('f1000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','doctor');
        fails:=fails||'NEG_p1_self_insert_prof '; exception when others then null; end;
  begin update public.profiles set role='admin' where id='f1000000-0000-0000-0000-000000000001';
        get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_p1_role_admin '; end if; exception when others then null; end;
  begin update public.profiles set auth_user_id='00000000-0000-0000-0000-0000000000ff' where id='f1000000-0000-0000-0000-000000000001';
        get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_p1_authuid '; end if; exception when others then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub',P2_uid)::text, true);
  begin update public.clinics set owner_profile_id='f2000000-0000-0000-0000-000000000001' where id='ca000000-0000-0000-0000-000000000001';
        get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_p2_clinic_takeover '; end if; exception when others then null; end;
  begin insert into public.clinics(name,owner_profile_id) values('Evil','f2000000-0000-0000-0000-000000000001');
        fails:=fails||'NEG_p2_insert_clinic '; exception when others then null; end;
  begin update public.patients set goal='hack' where id=X;
        get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_p2_update_X '; end if; exception when others then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub',X_uid)::text, true);
  begin update public.patients set clinic_id='cb000000-0000-0000-0000-000000000001' where id=X;
        get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_x_change_clinic '; end if; exception when others then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub',PE_uid)::text, true);   -- externo NÃO escreve
  begin update public.patients set goal='exthack' where id=X;
        get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_ext_update_X '; end if; exception when others then null; end;

  -- ===================== POSITIVOS de ESCRITA =====================
  perform set_config('request.jwt.claims', json_build_object('sub',A_uid)::text, true);
  begin insert into public.professional_patient_links(professional_id,patient_id) values('e2000000-0000-0000-0000-000000000001',Y);
        exception when others then fails:=fails||'POS_admin_create_link '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',X_uid)::text, true);
  begin update public.profiles set full_name='X New' where id='fc000000-0000-0000-0000-000000000001';
        get diagnostics n=row_count; if n<>1 then fails:=fails||'POS_x_update_own_name '; end if; exception when others then fails:=fails||'POS_x_update_own_name_err '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',P1_uid)::text, true);
  begin update public.patients set goal='novo' where id=X;
        get diagnostics n=row_count; if n<>1 then fails:=fails||'POS_p1_update_linked '; end if; exception when others then fails:=fails||'POS_p1_update_linked_err '; end;

  -- ===================== ANON nega tudo =====================
  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.profiles)<>0 or (select count(*) from public.patients)<>0
     or (select count(*) from public.clinics)<>0 or (select count(*) from public.professionals)<>0
     or (select count(*) from public.professional_patient_links)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then
    raise exception 'WP05B-FAM1 TESTS FAILED: %', fails;
  else
    raise notice 'WP05B-FAM1: ALL ASSERTIONS PASSED';
  end if;
end $$;
rollback;
