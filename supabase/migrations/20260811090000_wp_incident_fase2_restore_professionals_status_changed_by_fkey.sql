-- =====================================================================================
-- INCIDENTE (2026-07-30) · FASE 2 — devolve a FK professionals_status_changed_by_fkey.
--
-- ⚠️⚠️  NÃO APLIQUE ESTA MIGRATION SOZINHA. ELA É A METADE PERIGOSA DE UM PAR ORDENADO.  ⚠️⚠️
--
--   ORDEM OBRIGATÓRIA, e não é recomendação:
--     1º  o frontend desambiguado (A1 deste WP) tem de estar MERGEADO **e PUBLICADO**,
--         isto é, com o bundle novo SERVIDO em produção — não basta estar na main;
--     2º  só então aplicar esta migration.
--
--   SE ESTA FK VOLTAR ANTES DO BUNDLE NOVO ESTAR NO AR, O PAINEL CAI DE NOVO, do mesmo jeito
--   e pelo mesmo motivo do dia 30/07: com duas FKs entre `professionals` e `profiles`, todo
--   embed CRU dessa dupla vira 300 / PGRST201, o `getCurrentProfessional` para de resolver a
--   identidade e o painel trata TODA profissional como acesso pendente — inclusive a dona da
--   clínica. Não há erro no apply, nenhum hash se move e nenhum teste acusa: o estrago só
--   aparece no navegador de quem logar depois.
--
--   O deploy deste repositório é BLOQUEADO POR AUTOR no Vercel (o check "Vercel" reprova todo
--   commit cujo git author é `seeniam`). Quem aplicar isto precisa confirmar ANTES, com o
--   Neemias, que a versão publicada já contém os 9 embeds nomeados.
--
-- COMO CONFERIR QUE O 1º PASSO ESTÁ FEITO (no navegador, na aba Network do painel em produção):
--   a requisição de identidade tem de sair como
--     professionals?select=id,profile_id,clinic_id,type,profile:profiles!professionals_profile_id_fkey(...)
--   Se ainda sair `profile:profiles(...)` sem o `!`, o bundle antigo ainda está no ar: PARE.
--
-- O QUE ISTO FAZ E POR QUÊ
-- A migration 20260808090000 (WP-TEAM-2b-ii) criou a coluna com
--     status_changed_by uuid references public.profiles(id)
-- e essa FK implícita abriu o SEGUNDO caminho professionals -> profiles. A mitigação de 30/07
-- (20260809090000) derrubou SOMENTE a constraint, mantendo a coluna. Desde então perdemos a
-- garantia declarativa de que `status_changed_by` aponta para um profile existente. Esta
-- migration devolve essa garantia, agora que os embeds nomeiam a constraint e não dependem mais
-- do PostgREST adivinhar.
--
-- IDÊNTICA À ORIGINAL: a FK de origem nasceu de `references public.profiles(id)` sem cláusula de
-- ação, ou seja ON UPDATE NO ACTION / ON DELETE NO ACTION, não deferrable — que é exatamente o
-- que o comando abaixo recria, com o mesmo nome auto-gerado de antes.
--
-- IDEMPOTENTE: o Postgres não tem `add constraint if not exists`, então vai em bloco condicional.
--
-- ROLLBACK (volta ao estado de hoje, e é o mesmo comando da mitigação de 30/07):
--   alter table public.professionals drop constraint if exists professionals_status_changed_by_fkey;
--
-- NÃO ALTERA: nenhuma policy, nenhum helper de private, nenhuma âncora, nenhum privilégio,
-- nenhuma linha de dado. Só volta 1 constraint.
--
-- ⚠️ QUINTA PROVA, declarada de antemão: esta migration ACRESCENTA UMA FK e, com ela, a dupla
--   (professionals, profiles) volta a ter DUAS relações — 98 -> 99 FKs, e a lista de duplas com
--   mais de uma relação passa de 3 para 4. Isso é o efeito PRETENDIDO, e é precisamente por isso
--   que o passo 1 da ordem acima não é negociável.
-- =====================================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'professionals_status_changed_by_fkey'
       and c.conrelid = 'public.professionals'::regclass
  ) then
    alter table public.professionals
      add constraint professionals_status_changed_by_fkey
      foreign key (status_changed_by) references public.profiles(id);
  end if;
end $$;

-- Ledger humano.
insert into public.schema_migration_log (version, filename, description, session)
values ('20260811090000','20260811090000_wp_incident_fase2_restore_professionals_status_changed_by_fkey.sql',
  'INCIDENTE 2026-07-30 FASE 2: devolve a constraint professionals_status_changed_by_fkey (a coluna '
  'nunca saiu), identica a original (references profiles(id), NO ACTION, nao deferrable). So pode ser '
  'aplicada DEPOIS que o frontend com os 9 embeds nomeados (profile:profiles!professionals_profile_id_fkey) '
  'estiver MERGEADO E PUBLICADO — antes disso, a segunda FK torna ambiguo todo embed cru '
  'professionals->profiles e derruba o painel com 300/PGRST201, como em 30/07. Efeito pretendido nas '
  'contagens: FKs 98->99 e duplas com mais de uma relacao 3->4. Nenhuma policy, helper, ancora, '
  'privilegio ou dado alterado.',
  'INCIDENTE-FASE2')
on conflict (version) do nothing;
