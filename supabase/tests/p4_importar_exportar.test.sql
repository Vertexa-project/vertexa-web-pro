-- Prova SQL da parte 4 do redesign (importar/exportar pacientes) num Postgres LOCAL descartável. Uso: scripts/p4-sql-proof.sh
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

-- fixture: clínica A (dono = admin; Gestor; Recepção), clínica B (outro dono)
do $t$
declare pa uuid; pg uuid; pr uuid; pb uuid; ca uuid; cb uuid; prog uuid; prr uuid;
begin
  insert into public.profiles (auth_user_id, full_name, status) values (gen_random_uuid(), 'Admin A', 'active') returning id into pa;
  insert into public.profiles (auth_user_id, full_name, status) values (gen_random_uuid(), 'Gestora A', 'active') returning id into pg;
  insert into public.profiles (auth_user_id, full_name, status) values (gen_random_uuid(), 'Recepção A', 'active') returning id into pr;
  insert into public.profiles (auth_user_id, full_name, status) values (gen_random_uuid(), 'Admin B', 'active') returning id into pb;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pa) returning id into ca;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pb) returning id into cb;
  insert into public.professionals (profile_id, clinic_id) values (pg, ca) returning id into prog;
  insert into public.professionals (profile_id, clinic_id) values (pr, ca) returning id into prr;
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values (ca, prog, 'gestor'), (ca, prr, 'recepcao');
  insert into fx values ('prof_admin', pa), ('prof_gestor', pg), ('prof_recep', pr), ('prof_outro', pb), ('ca', ca), ('cb', cb);
end $t$;

do $t$
declare ca uuid := pg_temp.f('ca'); r jsonb; v_n integer; v_batches integer; v_aud integer; st text;
  rows1 jsonb := '[
   {"line":2,"name":"Ana (QA)","email":"ana.qa@dizeops.com","phone":"(17) 9 9812-3344","birth_date":"1990-05-10","sex":"feminino","goal":"Emagrecimento","height_cm":165,"weight_kg":70.5},
   {"line":3,"name":"Bruno (QA)","email":"bruno.qa@dizeops.com","phone":"17998012201","birth_date":"1985-01-02","sex":"masculino","height_cm":180,"weight_kg":90},
   {"line":4,"name":"Clara (QA)","email":"clara.qa@dizeops.com"},
   {"line":5,"name":"Ana Repetida","email":"ANA.QA@dizeops.com"},
   {"line":6,"name":"","email":"sem.nome@dizeops.com"},
   {"line":7,"name":"Email Ruim","email":"nao-e-email"},
   {"line":8,"name":"Futuro","birth_date":"2999-01-01"},
   {"line":9,"name":"Peso Ruim","weight_kg":5},
   {"line":10,"name":"Fone Ruim","phone":"123"}]'::jsonb;
