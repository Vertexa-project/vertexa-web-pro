-- Prova SQL da FIN-E4 (atendimento com participantes, kit automático, pacotes, devolução) num Postgres LOCAL descartável (fixture própria; nada de produção).
-- Uso: scripts/fin-e4-sql-proof.sh  (cria o cluster/banco, aplica stub + E1 + E2 + E3 + E4, roda este arquivo e apaga tudo).
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
create function pg_temp.entry(p_unit uuid, p_type text, p_item uuid, p_qty numeric, p_cost_each numeric, p_lot text default null, p_exp date default null,
                              p_inv text default null, p_extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
begin
  return public.fin_stock_entry(pg_temp.f('c'), p_unit,
    jsonb_build_object('entry_type', p_type, 'invoice_number', p_inv, 'supplier_new', jsonb_build_object('name', 'Fornecedor Padrão')) || p_extra,
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'unit_cost_cents', p_cost_each, 'lot_code', p_lot, 'expiry_date', p_exp)));
end $$;
-- saldo/custo lidos como dono do banco (a RLS não esconde nada dos asserts)
create function pg_temp.bal(p_item text, p_unit text) returns numeric language sql security definer as $$
  select coalesce((select qty_on_hand from public.stock_balances where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit)), 0) $$;
create function pg_temp.avg(p_item text, p_unit text) returns numeric language sql security definer as $$
  select avg_cost_cents from public.stock_balances where item_id = pg_temp.f(p_item) and unit_id = pg_temp.f(p_unit) $$;
-- participantes: responsável (+ executor opcional + auxiliar opcional), por chave de profissional
create function pg_temp.parts(p_resp text, p_exec text default null, p_aux text default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('professional_id', pg_temp.f('pro_' || p_resp), 'role', 'responsavel'))
      || case when p_exec is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('professional_id', pg_temp.f('pro_' || p_exec), 'role', 'executor')) end
      || case when p_aux is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('professional_id', pg_temp.f('pro_' || p_aux), 'role', 'auxiliar')) end $$;
-- cria atendimento aberto (u1) e guarda o id em fx
create function pg_temp.appt(p_key text, p_patient text, p_service text, p_parts jsonb, p_extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.fin_appt_save(pg_temp.f('c'), pg_temp.f('u1'), null,
         jsonb_build_object('patient_id', pg_temp.f(p_patient), 'service_id', pg_temp.f(p_service)) || p_extra, p_parts);
  insert into fx values (p_key, v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;
create function pg_temp.cost(p_appt text) returns bigint language sql security definer as $$ select material_cost_cents from public.fin_appointments where id = pg_temp.f(p_appt) $$;
create function pg_temp.ev(p_type text, p_appt text) returns integer language sql security definer as $$
  select count(*)::integer from public.fin_events where event_type = p_type and (payload->>'appointment_id')::uuid = pg_temp.f(p_appt) $$;
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text),
  pg_temp.entry(uuid, text, uuid, numeric, numeric, text, date, text, jsonb), pg_temp.bal(text, text), pg_temp.avg(text, text), pg_temp.parts(text, text, text),
  pg_temp.appt(text, text, text, jsonb, jsonb), pg_temp.cost(text), pg_temp.ev(text, text) to public;

-- ---------- Fixture ----------
do $t$
declare
  c uuid; c2 uuid; u1 uuid; u2 uuid; k text; pid uuid; pro uuid; v_id uuid; v_pat uuid; v_pat2 uuid; v_sv uuid;
begin
  foreach k in array array['owner','gestor','fin','recep','pro','pro2','pro3','estoq','other'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','gestor','fin','recep','pro','pro2','pro3','estoq'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end) returning id into pro;
    insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_other'), c2, 'admin') returning id into pro; insert into fx values ('pro_other', pro);
  select id into u1 from public.clinic_units where clinic_id = c and is_primary;
  insert into public.clinic_units (clinic_id, name) values (c, 'Unidade 2') returning id into u2;
  insert into fx values ('u1', u1), ('u2', u2);
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values
    (c, pg_temp.f('pro_gestor'), 'gestor'), (c, pg_temp.f('pro_fin'), 'financeiro'), (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_estoq'), 'estoquista');

  insert into public.profiles (full_name) values ('Paciente Um') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat; insert into fx values ('pat', v_pat);
  insert into public.profiles (full_name) values ('Paciente Dois') returning id into pid;
  insert into public.patients (profile_id, clinic_id) values (pid, c) returning id into v_pat2; insert into fx values ('pat2', v_pat2);
  -- vínculo clínico: pro, pro2 e pro3 atendem o Paciente Um; só pro atende o Paciente Dois
  insert into public.care_team values (v_pat, pg_temp.f('prof_pro')), (v_pat, pg_temp.f('prof_pro2')), (v_pat, pg_temp.f('prof_pro3')), (v_pat2, pg_temp.f('prof_pro'));

  -- itens
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c, 'Ampola X', 'amp', 'medication', 'caixa', 'ampola', 'ampola', true) returning id into v_id; insert into fx values ('it_a', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, stock_to_consumption_factor, lot_control, fractional, opened_validity_days, individual_use)
    values (c, 'Caneta multidose', 'caneta', 'medication', 'un', 'caneta', 'dose', 4, true, true, 28, true) returning id into v_id; insert into fx values ('it_b', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents) values (c, 'Suplemento C', 'sup', 'resale', 'un', 'un', 'un', true, 18000) returning id into v_id; insert into fx values ('it_c', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Seringa D', 'mat', 'consumable', 'cx', 'un', 'un') returning id into v_id; insert into fx values ('it_d', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, stock_to_consumption_factor, lot_control, fractional, opened_validity_days)
    values (c, 'Soro 30 ml', 'soro', 'medication', 'un', 'frasco', 'ml', 30, true, true, 28) returning id into v_id; insert into fx values ('it_e', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Cateter F', 'mat', 'consumable', 'un', 'un', 'un') returning id into v_id; insert into fx values ('it_f', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c, 'Item G', 'mat', 'consumable', 'un', 'un', 'un', true) returning id into v_id; insert into fx values ('it_g', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, sellable, sale_price_cents) values (c, 'Revenda H', 'sup', 'resale', 'un', 'un', 'un', true, 5000) returning id into v_id; insert into fx values ('it_h', v_id);

  -- serviços e kits (quantidades na unidade de CONSUMO)
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Aplicação GLP-1', 'aplicacao', 30000, '{responsavel,executor}') returning id into v_sv; insert into fx values ('sv1', v_sv);
  insert into public.fin_service_kit_items (service_id, item_id, quantity) values (v_sv, pg_temp.f('it_a'), 2), (v_sv, pg_temp.f('it_d'), 1);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Soroterapia', 'procedimento', 25000, '{responsavel,executor,auxiliar}') returning id into v_sv; insert into fx values ('sv2', v_sv);
  insert into public.fin_service_kit_items (service_id, item_id, quantity) values (v_sv, pg_temp.f('it_e'), 5), (v_sv, pg_temp.f('it_d'), 1);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Consulta médica', 'consulta', 50000, '{responsavel}') returning id into v_sv; insert into fx values ('sv3', v_sv);
  insert into public.fin_services (clinic_id, name, category, default_price_cents, roles) values (c, 'Aplicação caneta', 'aplicacao', 40000, '{responsavel}') returning id into v_sv; insert into fx values ('sv4', v_sv);
  insert into public.fin_service_kit_items (service_id, item_id, quantity) values (v_sv, pg_temp.f('it_b'), 1);
end $t$;

-- pacotes (cadastro pela RPC da Entrega 1): programa = 3 consultas (ref. R$ 500) + 3 suplementos (ref. R$ 180) por R$ 1.800,00; pacote F com item sem estoque lançado
do $t$
declare v_p uuid;
begin
  perform pg_temp.as_user('owner');
  v_p := public.fin_save_package(pg_temp.f('c'), null, jsonb_build_object('name', 'Programa Emagrecer', 'price_cents', 180000, 'validity_days', 90),
    jsonb_build_array(jsonb_build_object('item_type', 'service', 'service_id', pg_temp.f('sv3'), 'quantity', 3, 'reference_price_cents', 50000),
                      jsonb_build_object('item_type', 'product', 'stock_item_id', pg_temp.f('it_c'), 'quantity', 3, 'reference_price_cents', 18000)));
  insert into fx values ('pk1', v_p);
  v_p := public.fin_save_package(pg_temp.f('c'), null, jsonb_build_object('name', 'Pacote sem estoque', 'price_cents', 10000, 'validity_days', 30),
    jsonb_build_array(jsonb_build_object('item_type', 'product', 'stock_item_id', pg_temp.f('it_h'), 'quantity', 2, 'reference_price_cents', 5000)));
  insert into fx values ('pk2', v_p);
  perform pg_temp.su();
end $t$;

-- estoque inicial da unidade 1
do $t$
declare u1 uuid := pg_temp.f('u1'); d date := private.fin_today();
begin
  perform pg_temp.as_user('estoq');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 3, 4000, 'L-CURTO', d + 10, 'NF-A1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_a'), 10, 4000, 'L-LONGO', d + 90, 'NF-A2');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 20, 100, null, null, 'NF-D1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_e'), 2, 30000, 'FR1', d + 60, 'NF-E1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_b'), 2, 80000, 'CN1', d + 60, 'NF-B1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_c'), 10, 6000, null, null, 'NF-C1');
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_g'), 5, 1000, 'VENC', d + 5, 'NF-G1');
  perform pg_temp.su();
  update public.stock_lots set expiry_date = d - 2 where item_id = pg_temp.f('it_g') and lot_code = 'VENC';   -- o lote venceu (a entrada não aceita lote já vencido)
  perform pg_temp.chk('Z0 fixture: ampola 13 a R$ 40,00, seringa 20 a R$ 1,00', pg_temp.bal('it_a','u1') = 13 and pg_temp.avg('it_a','u1') = 4000 and pg_temp.bal('it_d','u1') = 20, null);
