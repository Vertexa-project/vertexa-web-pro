-- =====================================================================================
-- AVATAR-01 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Cobre: dono só na própria pasta; IDOR; prof ↛ paciente; paciente ↛ prof;
-- anon negado; path inválido; RPC JWT; grant de avatar_path negado.
-- =====================================================================================
begin;
do $$
declare
  fails text := '';
  n int;
  prev text;
  a_owner constant uuid := 'a0000000-0000-0000-0000-000000000001';
  a_pro  constant uuid := 'a1000000-0000-0000-0000-000000000001';
  a_pro2 constant uuid := 'a2000000-0000-0000-0000-000000000001';
  a_pat  constant uuid := 'ac000000-0000-0000-0000-000000000001';
  a_pat2 constant uuid := 'ac000000-0000-0000-0000-000000000002';
  pf_owner constant uuid := 'f0000000-0000-0000-0000-000000000001';
  pf_pro  constant uuid := 'f1000000-0000-0000-0000-000000000001';
  pf_pro2 constant uuid := 'f2000000-0000-0000-0000-000000000001';
  pf_pat  constant uuid := 'fc000000-0000-0000-0000-000000000001';
  pf_pat2 constant uuid := 'fc000000-0000-0000-0000-000000000002';
  path_pro  constant text := 'f1000000-0000-0000-0000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp';
  path_pro2 constant text := 'f2000000-0000-0000-0000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp';
  path_pat  constant text := 'fc000000-0000-0000-0000-000000000001/cccccccccccccccccccccccccccccccc.webp';
  path_pat2 constant text := 'fc000000-0000-0000-0000-000000000002/99999999999999999999999999999999.webp';
  path_bad  constant text := 'f1000000-0000-0000-0000-000000000001/../x.webp';
  path_trav constant text := 'f1000000-0000-0000-0000-000000000001/foto-luana.webp';
