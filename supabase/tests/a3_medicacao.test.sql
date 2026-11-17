-- Prova SQL da automação A3 (medicação). Roda em begin..rollback; a última consulta devolve "<n>|<falhas>".
-- Uso: scripts/a3-sql-proof.sh
begin;
create temp table tr (n serial, name text, ok boolean, detail text);
create temp table fx (k text primary key, v uuid);
grant all on tr, fx to authenticated; grant usage, select on sequence tr_n_seq to authenticated;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$ insert into tr(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
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
grant execute on function pg_temp.chk(text, boolean, text), pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.expect(text, text, text, text) to public;

-- ---------- Fixture ----------
do $t$
declare c uuid; c2 uuid; u1 uuid; k text; pid uuid; pro uuid; v_pat uuid; v_pat2 uuid; v_pat_b uuid; v_id uuid;
begin
  foreach k in array array['owner','medico','nutri','edu','recep','estoq','other','pac','pac2','pacb'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid;
    insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica A', pg_temp.f('prof_owner')) returning id into c;
  insert into public.clinics (name, owner_profile_id) values ('Clínica B', pg_temp.f('prof_other')) returning id into c2;
  insert into fx values ('c', c), ('c2', c2);
  foreach k in array array['owner','medico','nutri','edu','recep','estoq'] loop
    insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_' || k), c, case when k = 'owner' then 'admin' end) returning id into pro;
    insert into fx values ('pro_' || k, pro);
  end loop;
  insert into public.professionals (profile_id, clinic_id, clinic_role) values (pg_temp.f('prof_other'), c2, 'admin');
  insert into public.professional_disciplines values (pg_temp.f('pro_medico'), 'medico'), (pg_temp.f('pro_nutri'), 'nutricionista'), (pg_temp.f('pro_edu'), 'educador_fisico');
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values (c, pg_temp.f('pro_recep'), 'recepcao'), (c, pg_temp.f('pro_estoq'), 'estoquista');
  select id into u1 from public.clinic_units where clinic_id = c and is_primary; insert into fx values ('u1', u1);
  insert into public.patients (profile_id, clinic_id) values (pg_temp.f('prof_pac'), c) returning id into v_pat; insert into fx values ('pat', v_pat);
  insert into public.patients (profile_id, clinic_id) values (pg_temp.f('prof_pac2'), c) returning id into v_pat2; insert into fx values ('pat2', v_pat2);
  insert into public.patients (profile_id, clinic_id) values (pg_temp.f('prof_pacb'), c2) returning id into v_pat_b; insert into fx values ('patb', v_pat_b);
  -- médico, nutri e educador acompanham a Mariana (pat); só o médico acompanha pat2? não: ninguém além do admin
  insert into public.professional_patient_links (professional_id, patient_id) values
    (pg_temp.f('pro_medico'), v_pat), (pg_temp.f('pro_nutri'), v_pat), (pg_temp.f('pro_edu'), v_pat);
  -- recepção e estoquista vinculados por engano de teste? NÃO: só papel financeiro; a prova é que sem vínculo/discipline não leem.
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control)
    values (c, 'Tirzepatida caneta', 'med', 'medication', 'cx', 'caneta', 'caneta', true) returning id into v_id; insert into fx values ('item', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit) values (c, 'Seringa', 'mat', 'consumable', 'cx', 'un', 'un') returning id into v_id; insert into fx values ('item_cons', v_id);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control) values (c2, 'Item B', 'med', 'medication', 'cx', 'un', 'un', true) returning id into v_id; insert into fx values ('item_b', v_id);
end $t$;

-- saldo inicial: 3 canetas (como gestor/dono)
select pg_temp.as_user('owner');
select public.fin_stock_entry(pg_temp.f('c'), pg_temp.f('u1'), jsonb_build_object('entry_type', 'initial_balance', 'supplier_new', jsonb_build_object('name', 'Forn')),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.f('item'), 'quantity', 3, 'unit_cost_cents', 90000, 'lot_code', 'L1', 'expiry_date', (current_date + 200)::text)));
select pg_temp.su();

create function pg_temp.today() returns date language sql as $$ select private.brt_date(now()) $$;
create function pg_temp.dow(p_d date) returns int language sql as $$ select extract(dow from p_d)::int $$;
create function pg_temp.bal() returns numeric language sql as $$ select qty_on_hand from public.stock_balances where item_id = pg_temp.f('item') and unit_id = pg_temp.f('u1') $$;
grant execute on function pg_temp.today(), pg_temp.dow(date), pg_temp.bal() to public;

