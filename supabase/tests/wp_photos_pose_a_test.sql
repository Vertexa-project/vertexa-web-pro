-- =====================================================================================
-- WP-PHOTOS · A — TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20261020090000 aplicada (ou concatenada antes deste arquivo). Fixtures como postgres; nada persiste.
--
-- DESTAQUES: profissional vinculado grava foto RETROATIVA com pose (meio-dia em São Paulo, captured_in_app
-- false, autor gravado); data futura / pose inválida / path de outro paciente / arquivo inexistente /
-- duplicada ⟂; profissional de OUTRA clínica ⟂ (42501) em add, set_pose e no upload ao storage; o próprio
-- paciente NÃO usa o envio de profissional, mas PODE classificar a posição da própria foto; CHECK barra pose
-- inválida direto na tabela; o relatório devolve 'pose'.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; v jsonb; st text; pid uuid; pid2 uuid; n int; ts timestamptz;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  pOut uuid:=gen_random_uuid(); au_pOut uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pxProf uuid:=gen_random_uuid(); au_px uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); eOut uuid:=gen_random_uuid();
  daX uuid:=gen_random_uuid(); daY uuid:=gen_random_uuid(); pyProf uuid:=gen_random_uuid();
  f1 text; f2 text; fOther text; fMissing text; fOut text;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),
    (pOut,au_pOut,'professional','POut','active'),(adminB,au_adminB,'admin','Admin B','active'),
    (pxProf,au_px,'patient','Paciente X','active'),(pyProf,null,'patient','Paciente Y','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,p1,clA,'nutritionist','member'),(eOut,pOut,clB,'doctor','member');
  insert into public.patients (id,profile_id,clinic_id) values (daX,pxProf,clA),(daY,pyProf,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,daX,false,'active');
  f1 := daX::text||'/'||gen_random_uuid()::text||'.jpg';
  f2 := daX::text||'/'||gen_random_uuid()::text||'.jpg';
  fOther := daY::text||'/'||gen_random_uuid()::text||'.jpg';
  fMissing := daX::text||'/'||gen_random_uuid()::text||'.jpg';
  fOut := daX::text||'/'||gen_random_uuid()::text||'.jpg';
  insert into storage.objects (bucket_id,name) values ('progress-photos',f1),('progress-photos',f2),('progress-photos',fOther);

  -- ══ POSITIVO: P1 (vinculado) registra foto antiga com pose ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
    pid := public.add_progress_photo_for_patient(daX, f1, current_date - 90, 'front');
    pid2 := public.add_progress_photo_for_patient(daX, f2, current_date - 5, null);
  reset role;
  select taken_at into ts from public.progress_photos where id = pid;
  if (ts at time zone 'America/Sao_Paulo')::date <> current_date - 90 or (ts at time zone 'America/Sao_Paulo')::time <> time '12:00' then fails:=fails||'taken_at(got '||ts||') '; end if;
  select count(*) into n from public.progress_photos where id = pid and pose='front' and captured_in_app=false and uploaded_by_profile_id=p1 and storage_path=f1 and patient_id=daX;
  if n<>1 then fails:=fails||'row_fields '; end if;
  select count(*) into n from public.progress_photos where id = pid2 and pose is null;
  if n<>1 then fails:=fails||'pose_null '; end if;

  -- ══ validações (cada uma com o sqlstate certo) ══
  declare t record;
  begin
    for t in select * from (values
      ('future',  f1, (current_date + 1), 'front', '22023'),
      ('pose',    f1, (current_date - 1), 'diagonal', '22023'),
      ('otherpat',fOther, (current_date - 1), 'front', '22023'),
      ('missing', fMissing, (current_date - 1), 'front', '22023'),
      ('dup',     f1, (current_date - 1), 'front', '23505'),
      ('ancient', f1, date '1999-12-31', 'front', '22023')
    ) as x(k,path,d,pose,code) loop
      begin
        perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
        set local role authenticated;
          perform public.add_progress_photo_for_patient(daX, t.path, t.d, t.pose);
        reset role;
        fails:=fails||t.k||'_should_fail ';
      exception when others then
        reset role;
        get stacked diagnostics st = returned_sqlstate;
        if st <> t.code then fails:=fails||t.k||'_sqlstate(got '||st||') '; end if;
      end;
    end loop;
  end;

  -- ══ NEGATIVO: profissional de OUTRA clínica ⟂ em add / set_pose / storage ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_pOut::text)::text, true);
    set local role authenticated;
      perform public.add_progress_photo_for_patient(daX, f2, current_date - 1, 'back');
    reset role; fails:=fails||'outsider_add_should_fail ';
  exception when others then reset role; get stacked diagnostics st = returned_sqlstate;
    if st <> '42501' then fails:=fails||'outsider_add(got '||st||') '; end if; end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_pOut::text)::text, true);
    set local role authenticated;
      perform public.set_progress_photo_pose(pid2, 'side');
    reset role; fails:=fails||'outsider_pose_should_fail ';
  exception when others then reset role; get stacked diagnostics st = returned_sqlstate;
    if st <> '42501' then fails:=fails||'outsider_pose(got '||st||') '; end if; end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_pOut::text)::text, true);
    set local role authenticated;
      insert into storage.objects (bucket_id,name) values ('progress-photos',fOut);
    reset role; fails:=fails||'outsider_storage_should_fail ';
  exception when others then reset role; get stacked diagnostics st = returned_sqlstate;
    if st <> '42501' then fails:=fails||'outsider_storage(got '||st||') '; end if; end;

  -- ══ POSITIVO: P1 sobe objeto no storage do paciente vinculado ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
    set local role authenticated;
      insert into storage.objects (bucket_id,name) values ('progress-photos',daX::text||'/'||gen_random_uuid()::text||'.png');
    reset role;
  exception when others then reset role; get stacked diagnostics st = returned_sqlstate;
    fails:=fails||'pro_storage_should_work(got '||st||') '; end;

  -- ══ set_progress_photo_pose: profissional vinculado e o PRÓPRIO paciente ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
    perform public.set_progress_photo_pose(pid2, 'side');
  reset role;
  if (select pose from public.progress_photos where id=pid2) is distinct from 'side' then fails:=fails||'pro_set_pose '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_px::text)::text, true);
  set local role authenticated;
    perform public.set_progress_photo_pose(pid2, 'back');
    perform public.set_progress_photo_pose(pid2, null);
  reset role;
  if (select pose from public.progress_photos where id=pid2) is not null then fails:=fails||'self_set_pose_null '; end if;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_px::text)::text, true);
    set local role authenticated;
      perform public.set_progress_photo_pose(pid2, 'x');
    reset role; fails:=fails||'bad_pose_should_fail ';
  exception when others then reset role; get stacked diagnostics st = returned_sqlstate;
    if st <> '22023' then fails:=fails||'bad_pose(got '||st||') '; end if; end;

  -- ══ o PACIENTE não usa o envio de profissional ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_px::text)::text, true);
    set local role authenticated;
      perform public.add_progress_photo_for_patient(daX, f2, current_date - 1, null);
    reset role; fails:=fails||'patient_add_should_fail ';
  exception when others then reset role; get stacked diagnostics st = returned_sqlstate;
    if st <> '42501' then fails:=fails||'patient_add(got '||st||') '; end if; end;

  -- ══ CHECK da tabela barra pose inválida mesmo por INSERT direto ══
  begin
    insert into public.progress_photos (patient_id, storage_path, pose) values (daX, daX::text||'/z.jpg', 'diagonal');
    fails:=fails||'check_should_fail ';
  exception when check_violation then null; end;

  -- ══ relatório devolve a pose ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
    select public.export_patient_report(daX, current_date-120, current_date, array['photos'], 'web') into v;
  reset role;
  if jsonb_array_length(v->'sections'->'photos') <> 2 then fails:=fails||'report_len '; end if;
  if (v->'sections'->'photos'->0->>'pose') is distinct from 'front' then fails:=fails||'report_pose(got '||coalesce(v->'sections'->'photos'->0->>'pose','null')||') '; end if;

  if fails <> '' then raise exception 'WP-PHOTOS-A FAILS: %', fails; end if;
  raise notice 'WP-PHOTOS-A: OK';
end $$;
rollback;
