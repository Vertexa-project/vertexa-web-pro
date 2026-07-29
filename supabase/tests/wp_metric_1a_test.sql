-- =====================================================================================
-- WP-METRIC-1a · TESTES Nível 1 (login simulado via request.jwt.claims; tudo em ROLLBACK).
--
-- A MATRIZ, em uma frase cada:
--   1. Só help_requested  → NÃO sustenta sequência, NÃO leva o +3 de plano acompanhado,
--                           MAS conta como interação (não é sumida, não é inativa).
--   2. Só hydration_logged→ conta para as DUAS grandezas.
--   3. Tipo fora do catálogo ⇒ rejeitado pela FK (23503).
--   4. Os 10 tipos da allow-list do app ⇒ todos aceitos.
--   5. Cliente authenticated escrevendo no catálogo ⇒ negado (42501).
--   6. anon lendo o catálogo ⇒ 0 linhas (RLS), idêntico ao catálogo de conquistas.
--   7. Lockdown das 3 tabelas de métrica derivada: intacto (só SELECT).
--   8. NÃO-GANHO: o alcance de leitura de activity_events e adherence_snapshots é o MESMO
--      de antes para paciente/vinculado/não-vinculado/admin/anon.
--
-- Fixtures como postgres (bypassrls) salvo onde o papel é o objeto do teste. Nada persiste.
-- =====================================================================================

-- ───────── (1+2) A REGRA NOVA — socorro não é adesão; hidratação é ─────────
begin;
do $$
declare
  fails text := '';
  acH uuid:='a1a00000-0000-0000-0000-000000000001'; daH uuid:='d1a00000-0000-0000-0000-000000000001';
  acW uuid:='a1a00000-0000-0000-0000-000000000002'; daW uuid:='d1a00000-0000-0000-0000-000000000002';
  rH record; rW record;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    ('f1a00000-0000-0000-0000-00000000000a','a1a00000-0000-0000-0000-00000000000a','admin','A','active'),
    ('f1a00000-0000-0000-0000-000000000001',acH,'patient','SocorroSo','active'),
    ('f1a00000-0000-0000-0000-000000000002',acW,'patient','AguaSo','active');
  insert into public.clinics (id,name,owner_profile_id) values
    ('c1a00000-0000-0000-0000-000000000001','C','f1a00000-0000-0000-0000-00000000000a');
  insert into public.patients (id,profile_id,clinic_id) values
    (daH,'f1a00000-0000-0000-0000-000000000001','c1a00000-0000-0000-0000-000000000001'),
    (daW,'f1a00000-0000-0000-0000-000000000002','c1a00000-0000-0000-0000-000000000001');

  -- Cada paciente tem UM único evento, HOJE (BRT). A única diferença é o TIPO.
  insert into public.activity_events (patient_id,type,payload,created_at) values
    (daH,'help_requested',   jsonb_build_object('category','dor','hasMessage',true),
       (private.brt_date(now()) + time '12:00') at time zone 'America/Sao_Paulo'),
    (daW,'hydration_logged', jsonb_build_object('liters',0.5),
       (private.brt_date(now()) + time '12:00') at time zone 'America/Sao_Paulo');

  -- O helper, direto: socorro não faz sequência; hidratação faz.
  if private.event_streak_brt(daH) <> 0 then fails:=fails||format('H_streak_helper=%s ', private.event_streak_brt(daH)); end if;
  if private.event_streak_brt(daW) <> 1 then fails:=fails||format('W_streak_helper=%s ', private.event_streak_brt(daW)); end if;

  perform set_config('request.jwt.claims', json_build_object('sub',acH::text)::text, true);
  set local role authenticated; perform public.recompute_adherence(); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',acW::text)::text, true);
  set local role authenticated; perform public.recompute_adherence(); reset role;

  select * into rH from public.adherence_snapshots where patient_id=daH order by calculated_at desc limit 1;
  select * into rW from public.adherence_snapshots where patient_id=daW order by calculated_at desc limit 1;

  -- (1) SÓ SOCORRO -------------------------------------------------------------------
  if rH.streak <> 0 then fails:=fails||format('H_streak=%s ',rH.streak); end if;
  if 'Plano acompanhado' = any(rH.positive_factors) then fails:=fails||'H_ganhou_plano '; end if;
  -- ...mas É interação: não caiu em inativo e não foi rotulada de sumida.
  if rH.status::text = 'inativo' then fails:=fails||'H_virou_inativo '; end if;
  if exists (select 1 from unnest(rH.risk_factors) f where f like '%dias sem interação%')
    then fails:=fails||'H_marcada_sumida '; end if;

  -- (2) SÓ HIDRATAÇÃO ----------------------------------------------------------------
  if rW.streak <> 1 then fails:=fails||format('W_streak=%s ',rW.streak); end if;
  if not ('Plano acompanhado' = any(rW.positive_factors)) then fails:=fails||'W_perdeu_plano '; end if;
  if rW.status::text = 'inativo' then fails:=fails||'W_virou_inativo '; end if;
  if exists (select 1 from unnest(rW.risk_factors) f where f like '%dias sem interação%')
    then fails:=fails||'W_marcada_sumida '; end if;

  -- CONTRASTE (sem cravar número): o mesmo 1 evento vale MENOS quando é socorro.
  if not (rH.score < rW.score) then fails:=fails||format('CONTRASTE H=%s W=%s ',rH.score,rW.score); end if;

  if length(fails)>0 then raise exception 'WP-METRIC-1a REGRA FAIL: %', fails;
  else raise notice 'WP-METRIC-1a REGRA (1+2): PASS'; end if;