-- ---------- A. Permissões ----------
select pg_temp.as_user('medico');
do $t$ declare v uuid; begin
  v := public.med_save_treatment(pg_temp.f('pat'), null, null, pg_temp.today() - 14, 2.5, pg_temp.dow(pg_temp.today()), 'home', 'Primeiro ciclo');
  insert into fx values ('tr', v);
  perform pg_temp.chk('A1 Médico cadastra o tratamento (padrão Tirzepatida)', (select medication = 'Tirzepatida' and dose_mg = 2.5 and weekday = pg_temp.dow(pg_temp.today()) from public.patient_med_treatments where id = v));
  perform pg_temp.chk('A2 Dose inicial vira a 1ª linha do histórico', (select count(*) = 1 and min(dose_mg) = 2.5 and min(effective_on) = pg_temp.today() - 14 from public.patient_med_doses where treatment_id = v));
end $t$;
select pg_temp.su();
select pg_temp.as_user('nutri');
select pg_temp.expect('A3 Nutricionista também edita (ajusta a dose)', null, format($q$select public.med_adjust_dose(%L, 5, pg_temp.today(), 'Subiu')$q$, pg_temp.f('tr')));
select pg_temp.su();
select pg_temp.as_user('edu');
select pg_temp.expect('A4 Educador físico NÃO edita', '42501', format($q$select public.med_adjust_dose(%L, 7.5, pg_temp.today(), null)$q$, pg_temp.f('tr')));
select pg_temp.expect('A5 ... nem cadastra', '42501', format($q$select public.med_save_treatment(%L, null, null, pg_temp.today(), 2.5, 1, 'home', null)$q$, pg_temp.f('pat')));
select pg_temp.chk('A6 ... mas LÊ (vinculado ao paciente)', (select count(*) = 1 from public.patient_med_treatments));
select pg_temp.su();
select pg_temp.as_user('recep');
select pg_temp.chk('A7 Recepção NÃO vê tratamento, dose, aplicação nem entrega', (select (select count(*) from public.patient_med_treatments) + (select count(*) from public.patient_med_doses)
  + (select count(*) from public.patient_med_applications) + (select count(*) from public.patient_med_deliveries)) = 0);
select pg_temp.expect('A8 Recepção NÃO cadastra', '42501', format($q$select public.med_save_treatment(%L, null, null, pg_temp.today(), 2.5, 1, 'home', null)$q$, pg_temp.f('pat')));
select pg_temp.expect('A9 Recepção NÃO lista itens de estoque pela ficha', '42501', format($q$select * from public.med_stock_options(%L)$q$, pg_temp.f('pat')));
select pg_temp.su();
select pg_temp.as_user('estoq');
select pg_temp.chk('A10 Estoquista NÃO vê a ficha (nada de medicação)', (select count(*) from public.patient_med_treatments) = 0);
select pg_temp.expect('A11 Estoquista NÃO registra aplicação', '42501', format($q$select public.med_record_application(%L, pg_temp.today(), 2.5, 'clinic')$q$, pg_temp.f('tr')));
select pg_temp.su();
select pg_temp.as_user('other');
select pg_temp.chk('A12 Admin de OUTRA clínica não vê', (select count(*) from public.patient_med_treatments) = 0);
select pg_temp.expect('A13 ... nem edita', '42501', format($q$select public.med_end_treatment(%L)$q$, pg_temp.f('tr')));
select pg_temp.su();
select pg_temp.as_user('owner');
select pg_temp.chk('A14 Admin da clínica LÊ', (select count(*) = 1 from public.patient_med_treatments));
select pg_temp.expect('A15 Admin sem disciplina clínica NÃO edita (mesma regra do prontuário)', '42501', format($q$select public.med_adjust_dose(%L, 7.5, pg_temp.today(), null)$q$, pg_temp.f('tr')));
select pg_temp.su();
select pg_temp.as_user('medico');
select pg_temp.expect('A16 Escrita direta na tabela é negada', '42501', $q$update public.patient_med_treatments set dose_mg = 99$q$);
select pg_temp.expect('A17 Insert direto é negado', '42501', format($q$insert into public.patient_med_applications (treatment_id, patient_id, clinic_id, applied_on, dose_mg, place, source) values (%L, %L, %L, current_date, 1, 'home', 'patient')$q$, pg_temp.f('tr'), pg_temp.f('pat'), pg_temp.f('c')));
select pg_temp.su();

