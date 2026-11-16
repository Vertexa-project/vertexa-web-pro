-- Prova SQL da parte 6 do redesign (treino publicado, envio ao app, lembretes A2) num Postgres LOCAL descartável. Uso: scripts/p6-sql-proof.sh
-- Roda dentro de begin ... rollback; a última consulta lista as asserções (ok=false = falha).
begin;
create temp table tr (n serial, name text, ok boolean, detail text);
create temp table fx (k text primary key, v uuid);
grant all on tr, fx to authenticated; grant usage, select on sequence tr_n_seq to authenticated;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null) returns void language sql as
$$ insert into tr(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;
create function pg_temp.as_user(p_k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.profiles where id = pg_temp.f('prof_' || p_k)), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.expect(p_name text, p_state text, p_sql text, p_msg text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  insert into tr(name, ok, detail) values (p_name, p_state is null, case when p_state is null then 'ok' else 'passou sem erro' end);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  insert into tr(name, ok, detail) values (p_name, v_state = p_state and (p_msg is null or v_msg like '%' || p_msg || '%'), v_state || ' ' || v_msg);
end $$;


insert into fx values ('prof_admin','00000000-0000-0000-0000-0000000000a1'),('prof_edu','00000000-0000-0000-0000-0000000000a2'),('prof_nutri','00000000-0000-0000-0000-0000000000a3'),
 ('prof_recep','00000000-0000-0000-0000-0000000000a4'),('prof_medico','00000000-0000-0000-0000-0000000000a5'),('prof_adminb','00000000-0000-0000-0000-0000000000b1'),
 ('prof_mariana','00000000-0000-0000-0000-0000000000c1'),('prof_paulo','00000000-0000-0000-0000-0000000000c2'),('prof_zelia','00000000-0000-0000-0000-0000000000c3'),
 ('mari','00000000-0000-0000-0000-0000000000f1'),('paulo','00000000-0000-0000-0000-0000000000f2'),('zelia','00000000-0000-0000-0000-0000000000f3');
-- como em produção: o paciente lê e não escreve; autenticados não escrevem direto nas tabelas novas
grant select on public.professionals, public.professional_patient_links to authenticated;

-- ───────── TREINO PUBLICADO / RASCUNHO
do $t$
declare mari uuid := pg_temp.f('mari'); paulo uuid := pg_temp.f('paulo'); pl uuid; r jsonb; n int;
  w jsonb := '[{"letter":"A","name":"Treino A","exercises":[{"name":"Supino","sets":3,"reps":10,"muscle_groups":["peito"]}]},{"letter":"B","name":"Treino B","exercises":[{"name":"Remada","sets":3,"reps":10}]}]'::jsonb;
begin
  perform pg_temp.chk('W1 backfill: plano legado ficou publicado (is_draft=false)', (select not is_draft from public.workout_plans where title = 'Plano legado'), null);
  perform pg_temp.as_user('mariana');
  perform pg_temp.chk('W2 paciente com plano legado continua vendo plano, treino e exercício',
    (select count(*) from public.workout_plans) = 1 and (select count(*) from public.workouts) = 1 and (select count(*) from public.workout_exercises) = 1, null);
  perform pg_temp.su();

  -- educador salva para o Paulo (sem plano): nasce rascunho
  perform pg_temp.as_user('edu');
  pl := public.save_workout_plan_v2(paulo, 'Ficha do Paulo', 'Força', w);
  perform pg_temp.chk('W3 primeiro salvar nasce rascunho (equipe vê)', (select is_draft and published_at is null from public.workout_plans where id = pl), null);
  perform pg_temp.chk('W4 equipe vê plano, 2 treinos e 2 exercícios do rascunho',
    (select count(*) from public.workouts where workout_plan_id = pl) = 2 and (select count(*) from public.workout_exercises e join public.workouts x on x.id = e.workout_id where x.workout_plan_id = pl) = 2, null);
  perform pg_temp.su();
  perform pg_temp.as_user('paulo');
  select count(*) into n from public.workout_plans;
  perform pg_temp.chk('W5 paciente NÃO vê o rascunho (plano, treinos, exercícios)',
    n = 0 and (select count(*) from public.workouts) = 0 and (select count(*) from public.workout_exercises) = 0, n::text);
  perform pg_temp.expect('W6 paciente não publica o próprio treino', '42501', format($q$ select public.publish_workout_plan(%L) $q$, pl));
  perform pg_temp.expect('W7 paciente não muda is_draft direto', '42501', format($q$ update public.workout_plans set is_draft = false where id = %L $q$, pl));
  perform pg_temp.su();
  perform pg_temp.as_user('nutri');
  perform pg_temp.expect('W8 nutricionista (sem disciplina de treino) não publica', '42501', format($q$ select public.publish_workout_plan(%L) $q$, pl));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('W9 recepção não publica', '42501', format($q$ select public.publish_workout_plan(%L) $q$, pl));
  perform pg_temp.su();
  perform pg_temp.as_user('medico');
  perform pg_temp.expect('W10 profissional sem disciplina não publica', '42501', format($q$ select public.publish_workout_plan(%L) $q$, pl));
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('W11 admin de outra clínica não publica', '42501', format($q$ select public.publish_workout_plan(%L) $q$, pl));
  perform pg_temp.su();

  perform pg_temp.as_user('edu');
  r := public.publish_workout_plan(pl);
  perform pg_temp.su();
  perform pg_temp.chk('W12 educador publica: 2 treinos, 2 exercícios, data e autor gravados',
    (r->>'already_published')::boolean = false and (r->>'workouts')::int = 2 and (r->>'exercises')::int = 2
    and (select not is_draft and published_at is not null and published_by = '00000000-0000-0000-0000-0000000000e2' from public.workout_plans where id = pl), r::text);
  perform pg_temp.chk('W13 paciente recebeu 1 aviso', (select count(*) from public.notifications where patient_id = paulo and title = 'Treino novo liberado') = 1, null);
  perform pg_temp.as_user('paulo');
  perform pg_temp.chk('W14 publicado: paciente vê todos os treinos e exercícios, sem filtro de dia',
    (select count(*) from public.workouts) = 2 and (select count(*) from public.workout_exercises) = 2 and (select count(*) from public.workout_plans) = 1, null);
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  r := public.publish_workout_plan(pl);
  perform pg_temp.su();
  perform pg_temp.chk('W15 publicar de novo é idempotente (sem 2º aviso, mesma data)', (r->>'already_published')::boolean
    and (select count(*) from public.notifications where patient_id = paulo and title = 'Treino novo liberado') = 1, r::text);

  -- editar plano publicado: continua visível (não esconde o que o paciente já vê)
  perform pg_temp.as_user('edu');
  pl := public.save_workout_plan_v2(paulo, 'Ficha do Paulo v2', 'Força', w);
  perform pg_temp.su();
  perform pg_temp.chk('W16 editar plano publicado mantém publicado e a data de publicação',
    (select not is_draft and published_at is not null from public.workout_plans where id = pl), null);
  perform pg_temp.as_user('paulo');
  perform pg_temp.chk('W17 paciente segue vendo o plano editado', (select count(*) from public.workouts) = 2, null);
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  pl := public.save_workout_plan_v2(mari, 'Ficha da Mariana v2', null, w);
  perform pg_temp.su();
  perform pg_temp.as_user('mariana');
  perform pg_temp.chk('W18 plano legado editado pelo web continua visível ao paciente (nunca esconde treino já visível)',
    (select count(*) from public.workouts) = 2, null);
  perform pg_temp.su();

  -- plano vazio não publica; salvar já publicando
  perform pg_temp.as_user('edu');
  pl := public.save_workout_plan_v2(paulo, 'Vazio', null, '[]'::jsonb);
  perform pg_temp.expect('W19 plano sem exercício não publica (workout_plan_empty)', '22023', format($q$ select public.publish_workout_plan(%L) $q$, pl), 'workout_plan_empty');
  pl := public.save_workout_plan_v2(paulo, 'Ficha do Paulo v3', null, w, true);
  perform pg_temp.su();
  perform pg_temp.chk('W20 salvar com p_publish=true já nasce publicado', (select not is_draft and published_at is not null from public.workout_plans where id = pl), null);
end $t$;

-- ───────── ENVIO AO APP DO PACIENTE
do $t$
declare mari uuid := pg_temp.f('mari'); paulo uuid := pg_temp.f('paulo'); zelia uuid := pg_temp.f('zelia');
  d_treino uuid; d_dieta uuid; d_exame uuid; d_pac uuid; dv uuid; dv2 uuid; n int;
begin
  perform pg_temp.as_user('edu');
  insert into public.patient_documents (patient_id, uploaded_by_role, uploaded_by_professional_id, kind, title, file_path, mime_type, file_size_bytes)
  values (mari, 'professional', '00000000-0000-0000-0000-0000000000e2', 'report', 'Treino ABC.pdf', mari || '/t1.pdf', 'application/pdf', 1000) returning id into d_treino;
  insert into public.patient_documents (patient_id, uploaded_by_role, uploaded_by_professional_id, kind, title, file_path, mime_type, file_size_bytes)
  values (mari, 'professional', '00000000-0000-0000-0000-0000000000e2', 'exam', 'Hemograma.pdf', mari || '/h1.pdf', 'application/pdf', 2000) returning id into d_exame;
  insert into public.patient_documents (patient_id, uploaded_by_role, kind, title, file_path, mime_type, file_size_bytes)
  values (mari, 'patient', 'exam', 'Meu exame.pdf', mari || '/p1.pdf', 'application/pdf', 3000) returning id into d_pac;
  perform pg_temp.expect('D1 treino enviado por quem NÃO tem a disciplina de treino', null, $q$ select 1 $q$);
  perform pg_temp.su();

  perform pg_temp.as_user('nutri');
  perform pg_temp.expect('D2 nutricionista não envia PDF de treino', '42501', format($q$ select public.send_document_to_patient(%L, 'treino') $q$, d_treino));
  insert into public.patient_documents (patient_id, uploaded_by_role, uploaded_by_professional_id, kind, title, file_path, mime_type, file_size_bytes)
  values (mari, 'professional', '00000000-0000-0000-0000-0000000000e3', 'report', 'Plano alimentar.pdf', mari || '/d1.pdf', 'application/pdf', 1500) returning id into d_dieta;
  dv2 := public.send_document_to_patient(d_dieta, 'plano_alimentar', 'Plano alimentar');
  perform pg_temp.su();
  perform pg_temp.chk('D3 nutricionista envia o plano alimentar (quem enviou e quando gravados)',
    (select sent_by_professional_id = '00000000-0000-0000-0000-0000000000e3' and sent_at is not null and kind = 'plano_alimentar' from public.patient_deliveries where id = dv2), null);

  perform pg_temp.as_user('edu');
  perform pg_temp.expect('D3b educador (sem nutrição) não envia plano alimentar', '42501', format($q$ select public.send_document_to_patient(%L, 'plano_alimentar') $q$, d_dieta));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('D4 recepção não envia documento', '42501', format($q$ select public.send_document_to_patient(%L, 'documento') $q$, d_exame));
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('D5 admin de outra clínica não envia', '42501', format($q$ select public.send_document_to_patient(%L, 'documento') $q$, d_exame));
  perform pg_temp.su();

  perform pg_temp.as_user('edu');
  dv := public.send_document_to_patient(d_treino, 'treino', 'Treino ABC');
  perform pg_temp.expect('D6 documento enviado pelo paciente não vai de volta', '22023', format($q$ select public.send_document_to_patient(%L, 'documento') $q$, d_pac));
  perform pg_temp.expect('D7 tipo inválido', '22023', format($q$ select public.send_document_to_patient(%L, 'qualquer') $q$, d_exame));
  perform pg_temp.chk('D8 reenviar o mesmo documento devolve o mesmo envio (sem duplicar)', public.send_document_to_patient(d_treino, 'treino') = dv
    and (select count(*) from public.patient_deliveries where document_id = d_treino) = 1, null);
  perform pg_temp.expect('D9 ninguém insere envio direto', '42501', format($q$ insert into public.patient_deliveries (patient_id, clinic_id, document_id, kind, title, file_path) values (%L, %L, %L, 'documento', 'x', 'x') $q$, mari, pg_temp.f('mari'), d_exame));
  perform pg_temp.su();
  perform pg_temp.chk('D10 paciente recebeu 2 avisos de documento', (select count(*) from public.notifications where patient_id = mari and title = 'Novo documento da clínica') = 2, null);

  perform pg_temp.as_user('mariana');
  perform pg_temp.chk('D11 paciente vê os 2 envios dela', (select count(*) from public.patient_deliveries) = 2, null);
  perform public.mark_delivery_opened(dv);
  perform pg_temp.expect('D12 paciente não envia nem insere', '42501', format($q$ select public.send_document_to_patient(%L, 'documento') $q$, d_exame));
  perform pg_temp.su();
  perform pg_temp.chk('D13 abertura registrada uma vez', (select first_opened_at is not null from public.patient_deliveries where id = dv), null);
  perform pg_temp.as_user('paulo');
  perform pg_temp.chk('D14 outro paciente da mesma clínica não vê envio alheio', (select count(*) from public.patient_deliveries) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('zelia');
  perform pg_temp.chk('D15 paciente de outra clínica não vê', (select count(*) from public.patient_deliveries) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('paulo');
  perform public.mark_delivery_opened(dv2);
  perform pg_temp.su();
  perform pg_temp.chk('D16 paciente alheio não marca abertura de envio que não é dele', (select first_opened_at is null from public.patient_deliveries where id = dv2), null);

  -- retirar do app
  perform pg_temp.as_user('nutri');
  perform pg_temp.expect('D17 nutricionista não retira envio de treino', '42501', format($q$ select public.revoke_delivery(%L) $q$, dv));
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  perform public.revoke_delivery(dv);
  perform pg_temp.chk('D18 equipe segue vendo o envio retirado (histórico)', (select revoked_at is not null from public.patient_deliveries where id = dv), null);
  perform pg_temp.su();
  perform pg_temp.as_user('mariana');
  perform pg_temp.chk('D19 paciente não vê envio retirado', (select count(*) from public.patient_deliveries where id = dv) = 0, null);
  perform pg_temp.su();
end $t$;

-- ───────── LEMBRETES A2
do $t$
declare mari uuid := pg_temp.f('mari'); paulo uuid := pg_temp.f('paulo'); zelia uuid := pg_temp.f('zelia'); r1 uuid; r2 uuid; e1 uuid; e2 uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform pg_temp.as_user('edu');
  r1 := public.upsert_patient_reminder(mari, 'return', null, today + 30, 14, 7, 'Oi {nome}, retorno em {data}');
  r2 := public.upsert_patient_reminder(mari, 'return', 'ignorado', today + 40, 10, 5, null);
  perform pg_temp.su();
  perform pg_temp.chk('R1 mudar a data do retorno muda a MESMA linha (sem duplicar)', r1 = r2 and (select count(*) from public.patient_reminders where patient_id = mari and kind = 'return') = 1
    and (select due_on = today + 40 and notify_days_before = 10 and pro_notify_days_before = 5 and message_template is null and title is null from public.patient_reminders where id = r1), null);
  perform pg_temp.as_user('edu');
  e1 := public.upsert_patient_reminder(mari, 'exam', 'Hemograma', today + 20);
  e2 := public.upsert_patient_reminder(mari, 'exam', '  hemograma ', today + 25);
  perform pg_temp.su();
  perform pg_temp.chk('R2 exame com o mesmo nome (sem diferenciar caixa/espaços) atualiza o existente', e1 = e2 and (select count(*) from public.patient_reminders where kind = 'exam') = 1
    and (select due_on = today + 25 from public.patient_reminders where id = e1), null);
  perform pg_temp.as_user('edu');
  perform public.upsert_patient_reminder(mari, 'exam', 'Ferritina', today + 20);
  perform pg_temp.su();
  perform pg_temp.chk('R3 exame de outro nome é outro lembrete (2 exames + 1 retorno)', (select count(*) from public.patient_reminders where patient_id = mari) = 3, null);
  perform pg_temp.as_user('edu');
  perform pg_temp.expect('R4 exame sem nome é recusado', '22023', format($q$ select public.upsert_patient_reminder(%L, 'exam', '  ', current_date + 3) $q$, mari));
  perform pg_temp.expect('R5 data absurda recusada', '22023', format($q$ select public.upsert_patient_reminder(%L, 'return', null, current_date + 99999) $q$, mari));
  perform pg_temp.expect('R6 janela de aviso fora de 0–90 recusada', '22023', format($q$ select public.upsert_patient_reminder(%L, 'return', null, current_date + 5, 91) $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('R7 recepção não cadastra lembrete', '42501', format($q$ select public.upsert_patient_reminder(%L, 'return', null, current_date + 5) $q$, mari));
  perform pg_temp.chk('R8 recepção não lê lembretes (0)', (select count(*) from public.patient_reminders) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('R9 admin de outra clínica não cadastra', '42501', format($q$ select public.upsert_patient_reminder(%L, 'return', null, current_date + 5) $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('mariana');
  perform pg_temp.expect('R10 paciente não cadastra nem muda lembrete', '42501', format($q$ select public.upsert_patient_reminder(%L, 'return', null, current_date + 5) $q$, mari));
  perform pg_temp.expect('R11 paciente não apaga lembrete', '42501', format($q$ select public.delete_patient_reminder(%L) $q$, r1));
  perform pg_temp.chk('R12 paciente lê os 3 lembretes dela', (select count(*) from public.patient_reminders) = 3, null);
  perform pg_temp.su();
  perform pg_temp.as_user('paulo');
  perform pg_temp.chk('R13 outro paciente não lê lembrete alheio', (select count(*) from public.patient_reminders) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  perform public.complete_patient_reminder(e1);
  perform pg_temp.su();
  perform pg_temp.chk('R14 marcar como feito grava a data', (select done_at is not null from public.patient_reminders where id = e1), null);
  perform pg_temp.as_user('edu');
  perform public.upsert_patient_reminder(mari, 'exam', 'Hemograma', today + 60, 7, 7, null, true, e1);
  perform pg_temp.su();
  perform pg_temp.chk('R15 nova data reabre um lembrete já feito', (select done_at is null and due_on = today + 60 from public.patient_reminders where id = e1), null);
  perform pg_temp.as_user('edu');
  perform public.delete_patient_reminder(r1);
  perform pg_temp.su();
  perform pg_temp.chk('R16 apagou, sumiu', (select count(*) from public.patient_reminders where id = r1) = 0, null);
  perform pg_temp.as_user('edu');
  r1 := public.upsert_patient_reminder(mari, 'return', null, today + 10);
  perform pg_temp.su();
  perform pg_temp.chk('R17 depois de apagar, novo retorno cria 1 linha', (select count(*) from public.patient_reminders where patient_id = mari and kind = 'return') = 1, null);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
