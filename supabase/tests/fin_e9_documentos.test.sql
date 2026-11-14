-- Prova SQL da FIN-E9 (documentos clínicos com provedor em modo demonstração) num Postgres LOCAL descartável (fixture própria; dados 100% sintéticos, nenhum dado de saúde real).
-- Uso: scripts/fin-e9-sql-proof.sh  (cria o cluster/banco, aplica stub + E1..E9, roda este arquivo e apaga tudo).
-- Roda dentro de begin ... rollback; a última consulta lista as asserções (ok=false = falha).
begin;
create temp table tr (n serial, name text, ok boolean, detail text);
create temp table fx (k text primary key, v uuid);
grant all on tr, fx to authenticated, service_role, anon; grant usage, select on sequence tr_n_seq to authenticated, service_role, anon;

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
-- abre sessão como o usuário atual e devolve o id
create function pg_temp.open(p_type text, p_patient text default 'pat', p_enc text default null, p_appt text default null) returns uuid language sql as $$
  select (public.doc_open_session(pg_temp.f('c'), pg_temp.f(p_patient), p_type, case when p_enc is null then null else pg_temp.f(p_enc) end,
                                  case when p_appt is null then null else pg_temp.f(p_appt) end)->>'session_id')::uuid $$;
create function pg_temp.rx_items() returns jsonb language sql as $$
  select '[{"name":"Semaglutida 1 mg/mL","dose":"0,25 mg","posology":"1 aplicação por semana","quantity":"1 caneta"}]'::jsonb $$;
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text),
  pg_temp.open(text, text, text, text), pg_temp.rx_items() to public;

-- ---------- Fixture (nomes e dados fictícios) ----------
do $t$
declare c uuid; c2 uuid; k text; pid uuid; pro uuid; v_pat uuid; v_pat2 uuid; v_patb uuid; v_svc uuid; v_unit uuid; v_enc uuid; v_enc2 uuid; v_appt uuid; v_id uuid;
begin
  foreach k in array array['owner','pro','pronoreg','pro2','gestor','fin','recep','estoq','other','patu','patu2'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'Fulano ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica Fictícia A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica Fictícia B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  insert into public.professionals (profile_id, clinic_id, clinic_role, type) values (pg_temp.f('prof_owner'), c, 'admin', 'other') returning id into pro; insert into fx values ('pro_owner', pro);
  insert into public.professionals (profile_id, clinic_id, type, registry_number, specialty) values (pg_temp.f('prof_pro'), c, 'nutritionist', 'CRN-3 000001', 'Nutrição clínica') returning id into pro; insert into fx values ('pro_pro', pro);
  insert into public.professionals (profile_id, clinic_id, type, registry_number) values (pg_temp.f('prof_pronoreg'), c, 'nutritionist', null) returning id into pro; insert into fx values ('pro_pronoreg', pro);
  insert into public.professionals (profile_id, clinic_id, type, registry_number) values (pg_temp.f('prof_pro2'), c, 'physician', 'CRM-SP 000002') returning id into pro; insert into fx values ('pro_pro2', pro);
  foreach k in array array['gestor','fin','recep','estoq'] loop
    insert into public.professionals (profile_id, clinic_id, type) values (pg_temp.f('prof_' || k), c, 'other') returning id into pro; insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role, type) values (pg_temp.f('prof_other'), c2, 'admin', 'other');
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values
    (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_fin'), 'financeiro'), (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_estoq'), 'estoquista');
  -- pacientes: pat e pat2 da clínica A (pro e pronoreg atendem pat; pro2 atende pat2), patb da clínica B; patu = conta do paciente 'pat'
  insert into public.patients (profile_id, clinic_id, birth_date) values (pg_temp.f('prof_patu'), c, date '1990-05-17') returning id into v_pat; insert into fx values ('pat', v_pat);
  insert into public.patients (profile_id, clinic_id, birth_date) values (pg_temp.f('prof_patu2'), c, date '1985-01-02') returning id into v_pat2; insert into fx values ('pat2', v_pat2);
  insert into public.profiles (full_name) values ('Paciente B') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c2) returning id into v_patb; insert into fx values ('patb', v_patb);
  insert into public.care_team values (v_pat, pg_temp.f('prof_pro')), (v_pat, pg_temp.f('prof_pronoreg')), (v_pat2, pg_temp.f('prof_pro2'));
  -- atendimento clínico (consulta) e atendimento do financeiro
  insert into public.clinical_encounters (clinic_id, patient_id, professional_id) values (c, v_pat, pg_temp.f('pro_pro')) returning id into v_enc; insert into fx values ('enc', v_enc);
  insert into public.clinical_encounters (clinic_id, patient_id, professional_id) values (c, v_pat2, pg_temp.f('pro_pro2')) returning id into v_enc2; insert into fx values ('enc2', v_enc2);
  select id into v_unit from public.clinic_units where clinic_id = c and is_primary;
  insert into public.fin_services (clinic_id, name, category, default_price_cents) values (c, 'Consulta', 'consulta', 10000) returning id into v_svc;
  insert into public.fin_appointments (clinic_id, unit_id, patient_id, service_id, service_name, performed_on, encounter_id) values (c, v_unit, v_pat, v_svc, 'Consulta', current_date, v_enc) returning id into v_appt; insert into fx values ('appt', v_appt);
  -- estoque da clínica (para a sugestão): medicamento, material e item de outra clínica
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c, 'Semaglutida', 'caneta', 'medication', 'un', 'caneta', 'dose', true) returning id into v_id; insert into fx values ('it_sema', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Dipirona gotas', 'mat', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_dip', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c2, 'Tirzepatida', 'caneta', 'medication', 'un', 'un', 'un', true);
end $t$;