-- ---------- B. Tratamento, dose e histórico ----------
select pg_temp.as_user('medico');
select pg_temp.expect('B1 Segundo tratamento ativo da MESMA medicação = bloqueado', '23505', format($q$select public.med_save_treatment(%L, null, ' tirzepatida ', pg_temp.today(), 5, 1, 'home', null)$q$, pg_temp.f('pat')));
select pg_temp.expect('B2 Outra medicação (campo livre) é aceita', null, format($q$select public.med_save_treatment(%L, null, 'Semaglutida', pg_temp.today(), 0.25, 3, 'clinic', 'teste')$q$, pg_temp.f('pat')));
select pg_temp.expect('B2b Encerra a outra medicação (para não misturar com o resto da prova)', null, format($q$select public.med_end_treatment((select id from public.patient_med_treatments where medication = 'Semaglutida'))$q$));
select pg_temp.expect('B3 Dia da semana inválido = 22023', '22023', format($q$select public.med_save_treatment(%L, null, 'X', pg_temp.today(), 1, 7, 'home', null)$q$, pg_temp.f('pat')));
select pg_temp.expect('B4 Local inválido = 22023', '22023', format($q$select public.med_save_treatment(%L, null, 'X', pg_temp.today(), 1, 2, 'rua', null)$q$, pg_temp.f('pat')));
select pg_temp.expect('B5 Dose zero/negativa = 22023', '22023', format($q$select public.med_save_treatment(%L, null, 'Y', pg_temp.today(), 0, 2, 'home', null)$q$, pg_temp.f('pat')));
select pg_temp.expect('B6 Paciente de outra clínica = 42501', '42501', format($q$select public.med_save_treatment(%L, null, null, pg_temp.today(), 2.5, 1, 'home', null)$q$, pg_temp.f('patb')));
select pg_temp.expect('B7 Mesma dose = DOSE_UNCHANGED', '22023', format($q$select public.med_adjust_dose(%L, 5, pg_temp.today(), null)$q$, pg_temp.f('tr')), 'DOSE_UNCHANGED');
select pg_temp.chk('B8 Ajuste de dose: dose atual 5 mg e histórico com 2 linhas datadas (2,5 em início, 5 hoje)',
  (select dose_mg = 5 from public.patient_med_treatments where id = pg_temp.f('tr'))
  and (select count(*) = 2 and bool_or(dose_mg = 5 and effective_on = pg_temp.today() and note = 'Subiu') and bool_or(dose_mg = 2.5) from public.patient_med_doses where treatment_id = pg_temp.f('tr')));
select pg_temp.expect('B9 Editar o tratamento (dia e onde) mantém a dose', null, format($q$select public.med_save_treatment(%L, %L, 'Tirzepatida', %L, null, pg_temp.dow(pg_temp.today()), 'clinic', 'Agora na clínica')$q$, pg_temp.f('pat'), pg_temp.f('tr'), (current_date - 14)::text));
select pg_temp.chk('B10 ... dose segue 5 mg e local = clinic', (select dose_mg = 5 and applied_where = 'clinic' from public.patient_med_treatments where id = pg_temp.f('tr')));
select pg_temp.su();

-- ---------- C. Estado de hoje / atrasada (derivado, America/Sao_Paulo) ----------
select pg_temp.chk('C1 Dia da aplicação = hoje, sem registro → today', (private.med_state(pg_temp.f('tr'), pg_temp.today())->>'state') = 'today');
select pg_temp.chk('C2 Dia seguinte sem registro → overdue com 1 dia', (private.med_state(pg_temp.f('tr'), pg_temp.today() + 1)->>'state') = 'overdue' and (private.med_state(pg_temp.f('tr'), pg_temp.today() + 1)->>'days_late')::int = 1);
select pg_temp.chk('C3 6 dias depois ainda atrasada (6 dias)', (private.med_state(pg_temp.f('tr'), pg_temp.today() + 6)->>'days_late')::int = 6);
select pg_temp.chk('C4 Na semana seguinte vira today de novo (a de antes fica no histórico, sem acumular)', (private.med_state(pg_temp.f('tr'), pg_temp.today() + 7)->>'state') = 'today');
select pg_temp.chk('C5 Início no futuro → upcoming', (select (private.med_state(id, started_on - 1)->>'state') = 'upcoming' from public.patient_med_treatments where id = pg_temp.f('tr')));

