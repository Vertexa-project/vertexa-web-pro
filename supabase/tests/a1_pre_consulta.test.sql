-- Prova SQL da automação A1 (pré-consulta) num Postgres LOCAL descartável. Uso: scripts/a1-sql-proof.sh
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


-- ───────── fixture: agenda
insert into fx values ('a_future', gen_random_uuid()), ('a_other', gen_random_uuid());
grant select on public.professionals, public.professional_patient_links to authenticated;
grant select on public.patient_documents to authenticated;

do $t$
declare clinic uuid := '00000000-0000-0000-0000-00000000ca01'; mari uuid := pg_temp.f('mari'); paulo uuid := pg_temp.f('paulo'); zelia uuid := pg_temp.f('zelia');
  a1 uuid := pg_temp.f('a_future'); n int; r jsonb; pc uuid; q jsonb; doc uuid; path text; ids text[];
begin
  -- Padrão: nasce desligado; consulta marcada NÃO gera pedido
  insert into public.appointments (id, clinic_id, patient_id, title, starts_at) values (a1, clinic, mari, 'Consulta A', now() + interval '3 days');
  perform pg_temp.chk('S1 sem configuração: nada é enviado ao marcar', (select count(*) from public.pre_consultas) = 0, null);
  perform pg_temp.chk('S2 12 perguntas padrão (8 a 12)', jsonb_array_length(private.pre_consulta_default_questions()) between 8 and 12, null);

  -- liga/desliga: só admin da clínica
  perform pg_temp.as_user('edu');
  perform pg_temp.expect('S3 profissional não-admin não liga o envio', '42501', format('select public.set_pre_consulta_settings(%L, true)', clinic));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('S4 Recepção não-admin não liga o envio', '42501', format('select public.set_pre_consulta_settings(%L, true)', clinic));
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('S5 admin de OUTRA clínica não liga', '42501', format('select public.set_pre_consulta_settings(%L, true)', clinic));
  perform pg_temp.su();
  perform pg_temp.as_user('admin');
  perform public.set_pre_consulta_settings(clinic, true);
  perform pg_temp.expect('S6 perguntas inválidas (id repetido) são recusadas', '22023',
    format($q$select public.set_pre_consulta_settings(%L, true, '[{"id":"a","label":"Pergunta um","type":"long"},{"id":"a","label":"Pergunta dois","type":"long"}]'::jsonb)$q$, clinic));
  perform pg_temp.expect('S7 lista vazia de perguntas é recusada', '22023', format($q$select public.set_pre_consulta_settings(%L, true, '[]'::jsonb)$q$, clinic));
  perform pg_temp.su();
  perform pg_temp.chk('S8 configuração salva ligada', (select auto_send and questions is null from public.pre_consulta_settings where clinic_id = clinic), null);

  -- Marcou consulta => pedido + aviso ao paciente
  insert into public.appointments (id, clinic_id, patient_id, title, starts_at) values (pg_temp.f('a_other'), clinic, mari, 'Consulta B', now() + interval '5 days');
  select id into pc from public.pre_consultas where appointment_id = pg_temp.f('a_other');
  perform pg_temp.chk('T1 consulta marcada gera 1 pedido enviado (auto)', (select status = 'enviada' and source = 'auto' and jsonb_array_length(questions) = 12 from public.pre_consultas where id = pc), null);
  perform pg_temp.chk('T2 paciente recebeu o aviso com a data', (select count(*) from public.notifications where patient_id = mari and title like 'Pré-consulta da sua consulta de __/__') = 1, null);
  -- não duplica
  update public.appointments set notes = 'x', starts_at = starts_at + interval '1 hour' where id = pg_temp.f('a_other');
  perform pg_temp.chk('T3 editar a consulta não duplica o pedido', (select count(*) from public.pre_consultas where appointment_id = pg_temp.f('a_other')) = 1, null);
  perform pg_temp.expect('T3b índice único barra pedido duplicado para a mesma consulta', '23505', format($q$insert into public.pre_consultas (clinic_id, patient_id, appointment_id, questions) values (%L, %L, %L, '[]'::jsonb)$q$, clinic, mari, pg_temp.f('a_other')));
  perform pg_temp.chk('T4 mudar o horário atualiza a data do pedido', (select appointment_starts_at = (select starts_at from public.appointments where id = pg_temp.f('a_other')) from public.pre_consultas where id = pc), null);
  -- consulta do tipo retorno/outros e sem paciente não geram
  insert into public.appointments (clinic_id, patient_id, title, starts_at, type) values (clinic, mari, 'Retorno', now() + interval '6 days', 'retorno');
  insert into public.appointments (clinic_id, patient_id, title, starts_at) values (clinic, null, 'Reunião', now() + interval '6 days');
  insert into public.appointments (clinic_id, patient_id, title, starts_at) values (clinic, paulo, 'Passada', now() - interval '2 days');
  perform pg_temp.chk('T5 retorno, sem paciente e consulta passada não geram', (select count(*) from public.pre_consultas) = 1, null);

  -- Paciente: lê só o seu; rascunho; anexa; envia
  perform pg_temp.as_user('mariana');
  perform pg_temp.chk('P1 paciente vê o próprio pedido', (select count(*) from public.pre_consultas) = 1, null);
  perform public.save_pre_consulta_draft(pc, '{"objetivo":"Emagrecer e ganhar músculo","saude":"Gastrite","xyz":"ignorado"}'::jsonb);
  perform pg_temp.su();
  perform pg_temp.chk('P2 rascunho salvo; chave fora das perguntas é descartada', (select status = 'rascunho' and answers = '{"objetivo":"Emagrecer e ganhar músculo","saude":"Gastrite"}'::jsonb from public.pre_consultas where id = pc), null);
  perform pg_temp.as_user('paulo');
  perform pg_temp.chk('P3 outro paciente não vê o pedido', (select count(*) from public.pre_consultas) = 0, null);
  perform pg_temp.expect('P4 outro paciente não salva rascunho', '42501', format($q$select public.save_pre_consulta_draft(%L, '{"objetivo":"x"}'::jsonb)$q$, pc));
  perform pg_temp.su();

  perform pg_temp.as_user('mariana');
  path := mari::text || '/pre-consulta/' || gen_random_uuid() || '.pdf';
  perform pg_temp.expect('P5 caminho de outro paciente é recusado', '22023', format($q$select public.attach_pre_consulta_file(%L, %L, 'exame.pdf', 'application/pdf', 1000)$q$, pc, paulo::text || '/pre-consulta/a.pdf'));
  perform pg_temp.expect('P6 tipo de arquivo não aceito é recusado', '22023', format($q$select public.attach_pre_consulta_file(%L, %L, 'a.exe', 'application/x-msdownload', 1000)$q$, pc, mari::text || '/pre-consulta/a.exe'));
  perform pg_temp.expect('P7 arquivo acima de 15 MB é recusado', '22023', format($q$select public.attach_pre_consulta_file(%L, %L, 'a.pdf', 'application/pdf', 20000000)$q$, pc, mari::text || '/pre-consulta/a.pdf'));
  perform pg_temp.expect('P8 sobe no storage na própria pasta', null, format($q$insert into storage.objects (bucket_id, name) values ('patient-documents', %L)$q$, path));
  perform pg_temp.expect('P9 não sobe na pasta de outro paciente', '42501', format($q$insert into storage.objects (bucket_id, name) values ('patient-documents', %L)$q$, paulo::text || '/pre-consulta/b.pdf'));
  perform pg_temp.expect('P10 não sobe fora da pasta pre-consulta', '42501', format($q$insert into storage.objects (bucket_id, name) values ('patient-documents', %L)$q$, mari::text || '/exame.pdf'));
  doc := public.attach_pre_consulta_file(pc, path, 'Hemograma.pdf', 'application/pdf', 123456);
  perform pg_temp.su();
  perform pg_temp.chk('P11 exame entrou em Documentos da ficha (patient_documents, enviado pelo paciente)', (select uploaded_by_role = 'patient' and kind = 'exam' and title = 'Hemograma.pdf' and file_path = path from public.patient_documents where id = doc), null);

  perform pg_temp.as_user('mariana');
  perform public.submit_pre_consulta(pc, '{"objetivo":"Emagrecer e ganhar músculo","saude":"Gastrite","medicacoes":"Omeprazol"}'::jsonb);
  perform pg_temp.expect('P12 depois de enviar não altera mais', '22023', format($q$select public.save_pre_consulta_draft(%L, '{"objetivo":"mudei"}'::jsonb)$q$, pc));
  perform pg_temp.expect('P13 depois de enviar não anexa mais', '22023', format($q$select public.attach_pre_consulta_file(%L, %L, 'b.pdf', 'application/pdf', 10)$q$, pc, mari::text || '/pre-consulta/b.pdf'));
  perform pg_temp.su();
  perform pg_temp.chk('P14 status respondida com data', (select status = 'respondida' and answered_at is not null from public.pre_consultas where id = pc), null);

  -- Leitura por perfil
  perform pg_temp.as_user('edu');
  perform pg_temp.chk('L1 profissional vinculado lê respostas e o vínculo do exame', (select count(*) from public.pre_consultas where id = pc and answers ? 'objetivo') = 1
     and (select count(*) from public.pre_consulta_files where pre_consulta_id = pc) = 1, null);
  perform pg_temp.su();
  perform pg_temp.as_user('admin');
  perform pg_temp.chk('L2 admin da clínica lê', (select count(*) from public.pre_consultas where id = pc) = 1, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.chk('L3 Recepção (sem vínculo) NÃO lê respostas nem arquivos', (select count(*) from public.pre_consultas) = 0 and (select count(*) from public.pre_consulta_files) = 0, null);
  perform pg_temp.expect('L4 Recepção não envia pré-consulta', '42501', format('select public.send_pre_consulta(%L)', mari));
  perform pg_temp.expect('L5 Recepção não cancela', '42501', format('select public.cancel_pre_consulta(%L)', pc));
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.chk('L6 admin de outra clínica NÃO lê', (select count(*) from public.pre_consultas) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  perform pg_temp.chk('L7 profissional não vinculado a outro paciente: nada', (select count(*) from public.pre_consultas where patient_id = zelia) = 0, null);
  perform pg_temp.expect('L8 não envia para paciente de outra clínica', '42501', format('select public.send_pre_consulta(%L)', zelia));
  perform pg_temp.su();

  -- Consulta cancelada cancela o pedido; respondido fica
  update public.appointments set status = 'desmarcado' where id = pg_temp.f('a_other');
  perform pg_temp.chk('C1 desmarcar NÃO apaga resposta já enviada', (select status = 'respondida' from public.pre_consultas where id = pc), null);

  -- novo pedido pendente numa consulta nova e cancelamento
  insert into public.appointments (id, clinic_id, patient_id, title, starts_at) values (gen_random_uuid(), clinic, paulo, 'Consulta Paulo', now() + interval '2 days') returning id into a1;
  select id into pc from public.pre_consultas where appointment_id = a1;
  perform pg_temp.chk('C2 consulta do Paulo gera pedido', pc is not null, null);
  update public.appointments set status = 'desmarcado' where id = a1;
  perform pg_temp.chk('C3 consulta desmarcada cancela o pedido pendente', (select status = 'cancelada' and canceled_at is not null from public.pre_consultas where id = pc), null);
  perform pg_temp.as_user('paulo');
  perform pg_temp.chk('C4 paciente não vê pedido cancelado', (select count(*) from public.pre_consultas) = 0, null);
  perform pg_temp.expect('C5 não responde pedido cancelado', '22023', format($q$select public.submit_pre_consulta(%L, '{"objetivo":"x"}'::jsonb)$q$, pc));
  perform pg_temp.su();
  update public.appointments set status = 'confirmado' where id = a1;
  perform pg_temp.chk('C6 reativar a consulta reabre 1 pedido novo (sem duplicar)', (select count(*) from public.pre_consultas where appointment_id = a1 and status <> 'cancelada') = 1
     and (select count(*) from public.pre_consultas where appointment_id = a1) = 2, null);
  delete from public.appointments where id = a1;
  perform pg_temp.chk('C7 excluir a consulta cancela o pedido pendente', (select count(*) from public.pre_consultas where patient_id = paulo and status in ('enviada','rascunho')) = 0, null);

  -- Envio manual
  perform pg_temp.as_user('nutri');
  r := public.send_pre_consulta(paulo);
  perform pg_temp.chk('M1 envio manual sem consulta cria pedido solto', (r->>'created')::boolean and (r->>'appointment_id') is null, r::text);
  r := public.send_pre_consulta(paulo);
  perform pg_temp.chk('M2 reenviar não duplica', not (r->>'created')::boolean and (select count(*) from public.pre_consultas where patient_id = paulo and appointment_id is null and status in ('enviada','rascunho')) = 1, r::text);
  perform pg_temp.su();
  insert into public.appointments (clinic_id, patient_id, title, starts_at) values (clinic, paulo, 'Consulta nova', now() + interval '9 days');
  perform pg_temp.chk('M3 consulta marcada com pedido solto aberto cria o pedido da consulta', (select count(*) from public.pre_consultas where patient_id = paulo and appointment_id is not null and status <> 'cancelada') = 1, null);
  perform pg_temp.as_user('edu');
  perform public.cancel_pre_consulta((select id from public.pre_consultas where patient_id = paulo and appointment_id is null and status = 'enviada'));
  perform pg_temp.su();
  perform pg_temp.chk('M4 profissional cancela o pedido solto', (select count(*) from public.pre_consultas where patient_id = paulo and appointment_id is null and status = 'cancelada') >= 1 and (select count(*) from public.pre_consultas where patient_id = paulo and appointment_id is null and status in ('enviada','rascunho')) = 0, (select string_agg(status || coalesce(appointment_id::text,'-'), ',') from public.pre_consultas where patient_id = paulo));

  -- Remover anexo no rascunho e perguntas editadas valem só para novos pedidos
  perform pg_temp.as_user('admin');
  perform public.set_pre_consulta_settings(clinic, true, '[{"id":"unica","label":"Qual a sua queixa principal?","type":"long"}]'::jsonb);
  perform pg_temp.su();
  insert into public.appointments (clinic_id, patient_id, title, starts_at) values (clinic, mari, 'Consulta C', now() + interval '12 days');
  select id into pc from public.pre_consultas where patient_id = mari and status = 'enviada';
  perform pg_temp.chk('Q1 pedido novo usa as perguntas editadas', (select questions->0->>'id' = 'unica' and jsonb_array_length(questions) = 1 from public.pre_consultas where id = pc), null);
  perform pg_temp.chk('Q2 pedido já respondido manteve as 12 perguntas', (select jsonb_array_length(questions) = 12 from public.pre_consultas where status = 'respondida' and patient_id = mari), null);
  perform pg_temp.as_user('mariana');
  path := mari::text || '/pre-consulta/' || gen_random_uuid() || '.jpg';
  doc := public.attach_pre_consulta_file(pc, path, 'foto.jpg', 'image/jpeg', 5000);
  perform pg_temp.chk('Q3 remover anexo devolve o caminho', public.remove_pre_consulta_file(doc) = path, null);
  perform pg_temp.chk('Q3b ...e apaga o documento e o vínculo', (select count(*) from public.patient_documents where id = doc) = 0 and (select count(*) from public.pre_consulta_files where document_id = doc) = 0, null);
  perform pg_temp.expect('Q4 enviar vazio é recusado', '22023', format($q$select public.submit_pre_consulta(%L, '{}'::jsonb)$q$, pc));
  perform pg_temp.su();

  -- Desligar
  perform pg_temp.as_user('admin');
  perform public.set_pre_consulta_settings(clinic, false);
  perform pg_temp.su();
  insert into public.appointments (clinic_id, patient_id, title, starts_at) values (clinic, paulo, 'Consulta D', now() + interval '20 days');
  perform pg_temp.chk('D1 desligado: consulta nova não gera pedido', (select count(*) from public.pre_consultas where patient_id = paulo and appointment_id in (select id from public.appointments where title = 'Consulta D')) = 0, null);

  -- a agenda nunca trava por causa do trigger
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
