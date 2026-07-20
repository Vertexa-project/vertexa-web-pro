-- =====================================================================================
-- WP-REPORT · A — TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20260728090000 aplicada. Fixtures como postgres (bypassrls); nada persiste.
--
-- DESTAQUES: não-vinculado ⟂ (42501) e NENHUMA linha gravada; externo/paciente/outra-clínica/anon ⟂;
-- seção desconhecida ⟂ (A2); período inválido ⟂; truncamento marca truncated + record_count real;
-- trilha IMUTÁVEL (UPDATE/DELETE de cliente ⟂); leitura da trilha só admin/autor.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; n int; v jsonb; cnt int;
  adminA uuid:=gen_random_uuid(); au_adminA uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  p2 uuid:=gen_random_uuid(); au_p2 uuid:=gen_random_uuid();
  p3 uuid:=gen_random_uuid(); au_p3 uuid:=gen_random_uuid();
  adminB uuid:=gen_random_uuid(); au_adminB uuid:=gen_random_uuid();
  pext uuid:=gen_random_uuid(); au_pext uuid:=gen_random_uuid();
  pxProf uuid:=gen_random_uuid(); au_px uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); e3 uuid:=gen_random_uuid(); eext uuid:=gen_random_uuid();
  daX uuid:=gen_random_uuid();
  d_from date := current_date - 30; d_to date := current_date;