-- ---------- D. Aplicação feita + estoque ----------
select pg_temp.as_user('medico');
select pg_temp.expect('D1 Aplicação em casa sem item: só registra', null, format($q$select public.med_record_application(%L, pg_temp.today() - 7, 5, 'home', 'sem item')$q$, pg_temp.f('tr')));
select pg_temp.su();
select pg_temp.chk('D2 ... saldo intacto (3)', pg_temp.bal() = 3);
select pg_temp.as_user('medico');
select pg_temp.expect('D3 Data futura = 22023', '22023', format($q$select public.med_record_application(%L, pg_temp.today() + 1, 5, 'home')$q$, pg_temp.f('tr')));
select pg_temp.expect('D4 Mesmo dia duas vezes = APPLICATION_EXISTS', '23505', format($q$select public.med_record_application(%L, pg_temp.today() - 7, 5, 'home')$q$, pg_temp.f('tr')), 'APPLICATION_EXISTS');
select pg_temp.expect('D5 Baixa em casa = STOCK_ONLY_CLINIC', '22023', format($q$select public.med_record_application(%L, pg_temp.today() - 1, 5, 'home', null, %L, %L)$q$, pg_temp.f('tr'), pg_temp.f('item'), pg_temp.f('u1')), 'STOCK_ONLY_CLINIC');
select pg_temp.expect('D6 Item de OUTRA clínica = INVALID_ITEM', '22023', format($q$select public.med_record_application(%L, pg_temp.today() - 1, 5, 'clinic', null, %L, %L)$q$, pg_temp.f('tr'), pg_temp.f('item_b'), pg_temp.f('u1')), 'INVALID_ITEM');
select pg_temp.chk('D7 Lista de itens para o seletor traz só medicamento com saldo (1 item, 3 un.)', (select count(*) = 1 and min(qty_on_hand) = 3 from public.med_stock_options(pg_temp.f('pat'))));
select pg_temp.expect('D8 Aplicação NA CLÍNICA com item: baixa 1', null, format($q$select public.med_record_application(%L, pg_temp.today(), 5, 'clinic', 'Clínica', %L, %L)$q$, pg_temp.f('tr'), pg_temp.f('item'), pg_temp.f('u1')));
select pg_temp.su();
select pg_temp.chk('D9 ... saldo 3 → 2 e 1 movimentação do paciente no kardex', pg_temp.bal() = 2 and (select count(*) = 1 and min(qty) = -1 from public.stock_movements where patient_id = pg_temp.f('pat') and item_id = pg_temp.f('item') and movement_type = 'appointment'));
select pg_temp.chk('D10 ... a aplicação guarda o id da movimentação e o item', (select cardinality(stock_movement_ids) = 1 and stock_item_id = pg_temp.f('item') and applied_by_name = 'U medico' from public.patient_med_applications where applied_on = pg_temp.today() and treatment_id = pg_temp.f('tr')));
select pg_temp.chk('D11 Hoje já registrado → estado ok (não acusa atraso)', (private.med_state(pg_temp.f('tr'), pg_temp.today())->>'state') = 'ok');

-- ---------- E. Entrega + saldo insuficiente bloqueia ----------
select pg_temp.as_user('medico');
select pg_temp.expect('E1 Entrega de 2 canetas sem item: só registra', null, format($q$select public.med_record_delivery(%L, pg_temp.today(), 2, 'caixa com 2')$q$, pg_temp.f('tr')));
select pg_temp.expect('E2 Quantidade 0 = 22023', '22023', format($q$select public.med_record_delivery(%L, pg_temp.today(), 0)$q$, pg_temp.f('tr')));
select pg_temp.expect('E3 Entrega de 5 com item e saldo 2 = INSUFFICIENT_STOCK (bloqueia)', '22023', format($q$select public.med_record_delivery(%L, pg_temp.today(), 5, null, %L, %L)$q$, pg_temp.f('tr'), pg_temp.f('item'), pg_temp.f('u1')), 'INSUFFICIENT_STOCK');
select pg_temp.su();
select pg_temp.chk('E4 ... nada foi gravado (entrega nem baixa): saldo 2 e 1 entrega', pg_temp.bal() = 2 and (select count(*) = 1 from public.patient_med_deliveries));
select pg_temp.as_user('medico');
select pg_temp.expect('E5 Entrega de 2 com item e saldo 2 = baixa 2', null, format($q$select public.med_record_delivery(%L, pg_temp.today(), 2, 'repôs', %L, %L)$q$, pg_temp.f('tr'), pg_temp.f('item'), pg_temp.f('u1')));
select pg_temp.expect('E6 Aplicação na clínica com saldo 0 = INSUFFICIENT_STOCK (bloqueia)', '22023', format($q$select public.med_record_application(%L, pg_temp.today() - 2, 5, 'clinic', null, %L, %L)$q$, pg_temp.f('tr'), pg_temp.f('item'), pg_temp.f('u1')), 'INSUFFICIENT_STOCK');
select pg_temp.su();
select pg_temp.chk('E7 ... saldo 0 e a aplicação bloqueada não ficou gravada', pg_temp.bal() = 0 and (select count(*) = 0 from public.patient_med_applications where applied_on = pg_temp.today() - 2));

