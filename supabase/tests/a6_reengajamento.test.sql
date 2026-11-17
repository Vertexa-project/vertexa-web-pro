-- Prova SQL da parte 7 (avatar). Roda em begin..rollback; a última consulta devolve "<n>|<falhas>".
begin;
create temp table tr (n serial, name text, ok boolean, detail text);
grant all on tr to authenticated; grant usage, select on sequence tr_n_seq to authenticated;
create function pg_temp.as_user(p_prof uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.profiles where id = p_prof), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.expect(p_name text, p_state text, p_sql text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  insert into tr(name, ok, detail) values (p_name, p_state is null, case when p_state is null then 'ok' else 'passou sem erro' end);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  insert into tr(name, ok, detail) values (p_name, v_state = p_state, v_state || ' ' || v_msg);
end $$;
create function pg_temp.chk(p_name text, p_ok boolean) returns void language sql as $$ insert into tr(name, ok) values (p_name, coalesce(p_ok, false)) $$;


create temp table ctx as select (now() at time zone 'America/Sao_Paulo')::date as d0;
grant all on ctx to authenticated;
create function pg_temp.d(n int) returns date language sql as $$ select d0 + n from ctx $$;
create function pg_temp.run(n int) returns int language sql security definer as $$ select private.run_reengagement('00000000-0000-0000-0000-00000000ca01', pg_temp.d(n), true) $$;
create function pg_temp.sends(p uuid) returns int language sql security definer as $$ select count(*)::int from public.reengagement_sends where patient_id = p $$;
create function pg_temp.notifs(p uuid) returns int language sql security definer as $$ select count(*)::int from public.notifications where patient_id = p and type = 'retention' $$;
create function pg_temp.chats(p uuid) returns int language sql security definer as $$
  select count(*)::int from public.chat_messages m join public.chat_channels c on c.id = m.channel_id where c.patient_id = p and m.sender_role = 'professional' $$;
create function pg_temp.maxstep(p uuid) returns int language sql security definer as $$ select max(step)::int from public.reengagement_sends where patient_id = p $$;
create function pg_temp.newcycle(p uuid) returns int language sql security definer as $$ select count(*)::int from public.reengagement_sends where patient_id = p and step = 1 and anchor_day > (select d0 from ctx) $$;
\set mari '00000000-0000-0000-0000-0000000000f1'
\set paulo '00000000-0000-0000-0000-0000000000f2'
\set clin '00000000-0000-0000-0000-00000000ca01'
-- estado inicial: todos entraram "agora" (anchor = hoje); Paulo entrou há 20 dias
update public.profiles set created_at = now();
update public.profiles set created_at = now() - interval '20 days' where id = '00000000-0000-0000-0000-0000000000c2';

-- 1) nasce desligado: sem configuração nada é enviado, em nenhuma data
select pg_temp.chk('desligado: sem configuração não envia', pg_temp.run(30) = 0 and pg_temp.sends('00000000-0000-0000-0000-0000000000f1') = 0);
-- 2) permissões de gravar a configuração
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect('config: profissional comum não grava (42501)', '42501', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array['a','b','c'], array['a','b','c']) $q$);
select pg_temp.su();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('config: recepção não grava (42501)', '42501', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array['a','b','c'], array['a','b','c']) $q$);
select pg_temp.expect('rodar agora: recepção negada (42501)', '42501', $q$ select public.run_reengagement_now('00000000-0000-0000-0000-00000000ca01') $q$);
select pg_temp.su();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect('config: admin de OUTRA clínica negado (42501)', '42501', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array['a','b','c'], array['a','b','c']) $q$);
select pg_temp.expect('visão geral: admin de outra clínica negado (42501)', '42501', $q$ select * from public.reengagement_overview('00000000-0000-0000-0000-00000000ca01') $q$);
select pg_temp.expect('ficha: admin de outra clínica negado (42501)', '42501', $q$ select public.patient_reengagement_line('00000000-0000-0000-0000-0000000000f1') $q$);
select pg_temp.su();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect('config: paciente não grava (42501)', '42501', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array['a','b','c'], array['a','b','c']) $q$);
select pg_temp.expect('config: insert direto negado (42501)', '42501', $q$ insert into public.reengagement_settings (clinic_id, is_active) values ('00000000-0000-0000-0000-00000000cb01', true) $q$);
select pg_temp.su();
-- 3) validações
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('config: dias fora de ordem = 22023', '22023', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[8,5,12], array['a','b','c'], array['a','b','c']) $q$);
select pg_temp.expect('config: título > 80 = 22023', '22023', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array[repeat('x',81),'b','c'], array['a','b','c']) $q$);
select pg_temp.expect('config: mensagem vazia = 22023', '22023', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array['a','b','c'], array['a','','c']) $q$);
select pg_temp.expect('config: só 2 mensagens = 22023', '22023', $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8], array['a','b'], array['a','b']) $q$);
select pg_temp.expect('rodar agora: data no passado = 22023', '22023', $q$ select public.run_reengagement_now('00000000-0000-0000-0000-00000000ca01', current_date - 3) $q$);
select pg_temp.expect('rodar agora: > 90 dias = 22023', '22023', $q$ select public.run_reengagement_now('00000000-0000-0000-0000-00000000ca01', current_date + 200) $q$);
-- liga com os padrões da clínica
select pg_temp.expect('config: admin grava e liga', null, $q$ select public.save_reengagement_settings('00000000-0000-0000-0000-00000000ca01', true, true, array[5,8,12], array['Oi, {nome}!','Passando','Equipe aqui'], array['{nome}, tudo bem?','Voltei, {nome}','Sem pressão, {nome}']) $q$);
select pg_temp.su();
select pg_temp.chk('config: gravada com os dias 5/8/12', (select day_1 = 5 and day_2 = 8 and day_3 = 12 and is_active from public.reengagement_settings where clinic_id = :'clin'));

