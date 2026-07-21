-- =====================================================================================
-- WP-ARTE · A — TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20260731090000 aplicada. Fixtures como postgres (bypassrls); nada persiste.
--
-- DESTAQUES: consentimento de UMA versão NÃO serve para outra (coração do modelo); uso em canal NÃO
-- autorizado negado; uso após expiração/revogação negado (revogação corta na hora); MENOR/birth_date
-- NULA bloqueados (D4); registro presencial exige campos obrigatórios (CHECK) e é distinguível do app;
-- autor da concessão/revogação vem do SERVIDOR; externo/não-vinculado/outra clínica/anon negados;
-- auditoria não alterável/apagável pelo client.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; n int; v_cnt int;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  p2 uuid:=gen_random_uuid(); au_p2 uuid:=gen_random_uuid();
  pext uuid:=gen_random_uuid(); au_pext uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  prof_x1 uuid:=gen_random_uuid(); au_x1 uuid:=gen_random_uuid();
  prof_x2 uuid:=gen_random_uuid(); au_x2 uuid:=gen_random_uuid();
  prof_minor uuid:=gen_random_uuid(); au_minor uuid:=gen_random_uuid();
  prof_null uuid:=gen_random_uuid(); au_null uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); eext uuid:=gen_random_uuid();
  x1 uuid:=gen_random_uuid(); x2 uuid:=gen_random_uuid(); xminor uuid:=gen_random_uuid(); xnull uuid:=gen_random_uuid();
  v_term uuid; r jsonb; v_piece uuid; v1 uuid; v2 uuid;
  v_consent_app uuid; v_consent_ip uuid; v_p2v1 uuid; v_consent_exp uuid; v_minor_v uuid; v_null_v uuid;
  v_origin text; v_by uuid; v_status text; v_exp timestamptz;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),
    (p2,au_p2,'professional','P2','active'),(pext,au_pext,'professional','Ext','active'),
    (adminB,au_adminB,'admin','Admin B','active'),
    (prof_x1,au_x1,'patient','X1','active'),(prof_x2,au_x2,'patient','X2','active'),
    (prof_minor,au_minor,'patient','Menor','active'),(prof_null,au_null,'patient','SemData','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,p1,clA,'nutritionist','member'),(e2,p2,clA,'physiotherapist','member'),(eext,pext,clB,'personal_trainer','member');
  insert into public.patients (id,profile_id,clinic_id,birth_date) values
    (x1,prof_x1,clA,date '1990-01-01'),(x2,prof_x2,clA,date '1988-05-05'),
    (xminor,prof_minor,clA,(current_date - interval '10 years')::date),(xnull,prof_null,clA,null);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values
    (e1,x1,false,'active'),(eext,x1,true,'active');   -- P1 comum ; Pext externo ; P2 NÃO vinculado
  select id into v_term from public.media_consent_terms order by version_no limit 1;

  -- ══ POSITIVO: staff (P1) cria peça + versão 1 ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    r := public.media_piece_create(x1,'manual',null,'Marco 30 dias','{"numbers":[{"label":"Peso","value":"-4kg"}]}'::jsonb, true,false,false,false,true,'Depoimento', array[e1]);
  reset role;
  v_piece := (r->>'piece_id')::uuid; v1 := (r->>'version_id')::uuid;
  if v1 is null then fails:=fails||'create_v1 '; end if;
  if (r->>'version_no')::int <> 1 then fails:=fails||'create_vno '; end if;
  select count(*) into v_cnt from public.media_pieces where patient_id=x1; if v_cnt<>1 then fails:=fails||'piece_exists '; end if;

  -- ══ POSITIVO: paciente VÊ a própria peça (DECIDIR — ver ≠ usar) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_x1::text)::text, true); set local role authenticated;
    select count(*) into v_cnt from public.media_pieces where id=v_piece; if v_cnt<>1 then fails:=fails||'patient_sees_piece '; end if;
    select count(*) into v_cnt from public.media_piece_versions where id=v1; if v_cnt<>1 then fails:=fails||'patient_sees_version '; end if;
  reset role;

  -- ══ POSITIVO: paciente concede consentimento [instagram, site] (12 meses; autor do servidor) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_x1::text)::text, true); set local role authenticated;
    v_consent_app := public.media_consent_grant_app(v1, array['instagram','site'], v_term, 'campanha', false);
  reset role;
  select origin, granted_by_profile_id, expires_at into v_origin, v_by, v_exp from public.media_consents where id=v_consent_app;
  if v_origin<>'app' then fails:=fails||'grant_origin '; end if;
  if v_by<>prof_x1 then fails:=fails||'grant_author '; end if;
  if v_exp < now()+interval '11 months' or v_exp > now()+interval '13 months' then fails:=fails||'grant_expiry '; end if;

  -- ══ POSITIVO: função canônica autoriza uso em instagram ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if not (public.media_use_check(v1,'instagram')->>'usable')::boolean then fails:=fails||'use_instagram '; end if;
  reset role;

  -- ══ POSITIVO: registro PRESENCIAL pela clínica [impresso], campos obrigatórios, origem in_person ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    v_consent_ip := public.media_consent_record_in_person(v1, array['impresso'], v_term, 'assinatura fisica', now(), 'clA/x1/comprovacao.pdf', 'impresso', false);
  reset role;
  select origin, in_person_recorded_by_profile_id into v_origin, v_by from public.media_consents where id=v_consent_ip;
  if v_origin<>'in_person' then fails:=fails||'ip_origin '; end if;
  if v_by<>p1 then fails:=fails||'ip_recorder '; end if;

  -- ══ POSITIVO: paciente REVOGA sozinho; uso de instagram é NEGADO na hora (impresso segue) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_x1::text)::text, true); set local role authenticated;
    perform public.media_consent_revoke(v_consent_app, null);
  reset role;
  select status into v_status from public.media_consents where id=v_consent_app; if v_status<>'revoked' then fails:=fails||'revoke_status '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if (public.media_use_check(v1,'instagram')->>'usable')::boolean then fails:=fails||'revoke_still_usable '; end if;
    if (public.media_use_check(v1,'instagram')->>'reason')<>'revoked' then fails:=fails||'revoke_reason '; end if;
    if not (public.media_use_check(v1,'impresso')->>'usable')::boolean then fails:=fails||'impresso_usable '; end if;
  reset role;
  if private.media_version_channel_usable(v1,'instagram') then fails:=fails||'reuse_revoked_active '; end if;

  -- ══ NEGATIVO: usar SEM consentimento ativo ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    r := public.media_piece_create(x1,'manual',null,'Peça 2','{}'::jsonb);
  reset role;
  v_p2v1 := (r->>'version_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if (public.media_use_check(v_p2v1,'instagram')->>'usable')::boolean then fails:=fails||'NEG_no_consent_usable '; end if;
    if (public.media_use_check(v_p2v1,'instagram')->>'reason')<>'no_consent' then fails:=fails||'NEG_no_consent_reason '; end if;
  reset role;

  -- ══ NEGATIVO: usar em canal NÃO autorizado (v1 tem impresso ativo; whatsapp não) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if (public.media_use_check(v1,'whatsapp')->>'usable')::boolean then fails:=fails||'NEG_channel_usable '; end if;
    if (public.media_use_check(v1,'whatsapp')->>'reason')<>'channel_not_authorized' then fails:=fails||'NEG_channel_reason '; end if;
  reset role;

  -- ══ NEGATIVO: usar após EXPIRAÇÃO ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_x1::text)::text, true); set local role authenticated;
    v_consent_exp := public.media_consent_grant_app(v_p2v1, array['instagram'], v_term, null, false);
  reset role;
  update public.media_consents set expires_at = now() - interval '1 day' where id = v_consent_exp;  -- simula expiração (postgres)
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if (public.media_use_check(v_p2v1,'instagram')->>'usable')::boolean then fails:=fails||'NEG_expired_usable '; end if;
    if (public.media_use_check(v_p2v1,'instagram')->>'reason')<>'expired' then fails:=fails||'NEG_expired_reason '; end if;
  reset role;

  -- ══ NEGATIVO (CORAÇÃO): consentimento de UMA versão NÃO vale para OUTRA ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    r := public.media_piece_new_version(v_piece,'{"numbers":[{"label":"Peso","value":"-6kg"}]}'::jsonb, true,true,false,false,true,'Depoimento 2', array[e1]);
  reset role;
  v2 := (r->>'version_id')::uuid;
  if (r->>'version_no')::int <> 2 then fails:=fails||'newver_no '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    if (public.media_use_check(v2,'impresso')->>'usable')::boolean then fails:=fails||'NEG_version_isolation '; end if;
    if (public.media_use_check(v2,'impresso')->>'reason')<>'no_consent' then fails:=fails||'NEG_version_reason '; end if;
  reset role;

  -- ══ NEGATIVO: profissional concede no lugar do paciente (fluxo comum) ⟂ ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; perform public.media_consent_grant_app(v1, array['instagram'], v_term, null, false); reset role; fails:=fails||'NEG_prof_grants '; exception when others then reset role; end;

  -- ══ NEGATIVO: registro presencial SEM campos obrigatórios (RPC) ⟂ ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; perform public.media_consent_record_in_person(v1, array['site'], v_term, null, now(), null, null, false); reset role; fails:=fails||'NEG_ip_missing '; exception when others then reset role; end;
  -- CHECK direto: origin=in_person com method null ⟂
  begin insert into public.media_consents (piece_version_id,patient_id,granted_by_kind,origin,term_version_id,expires_at) values (v1,x1,'patient','in_person',v_term,now()+interval '12 months'); fails:=fails||'NEG_check_inperson '; exception when others then null; end;
  -- CHECK direto: origin=app com campo presencial preenchido ⟂
  begin insert into public.media_consents (piece_version_id,patient_id,granted_by_kind,origin,term_version_id,expires_at,in_person_method) values (v1,x1,'patient','app',v_term,now()+interval '12 months','x'); fails:=fails||'NEG_check_app '; exception when others then null; end;

  -- ══ NEGATIVO (D4): paciente MENOR e birth_date NULA ⟂ ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated;
    r := public.media_piece_create(xminor,'manual',null,'Peça menor','{}'::jsonb);
  reset role;
  v_minor_v := (r->>'version_id')::uuid;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_minor::text)::text, true); set local role authenticated; perform public.media_consent_grant_app(v_minor_v, array['instagram'], v_term, null, false); reset role; fails:=fails||'NEG_minor_grant '; exception when others then reset role; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated; perform public.media_consent_record_in_person(v_minor_v, array['impresso'], v_term, 'x', now(), 'p.pdf', null, false); reset role; fails:=fails||'NEG_minor_ip '; exception when others then reset role; end;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated;
    r := public.media_piece_create(xnull,'manual',null,'Peça sem data','{}'::jsonb);
  reset role;
  v_null_v := (r->>'version_id')::uuid;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_null::text)::text, true); set local role authenticated; perform public.media_consent_grant_app(v_null_v, array['instagram'], v_term, null, false); reset role; fails:=fails||'NEG_null_grant '; exception when others then reset role; end;

  -- ══ NEGATIVO: EXTERNO ⟂ tudo ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pext::text)::text, true); set local role authenticated; perform public.media_piece_create(x1,'manual',null,'x','{}'::jsonb); reset role; fails:=fails||'NEG_ext_create '; exception when others then reset role; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pext::text)::text, true); set local role authenticated; perform public.media_use_check(v1,'impresso'); reset role; fails:=fails||'NEG_ext_usecheck '; exception when others then reset role; end;
  perform set_config('request.jwt.claims', json_build_object('sub',au_pext::text)::text, true); set local role authenticated;
    select count(*) into v_cnt from public.media_pieces where patient_id=x1; if v_cnt<>0 then fails:=fails||'NEG_ext_select '; end if;
  reset role;

  -- ══ NEGATIVO: profissional NÃO-vinculado (P2) ⟂ ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated; perform public.media_piece_create(x1,'manual',null,'x','{}'::jsonb); reset role; fails:=fails||'NEG_p2_create '; exception when others then reset role; end;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated;
    select count(*) into v_cnt from public.media_pieces where patient_id=x1; if v_cnt<>0 then fails:=fails||'NEG_p2_select '; end if;
  reset role;

  -- ══ NEGATIVO: outra CLÍNICA (adminB) ⟂ ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_adminB::text)::text, true); set local role authenticated; perform public.media_piece_create(x1,'manual',null,'x','{}'::jsonb); reset role; fails:=fails||'NEG_clinicB_create '; exception when others then reset role; end;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminB::text)::text, true); set local role authenticated;
    select count(*) into v_cnt from public.media_pieces where patient_id=x1; if v_cnt<>0 then fails:=fails||'NEG_clinicB_select '; end if;
  reset role;

  -- ══ NEGATIVO: anon ⟂ ══
  begin reset role; set local role anon; select count(*) into v_cnt from public.media_pieces; if v_cnt<>0 then fails:=fails||'NEG_anon_select '; end if; reset role; exception when others then reset role; end;
  begin reset role; set local role anon; perform public.media_use_check(v1,'instagram'); reset role; fails:=fails||'NEG_anon_rpc '; exception when others then reset role; end;

  -- ══ NEGATIVO: alterar/apagar auditoria pelo client ⟂ ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; update public.media_consents set status='authorized' where id=v_consent_app; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_audit_update('||n||') '; end if; reset role; exception when others then reset role; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; delete from public.media_consents where id=v_consent_ip; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_audit_delete('||n||') '; end if; reset role; exception when others then reset role; end;

  -- ══ NEGATIVO: revogação por NÃO-dono (staff e outro paciente) ⟂ ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated; perform public.media_consent_revoke(v_consent_ip, null); reset role; fails:=fails||'NEG_staff_revoke '; exception when others then reset role; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_x2::text)::text, true); set local role authenticated; perform public.media_consent_revoke(v_consent_ip, null); reset role; fails:=fails||'NEG_other_patient_revoke '; exception when others then reset role; end;

  if length(fails)>0 then raise exception 'WP-ARTE A TESTS FAILED: %', fails;
  else raise notice 'WP-ARTE A: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
