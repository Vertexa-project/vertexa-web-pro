-- Prova SQL da A8 (rascunho de dieta e treino pela Vertexa IA) num Postgres LOCAL descartável. Uso: scripts/a8-sql-proof.sh
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
grant select on public.professionals, public.professional_patient_links to authenticated;
-- como em produção, o admin da clínica também tem linha em professionals (clinic_role = 'admin')
insert into public.professionals (id, profile_id, clinic_id, clinic_role) values
 ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ca01', 'admin'),
 ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000cb01', 'admin');

-- ───────── QUEM PODE GERAR (disciplina + vínculo clínico)
do $t$
declare mari uuid := pg_temp.f('mari'); zelia uuid := pg_temp.f('zelia'); r record;
begin
  for r in select * from (values
    ('nutri', 'dieta', true), ('nutri', 'treino', false), ('edu', 'treino', true), ('edu', 'dieta', false),
    ('admin', 'dieta', false), ('admin', 'treino', false), ('medico', 'dieta', false), ('medico', 'treino', false),
    ('recep', 'dieta', false), ('recep', 'treino', false), ('mariana', 'dieta', false), ('mariana', 'treino', false)) as x(who, kind, expected) loop
    perform pg_temp.as_user(r.who);
    perform pg_temp.chk(format('G %s gera %s = %s', r.who, r.kind, r.expected), public.plan_draft_can_generate(mari, r.kind) = r.expected, null);
    perform pg_temp.su();
  end loop;
  perform pg_temp.as_user('nutri');
  perform pg_temp.chk('G nutricionista NÃO gera para paciente de outra clínica', not public.plan_draft_can_generate(zelia, 'dieta'), null);
  perform pg_temp.chk('G tipo desconhecido nunca pode', not public.plan_draft_can_generate(mari, 'outro'), null);
  perform pg_temp.su();
end $t$;

-- ───────── RASCUNHOS: fora dos planos, só a equipe clínica lê, só a Edge Function (service_role) escreve
do $t$
declare mari uuid := pg_temp.f('mari'); clin uuid := '00000000-0000-0000-0000-00000000ca01'; d1 uuid; n int; planos_antes int; planos_depois int;
begin
  select count(*) into planos_antes from public.workout_plans where patient_id = mari;
  -- (como a Edge Function, que usa service_role = dono do banco aqui)
  insert into public.ai_plan_drafts (clinic_id, patient_id, kind, patient_type, patient_type_label, mode, payload, created_by)
  values (clin, mari, 'dieta', 'emagrecimento', 'Emagrecimento / acima do peso', 'demo', '{"title":"x"}', '00000000-0000-0000-0000-0000000000a3') returning id into d1;
  insert into public.ai_plan_drafts (clinic_id, patient_id, kind, patient_type, patient_type_label, mode, payload)
  values (clin, mari, 'treino', 'emagrecimento', 'Emagrecimento / acima do peso', 'demo', '{"title":"y"}');
  select count(*) into planos_depois from public.workout_plans where patient_id = mari;
  perform pg_temp.chk('R1 gerar rascunho NÃO mexe no plano publicado (workout_plans igual)', planos_antes = planos_depois and planos_depois = 1, null);
  perform pg_temp.expect('R2 só 1 rascunho pendente por paciente e tipo', '23505', format($q$ insert into public.ai_plan_drafts (clinic_id, patient_id, kind, patient_type, patient_type_label, mode, payload) values (%L, %L, 'dieta', 'x1', 'Tipo X', 'demo', '{}') $q$, clin, mari));
  update public.ai_plan_drafts set status = 'substituido' where id = d1;
  insert into public.ai_plan_drafts (clinic_id, patient_id, kind, patient_type, patient_type_label, mode, payload) values (clin, mari, 'dieta', 'hipertrofia', 'Hipertrofia', 'demo', '{"title":"z"}');
  perform pg_temp.chk('R3 depois de substituir, novo pendente entra', (select count(*) from public.ai_plan_drafts where patient_id = mari and kind = 'dieta' and status = 'pendente') = 1, null);
  perform pg_temp.expect('R4 modo inválido é recusado', '23514', format($q$ insert into public.ai_plan_drafts (clinic_id, patient_id, kind, patient_type, patient_type_label, mode, payload) values (%L, %L, 'treino', 'x2', 'Tipo', 'magia', '{}') $q$, clin, mari));

  perform pg_temp.as_user('nutri');
  select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R5 nutricionista vinculada lê os rascunhos do paciente', n = 3, n::text);
  perform pg_temp.expect('R6 profissional não grava direto na tabela', '42501', format($q$ insert into public.ai_plan_drafts (clinic_id, patient_id, kind, patient_type, patient_type_label, mode, payload) values (%L, %L, 'treino', 'x3', 'T', 'demo', '{}') $q$, clin, mari));
  perform pg_temp.expect('R7 profissional não edita direto', '42501', $q$ update public.ai_plan_drafts set status = 'usado' $q$);
  perform pg_temp.expect('R8 profissional não apaga direto', '42501', $q$ delete from public.ai_plan_drafts $q$);
  perform pg_temp.su();
  perform pg_temp.as_user('admin'); select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R9 admin da clínica lê', n = 3, n::text); perform pg_temp.su();
  perform pg_temp.as_user('recep'); select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R10 Recepção NÃO vê rascunho', n = 0, n::text); perform pg_temp.su();
  perform pg_temp.as_user('mariana'); select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R11 o PACIENTE não vê o rascunho', n = 0, n::text);
  perform pg_temp.chk('R12 e continua vendo o plano já publicado', (select count(*) from public.workout_plans) = 1, null); perform pg_temp.su();
  perform pg_temp.as_user('adminb'); select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R13 admin de OUTRA clínica não vê', n = 0, n::text); perform pg_temp.su();
  perform pg_temp.as_user('edu'); select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R14 educador vinculado lê (acesso clínico)', n = 3, n::text); perform pg_temp.su();
  perform pg_temp.as_user('medico'); select count(*) into n from public.ai_plan_drafts; perform pg_temp.chk('R15 médico vinculado lê', n = 3, n::text); perform pg_temp.su();
  perform pg_temp.as_user('paulo');