-- ---------- A. Acesso (doc_my_access e fin_my_access) ----------
do $t$
declare c uuid := pg_temp.f('c'); j jsonb; f jsonb;
begin
  perform pg_temp.as_user('pro'); j := public.doc_my_access(c); f := public.fin_my_access(c);
  perform pg_temp.chk('A1 profissional com registro: emite, lista, vê conteúdo, reenvia', (j->>'can_emit')::boolean and (j->>'can_list')::boolean and (j->>'can_content')::boolean and (j->>'can_resend')::boolean and j->>'kind' = 'clinical', j::text);
  perform pg_temp.chk('A2 fin_my_access traz as chaves doc_* e preserva as antigas', (f->'can'->>'doc_emit')::boolean and (f->'can'->>'doc_content')::boolean and f->'can' ? 'dash_read' and f->'can' ? 'inv_manage_write', f::text);
  perform pg_temp.chk('A3 modo demonstração visível no acesso', (j->>'is_demo')::boolean and j->>'provider' = 'demo', null);
  perform pg_temp.as_user('pronoreg'); j := public.doc_my_access(c); f := public.fin_my_access(c);
  perform pg_temp.chk('A4 profissional SEM registro: vê, não emite, e a tela sabe que falta o registro', not (j->>'can_emit')::boolean and (j->>'can_content')::boolean and (j->>'registry_missing')::boolean and (f->'can'->>'doc_registry_missing')::boolean, j::text);
  perform pg_temp.as_user('owner'); j := public.doc_my_access(c);
  perform pg_temp.chk('A5 Owner/Admin sem registro: vê tudo, não emite', not (j->>'can_emit')::boolean and (j->>'can_content')::boolean and j->>'kind' = 'clinical', j::text);
  perform pg_temp.as_user('recep'); j := public.doc_my_access(c);
  perform pg_temp.chk('A6 Recepção: lista e reenvia, sem conteúdo e sem emitir', (j->>'can_list')::boolean and (j->>'can_resend')::boolean and not (j->>'can_content')::boolean and not (j->>'can_emit')::boolean and j->>'kind' = 'front', j::text);
  perform pg_temp.as_user('fin'); j := public.doc_my_access(c);
  perform pg_temp.chk('A7 Financeiro: nada', j->>'kind' = 'none' and not (j->>'can_list')::boolean and not (j->>'can_content')::boolean, j::text);
  perform pg_temp.as_user('estoq'); j := public.doc_my_access(c);
  perform pg_temp.chk('A8 Estoquista: nada', j->>'kind' = 'none' and not (j->>'can_list')::boolean, j::text);
  perform pg_temp.as_user('gestor'); j := public.doc_my_access(c);
  perform pg_temp.chk('A9 Gestor sem vínculo clínico: nada', j->>'kind' = 'none', j::text);
  perform pg_temp.as_user('patu'); j := public.doc_my_access(c);
  perform pg_temp.chk('A10 paciente logado não é equipe: nada', j->>'kind' = 'none', j::text);
  perform pg_temp.as_user('other'); j := public.doc_my_access(c);
  perform pg_temp.chk('A11 admin de OUTRA clínica: nada na clínica A', j->>'kind' = 'none' and not (j->>'can_content')::boolean, j::text);
  perform pg_temp.su();
end $t$;

