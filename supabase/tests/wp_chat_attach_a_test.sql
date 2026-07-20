-- =====================================================================================
-- WP-CHAT-ATTACH · A — TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Anexo em bucket dedicado chat-attachments, pasta = channel_id; autorização por PARTICIPAÇÃO
-- no canal (NÃO por acesso ao paciente) — é isso que impede o vazamento para profissional VINCULADO
-- ao paciente mas fora do canal. Assume a migration 20260727090000 já aplicada no schema.
-- Fixtures como postgres (bypassrls); nada persiste (rollback).
--
-- DESTAQUES: não-participante ⟂ anexo (objeto E metadado); admin LÊ mas NÃO envia; pasta de canal
-- alheio ⟂; mensagem apontando anexo de outro canal ⟂ (item v); DELETE só de órfão do próprio uploader.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; n int;
  -- profiles / auth
  adminA constant uuid := 'faa00000-0000-0000-0000-000000000001'; au_adminA constant uuid := 'aaa00000-0000-0000-0000-000000000001';
  p1     constant uuid := 'f1000000-0000-0000-0000-000000000001'; au_p1     constant uuid := 'a1000000-0000-0000-0000-000000000001';
  p2     constant uuid := 'f2000000-0000-0000-0000-000000000001'; au_p2     constant uuid := 'a2000000-0000-0000-0000-000000000001';
  p3     constant uuid := 'f3000000-0000-0000-0000-000000000001'; au_p3     constant uuid := 'a3000000-0000-0000-0000-000000000001';
  adminB constant uuid := 'fbb00000-0000-0000-0000-000000000001'; au_adminB constant uuid := 'abb00000-0000-0000-0000-000000000001';
  pxProf constant uuid := 'fc000000-0000-0000-0000-000000000001'; au_px     constant uuid := 'ac000000-0000-0000-0000-000000000001';
  pzProf constant uuid := 'fc000000-0000-0000-0000-000000000002'; au_pz     constant uuid := 'ac000000-0000-0000-0000-000000000002';
  -- clinics / professionals / patients
  clA constant uuid := 'ca000000-0000-0000-0000-000000000001'; clB constant uuid := 'cb000000-0000-0000-0000-000000000001';
  e1  constant uuid := 'e1000000-0000-0000-0000-000000000001'; e2 constant uuid := 'e2000000-0000-0000-0000-000000000001'; e3 constant uuid := 'e3000000-0000-0000-0000-000000000001';
  daX constant uuid := 'da000000-0000-0000-0000-000000000001'; daZ constant uuid := 'da000000-0000-0000-0000-000000000002';
  -- channels
  chX constant uuid := 'c8000000-0000-0000-0000-0000000000a1'; chZ constant uuid := 'c8000000-0000-0000-0000-0000000000b1';
  -- paths (pasta = channel_id)
  attRef   constant text := 'c8000000-0000-0000-0000-0000000000a1/att1.pdf';       -- referenciado por mensagem
  orphanP1 constant text := 'c8000000-0000-0000-0000-0000000000a1/orphan-p1.pdf';   -- órfão, dono = P1
  orphanX  constant text := 'c8000000-0000-0000-0000-0000000000a1/orphan-x.pdf';    -- órfão, dono = paciente X
  objZ     constant text := 'c8000000-0000-0000-0000-0000000000b1/z.pdf';           -- outro canal/clínica
  -- bucket config
  b_public boolean; b_limit bigint; b_mimes text[];
