-- =====================================================================================
-- WP-SEED · DADOS DE TESTE (clínicas, profissionais, pacientes, prescrições, registros, chat, jornada)
-- NÃO é migration — não entra no ledger, não é aplicado automaticamente. Rodar manualmente (MCP execute_sql
-- ou psql). IDEMPOTENTE (guarda por clínica-âncora), RASTREÁVEL (ids determinísticos + domínio de e-mail
-- dedicado) e REVERSÍVEL (ver wp_seed_test_data_remove.sql). NÃO altera schema, policies ou funções.
--
-- CAMINHOS REAIS: usa as RPCs existentes simulando cada ator via request.jwt.claims —
--   create_patient, assign_professional_discipline, save_workout_plan, save_nutrition_plan,
--   move_patient_journey, ack_journey_milestone. INSERÇÃO DIRETA só onde NÃO há RPC (reportado):
--   clinics (onboarding não mergeado), profiles/professionals dos profissionais e o bootstrap do admin,
--   disciplina do PRÓPRIO admin (assign_professional_discipline proíbe auto-atribuição), vínculos extras
--   (professional_patient_links além do que create_patient cria), auto-registros do paciente (weight_logs/
--   activity_events/meal_logs/workout_session_logs) e o chat (chat_channels/participants/messages).
--
-- RASTREABILIDADE (critério de remoção): ids determinísticos md5('vseed:'||label)::uuid para clínicas,
--   profiles e professionals; TUDO o mais é alcançável por FK a partir das 2 clínicas-âncora. Marca humana
--   secundária: e-mails no domínio SEED_EMAIL_DOMAIN.
--
-- ┌─ BLOCO DE CONFIGURAÇÃO — O DONO PREENCHE OS E-MAILS ─────────────────────────────────────────────┐
-- │ O LOGIN REAL (Google) só funciona se o e-mail do PERFIL for IDÊNTICO ao da conta Google usada.    │
-- │ Enquanto os placeholders abaixo não forem trocados pelos e-mails reais, OS DADOS EXISTEM mas       │
-- │ NINGUÉM consegue entrar (o handle_new_user liga por e-mail no 1º login Google). Troque os valores  │
-- │ 'PREENCHA_*' pelos e-mails reais de quem vai logar. Cada e-mail deve ser ÚNICO.                    │
-- │   ATORES (web): dona/admin da Alfa, os profissionais da Alfa, a profissional da Beta.             │
-- │   PACIENTES (app): opcional — só se você for demonstrar o login do paciente.                       │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────┘
do $seed$
declare
  -- ===== CONFIG (edite os e-mails) =====
  SEED_EMAIL_DOMAIN text := 'vertexa-seed.test';  -- domínio marcador (não precisa existir de verdade)
  email_admin_alfa  text := 'PREENCHA_dona_alfa@exemplo.com';   -- Dra. Alice (admin/dona, nutricionista)
  email_bruno       text := 'PREENCHA_bruno@exemplo.com';       -- Bruno (educador físico)
  email_carlos      text := 'PREENCHA_carlos@exemplo.com';      -- Dr. Carlos (médico + nutricionista)
  email_dani        text := 'PREENCHA_dani@exemplo.com';        -- Dani (sem disciplina)
  email_eva         text := 'PREENCHA_eva@exemplo.com';         -- Eva (externa, fisioterapeuta)
  email_admin_beta  text := 'PREENCHA_bia_beta@exemplo.com';    -- Bia (admin/dona da Beta, nutricionista)
  -- pacientes (opcional — só p/ login no app do paciente)
  email_p1 text := null; email_p2 text := null; email_p3 text := null; email_p4 text := null; email_p5 text := null;

  -- ===== ids determinísticos (rastreáveis) =====
  clA uuid := md5('vseed:clinic:alfa')::uuid;   clB uuid := md5('vseed:clinic:beta')::uuid;
  -- profiles dos profissionais
  pa uuid := md5('vseed:profile:alice')::uuid;  pb uuid := md5('vseed:profile:bruno')::uuid;
  pc uuid := md5('vseed:profile:carlos')::uuid; pd uuid := md5('vseed:profile:dani')::uuid;
  pe uuid := md5('vseed:profile:eva')::uuid;    pf uuid := md5('vseed:profile:bia')::uuid;
  -- professionals
  PRa uuid := md5('vseed:prof:alice')::uuid; PRb uuid := md5('vseed:prof:bruno')::uuid;
  PRc uuid := md5('vseed:prof:carlos')::uuid; PRd uuid := md5('vseed:prof:dani')::uuid;
  PRe uuid := md5('vseed:prof:eva')::uuid;   PRf uuid := md5('vseed:prof:bia')::uuid;
  -- auth_user_id temporário (só p/ simular o ator nas RPCs; NULIFICADO no fim p/ o login por e-mail)
  ua uuid := md5('vseed:auth:alice')::uuid; ub uuid := md5('vseed:auth:bruno')::uuid;
  uc uuid := md5('vseed:auth:carlos')::uuid; ud uuid := md5('vseed:auth:dani')::uuid;
  ue uuid := md5('vseed:auth:eva')::uuid;   uf uuid := md5('vseed:auth:bia')::uuid;

  -- pacientes (ids atribuídos pelas RPCs)
  x1 uuid; x2 uuid; x3 uuid; x4 uuid; x5 uuid;
  col_ini uuid; col_2 uuid; col_3 uuid;  -- colunas da jornada (Alfa) por posição
  v_plan uuid; m record; v_ch uuid; v_i int;
  seeded_at text := to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS');
