-- Prova SQL da FIN-E1 (rodar DENTRO de begin ... rollback, depois da migration; nada fica no banco).
-- Uso: (echo 'begin;'; cat supabase/migrations/20261113100000_fin_e1_base.sql; cat supabase/tests/fin_e1_base.test.sql; echo 'rollback;') > /tmp/x.sql
-- Clínica QA: 0772a4aa… ; admin QA (auth fa747d61…); membro sem papel (Bia, auth 9b75ae26…); admin de OUTRA clínica (auth 5b3f9965…).
create temp table tr (n serial, name text, ok boolean, detail text);
grant all on tr to authenticated; grant usage, select on sequence tr_n_seq to authenticated;

do $t$
declare
  c uuid := '0772a4aa-bf03-482b-8512-ea6557f06a04';
  adm text := 'fa747d61-7702-4f8a-a2ac-559b4555aaa5'; bia text := '9b75ae26-39ca-498b-a9ca-543656c878e5'; other text := '5b3f9965-67c0-4c11-acb6-af239887e85e';
  bia_pro uuid := '8bed7723-e1b3-4188-b3a4-575911fea3fa'; adm_pro uuid := '90df80ab-7162-4151-82a4-fbf5b033b396';
  v_unit uuid; v_item uuid; v_svc uuid; v_pkg uuid; v_n int; v_state text; v_msg text; j jsonb; v_b jsonb; v_a jsonb; v_svc2 uuid; v_item2 uuid; v_bt text; v_at text;
  procedure_dummy int;