begin
  -- ===== FIXTURES (postgres / bypassrls) =====
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    (adminA, au_adminA,'admin','AdminA','active'),
    (p1, au_p1,'professional','P1 (participante)','active'),
    (p2, au_p2,'professional','P2 (vinculado, NAO participante)','active'),
    (p3, au_p3,'professional','P3 (clinica B)','active'),
    (adminB, au_adminB,'admin','AdminB','active'),
    (pxProf, au_px,'patient','Paciente X','active'),
    (pzProf, au_pz,'patient','Paciente Z','active');
  insert into public.clinics (id, name, owner_profile_id) values (clA,'A',adminA), (clB,'B',adminB);
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    (e1, p1, clA,'nutritionist','member'),
    (e2, p2, clA,'physiotherapist','member'),
    (e3, p3, clB,'doctor','member');
  insert into public.patients (id, profile_id, clinic_id) values (daX, pxProf, clA), (daZ, pzProf, clB);
  -- P1 E P2 vinculados a X; P2 é o vetor de vazamento (vinculado mas fora do canal)
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (e1, daX, false, 'active'), (e2, daX, false, 'active');
  insert into public.chat_channels (id, patient_id) values (chX, daX), (chZ, daZ);
  -- participantes: canal X = {P1, paciente X}; canal Z = {P3}
  insert into public.chat_participants (channel_id, profile_id, role) values
    (chX, p1,'professional'), (chX, pxProf,'patient'), (chZ, p3,'professional');
  -- mensagem só-anexo referenciando attRef (torna attRef NÃO-órfão) — prova o CHECK com body null
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body, attachment_path, attachment_name, attachment_mime, attachment_size)
    values (chX, p1,'professional', null, attRef,'att1.pdf','application/pdf',12345);
  -- objetos (dono explícito = auth uid do uploader)
  insert into storage.objects (bucket_id, name, owner) values
    ('chat-attachments', attRef,   au_p1),
    ('chat-attachments', orphanP1, au_p1),
    ('chat-attachments', orphanX,  au_px),
    ('chat-attachments', objZ,     au_p3);

  -- ===== (iii) CONFIG DO BUCKET =====
  select public, file_size_limit, allowed_mime_types into b_public, b_limit, b_mimes
    from storage.buckets where id='chat-attachments';
  if b_public is distinct from false then fails:=fails||'bucket_not_private '; end if;
  if b_limit  is distinct from 10485760 then fails:=fails||'bucket_size_limit '; end if;
  if not (b_mimes @> array['application/pdf','image/jpeg','image/png','image/webp']
          and array['application/pdf','image/jpeg','image/png','image/webp'] @> b_mimes)
    then fails:=fails||'bucket_mimes '; end if;

  execute 'set local role authenticated';

  -- ===== LEITURA (objeto + metadado) =====
  -- P1 (participante): LÊ o objeto e a mensagem do canal X.
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  if (select count(*) from storage.objects where name=attRef)<>1 then fails:=fails||'P1_read_obj '; end if;
  if (select count(*) from public.chat_messages where channel_id=chX)<>1 then fails:=fails||'P1_read_meta '; end if;
  -- Paciente X (participante): LÊ.
  perform set_config('request.jwt.claims', json_build_object('sub',au_px::text)::text, true);
  if (select count(*) from storage.objects where name=attRef)<>1 then fails:=fails||'X_read_obj '; end if;
  if (select count(*) from public.chat_messages where channel_id=chX)<>1 then fails:=fails||'X_read_meta '; end if;
  -- Admin A (oversight, NÃO participante): LÊ objeto e metadado.
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true);
  if (select count(*) from storage.objects where name=attRef)<>1 then fails:=fails||'ADMIN_read_obj '; end if;
  if (select count(*) from public.chat_messages where channel_id=chX)<>1 then fails:=fails||'ADMIN_read_meta '; end if;
  -- *** VAZAMENTO *** P2 (VINCULADO a X, NÃO participante): ⟂ objeto E ⟂ metadado.
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true);
  if (select count(*) from storage.objects where name=attRef)<>0 then fails:=fails||'LEAK_P2_obj '; end if;
  if (select count(*) from public.chat_messages where channel_id=chX)<>0 then fails:=fails||'LEAK_P2_meta '; end if;
  -- P3 (clínica B): isolamento — ⟂ objeto e metadado do canal X.
  perform set_config('request.jwt.claims', json_build_object('sub',au_p3::text)::text, true);
  if (select count(*) from storage.objects where name=attRef)<>0 then fails:=fails||'P3_iso_obj '; end if;
  if (select count(*) from public.chat_messages where channel_id=chX)<>0 then fails:=fails||'P3_iso_meta '; end if;

  -- ===== NEGATIVOS de ESCRITA =====
  perform set_config('storage.allow_delete_query','true',true); -- exercita a RLS de DELETE (não o trigger)

  -- Admin A NÃO envia (não é participante): nem objeto, nem mensagem.
  perform set_config('request.jwt.claims', json_build_object('sub',au_adminA::text)::text, true);
  begin insert into storage.objects (bucket_id,name) values ('chat-attachments', chX::text||'/admin.pdf'); fails:=fails||'NEG_admin_insert_obj '; exception when others then null; end;
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body) values (chX, adminA,'admin','oi'); fails:=fails||'NEG_admin_send_msg '; exception when others then null; end;

  -- P1 NÃO grava objeto na pasta de OUTRO canal (chZ).
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  begin insert into storage.objects (bucket_id,name) values ('chat-attachments', chZ::text||'/evil.pdf'); fails:=fails||'NEG_P1_other_folder '; exception when others then null; end;
  -- (v) P1 NÃO cria mensagem em chX apontando anexo de chZ (referência cruzada).
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body,attachment_path) values (chX, p1,'professional', null, objZ); fails:=fails||'NEG_cross_channel_ref '; exception when others then null; end;
  -- Família 4: P1 NÃO forja remetente (sender != current profile).
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body) values (chX, pxProf,'patient','forjada'); fails:=fails||'NEG_forge_sender '; exception when others then null; end;
  -- CHECK: mensagem sem body E sem anexo ⟂.
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body) values (chX, p1,'professional', null); fails:=fails||'NEG_empty_msg_check '; exception when others then null; end;
  -- DELETE de anexo JÁ REFERENCIADO (mesmo sendo dono) ⟂ (0 linhas).
  begin delete from storage.objects where name=attRef; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_delete_referenced '; end if; exception when others then null; end;
  -- DELETE de órfão de OUTRO usuário ⟂ (owner != auth.uid()) — P1 tenta apagar órfão do paciente X.
  begin delete from storage.objects where name=orphanX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_delete_others_orphan '; end if; exception when others then null; end;

  -- ===== POSITIVOS (por último) =====
  -- P1 (participante) grava objeto na pasta do canal X.
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  begin insert into storage.objects (bucket_id,name,owner) values ('chat-attachments', chX::text||'/p1-new.pdf', au_p1); exception when others then fails:=fails||'POS_P1_insert_obj '; end;
  -- P1 mensagem SÓ-ANEXO (body null) e SÓ-TEXTO (regressão) e com anexo do próprio canal.
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body,attachment_path) values (chX, p1,'professional', null, chX::text||'/p1-new.pdf'); exception when others then fails:=fails||'POS_P1_msg_attachonly '; end;
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body) values (chX, p1,'professional','so texto'); exception when others then fails:=fails||'POS_P1_msg_textonly '; end;
  -- Paciente X (participante) envia com anexo.
  perform set_config('request.jwt.claims', json_build_object('sub',au_px::text)::text, true);
  begin insert into storage.objects (bucket_id,name,owner) values ('chat-attachments', chX::text||'/x-new.png', au_px); exception when others then fails:=fails||'POS_X_insert_obj '; end;
  begin insert into public.chat_messages (channel_id,sender_profile_id,sender_role,body,attachment_path,attachment_mime) values (chX, pxProf,'patient','olha o exame', chX::text||'/x-new.png','image/png'); exception when others then fails:=fails||'POS_X_msg_attach '; end;
  -- P1 apaga ÓRFÃO do PRÓPRIO uploader ✓ (1 linha).
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  begin delete from storage.objects where name=orphanP1; get diagnostics n=row_count; if n<>1 then fails:=fails||'POS_delete_own_orphan '; end if; exception when others then fails:=fails||'POS_delete_own_orphan_exc '; end;

  -- ===== ANON: ⟂ tudo =====
  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from storage.objects where bucket_id='chat-attachments')<>0 then fails:=fails||'anon_read_denied '; end if;
  begin insert into storage.objects (bucket_id,name) values ('chat-attachments', chX::text||'/anon.pdf'); fails:=fails||'anon_insert_denied '; exception when others then null; end;
  execute 'reset role';

  if length(fails) > 0 then raise exception 'WP-CHAT-ATTACH A TESTS FAILED: %', fails;
  else raise notice 'WP-CHAT-ATTACH A: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
