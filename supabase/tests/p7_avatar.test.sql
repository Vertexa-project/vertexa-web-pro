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

-- a Mariana (...a1) é a paciente; ...a2 é outra pessoa
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('avatar: escolha válida grava', null, $q$ select public.set_my_avatar_pick('tigre', '#ffedE8') $q$);
select pg_temp.su();
select pg_temp.chk('avatar: kind=avatar, key e cor (maiúscula) gravados',
  (select avatar_kind = 'avatar' and avatar_key = 'tigre' and avatar_bg = '#FFEDE8' from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.chk('avatar: a outra pessoa não foi tocada',
  (select avatar_kind is null and avatar_key is null from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('avatar: bichinho fora da lista = 22023', '22023', $q$ select public.set_my_avatar_pick('dragao', '#E6F6EE') $q$);
select pg_temp.expect('avatar: cor fora da lista = 22023', '22023', $q$ select public.set_my_avatar_pick('sapo', '#123456') $q$);
select pg_temp.expect('avatar: sem cor = 22023', '22023', $q$ select public.set_my_avatar_pick('sapo', null) $q$);
select pg_temp.expect('avatar: sem bichinho = 22023', '22023', $q$ select public.set_my_avatar_pick(null, '#E6F6EE') $q$);
select pg_temp.expect('kind: valor inválido = 22023', '22023', $q$ select public.set_my_avatar_kind('video') $q$);
select pg_temp.expect('kind: photo sem foto = P0002', 'P0002', $q$ select public.set_my_avatar_kind('photo') $q$);
select pg_temp.expect('RLS: update direto em profiles negado (sem grant)', '42501', $q$ update public.profiles set avatar_key = 'sapo' where id = '00000000-0000-0000-0000-0000000000a1' $q$);
select pg_temp.su();
select pg_temp.chk('avatar: tentativas inválidas não mudaram a escolha',
  (select avatar_key = 'tigre' and avatar_bg = '#FFEDE8' from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'));

-- sem sessão
select set_config('request.jwt.claims', '{}', true);
select pg_temp.expect('anon/sem perfil não escolhe avatar', '42501', $q$ select public.set_my_avatar_pick('tigre', '#E6F6EE') $q$);

-- foto: sobe objeto na própria pasta, set_my_avatar vira kind=photo; voltar ao avatar; remover a foto mantém avatar escolhido
insert into storage.objects (bucket_id, name) values ('profile-avatars', '00000000-0000-0000-0000-0000000000a1/0123456789abcdef0123.webp');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('foto: caminho de OUTRO perfil = 22023', '22023', $q$ select public.set_my_avatar('00000000-0000-0000-0000-0000000000a2/0123456789abcdef0123.webp') $q$);
select pg_temp.expect('foto: set_my_avatar da própria pasta', null, $q$ select public.set_my_avatar('00000000-0000-0000-0000-0000000000a1/0123456789abcdef0123.webp') $q$);
select pg_temp.su();
select pg_temp.chk('foto: kind virou photo e o avatar escolhido foi preservado',
  (select avatar_kind = 'photo' and avatar_path is not null and avatar_key = 'tigre' from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('kind: voltar ao avatar', null, $q$ select public.set_my_avatar_kind('avatar') $q$);
select pg_temp.expect('kind: voltar à foto', null, $q$ select public.set_my_avatar_kind('photo') $q$);
select pg_temp.expect('foto: remover', null, $q$ select public.remove_my_avatar() $q$);
select pg_temp.su();
select pg_temp.chk('foto removida: kind volta a null, avatar escolhido segue guardado',
  (select avatar_kind is null and avatar_path is null and avatar_key = 'tigre' from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect('kind: avatar sem avatar escolhido = P0002', 'P0002', $q$ select public.set_my_avatar_kind('avatar') $q$);
select pg_temp.su();
-- constraint no banco (mesmo fora da RPC)
select pg_temp.expect('constraint: bichinho inválido por SQL direto = 23514', '23514', $q$ update public.profiles set avatar_key = 'dragao' where id = '00000000-0000-0000-0000-0000000000a2' $q$);

-- idempotência: reaplicar a migration não quebra (feito pelo script) — aqui só a leitura final
select 'FALHA|' || name || '|' || coalesce(detail, '') from tr where not ok;
select count(*) || '|' || count(*) filter (where not ok) from tr;
rollback;