-- ---------- B. Abrir a sessão com o provedor (quem pode emitir) ----------
do $t$
declare s jsonb; c uuid := pg_temp.f('c');
begin
  perform pg_temp.as_user('pro');
  s := public.doc_open_session(c, pg_temp.f('pat'), 'receita', pg_temp.f('enc'), pg_temp.f('appt'));
  perform pg_temp.chk('B1 sessão devolve paciente, profissional e clínica pré-preenchidos', s->'patient'->>'name' = 'Fulano patu' and s->'patient'->>'birth_date' = '1990-05-17'
    and s->'professional'->>'registry_number' = 'CRN-3 000001' and s->'professional'->>'specialty' = 'Nutrição clínica' and s->'clinic'->>'name' = 'Clínica Fictícia A' and (s->>'is_demo')::boolean, s::text);
  perform pg_temp.as_user('pronoreg');
  perform pg_temp.expect('B2b ... mensagem REGISTRY_REQUIRED', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')), 'REGISTRY_REQUIRED');
  perform pg_temp.as_user('owner');
  perform pg_temp.expect('B3 Owner/Admin sem registro não emite', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')), 'REGISTRY_REQUIRED');
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('B4 Recepção não emite', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('B5 Financeiro não emite', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('B6 Estoquista não emite', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('B7 profissional com registro mas SEM acesso ao paciente não emite', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('B8 tipo inválido', '22023', format($q$select public.doc_open_session(%L, %L, 'bula')$q$, c, pg_temp.f('pat')), 'TYPE_INVALID');
  perform pg_temp.expect('B9 atendimento de OUTRO paciente é recusado', '22023', format($q$select public.doc_open_session(%L, %L, 'atestado', %L)$q$, c, pg_temp.f('pat'), pg_temp.f('enc2')), 'ENCOUNTER_INVALID');
  perform pg_temp.expect('B10 paciente de outra clínica é recusado', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('patb')));
  perform pg_temp.as_user('other');
  perform pg_temp.expect('B11 admin de outra clínica não abre sessão na clínica A', '42501', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')));
  perform pg_temp.su();
end $t$;

-- ---------- C. Assinar (adaptador demonstração) e gravar ----------
do $t$
declare c uuid := pg_temp.f('c'); s uuid; r jsonb; r2 jsonb; n integer; d public.clinical_documents;
begin
  perform pg_temp.as_user('pro');
  s := pg_temp.open('receita', 'pat', 'enc', 'appt');
  r := public.doc_sign_demo(s, 'Receita — emagrecimento', 'Tomar em jejum, aos domingos.', pg_temp.rx_items(), '{"cpf":"111.444.777-35","address":"Rua Fictícia, 100 — Centro"}'::jsonb);
  perform pg_temp.su();
  select * into d from public.clinical_documents where id = (r->>'document_id')::uuid;
  perform pg_temp.chk('C1 documento gravado: tipo, conteúdo, itens, atendimento, profissional, demonstração, SNCR nulo', d.doc_type = 'receita' and d.content like 'Tomar%' and jsonb_array_length(d.items) = 1
    and d.items->0->>'name' = 'Semaglutida 1 mg/mL' and d.items->0->>'quantity' = '1 caneta' and d.encounter_id = pg_temp.f('enc') and d.appointment_id = pg_temp.f('appt')
    and d.professional_id = pg_temp.f('pro_pro') and d.is_demo and d.provider = 'demo' and d.sncr_number is null and d.signed_at is not null, row_to_json(d)::text);
  perform pg_temp.chk('C2 dados do momento da assinatura guardados (paciente com CPF e endereço, profissional, clínica, hash)', d.patient_snapshot->>'cpf' = '11144477735' and d.patient_snapshot->>'address' like 'Rua Fictícia%'
    and d.patient_snapshot->>'birth_date' = '1990-05-17' and d.professional_snapshot->>'registry_number' = 'CRN-3 000001' and d.clinic_name = 'Clínica Fictícia A' and char_length(d.content_hash) = 64, null);
  perform pg_temp.chk('C3 aparece na timeline (activity_events) sem conteúdo clínico', exists (select 1 from public.activity_events e where e.patient_id = pg_temp.f('pat') and e.type = 'document_signed'
    and e.payload->>'document_id' = d.id::text and not e.payload ? 'content' and not e.payload ? 'items'), null);
  perform pg_temp.chk('C4 log de auditoria: create, sem conteúdo clínico', exists (select 1 from public.fin_audit_log a where a.entity = 'clinical_document' and a.entity_id = d.id and a.action = 'create' and a.after->>'is_demo' = 'true')
    and not exists (select 1 from public.fin_audit_log a where a.entity = 'clinical_document' and a.after::text ilike '%Semaglutida%'), null);
  perform pg_temp.as_user('pro');
  r2 := public.doc_sign_demo(s, 'Receita — emagrecimento', 'Tomar em jejum, aos domingos.', pg_temp.rx_items());
  perform pg_temp.su();
  select count(*) into n from public.clinical_documents where patient_id = pg_temp.f('pat');
  perform pg_temp.chk('C5 assinar de novo a mesma sessão (duplo clique) devolve o mesmo documento, sem duplicar', (r2->>'document_id') = (r->>'document_id') and (r2->>'already')::boolean and n = 1, r2::text);
  insert into fx values ('doc_rx', (r->>'document_id')::uuid);

  perform pg_temp.as_user('pro'); s := pg_temp.open('atestado');
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('C6 outro usuário não assina a sessão alheia', '42501', format($q$select public.doc_sign_demo(%L, 'Atestado', 'Repouso de 2 dias.')$q$, s));
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('C7 atestado sem texto é recusado', '22023', format($q$select public.doc_sign_demo(%L, 'Atestado', '  ')$q$, s), 'CONTENT_REQUIRED');
  perform pg_temp.expect('C8 atestado com itens prescritos é recusado', '22023', format($q$select public.doc_sign_demo(%L, 'Atestado', 'Repouso de 2 dias.', %L::jsonb)$q$, s, pg_temp.rx_items()), 'ITEMS_NOT_ALLOWED');
  perform pg_temp.expect('C9 CPF inválido é recusado', '22023', format($q$select public.doc_sign_demo(%L, 'Atestado', 'Repouso de 2 dias.', '[]', '{"cpf":"11111111111"}')$q$, s), 'CPF_INVALID');
  perform pg_temp.expect('C10 título obrigatório', '22023', format($q$select public.doc_sign_demo(%L, ' ', 'Repouso de 2 dias.')$q$, s), 'TITLE_REQUIRED');
  perform pg_temp.su();
  update public.clinical_document_sessions set expires_at = now() - interval '1 minute' where id = s;
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('C11 sessão vencida é recusada', '22023', format($q$select public.doc_sign_demo(%L, 'Atestado', 'Repouso de 2 dias.')$q$, s), 'SESSION_EXPIRED');
  -- receita: itens incompletos / ausentes
  s := pg_temp.open('receita');
  perform pg_temp.expect('C12 receita sem itens é recusada', '22023', format($q$select public.doc_sign_demo(%L, 'Receita', 'x')$q$, s), 'ITEMS_REQUIRED');
  perform pg_temp.expect('C13 receita com item sem posologia é recusada', '22023', format($q$select public.doc_sign_demo(%L, 'Receita', '', '[{"name":"X","dose":"1","posology":"","quantity":"1"}]')$q$, s), 'ITEMS_INCOMPLETE');
  perform pg_temp.expect('C14 item com campo estranho é recusado', '22023', format($q$select public.doc_sign_demo(%L, 'Receita', '', '[{"name":"X","dose":"1","posology":"2x","quantity":"1","preco":3}]')$q$, s), 'ITEMS_INVALID');
  perform pg_temp.expect('C15 mais de 50 itens é recusado', '22023', format($q$select public.doc_sign_demo(%L, 'Receita', '', (select jsonb_agg('{"name":"X","dose":"1","posology":"2x","quantity":"1"}'::jsonb) from generate_series(1,51)))$q$, s), 'ITEMS_INVALID');
  -- exames: itens só com nome
  s := pg_temp.open('exames', 'pat', 'enc');
  r := public.doc_sign_demo(s, 'Solicitação de exames', 'Jejum de 12 h.', '[{"name":"Hemograma completo"},{"name":"Glicemia de jejum"}]');
  insert into fx values ('doc_ex', (r->>'document_id')::uuid);
  perform pg_temp.chk('C16 exames aceita itens só com o nome', (select jsonb_array_length(items) from public.clinical_documents where id = pg_temp.f('doc_ex')) = 2, null);
  s := pg_temp.open('relatorio', 'pat');
  r := public.doc_sign_demo(s, 'Relatório de evolução', 'Paciente evolui bem.');
  insert into fx values ('doc_rel', (r->>'document_id')::uuid);
  s := pg_temp.open('atestado', 'pat');
  r := public.doc_sign_demo(s, 'Atestado', 'Repouso de 2 dias.');
  insert into fx values ('doc_at', (r->>'document_id')::uuid);
  perform pg_temp.su();
  perform pg_temp.chk('C17 os quatro tipos gravados', (select count(distinct doc_type) from public.clinical_documents where patient_id = pg_temp.f('pat')) = 4, null);
end $t$;

-- ---------- D. Imutabilidade ----------
do $t$
declare id uuid := pg_temp.f('doc_rx');
begin
  perform pg_temp.su();
  perform pg_temp.expect('D1 UPDATE do conteúdo bloqueado (até para o dono do banco)', '55000', format($q$update public.clinical_documents set content = 'adulterado' where id = %L$q$, id), 'DOCUMENT_IMMUTABLE');
  perform pg_temp.expect('D2 UPDATE dos itens bloqueado', '55000', format($q$update public.clinical_documents set items = '[]' where id = %L$q$, id));
  perform pg_temp.expect('D3 DELETE bloqueado', '55000', format($q$delete from public.clinical_documents where id = %L$q$, id));
  perform pg_temp.expect('D4 TRUNCATE bloqueado', '55000', 'truncate public.clinical_documents cascade');
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('D5 profissional não escreve direto (sem grant de UPDATE)', '42501', format($q$update public.clinical_documents set content = 'x' where id = %L$q$, id));
  perform pg_temp.expect('D6 ... nem INSERT', '42501', format($q$insert into public.clinical_documents (clinic_id, patient_id, professional_id, doc_type, title, provider, is_demo, signed_at, patient_snapshot, professional_snapshot, clinic_name, content_hash)
    values (%L, %L, %L, 'atestado', 'x', 'demo', true, now(), '{}', '{}', 'x', 'x')$q$, pg_temp.f('c'), pg_temp.f('pat'), pg_temp.f('pro_pro')));
  perform pg_temp.expect('D7 ... nem DELETE', '42501', format($q$delete from public.clinical_documents where id = %L$q$, id));
  perform pg_temp.expect('D8 ... nem sessões diretas', '42501', 'select * from public.clinical_document_sessions');
  perform pg_temp.su();
  perform pg_temp.chk('D9 o conteúdo continua o original', (select content from public.clinical_documents d where d.id = pg_temp.f('doc_rx')) = 'Tomar em jejum, aos domingos.', null);
end $t$;

-- ---------- E. RLS: leitura direta ----------
do $t$
declare n integer; k text;
begin
  foreach k in array array['pro','pronoreg','owner','patu'] loop
    perform pg_temp.as_user(k);
    select count(*) into n from public.clinical_documents;
    perform pg_temp.chk('E1 ' || k || ' enxerga os documentos do paciente (' || n || ')', n = 4, n::text);
  end loop;
  foreach k in array array['pro2','recep','fin','estoq','gestor','other','patu2'] loop
    perform pg_temp.as_user(k);
    select count(*) into n from public.clinical_documents;
    perform pg_temp.chk('E2 ' || k || ' NÃO enxerga conteúdo por consulta direta', n = 0, n::text);
  end loop;
  perform pg_temp.su();
end $t$;

-- ---------- F. Lista (sem conteúdo) por papel e por filtro ----------
do $t$
declare c uuid := pg_temp.f('c'); j jsonb; r jsonb;
begin
  perform pg_temp.as_user('pro'); j := public.doc_list(c, pg_temp.f('pat'));
  perform pg_temp.chk('F1 profissional lista os 4 documentos do paciente, sem conteúdo no payload', jsonb_array_length(j) = 4 and not (j->0) ? 'content' and not (j->0) ? 'items', jsonb_array_length(j)::text);
  r := public.doc_list(c, null, pg_temp.f('enc'));
  perform pg_temp.chk('F2 filtro por atendimento (consulta): receita + exames', jsonb_array_length(r) = 2, jsonb_array_length(r)::text);
  r := public.doc_list(c, null, null, pg_temp.f('appt'));
  perform pg_temp.chk('F3 filtro por atendimento do financeiro: só a receita vinculada', jsonb_array_length(r) = 1 and r->0->>'doc_type' = 'receita', r::text);
  perform pg_temp.chk('F4 a linha traz tipo, data, profissional, demonstração e quantidade de itens', r->0->>'professional_name' = 'Fulano pro' and (r->0->>'is_demo')::boolean and (r->0->>'item_count')::int = 1 and r->0->>'signed_at' is not null, (r->0)::text);
  perform pg_temp.as_user('recep'); j := public.doc_list(c);
  perform pg_temp.chk('F5 Recepção lista os documentos da clínica, sem conteúdo nem motivo de invalidação', jsonb_array_length(j) = 4 and not (j->0) ? 'content' and (j->0->>'invalidated_reason') is null, jsonb_array_length(j)::text);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('F6 Financeiro não lista', '42501', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('F7 Estoquista não lista', '42501', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('F7b Gestor sem vínculo clínico não lista', '42501', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('F8 profissional sem acesso ao paciente não lista o paciente', '42501', format($q$select public.doc_list(%L, %L)$q$, c, pg_temp.f('pat')));
  j := public.doc_list(c);
  perform pg_temp.chk('F9 ... e a lista geral dele não traz o paciente dos outros', jsonb_array_length(j) = 0, jsonb_array_length(j)::text);
  perform pg_temp.as_user('owner'); j := public.doc_list(c);
  perform pg_temp.chk('F10 Owner/Admin lista todos da clínica', jsonb_array_length(j) = 4, null);
  perform pg_temp.as_user('other');
  perform pg_temp.expect('F11 admin de outra clínica não lista', '42501', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.su();
end $t$;

-- ---------- G. Abrir o documento (conteúdo) ----------
do $t$
declare j jsonb; n integer;
begin
  perform pg_temp.as_user('pro'); j := public.doc_get(pg_temp.f('doc_rx'));
  perform pg_temp.chk('G1 profissional abre o documento com conteúdo, itens e dados do momento', j->>'content' like 'Tomar%' and jsonb_array_length(j->'items') = 1 and j->'patient'->>'cpf' = '11144477735' and j->>'clinic_name' = 'Clínica Fictícia A', null);
  perform pg_temp.su();
  select count(*) into n from public.fin_audit_log where entity = 'clinical_document' and entity_id = pg_temp.f('doc_rx') and action = 'view_sensitive';
  perform pg_temp.chk('G2 abertura registrada no log (view_sensitive)', n = 1, n::text);
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('G3 Recepção não abre o conteúdo', '42501', format($q$select public.doc_get(%L)$q$, pg_temp.f('doc_rx')));
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('G4 Financeiro não abre', '42501', format($q$select public.doc_get(%L)$q$, pg_temp.f('doc_rx')));
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('G5 Estoquista não abre', '42501', format($q$select public.doc_get(%L)$q$, pg_temp.f('doc_rx')));
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('G6 profissional sem vínculo não abre', '42501', format($q$select public.doc_get(%L)$q$, pg_temp.f('doc_rx')));
  perform pg_temp.as_user('other');
  perform pg_temp.expect('G7 admin de outra clínica não abre', '42501', format($q$select public.doc_get(%L)$q$, pg_temp.f('doc_rx')));
  perform pg_temp.as_user('owner'); j := public.doc_get(pg_temp.f('doc_rx'));
  perform pg_temp.chk('G8 Owner/Admin abre', j->>'doc_type' = 'receita', null);
  perform pg_temp.su();
end $t$;

-- ---------- H. Reenviar ----------
do $t$
declare j jsonb; n integer; l jsonb;
begin
  perform pg_temp.as_user('recep'); j := public.doc_resend(pg_temp.f('doc_at'), 'download');
  perform pg_temp.chk('H1 Recepção reenvia: recebe o documento para baixar/abrir o PDF', j->>'content' = 'Repouso de 2 dias.' and j->>'doc_type' = 'atestado' and (j->>'is_demo')::boolean, null);
  l := public.doc_list(pg_temp.f('c'));
  perform pg_temp.chk('H2 contador de reenvios na lista', (select (e->>'resend_count')::int from jsonb_array_elements(l) e where e->>'id' = pg_temp.f('doc_at')::text) = 1, l::text);
  perform pg_temp.su();
  select count(*) into n from public.fin_audit_log where entity = 'clinical_document' and entity_id = pg_temp.f('doc_at') and action = 'update' and after->>'event' = 'resend' and after->>'delivered' = 'false';
  perform pg_temp.chk('H3 reenvio registrado no log, marcado como NÃO entregue a ninguém (sem WhatsApp/e-mail)', n = 1, n::text);
  perform pg_temp.as_user('pro'); perform public.doc_resend(pg_temp.f('doc_at'), 'whatsapp'); perform pg_temp.su();
  perform pg_temp.chk('H4 profissional também reenvia; canal pedido só fica registrado, nada é disparado', (select count(*) from public.fin_audit_log where entity_id = pg_temp.f('doc_at') and after->>'event' = 'resend') = 2
    and exists (select 1 from public.fin_audit_log where entity_id = pg_temp.f('doc_at') and after->>'channel' = 'whatsapp' and after->>'delivered' = 'false'), null);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('H5 Financeiro não reenvia', '42501', format($q$select public.doc_resend(%L)$q$, pg_temp.f('doc_at')));
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('H6 Estoquista não reenvia', '42501', format($q$select public.doc_resend(%L)$q$, pg_temp.f('doc_at')));
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('H7 profissional sem vínculo não reenvia', '42501', format($q$select public.doc_resend(%L)$q$, pg_temp.f('doc_at')));
  perform pg_temp.as_user('other');
  perform pg_temp.expect('H8 outra clínica não reenvia', '42501', format($q$select public.doc_resend(%L)$q$, pg_temp.f('doc_at')));
  perform pg_temp.su();
end $t$;

-- ---------- I. Invalidar (marca com motivo; nada é apagado) ----------
do $t$
declare j jsonb; n integer; m public.clinical_document_marks;
begin
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('I1 Recepção não invalida', '42501', format($q$select public.doc_invalidate(%L, 'erro de digitação')$q$, pg_temp.f('doc_rel')));
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('I2 profissional sem vínculo não invalida', '42501', format($q$select public.doc_invalidate(%L, 'erro de digitação')$q$, pg_temp.f('doc_rel')));
  perform pg_temp.as_user('pronoreg');
  perform pg_temp.expect('I2b profissional que não emitiu (mesmo com acesso ao paciente) não invalida', '42501', format($q$select public.doc_invalidate(%L, 'erro de digitação')$q$, pg_temp.f('doc_rel')));
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('I3 motivo curto é recusado', '22023', format($q$select public.doc_invalidate(%L, 'a')$q$, pg_temp.f('doc_rel')), 'REASON_REQUIRED');
  perform public.doc_invalidate(pg_temp.f('doc_rel'), 'Paciente errado no relatório');
  perform pg_temp.expect('I4 invalidar duas vezes é recusado', '22023', format($q$select public.doc_invalidate(%L, 'de novo')$q$, pg_temp.f('doc_rel')), 'ALREADY_INVALIDATED');
  j := public.doc_get(pg_temp.f('doc_rel'));
  perform pg_temp.chk('I5 o documento invalidado continua legível, com a marca e o motivo', (j->>'invalidated')::boolean and j->>'invalidated_reason' = 'Paciente errado no relatório' and j->>'content' = 'Paciente evolui bem.', j::text);
  perform pg_temp.su();
  select count(*) into n from public.clinical_documents where id = pg_temp.f('doc_rel');
  perform pg_temp.chk('I6 nada foi apagado', n = 1, null);
  perform pg_temp.chk('I7 log (deactivate com motivo) e timeline', exists (select 1 from public.fin_audit_log where entity_id = pg_temp.f('doc_rel') and action = 'deactivate' and reason = 'Paciente errado no relatório')
    and exists (select 1 from public.activity_events where type = 'document_invalidated' and payload->>'document_id' = pg_temp.f('doc_rel')::text), null);
  select * into m from public.clinical_document_marks where document_id = pg_temp.f('doc_rel');
  perform pg_temp.expect('I8 a marca também é imutável (UPDATE)', '55000', format($q$update public.clinical_document_marks set reason = 'outro' where id = %L$q$, m.id), 'DOCUMENT_IMMUTABLE');
  perform pg_temp.expect('I9 ... e DELETE', '55000', format($q$delete from public.clinical_document_marks where id = %L$q$, m.id));
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('I10 documento invalidado não pode ser reenviado', '22023', format($q$select public.doc_resend(%L)$q$, pg_temp.f('doc_rel')), 'DOCUMENT_INVALIDATED');
  j := public.doc_list(pg_temp.f('c'));
  perform pg_temp.chk('I11 Recepção vê a marca de invalidado na lista, sem o motivo', (select (e->>'invalidated')::boolean and (e->>'invalidated_reason') is null from jsonb_array_elements(j) e where e->>'id' = pg_temp.f('doc_rel')::text), null);
  perform pg_temp.as_user('owner'); perform public.doc_invalidate(pg_temp.f('doc_at'), 'Emitido para a data errada');
  perform pg_temp.chk('I12 Owner/Admin também invalida', exists (select 1 from public.clinical_document_marks where document_id = pg_temp.f('doc_at')), null);
  perform pg_temp.su();
end $t$;

-- ---------- J. Ingestão do provedor REAL (webhook): idempotente, só service_role ----------
do $t$
declare s uuid; r jsonb; r2 jsonb; r3 jsonb; n integer; d public.clinical_documents; c uuid := pg_temp.f('c');
begin
  insert into public.clinical_document_sessions (clinic_id, patient_id, professional_id, doc_type, provider, opened_by)
    values (c, pg_temp.f('pat'), pg_temp.f('pro_pro'), 'receita', 'memed', pg_temp.f('prof_pro')) returning id into s;
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('J1 o navegador (usuário logado) NÃO chama a ingestão', '42501', format($q$select public.doc_ingest_signed(%L, 'memed', 'EXT-1', 'Receita', 'x', %L::jsonb, now())$q$, s, pg_temp.rx_items()));
  perform pg_temp.su();
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role service_role';
  r := public.doc_ingest_signed(s, 'memed', 'EXT-1', 'Receita de controle especial', 'Uso contínuo.', pg_temp.rx_items(), '2026-11-18T12:00:00Z', 'SNCR-FICT-0001', 'docs/ext-1.pdf');
  r2 := public.doc_ingest_signed(s, 'memed', 'EXT-1', 'Receita de controle especial', 'Uso contínuo.', pg_temp.rx_items(), '2026-11-18T12:00:00Z', 'SNCR-FICT-0001', 'docs/ext-1.pdf');
  r3 := public.doc_ingest_signed(s, 'memed', 'EXT-2', 'Outro', 'Outro.', pg_temp.rx_items(), now());
  perform pg_temp.su();
  select * into d from public.clinical_documents where external_id = 'EXT-1';
  select count(*) into n from public.clinical_documents where provider = 'memed';
  perform pg_temp.chk('J2 documento do provedor real gravado: SNCR, PDF do provedor, sem marca de demonstração, vinculado à sessão', d.id is not null and not d.is_demo and d.sncr_number = 'SNCR-FICT-0001' and d.provider_pdf_path = 'docs/ext-1.pdf'
    and d.signed_at = '2026-11-18T12:00:00Z'::timestamptz and d.professional_id = pg_temp.f('pro_pro'), null);
  perform pg_temp.chk('J3 reenvio do mesmo webhook (mesmo id externo) não duplica', not (r->>'duplicate')::boolean and (r2->>'duplicate')::boolean and (r2->>'document_id') = (r->>'document_id') and n = 1, r2::text);
  perform pg_temp.chk('J4 outro id externo na sessão já assinada também não duplica', (r3->>'duplicate')::boolean and (r3->>'document_id') = (r->>'document_id'), r3::text);
  execute 'set local role service_role';
  perform pg_temp.expect('J5 provedor demo não entra por aqui', '22023', format($q$select public.doc_ingest_signed(%L, 'demo', 'E', 'x', 'x', '[]', now())$q$, s), 'PROVIDER_INVALID');
  perform pg_temp.expect('J6 sessão inexistente', '22023', format($q$select public.doc_ingest_signed(%L, 'memed', 'E9', 'x', 'x', '[]', now())$q$, gen_random_uuid()), 'SESSION_INVALID');
  perform pg_temp.expect('J7 provedor diferente do da sessão', '22023', format($q$select public.doc_ingest_signed(%L, 'nexodata', 'E9', 'x', 'x', '[]', now())$q$, s), 'SESSION_INVALID');
  perform pg_temp.su();
  perform pg_temp.chk('J8 constraint: documento demo nunca tem SNCR e real nunca é demo', true, null);
  perform pg_temp.expect('J8b demo com SNCR é recusado pelo banco', '23514', format($q$insert into public.clinical_documents (clinic_id, patient_id, professional_id, doc_type, title, provider, is_demo, sncr_number, signed_at, patient_snapshot, professional_snapshot, clinic_name, content_hash)
    values (%L, %L, %L, 'atestado', 'x', 'demo', true, 'N1', now(), '{}', '{}', 'x', 'x')$q$, c, pg_temp.f('pat'), pg_temp.f('pro_pro')));
  perform pg_temp.chk('J9 ingestão grava log sem usuário (chamada do provedor)', exists (select 1 from public.fin_audit_log where entity_id = d.id and action = 'create' and user_profile_id is null), null);
  insert into fx values ('doc_memed', d.id);
end $t$;

-- ---------- K. Itens prescritos como dado + sugestão de estoque (sem baixar estoque) ----------
do $t$
declare c uuid := pg_temp.f('c'); j jsonb; s uuid; mv_before bigint; mv_after bigint; r jsonb;
begin
  perform pg_temp.su();
  select count(*) into mv_before from public.stock_movements;
  perform pg_temp.as_user('pro');
  s := pg_temp.open('receita', 'pat', 'enc');
  perform public.doc_sign_demo(s, 'Receita 2', '', '[{"name":"Dipirona gotas 500 mg/mL","dose":"20 gotas","posology":"8/8 h se dor","quantity":"1 frasco"},{"name":"Vitamina Z","dose":"1","posology":"1x ao dia","quantity":"30"}]');
  j := public.doc_prescribed_items(c, pg_temp.f('pat'));
  perform pg_temp.chk('K1 itens como dado: todas as receitas válidas do paciente (1 + 2 itens demo + 1 do provedor real; exames, atestado e relatório ficam de fora)', jsonb_array_length(j) = 4, jsonb_array_length(j)::text);
  perform pg_temp.chk('K2 item que casa com medicamento do estoque traz a sugestão (id, nome, unidade)', (select e->'stock_suggestion'->>'name' from jsonb_array_elements(j) e where e->>'name' like 'Semaglutida%' limit 1) = 'Semaglutida'
    and (select e->'stock_suggestion'->>'item_id' from jsonb_array_elements(j) e where e->>'name' like 'Semaglutida%' limit 1) = pg_temp.f('it_sema')::text, j::text);
  perform pg_temp.chk('K3 item de estoque que é material (não medicamento) e item sem correspondência não geram sugestão', (select count(*) from jsonb_array_elements(j) e where e->'stock_suggestion' is not null and e->'stock_suggestion' <> 'null'::jsonb) = 2, j::text);
  r := public.doc_prescribed_items(c, pg_temp.f('pat'), pg_temp.f('enc'), null, null);
  perform pg_temp.chk('K4 filtro por atendimento', jsonb_array_length(r) = 3, jsonb_array_length(r)::text);
  r := public.doc_prescribed_items(c, pg_temp.f('pat'), null, pg_temp.f('appt'));
  perform pg_temp.chk('K5 filtro por atendimento do financeiro', jsonb_array_length(r) = 1, jsonb_array_length(r)::text);
  r := public.doc_prescribed_items(c, pg_temp.f('pat'), null, null, date '2030-01-01');
  perform pg_temp.chk('K6 filtro por data', jsonb_array_length(r) = 0, null);
  perform pg_temp.su();
  select count(*) into mv_after from public.stock_movements;
  perform pg_temp.chk('K7 NENHUM movimento de estoque foi criado (sugestão não baixa estoque)', mv_before = mv_after, null);
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('K8 profissional sem vínculo não lê os itens', '42501', format($q$select public.doc_prescribed_items(%L, %L)$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('K9 Recepção não lê os itens (conteúdo clínico)', '42501', format($q$select public.doc_prescribed_items(%L, %L)$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('K10 Financeiro não lê os itens', '42501', format($q$select public.doc_prescribed_items(%L, %L)$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('K11 Estoquista não lê os itens', '42501', format($q$select public.doc_prescribed_items(%L, %L)$q$, c, pg_temp.f('pat')));
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('K12 paciente de outra clínica', '42501', format($q$select public.doc_prescribed_items(%L, %L)$q$, c, pg_temp.f('patb')));
  perform pg_temp.su(); perform pg_temp.chk('K13 correspondência por nome ignora acento e caixa', private.doc_norm('  SEMAGLUTÍDA   1mg ') = 'semaglutida 1mg', null);
  perform pg_temp.su();
end $t$;

-- ---------- L. Configuração do provedor por clínica ----------
do $t$
declare c uuid := pg_temp.f('c'); p text;
begin
  perform pg_temp.as_user('owner');
  perform public.doc_set_provider(c, 'demo', 'confirmando o padrão');
  perform pg_temp.expect('L1 provedor real ainda não disponível é recusado', '22023', format($q$select public.doc_set_provider(%L, 'memed')$q$, c), 'PROVIDER_NOT_AVAILABLE');
  perform pg_temp.expect('L2 provedor desconhecido é recusado', '22023', format($q$select public.doc_set_provider(%L, 'xpto')$q$, c), 'PROVIDER_INVALID');
  perform pg_temp.as_user('gestor'); perform public.doc_set_provider(c, 'demo');
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('L3 profissional não muda o provedor', '42501', format($q$select public.doc_set_provider(%L, 'demo')$q$, c));
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('L4 Recepção não muda o provedor', '42501', format($q$select public.doc_set_provider(%L, 'demo')$q$, c));
  perform pg_temp.su();
  select doc_provider into p from public.fin_settings where clinic_id = c;
  perform pg_temp.chk('L5 padrão da clínica é demo', p = 'demo', p);
  -- simula a troca para um provedor real (migration futura) e confere que o diálogo demo deixa de abrir
  update public.fin_settings set doc_provider = 'memed' where clinic_id = c;
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('L6 com o provedor trocado e sem adaptador, a sessão não abre (PROVIDER_NOT_AVAILABLE)', '22023', format($q$select public.doc_open_session(%L, %L, 'atestado')$q$, c, pg_temp.f('pat')), 'PROVIDER_NOT_AVAILABLE');
  perform pg_temp.chk('L7 o acesso informa que o provedor não está pronto e bloqueia o botão', not (public.doc_my_access(c)->>'can_emit')::boolean and not (public.doc_my_access(c)->>'provider_ready')::boolean, null);
  perform pg_temp.su();
  update public.fin_settings set doc_provider = 'demo' where clinic_id = c;
end $t$;

-- ---------- M. Área do paciente ----------
do $t$
declare j jsonb;
begin
  perform pg_temp.as_user('patu'); j := public.doc_my_documents();
  perform pg_temp.chk('M1 paciente logado vê os próprios documentos (com marca de demonstração)', jsonb_array_length(j) >= 4 and (j->0->>'is_demo') is not null and j->0 ? 'content', jsonb_array_length(j)::text);
  perform pg_temp.chk('M2 todos pertencem a ele', not exists (select 1 from jsonb_array_elements(j) e where e->>'patient_id' <> pg_temp.f('pat')::text), null);
  perform pg_temp.as_user('patu2'); j := public.doc_my_documents();
  perform pg_temp.chk('M3 outro paciente não vê documentos alheios', jsonb_array_length(j) = 0, jsonb_array_length(j)::text);
  perform pg_temp.as_user('pro'); j := public.doc_my_documents();
  perform pg_temp.chk('M4 profissional (não é paciente) recebe lista vazia', jsonb_array_length(j) = 0, null);
  perform pg_temp.su();
  set local role anon;
  perform pg_temp.expect('M5 anônimo não chama nada', '42501', 'select public.doc_my_documents()');
  perform pg_temp.su();
end $t$;

-- ---------- N. Funções internas e invariantes ----------
do $t$
begin
  perform pg_temp.chk('N1 funções internas de escrita não são chamáveis por usuário', not has_function_privilege('authenticated', 'private.doc_insert(public.clinical_document_sessions, text, text, text, jsonb, timestamptz, text, text, jsonb, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.doc_open_session(uuid, uuid, text, uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.doc_ingest_signed(uuid, text, text, text, text, jsonb, timestamptz, text, text, jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.doc_ingest_signed(uuid, text, text, text, text, jsonb, timestamptz, text, text, jsonb)', 'execute'), null);
  perform pg_temp.chk('N2 tabelas: RLS ligada e sem grant de escrita', (select bool_and(relrowsecurity) from pg_class where oid in ('public.clinical_documents'::regclass, 'public.clinical_document_marks'::regclass, 'public.clinical_document_sessions'::regclass))
    and not has_table_privilege('authenticated', 'public.clinical_documents', 'insert') and not has_table_privilege('authenticated', 'public.clinical_documents', 'update') and not has_table_privilege('authenticated', 'public.clinical_documents', 'delete')
    and not has_table_privilege('anon', 'public.clinical_documents', 'select'), null);
  perform pg_temp.chk('N3 nenhum documento tem dado de saúde real: todos os nomes de teste são fictícios', not exists (select 1 from public.clinical_documents where clinic_name not like 'Clínica Fictícia%'), null);
  perform pg_temp.chk('N4 o log nunca guarda o conteúdo clínico', not exists (select 1 from public.fin_audit_log where entity = 'clinical_document' and (before::text ilike '%jejum%' or after::text ilike '%jejum%' or after::text ilike '%Repouso%' or after::text ilike '%Hemograma%')), null);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