end $$;
rollback;


-- ───────── (3+4+5+6) CATÁLOGO: FK, allow-list, escrita negada, anon ─────────
begin;
do $$
declare
  fails text := '';
  acX uuid:='a1a00000-0000-0000-0000-000000000003'; daX uuid:='d1a00000-0000-0000-0000-000000000003';
  allow text[] := array['workout_checked','weight_logged','progress_photo_uploaded','meal_logged',
                        'supplement_checked','activity_logged','hydration_logged','sleep_logged',
                        'mood_logged','help_requested'];
  t text; n int; n_cat int; n_ach int; n_cat_auth int;
  st_fk text := 'NAO_BARROU'; st_ins text; st_upd text; st_del text;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    ('f1a00000-0000-0000-0000-00000000000b','a1a00000-0000-0000-0000-00000000000b','admin','A','active'),
    ('f1a00000-0000-0000-0000-000000000003',acX,'patient','X','active');
  insert into public.clinics (id,name,owner_profile_id) values
    ('c1a00000-0000-0000-0000-000000000002','C','f1a00000-0000-0000-0000-00000000000b');
  insert into public.patients (id,profile_id,clinic_id) values
    (daX,'f1a00000-0000-0000-0000-000000000003','c1a00000-0000-0000-0000-000000000002');

  -- (3) tipo fora do catálogo ⇒ FK barra. Exigimos o SQLSTATE exato (23503): um "deu erro"
  --     genérico passaria mesmo se o motivo fosse outro (RLS, NOT NULL, typo de coluna).
  begin
    insert into public.activity_events (patient_id,type,payload) values (daX,'tipo_inventado_xyz','{}');
  exception when foreign_key_violation then st_fk:='BARRADO_23503';
    when others then st_fk:='ERRO_'||sqlstate;
  end;
  if st_fk <> 'BARRADO_23503' then fails:=fails||format('FK=%s ',st_fk); end if;

  -- (4) os 10 tipos da allow-list do eventSync ⇒ todos aceitos.
  foreach t in array allow loop
    begin
      insert into public.activity_events (patient_id,type,payload) values (daX,t,'{}');
    exception when others then fails:=fails||format('ALLOW_rejeitou=%s(%s) ',t,sqlstate);
    end;
  end loop;
  select count(*) into n from public.activity_events where patient_id=daX;
  if n <> 10 then fails:=fails||format('ALLOW_gravou=%s_de_10 ',n); end if;

  -- (5) cliente authenticated NÃO escreve no catálogo. O privilégio de tabela está revogado,
  --     então a barreira é DURA (42501) e não a RLS silenciosa — e é isso que asseguramos.
  --     As medições são feitas em VARIÁVEIS enquanto o papel está trocado; as asserções vêm
  --     depois do reset role (sob `authenticated` não há privilégio nem para escrever no log).
  perform set_config('request.jwt.claims', json_build_object('sub',acX::text)::text, true);
  set local role authenticated;
  select count(*) into n_cat_auth from public.activity_event_types;
  st_ins:='NAO_BARROU';
  begin
    insert into public.activity_event_types (type,counts_as_adherence,counts_as_interaction)
      values ('forjado_pelo_cliente',true,true);
  exception when insufficient_privilege then st_ins:='BARRADO_42501';
    when others then st_ins:='ERRO_'||sqlstate; end;
  st_upd:='NAO_BARROU';
  begin
    update public.activity_event_types set counts_as_adherence=true where type='help_requested';
  exception when insufficient_privilege then st_upd:='BARRADO_42501';
    when others then st_upd:='ERRO_'||sqlstate; end;
  st_del:='NAO_BARROU';
  begin
    delete from public.activity_event_types where type='help_requested';
  exception when insufficient_privilege then st_del:='BARRADO_42501';
    when others then st_del:='ERRO_'||sqlstate; end;
  reset role;

  -- (6) anon NÃO lê o catálogo. Aqui a barreira é a RLS, que é SILENCIOSA: 0 linhas, sem erro.
  --     Medimos `achievements` no mesmo papel e na mesma transação para provar que o
  --     comportamento é o do padrão da casa, e não uma exceção deste catálogo.
  set local role anon; perform set_config('request.jwt.claims','{}',true);
  select count(*) into n_cat from public.activity_event_types;
  select count(*) into n_ach from public.achievements;
  reset role;

  if n_cat_auth <> 10        then fails:=fails||format('AUTH_leu=%s_de_10 ',n_cat_auth); end if;
  if st_ins <> 'BARRADO_42501' then fails:=fails||format('AUTH_insert=%s ',st_ins); end if;
  if st_upd <> 'BARRADO_42501' then fails:=fails||format('AUTH_update=%s ',st_upd); end if;
  if st_del <> 'BARRADO_42501' then fails:=fails||format('AUTH_delete=%s ',st_del); end if;
  if n_cat <> 0 then fails:=fails||format('ANON_leu_catalogo=%s ',n_cat); end if;
  if n_ach <> 0 then fails:=fails||format('ANON_leu_achievements=%s(padrao_mudou) ',n_ach); end if;

  if length(fails)>0 then raise exception 'WP-METRIC-1a CATALOGO FAIL: %', fails;
  else raise notice 'WP-METRIC-1a CATALOGO (3+4+5+6): PASS'; end if;