begin
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (pf_owner, a_owner, 'professional', 'Owner', 'active'),
    (pf_pro,  a_pro,  'professional', 'Pro A', 'active'),
    (pf_pro2, a_pro2, 'professional', 'Pro B', 'active'),
    (pf_pat,  a_pat,  'patient',      'Pat A', 'active'),
    (pf_pat2, a_pat2, 'patient',      'Pat B', 'active');
  -- Owner separado: can_see_profile libera admin/owner a ver staff.
  -- Pro A/B ficam member para provar isolamento de peer (não admin).
  insert into public.clinics (id, name, owner_profile_id) values
    ('ca000000-0000-0000-0000-000000000001', 'A', pf_owner);
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    ('e1000000-0000-0000-0000-000000000001', pf_pro,  'ca000000-0000-0000-0000-000000000001', 'nutritionist', 'member'),
    ('e2000000-0000-0000-0000-000000000001', pf_pro2, 'ca000000-0000-0000-0000-000000000001', 'doctor', 'member');
  insert into public.patients (id, profile_id, clinic_id) values
    ('da000000-0000-0000-0000-000000000001', pf_pat,  'ca000000-0000-0000-0000-000000000001'),
    ('da000000-0000-0000-0000-000000000002', pf_pat2, 'ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    ('e1000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', false, 'active');

  if not exists (select 1 from storage.buckets where id = 'profile-avatars' and public = false) then
    fails := fails || 'bucket_missing_or_public ';
  end if;

  insert into storage.objects (bucket_id, name) values
    ('profile-avatars', path_pro),
    ('profile-avatars', path_pro2),
    ('profile-avatars', path_pat),
    ('profile-avatars', path_pat2);

  execute 'set local role authenticated';
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Owner (contrato can_see_profile): lê staff; NÃO muta pasta alheia.
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001"}', true);
  if (select count(*) from storage.objects where name = path_pro) <> 1 then fails := fails || 'OWNER_staff_read '; end if;
  if (select count(*) from storage.objects where name = path_pro2) <> 1 then fails := fails || 'OWNER_peer_read '; end if;
  begin
    insert into storage.objects (bucket_id, name) values
      ('profile-avatars', 'f2000000-0000-0000-0000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01.webp');
    fails := fails || 'OWNER_insert_other ';
  exception when others then null;
  end;
  begin
    delete from storage.objects where name = path_pro2;
    get diagnostics n = row_count;
    if n > 0 then fails := fails || 'OWNER_delete_other '; end if;
  exception when others then null;
  end;

  -- Pro A member: lê o próprio; lê o paciente vinculado; NÃO lê Pro B (não admin).
  perform set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001"}', true);
  if (select count(*) from storage.objects where name = path_pro) <> 1 then fails := fails || 'PRO_own_read '; end if;
  if (select count(*) from storage.objects where name = path_pat) <> 1 then fails := fails || 'PRO_patient_read '; end if;
  if (select count(*) from storage.objects where name = path_pro2) <> 0 then fails := fails || 'PRO_peer_read '; end if;

  -- Pro A não escreve na pasta de Pro B nem do paciente.
  begin
    insert into storage.objects (bucket_id, name) values
      ('profile-avatars', 'f2000000-0000-0000-0000-000000000001/dddddddddddddddddddddddddddddddd.webp');
    fails := fails || 'PRO_insert_other ';
  exception when others then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values
      ('profile-avatars', 'fc000000-0000-0000-0000-000000000001/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.webp');
    fails := fails || 'PRO_insert_patient ';
  exception when others then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('profile-avatars', path_bad);
    fails := fails || 'PRO_insert_traversal ';
  exception when others then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('profile-avatars', path_trav);
    fails := fails || 'PRO_insert_original_name ';
  exception when others then null;
  end;
  begin
    delete from storage.objects where name = path_pro2;
    get diagnostics n = row_count;
    if n > 0 then fails := fails || 'PRO_delete_other '; end if;
  exception when others then null;
  end;

  -- Pro A sobe na própria pasta e seta o path.
  begin
    insert into storage.objects (bucket_id, name) values
      ('profile-avatars', 'f1000000-0000-0000-0000-000000000001/ffffffffffffffffffffffffffffffff.webp');
  exception when others then fails := fails || 'PRO_insert_own ';
  end;
  begin
    prev := public.set_my_avatar('f1000000-0000-0000-0000-000000000001/ffffffffffffffffffffffffffffffff.webp');
  exception when others then fails := fails || 'PRO_set_own ';
  end;
  if (select avatar_path from public.profiles where id = pf_pro)
       is distinct from 'f1000000-0000-0000-0000-000000000001/ffffffffffffffffffffffffffffffff.webp' then
    fails := fails || 'PRO_path_saved ';
  end if;

  -- Pro A não aponta para o path de B.
  begin
    perform public.set_my_avatar(path_pro2);
    fails := fails || 'PRO_set_other_path ';
  exception when others then null;
  end;

  -- UPDATE direto de avatar_path negado (sem grant de coluna).
  begin
    update public.profiles set avatar_path = path_pro2 where id = pf_pro;
    get diagnostics n = row_count;
    if n > 0 then
      if (select avatar_path from public.profiles where id = pf_pro) = path_pro2 then
        fails := fails || 'PRO_direct_update_path ';
      end if;
    end if;
  exception when insufficient_privilege then null;
            when others then null;
  end;

  -- Paciente A: lê o próprio e o profissional vinculado; não lê paciente B.
  perform set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001"}', true);
  if (select count(*) from storage.objects where name = path_pat) <> 1 then fails := fails || 'PAT_own_read '; end if;
  if (select count(*) from storage.objects where name = path_pro) <> 1 then fails := fails || 'PAT_pro_read '; end if;
  if (select count(*) from storage.objects where name = path_pat2) <> 0 then
    fails := fails || 'PAT_other_patient ';
  end if;
  begin
    insert into storage.objects (bucket_id, name) values
      ('profile-avatars', 'f1000000-0000-0000-0000-000000000001/11111111111111111111111111111111.webp');
    fails := fails || 'PAT_insert_pro ';
  exception when others then null;
  end;
  begin
    perform public.set_my_avatar(path_pro);
    fails := fails || 'PAT_set_pro_path ';
  exception when others then null;
  end;

  -- Paciente A sobe e remove o próprio.
  begin
    insert into storage.objects (bucket_id, name) values
      ('profile-avatars', 'fc000000-0000-0000-0000-000000000001/22222222222222222222222222222222.webp');
  exception when others then fails := fails || 'PAT_insert_own ';
  end;
  begin
    perform public.set_my_avatar('fc000000-0000-0000-0000-000000000001/22222222222222222222222222222222.webp');
  exception when others then fails := fails || 'PAT_set_own ';
  end;
  begin
    prev := public.remove_my_avatar();
    if prev is distinct from 'fc000000-0000-0000-0000-000000000001/22222222222222222222222222222222.webp' then
      fails := fails || 'PAT_remove_prev ';
    end if;
  exception when others then fails := fails || 'PAT_remove ';
  end;
  if (select avatar_path from public.profiles where id = pf_pat) is not null then
    fails := fails || 'PAT_path_cleared ';
  end if;

  -- Delete IDOR: paciente não apaga objeto do profissional.
  begin
    delete from storage.objects where name = path_pro;
    get diagnostics n = row_count;
    if n > 0 then fails := fails || 'PAT_delete_pro '; end if;
  exception when others then null;
  end;

  -- Care team: avatar_path do profissional autorizado; clínica suspensa some.
  perform set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001"}', true);
  if not exists (
    select 1 from public.get_my_care_team()
     where avatar_path = 'f1000000-0000-0000-0000-000000000001/ffffffffffffffffffffffffffffffff.webp'
  ) then
    fails := fails || 'CARE_TEAM_avatar_path ';
  end if;
  execute 'reset role';
  insert into public.clinics (id, name, owner_profile_id, status) values
    ('ca000000-0000-0000-0000-000000000002', 'Off', pf_owner, 'suspended');
  update public.professionals
     set clinic_id = 'ca000000-0000-0000-0000-000000000002'
   where id = 'e1000000-0000-0000-0000-000000000001';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001"}', true);
  if (select count(*) from public.get_my_care_team()) <> 0 then
    fails := fails || 'CARE_TEAM_suspended ';
  end if;

  -- Anon: sem leitura/escrita/RPC.
  execute 'reset role';
  execute 'set local role anon';
  if (select count(*) from storage.objects where bucket_id = 'profile-avatars') <> 0 then
    fails := fails || 'anon_read ';
  end if;
  begin
    insert into storage.objects (bucket_id, name) values ('profile-avatars', path_pro);
    fails := fails || 'anon_insert ';
  exception when others then null;
  end;
  begin
    perform public.set_my_avatar(path_pro);
    fails := fails || 'anon_rpc_set ';
  exception when others then null;
  end;
  begin
    perform public.remove_my_avatar();
    fails := fails || 'anon_rpc_remove ';
  exception when others then null;
  end;
  execute 'reset role';

  if length(fails) > 0 then
    raise exception 'AVATAR-01 TESTS FAILED: %', fails;
  else
    raise notice 'AVATAR-01: ALL ASSERTIONS PASSED';
  end if;
end $$;
rollback;
