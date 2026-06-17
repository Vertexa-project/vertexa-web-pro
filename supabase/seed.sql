-- VERTEXA — Seed do happy path (3 pacientes: saudável, em risco, recuperando)
-- Rodar DEPOIS do SCHEMA.sql. Os mesmos dados servem Web Pro e App Paciente.

-- Clínica + admin/profissional (Dra. Juliana como profissional dona)
insert into profiles (id, role, full_name, email) values
  ('00000000-0000-0000-0000-0000000000a1','admin','Dra. Juliana Santiago','juliana@clinicavertice.com'),
  ('00000000-0000-0000-0000-0000000000a2','professional','Dra. Camila Rocha','camila@clinicavertice.com');

insert into clinics (id, name, owner_profile_id) values
  ('00000000-0000-0000-0000-0000000000c1','Clínica Vértice','00000000-0000-0000-0000-0000000000a1');

insert into professionals (id, profile_id, clinic_id, type, registry_number, specialty) values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','doctor','CRM 12345','Medicina do esporte'),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1','nutritionist','CRN 67890','Nutrição esportiva');

-- 3 pacientes
insert into profiles (id, role, full_name, email) values
  ('00000000-0000-0000-0000-0000000000b1','patient','Mariana Albuquerque','mariana@email.com'),
  ('00000000-0000-0000-0000-0000000000b2','patient','Ricardo Souza','ricardo@email.com'),
  ('00000000-0000-0000-0000-0000000000b3','patient','Beatriz Lima','beatriz@email.com');

insert into patients (id, profile_id, clinic_id, goal, start_weight, current_weight, target_weight, height_cm, sex) values
  -- Mariana: saudável / alta adesão
  ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','Emagrecimento saudável',74.2,68.4,62,165,'F'),
  -- Ricardo: em risco (sumiu)
  ('10000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1','Hipertrofia',82,81.5,90,178,'M'),
  -- Beatriz: recuperando
  ('10000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1','Recomposição corporal',70,67,60,170,'F');

-- vínculos (Mariana e Beatriz com a nutri Camila; Mariana também com a médica Juliana)
insert into professional_patient_links (professional_id, patient_id) values
  ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000e2','10000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000e2','10000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000b2');

-- VRI snapshots (espelham os níveis do adherenceEngine.ts)
insert into adherence_snapshots (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors) values
  ('10000000-0000-0000-0000-0000000000b1',88,'alta','em_acompanhamento',18,80,'{}','{"Sequência de 18 dias","Treinos consistentes","Peso atualizado"}'),
  ('10000000-0000-0000-0000-0000000000b2',18,'risco','em_risco',0,20,'{"9 dias sem interação","Nenhum hábito registrado hoje","Peso não registrado recentemente"}','{}'),
  ('10000000-0000-0000-0000-0000000000b3',62,'moderada','atencao',6,60,'{"Foto mensal pendente"}','{"Hábitos em dia"}');

-- Plano de treino da Mariana (espelha o workoutData.ts do app)
insert into workout_plans (id, patient_id, professional_id, title, goal) values
  ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','Treino de emagrecimento','Déficit + preservação de massa');

insert into workouts (id, workout_plan_id, letter, name, primary_muscle_group, day_index, estimated_minutes) values
  ('21000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000b1','A','Costas e Bíceps','Costas',1,55),
  ('21000000-0000-0000-0000-0000000000b2','20000000-0000-0000-0000-0000000000b1','B','Inferior','Pernas',3,50);

insert into workout_exercises (workout_id, name, muscle_groups, sets, reps, load_kg, rest_seconds, order_index) values
  ('21000000-0000-0000-0000-0000000000b1','Puxada frontal','{"Dorsais","Bíceps"}',4,12,40,60,1),
  ('21000000-0000-0000-0000-0000000000b1','Remada curvada','{"Dorsais","Romboides"}',4,12,30,60,2),
  ('21000000-0000-0000-0000-0000000000b2','Agachamento livre','{"Quadríceps","Glúteos"}',4,12,30,90,1),
  ('21000000-0000-0000-0000-0000000000b2','Stiff','{"Posteriores","Glúteos"}',3,12,20,60,2);