begin
  -- ── fixtures ──
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (adminA,au_adminA,'admin','Admin A','active'),(p1,au_p1,'professional','P1','active'),
    (p2,au_p2,'professional','P2','active'),(p3,au_p3,'professional','P3','active'),
    (adminB,au_adminB,'admin','Admin B','active'),(pext,au_pext,'professional','P Ext','active'),
    (pxProf,au_px,'patient','Paciente X','active');
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adminA),(clB,'B',adminB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,p1,clA,'nutritionist','member'),(e2,p2,clA,'physiotherapist','member'),
    (e3,p3,clB,'doctor','member'),(eext,pext,clB,'personal_trainer','member');
  insert into public.patients (id,profile_id,clinic_id) values (daX,pxProf,clA);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values
    (e1,daX,false,'active'),   -- P1 vinculado (comum)
    (eext,daX,true,'active');  -- externo
  -- dados de X no período: 3 pesos, 2 avaliações
  insert into public.weight_logs (patient_id,weight_kg,measured_at,source) values
    (daX,80,now()-interval '20 day','app'),(daX,79,now()-interval '10 day','app'),(daX,78,now()-interval '2 day','app');
  insert into public.body_assessments (patient_id,assessed_at,method,weight,body_fat_pct) values
    (daX,current_date-25,'bioimpedancia',80,25),(daX,current_date-5,'bioimpedancia',78,23);

  -- ══ POSITIVO 1: P1 (vinculado) exporta X ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
    select public.export_patient_report(daX, d_from, d_to, array['identity','weight','anthropometry'], 'web') into v;
  reset role;
  if (v->'patient'->>'full_name') is distinct from 'Paciente X' then fails:=fails||'P1_no_patient '; end if;
  if (v->'meta'->>'record_count')::int <> 6 then fails:=fails||'P1_count(got '||(v->'meta'->>'record_count')||') '; end if;   -- 1 identity + 3 weight + 2 anthro
  if (v->'meta'->>'truncated')::bool <> false then fails:=fails||'P1_trunc '; end if;
  if jsonb_array_length(v->'sections'->'weight') <> 3 then fails:=fails||'P1_weight_len '; end if;
  -- trilha: 1 linha correta
  select count(*) into cnt from public.report_exports
    where exported_by_profile_id=p1 and patient_id=daX and clinic_id=clA and record_count=6
      and period_from=d_from and period_to=d_to and sections @> array['identity','weight','anthropometry'];
  if cnt<>1 then fails:=fails||'P1_audit_row(got '||cnt||') '; end if;

  -- ══ POSITIVO 2: admin da clínica exporta ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true);
  set local role authenticated;
    perform public.export_patient_report(daX, d_from, d_to, array['identity','weight'], 'web');
  reset role;
  select count(*) into cnt from public.report_exports where patient_id=daX;
  if cnt<>2 then fails:=fails||'admin_audit(got '||cnt||') '; end if;

  -- ══ NEGATIVOS: cada um ⟂ + trilha inalterada (fica em 2) ══
  -- P2 não-vinculado
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, d_from, d_to, array['identity'], 'web'); reset role; fails:=fails||'NEG_P2_notraised ';
  exception when others then reset role; end;
  -- P3 outra clínica
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p3::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, d_from, d_to, array['identity'], 'web'); reset role; fails:=fails||'NEG_P3_notraised ';
  exception when others then reset role; end;
  -- externo
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pext::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, d_from, d_to, array['identity'], 'web'); reset role; fails:=fails||'NEG_ext_notraised ';
  exception when others then reset role; end;
  -- paciente (self)
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_px::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, d_from, d_to, array['identity'], 'web'); reset role; fails:=fails||'NEG_self_notraised ';
  exception when others then reset role; end;
  -- anon (sem EXECUTE)
  begin reset role; set local role anon;
    perform public.export_patient_report(daX, d_from, d_to, array['identity'], 'web'); reset role; fails:=fails||'NEG_anon_notraised ';
  exception when others then reset role; end;
  -- A2: seção desconhecida
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, d_from, d_to, array['identity','bogus'], 'web'); reset role; fails:=fails||'NEG_unknown_section ';
  exception when others then reset role; end;
  -- período invertido
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, d_to, d_from, array['identity'], 'web'); reset role; fails:=fails||'NEG_inverted_period ';
  exception when others then reset role; end;
  -- janela > 366 dias
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    perform public.export_patient_report(daX, current_date-400, current_date, array['identity'], 'web'); reset role; fails:=fails||'NEG_window_366 ';
  exception when others then reset role; end;
  -- trilha permanece em 2 (nenhuma negação gravou)
  select count(*) into cnt from public.report_exports where patient_id=daX;
  if cnt<>2 then fails:=fails||'NEG_audit_leaked(got '||cnt||') '; end if;

  -- ══ TRUNCAMENTO: 501 activity_events ⇒ truncated + 500 + aviso (A4) ══
  insert into public.activity_events (patient_id, type, payload, created_at)
    select daX, 'hydration_logged', '{}'::jsonb, now()-(g||' minutes')::interval from generate_series(1,501) g;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    select public.export_patient_report(daX, d_from, d_to, array['timeline'], 'web') into v;
  reset role;
  if (v->'meta'->>'truncated')::bool <> true then fails:=fails||'TRUNC_flag '; end if;
  if jsonb_array_length(v->'sections'->'timeline') <> 500 then fails:=fails||'TRUNC_len(got '||jsonb_array_length(v->'sections'->'timeline')||') '; end if;
  if (v->'meta'->>'record_count')::int <> 500 then fails:=fails||'TRUNC_count '; end if;

  -- ══ TRILHA IMUTÁVEL: UPDATE/DELETE de cliente ⟂ (0 linhas) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;
    begin update public.report_exports set record_count=0 where patient_id=daX; get diagnostics n=row_count; if n>0 then fails:=fails||'MUT_update('||n||') '; end if; exception when others then null; end;
    begin delete from public.report_exports where patient_id=daX; get diagnostics n=row_count; if n>0 then fails:=fails||'MUT_delete('||n||') '; end if; exception when others then null; end;
  reset role;

  -- ══ LEITURA DA TRILHA: admin/autor SIM; outros/anon NÃO ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true); set local role authenticated;   -- autor
    if (select count(*) from public.report_exports where patient_id=daX) < 1 then fails:=fails||'READ_author_zero '; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true); set local role authenticated; -- admin da clínica
    if (select count(*) from public.report_exports where patient_id=daX) < 1 then fails:=fails||'READ_admin_zero '; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true); set local role authenticated;   -- nem admin nem autor
    if (select count(*) from public.report_exports where patient_id=daX) <> 0 then fails:=fails||'READ_p2_leak '; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminB::text)::text, true); set local role authenticated; -- admin de OUTRA clínica
    if (select count(*) from public.report_exports where patient_id=daX) <> 0 then fails:=fails||'READ_adminB_leak '; end if;
  reset role;
  begin reset role; set local role anon;
    if (select count(*) from public.report_exports) <> 0 then fails:=fails||'READ_anon_leak '; end if; reset role;
  exception when others then reset role; end;

  if length(fails)>0 then raise exception 'WP-REPORT A TESTS FAILED: %', fails;
  else raise notice 'WP-REPORT A: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