-- ---------- F. Desfazer devolve o estoque ----------
select pg_temp.as_user('medico');
select pg_temp.expect('F1 Desfazer a aplicação da clínica', null, format($q$select public.med_remove_entry('application', %L)$q$, (select id from public.patient_med_applications where applied_on = pg_temp.today() and treatment_id = pg_temp.f('tr'))));
select pg_temp.su();
select pg_temp.chk('F2 ... saldo volta a 1 (estorno no kardex) e a linha some', pg_temp.bal() = 1 and (select count(*) = 1 from public.stock_movements where movement_type = 'reversal' and patient_id = pg_temp.f('pat'))
  and (select count(*) = 0 from public.patient_med_applications where applied_on = pg_temp.today()));
select pg_temp.as_user('edu');
select pg_temp.expect('F3 Educador não desfaz', '42501', format($q$select public.med_remove_entry('delivery', %L)$q$, (select id from public.patient_med_deliveries limit 1)));
select pg_temp.su();

-- ---------- G. Configuração + app do paciente ----------
select pg_temp.as_user('pac');
select pg_temp.chk('G1 Lembrete nasce DESLIGADO: o app não recebe nada', (public.med_patient_today()->>'enabled')::boolean = false);
select pg_temp.expect('G2 "Já apliquei" com o lembrete desligado = 42501', '42501', $q$select public.med_patient_confirm()$q$);
select pg_temp.su();
select pg_temp.as_user('medico');
select pg_temp.expect('G3 Profissional (não admin) NÃO liga o lembrete', '42501', format($q$select public.med_set_settings(%L, true)$q$, pg_temp.f('c')));
select pg_temp.su();
select pg_temp.as_user('other');
select pg_temp.expect('G4 Admin de OUTRA clínica NÃO liga', '42501', format($q$select public.med_set_settings(%L, true)$q$, pg_temp.f('c')));
select pg_temp.su();
select pg_temp.as_user('owner');
select pg_temp.chk('G5 Admin lê a configuração: desligada', (public.med_get_settings(pg_temp.f('c'))->>'patient_reminder_enabled')::boolean = false);
select pg_temp.expect('G6 Admin liga', null, format($q$select public.med_set_settings(%L, true)$q$, pg_temp.f('c')));
select pg_temp.chk('G7 ... ligada', (public.med_get_settings(pg_temp.f('c'))->>'patient_reminder_enabled')::boolean = true);
select pg_temp.su();
-- hoje há aplicação feita em D1? (D1 foi há 7 dias; a de hoje foi desfeita) → hoje é o dia e não há registro
select pg_temp.as_user('pac');
select pg_temp.chk('G8 Paciente vê o cartão: hoje, Tirzepatida 5 mg', (select j->>'state' = 'today' and j->>'medication' = 'Tirzepatida' and (j->>'dose_mg')::numeric = 5 from (select public.med_patient_today() j) x));
select pg_temp.chk('G9 Paciente lê o próprio tratamento e doses', (select count(*) = 1 from public.patient_med_treatments where status = 'active') and (select count(*) = 2 from public.patient_med_doses where treatment_id = pg_temp.f('tr')));
select pg_temp.expect('G10 "Já apliquei" grava', null, $q$select public.med_patient_confirm()$q$);
select pg_temp.expect('G11 Segundo toque no mesmo dia = NOTHING_DUE (sem duplicar)', '22023', $q$select public.med_patient_confirm()$q$, 'NOTHING_DUE');
select pg_temp.chk('G12 Cartão some depois de aplicar (ok)', (public.med_patient_today()->>'state') = 'ok');
select pg_temp.su();
select pg_temp.chk('G13 Registro do paciente: source=patient, place=home, dose 5, hoje, sem estoque', (select source = 'patient' and place = 'home' and dose_mg = 5 and applied_on = pg_temp.today() and cardinality(stock_movement_ids) = 0 from public.patient_med_applications where treatment_id = pg_temp.f('tr') and source = 'patient'));
select pg_temp.as_user('pac2');
select pg_temp.chk('G14 Outro paciente não vê o de ninguém e o app diz "sem tratamento"', (select count(*) = 0 from public.patient_med_treatments) and (public.med_patient_today()->>'state') = 'none');
select pg_temp.expect('G15 ... e não confirma aplicação alheia', 'P0002', $q$select public.med_patient_confirm()$q$);
select pg_temp.su();
select pg_temp.as_user('pac');
select pg_temp.expect('G16 Paciente não escreve direto (nem dose)', '42501', $q$update public.patient_med_treatments set dose_mg = 50$q$);
select pg_temp.expect('G17 Paciente não ajusta dose', '42501', format($q$select public.med_adjust_dose(%L, 10, pg_temp.today(), null)$q$, pg_temp.f('tr')));
select pg_temp.su();