-- 4) Paulo (sumido há 20 dias): UMA etapa por dia, nunca as 3 de uma vez
select pg_temp.chk('Paulo: hoje manda só a etapa 1', pg_temp.run(0) = 1 and pg_temp.sends(:'paulo') = 1);
select pg_temp.chk('Paulo: rodar de novo no mesmo dia não duplica', pg_temp.run(0) = 0 and pg_temp.sends(:'paulo') = 1);
select pg_temp.chk('Paulo: amanhã etapa 2', pg_temp.run(1) = 1 and pg_temp.sends(:'paulo') = 2);
select pg_temp.chk('Paulo: depois de amanhã etapa 3', pg_temp.run(2) = 1 and pg_temp.sends(:'paulo') = 3);
select pg_temp.chk('Paulo: acabou a sequência, não manda 4ª', pg_temp.run(3) = 0 and pg_temp.sends(:'paulo') = 3);
select pg_temp.chk('Paulo: 3 notificações e 3 mensagens da equipe na conversa', pg_temp.notifs(:'paulo') = 3 and pg_temp.chats(:'paulo') = 3);
select pg_temp.chk('conversa: paciente é participante e a mensagem não tem autor pessoal',
  (select count(*) = 1 from public.chat_participants cp join public.chat_channels c on c.id = cp.channel_id where c.patient_id = :'paulo' and cp.role = 'patient')
  and (select bool_and(m.sender_profile_id is null) from public.chat_messages m join public.chat_channels c on c.id = m.channel_id where c.patient_id = :'paulo'));
select pg_temp.chk('texto: {nome} vira o primeiro nome', (select title = 'Oi, Paulo!' and body = 'Paulo, tudo bem?' from public.reengagement_sends where patient_id = :'paulo' and step = 1));
select pg_temp.chk('inativo e clínica sem configuração não recebem', pg_temp.sends('00000000-0000-0000-0000-0000000000f4') = 0 and pg_temp.sends('00000000-0000-0000-0000-0000000000f3') = 0);

-- 5) Mariana (anchor = hoje): dia 5, 8 e 12
select pg_temp.chk('Mariana: dia 4 ainda não manda', pg_temp.run(4) = 0 and pg_temp.sends(:'mari') = 0);
select pg_temp.chk('Mariana: dia 5 manda etapa 1', pg_temp.run(5) = 1 and pg_temp.maxstep(:'mari') = 1);
select pg_temp.chk('Mariana: dia 5 de novo não duplica', pg_temp.run(5) = 0 and pg_temp.sends(:'mari') = 1);
select pg_temp.chk('Mariana: dia 7 não manda', pg_temp.run(7) = 0);
select pg_temp.chk('Mariana: dia 8 manda etapa 2', pg_temp.run(8) = 1 and pg_temp.maxstep(:'mari') = 2);
-- a mensagem da equipe e o aviso NÃO contam como interação (a âncora segue a mesma)
select pg_temp.chk('Mariana: mensagem da equipe não conta como interação', (select count(distinct anchor_day) = 1 from public.reengagement_sends where patient_id = :'mari'));
-- 6) a paciente interage (registro no app, dia 9) → para
insert into public.activity_events (patient_id, type, created_at) values (:'mari', 'hydration_logged', ((select d0 + 9 from ctx) + time '12:00') at time zone 'America/Sao_Paulo');
select pg_temp.chk('Mariana: interagiu no dia 9 → dia 12 NÃO manda etapa 3', pg_temp.run(12) = 0 and pg_temp.sends(:'mari') = 2);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.chk('ficha: "parou porque a paciente voltou a interagir"', (select public.patient_reengagement_line(:'mari') ->> 'state' = 'respondeu' and (public.patient_reengagement_line(:'mari') ->> 'step')::int = 2));
select pg_temp.su();
-- 7) novo sumiço (5 dias depois do dia 9) recomeça do zero
select pg_temp.chk('Mariana: novo sumiço (dia 14) recomeça na etapa 1', pg_temp.run(14) = 1 and pg_temp.sends(:'mari') = 3
  and pg_temp.newcycle(:'mari') = 1);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.chk('ficha: "mensagem 1 de 3 enviada em ..." (em andamento)', (select public.patient_reengagement_line(:'mari') ->> 'state' = 'em_andamento' and (public.patient_reengagement_line(:'mari') ->> 'step')::int = 1));
