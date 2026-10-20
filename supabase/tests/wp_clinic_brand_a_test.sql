-- WP-BRAND · A — testes (login via request.jwt.claims; ROLLBACK). Assume 20261022090000 aplicada/concatenada.
begin;
do $$
declare
  fails text := ''; st text; n int; r record;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  memA uuid:=gen_random_uuid(); au_memA uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pacP uuid:=gen_random_uuid(); au_pac uuid:=gen_random_uuid();
  loner uuid:=gen_random_uuid(); au_loner uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  prA uuid:=gen_random_uuid(); prM uuid:=gen_random_uuid(); prB uuid:=gen_random_uuid();
  pt uuid:=gen_random_uuid();
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(memA,au_memA,'professional','Membro A','active'),
    (adminB,au_adminB,'admin','Admin B','active'),(pacP,au_pac,'patient','Paciente','active'),
    (loner,au_loner,'professional','Sem clínica','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'Clínica A',adminA),(clB,'Clínica B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (prA,adminA,clA,'nutritionist','admin'),(prM,memA,clA,'nutritionist','member'),(prB,adminB,clB,'doctor','admin');
  insert into public.patients (id,profile_id,clinic_id) values (pt,pacP,clA);

  -- ══ admin A grava marca da PRÓPRIA clínica + sobe logo na própria pasta ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true);
  set local role authenticated;
  update public.clinics set logo_path = clA::text||'/logo1.png', brand_color = '#1A2B3C' where id = clA;
  get diagnostics n = row_count; if n <> 1 then fails:=fails||'admin_update '; end if;
  insert into storage.objects (bucket_id,name,owner) values ('clinic-logos', clA::text||'/logo1.png', au_adminA);
  -- NEGATIVOS do admin A
  begin update public.clinics set logo_path = clB::text||'/x.png' where id = clA; fails:=fails||'path_other_clinic ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'pathB_sqlstate('||st||') '; end if; end;
  begin update public.clinics set logo_path = clA::text||'/../x.png' where id = clA; fails:=fails||'path_traversal ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'traversal_sqlstate('||st||') '; end if; end;
  begin update public.clinics set brand_color = 'red' where id = clA; fails:=fails||'bad_color ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'23514' then fails:=fails||'color_sqlstate('||st||') '; end if; end;
  begin insert into storage.objects (bucket_id,name,owner) values ('clinic-logos', clB::text||'/hack.png', au_adminA); fails:=fails||'upload_other_folder ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'uploadB_sqlstate('||st||') '; end if; end;
  begin insert into storage.objects (bucket_id,name,owner) values ('clinic-logos', 'solto.png', au_adminA); fails:=fails||'upload_no_folder ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'uploadroot_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ membro comum (não admin) NÃO altera marca nem sobe logo ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_memA::text)::text, true);
  set local role authenticated;
  update public.clinics set brand_color = '#FF0000' where id = clA;
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'member_update '; end if;
  begin insert into storage.objects (bucket_id,name,owner) values ('clinic-logos', clA::text||'/m.png', au_memA); fails:=fails||'member_upload ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'memupload_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ admin de OUTRA clínica não altera a marca de A, nem sobrescreve o logo de A ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminB::text)::text, true);
  set local role authenticated;
  update public.clinics set brand_color = '#00FF00' where id = clA;
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'otheradmin_update '; end if;
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id='clinic-logos' and name = clA::text||'/logo1.png';
  get diagnostics n = row_count; if n <> 0 then fails:=fails||'otheradmin_overwrite '; end if;
  reset role;
  select count(*) into n from storage.objects where bucket_id='clinic-logos' and name = clA::text||'/logo1.png';
  if n <> 1 then fails:=fails||'logo_vanished '; end if;

  -- ══ get_my_clinic_brand: staff, paciente, e sem vínculo ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_memA::text)::text, true);
  set local role authenticated; select * into r from public.get_my_clinic_brand(); reset role;
  if r.clinic_id is distinct from clA or r.logo_path is distinct from clA::text||'/logo1.png' or r.brand_color is distinct from '#1A2B3C' then fails:=fails||'brand_staff '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_pac::text)::text, true);
  set local role authenticated; select * into r from public.get_my_clinic_brand(); reset role;
  if r.clinic_name is distinct from 'Clínica A' or r.logo_path is null then fails:=fails||'brand_patient '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_loner::text)::text, true);
  set local role authenticated; select count(*) into n from public.get_my_clinic_brand(); reset role;
  if n <> 0 then fails:=fails||'brand_loner '; end if;
  set local role anon;
  begin perform * from public.get_my_clinic_brand(); fails:=fails||'brand_anon ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'anon_sqlstate('||st||') '; end if; end;
  reset role;

  if fails <> '' then raise exception 'WP-BRAND-A FAILS: %', fails; end if;
  raise notice 'WP-BRAND-A: OK';
end $$;
rollback;
