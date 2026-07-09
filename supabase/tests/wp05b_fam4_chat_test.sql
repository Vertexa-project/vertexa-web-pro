-- =====================================================================================
-- WP-05B · FAMÍLIA 4 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Autorização por PARTICIPAÇÃO. Destaque: SELECT negado ⇒ REALTIME negado (não-participante não recebe).
-- Fixtures: canal CX(paciente X, participantes X+P1), canal CY(paciente Y, participantes Y+P2).
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  daX constant uuid := 'da000000-0000-0000-0000-000000000001';
  daY constant uuid := 'da000000-0000-0000-0000-000000000002';
  CX constant uuid := '51000000-0000-0000-0000-000000000001';
  CY constant uuid := '51000000-0000-0000-0000-000000000002';
  MSX constant uuid := '52000000-0000-0000-0000-000000000001';
  MSY constant uuid := '52000000-0000-0000-0000-000000000002';
  MNX constant uuid := '53000000-0000-0000-0000-000000000001';
  MNY constant uuid := '53000000-0000-0000-0000-000000000002';
  fcX constant uuid := 'fc000000-0000-0000-0000-000000000001';
  fcY constant uuid := 'fc000000-0000-0000-0000-000000000002';
  f1 constant uuid := 'f1000000-0000-0000-0000-000000000001';
  f2 constant uuid := 'f2000000-0000-0000-0000-000000000001';
  fa constant uuid := 'fa000000-0000-0000-0000-000000000001';
begin
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (fa,'aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    (f1,'a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    (f2,'a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','AdminB','active'),
    ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','professional','P3','active'),
    (fcX,'ac000000-0000-0000-0000-000000000001','patient','X','active'),
    (fcY,'ac000000-0000-0000-0000-000000000002','patient','Y','active');
  insert into public.clinics (id, name, owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A',fa),('cb000000-0000-0000-0000-000000000001','B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    ('e1000000-0000-0000-0000-000000000001',f1,'ca000000-0000-0000-0000-000000000001','nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001',f2,'ca000000-0000-0000-0000-000000000001','physiotherapist','member'),
    ('e3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','doctor','member');
  insert into public.patients (id, profile_id, clinic_id) values (daX,fcX,'ca000000-0000-0000-0000-000000000001'),(daY,fcY,'ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    ('e1000000-0000-0000-0000-000000000001',daX,false,'active'),('e2000000-0000-0000-0000-000000000001',daY,false,'active');
  insert into public.chat_channels (id, patient_id) values (CX,daX),(CY,daY);
  insert into public.chat_participants (channel_id, profile_id, role) values (CX,fcX,'patient'),(CX,f1,'professional'),(CY,fcY,'patient'),(CY,f2,'professional');
  insert into public.chat_messages (id, channel_id, sender_profile_id, sender_role, body) values (MSX,CX,f1,'professional','oi X'),(MSY,CY,f2,'professional','oi Y');
  insert into public.chat_mentions (id, message_id, mentioned_profile_id) values (MNX,MSX,fcX),(MNY,MSY,fcY);
  execute 'set local role authenticated';

  -- LEITURA
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.chat_messages)<>1 then fails:=fails||'X_msg1 '; end if;
  if (select count(*) from public.chat_messages where id=MSY)<>0 then fails:=fails||'X_IDOR_MSY '; end if;
  if (select count(*) from public.chat_channels)<>1 then fails:=fails||'X_chan1 '; end if;
  if (select count(*) from public.chat_participants)<>2 then fails:=fails||'X_part2 '; end if;
  if (select count(*) from public.chat_mentions)<>1 then fails:=fails||'X_ment1 '; end if;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.chat_messages)<>1 then fails:=fails||'P1_msg1 '; end if;
  if (select count(*) from public.chat_participants)<>2 then fails:=fails||'P1_part2 '; end if;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);  -- P2: participante CY, NÃO CX
  if (select count(*) from public.chat_messages)<>1 then fails:=fails||'P2_msg_ownCY '; end if;
  if (select count(*) from public.chat_messages where channel_id=CX)<>0 then fails:=fails||'P2_REALTIME_NEG_CX '; end if; -- SELECT negado = realtime negado
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000002"}',true);
  if (select count(*) from public.chat_messages where channel_id=CX)<>0 then fails:=fails||'Y_no_CX '; end if;
  perform set_config('request.jwt.claims','{"sub":"a3000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.chat_messages)<>0 then fails:=fails||'P3_clinicB_0 '; end if;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);  -- admin A lê os 2 (oversight)
  if (select count(*) from public.chat_messages)<>2 then fails:=fails||'ADMIN_read_both '; end if;
  if (select count(*) from public.chat_channels)<>2 then fails:=fails||'ADMIN_chan2 '; end if;
  perform set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001"}',true);  -- admin B ⟂ clínica A
  if (select count(*) from public.chat_messages)<>0 then fails:=fails||'ADMINB_clinic_iso '; end if;

  -- ESCRITA — NEGATIVOS (estado das fixtures)
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.chat_messages(channel_id,sender_profile_id,sender_role,body) values(CX,fcX,'patient','forja'); fails:=fails||'NEG_FORGE_sender '; exception when others then null; end;
  begin update public.chat_messages set channel_id=CY where id=MSX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_move_message '; end if; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.chat_messages(channel_id,sender_profile_id,sender_role,body) values(CX,f2,'professional','intruso'); fails:=fails||'NEG_send_alien_channel '; exception when others then null; end;
  begin insert into public.chat_participants(channel_id,profile_id,role) values(CX,f2,'professional'); fails:=fails||'NEG_autojoin_prof '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000002"}',true);
  begin insert into public.chat_participants(channel_id,profile_id,role) values(CX,fcY,'patient'); fails:=fails||'NEG_autojoin_patient '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin update public.chat_mentions set read_at=now() where id=MNY; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_mark_other_mention '; end if; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.chat_messages(channel_id,sender_profile_id,sender_role,body) values(CX,fa,'admin','admin msg'); fails:=fails||'NEG_admin_send_nonparticipant '; exception when others then null; end;

  -- ESCRITA — POSITIVOS (mudam estado, por último)
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.chat_messages(channel_id,sender_profile_id,sender_role,body) values(CX,f1,'professional','msg'); exception when others then fails:=fails||'POS_P1_send '; end;
  begin insert into public.chat_participants(channel_id,profile_id,role) values(CX,fa,'admin'); exception when others then fails:=fails||'POS_P1_manage_add '; end;
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.chat_messages(channel_id,sender_profile_id,sender_role,body) values(CX,fcX,'patient','msg'); exception when others then fails:=fails||'POS_X_send '; end;
  begin update public.chat_mentions set read_at=now() where id=MNX; get diagnostics n=row_count; if n<>1 then fails:=fails||'POS_X_mark_own_mention '; end if; exception when others then fails:=fails||'POS_X_mark_own_mention_err '; end;

  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.chat_messages)<>0 or (select count(*) from public.chat_channels)<>0
     or (select count(*) from public.chat_participants)<>0 or (select count(*) from public.chat_mentions)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then raise exception 'WP05B-FAM4 TESTS FAILED: %', fails;
  else raise notice 'WP05B-FAM4: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
