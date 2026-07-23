-- =====================================================================================
-- WP-SEED · DADOS DE TESTE (v2 — pelos CAMINHOS REAIS do produto)
--
-- ⚠️ NÃO É MIGRATION. Vive em supabase/seeds/ de propósito: não entra em supabase/migrations/,
--    não entra no ledger (supabase_migrations.schema_migrations nem public.schema_migration_log).
--    Rodar manualmente (psql / SQL Editor / MCP execute_sql).
--
-- O QUE FAZ: monta um ambiente de teste realista — 2 clínicas (Alfa e Beta), 6 profissionais,
-- 5 pacientes, disciplinas, vínculos, 1 plano de treino + 1 alimentar, registros do paciente,
-- chat e jornada — usando as RPCs REAIS do produto, simulando cada ator por request.jwt.claims
-- (o mesmo mecanismo dos testes Nível 1). Só usa INSERT direto onde NÃO existe RPC (lista abaixo).
--
-- RPCs usadas (caminho real): create_clinic_with_owner · promote_to_professional ·
--   assign_professional_discipline · create_patient (com p_start_date) · save_workout_plan ·
--   save_nutrition_plan · move_patient_journey
--
-- INSERT DIRETO (e o motivo — não existe RPC para nenhum destes; são escritas do app sob RLS
-- ou tabelas administrativas sem função de escrita exposta):
--   · public.profiles dos PROFISSIONAIS ....... nenhuma RPC cria profile de profissional (só o
--     trigger handle_new_user, no login, e create_patient, que cria profile de PACIENTE).
--   · professional_patient_links (extras) ..... create_patient só vincula o CHAMADOR; não há RPC
--     para vincular outro profissional nem para marcar is_external.
--   · weight_logs / activity_events / meal_logs / workout_session_logs / workout_set_logs ....
--     escritas do APP PACIENTE, feitas direto pelo client sob RLS; não há RPC.
--   · chat_channels / chat_participants / chat_messages ... não há RPC de chat (o client escreve
--     direto sob RLS).
--
-- NÃO SEMEADO (limitações registradas):
--   · ANEXOS de chat e FOTOS de progresso — exigem arquivo binário real no bucket; SQL não sobe
--     objeto no Storage (e storage.objects tem trigger protect_objects_delete).
--   · Peças/consentimentos de mídia (WP-ARTE) — fora do escopo por decisão do orquestrador.
--
-- IDENTIFICAÇÃO / RASTREABILIDADE (critério oficial, usado pelo script de remoção):
--   Os 6 profiles de PROFISSIONAL têm id DETERMINÍSTICO = md5('wp-seed:v2:'||<chave>)::uuid.
--   Tudo o mais é alcançável por FK a partir deles: as 2 clínicas são exatamente as que têm
--   owner_profile_id nesse conjunto; pacientes/planos/registros/chat/jornada descendem das clínicas.
--   ⇒ nada de "adivinhar por nome": a âncora é um conjunto fechado de 6 UUIDs calculáveis.
--
-- IDEMPOTENTE: se o profile-âncora já existir, o script não faz nada (RAISE NOTICE e sai).
-- REVERSÍVEL: supabase/seeds/wp_seed_test_data_remove.sql apaga exatamente o que este criou.
--
-- LOGIN DOS PROFISSIONAIS (ver docs/ops/SEED_TEST_DATA.md):
--   Os profiles ficam com auth_user_id = NULL e o e-mail configurado abaixo. Quando a pessoa entrar
--   com Google nesse MESMO e-mail, o trigger public.handle_new_user faz o match por e-mail (exige
--   auth_user_id IS NULL e EXATAMENTE 1 profile com aquele e-mail) e VINCULA o profile semeado — em
--   vez de criar um novo perfil pendente. Durante a execução o script usa um auth_user_id SINTÉTICO
--   só para poder chamar as RPCs como cada ator, e ZERA todos no passo 14.
-- =====================================================================================
do $seed$
declare
  -- ════════════════════════════════════════════════════════════════════════════════
  -- CONFIGURAÇÃO — O DONO PREENCHE OS E-MAILS ANTES DE RODAR
  --   Use e-mails Google REAIS de quem vai testar. Cada e-mail deve ser ÚNICO e não pode já
  --   existir em public.profiles. Rodando com os placeholders os dados existem, mas ninguém loga
  --   (corrigível depois: update public.profiles set email='...' where id='...').
  -- ════════════════════════════════════════════════════════════════════════════════
  c_email_alfa_owner  text := 'PREENCHA.alfa.admin@exemplo.com';      -- dona/ADMIN da Alfa (nutricionista)
  c_email_alfa_edu    text := 'PREENCHA.alfa.educador@exemplo.com';   -- educador físico
  c_email_alfa_med    text := 'PREENCHA.alfa.medico@exemplo.com';     -- médico + nutricionista
  c_email_alfa_nodisc text := 'PREENCHA.alfa.semdisc@exemplo.com';    -- SEM disciplina
  c_email_alfa_ext    text := 'PREENCHA.alfa.externo@exemplo.com';    -- externo (1 paciente só)
  c_email_beta_owner  text := 'PREENCHA.beta.prof@exemplo.com';       -- profissional da Beta
  c_clinica_alfa      text := 'Clínica Alfa';
  c_clinica_beta      text := 'Clínica Beta';
  -- ════════════════════════════════════════════════════════════════════════════════

  ns constant text := 'wp-seed:v2:';
  p_owner uuid := md5(ns||'prof:alfa:owner')::uuid;
  p_edu   uuid := md5(ns||'prof:alfa:edu')::uuid;
  p_med   uuid := md5(ns||'prof:alfa:med')::uuid;
  p_nod   uuid := md5(ns||'prof:alfa:nodisc')::uuid;
  p_ext   uuid := md5(ns||'prof:alfa:ext')::uuid;
  p_beta  uuid := md5(ns||'prof:beta:owner')::uuid;
  -- auth_user_id SINTÉTICOS (temporários; zerados no passo 14)
  a_owner uuid := md5(ns||'auth:alfa:owner')::uuid;
  a_edu   uuid := md5(ns||'auth:alfa:edu')::uuid;
  a_med   uuid := md5(ns||'auth:alfa:med')::uuid;
  a_nod   uuid := md5(ns||'auth:alfa:nodisc')::uuid;
  a_ext   uuid := md5(ns||'auth:alfa:ext')::uuid;
  a_beta  uuid := md5(ns||'auth:beta:owner')::uuid;

  r jsonb;
  cl_alfa uuid; cl_beta uuid;
  pr_owner uuid; pr_edu uuid; pr_med uuid; pr_nod uuid; pr_ext uuid; pr_beta uuid;
  pa1 uuid; pa2 uuid; pa3 uuid; pa4 uuid; pb1 uuid;
  plano_nut uuid; plano_wrk uuid;
  v_workout uuid; v_sess uuid; v_pat uuid; v_patient_profile uuid;
  v_col_2 uuid; v_col_3 uuid; ch uuid; d int;