select pg_temp.su();
-- 8) a paciente RESPONDE na conversa → para (mensagem de paciente conta)
insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body, created_at)
  select c.id, '00000000-0000-0000-0000-0000000000c1', 'patient', 'oi, estou voltando', ((select d0 + 15 from ctx) + time '09:00') at time zone 'America/Sao_Paulo' from public.chat_channels c where c.patient_id = :'mari';
select pg_temp.chk('Mariana: respondeu na conversa (dia 15) → dia 19 não recomeça', pg_temp.run(19) = 0 and pg_temp.sends(:'mari') = 3);
insert into public.weight_logs (patient_id, measured_at) values (:'mari', ((select d0 + 16 from ctx) + time '08:00') at time zone 'America/Sao_Paulo');
select pg_temp.chk('Mariana: peso registrado (dia 16) conta como interação', pg_temp.run(20) = 0 and pg_temp.sends(:'mari') = 3);
insert into public.progress_photos (patient_id, taken_at) values (:'mari', ((select d0 + 17 from ctx) + time '08:00') at time zone 'America/Sao_Paulo');
select pg_temp.chk('Mariana: foto (dia 17) conta como interação', pg_temp.run(21) = 0 and pg_temp.sends(:'mari') = 3);

-- 9) visão geral e leitura por papel
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.chk('visão geral (admin): vê Paulo concluída e Mariana', (select count(*) filter (where patient_id = :'paulo' and state in ('concluida','respondeu')) = 1 and count(*) filter (where patient_id = :'mari') = 1 from public.reengagement_overview(:'clin')));
select pg_temp.chk('visão geral: não lista paciente de outra clínica', (select count(*) = 0 from public.reengagement_overview(:'clin') where patient_id = '00000000-0000-0000-0000-0000000000f3'));
select pg_temp.chk('admin lê histórico (reengagement_sends)', (select count(*) >= 6 from public.reengagement_sends));
select pg_temp.su();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select pg_temp.chk('recepção: visão geral vazia (sem acesso clínico) e histórico invisível', (select count(*) = 0 from public.reengagement_overview(:'clin')) and (select count(*) = 0 from public.reengagement_sends));
select pg_temp.su();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.chk('paciente não lê o ledger nem a configuração', (select count(*) = 0 from public.reengagement_sends) and (select count(*) = 0 from public.reengagement_settings));
select pg_temp.su();

-- 10) RPC admin simulada: marca simulated; limpeza só do simulado
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.chk('rodar agora com data: simulated=true e envia', (select (r ->> 'simulated')::boolean and (r ->> 'sent')::int >= 1 from (select public.run_reengagement_now(:'clin', (select d0 + 40 from ctx)) as r) z));
select pg_temp.su();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect('limpar simulado: profissional comum negado (42501)', '42501', $q$ select public.clear_simulated_reengagement('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000f1') $q$);
select pg_temp.su();
update public.reengagement_sends set simulated = false where patient_id = :'paulo';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.chk('limpar simulado do Paulo não apaga envio real', public.clear_simulated_reengagement(:'clin', :'paulo') = 0 and pg_temp.sends(:'paulo') = 3);
select pg_temp.chk('limpar simulado da Mariana apaga envios, avisos e mensagens', public.clear_simulated_reengagement(:'clin', :'mari') >= 3
  and pg_temp.sends(:'mari') = 0 and pg_temp.notifs(:'mari') = 0 and pg_temp.chats(:'mari') = 0);
select pg_temp.su();

select 'FALHA|' || name || '|' || coalesce(detail, '') from tr where not ok;
select count(*) || '|' || count(*) filter (where not ok) from tr;
rollback;