end $$;
rollback;


-- ───────── (7+8) LOCKDOWN INTACTO e NÃO-GANHO DE ALCANCE ─────────
begin;
do $$
declare
  fails text := '';
  fa uuid:='f1a00000-0000-0000-0000-00000000000c'; aa uuid:='a1a00000-0000-0000-0000-00000000000c';
  f1 uuid:='f1a00000-0000-0000-0000-000000000011'; a1 uuid:='a1a00000-0000-0000-0000-000000000011'; e1 uuid:='e1a00000-0000-0000-0000-000000000011';
  f2 uuid:='f1a00000-0000-0000-0000-000000000012'; a2 uuid:='a1a00000-0000-0000-0000-000000000012'; e2 uuid:='e1a00000-0000-0000-0000-000000000012';
  acX uuid:='a1a00000-0000-0000-0000-000000000004'; daX uuid:='d1a00000-0000-0000-0000-000000000004';
  acY uuid:='a1a00000-0000-0000-0000-000000000005'; daY uuid:='d1a00000-0000-0000-0000-000000000005';
  cl  uuid:='c1a00000-0000-0000-0000-000000000003';
  n int;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (fa,aa,'admin','Admin','active'),
    (f1,a1,'professional','P1vinculado','active'),
    (f2,a2,'professional','P2solto','active'),
    ('f1a00000-0000-0000-0000-000000000004',acX,'patient','X','active'),
    ('f1a00000-0000-0000-0000-000000000005',acY,'patient','Y','active');
  insert into public.clinics (id,name,owner_profile_id) values (cl,'C',fa);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (e1,f1,cl,'doctor','member'), (e2,f2,cl,'doctor','member');
  insert into public.patients (id,profile_id,clinic_id) values
    (daX,'f1a00000-0000-0000-0000-000000000004',cl),
    (daY,'f1a00000-0000-0000-0000-000000000005',cl);
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status)
    values (e1,daX,false,'active');
  insert into public.activity_events (patient_id,type,payload,created_at)
    values (daX,'workout_checked','{}',now());

  perform set_config('request.jwt.claims', json_build_object('sub',acX::text)::text, true);
  set local role authenticated;
  perform public.recompute_adherence(); perform public.recompute_achievements();

  -- (7) LOCKDOWN — a paciente não grava nenhuma das 3 derivadas, nem a própria.
  begin insert into public.adherence_snapshots (patient_id,score,level,status,streak)
          values (daX,10,'risco','em_risco',0);
        fails:=fails||'LOCK_ins_adherence '; exception when others then null; end;
  begin insert into public.patient_achievements (patient_id,achievement_code,source)
          values (daX,'streak_30','forjado');
        fails:=fails||'LOCK_ins_achiev '; exception when others then null; end;
  begin insert into public.muscle_recovery_states (patient_id,muscle_group,status)
          values (daX,'chest','recovered');
        fails:=fails||'LOCK_ins_recovery '; exception when others then null; end;
  begin update public.adherence_snapshots set score=100 where patient_id=daX;
        get diagnostics n=row_count; if n>0 then fails:=fails||'LOCK_upd_adherence '; end if;
        exception when others then null; end;
  begin delete from public.patient_achievements where patient_id=daX;
        get diagnostics n=row_count; if n>0 then fails:=fails||'LOCK_del_achiev '; end if;
        exception when others then null; end;

  -- (8) NÃO-GANHO — os mesmos alcances de sempre. A própria paciente:
  if (select count(*) from public.activity_events     where patient_id=daX) < 1 then fails:=fails||'X_nao_le_proprios_eventos '; end if;
  if (select count(*) from public.adherence_snapshots where patient_id=daX) < 1 then fails:=fails||'X_nao_le_proprio_snapshot '; end if;
  if (select count(*) from public.activity_events     where patient_id=daY) <> 0 then fails:=fails||'X_le_eventos_de_Y '; end if;
  reset role;

  -- profissional VINCULADO: lê.
  perform set_config('request.jwt.claims', json_build_object('sub',a1::text)::text, true);
  set local role authenticated;
  if (select count(*) from public.activity_events     where patient_id=daX) < 1 then fails:=fails||'P1_nao_le_eventos '; end if;
  if (select count(*) from public.adherence_snapshots where patient_id=daX) < 1 then fails:=fails||'P1_nao_le_snapshot '; end if;
  reset role;

  -- profissional NÃO vinculado (mesma clínica, sem link): não lê.
  perform set_config('request.jwt.claims', json_build_object('sub',a2::text)::text, true);
  set local role authenticated;
  if (select count(*) from public.activity_events     where patient_id=daX) <> 0 then fails:=fails||'P2_le_eventos '; end if;
  if (select count(*) from public.adherence_snapshots where patient_id=daX) <> 0 then fails:=fails||'P2_le_snapshot '; end if;
  reset role;

  -- ADMIN da clínica (dona): lê.
  perform set_config('request.jwt.claims', json_build_object('sub',aa::text)::text, true);
  set local role authenticated;
  if (select count(*) from public.activity_events     where patient_id=daX) < 1 then fails:=fails||'ADM_nao_le_eventos '; end if;
  if (select count(*) from public.adherence_snapshots where patient_id=daX) < 1 then fails:=fails||'ADM_nao_le_snapshot '; end if;
  reset role;

  -- anon: nada.
  set local role anon; perform set_config('request.jwt.claims','{}',true);
  if (select count(*) from public.activity_events     where patient_id=daX) <> 0 then fails:=fails||'ANON_le_eventos '; end if;
  if (select count(*) from public.adherence_snapshots where patient_id=daX) <> 0 then fails:=fails||'ANON_le_snapshot '; end if;
  reset role;

  if length(fails)>0 then raise exception 'WP-METRIC-1a LOCKDOWN/ALCANCE FAIL: %', fails;
  else raise notice 'WP-METRIC-1a LOCKDOWN + NAO-GANHO (7+8): PASS'; end if;