begin
  -- ── IDEMPOTÊNCIA: se a clínica-âncora já existe, não faz nada ──
  if exists (select 1 from public.clinics where id = clA) then
    raise notice 'WP-SEED: já semeado (clinica Alfa % existe) — nada a fazer.', clA;
    return;
  end if;

  -- =====================================================================================
  -- 1) PROFISSIONAIS (profiles + professionals) — INSERÇÃO DIRETA (não há RPC; onboarding não mergeado).
  --    auth_user_id temporário p/ simular o ator; e-mail = config (ou domínio marcador se placeholder).
  -- =====================================================================================
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (pa, ua, 'admin',        'Dra. Alice Nogueira',  email_admin_alfa, 'active'),
    (pb, ub, 'professional', 'Bruno Martins',        email_bruno,      'active'),
    (pc, uc, 'professional', 'Dr. Carlos Esteves',   email_carlos,     'active'),
    (pd, ud, 'professional', 'Dani Prado',           email_dani,       'active'),
    (pe, ue, 'professional', 'Eva Ribeiro',          email_eva,        'active'),
    (pf, uf, 'admin',        'Bia Fontes',           email_admin_beta, 'active');

  -- clínicas (o trigger trg_seed_journey_columns semeia as colunas da jornada)
  insert into public.clinics (id, name, owner_profile_id) values
    (clA, 'Clínica Alfa', pa),
    (clB, 'Clínica Beta', pf);

  -- professionals (bootstrap dos admins direto; demais também direto — sem RPC p/ criar profile de prof).
  insert into public.professionals (id, profile_id, clinic_id, type, registry_number, specialty, clinic_role) values
    (PRa, pa, clA, 'nutritionist',     'CRN-1 10001', 'Nutrição clínica', 'admin'),
    (PRb, pb, clA, 'personal_trainer', 'CREF 20002',  'Treinamento de força', 'member'),
    (PRc, pc, clA, 'doctor',           'CRM 30003',   'Clínica médica',   'member'),
    (PRd, pd, clA, 'other',            null,          null,               'member'),
    (PRe, pe, clA, 'physiotherapist',  'CREFITO 40004','Fisioterapia',    'member'),
    (PRf, pf, clB, 'nutritionist',     'CRN-3 50005', 'Nutrição esportiva','admin');

  -- =====================================================================================
  -- 2) DISCIPLINAS — RPC assign_professional_discipline (admin atribui aos OUTROS). A disciplina do
  --    PRÓPRIO admin é INSERÇÃO DIRETA (a RPC proíbe auto-atribuição).
  -- =====================================================================================
  insert into public.professional_disciplines (professional_id, discipline, granted_by) values
    (PRa, 'nutricionista', pa),   -- Alice (admin da Alfa) — própria disciplina, direto
    (PRf, 'nutricionista', pf);   -- Bia (admin da Beta) — própria disciplina, direto

  perform set_config('request.jwt.claims', json_build_object('sub', ua::text)::text, true);
    perform public.assign_professional_discipline(PRb, 'educador_fisico');   -- Bruno
    perform public.assign_professional_discipline(PRc, 'medico');            -- Carlos (2 disciplinas)
    perform public.assign_professional_discipline(PRc, 'nutricionista');
    perform public.assign_professional_discipline(PRe, 'fisioterapeuta');    -- Eva (externa)
  perform set_config('request.jwt.claims', 'null', true);
  -- Dani: SEM disciplina (intencional).

  -- =====================================================================================
  -- 3) PACIENTES — RPC create_patient (ator = admin da clínica). Datas variadas p/ exercitar a jornada.
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', ua::text)::text, true);
    x1 := public.create_patient(clA, 'Ana Antiga',       email_p1, date '1988-03-15', 'feminino', 165, 'Emagrecimento e condicionamento', 82, 70, 'bioimpedancia', 82, 34, 'Sedentária; retorno após gestação.', (current_date - 100));
    x2 := public.create_patient(clA, 'Bruna Vinte8',     email_p2, date '1992-07-20', 'feminino', 170, 'Hipertrofia',                     68, 72, 'adipometro',   68, 26, 'Treina há 2 anos.',               (current_date - 28));
    x3 := public.create_patient(clA, 'Carla Recente',    email_p3, date '1995-11-02', 'feminino', 160, 'Reeducação alimentar',            75, 66, null,           null, null, null,                           (current_date - 3));
    -- P4: ANIVERSÁRIO nos próximos 7 dias (mesmo dia/mês de current_date+3), maior de idade.
    x4 := public.create_patient(clA, 'Diana Aniver',     email_p4, ((current_date + 3) - interval '34 years')::date, 'feminino', 168, 'Definição', 71, 64, 'bioimpedancia', 71, 29, 'Aniversário chegando.', (current_date - 45));
  perform set_config('request.jwt.claims', json_build_object('sub', uf::text)::text, true);
    x5 := public.create_patient(clB, 'Elisa Beta',       email_p5, date '1990-01-10', 'feminino', 172, 'Performance', 64, 62, null, null, null, null, (current_date - 20));
  perform set_config('request.jwt.claims', 'null', true);

  -- =====================================================================================
  -- 4) VÍNCULOS EXTRAS — INSERÇÃO DIRETA (não há RPC p/ vincular além do autor do create_patient).
  --    create_patient já vinculou Alice (Alfa) e Bia (Beta) a seus pacientes. Aqui: Bruno e Carlos a P1
  --    (para as prescrições), e Eva EXTERNA a P1. Dani fica SEM vínculo (E2: existe prof da Alfa não
  --    vinculado a um dado paciente).
  -- =====================================================================================
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (PRb, x1, false, 'active'),   -- Bruno (educador físico) ↔ Ana
    (PRc, x1, false, 'active'),   -- Carlos (nutri/médico) ↔ Ana
    (PRe, x1, true,  'active'),   -- Eva EXTERNA ↔ Ana
    (PRb, x2, false, 'active');   -- Bruno ↔ Bruna (para P2 ter treino/execuções)

  -- =====================================================================================
  -- 5) PRESCRIÇÕES — RPCs save_workout_plan / save_nutrition_plan (pelo prof com a disciplina, vinculado).
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', ub::text)::text, true);   -- Bruno (educador_fisico)
    perform public.save_workout_plan(x1, 'Treino ABC — Ana', 'Hipertrofia e gasto calórico',
      '[{"letter":"A","name":"Inferiores","primary_muscle_group":"quadriceps","estimated_minutes":55,
          "exercises":[{"name":"Agachamento livre","muscle_groups":["quadriceps","glutes"],"sets":4,"reps":10,"load_kg":40},
                       {"name":"Leg press","muscle_groups":["quadriceps"],"sets":3,"reps":12,"load_kg":120},
                       {"name":"Cadeira flexora","muscle_groups":["hamstrings"],"sets":3,"reps":12,"load_kg":35}]},
         {"letter":"B","name":"Superiores empurrar","primary_muscle_group":"chest","estimated_minutes":50,
          "exercises":[{"name":"Supino reto","muscle_groups":["chest","triceps"],"sets":4,"reps":10,"load_kg":30},
                       {"name":"Desenvolvimento","muscle_groups":["shoulders"],"sets":3,"reps":12,"load_kg":14}]},
         {"letter":"C","name":"Superiores puxar","primary_muscle_group":"lats","estimated_minutes":50,
          "exercises":[{"name":"Puxada frente","muscle_groups":["lats","biceps"],"sets":4,"reps":10,"load_kg":45},
                       {"name":"Remada baixa","muscle_groups":["lats"],"sets":3,"reps":12,"load_kg":40}]}]'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', uc::text)::text, true);   -- Carlos (nutricionista)
    perform public.save_nutrition_plan(x1, 'Plano alimentar — Ana',
      '[{"time":"07:30","name":"Café da manhã","items":["Ovos mexidos (3)","Pão integral","Mamão"],"calories":420},
         {"time":"12:30","name":"Almoço","items":["Frango grelhado","Arroz integral","Feijão","Salada"],"calories":650},
         {"time":"16:00","name":"Lanche","items":["Iogurte natural","Granola","Banana"],"calories":300},
         {"time":"20:00","name":"Jantar","items":["Peixe assado","Legumes","Batata-doce"],"calories":520}]'::jsonb);
  perform set_config('request.jwt.claims', 'null', true);

  -- =====================================================================================
  -- 6) REGISTROS DO PACIENTE — INSERÇÃO DIRETA (o app escreve direto; sem RPC). Peso (semanas),
  --    hidratação, refeições (referenciam as meals do plano) e execuções de treino → métricas derivadas.
  -- =====================================================================================
  -- Peso: Ana ao longo de ~14 semanas (queda gradual 82→74)
  insert into public.weight_logs (patient_id, weight_kg, measured_at, source)
  select x1, 82.0 - (g*0.6) + (random()*0.2), (now() - make_interval(weeks => (14-g))), 'app'
  from generate_series(0,13) g;
  insert into public.weight_logs (patient_id, weight_kg, measured_at, source) values
    (x2, 68.0, now() - interval '20 days', 'app'), (x2, 68.6, now() - interval '6 days', 'app');

  -- Hidratação (activity_events hydration_logged, payload.liters) — últimos 7 dias, Ana e Bruna
  insert into public.activity_events (patient_id, type, payload, created_at)
  select x1, 'hydration_logged', jsonb_build_object('liters', round((1.6 + random()*0.8)::numeric,2)), (now() - make_interval(days => d))
  from generate_series(0,6) d;
  insert into public.activity_events (patient_id, type, payload, created_at)
  select x2, 'hydration_logged', jsonb_build_object('liters', round((1.4 + random()*0.7)::numeric,2)), (now() - make_interval(days => d))
  from generate_series(0,6) d;

  -- Refeições marcadas (meal_logs referenciam as meals do plano da Ana) — últimos 5 dias
  for m in select id from public.meals where nutrition_plan_id = (select id from public.nutrition_plans where patient_id = x1) loop
    insert into public.meal_logs (patient_id, meal_id, consumed_on, consumed_at, source)
    select x1, m.id, (current_date - d), (now() - make_interval(days => d)), 'app' from generate_series(0,4) d;
  end loop;

  -- Execuções de treino (workout_session_logs) — Ana 8 sessões, Bruna 3
  insert into public.workout_session_logs (patient_id, workout_name, performed_on, started_at, completed_at, total_duration_min, source)
  select x1, (array['Treino A — Inferiores','Treino B — Superiores empurrar','Treino C — Superiores puxar'])[1 + (s % 3)],
         (current_date - (s*3)), (now() - make_interval(days => s*3)), (now() - make_interval(days => s*3) + interval '52 min'), 52, 'app'
  from generate_series(0,7) s;
  insert into public.workout_session_logs (patient_id, workout_name, performed_on, started_at, completed_at, total_duration_min, source)
  select x2, 'Treino A', (current_date - (s*4)), (now() - make_interval(days => s*4)), (now() - make_interval(days => s*4) + interval '48 min'), 48, 'app'
  from generate_series(0,2) s;

  -- =====================================================================================
  -- 7) CHAT — INSERÇÃO DIRETA (sem RPC). 1 canal por paciente (Alfa) + participantes + mensagens (2 sentidos).
  -- =====================================================================================
  for v_i in 1..4 loop
    declare
      xp uuid := (array[x1,x2,x3,x4])[v_i];
      xprof_profile uuid := (select profile_id from public.patients where id = xp);
    begin
      insert into public.chat_channels (id, patient_id) values (md5('vseed:chan:'||xp::text)::uuid, xp)
        on conflict (patient_id) do nothing;
      v_ch := (select id from public.chat_channels where patient_id = xp);
      insert into public.chat_participants (channel_id, profile_id, role) values
        (v_ch, xprof_profile, 'patient'),
        (v_ch, pa, 'admin')
      on conflict do nothing;
      -- Bruno participa dos canais de Ana e Bruna (vinculados)
      if xp in (x1, x2) then
        insert into public.chat_participants (channel_id, profile_id, role) values (v_ch, pb, 'professional') on conflict do nothing;
      end if;
      insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body, created_at) values
        (v_ch, pa, 'admin', 'Oi! Bem-vinda à clínica. Qualquer dúvida, é só chamar por aqui.', now() - interval '3 days'),
        (v_ch, xprof_profile, 'patient', 'Oi! Obrigada, comecei o plano essa semana.', now() - interval '2 days 20 hours'),
        (v_ch, pa, 'admin', 'Perfeito. Lembra de registrar o peso e a hidratação no app.', now() - interval '2 days'),
        (v_ch, xprof_profile, 'patient', 'Combinado 👍', now() - interval '1 day 22 hours');
    end;
  end loop;

  -- =====================================================================================
  -- 8) JORNADA — RPCs move_patient_journey / ack_journey_milestone (ator = admin Alice). Gera histórico.
  -- =====================================================================================
  select id into col_ini from public.journey_columns where clinic_id = clA and is_initial limit 1;
  select id into col_2 from public.journey_columns where clinic_id = clA and not is_initial order by position asc limit 1;
  select id into col_3 from public.journey_columns where clinic_id = clA and not is_initial order by position asc offset 1 limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', ua::text)::text, true);
    perform public.move_patient_journey(x1, col_2);   -- Ana: inicial → col2
    perform public.move_patient_journey(x1, col_3);   -- Ana: col2 → col3 (histórico com 2 moves)
    perform public.move_patient_journey(x2, col_2);   -- Bruna: inicial → col2
    -- marcos reconhecidos da Ana (início há ~100 dias ⇒ 30/60/90 ocorreram)
    perform public.ack_journey_milestone(x1, 'start');
    perform public.ack_journey_milestone(x1, 'day_30');
    perform public.ack_journey_milestone(x1, 'day_60');
    perform public.ack_journey_milestone(x1, 'day_90');
    perform public.ack_journey_milestone(x2, 'start');
  perform set_config('request.jwt.claims', 'null', true);

  -- =====================================================================================
  -- 9) FINALIZAÇÃO: NULIFICA o auth_user_id temporário dos profissionais ⇒ o login real (Google por
  --    e-mail via handle_new_user) liga o perfil na 1ª entrada. Sem isto, o login criaria perfil duplicado.
  -- =====================================================================================
  update public.profiles set auth_user_id = null where id in (pa, pb, pc, pd, pe, pf);

  raise notice 'WP-SEED: aplicado em %. Clinicas Alfa=% Beta=%. Pacientes Alfa=[%,%,%,%] Beta=[%].',
    seeded_at, clA, clB, x1, x2, x3, x4, x5;
end
$seed$;