end $t$;

-- ---------- A. Permissões do atendimento ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); v uuid; n integer;
begin
  perform pg_temp.as_user('gestor');
  v := pg_temp.appt('ap1', 'pat', 'sv1', pg_temp.parts('pro', 'pro2'));
  perform pg_temp.su();
  perform pg_temp.chk('A1 Gestor registra o atendimento (responsável + executor)', v is not null and (select status from public.fin_appointments where id = v) = 'open', null);
  perform pg_temp.as_user('pro');
  v := pg_temp.appt('ap_pro', 'pat', 'sv3', pg_temp.parts('pro'));
  perform pg_temp.chk('A2 Profissional registra o PRÓPRIO atendimento (consta como responsável)', v is not null, null);
  perform pg_temp.expect('A3 Profissional NÃO registra atendimento de outro (não consta como responsável/executor)', '42501', $q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro2'))$q$);
  perform pg_temp.su();
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('A5 Profissional sem vínculo com o Paciente Dois → recusa', '42501', $q$select pg_temp.appt('x', 'pat2', 'sv3', pg_temp.parts('pro2'))$q$);
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('A6 Admin de OUTRA clínica não registra aqui', '42501', $q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'))$q$);
  perform pg_temp.expect('A7 ... nem lista', '42501', format($q$select * from public.fin_appt_list(%L)$q$, c));
  perform pg_temp.expect('A8 ... nem abre o detalhe', '42501', format($q$select public.fin_appt_get(%L)$q$, pg_temp.f('ap1')));
  perform pg_temp.su();
  perform pg_temp.as_user('fin');
  select count(*) into n from public.fin_appt_list(c);
  perform pg_temp.chk('A9 Financeiro lista todos os atendimentos (paciente, serviço, valor e data)', n = 2 and exists (select 1 from public.fin_appt_list(c) l where l.patient_name = 'Paciente Um' and l.service_name = 'Aplicação GLP-1'), n::text);
  perform pg_temp.expect('A10 Financeiro NÃO cria atendimento (consulta)', '42501', $q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'))$q$);
  perform pg_temp.su();
  perform pg_temp.as_user('pro2');
  select count(*) into n from public.fin_appt_list(c);
  perform pg_temp.chk('A11 Profissional lista só os atendimentos em que participa (pro2 é executor de 1)', n = 1 and (select can_manage from public.fin_appt_list(c) limit 1), n::text);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  select count(*) into n from public.fin_appt_list(c);
  perform pg_temp.chk('A12 Recepção (sem participação) não enxerga atendimento nenhum', n = 0, n::text);
  perform pg_temp.expect('A13 ... nem o detalhe', '42501', format($q$select public.fin_appt_get(%L)$q$, pg_temp.f('ap1')));
  perform pg_temp.su();
  -- tabelas: sem SELECT direto (o custo do material não vaza)
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('A14 Financeiro: sem SELECT direto em fin_appointments', '42501', 'select * from public.fin_appointments');
  perform pg_temp.expect('A15 ... nem em fin_appointment_materials', '42501', 'select * from public.fin_appointment_materials');
  perform pg_temp.expect('A16 ... nem escreve (sem INSERT)', '42501', format($q$insert into public.fin_appointments (clinic_id, unit_id, patient_id, service_id, service_name, performed_on) values (%L, %L, %L, %L, 'x', current_date)$q$, c, u1, pg_temp.f('pat'), pg_temp.f('sv3')));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('A17 Profissional: sem SELECT direto em fin_appointments', '42501', 'select * from public.fin_appointments');
  perform pg_temp.chk('A19 fin_my_access do profissional: own_appt, sem appt_write', (public.fin_my_access(c)->'can'->>'own_appt')::boolean and not (public.fin_my_access(c)->'can'->>'appt_write')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('A18 fin_my_access: gestor gerencia atendimento', (public.fin_my_access(c)->'can'->>'appt_write')::boolean and (public.fin_my_access(c)->'can'->>'patient_pkg_read')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.chk('A20 fin_my_access da Recepção: lê pacotes de paciente e entrega item; não gerencia atendimento', (public.fin_my_access(c)->'can'->>'patient_pkg_read')::boolean and (public.fin_my_access(c)->'can'->>'package_deliver_write')::boolean
    and not (public.fin_my_access(c)->'can'->>'appt_read')::boolean, null);
  perform pg_temp.su();
  perform pg_temp.as_user('pro2');
  perform pg_temp.chk('A21 busca de paciente do atendimento: o profissional acha só os pacientes a que tem acesso (pro2: só o Paciente Um)', (select count(*) from public.fin_appt_patients(c)) = 1 and exists (select 1 from public.fin_appt_patients(c, 'Um')), null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('A22 ... e o gestor acha todos da clínica', (select count(*) from public.fin_appt_patients(c)) = 2, null);
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('A23 admin de outra clínica não busca paciente daqui', '42501', format($q$select * from public.fin_appt_patients(%L)$q$, c));
  perform pg_temp.su();
end $t$;

-- ---------- B. Participantes ----------
do $t$
declare c uuid := pg_temp.f('c'); v uuid;
begin
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('B1 sem responsável → recusa', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv1', jsonb_build_array(jsonb_build_object('professional_id', %L, 'role', 'executor')))$q$, pg_temp.f('pro_pro2')), 'RESPONSIBLE_REQUIRED');
  perform pg_temp.expect('B2 dois responsáveis → recusa', '22023', $q$select pg_temp.appt('x', 'pat', 'sv1', pg_temp.parts('pro') || pg_temp.parts('pro2'))$q$, 'RESPONSIBLE_REQUIRED');
  perform pg_temp.expect('B3 dois executores → recusa', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv1', pg_temp.parts('pro', 'pro2') || jsonb_build_array(jsonb_build_object('professional_id', %L, 'role', 'executor')))$q$, pg_temp.f('pro_pro3')), 'ONE_EXECUTOR');
  perform pg_temp.expect('B4 papel que o serviço não prevê (Consulta só tem responsável) → recusa', '22023', $q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro', 'pro2'))$q$, 'ROLE_NOT_ALLOWED');
  perform pg_temp.expect('B5 profissional de outra clínica → recusa', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv3', jsonb_build_array(jsonb_build_object('professional_id', %L, 'role', 'responsavel')))$q$, pg_temp.f('pro_other')), 'INVALID_PROFESSIONAL');
  perform pg_temp.expect('B6 mesma pessoa duas vezes no mesmo papel → recusa', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv2', pg_temp.parts('pro', 'pro2', 'pro3') || jsonb_build_array(jsonb_build_object('professional_id', %L, 'role', 'auxiliar')))$q$, pg_temp.f('pro_pro3')), 'DUPLICATE_PARTICIPANT');
  v := pg_temp.appt('ap_aux', 'pat', 'sv2', pg_temp.parts('pro', 'pro2', 'pro3'));
  perform pg_temp.su();
  perform pg_temp.chk('B7 responsável + executor + auxiliar gravados em ordem (base do repasse)', (select count(*) from public.fin_appointment_participants where appointment_id = v) = 3
    and (select string_agg(role, ',' order by position) from public.fin_appointment_participants where appointment_id = v) = 'responsavel,executor,auxiliar', null);
  perform pg_temp.as_user('pro3');
  perform pg_temp.expect('B8 auxiliar NÃO realiza o atendimento (só responsável/executor)', '42501', format($q$select public.fin_appt_complete(%L, '[]'::jsonb)$q$, v));
  perform pg_temp.su();
end $t$;

-- ---------- C. Kit automático (E2 do documento): lote sugerido, baixa, custo gravado ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); k jsonb; r jsonb; v uuid := pg_temp.f('ap1'); a_before numeric; d_before numeric; m record; v_curto text;
begin
  select id::text into v_curto from public.stock_lots where lot_code = 'L-CURTO' and item_id = pg_temp.f('it_a');
  a_before := pg_temp.bal('it_a','u1'); d_before := pg_temp.bal('it_d','u1');
  perform pg_temp.as_user('pro');
  k := public.fin_appt_kit(v);
  perform pg_temp.chk('C1 E2: o kit vem pré-preenchido (2 ampolas + 1 seringa) com o lote de validade mais próxima sugerido',
    jsonb_array_length(k->'lines') = 2
    and (select (l->>'qty')::numeric from jsonb_array_elements(k->'lines') l where l->>'name' = 'Ampola X') = 2
    and (select l->>'suggested_lot_id' from jsonb_array_elements(k->'lines') l where l->>'name' = 'Ampola X') = v_curto, k::text);
  perform pg_temp.chk('C2b o catálogo para «adicionar item» traz fator e saldo da unidade', (select (ce->>'balance')::numeric from jsonb_array_elements(k->'catalog') ce where ce->>'name' = 'Ampola X') = 13 and (select (ce->>'factor')::numeric from jsonb_array_elements(k->'catalog') ce where ce->>'name' = 'Soro 30 ml') = 30, null);
  perform pg_temp.chk('C2 o profissional vê o kit mas NÃO o custo', not (k->>'can_cost')::boolean and (select l->'avg_cost_cents' from jsonb_array_elements(k->'lines') l limit 1) = 'null'::jsonb, null);
  r := public.fin_appt_complete(v, null);
  perform pg_temp.su();
  perform pg_temp.chk('C3 E2: ao confirmar, a baixa sai do lote que vence primeiro (L-CURTO 3→1) e a seringa 20→19',
    pg_temp.bal('it_a','u1') = a_before - 2 and pg_temp.bal('it_d','u1') = d_before - 1
    and (select qty_on_hand from public.stock_lots where lot_code = 'L-CURTO' and item_id = pg_temp.f('it_a')) = 1, r::text);
  perform pg_temp.chk('C4 E2: custo do material gravado no atendimento = 2 × R$ 40,00 + 1 × R$ 1,00 = R$ 81,00', pg_temp.cost('ap1') = 8100
    and (select status from public.fin_appointments where id = v) = 'done' and (select kit_confirmed_at is not null from public.fin_appointments where id = v), pg_temp.cost('ap1')::text);
  perform pg_temp.chk('C5 as saídas apontam para o atendimento (tipo «atendimento», paciente e data)',
    (select count(*) from public.stock_movements where appointment_id = v and movement_type = 'appointment' and patient_id = pg_temp.f('pat') and qty < 0) = 2, null);
  perform pg_temp.as_user('pro');
  perform pg_temp.chk('C6 o profissional participante lê o detalhe SEM custo (nulo)', (public.fin_appt_get(v)->>'material_cost_cents') is null and (public.fin_appt_get(v)->>'can_cost')::boolean = false
    and jsonb_array_length(public.fin_appt_get(v)->'materials') = 2, null);
  perform pg_temp.chk('C9 ... e vê a lista SEM custo', (select l.material_cost_cents from public.fin_appt_list(c, null, 'done') l where l.id = v) is null, null);
  perform pg_temp.expect('C10 atendimento já realizado não realiza de novo', '22023', format($q$select public.fin_appt_complete(%L, null)$q$, v), 'APPOINTMENT_NOT_OPEN');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('C7 o gestor lê o detalhe COM custo (R$ 81,00) e os participantes', (public.fin_appt_get(v)->>'material_cost_cents')::bigint = 8100 and jsonb_array_length(public.fin_appt_get(v)->'participants') = 2, null);
  perform pg_temp.chk('C8 o gestor/Financeiro vê o custo na lista', (select l.material_cost_cents from public.fin_appt_list(c, null, 'done') l where l.id = v) = 8100, null);
  perform pg_temp.su();
  select * into m from public.fin_events where event_type = 'appointment_done' and (payload->>'appointment_id')::uuid = v;
  perform pg_temp.chk('C11 o repasse (E5) recebe o evento com os participantes por papel e o custo do material',
    m.id is not null and jsonb_array_length(m.payload->'participants') = 2 and (m.payload->>'material_cost_cents')::bigint = 8100 and (m.payload->>'without_sale')::boolean, m.payload::text);
  perform pg_temp.chk('C12 log (Histórico): criação e realização do atendimento, com nomes e custo',
    (select count(*) from public.fin_audit_log where entity = 'appointment' and entity_id = v) = 2
    and exists (select 1 from public.fin_audit_log where entity = 'appointment' and entity_id = v and after->'materials' @> '[{"item_name":"Ampola X"}]'::jsonb and (after->>'material_cost_cents')::bigint = 8100), null);
  perform pg_temp.chk('C13 movimentação de atendimento no Histórico com o nome do item', exists (select 1 from public.fin_audit_log where entity = 'stock_movement' and after->>'movement_type' = 'appointment' and after->>'item_name' = 'Ampola X'), null);
end $t$;

-- ---------- D. Kit editado: troca de lote, quantidade diferente, remove e adiciona; consumo sem saldo; atendimento futuro ----------
do $t$
declare c uuid := pg_temp.f('c'); v uuid; lg uuid; r jsonb; d date := private.fin_today(); a_before numeric;
begin
  select id into lg from public.stock_lots where lot_code = 'L-LONGO' and item_id = pg_temp.f('it_a');
  a_before := pg_temp.bal('it_a','u1');
  perform pg_temp.as_user('gestor');
  v := pg_temp.appt('ap2', 'pat', 'sv1', pg_temp.parts('pro', 'pro2'));
  perform pg_temp.su();
  perform pg_temp.as_user('pro2');   -- o EXECUTOR confirma e edita o kit
  r := public.fin_appt_complete(v, jsonb_build_array(
         jsonb_build_object('item_id', pg_temp.f('it_a'), 'quantity', 3, 'lot_id', lg),     -- troca o lote e muda a quantidade (2 → 3)
         jsonb_build_object('item_id', pg_temp.f('it_f'), 'quantity', 1)));                  -- adiciona item (sem estoque lançado); a seringa do kit foi removida
  perform pg_temp.su();
  perform pg_temp.chk('D1 o executor troca o lote (L-LONGO) e a quantidade (3 ampolas): L-LONGO 10→7, L-CURTO intacto',
    (select qty_on_hand from public.stock_lots where id = lg) = 7 and (select qty_on_hand from public.stock_lots where lot_code = 'L-CURTO' and item_id = pg_temp.f('it_a')) = 1 and pg_temp.bal('it_a','u1') = a_before - 3, null);
  perform pg_temp.chk('D2 item removido do kit não baixa (seringa continua 19); item adicionado entra como «adicionado»',
    pg_temp.bal('it_d','u1') = 19 and exists (select 1 from public.fin_appointment_materials where appointment_id = v and source = 'added' and item_id = pg_temp.f('it_f'))
    and exists (select 1 from public.fin_appointment_materials where appointment_id = v and source = 'kit' and item_id = pg_temp.f('it_a') and planned_qty = 2 and qty_consumption = 3), null);
  perform pg_temp.chk('D3 E3: atendimento salvo mesmo sem saldo; baixa marcada «consumo sem saldo» (alerta)', (select status from public.fin_appointments where id = v) = 'done' and (select has_shortfall from public.fin_appointments where id = v)
    and (r->>'has_shortfall')::boolean and exists (select 1 from public.stock_shortfalls where appointment_id = v and status = 'open' and qty = 1 and item_id = pg_temp.f('it_f')), r::text);
  perform pg_temp.chk('D4 custo do atendimento = 3 × R$ 40,00 = R$ 120,00 (item sem saldo nem custo médio: estimativa R$ 0,00)', pg_temp.cost('ap2') = 12000, pg_temp.cost('ap2')::text);
  perform pg_temp.as_user('gestor');
  perform pg_temp.chk('D5 E3: o alerta chega ao gestor (lista de consumo sem saldo)', exists (select 1 from public.fin_shortfalls_list(c, null, 'open') s where s.item_name = 'Cateter F' and s.service_name = 'Aplicação GLP-1' and s.patient_name = 'Paciente Um'), null);
  perform pg_temp.su();
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('D6 Recepção não vê o alerta de estoque', '42501', format($q$select * from public.fin_shortfalls_list(%L)$q$, c));
  perform pg_temp.chk('D7 ... nem pela tabela (RLS)', (select count(*) from public.stock_shortfalls) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('D8 o profissional também não lê o alerta de estoque', '42501', format($q$select * from public.fin_shortfalls_list(%L)$q$, c));
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  v := pg_temp.appt('ap_fut', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('performed_on', (d + 3)::text));
  perform pg_temp.expect('D9 atendimento marcado para o futuro não pode ser realizado', '22023', format($q$select public.fin_appt_complete(%L, null)$q$, v), 'FUTURE_DATE');
  perform pg_temp.su();
end $t$;

-- ---------- E. Consumo sem saldo parcial, retroativo, ajuste e lote vencido ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); v uuid; sf uuid; d date := private.fin_today(); ev_before integer; r jsonb; mv_on date;
begin
  perform pg_temp.as_user('gestor');
  v := pg_temp.appt('ap3', 'pat', 'sv1', pg_temp.parts('pro', 'pro2'), jsonb_build_object('performed_on', (d - 3)::text));
  r := public.fin_appt_complete(v, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_d'), 'quantity', 25)));   -- só há 19 seringas
  perform pg_temp.su();
  select id into sf from public.stock_shortfalls where appointment_id = v;
  perform pg_temp.chk('E1 saldo parcial: baixa as 19 que há (saldo zera) e registra 6 como consumo sem saldo; custo = 19×R$ 1,00 + 6×R$ 1,00 (estimado) = R$ 25,00',
    pg_temp.bal('it_d','u1') = 0 and (select qty from public.stock_shortfalls where id = sf) = 6 and pg_temp.cost('ap3') = 2500 and (select material_estimated_cents from public.fin_appointments where id = v) = 600, pg_temp.cost('ap3')::text);
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('E2 resolver por baixa retroativa SEM ter lançado a entrada → continua em aberto (saldo insuficiente)', '22023', format($q$select public.fin_shortfall_resolve(%L, 'retro', 'Entrada ainda não lançada')$q$, sf), 'INSUFFICIENT_STOCK');
  perform pg_temp.chk('E3 ... e nada mudou (sobra aberta, sem movimento novo)', (select count(*) from public.stock_shortfalls where id = sf and status = 'open') = 1, null);
  perform pg_temp.entry(u1, 'purchase', pg_temp.f('it_d'), 10, 150, null, null, 'NF-D2');   -- entrada de 10 a R$ 1,50 (custo médio passa a R$ 1,50, saldo era 0)
  perform pg_temp.su();
  select count(*) into ev_before from public.fin_events where event_type = 'appointment_material_adjusted' and (payload->>'appointment_id')::uuid = v;
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('E4 Recepção não resolve (sem papel de estoque)', '42501', format($q$select public.fin_shortfall_resolve(%L, 'retro', 'Tentativa')$q$, sf));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform public.fin_shortfall_resolve(sf, 'retro', 'Entrada da NF-D2 lançada');
  perform pg_temp.su();
  select occurred_on into mv_on from public.stock_movements where appointment_id = v and movement_type = 'appointment' and reason like 'Baixa retroativa%';
  perform pg_temp.chk('E5 baixa retroativa: a movimentação leva a DATA DO ATENDIMENTO (d-3) e o saldo cai 10→4', mv_on = d - 3 and pg_temp.bal('it_d','u1') = 4, mv_on::text);
  perform pg_temp.chk('E6 o custo do atendimento passa da estimativa para o real: 19×R$ 1,00 + 6×R$ 1,50 = R$ 28,00; sem sobra aberta',
    pg_temp.cost('ap3') = 2800 and not (select has_shortfall from public.fin_appointments where id = v) and (select status from public.stock_shortfalls where id = sf) = 'resolved'
    and (select material_estimated_cents from public.fin_appointments where id = v) = 0, pg_temp.cost('ap3')::text);
  perform pg_temp.chk('E7 a diferença de material vai ao repasse como ajuste (+R$ 3,00)', (select count(*) from public.fin_events where event_type = 'appointment_material_adjusted' and (payload->>'appointment_id')::uuid = v) = ev_before + 1
    and exists (select 1 from public.fin_events where event_type = 'appointment_material_adjusted' and (payload->>'appointment_id')::uuid = v and (payload->>'delta_cents')::bigint = 300), null);
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('E8 sobra já resolvida não resolve de novo', '22023', format($q$select public.fin_shortfall_resolve(%L, 'adjust', 'Teste')$q$, sf), 'ALREADY_RESOLVED');
  perform pg_temp.su();
  select id into sf from public.stock_shortfalls where appointment_id = pg_temp.f('ap2');
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('E9 motivo é obrigatório', '22023', format($q$select public.fin_shortfall_resolve(%L, 'adjust', '')$q$, sf), 'REASON_REQUIRED');
  perform public.fin_shortfall_resolve(sf, 'adjust', 'Cateter regularizado no inventário');
  perform pg_temp.su();
  perform pg_temp.chk('E10 resolver por ajuste fecha a sobra sem mexer em estoque nem no custo', (select resolution from public.stock_shortfalls where id = sf) = 'adjustment' and not (select has_shortfall from public.fin_appointments where id = pg_temp.f('ap2')) and pg_temp.cost('ap2') = 12000, null);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('E11 Financeiro só consulta: não resolve', '42501', format($q$select public.fin_shortfall_resolve(%L, 'adjust', 'Teste')$q$, sf));
  perform pg_temp.chk('E12 ... mas lê a lista (resolvidas)', exists (select 1 from public.fin_shortfalls_list(c, null, 'resolved')), null);
  perform pg_temp.su();
  -- lote vencido: só existe estoque vencido
  perform pg_temp.as_user('gestor');
  v := pg_temp.appt('ap4', 'pat', 'sv3', pg_temp.parts('pro'));
  perform pg_temp.expect('E13 E4: lote vencido ESCOLHIDO à mão para consumo é bloqueado', '22023', format($q$select public.fin_appt_complete(%L, %L::jsonb)$q$, v,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_g'), 'quantity', 1, 'lot_id', (select id from public.stock_lots where lot_code = 'VENC')))::text), 'LOT_EXPIRED');
  r := public.fin_appt_complete(v, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_g'), 'quantity', 1)));
  perform pg_temp.su();
  perform pg_temp.chk('E14 só sobrou lote vencido: o atendimento é salvo, o vencido NÃO sai (saldo 5) e vira consumo sem saldo', (select status from public.fin_appointments where id = v) = 'done' and pg_temp.bal('it_g','u1') = 5
    and exists (select 1 from public.stock_shortfalls where appointment_id = v and status = 'open' and qty = 1), r::text);
end $t$;

-- ---------- F. Uso fracionado e individual ----------
do $t$
declare c uuid := pg_temp.f('c'); v1 uuid; v2 uuid; v3 uuid; n integer; ou1 uuid; ou2 uuid;
begin
  perform pg_temp.as_user('gestor');
  v1 := pg_temp.appt('ap_f1', 'pat', 'sv2', pg_temp.parts('pro', 'pro2'));
  perform public.fin_appt_complete(v1, null);
  v2 := pg_temp.appt('ap_f2', 'pat2', 'sv2', pg_temp.parts('pro'));
  perform public.fin_appt_complete(v2, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_e'), 'quantity', 5)));
  perform pg_temp.su();
  perform pg_temp.chk('F1 kit em unidade de CONSUMO: 5 ml de frasco de 30 ml = 0,167 do frasco (3 casas); custo 0,167 × R$ 300,00 = R$ 50,10',
    (select total_cost_cents from public.stock_movements where appointment_id = v1 and item_id = pg_temp.f('it_e')) = -5010 and (select qty from public.stock_movements where appointment_id = v1 and item_id = pg_temp.f('it_e')) = -0.167, null);
  select count(*) into n from public.stock_open_units where item_id = pg_temp.f('it_e');
  perform pg_temp.chk('F2 frasco compartilhado (uso não individual): a 2ª dose reaproveita a unidade aberta (1 unidade aberta, 0,666 restante)', n = 1 and (select qty_remaining from public.stock_open_units where item_id = pg_temp.f('it_e')) = 0.666, n::text);
  perform pg_temp.as_user('gestor');
  v1 := pg_temp.appt('ap_c1', 'pat', 'sv4', pg_temp.parts('pro'));
  perform public.fin_appt_complete(v1, null);
  v2 := pg_temp.appt('ap_c2', 'pat2', 'sv4', pg_temp.parts('pro'));
  perform public.fin_appt_complete(v2, null);
  v3 := pg_temp.appt('ap_c3', 'pat', 'sv4', pg_temp.parts('pro'));
  perform public.fin_appt_complete(v3, null);
  perform pg_temp.su();
  select count(*) into n from public.stock_open_units where item_id = pg_temp.f('it_b');
  select open_unit_id into ou1 from public.stock_movements where appointment_id = v1 and item_id = pg_temp.f('it_b');
  select open_unit_id into ou2 from public.stock_movements where appointment_id = v3 and item_id = pg_temp.f('it_b');
  perform pg_temp.chk('F3 E12: caneta de uso individual — cada paciente tem a sua unidade aberta (2) e o mesmo paciente reaproveita a dele', n = 2 and ou1 = ou2 and ou1 is not null
    and (select patient_id from public.stock_open_units where id = ou1) = pg_temp.f('pat'), n::text);
  perform pg_temp.chk('F4 1 dose = 0,25 da caneta (fator 4): 3 doses → saldo 2 − 0,75 = 1,25', pg_temp.bal('it_b','u1') = 1.25, pg_temp.bal('it_b','u1')::text);
end $t$;

-- ---------- G. Correção, cancelamento e estorno ----------
do $t$
declare c uuid := pg_temp.f('c'); v uuid := pg_temp.f('ap1'); a_before numeric; d_before numeric; r jsonb;
begin
  perform pg_temp.as_user('pro3');
  perform pg_temp.expect('G1 quem não participa não corrige a baixa', '42501', format($q$select public.fin_appt_correct(%L, '[]'::jsonb, 'Teste de correção')$q$, v));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('G2 correção exige motivo', '22023', format($q$select public.fin_appt_correct(%L, %L::jsonb, '')$q$, v, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_a'), 'quantity', 3))::text), 'REASON_REQUIRED');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('G3 estorno manual de baixa de atendimento é bloqueado (use «corrigir kit»)', '22023',
    format($q$select public.fin_stock_reverse(%L, 'Tentativa manual')$q$, (select id from public.stock_movements where appointment_id = v and movement_type = 'appointment' limit 1)), 'APPOINTMENT_MOVEMENT_USE_CORRECT');
  perform pg_temp.su();
  a_before := pg_temp.bal('it_a','u1'); d_before := pg_temp.bal('it_d','u1');
  perform pg_temp.as_user('pro');
  r := public.fin_appt_correct(v, jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('it_a'), 'quantity', 3)), 'Foram aplicadas 3 ampolas e nenhuma seringa do kit');
  perform pg_temp.su();
  perform pg_temp.chk('G4 E11: correção = estorno da baixa + nova baixa (as 2 ampolas voltam, 3 saem → saldo −1; a seringa removida volta → +1)', pg_temp.bal('it_a','u1') = a_before - 1 and pg_temp.bal('it_d','u1') = d_before + 1, r::text);
  perform pg_temp.chk('G5 o custo é refeito (3 × R$ 40,00 = R$ 120,00) e as duas rodadas ficam no registro (rodada 1 estornada, rodada 2 ativa)',
    pg_temp.cost('ap1') = 12000 and (select count(*) from public.fin_appointment_materials where appointment_id = v and status = 'reversed' and batch = 1) = 2 and (select count(*) from public.fin_appointment_materials where appointment_id = v and status = 'active' and batch = 2) = 1, pg_temp.cost('ap1')::text);
  perform pg_temp.chk('G6 estornos ligados às originais (linhas novas, nada apagado)', (select count(*) from public.stock_movements where movement_type = 'reversal' and reversed_movement_id in (select unnest(movement_ids) from public.fin_appointment_materials where appointment_id = v and batch = 1)) = 2, null);
  perform pg_temp.chk('G7 mês de repasse travado (E6): a diferença (+R$ 39,00) vai ao repasse como AJUSTE', exists (select 1 from public.fin_events where event_type = 'appointment_material_adjusted' and (payload->>'appointment_id')::uuid = v
    and (payload->>'delta_cents')::bigint = 3900 and (payload->>'old_cost_cents')::bigint = 8100 and (payload->>'new_cost_cents')::bigint = 12000), null);
  -- cancelar o atendimento realizado
  a_before := pg_temp.bal('it_a','u1'); d_before := pg_temp.bal('it_d','u1');
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('G8 cancelar exige motivo', '22023', format($q$select public.fin_appt_cancel(%L, ' ')$q$, v), 'REASON_REQUIRED');
  perform public.fin_appt_cancel(v, 'Paciente não compareceu de fato');
  perform pg_temp.chk('G13 Histórico: cancelamento registrado como estorno, com motivo', exists (select 1 from public.fin_audit_list(c, 'appointment') a where a.entity_id = v and a.action = 'reverse' and a.reason = 'Paciente não compareceu de fato'), null);
  perform pg_temp.expect('G11 não cancela duas vezes', '22023', format($q$select public.fin_appt_cancel(%L, 'de novo')$q$, v), 'ALREADY_CANCELED');
  perform pg_temp.expect('G12 atendimento cancelado não se corrige', '22023', format($q$select public.fin_appt_correct(%L, '[]'::jsonb, 'Teste')$q$, v), 'APPOINTMENT_NOT_DONE');
  perform pg_temp.su();
  perform pg_temp.chk('G9 atendimento cancelado: a baixa é estornada (ampolas +3), custo zera, status cancelado',
    pg_temp.bal('it_a','u1') = a_before + 3 and pg_temp.bal('it_d','u1') = d_before and pg_temp.cost('ap1') = 0 and (select status from public.fin_appointments where id = v) = 'canceled', pg_temp.cost('ap1')::text);
  perform pg_temp.chk('G10 o repasse é avisado do cancelamento', pg_temp.ev('appointment_canceled', 'ap1') = 1, null);
  -- cancelar um aberto: não mexe em estoque
  perform pg_temp.chk('G14 cancelar atendimento ABERTO: sem estoque envolvido', (select count(*) from public.stock_movements where appointment_id = pg_temp.f('ap_fut')) = 0, null);
  perform pg_temp.as_user('gestor');
  perform public.fin_appt_cancel(pg_temp.f('ap_fut'), 'Remarcado');
  perform pg_temp.expect('G16 trocar participantes de atendimento realizado exige motivo', '22023', format($q$select public.fin_appt_set_participants(%L, %L::jsonb, '')$q$, pg_temp.f('ap2'), pg_temp.parts('pro', 'pro3')::text), 'REASON_REQUIRED');
  perform public.fin_appt_set_participants(pg_temp.f('ap2'), pg_temp.parts('pro', 'pro3'), 'Quem executou foi a pro3');
  perform pg_temp.su();
  perform pg_temp.chk('G15 sem evento de repasse para atendimento que nunca foi realizado', pg_temp.ev('appointment_canceled', 'ap_fut') = 0, null);
  perform pg_temp.chk('G17 participantes trocados com motivo; o repasse recebe o evento com a nova lista', pg_temp.ev('appointment_participants_changed', 'ap2') = 1
    and (select count(*) from public.fin_appointment_participants where appointment_id = pg_temp.f('ap2') and professional_id = pg_temp.f('pro_pro3') and role = 'executor') = 1, null);
end $t$;

-- ---------- H. Pacotes: venda, saldo, rateio, sessão no atendimento ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid; pp uuid;
begin
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk1'), 'quantity', 1)));
  perform pg_temp.su();
  insert into fx values ('sale_pk', s);
  select id into pp from public.fin_patient_packages where sale_id = s;
  insert into fx values ('pp1', pp);
  insert into fx select 'ppi_cons', id from public.fin_patient_package_items where patient_package_id = pp and item_type = 'service';
  insert into fx select 'ppi_sup', id from public.fin_patient_package_items where patient_package_id = pp and item_type = 'product';
  perform pg_temp.chk('H1 a venda do pacote vira saldo do paciente: 3 consultas + 3 suplementos, validade 90 dias, R$ 1.800,00',
    (select count(*) from public.fin_patient_package_items where patient_package_id = pp) = 2 and (select qty_total from public.fin_patient_package_items where id = pg_temp.f('ppi_cons')) = 3
    and (select qty_total from public.fin_patient_package_items where id = pg_temp.f('ppi_sup')) = 3 and (select expires_on from public.fin_patient_packages where id = pp) = private.fin_today() + 90
    and (select price_cents from public.fin_patient_packages where id = pp) = 180000, null);
  perform pg_temp.chk('H2 rateio do valor pago (§5.4): consultas R$ 1.323,54 (3 × R$ 441,18) + suplementos R$ 476,46 = R$ 1.800,00',
    (select net_total_cents from public.fin_patient_package_items where id = pg_temp.f('ppi_cons')) = 132354 and (select net_total_cents from public.fin_patient_package_items where id = pg_temp.f('ppi_sup')) = 47646, null);
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat2'), jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk1'), 'quantity', 1, 'discount_pct', 10)));
  perform pg_temp.su();
  select id into pp from public.fin_patient_packages where sale_id = s; insert into fx values ('pp2', pp);
  perform pg_temp.chk('H3 com 10% de desconto o rateio usa o líquido (R$ 1.620,00): consultas R$ 1.191,19 + suplementos R$ 428,81',
    (select price_cents from public.fin_patient_packages where id = pp) = 162000 and (select net_total_cents from public.fin_patient_package_items where patient_package_id = pp and item_type = 'service') = 119119
    and (select net_total_cents from public.fin_patient_package_items where patient_package_id = pp and item_type = 'product') = 42881, null);
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat2'), jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk1'), 'quantity', 2)));
  perform pg_temp.su();
  perform pg_temp.chk('H4 duas unidades vendidas = dois pacotes do paciente (seq 1 e 2) que somam o líquido da venda',
    (select count(*) from public.fin_patient_packages where sale_id = s) = 2 and (select sum(price_cents) from public.fin_patient_packages where sale_id = s) = 360000, null);
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('H5 pacote em quantidade fracionada não é vendido', '22023', format($q$select public.fin_save_sale(%L, %L, %L, %L::jsonb)$q$, c, u1, pg_temp.f('pat'),
    jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk1'), 'quantity', 1.5))::text), 'PACKAGE_QUANTITY_INTEGER');
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); v uuid; i integer; vals bigint[] := '{}'; ppi uuid := pg_temp.f('ppi_cons');
begin
  for i in 1..3 loop   -- 3 sessões de consulta pelo pacote
    perform pg_temp.as_user('gestor');
    v := pg_temp.appt('ap_s' || i, 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('patient_package_item_id', ppi::text));
    perform public.fin_appt_complete(v, null);
    perform pg_temp.su();
    vals := vals || (select base_value_cents from public.fin_appointments where id = v)::bigint;
  end loop;
  perform pg_temp.chk('H6 três sessões consomem o saldo (3/3) e cada uma leva o valor rateado: R$ 441,18 + R$ 441,18 + R$ 441,18', vals = array[44118, 44118, 44118]::bigint[]
    and (select qty_used from public.fin_patient_package_items where id = ppi) = 3, vals::text);
  perform pg_temp.chk('H7 razão do pacote: 3 consumos de sessão com valor, ligados ao atendimento', (select count(*) from public.fin_package_ledger where patient_package_item_id = ppi and kind = 'session_use' and appointment_id is not null) = 3
    and (select sum(value_cents) from public.fin_package_ledger where patient_package_item_id = ppi) = 132354, null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('H8 4ª sessão: sem saldo → recusa ao registrar', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('patient_package_item_id', %L))$q$, ppi::text), 'NO_SESSIONS_LEFT');
  perform public.fin_appt_cancel(pg_temp.f('ap_s2'), 'Sessão lançada por engano');
  perform pg_temp.su();
  perform pg_temp.chk('H9 cancelar a sessão devolve o saldo (2/3) e o valor sai da razão (lançamento negativo)', (select qty_used from public.fin_patient_package_items where id = ppi) = 2
    and (select sum(value_cents) from public.fin_package_ledger where patient_package_item_id = ppi) = 132354 - 44118 and exists (select 1 from public.fin_package_ledger where kind = 'session_restore' and qty = -1 and value_cents = -44118), null);
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('H10 pacote de OUTRO paciente → recusa', '22023', format($q$select pg_temp.appt('x', 'pat2', 'sv3', pg_temp.parts('pro'), jsonb_build_object('patient_package_item_id', %L))$q$, ppi::text), 'INVALID_PACKAGE_LINK');
  perform pg_temp.expect('H11 sessão de OUTRO serviço → recusa', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv1', pg_temp.parts('pro'), jsonb_build_object('patient_package_item_id', %L))$q$, ppi::text), 'INVALID_PACKAGE_LINK');
  perform pg_temp.expect('H12 venda e pacote juntos → recusa', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('patient_package_item_id', %L, 'sale_item_id', %L))$q$, ppi::text, (select id from public.fin_sale_items limit 1)::text), 'LINK_CONFLICT');
  perform pg_temp.su();
  update public.fin_patient_packages set expires_on = private.fin_today() - 1 where id = pg_temp.f('pp1');
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('H13 pacote vencido não consome sessão (saldo vira receita da clínica, sem repasse)', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('patient_package_item_id', %L))$q$, ppi::text), 'PACKAGE_EXPIRED');
  perform pg_temp.su();
  update public.fin_patient_packages set expires_on = private.fin_today() + 90 where id = pg_temp.f('pp1');
end $t$;

-- ---------- I. Entrega de item de pacote e devolução de paciente ----------
do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); sup uuid := pg_temp.f('ppi_sup'); r jsonb; mv uuid; c_before numeric; ret uuid; s uuid; sm uuid;
begin
  c_before := pg_temp.bal('it_c','u1');
  perform pg_temp.as_user('recep');
  r := public.fin_package_deliver(sup, 1, '{}'::jsonb);
  perform pg_temp.su();
  perform pg_temp.chk('H14 E17: a entrega baixa o estoque (1 suplemento a R$ 60,00) e cobre o pacote pela data da entrega; a Recepção entrega sem ver custo',
    pg_temp.bal('it_c','u1') = c_before - 1 and (select qty_used from public.fin_patient_package_items where id = sup) = 1 and (r->>'remaining')::numeric = 2 and (r::text not like '%cost%'), r::text);
  mv := (r->'movement_ids'->>0)::uuid;
  perform pg_temp.chk('H15 movimentação «entrega de item de pacote» ligada ao paciente; valor rateado do item na razão = R$ 158,82',
    (select movement_type from public.stock_movements where id = mv) = 'package_delivery' and (select patient_id from public.stock_movements where id = mv) = pg_temp.f('pat')
    and exists (select 1 from public.fin_package_ledger where kind = 'delivery' and patient_package_item_id = sup and value_cents = 15882 and mv = any (stock_movement_ids)), null);
  perform pg_temp.chk('H16 o repasse (comissão) recebe o evento da entrega, com a data', exists (select 1 from public.fin_events where event_type = 'package_item_delivered' and (payload->>'patient_package_item_id')::uuid = sup and (payload->>'value_cents')::bigint = 15882), null);
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('H17 Financeiro não entrega (consulta)', '42501', format($q$select public.fin_package_deliver(%L, 1)$q$, sup));
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.expect('H18 Profissional (sem papel) não entrega', '42501', format($q$select public.fin_package_deliver(%L, 1)$q$, sup));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('H19 entrega de quantidade fracionada → recusa', '22023', format($q$select public.fin_package_deliver(%L, 0.5)$q$, sup), 'INVALID_QUANTITY');
  perform pg_temp.expect('H20 entregar mais do que o saldo do pacote (2 restantes) → recusa', '22023', format($q$select public.fin_package_deliver(%L, 3)$q$, sup), 'NO_ITEMS_LEFT');
  perform public.fin_package_deliver(sup, 2);
  perform pg_temp.expect('H21 saldo do item esgotado (3/3) → recusa', '22023', format($q$select public.fin_package_deliver(%L, 1)$q$, sup), 'NO_ITEMS_LEFT');
  perform pg_temp.su();
  perform pg_temp.chk('H22 as 3 entregas somam o valor líquido do item (R$ 476,46) — a última leva a sobra do arredondamento', (select sum(value_cents) from public.fin_package_ledger where patient_package_item_id = sup) = 47646, null);
  -- devolução de paciente
  perform pg_temp.as_user('fin');
  perform pg_temp.expect('H23 Financeiro não registra devolução (consulta)', '42501', format($q$select public.fin_stock_patient_return(%L, 1, 'Devolveu')$q$, mv));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('H24 devolução exige motivo', '22023', format($q$select public.fin_stock_patient_return(%L, 1, '')$q$, mv), 'REASON_REQUIRED');
  perform pg_temp.expect('H25 não devolve mais do que saiu (1 entregue)', '22023', format($q$select public.fin_stock_patient_return(%L, 2, 'Devolveu')$q$, mv), 'RETURN_EXCEEDS_ORIGIN');
  perform pg_temp.expect('H26 estorno manual de entrega é bloqueado (use devolução)', '22023', format($q$select public.fin_stock_reverse(%L, 'Tentativa')$q$, mv), 'DELIVERY_USE_RETURN');
  perform pg_temp.su();
  c_before := pg_temp.bal('it_c','u1');
  perform pg_temp.as_user('estoq');
  ret := public.fin_stock_patient_return(mv, 1, 'Paciente devolveu o frasco fechado');
  perform pg_temp.su();
  perform pg_temp.chk('H27 devolução volta ao estoque no MESMO lote e ao custo da saída original (R$ 60,00); saldo +1', pg_temp.bal('it_c','u1') = c_before + 1
    and (select unit_cost_cents from public.stock_movements where id = ret) = 6000 and (select total_cost_cents from public.stock_movements where id = ret) = 6000 and (select lot_id from public.stock_movements where id = ret) = (select lot_id from public.stock_movements where id = mv)
    and (select movement_type from public.stock_movements where id = ret) = 'patient_return', null);
  perform pg_temp.chk('H28 a entrega devolvida reabre 1 item no pacote (qty_used 2/3) e entra na razão como negativo', (select qty_used from public.fin_patient_package_items where id = sup) = 2
    and exists (select 1 from public.fin_package_ledger where kind = 'delivery_return' and qty = -1) and exists (select 1 from public.fin_events where event_type = 'package_item_returned' and (payload->>'patient_package_item_id')::uuid = sup), null);
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('H29 devolução não se estorna à mão', '22023', format($q$select public.fin_stock_reverse(%L, 'Tentativa')$q$, ret), 'RETURN_NOT_REVERSIBLE');
  perform pg_temp.su();
  -- devolução parcial de venda de produto e depois cancelamento da venda
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type', 'product', 'ref_id', pg_temp.f('it_c'), 'quantity', 2)));
  perform pg_temp.su();
  select id into sm from public.stock_movements where sale_id = s and movement_type = 'sale';
  c_before := pg_temp.bal('it_c','u1');
  perform pg_temp.as_user('estoq');
  perform public.fin_stock_patient_return(sm, 1, 'Devolveu 1 unidade');
  perform pg_temp.su();
  perform pg_temp.chk('H30 devolução PARCIAL de venda: 1 de 2 volta (saldo +1)', pg_temp.bal('it_c','u1') = c_before + 1, null);
  perform pg_temp.as_user('fin');
  perform public.fin_cancel_sale(s, 'Cliente desistiu');
  perform pg_temp.su();
  perform pg_temp.chk('H31 cancelar a venda depois da devolução parcial devolve só o RESTANTE (a unidade já devolvida não volta duas vezes): saldo igual ao de antes da venda', pg_temp.bal('it_c','u1') = c_before + 2, pg_temp.bal('it_c','u1')::text);
  perform pg_temp.as_user('estoq');
  perform pg_temp.expect('H32 depois de cancelada, a venda não aceita nova devolução', '22023', format($q$select public.fin_stock_patient_return(%L, 1, 'Outra')$q$, sm), 'RETURN_EXCEEDS_ORIGIN');
  perform pg_temp.expect('H33 saída que não é venda nem entrega não é devolução de paciente', '22023',
    format($q$select public.fin_stock_patient_return(%L, 1, 'Teste')$q$, (select id from public.stock_movements where movement_type = 'appointment' and qty < 0 limit 1)), 'RETURN_NOT_ALLOWED');
  perform pg_temp.su();
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); u1 uuid := pg_temp.f('u1'); s uuid; pp uuid; ppi uuid; v uuid;
begin
  -- entrega com estoque insuficiente bloqueia e não grava nada
  perform pg_temp.as_user('recep');
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type', 'package', 'ref_id', pg_temp.f('pk2'), 'quantity', 1)));
  perform pg_temp.su();
  select pi.id, pp2.id into ppi, pp from public.fin_patient_package_items pi join public.fin_patient_packages pp2 on pp2.id = pi.patient_package_id where pp2.sale_id = s;
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('H34 entrega de item sem estoque lançado → bloqueada', '22023', format($q$select public.fin_package_deliver(%L, 1)$q$, ppi), 'INSUFFICIENT_STOCK');
  perform pg_temp.su();
  perform pg_temp.chk('H35 ... e o saldo do pacote não mudou', (select qty_used from public.fin_patient_package_items where id = ppi) = 0 and not exists (select 1 from public.fin_package_ledger where patient_package_item_id = ppi), null);
  -- cancelar a venda do pacote fecha o pacote
  perform pg_temp.as_user('fin');
  perform public.fin_cancel_sale(s, 'Venda lançada errada');
  perform pg_temp.su();
  perform pg_temp.chk('H36 cancelar a venda do pacote cancela o pacote do paciente', (select status from public.fin_patient_packages where id = pp) = 'canceled', null);
  perform pg_temp.as_user('recep');
  perform pg_temp.expect('H37 pacote cancelado não entrega', '22023', format($q$select public.fin_package_deliver(%L, 1)$q$, ppi), 'PACKAGE_CANCELED');
  -- venda de serviço avulso ligada ao atendimento
  s := public.fin_save_sale(c, u1, pg_temp.f('pat'), jsonb_build_array(jsonb_build_object('item_type', 'service', 'ref_id', pg_temp.f('sv3'), 'quantity', 1, 'discount_pct', 10)));
  perform pg_temp.su();
  insert into fx select 'si_cons', id from public.fin_sale_items where sale_id = s;
  perform pg_temp.as_user('gestor');
  v := pg_temp.appt('ap_v1', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('sale_item_id', pg_temp.f('si_cons')::text));
  perform public.fin_appt_complete(v, null);
  perform pg_temp.expect('H39 o mesmo item de venda (1 unidade) não cobre um 2º atendimento', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('sale_item_id', %L))$q$, pg_temp.f('si_cons')::text), 'SALE_ITEM_CONSUMED');
  perform pg_temp.su();
  perform pg_temp.chk('H38 atendimento ligado à venda: vínculo gravado e valor-base = líquido da venda (R$ 450,00)', (select sale_id from public.fin_appointments where id = v) = s and (select base_value_cents from public.fin_appointments where id = v) = 45000, null);
  perform pg_temp.as_user('fin');
  perform public.fin_cancel_sale(s, 'Cancelada');
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  perform pg_temp.expect('H40 venda cancelada não cobre atendimento novo', '22023', format($q$select pg_temp.appt('x', 'pat', 'sv3', pg_temp.parts('pro'), jsonb_build_object('sale_item_id', %L))$q$, pg_temp.f('si_cons')::text), 'SALE_CANCELED');
  -- fila «atendido sem venda»
  perform pg_temp.chk('H41 «atendido sem venda»: a fila lista só os realizados sem venda nem pacote', (select count(*) from public.fin_appt_list(c, null, null, null, null, null, null, true) l where l.without_sale) >= 3
    and not exists (select 1 from public.fin_appt_list(c, null, null, null, null, null, null, true) l where l.id = pg_temp.f('ap_s1') or l.id = pg_temp.f('ap_v1')), null);
  perform pg_temp.su();