-- Plano alimentar da Mariana
insert into nutrition_plans (id, patient_id, professional_id, title) values
  ('30000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e2','Plano 1600 kcal');
insert into meals (nutrition_plan_id, time, name, items, calories, order_index) values
  ('30000000-0000-0000-0000-0000000000b1','07:00','Café da manhã','{"2 ovos","1 fatia pão integral","Café"}',380,1),
  ('30000000-0000-0000-0000-0000000000b1','12:30','Almoço','{"150g frango","Arroz integral","Salada"}',520,2),
  ('30000000-0000-0000-0000-0000000000b1','19:00','Jantar','{"150g salmão","Batata doce","Brócolis"}',450,3);

-- Histórico de peso da Mariana
insert into body_assessments (patient_id, professional_id, assessed_at, method, weight) values
  ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','2026-01-15','bioimpedancia',74.2),
  ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','2026-03-15','bioimpedancia',71.5),
  ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','2026-06-01','bioimpedancia',68.4);

-- Recuperação muscular da Mariana (estados variados p/ o mapa colorir)
insert into muscle_recovery_states (patient_id, muscle_group, last_trained_at, last_intensity, status) values
  ('10000000-0000-0000-0000-0000000000b1','biceps', now() - interval '0 day', 88,'fatigued'),
  ('10000000-0000-0000-0000-0000000000b1','chest', now() - interval '1 day', 72,'recovering'),
  ('10000000-0000-0000-0000-0000000000b1','lats', now() - interval '3 day', 68,'recovered'),
  ('10000000-0000-0000-0000-0000000000b1','calves', now() - interval '6 day', 15,'weakened');

-- Timeline de eventos da Mariana
insert into activity_events (patient_id, type, payload, created_at) values
  ('10000000-0000-0000-0000-0000000000b1','workout_checked','{"workout":"A — Costas e Bíceps"}', now() - interval '1 day'),
  ('10000000-0000-0000-0000-0000000000b1','weight_logged','{"weight":68.4}', now() - interval '2 day'),
  ('10000000-0000-0000-0000-0000000000b1','progress_photo_uploaded','{}', now() - interval '5 day'),
  ('10000000-0000-0000-0000-0000000000b1','hydration_logged','{"liters":2.5}', now() - interval '1 day');

-- Mensagens (central) — remetente clínica/profissional
insert into messages (patient_id, sender_role, sender_professional_id, body, created_at) values
  ('10000000-0000-0000-0000-0000000000b1','patient',null,'Tive uma semana corrida, mando os registros hoje à noite', now() - interval '3 hour'),
  ('10000000-0000-0000-0000-0000000000b1','professional','00000000-0000-0000-0000-0000000000e2','Tranquilo, Mari! Pode adaptar o treino para 30 min se precisar.', now() - interval '2 hour');

-- Campanhas padrão da clínica
insert into campaigns (clinic_id, name, trigger, message_template) values
  ('00000000-0000-0000-0000-0000000000c1','Boas-vindas','novo paciente','Oi {nome}! Bem-vindo(a) ao acompanhamento.'),
  ('00000000-0000-0000-0000-0000000000c1','Pós-consulta','após consulta','Foi ótimo te ver! Qualquer dúvida estou por aqui.'),
  ('00000000-0000-0000-0000-0000000000c1','Check-in 15 dias','15 dias após início','Como está se sentindo na primeira quinzena?'),
  ('00000000-0000-0000-0000-0000000000c1','Reativação de inativos','sem interação 60d','Senti sua falta! Vamos retomar?'),
  ('00000000-0000-0000-0000-0000000000c1','NPS pós-consulta','1 dia após consulta','De 0 a 10, quanto recomendaria nosso atendimento?');
