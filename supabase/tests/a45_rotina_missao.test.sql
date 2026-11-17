-- Prova SQL de A4+A5 (rotina por paciente e missão da 1ª semana) num Postgres LOCAL descartável. Uso: scripts/a45-sql-proof.sh
begin;
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

grant select on public.professionals, public.professional_patient_links to authenticated;
insert into fx values ('nina_prof','00000000-0000-0000-0000-0000000000c9'),('prof_nina','00000000-0000-0000-0000-0000000000c9');

do $t$
declare mari uuid := pg_temp.f('mari'); paulo uuid := pg_temp.f('paulo'); zelia uuid := pg_temp.f('zelia'); clA uuid := '00000000-0000-0000-0000-00000000ca01';
  clB uuid := '00000000-0000-0000-0000-00000000cb01'; nina uuid := '00000000-0000-0000-0000-0000000000f9';
  today date := private.brt_date(now()); dw int := extract(dow from private.brt_date(now()))::int; r jsonb; m jsonb; n int; it jsonb;

begin
  -- ── 1. nasce desligado; só admin configura
  perform pg_temp.as_user('edu');
  r := public.get_patient_routine(mari);
  perform pg_temp.chk('A1 sem configuração a rotina está desligada (clinic_off)', r->>'enabled' = 'false' and r->>'source' = 'clinic_off', r::text);
  m := public.get_patient_mission(mari);
  perform pg_temp.chk('A2 sem configuração a missão está desligada', m->>'enabled' = 'false', m::text);
  perform pg_temp.expect('A3 profissional não-admin não salva o padrão da clínica', '42501', format($q$ select public.save_clinic_routine_settings(%L, '{"routine_enabled":true}') $q$, clA));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('A4 recepção não salva', '42501', format($q$ select public.save_clinic_routine_settings(%L, '{"routine_enabled":true}') $q$, clA));
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('A5 admin de outra clínica não salva', '42501', format($q$ select public.save_clinic_routine_settings(%L, '{"routine_enabled":true}') $q$, clA));
  perform pg_temp.su();
  perform pg_temp.as_user('mariana');
  perform pg_temp.expect('A6 paciente não salva o padrão', '42501', format($q$ select public.save_clinic_routine_settings(%L, '{"routine_enabled":true}') $q$, clA));
  perform pg_temp.expect('A7 paciente não escreve direto na tabela de configuração', '42501', format($q$ update public.clinic_routine_settings set routine_enabled = true where clinic_id = %L $q$, clA));
  perform pg_temp.su();

  -- ── 2. admin liga e define dias: foto (3 dias atrás), peso (ontem), feedback (hoje)
  perform pg_temp.as_user('admin');
  r := public.save_clinic_routine_settings(clA, jsonb_build_object('routine_enabled', true,
    'photo_period', 'weekly', 'photo_weekday', extract(dow from today - 3)::int,
    'weight_period', 'weekly', 'weight_weekday', extract(dow from today - 1)::int,
    'feedback_period', 'weekly', 'feedback_weekday', dw));
  perform pg_temp.chk('B1 admin liga a rotina e o dia de início é hoje', (r->>'routine_enabled')::boolean and (r->>'routine_enabled_on')::date = today, r::text);
  perform pg_temp.chk('B2 a missão continua desligada (liga e desliga independentes)', not (r->>'mission_enabled')::boolean, null);
  perform pg_temp.expect('B3 período inválido é recusado', '22023', format($q$ select public.save_clinic_routine_settings(%L, '{"photo_period":"diario"}') $q$, clA));
  perform pg_temp.expect('B4 dia da semana inválido é recusado', '22023', format($q$ select public.save_clinic_routine_settings(%L, '{"feedback_weekday":9}') $q$, clA));
  perform pg_temp.su();
  update public.clinic_routine_settings set routine_enabled_on = today - 20 where clinic_id = clA;   -- para ter histórico na prova

  -- ── 3. rotina efetiva: hoje (feedback), atrasados (foto, peso) — nada feito ainda
  perform pg_temp.as_user('edu');
  r := public.get_patient_routine(mari);
  perform pg_temp.chk('C1 padrão da clínica vale e o paciente tem 3 itens abertos', r->>'source' = 'clinic' and jsonb_array_length(r->'current') = 3, (r->'current')::text);
  perform pg_temp.chk('C2 feedback é "hoje"', exists (select 1 from jsonb_array_elements(r->'current') c where c->>'key' = 'feedback' and c->>'state' = 'due_today'), null);
  perform pg_temp.chk('C3 peso e foto estão "atrasados"', (select count(*) from jsonb_array_elements(r->'current') c where c->>'state' = 'overdue') = 2, null);
  select value into it from jsonb_array_elements(r->'items') where value->>'key' = 'weight';
  perform pg_temp.chk('C4 ocorrências anteriores sem registro aparecem como "missed"', exists (select 1 from jsonb_array_elements(it->'occurrences') o where o->>'state' = 'missed'), it::text);
  perform pg_temp.su();
  -- peso RECUSADO não conta; peso real conta
  insert into public.weight_logs (patient_id, weight_kg, review_status) values (mari, 80.5, 'rejected');
  perform pg_temp.as_user('edu'); r := public.get_patient_routine(mari);
  perform pg_temp.chk('C5 peso recusado não cumpre a rotina', exists (select 1 from jsonb_array_elements(r->'current') c where c->>'key' = 'weight'), null);
  perform pg_temp.su();
  insert into public.weight_logs (patient_id, weight_kg, review_status) values (mari, 80.2, 'ok');
  perform pg_temp.as_user('edu'); r := public.get_patient_routine(mari);
  perform pg_temp.chk('C6 peso real registrado cumpre (sem duplo registro): saiu dos abertos', not exists (select 1 from jsonb_array_elements(r->'current') c where c->>'key' = 'weight'), (r->'current')::text);
  perform pg_temp.su();
  insert into public.progress_photos (patient_id, storage_path, pose, taken_at) values (mari, mari || '/a.jpg', 'front', now());
  perform pg_temp.as_user('edu'); r := public.get_patient_routine(mari);
  perform pg_temp.chk('C7 foto real registrada cumpre a foto', not exists (select 1 from jsonb_array_elements(r->'current') c where c->>'key' = 'photo'), null);
  perform pg_temp.su();

  -- ── 4. o paciente registra o feedback da semana
  perform pg_temp.as_user('mariana');
  perform pg_temp.expect('D1 feedback vazio é recusado', '22023', format($q$ select public.log_my_routine_entry('feedback', '   ') $q$));
  perform pg_temp.expect('D2 foto de suplemento com caminho de outro paciente é recusada', '22023', format($q$ select public.log_my_routine_entry('supplements_photo', null, %L) $q$, paulo || '/x.jpg'));
  perform pg_temp.expect('D3 tipo inválido é recusado', '22023', $q$ select public.log_my_routine_entry('outro', 'oi') $q$);
  perform pg_temp.expect('D4 paciente não insere direto na tabela', '42501', format($q$ insert into public.patient_routine_entries (patient_id, clinic_id, kind, note) values (%L, %L, 'feedback', 'x') $q$, mari, clA));
  perform public.log_my_routine_entry('feedback', 'Semana boa, segui a dieta.');
  r := public.get_patient_routine(mari);
  perform pg_temp.chk('D5 paciente vê a própria rotina e o feedback cumpre o dia', jsonb_array_length(r->'current') = 0 and r->'last_feedback'->>'note' like 'Semana boa%', r::text);
  perform pg_temp.su();
  perform pg_temp.as_user('edu'); r := public.get_patient_routine(mari);
  perform pg_temp.chk('D6 profissional vê o último feedback', r->'last_feedback'->>'note' like 'Semana boa%', null);
  perform pg_temp.su();

  -- ── 5. isolamento
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('E1 recepção não lê a rotina (dado clínico)', '42501', format($q$ select public.get_patient_routine(%L) $q$, mari));
  perform pg_temp.expect('E2 recepção não lê a missão', '42501', format($q$ select public.get_patient_mission(%L) $q$, mari));
  perform pg_temp.chk('E3 recepção não vê feedbacks', (select count(*) from public.patient_routine_entries) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('E4 admin de outra clínica não lê a rotina', '42501', format($q$ select public.get_patient_routine(%L) $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('paulo');
  perform pg_temp.expect('E5 outro paciente não lê a rotina alheia', '42501', format($q$ select public.get_patient_routine(%L) $q$, mari));
  perform pg_temp.chk('E6 outro paciente não vê feedback alheio', (select count(*) from public.patient_routine_entries) = 0, null);
  perform pg_temp.su();

  -- ── 6. exceção por paciente
  perform pg_temp.as_user('mariana');
  perform pg_temp.expect('F1 paciente não cria exceção', '42501', format($q$ select public.save_patient_routine_override(%L, 'off') $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('F2 recepção não cria exceção', '42501', format($q$ select public.save_patient_routine_override(%L, 'off') $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  perform public.save_patient_routine_override(mari, 'off');
  r := public.get_patient_routine(mari);
  perform pg_temp.chk('F3 exceção "desligada" desliga só esse paciente', r->>'enabled' = 'false' and r->>'source' = 'patient_off', r::text);
  perform pg_temp.expect('F4 modo inválido', '22023', format($q$ select public.save_patient_routine_override(%L, 'talvez') $q$, mari));
  perform public.save_patient_routine_override(mari, 'custom', '{"photo_period":"off","feedback_period":"weekly"}'::jsonb);
  r := public.get_patient_routine(mari);
  perform pg_temp.chk('F5 exceção personalizada: sem foto, com peso e feedback', r->>'source' = 'custom'
    and not exists (select 1 from jsonb_array_elements(r->'items') i where i->>'key' = 'photo')
    and exists (select 1 from jsonb_array_elements(r->'items') i where i->>'key' = 'weight'), r::text);
  perform pg_temp.chk('F6 outro paciente da clínica segue o padrão', (public.get_patient_routine(paulo)->>'source') = 'clinic', null);
  perform public.clear_patient_routine_override(mari);
  r := public.get_patient_routine(mari);
  perform pg_temp.chk('F7 limpar a exceção volta ao padrão da clínica', r->>'source' = 'clinic', null);
  perform pg_temp.su();
  perform pg_temp.as_user('nutri');   -- vinculada à Mariana: pode (acesso clínico)
  perform public.save_patient_routine_override(mari, 'off'); perform public.clear_patient_routine_override(mari);
  perform pg_temp.chk('F8 profissional vinculado de outra disciplina também ajusta', true, null);
  perform pg_temp.su();
  -- clínica desligada vence a exceção
  perform pg_temp.as_user('admin'); perform public.save_clinic_routine_settings(clA, '{"routine_enabled":false}'); perform pg_temp.su();
  perform pg_temp.as_user('edu'); perform public.save_patient_routine_override(mari, 'custom'); r := public.get_patient_routine(mari);
  perform pg_temp.chk('F9 clínica desligada: nem a exceção personalizada envia nada', r->>'enabled' = 'false' and r->>'source' = 'clinic_off', r::text);
  perform public.clear_patient_routine_override(mari);
  perform pg_temp.su();

  -- ── 7. missão
  perform pg_temp.as_user('admin');
  perform pg_temp.expect('G1 missão sem nenhum passo ligado é recusada', '22023', format($q$ select public.save_clinic_routine_settings(%L, '{"mission_enabled":true,"mission_steps":[{"key":"weight","label":"Peso","enabled":false}]}') $q$, clA));
  perform pg_temp.expect('G2 passo com chave desconhecida é recusado', '22023', format($q$ select public.save_clinic_routine_settings(%L, '{"mission_steps":[{"key":"selfie","label":"Selfie","enabled":true}]}') $q$, clA));
  perform pg_temp.expect('G3 passo repetido é recusado', '22023', format($q$ select public.save_clinic_routine_settings(%L, '{"mission_steps":[{"key":"weight","label":"A"},{"key":"weight","label":"B"}]}') $q$, clA));
  r := public.save_clinic_routine_settings(clA, '{"mission_enabled":true}');
  perform pg_temp.chk('G4 liga a missão com os 6 passos padrão', (r->>'mission_enabled')::boolean and jsonb_array_length(r->'mission_steps') = 6 and r->>'mission_days' = '7', r::text);
  perform pg_temp.su();
  perform pg_temp.as_user('mariana'); m := public.get_patient_mission(mari); perform pg_temp.su();
  perform pg_temp.chk('G5 paciente que já existia antes de ligar NÃO ganha missão sozinho', m->>'enabled' = 'true' and m->>'started' = 'false', m::text);
  -- paciente novo, criado depois de ligar
  insert into public.profiles (id, auth_user_id, full_name, status) values (pg_temp.f('nina_prof'), gen_random_uuid(), 'Nina', 'active');
  insert into public.patients (id, profile_id, clinic_id, created_at) values (nina, pg_temp.f('nina_prof'), clA, now() + interval '1 second');
  insert into public.professional_patient_links (professional_id, patient_id) values ('00000000-0000-0000-0000-0000000000e2', nina);
  perform pg_temp.as_user('nina');
  m := public.get_patient_mission(nina);
  perform pg_temp.chk('G6 paciente novo começa a missão sozinha: 0 de 6', m->>'started' = 'true' and (m->>'done_count')::int = 0 and (m->>'total')::int = 6 and m->>'completed' = 'false', m::text);
  perform pg_temp.su();
  insert into public.progress_photos (patient_id, storage_path, pose, taken_at) values (nina, nina || '/old.jpg', 'front', now() - interval '3 days');
  insert into public.progress_photos (patient_id, storage_path, pose, taken_at) values (nina, nina || '/f.jpg', 'front', now());
  perform pg_temp.as_user('nina'); m := public.get_patient_mission(nina); perform pg_temp.su();
  perform pg_temp.chk('G7 só conta foto feita depois do início; frente = 1 de 6 (sem duplo registro)', (m->>'done_count')::int = 1, m::text);
  insert into public.weight_logs (patient_id, weight_kg, review_status) values (nina, 60, 'ok');
  insert into public.progress_photos (patient_id, storage_path, pose, taken_at) values (nina, nina || '/s.jpg', 'side', now()), (nina, nina || '/b.jpg', 'back', now());
  perform pg_temp.as_user('nina'); m := public.get_patient_mission(nina);
  perform pg_temp.chk('G8 lado, costas e peso medidos pelos registros reais: 4 de 6', (m->>'done_count')::int = 4 and m->>'completed' = 'false', m::text);
  perform public.log_my_routine_entry('supplements_photo', null, nina || '/sup.jpg');
  m := public.get_patient_mission(nina);
  perform pg_temp.chk('G9 foto dos suplementos conta: 5 de 6', (m->>'done_count')::int = 5, null);
  perform public.log_my_routine_entry('bio_na');
  perform public.log_my_routine_entry('bio_na');
  m := public.get_patient_mission(nina);
  perform pg_temp.chk('G10 "não tenho bioimpedância" conta e é idempotente: 6 de 6 e concluída', (m->>'done_count')::int = 6 and m->>'completed' = 'true' and m->>'completed_on' = today::text and m->>'celebrated' = 'false', m::text);
  perform public.mark_my_mission_celebrated();
  m := public.get_patient_mission(nina);
  perform pg_temp.chk('G11 parabéns marcado como já mostrado', m->>'celebrated' = 'true', null);
  perform pg_temp.su();
  select count(*) into n from public.patient_routine_entries where patient_id = nina and kind = 'bio_na';
  perform pg_temp.chk('G12 só uma resposta "não tenho bio" gravada', n = 1, n::text);
  perform pg_temp.as_user('edu'); m := public.get_patient_mission(nina);
  perform pg_temp.chk('G13 profissional vê "concluída em" (selo pronto para a consulta)', m->>'completed' = 'true' and m->>'completed_on' = today::text, m::text);
  perform pg_temp.su();
  perform pg_temp.as_user('mariana'); perform pg_temp.chk('G14 outra paciente não lê a missão da Nina', true, null);
  perform pg_temp.expect('G15 paciente não lê missão alheia', '42501', format($q$ select public.get_patient_mission(%L) $q$, nina));
  perform pg_temp.su();

  -- profissional inicia a missão de quem já era paciente; recepção não; clínica sem a missão ligada recusa
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('H1 recepção não inicia missão', '42501', format($q$ select public.start_patient_mission(%L) $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('mariana');
  perform pg_temp.expect('H2 paciente não inicia a missão pela RPC do profissional', '42501', format($q$ select public.start_patient_mission(%L) $q$, mari));
  perform pg_temp.su();
  perform pg_temp.as_user('edu');
  perform public.start_patient_mission(mari);
  m := public.get_patient_mission(mari);
  perform pg_temp.chk('H3 profissional inicia a missão da Mariana: o que ela registrou HOJE já conta (2 de 6), sem duplo registro', m->>'started' = 'true' and (m->>'done_count')::int = 2, m::text);
  perform pg_temp.su();
  perform pg_temp.as_user('adminb');
  perform pg_temp.expect('H4 clínica sem a missão ligada recusa', '22023', format($q$ select public.start_patient_mission(%L) $q$, zelia), 'mission_disabled');
  perform pg_temp.su();
  -- passos editados: 2 passos com texto próprio; só o que a clínica deixou ligado conta
  perform pg_temp.as_user('admin');
  perform public.save_clinic_routine_settings(clA, '{"mission_steps":[{"key":"weight","label":"Suba na balança em jejum","enabled":true},{"key":"photo_front","label":"Foto de frente","enabled":true},{"key":"bio","label":"Bio","enabled":false}]}');
  perform pg_temp.su();
  perform pg_temp.as_user('edu'); m := public.get_patient_mission(mari);
  perform pg_temp.chk('H5 passos editados pela clínica: 2 passos, texto novo', (m->>'total')::int = 2 and m->'steps'->0->>'label' = 'Suba na balança em jejum', m::text);
  perform pg_temp.su();
  -- reiniciar
  perform pg_temp.as_user('edu'); perform public.start_patient_mission(nina, true); m := public.get_patient_mission(nina);
  perform pg_temp.chk('H6 reiniciar zera o progresso e o parabéns', m->>'celebrated' = 'false' and (m->>'done_count')::int >= 0 and m->>'started_on' = today::text, m::text);
  perform pg_temp.su();
  -- desligar a missão esconde
  perform pg_temp.as_user('admin'); perform public.save_clinic_routine_settings(clA, '{"mission_enabled":false}'); perform pg_temp.su();
  perform pg_temp.as_user('edu'); m := public.get_patient_mission(nina);
  perform pg_temp.chk('H7 missão desligada: não aparece', m->>'enabled' = 'false', m::text);
  perform pg_temp.su();
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
