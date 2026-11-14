-- Medição de desempenho da FIN-E9 num Postgres LOCAL descartável (banco apagado ao fim): 1 clínica, 2.000 pacientes (500 do profissional medido), 20.000 documentos (3 itens cada), 1.000 itens de estoque.
-- Roda como usuário, 5 rodadas por chamada. Uso: PERF=1 scripts/fin-e9-sql-proof.sh
create temp table tm (label text, ms numeric);
grant all on tm to authenticated;
create temp table fx (k text primary key, v uuid);
grant all on fx to authenticated;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;
create function pg_temp.as_user(p_k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.profiles where id = pg_temp.f('prof_' || p_k)), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.timeit(p_label text, p_sql text, p_runs integer default 5) returns void language plpgsql as $$
declare t0 timestamptz; i integer; tot numeric := 0; mx numeric := 0; e numeric;
begin
  execute p_sql;
  for i in 1..p_runs loop
    t0 := clock_timestamp(); execute p_sql; e := extract(epoch from clock_timestamp() - t0) * 1000; tot := tot + e; mx := greatest(mx, e);
  end loop;
  insert into tm values (p_label || ' (média)', round(tot / p_runs, 1)), (p_label || ' (máx)', round(mx, 1));
end $$;
grant execute on function pg_temp.f(text), pg_temp.as_user(text), pg_temp.su(), pg_temp.timeit(text, text, integer) to public;

do $t$
declare c uuid; pid uuid; pro uuid; k text; v_pat uuid; i integer; v_first uuid;
begin
  foreach k in array array['owner','pro','recep'] loop
    insert into public.profiles (auth_user_id, full_name) values (gen_random_uuid(), 'U ' || k) returning id into pid; insert into fx values ('prof_' || k, pid);
  end loop;
  insert into public.clinics (name, owner_profile_id) values ('Clínica Grande', pg_temp.f('prof_owner')) returning id into c; insert into fx values ('c', c);
  insert into public.professionals (profile_id, clinic_id, clinic_role, type) values (pg_temp.f('prof_owner'), c, 'admin', 'other');
  insert into public.professionals (profile_id, clinic_id, type, registry_number) values (pg_temp.f('prof_pro'), c, 'nutritionist', 'CRN-3 000001') returning id into pro; insert into fx values ('pro_pro', pro);
  insert into public.professionals (profile_id, clinic_id, type) values (pg_temp.f('prof_recep'), c, 'other') returning id into pro;
  insert into public.clinic_staff_roles (clinic_id, professional_id, role) values (c, pro, 'recepcao');
  insert into public.profiles (full_name) select 'Paciente ' || g from generate_series(1, 2000) g;
  insert into public.patients (profile_id, clinic_id) select id, c from public.profiles where full_name like 'Paciente %';
  insert into public.care_team select id, pg_temp.f('prof_pro') from (select id from public.patients where clinic_id = c order by id limit 500) x;
  select patient_id into v_pat from public.care_team limit 1; insert into fx values ('pat', v_pat);
  insert into public.stock_items (clinic_id, name, category, item_type, purchase_unit, stock_unit, consumption_unit, lot_control)
    select c, 'Medicamento ' || g, 'x', 'medication', 'un', 'un', 'un', true from generate_series(1, 1000) g;
  -- 20.000 documentos: 10 por paciente, em ordem de data crescente (o mais novo é o último)
  insert into public.clinical_documents (clinic_id, patient_id, professional_id, doc_type, title, content, items, provider, is_demo, signed_at, patient_snapshot, professional_snapshot, clinic_name, content_hash)
  select c, p.id, pg_temp.f('pro_pro'), case when n % 4 = 0 then 'atestado' else 'receita' end, 'Documento ' || n, repeat('texto ', 40),
         case when n % 4 = 0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('name','Medicamento ' || (n % 1000 + 1) || ' 10 mg','dose','1','posology','1x','quantity','1'),
           jsonb_build_object('name','Outro item','dose','1','posology','1x','quantity','1'), jsonb_build_object('name','Terceiro','dose','1','posology','1x','quantity','1')) end,
         'demo', true, now() - (n || ' days')::interval, '{"name":"x"}', '{"name":"y"}', 'Clínica Grande', md5(p.id::text || n)
    from (select id, row_number() over () rn from public.patients where clinic_id = c) p cross join generate_series(1, 10) n;
  select id into v_first from public.clinical_documents where patient_id = v_pat limit 1; insert into fx values ('doc', v_first);
  analyze public.clinical_documents; analyze public.stock_items; analyze public.patients;
end $t$;

do $t$
declare c uuid := pg_temp.f('c'); pat uuid := pg_temp.f('pat'); doc uuid := pg_temp.f('doc');
begin
  perform pg_temp.as_user('pro');
  perform pg_temp.timeit('doc_list do paciente (10 documentos)', format($q$select public.doc_list(%L, %L)$q$, c, pat));
  perform pg_temp.timeit('doc_list da clínica, profissional com 500 de 2.000 pacientes (200 linhas)', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.timeit('doc_get', format($q$select public.doc_get(%L)$q$, doc));
  perform pg_temp.timeit('doc_prescribed_items do paciente com sugestão de estoque (1.000 itens)', format($q$select public.doc_prescribed_items(%L, %L)$q$, c, pat));
  perform pg_temp.timeit('doc_my_access', format($q$select public.doc_my_access(%L)$q$, c));
  perform pg_temp.timeit('fin_my_access (com as chaves doc_*)', format($q$select public.fin_my_access(%L)$q$, c));
  perform pg_temp.timeit('abrir sessão + assinar (receita)', format($q$select public.doc_sign_demo((public.doc_open_session(%L, %L, 'receita')->>'session_id')::uuid, 'Receita', 'x',
     '[{"name":"Medicamento 5","dose":"1","posology":"1x","quantity":"1"}]')$q$, c, pat));
  perform pg_temp.as_user('recep');
  perform pg_temp.timeit('doc_list da clínica, Recepção (200 linhas)', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.as_user('owner');
  perform pg_temp.timeit('doc_list da clínica, Owner (200 linhas)', format($q$select public.doc_list(%L)$q$, c));
  perform pg_temp.su();
end $t$;
select label || '|' || ms from tm order by ctid;