begin
  -- admin importa: 3 entram, 1 repetido no arquivo, 5 com erro
  perform pg_temp.as_user('admin');
  r := public.import_patients(ca, 'pacientes_teste.csv', rows1);
  perform pg_temp.su();
  perform pg_temp.chk('I1 admin: 3 importados, 1 duplicado (e-mail repetido no arquivo, sem diferenciar maiúsculas), 5 erros',
    (r->>'imported')::int = 3 and (r->>'duplicates')::int = 1 and (r->>'errors')::int = 5, r::text);
  perform pg_temp.chk('I2 erros por motivo: nome, email, nascimento, peso, telefone',
    (select array_agg(x->>'reason' order by (x->>'line')::int) from jsonb_array_elements(r->'results') x where x->>'status' = 'erro') = array['nome','email','nascimento','peso','telefone'], r::text);
  select count(*) into v_n from public.patients where clinic_id = ca;
  perform pg_temp.chk('I3 3 pacientes na clínica, cada um com vínculo ao admin só se ele for profissional (admin dono sem linha: 0 vínculos)', v_n = 3, v_n::text);
  perform pg_temp.chk('I4 origem "pacientes_teste.csv" gravada para os 3, telefone só dígitos como chave',
    (select count(*) from public.patient_import_origin where clinic_id = ca and source_filename = 'pacientes_teste.csv') = 3
    and exists (select 1 from public.patient_import_origin where phone_key = '17998123344'), null);
  perform pg_temp.chk('I5 lote registrado (importados 3, duplicados 1, erros 5)',
    exists (select 1 from public.patient_import_batches where clinic_id = ca and imported_count = 3 and duplicate_count = 1 and error_count = 5 and total_rows = 9), null);

  -- reimportar: o servidor rechecou duplicado contra a base
  perform pg_temp.as_user('admin');
  r := public.import_patients(ca, 'de_novo.csv', '[
   {"line":2,"name":"Outra Pessoa","email":"bruno.qa@dizeops.com"},
   {"line":3,"name":"Telefone Igual","phone":"+55 17 99812-3344"},
   {"line":4,"name":"ana (qa)","birth_date":"1990-05-10"},
   {"line":5,"name":"Nova Pessoa","email":"nova.qa@dizeops.com"}]'::jsonb);
  perform pg_temp.su();
  perform pg_temp.chk('I6 duplicado na base: e-mail, telefone (+55 e máscara) e nome+nascimento ficam de fora; nova entra',
    (r->>'imported')::int = 1 and (r->>'duplicates')::int = 3
    and (select array_agg(x->>'reason' order by (x->>'line')::int) from jsonb_array_elements(r->'results') x where x->>'status' = 'duplicado') = array['email','telefone','nome_nascimento'], r::text);

  -- force libera telefone / nome+nascimento, nunca e-mail
  perform pg_temp.as_user('admin');
  r := public.import_patients(ca, 'forcado.csv', '[
   {"line":2,"name":"Telefone Igual","phone":"17998123344","force":true},
   {"line":3,"name":"Ana (QA)","birth_date":"1990-05-10","force":true},
   {"line":4,"name":"Email Forcado","email":"bruno.qa@dizeops.com","force":true}]'::jsonb);
  perform pg_temp.su();
  perform pg_temp.chk('I7 "importar mesmo assim" libera telefone e nome+nascimento, mas e-mail repetido nunca entra',
    (r->>'imported')::int = 2 and (r->>'duplicates')::int = 1
    and (select x->>'reason' from jsonb_array_elements(r->'results') x where x->>'status' = 'duplicado') = 'email', r::text);

  -- atômico: linha com dado quebrado no fim desfaz o lote inteiro
  select count(*) into v_n from public.patients where clinic_id = ca;
  select count(*) into v_batches from public.patient_import_batches where clinic_id = ca;
  perform pg_temp.as_user('admin');
  perform pg_temp.expect('I8 lote com linha quebrada falha inteiro', '22P02',
    $q$ select public.import_patients(pg_temp.f('ca'), 'quebrado.csv', '[{"line":2,"name":"Entra Mas Desfaz"},{"line":"abc","name":"Quebra"}]'::jsonb) $q$);
  perform pg_temp.su();
  perform pg_temp.chk('I9 nada ficou gravado do lote que falhou (pacientes e lote iguais ao antes)',
    (select count(*) from public.patients where clinic_id = ca) = v_n and (select count(*) from public.patient_import_batches where clinic_id = ca) = v_batches, null);

  -- limites
  perform pg_temp.as_user('admin');
  perform pg_temp.expect('I10 mais de 500 linhas recusado', '22023',
    $q$ select public.import_patients(pg_temp.f('ca'), 'grande.csv', (select jsonb_agg(jsonb_build_object('line', g, 'name', 'X ' || g)) from generate_series(1, 501) g)) $q$, 'too many rows');
  perform pg_temp.expect('I11 lote vazio recusado', '22023', $q$ select public.import_patients(pg_temp.f('ca'), 'vazio.csv', '[]'::jsonb) $q$);
  perform pg_temp.expect('I12 sem nome de arquivo recusado', '22023', $q$ select public.import_patients(pg_temp.f('ca'), '  ', '[{"line":2,"name":"A"}]'::jsonb) $q$);
  perform pg_temp.su();

  -- permissão de importar: só admin da clínica
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('P1 Gestor (não admin) não importa', '42501', $q$ select public.import_patients(pg_temp.f('ca'), 'x.csv', '[{"line":2,"name":"A"}]'::jsonb) $q$, 'PATIENT_IMPORT_ADMIN_REQUIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('P2 Recepção não importa', '42501', $q$ select public.import_patients(pg_temp.f('ca'), 'x.csv', '[{"line":2,"name":"A"}]'::jsonb) $q$, 'PATIENT_IMPORT_ADMIN_REQUIRED');
  perform pg_temp.expect('P3 Recepção não lê as chaves de duplicado', '42501', $q$ select public.patient_import_dedupe_keys(pg_temp.f('ca')) $q$);
  perform pg_temp.su();
  perform pg_temp.as_user('outro');
  perform pg_temp.expect('P4 admin de OUTRA clínica não importa na clínica A', '42501', $q$ select public.import_patients(pg_temp.f('ca'), 'x.csv', '[{"line":2,"name":"A"}]'::jsonb) $q$, 'PATIENT_IMPORT_ADMIN_REQUIRED');
  perform pg_temp.su();
  perform set_config('request.jwt.claims', '{}', true); execute 'set local role authenticated';
  perform pg_temp.expect('P5 sem sessão não importa', '42501', $q$ select public.import_patients(pg_temp.f('ca'), 'x.csv', '[{"line":2,"name":"A"}]'::jsonb) $q$);
  perform pg_temp.su();
  perform pg_temp.chk('P6 negados não deixaram rastro (3+1+2=6 pacientes na clínica A)', (select count(*) from public.patients where clinic_id = ca) = 6, null);

  -- chaves para a prévia
  perform pg_temp.as_user('admin');
  r := public.patient_import_dedupe_keys(ca);
  perform pg_temp.su();
  perform pg_temp.chk('K1 chaves da clínica A: 6 pacientes, com e-mail em minúsculas e telefone normalizado',
    jsonb_array_length(r) = 6 and exists (select 1 from jsonb_array_elements(r) x where x->>'email' = 'ana.qa@dizeops.com' and x->>'phone_key' = '17998123344'), r::text);

  -- RLS das tabelas novas
  perform pg_temp.as_user('admin');
  perform pg_temp.chk('R1 admin lê origem e lotes', (select count(*) from public.patient_import_origin) = 6 and (select count(*) from public.patient_import_batches) >= 3, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.chk('R2 Recepção não lê origem nem lotes', (select count(*) from public.patient_import_origin) = 0 and (select count(*) from public.patient_import_batches) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('outro');
  perform pg_temp.chk('R3 admin de outra clínica não lê origem da clínica A', (select count(*) from public.patient_import_origin) = 0, null);
  perform pg_temp.expect('R4 ninguém grava origem direto', '42501', $q$ insert into public.patient_import_origin (patient_id, clinic_id, batch_id, source_filename) select null, null, null, 'x' $q$);
  perform pg_temp.su();
end $t$;

-- ---- exportar ----
do $t$
declare ca uuid := pg_temp.f('ca'); r jsonb; v_aud integer; v_cnt integer;
begin
  -- paciente "removido" (anonimizado) fica fora; um com peso e adesão para as colunas
  update public.profiles set status = 'inactive' where full_name = 'Email Forcado' or full_name = 'Nova Pessoa';
  insert into public.weight_logs (patient_id, weight_kg, measured_at) select id, 68.2, '2026-11-10 12:00-03' from public.patients where clinic_id = ca limit 1;

  perform pg_temp.as_user('admin');
  r := public.export_patients(ca, array['cadastro','contato'], 'backup', 'Backup mensal da clínica');
  perform pg_temp.su();
  select count(*) into v_cnt from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.clinic_id = ca and pr.status <> 'inactive';
  perform pg_temp.chk('E1 admin exporta: linhas = pacientes ativos (removidos fora)', (r->>'row_count')::int = v_cnt and jsonb_array_length(r->'rows') = v_cnt, r->>'row_count');
  perform pg_temp.chk('E2 só os grupos pedidos saem (cadastro+contato; sem medidas, sem adesão, sem prontuário)',
    (r->'rows'->0) ? 'email' and (r->'rows'->0) ? 'nascimento' and not ((r->'rows'->0) ? 'peso_atual') and not ((r->'rows'->0) ? 'status') and not ((r->'rows'->0) ? 'prontuario'), (r->'rows'->0)::text);
  perform pg_temp.chk('E3 auditoria gravada junto: quem, motivo, grupos e quantidade (sem os dados)',
    exists (select 1 from public.patient_exports where id = (r->>'export_id')::uuid and actor_name = 'Admin A' and reason_kind = 'backup'
              and reason_text = 'Backup mensal da clínica' and fields = array['cadastro','contato'] and row_count = v_cnt), null);
  perform pg_temp.chk('E4 a auditoria não tem coluna de dado exportado',
    not exists (select 1 from information_schema.columns where table_name = 'patient_exports' and column_name in ('rows','payload','data','csv','content')), null);

  perform pg_temp.as_user('gestor');
  r := public.export_patients(ca, array['medidas','adesao'], 'auditoria', 'Conferência trimestral');
  perform pg_temp.su();
  perform pg_temp.chk('E5 Gestor (não admin) exporta medidas e adesão; peso vem da última medida', (r->>'row_count')::int = v_cnt
    and exists (select 1 from jsonb_array_elements(r->'rows') x where (x->>'peso_atual')::numeric = 68.2 and x->>'ultima_medida' = '2026-11-10'), r->'rows'->>0);

  -- recusas: nenhuma deixa auditoria nem linhas
  select count(*) into v_aud from public.patient_exports;
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('E6 Recepção não exporta', '42501', $q$ select public.export_patients(pg_temp.f('ca'), array['cadastro'], 'backup', 'Backup mensal') $q$, 'PATIENT_EXPORT_MANAGER_REQUIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('outro');
  perform pg_temp.expect('E7 admin de outra clínica não exporta a clínica A', '42501', $q$ select public.export_patients(pg_temp.f('ca'), array['cadastro'], 'backup', 'Backup mensal') $q$);
  perform pg_temp.su();
  perform pg_temp.as_user('admin');
  perform pg_temp.expect('E8 sem motivo (texto curto) recusado', '22023', $q$ select public.export_patients(pg_temp.f('ca'), array['cadastro'], 'backup', '  abc ') $q$, null);
  perform pg_temp.expect('E9 sem tipo de motivo recusado', '22023', $q$ select public.export_patients(pg_temp.f('ca'), array['cadastro'], null, 'Backup mensal') $q$);
  perform pg_temp.expect('E10 tipo de motivo fora da lista recusado', '22023', $q$ select public.export_patients(pg_temp.f('ca'), array['cadastro'], 'curiosidade', 'Backup mensal') $q$);
  perform pg_temp.expect('E11 prontuário não é um grupo exportável', '22023', $q$ select public.export_patients(pg_temp.f('ca'), array['cadastro','prontuario'], 'backup', 'Backup mensal') $q$);
  perform pg_temp.expect('E12 nenhum grupo recusado', '22023', $q$ select public.export_patients(pg_temp.f('ca'), array[]::text[], 'backup', 'Backup mensal') $q$);
  perform pg_temp.su();
  perform pg_temp.chk('E13 as recusas não gravaram auditoria', (select count(*) from public.patient_exports) = v_aud, null);

  -- imutável e lista só do admin
  perform pg_temp.expect('A1 nem o dono do banco edita uma exportação registrada', '42501', $q$ update public.patient_exports set row_count = 0 $q$);
  perform pg_temp.as_user('admin');
  perform pg_temp.expect('A2 admin não edita a auditoria', '42501', $q$ update public.patient_exports set reason_text = 'outro motivo qualquer' $q$);
  perform pg_temp.expect('A3 admin não apaga a auditoria', '42501', $q$ delete from public.patient_exports $q$);
  perform pg_temp.expect('A4 admin não insere auditoria direto', '42501', $q$ insert into public.patient_exports (clinic_id, reason_kind, reason_text, fields, row_count) values (pg_temp.f('ca'), 'backup', 'Inventado sem exportar', array['cadastro'], 0) $q$);
  perform pg_temp.chk('A5 admin lê a lista de Exportações (2)', (select count(*) from public.patient_exports) = 2, null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('A6 Gestor não lê a lista de auditoria (só admin)', (select count(*) from public.patient_exports) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('outro');
  perform pg_temp.chk('A7 admin de outra clínica não lê a auditoria da clínica A', (select count(*) from public.patient_exports) = 0, null);
  perform pg_temp.su();
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
