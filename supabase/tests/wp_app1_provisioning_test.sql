-- =====================================================================================
-- WP-APP-1 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK no fim).
-- Prova que as RPCs SECURITY DEFINER são caminho de escrita CONTROLADO (não bypass):
--   • create_patient: só ADMIN/OWNER da clínica-alvo cria (ACCESS-PARTNER-01A);
--     member/staff ⟂; role SEMPRE 'patient'; auth_user_id NUNCA setado;
--     vínculo inicial só se o admin criador tiver professional row; clínica alheia -> proibido.
--   • save_workout_plan / save_nutrition_plan: TRANSACIONAIS (DELETE+INSERT atômico — payload
--     que falha no meio deixa o plano antigo INTACTO); só quem pode prescrever escreve.
-- Ground truth lido com `reset role` (conexão de migração = BYPASSRLS) para inspecionar o
-- efeito real das RPCs sem o ruído da RLS. Um shot: tudo passa -> notice; algo falha -> raise.
-- =====================================================================================
begin;
do $$
declare
  fails text := '';
  v_role text; v_auth uuid; v_link_prof uuid; v_clinic uuid;
  v_new uuid; v_plan uuid; v_old_plan uuid;
  A     constant uuid := 'ca000000-0000-0000-0000-000000000001';  -- clínica A
  B     constant uuid := 'cb000000-0000-0000-0000-000000000001';  -- clínica B
  E1    constant uuid := 'e1000000-0000-0000-0000-000000000001';  -- professionals.id P1 (A)
  X     constant uuid := 'da000000-0000-0000-0000-000000000001';  -- paciente X (A), vinculado a P1
  WPX   constant uuid := '41000000-0000-0000-0000-000000000001';  -- plano de treino pré-existente de X
  NPX   constant uuid := '44000000-0000-0000-0000-000000000001';  -- plano alimentar pré-existente de X
  SUB_ADMINA constant text := '{"sub":"aa000000-0000-0000-0000-000000000001"}';
  SUB_P1     constant text := '{"sub":"a1000000-0000-0000-0000-000000000001"}';
  SUB_P2     constant text := '{"sub":"a2000000-0000-0000-0000-000000000001"}';
  SUB_EXT    constant text := '{"sub":"ae000000-0000-0000-0000-000000000001"}';
  SUB_X      constant text := '{"sub":"ac000000-0000-0000-0000-000000000001"}';