end $t$;
select pg_temp.su();

-- ───────── CONFIGURAÇÃO DA CLÍNICA (tipos de paciente e método)
do $t$
declare ok jsonb := '[{"key":"gestante","label":"Gestante","base":"retomada","hint":"cuidado"},{"key":"emag","label":"Emagrecimento","base":"emagrecimento"}]'; n int;
begin
  perform pg_temp.as_user('admin');
  perform public.save_plan_draft_config(ok, 'Método dieta', 'Método treino');
  perform pg_temp.chk('C1 admin salva tipos e métodos', (select jsonb_array_length(patient_types) = 2 and method_dieta = 'Método dieta' and method_treino = 'Método treino' from public.clinic_plan_draft_config), null);
  perform public.save_plan_draft_config(ok, '  ', null);
  perform pg_temp.chk('C2 salvar de novo atualiza a MESMA linha e vazio vira nulo', (select count(*) = 1 and bool_and(method_dieta is null) from public.clinic_plan_draft_config), null);
  perform pg_temp.expect('C3 base inventada é recusada', '22023', $q$ select public.save_plan_draft_config('[{"key":"abc","label":"Tipo","base":"inventada"}]'::jsonb) $q$);
  perform pg_temp.expect('C4 chave repetida é recusada', '22023', $q$ select public.save_plan_draft_config('[{"key":"abc","label":"Tipo A","base":"retomada"},{"key":"abc","label":"Tipo B","base":"retomada"}]'::jsonb) $q$);
  perform pg_temp.expect('C5 chave com maiúscula/acento é recusada', '22023', $q$ select public.save_plan_draft_config('[{"key":"Ação","label":"Tipo","base":"retomada"}]'::jsonb) $q$);
  perform pg_temp.expect('C6 nome curto demais é recusado', '22023', $q$ select public.save_plan_draft_config('[{"key":"abc","label":"x","base":"retomada"}]'::jsonb) $q$);
  perform pg_temp.expect('C7 lista vazia é recusada', '22023', $q$ select public.save_plan_draft_config('[]'::jsonb) $q$);
  perform pg_temp.expect('C8 método longo demais é recusado', '23514', format($q$ select public.save_plan_draft_config(null, %L) $q$, repeat('x', 4001)));
  perform public.save_plan_draft_config(null);
  perform pg_temp.chk('C9 lista nula = volta ao padrão da reunião', (select patient_types is null from public.clinic_plan_draft_config), null);
  perform public.save_plan_draft_config(ok, 'M1', 'M2');
  perform pg_temp.su();
  perform pg_temp.as_user('nutri');
  perform pg_temp.expect('C10 profissional comum NÃO altera a configuração', '42501', format($q$ select public.save_plan_draft_config(%L::jsonb) $q$, ok::text), 'clinic admin');
  select count(*) into n from public.clinic_plan_draft_config; perform pg_temp.chk('C11 equipe da clínica lê a configuração', n = 1, n::text);
  perform pg_temp.expect('C12 e não escreve direto na tabela', '42501', $q$ update public.clinic_plan_draft_config set method_dieta = 'x' $q$);
  perform pg_temp.su();
  perform pg_temp.as_user('mariana'); select count(*) into n from public.clinic_plan_draft_config; perform pg_temp.chk('C13 paciente não lê a configuração', n = 0, n::text);
  perform pg_temp.expect('C14 paciente não salva configuração', '42501', format($q$ select public.save_plan_draft_config(%L::jsonb) $q$, ok::text)); perform pg_temp.su();
  perform pg_temp.as_user('adminb'); select count(*) into n from public.clinic_plan_draft_config; perform pg_temp.chk('C15 outra clínica não lê', n = 0, n::text);
  perform public.save_plan_draft_config('[{"key":"so_b","label":"Só da clínica B","base":"manutencao"}]'::jsonb);
  perform pg_temp.su();
  perform pg_temp.chk('C16 cada clínica tem a sua linha (não sobrescreve a outra)', (select count(*) from public.clinic_plan_draft_config) = 2 and (select jsonb_array_length(patient_types) from public.clinic_plan_draft_config where clinic_id = '00000000-0000-0000-0000-00000000ca01') = 2, null);
end $t$;

-- ───────── RASTRO (vertexa_ai_events aceita os tipos novos e continua recusando o resto)
do $t$
declare clin uuid := '00000000-0000-0000-0000-00000000ca01';
begin
  perform pg_temp.expect('E1 rastro plano_dieta', null, format($q$ insert into public.vertexa_ai_events (clinic_id, kind, draft_kind, mode) values (%L, 'pedido', 'plano_dieta', 'demo') $q$, clin));
  perform pg_temp.expect('E2 rastro plano_treino', null, format($q$ insert into public.vertexa_ai_events (clinic_id, kind, draft_kind, mode) values (%L, 'pedido', 'plano_treino', 'demo') $q$, clin));
  perform pg_temp.expect('E3 tipo antigo continua valendo', null, format($q$ insert into public.vertexa_ai_events (clinic_id, kind, draft_kind) values (%L, 'pedido', 'mensagem') $q$, clin));
  perform pg_temp.expect('E4 tipo desconhecido continua recusado', '23514', format($q$ insert into public.vertexa_ai_events (clinic_id, kind, draft_kind) values (%L, 'pedido', 'qualquer') $q$, clin));
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
