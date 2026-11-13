-- Prova de RLS/permissões da consulta assistida. Roda DENTRO de begin; ... rollback; (nada persiste).
-- Uso: begin; <migration>; <este arquivo>; select * from res order by n; rollback;
create temp table res (n serial, t text, ok boolean, detail text);
grant all on res to public; grant usage on sequence res_n_seq to public;

create function pg_temp.asuser(uid uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true) $f$;

do $$
declare
  qa uuid := 'fa747d61-7702-4f8a-a2ac-559b4555aaa5';       -- hefesto.teste (admin, vinculado à Mariana)
  pac uuid := '20f5c2b1-cecf-4021-9e6e-75ce072e4cc9';      -- paciente1.teste (a própria Mariana)
  mariana uuid := 'cc2a636b-aec9-4132-afe7-475d293d67de';
  clinic uuid := '0772a4aa-bf03-482b-8512-ea6557f06a04';
  denied text[][] := array[
    ['paciente (a própria)', '20f5c2b1-cecf-4021-9e6e-75ce072e4cc9'],
    ['admin de outra clínica', 'b80f9f2e-6538-441a-bd6d-ca8c738d1337'],
    ['financeiro da clínica', '57efaff6-fcfe-4c1e-9327-37cf50fcc26b'],
    ['recepção da clínica', '36191555-cfcc-4a87-837e-be8e2c021571'],
    ['membro sem vínculo', '9b75ae26-39ca-498b-a9ca-543656c878e5']];
  enc uuid; n int; i int; chunk uuid; notif uuid; r jsonb; v_path text; v_err text; seg_n int;