-- ---------- H. Atrasadas na lista da equipe ----------
do $t$ declare v uuid; begin
  perform pg_temp.as_user('medico');
  v := public.med_save_treatment(pg_temp.f('pat'), null, 'Mounjaro', pg_temp.today() - 30, 5, pg_temp.dow(pg_temp.today() - 2), 'home', null);
  perform pg_temp.su();
  insert into fx values ('tr2', v);
end $t$;
select pg_temp.as_user('medico');
select pg_temp.chk('H1 Dia de 2 dias atrás sem registro → lista da equipe traz Mounjaro atrasada 2 dias', (select count(*) = 1 and min(days_late) = 2 and min(medication) = 'Mounjaro' from public.med_overdue_list()));
select pg_temp.su();
select pg_temp.as_user('recep');
select pg_temp.chk('H2 Recepção não vê atrasadas', (select count(*) = 0 from public.med_overdue_list()));
select pg_temp.su();
select pg_temp.as_user('medico');
select pg_temp.expect('H3 Encerrar tratamento', null, format($q$select public.med_end_treatment(%L)$q$, pg_temp.f('tr2')));
select pg_temp.chk('H4 ... some das atrasadas', (select count(*) = 0 from public.med_overdue_list()));
select pg_temp.su();
select pg_temp.as_user('medico');
do $t$ declare v uuid; begin
  v := public.med_save_treatment(pg_temp.f('pat'), null, 'Ozempic', pg_temp.today() - 30, 1, pg_temp.dow(pg_temp.today() - 1), 'home', null); insert into fx values ('tr3', v);
end $t$;
select pg_temp.su();
select pg_temp.as_user('pac');
select pg_temp.chk('H5 Com dois tratamentos, o app mostra o ATRASADO (Ozempic, 1 dia) antes do que está em dia', (select j->>'state' = 'overdue' and j->>'medication' = 'Ozempic' and (j->>'days_late')::int = 1 from (select public.med_patient_today() j) x));
select pg_temp.expect('H6 "Já apliquei" grava a atrasada (na data de hoje)', null, $q$select public.med_patient_confirm()$q$);
select pg_temp.chk('H7 ... e a Ozempic fica em dia', (select count(*) = 1 from public.patient_med_applications where treatment_id = pg_temp.f('tr3') and source = 'patient' and applied_on = pg_temp.today()));
select pg_temp.su();

select pg_temp.as_user('edu');
select pg_temp.chk('H8 med_states lê (educador vinculado) e traz o estado de cada tratamento ativo', (select count(*) = 2 and bool_or(state = 'ok') from public.med_states(pg_temp.f('pat'))));
select pg_temp.su();
select pg_temp.as_user('recep');
select pg_temp.expect('H9 Recepção NÃO lê med_states', '42501', format($q$select * from public.med_states(%L)$q$, pg_temp.f('pat')));
select pg_temp.su();

-- sem sessão
select set_config('request.jwt.claims', '{}', true);
select pg_temp.as_user('pac');
select pg_temp.su();

select name || ' => ' || coalesce(detail, '') as "FALHA" from tr where not ok;
select count(*), count(*) filter (where not ok) from tr;
rollback;