begin
  -- ---- Fixtures (identidades com auth_user_id p/ simular login) ----
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','AdminB','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fe000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001','professional','Ext','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active');
  insert into public.clinics (id, name, owner_profile_id) values
    (A,'A','fa000000-0000-0000-0000-000000000001'),
    (B,'B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    (E1,'f1000000-0000-0000-0000-000000000001',A,'nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',A,'physiotherapist','member'),
    ('ee000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-000000000001',B,'personal_trainer','member');
  insert into public.patients (id, profile_id, clinic_id) values
    (X,'fc000000-0000-0000-0000-000000000001',A);
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (E1,X,false,'active'),
    ('ee000000-0000-0000-0000-000000000001',X,true,'active');  -- externo COM vínculo (não prescreve)
  insert into public.workout_plans (id, patient_id, professional_id, title) values (WPX,X,E1,'Plano antigo');
  insert into public.nutrition_plans (id, patient_id, professional_id, title) values (NPX,X,E1,'Dieta antiga');

  -- =====================================================================================
  -- create_patient
  -- =====================================================================================
  execute 'set local role authenticated';

  -- (-) P1 (member de A) NÃO cria paciente — ACCESS-PARTNER-01A
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin
    perform public.create_patient(A,'Novo Paciente','novo@ex.com','1990-05-01','female',165,
                                 'hipertrofia',80,75,'manual',80,22,'primeira consulta');
    fails:=fails||'CP_P1_member_allowed ';
  exception when insufficient_privilege then null;
           when others then fails:=fails||'CP_P1_wrong_err '; end;

  -- (+) AdminA cria paciente em A, com anamnese; sem professional row → sem vínculo automático
  perform set_config('request.jwt.claims',SUB_ADMINA,true);
  begin
    select public.create_patient(A,'Novo Paciente','novo@ex.com','1990-05-01','female',165,
                                 'hipertrofia',80,75,'manual',80,22,'primeira consulta') into v_new;
  exception when others then fails:=fails||'CP_admin_anamnese_fail '; end;

  execute 'reset role';  -- ground truth (bypass RLS)
  if v_new is null then fails:=fails||'CP_new_null ';
  else
    select role, auth_user_id into v_role, v_auth
      from public.profiles where id=(select profile_id from public.patients where id=v_new);
    if v_role is distinct from 'patient' then fails:=fails||'CP_role_not_patient '; end if;   -- anti-escalação
    if v_auth is not null then fails:=fails||'CP_authuid_set '; end if;                        -- login liga depois
    select clinic_id into v_clinic from public.patients where id=v_new;
    if v_clinic is distinct from A then fails:=fails||'CP_wrong_clinic '; end if;
    if (select count(*) from public.professional_patient_links where patient_id=v_new)<>0
      then fails:=fails||'CP_admin_anamnese_spurious_link '; end if;
    if (select count(*) from public.body_assessments where patient_id=v_new)<>1 then fails:=fails||'CP_anamnese_missing '; end if;
  end if;

  -- (-) P1 tenta criar em clínica ALHEIA (B) -> proibido
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin perform public.create_patient(B,'Alheio'); fails:=fails||'CP_P1_alien_clinic '; exception when others then null; end;

  -- (-) paciente X tenta criar paciente -> proibido (não é staff)
  perform set_config('request.jwt.claims',SUB_X,true);
  begin perform public.create_patient(A,'PatCriou'); fails:=fails||'CP_patient_create '; exception when others then null; end;

  -- (+) AdminA (admin de A, sem professional row) cria em A -> ok, SEM vínculo automático
  perform set_config('request.jwt.claims',SUB_ADMINA,true);
  begin select public.create_patient(A,'AdminCriou') into v_new; exception when others then fails:=fails||'CP_admin_create_fail '; end;
  execute 'reset role';
  if v_new is not null and (select count(*) from public.professional_patient_links where patient_id=v_new)<>0
    then fails:=fails||'CP_admin_spurious_link '; end if;

  -- (-) validação: nome vazio -> erro
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin perform public.create_patient(A,'   '); fails:=fails||'CP_blank_name '; exception when others then null; end;

  -- =====================================================================================
  -- save_workout_plan (transacional)
  -- =====================================================================================
  -- (+) P1 vinculado SUBSTITUI o plano de X (2 treinos, 1 exercício cada)
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin
    select public.save_workout_plan(X,'Plano Novo','forca',
      '[{"letter":"A","name":"Peito","primary_muscle_group":"chest","estimated_minutes":50,
         "exercises":[{"name":"Supino","muscle_groups":["chest"],"sets":4,"reps":10,"load_kg":40}]},
        {"letter":"B","name":"Costas","primary_muscle_group":"back","estimated_minutes":45,
         "exercises":[{"name":"Remada","muscle_groups":["back"],"sets":4,"reps":10,"load_kg":50}]}]'::jsonb) into v_plan;
  exception when others then fails:=fails||'SWP_P1_fail '; end;
  execute 'reset role';
  if (select count(*) from public.workout_plans where patient_id=X)<>1 then fails:=fails||'SWP_not_replaced '; end if;
  if (select count(*) from public.workout_plans where id=WPX)<>0 then fails:=fails||'SWP_old_survived '; end if;
  if (select count(*) from public.workouts where workout_plan_id=v_plan)<>2 then fails:=fails||'SWP_workouts '; end if;
  if (select count(*) from public.workout_exercises we join public.workouts w on w.id=we.workout_id
        where w.workout_plan_id=v_plan)<>2 then fails:=fails||'SWP_exercises '; end if;

  -- ATOMICIDADE: payload que falha no meio (cast inválido) NÃO pode destruir o plano vigente
  select id into v_old_plan from public.workout_plans where patient_id=X limit 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin
    perform public.save_workout_plan(X,'Quebra',null,
      '[{"letter":"A","name":"x","estimated_minutes":"NAO_NUMERO","exercises":[]}]'::jsonb);
    fails:=fails||'SWP_atomic_should_raise ';
  exception when others then null; end;
  execute 'reset role';
  if (select count(*) from public.workout_plans where patient_id=X)<>1 then fails:=fails||'SWP_atomic_count '; end if;
  if not exists (select 1 from public.workout_plans where id=v_old_plan) then fails:=fails||'SWP_atomic_old_gone '; end if;

  -- (-) P2 não-vinculado, externo e paciente NÃO prescrevem
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',SUB_P2,true);
  begin perform public.save_workout_plan(X,'Hack',null,'[]'::jsonb); fails:=fails||'SWP_P2_forbidden '; exception when others then null; end;
  perform set_config('request.jwt.claims',SUB_EXT,true);
  begin perform public.save_workout_plan(X,'Hack',null,'[]'::jsonb); fails:=fails||'SWP_ext_forbidden '; exception when others then null; end;
  perform set_config('request.jwt.claims',SUB_X,true);
  begin perform public.save_workout_plan(X,'Hack',null,'[]'::jsonb); fails:=fails||'SWP_patient_forbidden '; exception when others then null; end;

  -- =====================================================================================
  -- save_nutrition_plan (transacional)
  -- =====================================================================================
  -- (+) P1 substitui o plano alimentar de X
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin
    select public.save_nutrition_plan(X,'Dieta Nova',
      '[{"time":"08:00","name":"Cafe","items":["ovos","aveia"],"calories":400},
        {"time":"12:00","name":"Almoco","items":["arroz","frango"],"calories":700}]'::jsonb) into v_plan;
  exception when others then fails:=fails||'SNP_P1_fail '; end;
  execute 'reset role';
  if (select count(*) from public.nutrition_plans where patient_id=X)<>1 then fails:=fails||'SNP_not_replaced '; end if;
  if (select count(*) from public.nutrition_plans where id=NPX)<>0 then fails:=fails||'SNP_old_survived '; end if;
  if (select count(*) from public.meals where nutrition_plan_id=v_plan)<>2 then fails:=fails||'SNP_meals '; end if;

  -- ATOMICIDADE: calorias inválidas -> plano vigente intacto
  select id into v_old_plan from public.nutrition_plans where patient_id=X limit 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',SUB_P1,true);
  begin
    perform public.save_nutrition_plan(X,'Quebra',
      '[{"time":"08:00","name":"x","items":[],"calories":"NAO_NUMERO"}]'::jsonb);
    fails:=fails||'SNP_atomic_should_raise ';
  exception when others then null; end;
  execute 'reset role';
  if not exists (select 1 from public.nutrition_plans where id=v_old_plan) then fails:=fails||'SNP_atomic_old_gone '; end if;

  -- (-) paciente NÃO prescreve dieta
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',SUB_X,true);
  begin perform public.save_nutrition_plan(X,'Hack','[]'::jsonb); fails:=fails||'SNP_patient_forbidden '; exception when others then null; end;

  -- =====================================================================================
  -- anon NÃO executa nenhuma RPC (EXECUTE revogado)
  -- =====================================================================================
  execute 'reset role'; execute 'set local role anon';
  begin perform public.create_patient(A,'x'); fails:=fails||'ANON_create '; exception when others then null; end;
  begin perform public.save_workout_plan(X,'x',null,'[]'::jsonb); fails:=fails||'ANON_swp '; exception when others then null; end;
  begin perform public.save_nutrition_plan(X,'x','[]'::jsonb); fails:=fails||'ANON_snp '; exception when others then null; end;

  if length(fails) > 0 then raise exception 'WP-APP-1 TESTS FAILED: %', fails;
  else raise notice 'WP-APP-1: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