end $t$;

-- ---------- J. Pacotes dos pacientes: quem lê o quê ----------
do $t$
declare c uuid := pg_temp.f('c'); n integer; j jsonb;
begin
  perform pg_temp.as_user('recep');
  select count(*) into n from public.fin_patient_packages_list(c);
  perform pg_temp.chk('I1 Recepção lista os pacotes dos pacientes (saldo de sessões e itens, com valor)', n >= 4 and exists (select 1 from public.fin_patient_packages_list(c, pg_temp.f('pat')) l where l.name = 'Programa Emagrecer' and l.price_cents = 180000
    and jsonb_array_length(l.items) = 2), n::text);
  perform pg_temp.chk('I2 ... e pela tabela (RLS)', (select count(*) from public.fin_patient_packages) >= 4, null);
  perform pg_temp.su();
  perform pg_temp.as_user('pro');
  perform pg_temp.chk('I3 Profissional com acesso ao paciente vê o saldo, SEM valores', exists (select 1 from public.fin_patient_packages_list(c, pg_temp.f('pat')) l where l.price_cents is null and (l.items->0->>'net_total_cents') is null), null);
  perform pg_temp.expect('I4 ... mas não lista os pacotes de todos', '42501', format($q$select * from public.fin_patient_packages_list(%L)$q$, c));
  perform pg_temp.chk('I5 ... nem pela tabela (RLS): vazia', (select count(*) from public.fin_patient_packages) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('pro2');
  perform pg_temp.expect('I6 Profissional sem vínculo com o paciente não vê os pacotes dele', '42501', format($q$select * from public.fin_patient_packages_list(%L, %L)$q$, c, pg_temp.f('pat2')));
  perform pg_temp.su();
  perform pg_temp.as_user('estoq');
  perform pg_temp.chk('I7 Estoquista não lê saldo de pacote (RLS)', (select count(*) from public.fin_patient_packages) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('other');
  perform pg_temp.expect('I8 outra clínica: nada', '42501', format($q$select * from public.fin_patient_packages_list(%L)$q$, c));
  perform pg_temp.chk('I9 ... nem pela tabela', (select count(*) from public.fin_patient_packages) = 0, null);
  perform pg_temp.su();
  perform pg_temp.as_user('gestor');
  j := public.fin_appt_context(c, pg_temp.f('u1'), pg_temp.f('pat'), pg_temp.f('sv3'));
  perform pg_temp.chk('I10b o contexto traz as unidades ativas (o profissional sem papel financeiro não lê clinic_units)', jsonb_array_length(public.fin_appt_context(c, null, null, null)->'units') = 2, null);
  perform pg_temp.chk('I10 contexto do «Novo atendimento»: papéis do serviço, profissionais e pacote do paciente com sessões restantes', jsonb_array_length(j->'professionals') >= 7 and (j->'roles') = '["responsavel"]'::jsonb
    and jsonb_array_length(j->'packages') = 1 and (j->'packages'->0->>'remaining')::numeric = 1, j::text);
  perform pg_temp.su();
end $t$;

-- ---------- K. Sem exclusão física, razão imutável, invariantes de estoque ----------
do $t$
declare bad integer;
begin
  perform pg_temp.expect('K1 atendimento não se apaga', '42501', format($q$delete from public.fin_appointments where id = %L$q$, pg_temp.f('ap2')), 'RECORD_NOT_DELETABLE');
  perform pg_temp.expect('K2 material do atendimento não se apaga', '42501', 'delete from public.fin_appointment_materials', 'RECORD_NOT_DELETABLE');
  perform pg_temp.expect('K3 consumo sem saldo não se apaga', '42501', 'delete from public.stock_shortfalls', 'RECORD_NOT_DELETABLE');
  perform pg_temp.expect('K4 razão do pacote não se edita', '42501', 'update public.fin_package_ledger set value_cents = 1', 'RECORD_IMMUTABLE');
  perform pg_temp.expect('K5 razão do pacote não se apaga', '42501', 'delete from public.fin_package_ledger', 'RECORD_IMMUTABLE');
  perform pg_temp.expect('K6 devolução de paciente não se edita', '42501', 'update public.stock_patient_returns set qty = 99', 'RECORD_IMMUTABLE');
  perform pg_temp.expect('K7 pacote do paciente não se apaga', '42501', 'delete from public.fin_patient_packages', 'RECORD_NOT_DELETABLE');
  perform pg_temp.expect('K8 TRUNCATE do atendimento também é barrado', '42501', 'truncate public.fin_appointments cascade', 'RECORD_NOT_DELETABLE');
  select count(*) into bad from public.stock_balances b
   where b.qty_on_hand <> coalesce((select sum(l.qty_on_hand) from public.stock_lots l where l.item_id = b.item_id and l.unit_id = b.unit_id), 0)
      or b.qty_on_hand <> coalesce((select sum(m.qty) from public.stock_movements m where m.item_id = b.item_id and m.unit_id = b.unit_id), 0);
  perform pg_temp.chk('K9 invariante: saldo = soma dos lotes = soma das movimentações em TODO item e unidade (depois de kit, correção, cancelamento, entrega e devolução)', bad = 0, bad::text);
  select count(*) into bad from public.fin_appointments a where a.status <> 'canceled'
     and a.material_cost_cents <> coalesce((select sum(m.cost_cents + m.estimated_cents) from public.fin_appointment_materials m where m.appointment_id = a.id and m.status = 'active'), 0);
  perform pg_temp.chk('K10 invariante: custo do material do atendimento = soma dos materiais ativos', bad = 0, bad::text);
  select count(*) into bad from public.fin_patient_package_items i where i.qty_used <> coalesce((select sum(l.qty) from public.fin_package_ledger l where l.patient_package_item_id = i.id), 0);
  perform pg_temp.chk('K11 invariante: quantidade usada do pacote = soma da razão do pacote', bad = 0, bad::text);
  select count(*) into bad from public.stock_shortfalls s where s.status = 'open' and not exists (select 1 from public.fin_appointment_materials m where m.id = s.material_id and m.status = 'active' and m.short_qty >= s.qty);
  perform pg_temp.chk('K12 invariante: toda sobra aberta aponta para um material ativo com a falta correspondente', bad = 0, bad::text);
  perform pg_temp.chk('K13 Histórico: pacote criado, entrega e consumo sem saldo no log de auditoria', exists (select 1 from public.fin_audit_log where entity = 'patient_package' and action = 'create')
    and exists (select 1 from public.fin_audit_log where entity = 'patient_package' and action = 'update' and reason = 'Entrega de item do pacote') and exists (select 1 from public.fin_audit_log where entity = 'stock_shortfall'), null);
  perform pg_temp.chk('K14 toda escrita tem autor no log', not exists (select 1 from public.fin_audit_log where entity in ('appointment','patient_package','stock_shortfall') and user_profile_id is null), null);
end $t$;

select n, case when ok then 'OK ' else 'FALHA' end as resultado, name, case when ok then '' else detail end as detalhe from tr order by n;
select count(*) filter (where ok) as passaram, count(*) filter (where not ok) as falharam from tr;
rollback;
