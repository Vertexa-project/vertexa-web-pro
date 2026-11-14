-- FIN-E9 (achado D48): tipos de evento da linha do tempo usados pelos documentos clínicos.
-- activity_events.type tem chave estrangeira para activity_event_types; sem estes tipos a assinatura falhava (23503).
insert into public.activity_event_types (type, counts_as_adherence, counts_as_interaction, note) values
  ('document_signed', false, false, 'Documento clínico assinado (receita, atestado, exames ou relatório).'),
  ('document_invalidated', false, false, 'Documento clínico invalidado com motivo.')
on conflict (type) do nothing;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261118120000','20261118120000_fin_e9_activity_types.sql','FIN-E9: tipos de evento document_signed/document_invalidated na linha do tempo (achado D48).','FIN-E9');