begin
  -- ═══ IDEMPOTÊNCIA ═══
  if exists (select 1 from public.profiles where id = p_owner) then
    raise notice 'WP-SEED: ja aplicado (profile ancora % existe) - nada a fazer.', p_owner;
    return;
  end if;

  -- ═══ 1) PROFILES DOS PROFISSIONAIS (INSERT DIRETO — não há RPC) ═══
  --   status='pending' é o estado real de quem ainda não foi destravado: create_clinic_with_owner
  --   destrava os donos e promote_to_professional EXIGE que o alvo esteja 'pending'.
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (p_owner, a_owner, 'patient', 'Ana Prado',      c_email_alfa_owner , 'pending'),
    (p_edu  , a_edu  , 'patient', 'Bruno Salles',   c_email_alfa_edu   , 'pending'),
    (p_med  , a_med  , 'patient', 'Clara Vieira',   c_email_alfa_med   , 'pending'),
    (p_nod  , a_nod  , 'patient', 'Diego Martins',  c_email_alfa_nodisc, 'pending'),
    (p_ext  , a_ext  , 'patient', 'Elisa Rocha',    c_email_alfa_ext   , 'pending'),
    (p_beta , a_beta , 'patient', 'Felipe Antunes', c_email_beta_owner , 'pending');

  -- ═══ 2) CLÍNICA ALFA pela RPC real (a dona cria a PRÓPRIA clínica) ═══
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner::text)::text, true);
  set local role authenticated;
    r := public.create_clinic_with_owner(c_clinica_alfa);
  reset role;
  cl_alfa := (r->>'clinic_id')::uuid; pr_owner := (r->>'professional_id')::uuid;

  -- ═══ 3-5,7) EQUIPE, DISCIPLINAS E PACIENTES DA ALFA (tudo pela dona/admin) ═══
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner::text)::text, true);
  set local role authenticated;
    -- 3) a DONA se atribui 'nutricionista' (WP-DISC-FIX: admin pode a si mesmo)
    perform public.assign_professional_discipline(pr_owner, 'nutricionista');

    -- 4) equipe pela RPC real (só o admin promove)
    pr_edu := public.promote_to_professional(p_edu, cl_alfa, 'personal_trainer', 'member');
    pr_med := public.promote_to_professional(p_med, cl_alfa, 'doctor'          , 'member');
    pr_nod := public.promote_to_professional(p_nod, cl_alfa, 'other'           , 'member');
    pr_ext := public.promote_to_professional(p_ext, cl_alfa, 'nutritionist'    , 'member');

    -- 5) disciplinas (o 'nodisc' fica de propósito SEM nenhuma)
    perform public.assign_professional_discipline(pr_edu, 'educador_fisico');
    perform public.assign_professional_discipline(pr_med, 'medico');
    perform public.assign_professional_discipline(pr_med, 'nutricionista');
    perform public.assign_professional_discipline(pr_ext, 'nutricionista');

    -- 7) pacientes da Alfa (datas variadas; todos MAIORES de idade, birth_date preenchida)
    -- P1: começou há ~100 dias ⇒ marcos de 30/60/90 JÁ ocorreram
    pa1 := public.create_patient(cl_alfa, 'Mariana Lopes', 'paciente1.seed@exemplo.com',
             date '1991-04-12', 'F', 165, 'Emagrecimento', 78.4, 68.0,
             'skinfold', 78.4, 31.2, 'Anamnese inicial do seed.', current_date - 100);
    -- P2: começou há ~28 dias ⇒ marco de 30 dias DENTRO da janela de 7 dias
    pa2 := public.create_patient(cl_alfa, 'Rafael Nunes', 'paciente2.seed@exemplo.com',
             date '1988-09-30', 'M', 178, 'Hipertrofia', 82.0, 88.0,
             'bioimpedance', 82.0, 18.5, null, current_date - 28);
    -- P3: recente
    pa3 := public.create_patient(cl_alfa, 'Juliana Costa', 'paciente3.seed@exemplo.com',
             date '1995-01-22', 'F', 170, 'Condicionamento', 64.0, 62.0,
             null, null, null, null, current_date - 3);
    -- P4: ANIVERSÁRIO nos próximos 7 dias (dia/mês de hoje+3; ano bissexto p/ tolerar 29/02)
    pa4 := public.create_patient(cl_alfa, 'Sofia Andrade', 'paciente4.seed@exemplo.com',
             make_date(1988, extract(month from current_date + 3)::int, extract(day from current_date + 3)::int),
             'F', 160, 'Saúde geral', 70.0, 66.0, null, null, null, null, current_date - 45);
  reset role;

  -- ═══ 6,8) CLÍNICA BETA (existe só para PROVAR ISOLAMENTO) + seu paciente ═══
  perform set_config('request.jwt.claims', json_build_object('sub', a_beta::text)::text, true);
  set local role authenticated;
    r := public.create_clinic_with_owner(c_clinica_beta);
    cl_beta := (r->>'clinic_id')::uuid; pr_beta := (r->>'professional_id')::uuid;
    perform public.assign_professional_discipline(pr_beta, 'educador_fisico');
    pb1 := public.create_patient(cl_beta, 'Otávio Mendes', 'paciente5.seed@exemplo.com',
             date '1990-06-05', 'M', 175, 'Hipertrofia', 80.0, 85.0, null, null, null, null, current_date - 60);
  reset role;

  -- ═══ 9) VÍNCULOS EXTRAS (INSERT DIRETO — create_patient só vincula o CHAMADOR) ═══
  --   Desenho proposital para o teste de isolamento:
  --     owner  → vinculada aos 4 pacientes da Alfa (criou todos)
  --     edu    → SÓ ao P1 (precisa do vínculo para prescrever treino)
  --     med    → SÓ ao P2
  --     nodisc → NÃO vinculado a NENHUM paciente  ⇐ o profissional "de fora" exigido pelo teste
  --     ext    → SÓ ao P4, com is_external = true
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (pr_edu, pa1, false, 'active'),
    (pr_med, pa2, false, 'active'),
    (pr_ext, pa4, true , 'active');

  -- ═══ 10) PLANOS pela RPC real, cada um pelo profissional com a DISCIPLINA CORRETA ═══
  -- TREINO: pelo EDUCADOR FÍSICO (disciplina educador_fisico), vinculado ao P1 no passo 9
  perform set_config('request.jwt.claims', json_build_object('sub', a_edu::text)::text, true);
  set local role authenticated;
    plano_wrk := public.save_workout_plan(pa1, 'Treino ABC — Emagrecimento', 'Emagrecimento',
      '[{"letter":"A","name":"Inferiores","primary_muscle_group":"pernas","estimated_minutes":55,
         "exercises":[{"name":"Agachamento livre","muscle_groups":["quadriceps","gluteos"],"sets":4,"reps":10,"load_kg":40},
                      {"name":"Leg press 45","muscle_groups":["quadriceps"],"sets":3,"reps":12,"load_kg":120},
                      {"name":"Cadeira flexora","muscle_groups":["posteriores"],"sets":3,"reps":12,"load_kg":35}]},
        {"letter":"B","name":"Superiores empurrar","primary_muscle_group":"peito","estimated_minutes":50,
         "exercises":[{"name":"Supino reto","muscle_groups":["peito","triceps"],"sets":4,"reps":10,"load_kg":30},
                      {"name":"Desenvolvimento halteres","muscle_groups":["ombros"],"sets":3,"reps":12,"load_kg":12}]},
        {"letter":"C","name":"Superiores puxar","primary_muscle_group":"costas","estimated_minutes":50,
         "exercises":[{"name":"Puxada frente","muscle_groups":["costas","biceps"],"sets":4,"reps":10,"load_kg":45},
                      {"name":"Remada baixa","muscle_groups":["costas"],"sets":3,"reps":12,"load_kg":40}]}]'::jsonb);
  reset role;

  -- ALIMENTAR: pela DONA (nutricionista + admin)
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner::text)::text, true);
  set local role authenticated;
    plano_nut := public.save_nutrition_plan(pa1, 'Plano Alimentar — Déficit moderado',
      '[{"time":"07:30","name":"Café da manhã","items":["2 ovos mexidos","1 fatia de pão integral","Café sem açúcar"],"calories":320},
        {"time":"10:00","name":"Lanche da manhã","items":["1 iogurte natural","1 banana"],"calories":180},
        {"time":"12:30","name":"Almoço","items":["150g de frango grelhado","4 col. arroz integral","Feijão","Salada"],"calories":560},
        {"time":"16:00","name":"Lanche da tarde","items":["1 scoop whey","1 maçã"],"calories":220},
        {"time":"19:30","name":"Jantar","items":["150g de tilápia","Legumes no vapor","1 col. azeite"],"calories":430}]'::jsonb);
  reset role;

  -- ═══ 11) REGISTROS DO PACIENTE (INSERT DIRETO — escritas do app, sem RPC) ═══
  -- peso: 15 semanas de evolução do P1 (série para gráfico e métricas derivadas)
  insert into public.weight_logs (patient_id, weight_kg, measured_at, source)
  select pa1, round((78.4 - (i * 0.42))::numeric, 1), (now() - (i || ' weeks')::interval), 'seed'
  from generate_series(14, 0, -1) i;
  insert into public.weight_logs (patient_id, weight_kg, measured_at, source) values
    (pa2, 82.0, now() - interval '25 days', 'seed'), (pa2, 83.1, now() - interval '10 days', 'seed'),
    (pb1, 80.0, now() - interval '20 days', 'seed');

  -- hidratação: activity_events(type='hydration_logged', payload.liters) — 21 dias do P1
  insert into public.activity_events (patient_id, type, payload, created_at)
  select pa1, 'hydration_logged', jsonb_build_object('liters', round((1.4 + (i % 5) * 0.3)::numeric, 1)),
         (now() - (i || ' days')::interval)
  from generate_series(20, 0, -1) i;

  -- refeições registradas: 14 dias do P1 sobre as 3 primeiras refeições do plano criado acima
  insert into public.meal_logs (patient_id, meal_id, consumed_on, consumed_at, source)
  select pa1, m.id, (current_date - i), (now() - (i || ' days')::interval), 'seed'
  from generate_series(13, 0, -1) i
  cross join lateral (select id from public.meals where nutrition_plan_id = plano_nut order by order_index limit 3) m;

  -- execuções de treino: 12 sessões do P1 sobre os treinos do plano, com séries
  for d in 0..11 loop
    select w.id into v_workout from public.workouts w
     where w.workout_plan_id = plano_wrk order by w.day_index offset (d % 3) limit 1;
    insert into public.workout_session_logs (patient_id, workout_id, workout_name, performed_on,
           started_at, completed_at, total_duration_min, source)
    select pa1, v_workout, w.name, (current_date - (d*2)),
           (now() - ((d*2) || ' days')::interval),
           (now() - ((d*2) || ' days')::interval + interval '52 min'), 52, 'seed'
      from public.workouts w where w.id = v_workout
    returning id into v_sess;
    insert into public.workout_set_logs (session_log_id, workout_exercise_id, exercise_name,
           set_index, weight_kg, reps_done, rpe, rest_seconds)
    select v_sess, e.id, e.name, s.i, coalesce(e.load_kg, 20), coalesce(e.reps, 10), 8.0, 60
      from public.workout_exercises e
      cross join lateral generate_series(1, coalesce(e.sets, 3)) s(i)
     where e.workout_id = v_workout;
  end loop;

  -- ═══ 12) CHAT (INSERT DIRETO — não há RPC de chat) ═══
  --   1 conversa por paciente, mensagens NOS DOIS SENTIDOS. SEM ANEXO (exigiria arquivo real no
  --   bucket — limitação registrada no cabeçalho).
  foreach v_pat in array array[pa1, pa2, pa3, pa4, pb1] loop
    insert into public.chat_channels (patient_id) values (v_pat) returning id into ch;
    select profile_id into v_patient_profile from public.patients where id = v_pat;
    insert into public.chat_participants (channel_id, profile_id, role) values
      (ch, v_patient_profile, 'patient'),
      (ch, case when v_pat = pb1 then p_beta else p_owner end, 'professional');
    insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body, created_at) values
      (ch, case when v_pat = pb1 then p_beta else p_owner end, 'professional',
       'Oi! Seu plano ja esta publicado aqui no app. Qualquer duvida me chama por aqui.', now() - interval '3 days'),
      (ch, v_patient_profile, 'patient',
       'Obrigada! Comecei hoje, achei puxado mas deu pra fazer.', now() - interval '2 days 20 hours'),
      (ch, case when v_pat = pb1 then p_beta else p_owner end, 'professional',
       'E normal na primeira semana. Mantem a hidratacao e me conta como foi o segundo dia.', now() - interval '2 days 18 hours'),
      (ch, v_patient_profile, 'patient',
       'Combinado. Registrei o peso de hoje tambem.', now() - interval '1 day');
  end loop;

  -- ═══ 13) JORNADA pela RPC real (gera histórico em patient_journey_moves) ═══
  select id into v_col_2 from public.journey_columns where clinic_id = cl_alfa and not is_initial order by position limit 1;
  select id into v_col_3 from public.journey_columns where clinic_id = cl_alfa and not is_initial order by position offset 1 limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner::text)::text, true);
  set local role authenticated;
    if v_col_2 is not null then
      perform public.move_patient_journey(pa1, v_col_2);
      perform public.move_patient_journey(pa2, v_col_2);
      if v_col_3 is not null then perform public.move_patient_journey(pa1, v_col_3); end if;  -- 2º movimento = histórico
    end if;
  reset role;

  -- ═══ 14) ZERAR os auth_user_id sintéticos ═══
  --   A partir daqui os 6 profiles ficam com auth_user_id NULL. Quando a pessoa entrar com Google
  --   no MESMO e-mail, handle_new_user faz o match por e-mail e VINCULA este profile (comprovado).
  update public.profiles set auth_user_id = null
   where id in (p_owner, p_edu, p_med, p_nod, p_ext, p_beta);

  raise notice 'WP-SEED OK: alfa=% beta=% pacientes=[%,%,%,%,%]', cl_alfa, cl_beta, pa1, pa2, pa3, pa4, pb1;
end
$seed$;