end $$;
rollback;


-- ───────── (9) A EXTRAÇÃO NÃO ABRE CAMINHO PARA FORJAR O VRI DE OUTRA PACIENTE ─────────
-- `private.recompute_adherence_for(uuid)` aceita um patient_id no parâmetro. Este bloco
-- prova que isso NÃO é um buraco, testando as DUAS barreiras separadamente — inclusive
-- desligando a primeira de propósito para ver a segunda segurar sozinha.
begin;
do $$
declare
  fails text := '';
  acA uuid:='a1a00000-0000-0000-0000-000000000021'; daA uuid:='d1a00000-0000-0000-0000-000000000021';
  acB uuid:='a1a00000-0000-0000-0000-000000000022'; daB uuid:='d1a00000-0000-0000-0000-000000000022';
  cl  uuid:='c1a00000-0000-0000-0000-000000000004';
  st_auth text; st_anon text; st_rls text;
  n_b_antes int; n_b_depois int; n_b_final int; n_a_final int;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    ('f1a00000-0000-0000-0000-000000000020','a1a00000-0000-0000-0000-000000000020','admin','A','active'),
    ('f1a00000-0000-0000-0000-000000000021',acA,'patient','PacienteA','active'),
    ('f1a00000-0000-0000-0000-000000000022',acB,'patient','PacienteB','active');
  insert into public.clinics (id,name,owner_profile_id) values (cl,'C','f1a00000-0000-0000-0000-000000000020');
  insert into public.patients (id,profile_id,clinic_id) values
    (daA,'f1a00000-0000-0000-0000-000000000021',cl),
    (daB,'f1a00000-0000-0000-0000-000000000022',cl);
  insert into public.activity_events (patient_id,type,payload,created_at) values
    (daA,'workout_checked','{}', (private.brt_date(now()) + time '12:00') at time zone 'America/Sao_Paulo'),
    (daB,'workout_checked','{}', (private.brt_date(now()) + time '12:00') at time zone 'America/Sao_Paulo');

  -- Linha de base honesta para B, escrita pelo caminho de owner (migration/job).
  perform private.recompute_adherence_for(daB);
  select count(*) into n_b_antes from public.adherence_snapshots where patient_id=daB;
  if n_b_antes < 1 then fails:=fails||'B_sem_baseline '; end if;

  -- BARREIRA 1 — PRIVILÉGIO. A paciente A, autenticada, tenta chamar a função interna
  -- apontando para a paciente B.
  perform set_config('request.jwt.claims', json_build_object('sub',acA::text)::text, true);
  set local role authenticated;
  st_auth := 'NAO_BARROU';
  begin perform private.recompute_adherence_for(daB);
  exception when insufficient_privilege then st_auth:='BARRADO_42501';
    when others then st_auth:='ERRO_'||sqlstate; end;
  reset role;

  -- ...e anon, que nem USAGE em `private` tem.
  set local role anon; perform set_config('request.jwt.claims','{}',true);
  st_anon := 'NAO_BARROU';
  begin perform private.recompute_adherence_for(daB);
  exception when insufficient_privilege then st_anon:='BARRADO_42501';
    when others then st_anon:='ERRO_'||sqlstate; end;
  reset role;

  select count(*) into n_b_depois from public.adherence_snapshots where patient_id=daB;

  -- BARREIRA 2 — RLS. Concedemos o EXECUTE DE PROPÓSITO (simulando um `grant` distraído no
  -- futuro) para provar que a segunda barreira segura sozinha: a função é SECURITY INVOKER,
  -- então o INSERT roda como `authenticated` e bate na RLS de adherence_snapshots, que só
  -- tem policy de SELECT desde o lockdown do WP-RLS2.
  execute 'grant execute on function private.recompute_adherence_for(uuid) to authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub',acA::text)::text, true);
  set local role authenticated;
  st_rls := 'ESCREVEU_SEM_BARREIRA';
  begin perform private.recompute_adherence_for(daB);
  exception when others then st_rls:='BARRADO_'||sqlstate; end;
  reset role;
  execute 'revoke execute on function private.recompute_adherence_for(uuid) from authenticated';

  -- A RPC PÚBLICA continua recomputando SÓ a própria paciente: A chama, A ganha snapshot,
  -- B não se move. E não há onde escrever um id — a assinatura é `()`.
  perform set_config('request.jwt.claims', json_build_object('sub',acA::text)::text, true);
  set local role authenticated; perform public.recompute_adherence(); reset role;
  select count(*) into n_a_final from public.adherence_snapshots where patient_id=daA;
  select count(*) into n_b_final from public.adherence_snapshots where patient_id=daB;

  if st_auth <> 'BARRADO_42501' then fails:=fails||format('AUTH_chamou_interna=%s ',st_auth); end if;
  if st_anon <> 'BARRADO_42501' then fails:=fails||format('ANON_chamou_interna=%s ',st_anon); end if;
  if n_b_depois <> n_b_antes    then fails:=fails||format('B_forjado_pela_interna %s->%s ',n_b_antes,n_b_depois); end if;
  if st_rls = 'ESCREVEU_SEM_BARREIRA' then fails:=fails||'RLS_nao_segurou_com_execute_concedido '; end if;
  if n_a_final < 1              then fails:=fails||'RPC_nao_recomputou_a_propria '; end if;
  if n_b_final <> n_b_antes     then fails:=fails||format('RPC_mexeu_em_B %s->%s ',n_b_antes,n_b_final); end if;

  if length(fails)>0 then raise exception 'WP-METRIC-1a EXTRACAO/SEGURANCA FAIL: %', fails;
  else raise notice 'WP-METRIC-1a EXTRACAO — as duas barreiras (9): PASS'; end if;
end $$;
rollback;