begin
  -- (0) backfill: toda clínica ganhou unidade principal
  select count(*) into v_n from public.clinics cl where not exists (select 1 from public.clinic_units u where u.clinic_id = cl.id and u.is_primary);
  insert into tr(name, ok, detail) values ('backfill: clínicas sem unidade principal = 0', v_n = 0, v_n::text);

  -- (a) RLS: admin de OUTRA clínica não lê nada da clínica QA; e escrita é recusada
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinic_units where clinic_id = c;
  insert into tr(name, ok, detail) values ('a) outra clínica: clinic_units da QA = 0 linhas', v_n = 0, v_n::text);
  select count(*) into v_n from public.fin_acquirers where clinic_id = c;
  insert into tr(name, ok, detail) values ('a) outra clínica: fin_acquirers da QA = 0 linhas', v_n = 0, v_n::text);
  select count(*) into v_n from public.fin_settings where clinic_id = c;
  insert into tr(name, ok, detail) values ('a) outra clínica: fin_settings da QA = 0 linhas', v_n = 0, v_n::text);
  begin
    perform public.fin_save_service(c, null, '{"name":"X","category":"consulta","default_price_cents":100}'::jsonb);
    insert into tr(name, ok, detail) values ('a) outra clínica: fin_save_service recusado', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('a) outra clínica: fin_save_service recusado (42501)', v_state = '42501', v_state);
  end;
  begin
    perform public.fin_audit_list(c);
    insert into tr(name, ok, detail) values ('a) outra clínica: fin_audit_list recusado', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('a) outra clínica: fin_audit_list recusado (42501)', v_state = '42501', v_state);
  end;
  execute 'reset role';

  -- membro sem papel: não lê nem escreve
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.fin_services where clinic_id = c;
  insert into tr(name, ok, detail) values ('a) membro sem papel: fin_services = 0 linhas', v_n = 0, v_n::text);
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"Y","category":"c","item_type":"consumable"}'::jsonb);
    insert into tr(name, ok, detail) values ('a) membro sem papel: escrita de estoque recusada', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('a) membro sem papel: escrita de estoque recusada (42501)', v_state = '42501', v_state);
  end;
  execute 'reset role';

  -- admin cria unidade, depois atribui papéis
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_unit := public.fin_save_unit(c, null, '{"name":"QA Unidade 2","license_number":"LS-1","license_valid_until":"2027-12-31"}'::jsonb);
  select count(*) into v_n from public.clinic_units where clinic_id = c;
  insert into tr(name, ok, detail) values ('admin: criou unidade; clínica tem 2', v_n = 2, v_n::text);
  begin
    perform public.fin_save_unit(c, (select id from public.clinic_units where clinic_id = c and is_primary), '{"name":"Unidade principal","is_active":false}'::jsonb, 'teste');
    insert into tr(name, ok, detail) values ('principal não desativa', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('principal não desativa', v_msg = 'PRIMARY_UNIT_CANNOT_BE_DEACTIVATED', v_msg);
  end;

  -- Recepção: sem acesso a cadastros financeiros (b)
  perform public.fin_set_staff_roles(c, bia_pro, '[{"role":"recepcao","all_units":true}]'::jsonb, 'teste');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinic_units where clinic_id = c;
  insert into tr(name, ok, detail) values ('recepção lê unidades (2)', v_n = 2, v_n::text);
  select count(*) into v_n from public.fin_services where clinic_id = c;
  insert into tr(name, ok, detail) values ('b) recepção: fin_services = 0 linhas', v_n = 0, v_n::text);
  select count(*) into v_n from public.stock_items where clinic_id = c;
  insert into tr(name, ok, detail) values ('b) recepção: stock_items = 0 linhas', v_n = 0, v_n::text);
  begin
    perform public.fin_save_service(c, null, '{"name":"X","category":"consulta","default_price_cents":100}'::jsonb);
    insert into tr(name, ok, detail) values ('b) recepção NÃO escreve serviço', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('b) recepção NÃO escreve serviço (42501)', v_state = '42501', v_state);
  end;
  begin
    perform public.fin_save_acquirer(c, null, '{"name":"M","kind":"machine"}'::jsonb);
    insert into tr(name, ok, detail) values ('b) recepção NÃO escreve meio de pagamento', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('b) recepção NÃO escreve meio de pagamento (42501)', v_state = '42501', v_state);
  end;
  begin
    perform public.fin_get_professional_finance(adm_pro);
    insert into tr(name, ok, detail) values ('b) recepção NÃO lê dado bancário de outro', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('b) recepção NÃO lê dado bancário de outro (42501)', v_state = '42501', v_state);
  end;
  begin
    perform public.fin_set_staff_roles(c, bia_pro, '[{"role":"gestor"}]'::jsonb);
    insert into tr(name, ok, detail) values ('b) recepção NÃO se promove', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('b) recepção NÃO se promove (42501)', v_state = '42501', v_state);
  end;
  execute 'reset role';

  -- Financeiro (Bia) + Estoquista: matriz
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.fin_set_staff_roles(c, bia_pro, '[{"role":"financeiro","all_units":true}]'::jsonb, 'teste');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_svc := public.fin_save_service(c, null, '{"name":"QA Consulta","category":"consulta","default_price_cents":50000,"roles":["executor"]}'::jsonb, '[]'::jsonb, 'criação');
  select roles::text into v_msg from public.fin_services where id = v_svc;
  insert into tr(name, ok, detail) values ('financeiro cria serviço; Responsável sempre incluído', v_msg like '%responsavel%' and v_msg like '%executor%', v_msg);
  begin
    perform public.fin_save_settings(c, '{"accept_days":7}'::jsonb);
    insert into tr(name, ok, detail) values ('financeiro NÃO grava configurações (só gestor)', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('financeiro NÃO grava configurações (42501)', v_state = '42501', v_state);
  end;
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"QA Item","category":"c","item_type":"consumable"}'::jsonb);
    insert into tr(name, ok, detail) values ('financeiro NÃO escreve estoque (consulta)', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('financeiro NÃO escreve estoque (42501)', v_state = '42501', v_state);
  end;
  begin
    perform public.fin_audit_list(c);
    insert into tr(name, ok, detail) values ('financeiro NÃO lê o histórico', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('financeiro NÃO lê o histórico (42501)', v_state = '42501', v_state);
  end;
  execute 'reset role';

  -- Estoquista com unidade limitada escreve estoque, mas não serviço
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.fin_set_staff_roles(c, bia_pro, ('[{"role":"estoquista","all_units":false,"unit_ids":["' || v_unit || '"]}]')::jsonb, 'teste');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_item := public.fin_save_stock_item(c, null, '{"name":"QA Caneta","category":"Medicação","item_type":"medication","lot_control":true,"fractional":true,"opened_validity_days":28,"individual_use":true,"stock_unit":"caneta","consumption_unit":"mg","stock_to_consumption_factor":12}'::jsonb, ('[{"unit_id":"' || v_unit || '","min_qty":2.5}]')::jsonb, 'cad');
  insert into tr(name, ok, detail) values ('estoquista cria item', v_item is not null, '');
  begin
    perform public.fin_save_service(c, null, '{"name":"Z","category":"consulta","default_price_cents":1}'::jsonb);
    insert into tr(name, ok, detail) values ('estoquista NÃO escreve serviço', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('estoquista NÃO escreve serviço (42501)', v_state = '42501', v_state);
  end;
  -- (c) regras de estoque no servidor
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"QA Controlado","category":"c","item_type":"medication","lot_control":true,"controlled":true}'::jsonb);
    insert into tr(name, ok, detail) values ('c) controlado recusado', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('c) controlado recusado (STOCK_CONTROLLED_BLOCKED)', v_msg = 'STOCK_CONTROLLED_BLOCKED', v_msg);
  end;
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"QA Med venda","category":"c","item_type":"medication","lot_control":true,"sellable":true,"sale_price_cents":100}'::jsonb);
    insert into tr(name, ok, detail) values ('E13) medicação não vende', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('E13) medicação não vende', v_msg = 'MEDICATION_NOT_SELLABLE', v_msg);
  end;
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"QA Manip sem lote","category":"c","item_type":"compounded","lot_control":false}'::jsonb);
    insert into tr(name, ok, detail) values ('manipulado exige lote', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('manipulado exige lote', v_msg = 'LOT_CONTROL_REQUIRED', v_msg);
  end;
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"QA Revenda sem preço","category":"c","item_type":"resale"}'::jsonb);
    insert into tr(name, ok, detail) values ('revenda exige preço', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('revenda exige preço', v_msg = 'SALE_PRICE_REQUIRED', v_msg);
  end;
  begin
    perform public.fin_save_stock_item(c, null, '{"name":"QA Fracionado","category":"c","item_type":"consumable","fractional":true}'::jsonb);
    insert into tr(name, ok, detail) values ('fracionado exige validade após aberto', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('fracionado exige validade após aberto', v_msg = 'OPENED_VALIDITY_REQUIRED', v_msg);
  end;
  v_item2 := public.fin_save_stock_item(c, null, '{"name":"QA Creme","category":"Revenda","item_type":"resale","sale_price_cents":8990}'::jsonb);
  select sellable::text into v_msg from public.stock_items where id = v_item2;
  insert into tr(name, ok, detail) values ('revenda nasce vendável', v_msg = 'true', v_msg);
  execute 'reset role';

  -- Financeiro de novo: pacote (rateio), alíquota, log antes/depois, dado sensível
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.fin_set_staff_roles(c, bia_pro, '[{"role":"financeiro"}]'::jsonb, 'teste');
  v_svc2 := public.fin_save_service(c, null, '{"name":"QA Sessão","category":"sessao","default_price_cents":30000}'::jsonb);
  v_pkg := public.fin_save_package(c, null, jsonb_build_object('name','QA Pacote','price_cents',360000,'validity_days',180),
    jsonb_build_array(
      jsonb_build_object('item_type','service','service_id',v_svc,'quantity',3,'reference_price_cents',50000),
      jsonb_build_object('item_type','service','service_id',v_svc2,'quantity',5,'reference_price_cents',30000),
      jsonb_build_object('item_type','product','stock_item_id',v_item2,'quantity',10,'reference_price_cents',10000)), 'cad');
  select string_agg(allocated_unit_cents::text, '/' order by position) into v_msg from public.fin_package_items where package_id = v_pkg;
  insert into tr(name, ok, detail) values ('pacote R$ 3.600: 3×500+5×300+10×100 → 450/270/90', v_msg = '45000/27000/9000', v_msg);
  select sum(allocated_total_cents)::text into v_msg from public.fin_package_items where package_id = v_pkg;
  insert into tr(name, ok, detail) values ('pacote: soma das linhas = preço', v_msg = '360000', v_msg);
  v_pkg := public.fin_save_package(c, null, jsonb_build_object('name','QA Pacote B','price_cents',10000,'validity_days',30),
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',v_svc,'quantity',1,'reference_price_cents',3333),
                      jsonb_build_object('item_type','service','service_id',v_svc2,'quantity',1,'reference_price_cents',3333),
                      jsonb_build_object('item_type','service','service_id',v_svc2,'quantity',1,'reference_price_cents',3334)), 'cad');
  select string_agg(allocated_total_cents::text, '/' order by position) || ' soma=' || sum(allocated_total_cents) into v_msg from public.fin_package_items where package_id = v_pkg;
  insert into tr(name, ok, detail) values ('pacote com resto: diferença na última linha, soma = 10000', v_msg like '%soma=10000', v_msg);

  -- (d) log antes/depois
  perform public.fin_save_service(c, v_svc, '{"name":"QA Consulta","category":"consulta","default_price_cents":55000}'::jsonb, '[]'::jsonb, 'reajuste');
  execute 'reset role';
  select before->>'default_price_cents', after->>'default_price_cents', reason into v_bt, v_at, v_msg from public.fin_audit_log where entity = 'service' and entity_id = v_svc and action = 'update' order by at desc limit 1;
  execute 'set local role authenticated';
  insert into tr(name, ok, detail) values ('d) log update: antes 50000 → depois 55000, motivo', v_bt = '50000' and v_at = '55000' and v_msg = 'reajuste', coalesce(v_bt,'?') || ' → ' || coalesce(v_at,'?') || ' / ' || coalesce(v_msg,'?'));
  begin
    perform public.fin_save_service(c, v_svc, '{"name":"QA Consulta","category":"consulta","default_price_cents":55000,"is_active":false}'::jsonb, '[]'::jsonb, null);
    insert into tr(name, ok, detail) values ('desativar exige motivo', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('desativar exige motivo', v_msg = 'REASON_REQUIRED', v_msg);
  end;
  perform public.fin_save_service(c, v_svc, '{"name":"QA Consulta","category":"consulta","default_price_cents":55000,"is_active":false}'::jsonb, '[]'::jsonb, 'descontinuado');
  execute 'reset role';
  select count(*) into v_n from public.fin_audit_log where entity = 'service' and entity_id = v_svc and action = 'deactivate';
  execute 'set local role authenticated';
  insert into tr(name, ok, detail) values ('d) log deactivate gravado', v_n = 1, v_n::text);
  select count(*) into v_n from public.fin_services where id = v_svc;
  insert into tr(name, ok, detail) values ('sem exclusão física: serviço desativado continua existindo', v_n = 1, v_n::text);

  -- Alíquota herdada (F21)
  perform public.fin_set_tax_rate(c, '2026-09', 6.5, null, 'cad');
  select rate_pct::text || '|' || inherited::text || '|' || source_period into v_msg from public.fin_effective_tax_rate(c, '2026-11');
  insert into tr(name, ok, detail) values ('F21) nov/2026 sem alíquota usa a de set/2026 (herdada)', v_msg = '6.5000|true|2026-09', v_msg);
  perform public.fin_set_tax_rate(c, '2026-11', 7, null, null);
  select rate_pct::text || '|' || inherited::text into v_msg from public.fin_effective_tax_rate(c, '2026-11');
  insert into tr(name, ok, detail) values ('F21) com alíquota do mês: 7, não herdada', v_msg = '7.0000|false', v_msg);
  select has_rate::text into v_msg from public.fin_effective_tax_rate(c, '2026-01');
  insert into tr(name, ok, detail) values ('sem alíquota anterior: has_rate=false', v_msg = 'false', v_msg);

  -- Dado sensível: validação de CPF/CNPJ, mascarado no log, view_sensitive
  begin
    perform public.fin_save_professional_finance(adm_pro, '{"bond_type":"pj","tax_id":"11111111111"}'::jsonb);
    insert into tr(name, ok, detail) values ('CPF inválido recusado', false, 'passou');
  exception when others then get stacked diagnostics v_msg = message_text;
    insert into tr(name, ok, detail) values ('CPF inválido recusado', v_msg = 'INVALID_TAX_ID', v_msg);
  end;
  perform public.fin_save_professional_finance(adm_pro, '{"bond_type":"pj","tax_id":"52998224725","simples_optant":true,"pix_key":"a@b.com","bank_account":"12345-6"}'::jsonb,
    '[{"rule_type":"irrf","rate_pct":1.5,"min_base_cents":0,"valid_from":"2026-01-01"},{"rule_type":"iss","rate_pct":2,"valid_from":"2026-01-01"}]'::jsonb, 'cad');
  perform public.fin_save_professional_finance(adm_pro, '{"bond_type":"pj","tax_id":"11222333000181","simples_optant":true,"pix_key":"a@b.com","bank_account":"12345-6"}'::jsonb,
    '[{"rule_type":"irrf","rate_pct":1.5,"min_base_cents":0,"valid_from":"2026-01-01"}]'::jsonb, 'troca');
  execute 'reset role';
  select count(*) into v_n from public.fin_withholding_rules where professional_id = adm_pro and is_active;
  execute 'set local role authenticated';
  insert into tr(name, ok, detail) values ('CNPJ válido aceito; retenção removida da lista é desativada (1 ativa)', v_n = 1, v_n::text);
  execute 'reset role';
  select count(*) into v_n from public.fin_withholding_rules where professional_id = adm_pro;
  execute 'set local role authenticated';
  insert into tr(name, ok, detail) values ('retenção desativada não é apagada (3 linhas: 2 antigas desativadas + 1 nova)', v_n = 3, v_n::text);
  execute 'reset role';
  select after::text into v_msg from public.fin_audit_log where entity = 'professional_finance' and action = 'update' order by at desc limit 1;
  execute 'set local role authenticated';
  insert into tr(name, ok, detail) values ('log do profissional não vaza CPF/CNPJ/conta', v_msg not like '%11222333000181%' and v_msg not like '%12345-6%' and v_msg like '%•••81%', left(v_msg, 120));
  j := public.fin_get_professional_finance(adm_pro);
  execute 'reset role';
  select count(*) into v_n from public.fin_audit_log where entity = 'professional_finance' and action = 'view_sensitive';
  execute 'set local role authenticated';
  insert into tr(name, ok, detail) values ('leitura do dado sensível grava view_sensitive', v_n = 1 and j->'data'->>'tax_id' = '11222333000181', v_n::text);
  begin
    perform 1 from public.fin_professional_finance;
    insert into tr(name, ok, detail) values ('sem SELECT direto em fin_professional_finance', false, 'leu');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('sem SELECT direto em fin_professional_finance (42501)', v_state = '42501', v_state);
  end;
  execute 'reset role';

  -- Profissional lê o PRÓPRIO dado (Bia lê o seu; não o de outro, sem papel)
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.fin_set_staff_roles(c, bia_pro, '[]'::jsonb, 'remover papéis');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.fin_get_professional_finance(bia_pro);
  insert into tr(name, ok, detail) values ('profissional lê o próprio dado financeiro', j is not null, '');
  begin
    perform public.fin_get_professional_finance(adm_pro);
    insert into tr(name, ok, detail) values ('profissional NÃO lê o de outro', false, 'passou');
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    insert into tr(name, ok, detail) values ('profissional NÃO lê o de outro (42501)', v_state = '42501', v_state);
  end;
  execute 'reset role';
end $t$;

select n, name, ok, detail from tr order by n;