begin
  perform pg_temp.asuser(qa); set local role authenticated;
  enc := public.clinical_start_encounter(mariana);
  insert into res(t,ok) values ('equipe vinculada inicia atendimento', enc is not null);
  select count(*) into n from public.clinical_encounters where id = enc;
  insert into res(t,ok,detail) values ('equipe lê o atendimento', n = 1, n::text);
  select count(*) into n from public.clinical_templates;
  insert into res(t,ok,detail) values ('equipe lê o modelo', n >= 1, n::text);
  select count(*) into n from public.clinical_list_encounters(mariana);
  insert into res(t,ok,detail) values ('equipe lista atendimentos (RPC)', n >= 1, n::text);
  reset role;

  -- negações em leitura e escrita
  for i in 1 .. array_length(denied, 1) loop
    perform pg_temp.asuser(denied[i][2]::uuid); set local role authenticated;
    select count(*) into n from public.clinical_encounters;
    insert into res(t,ok,detail) values (denied[i][1] || ': não lê atendimentos', n = 0, n::text);
    select count(*) into n from public.clinical_records;
    insert into res(t,ok,detail) values (denied[i][1] || ': não lê prontuário', n = 0, n::text);
    select count(*) into n from public.clinical_templates;
    insert into res(t,ok,detail) values (denied[i][1] || ': templates', case when denied[i][1] in ('paciente (a própria)') then n = 0 else true end, n::text);
    select count(*) into n from public.clinical_list_encounters(mariana);
    insert into res(t,ok,detail) values (denied[i][1] || ': RPC de lista vazia', n = 0, n::text);
    insert into res(t,ok,detail) values (denied[i][1] || ': check access = false', public.clinical_check_encounter_access(enc) = false, null);
    begin
      perform public.clinical_start_encounter(mariana);
      insert into res(t,ok,detail) values (denied[i][1] || ': não inicia atendimento', false, 'iniciou!');
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into res(t,ok,detail) values (denied[i][1] || ': não inicia atendimento', v_err = 'FORBIDDEN', v_err);
    end;
    begin
      perform public.clinical_save_field(enc, 'queixa.queixa_principal', 'x');
      insert into res(t,ok,detail) values (denied[i][1] || ': não grava campo', false, 'gravou!');
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into res(t,ok,detail) values (denied[i][1] || ': não grava campo', v_err = 'FORBIDDEN', v_err);
    end;
    begin
      perform public.clinical_send_agreements(enc, 'x');
      insert into res(t,ok,detail) values (denied[i][1] || ': não envia combinados', false, 'enviou!');
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into res(t,ok,detail) values (denied[i][1] || ': não envia combinados', v_err = 'FORBIDDEN', v_err);
    end;
    reset role;
  end loop;

  -- escrita direta nas tabelas é negada à equipe também (só via RPC)
  perform pg_temp.asuser(qa); set local role authenticated;
  begin
    update public.clinical_records set fields = '{}'::jsonb where encounter_id = enc;
    insert into res(t,ok,detail) values ('equipe não escreve direto na tabela', false, 'escreveu');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('equipe não escreve direto na tabela', v_err like 'permission denied%', v_err);
  end;

  -- fluxo: sem aceite não grava
  begin
    perform public.clinical_set_status(enc, 'gravando');
    insert into res(t,ok,detail) values ('sem aceite não grava', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('sem aceite não grava', v_err = 'CONSENT_REQUIRED', v_err);
  end;
  perform public.clinical_record_consent(enc, 'v1-2026-11', 'texto');
  perform public.clinical_set_status(enc, 'gravando');
  v_path := clinic::text || '/' || enc::text || '/0.webm';
  chunk := public.clinical_register_chunk(enc, 0, v_path, 'audio/webm', 1000, 5000);
  insert into res(t,ok) values ('registra pedaço de áudio', chunk is not null);
  begin
    perform public.clinical_register_chunk(enc, 1, clinic::text || '/' || gen_random_uuid()::text || '/1.webm', 'audio/webm', 1, 1);
    insert into res(t,ok,detail) values ('caminho de outro atendimento é recusado', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('caminho de outro atendimento é recusado', v_err = 'INVALID_PATH', v_err);
  end;
  reset role;

  -- storage: policy do bucket
  perform pg_temp.asuser(qa); set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values ('clinical-audio', v_path, qa, '{}'::jsonb);
    insert into res(t,ok) values ('storage: equipe grava no próprio atendimento', true);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('storage: equipe grava no próprio atendimento', false, v_err);
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values ('clinical-audio', clinic::text || '/' || gen_random_uuid()::text || '/0.webm', qa, '{}'::jsonb);
    insert into res(t,ok,detail) values ('storage: caminho de atendimento inexistente é negado', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('storage: caminho de atendimento inexistente é negado', v_err like '%row-level security%', v_err);
  end;
  reset role;
  perform pg_temp.asuser(pac); set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'clinical-audio';
  insert into res(t,ok,detail) values ('storage: paciente não vê áudio', n = 0, n::text);
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values ('clinical-audio', clinic::text || '/' || enc::text || '/9.webm', pac, '{}'::jsonb);
    insert into res(t,ok,detail) values ('storage: paciente não grava', false, null);
  exception when others then
    insert into res(t,ok) values ('storage: paciente não grava', true);
  end;
  reset role;
  perform pg_temp.asuser('fa747d61-7702-4f8a-a2ac-559b4555aaa5'); set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'clinical-audio';
  insert into res(t,ok,detail) values ('storage: equipe vê o áudio', n = 1, n::text);
  reset role;
  perform pg_temp.asuser('b80f9f2e-6538-441a-bd6d-ca8c738d1337'); set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'clinical-audio';
  insert into res(t,ok,detail) values ('storage: outra clínica não vê áudio', n = 0, n::text);
  reset role;

  -- IA aplica, edição manual trava, IA não sobrescreve
  insert into public.clinical_transcript_segments (encounter_id, clinic_id, chunk_id, ord, speaker, text, is_demo)
  values (enc, clinic, chunk, 1, 'Médica', 'teste', true);
  set local role service_role;
  r := public.clinical_apply_ai_fields(enc, '{"queixa.queixa_principal":{"value":"IA 1","sources":[1]},"queixa.historia":{"value":"hist IA","sources":[1]},"campo.inexistente":{"value":"x"}}'::jsonb, null, true);
  insert into res(t,ok,detail) values ('IA aplica 2 campos e ignora o inexistente', (r->>'applied')::int = 2 and (r->>'skipped')::int = 1, r::text);
  reset role;
  perform pg_temp.asuser(qa); set local role authenticated;
  perform public.clinical_save_field(enc, 'queixa.queixa_principal', 'Editado à mão');
  reset role; set local role service_role;
  r := public.clinical_apply_ai_fields(enc, '{"queixa.queixa_principal":{"value":"IA 2","sources":[1]},"queixa.historia":{"value":"hist IA 2","sources":[1]}}'::jsonb, null, true);
  insert into res(t,ok,detail) values ('IA pula campo travado e atualiza o livre', (r->>'applied')::int = 1 and (r->>'skipped')::int = 1, r::text);
  reset role;
  insert into res(t,ok)
    select 'campo travado mantém o texto manual e o livre recebe a IA',
           (fields->'queixa.queixa_principal'->>'value') = 'Editado à mão' and (fields->'queixa.historia'->>'value') = 'hist IA 2'
      from public.clinical_records where encounter_id = enc;
  perform pg_temp.asuser(qa); set local role authenticated;
  -- equipe não chama a RPC de IA
  begin
    perform public.clinical_apply_ai_fields(enc, '{}'::jsonb, null, false);
    insert into res(t,ok,detail) values ('equipe não chama a RPC da IA', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('equipe não chama a RPC da IA', v_err like 'permission denied%', v_err);
  end;
  select count(*) into n from public.clinical_record_versions where encounter_id = enc;
  insert into res(t,ok,detail) values ('histórico de versões registrado', n >= 4, n::text);

  -- finalização, imutabilidade, adendo, combinados
  begin
    perform public.clinical_finalize(enc);
    insert into res(t,ok,detail) values ('não finaliza durante a gravação', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('não finaliza durante a gravação', v_err = 'ENCOUNTER_NOT_READY', v_err);
  end;
  perform public.clinical_set_status(enc, 'processando');
  perform public.clinical_set_status(enc, 'rascunho');
  perform public.clinical_finalize(enc);
  insert into res(t,ok) values ('finaliza', true);
  begin
    perform public.clinical_save_field(enc, 'queixa.historia', 'depois');
    insert into res(t,ok,detail) values ('finalizado é imutável (save_field)', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('finalizado é imutável (save_field)', v_err = 'ENCOUNTER_NOT_EDITABLE', v_err);
  end;
  perform public.clinical_add_addendum(enc, 'Adendo de teste');
  select count(*) into n from public.clinical_addenda where encounter_id = enc;
  insert into res(t,ok,detail) values ('adendo é aceito após finalizar', n = 1, n::text);
  notif := public.clinical_send_agreements(enc, 'Combinados: enviar exames até sexta.');
  insert into res(t,ok) values ('envia combinados', notif is not null);
  reset role;
  begin
    update public.clinical_records set fields = '{}'::jsonb where encounter_id = enc;
    insert into res(t,ok,detail) values ('trigger: update direto em finalizado é barrado (postgres)', false, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into res(t,ok,detail) values ('trigger: update direto em finalizado é barrado (postgres)', v_err = 'ENCOUNTER_FINALIZED', v_err);
  end;
  -- o paciente vê a notificação, mas não o prontuário
  perform pg_temp.asuser(pac); set local role authenticated;
  select count(*) into n from public.notifications where id = notif;
  insert into res(t,ok,detail) values ('paciente vê a notificação dos combinados', n = 1, n::text);
  select count(*) into n from public.clinical_encounters;
  insert into res(t,ok,detail) values ('paciente segue sem ver o atendimento', n = 0, n::text);
  select count(*) into n from public.clinical_agreement_sends;
  insert into res(t,ok,detail) values ('paciente não vê o log de envios', n = 0, n::text);
  reset role;
end $$;
