# WP-05 — Relatório da FASE A (limpeza + planos para revisão)

> Estado: **Fase A concluída.** Fase B (trancar RLS) **NÃO iniciada** — aguarda revisão/aprovação do dono.
> Branch: `feat/rls-real-web` (a partir de `origin/main` = 80d0892). Projeto Supabase: `cdhjfyyuhmwrcuxqavib`.
> Os planos abaixo já incorporam uma **revisão adversarial** (6 revisores atacando o desenho); os furos achados
> estão marcados como **[RT]** e já foram corrigidos no desenho.

---

## PARTE 1 — O QUE FOI EXECUTADO (limpeza)

### Passo 0 — versões conferidas
- web `origin/main` = `80d0892d3ae86bd62b62548bddb1ebc3f38e16f2` ("Merge PR #8 from feat/auth-patient-surface").
- app `vertexa-app-paciente` `origin/main` = `b7233f8b4454493cb12367b8690fa2ed1532cb85` ("Merge PR #3 from feat/auth-google-app").
- **Ressalva honesta:** os SHAs do briefing tinham 2 e 1 chars a menos (`…548bd1ebc…` vs real `…548bddb1ebc…`;
  `b7233f8b45…` vs real `b7233f8b445…`). Os prefixos `80d0892` / `b7233f8` resolvem de forma ÚNICA exatamente
  esses commits de topo do `main` → intenção inequívoca, considerado match. Fetch autenticado OK, sem pedir senha.
- Branch `feat/rls-real-web` criado do `origin/main` conferido.

### A1/A2 — inventário e prova de descartabilidade
- 39 tabelas em `public`. `auth.users`/identities/sessions/refresh_tokens = **0** (nenhum login real jamais).
- 5 profiles, TODOS com UUID fixo de demo (`…a1/a2/b1/b2/b3`), e-mail de teste (`@clinicavertice.com`/`@email.com`)
  e `auth_user_id = NULL`. Única clínica = Clínica Vértice (`…c1`, owner = a1/admin). Únicos pacientes b1/b2/b3;
  únicos profissionais e1/e2. → toda linha das tabelas escopadas é demo por FK transitiva.
- Storage: 2 objetos, ambos `demo/mariana/*.png` (owner null). `progress_photos.photo_url` guardava a **URL pública inteira**.
- **Nenhuma linha ficou sem prova de ser descartável.**

### A3/A6 — migration de limpeza (aplicada)
- `supabase/migrations/20260710090000_wp05a_purge_demo_data.sql` (commit `bf71225`).
- Natureza declarada com honestidade: **destrutiva/de contração** (apaga dados), NÃO aditiva. Versionada, auditável,
  determinística, com rollback conhecido (re-semear via seeds idempotentes).
- 36 tabelas escopadas esvaziadas na ordem folhas→raízes (validada por dry-run com ROLLBACK; zero FK violation).
- **Estrutura idêntica antes/depois** (fingerprint): `39 tabelas / 277 colunas / 4 enums / 6 funcs / 5 triggers /
  7 event triggers / 2 buckets / 69 policies / 64 índices / 56 FKs / 9 checks`.
- **Preservado:** `achievements` (catálogo, 12), `schema_migration_log` (ledger, 18→19 c/ a linha de auditoria desta
  limpeza), `auth_trigger_events` (0). Nenhuma função/trigger/bucket derrubado.
- Gates: **typecheck OK · lint OK · build OK**.

### A4 — usuários de login
- `auth.users` já estava **vazio** → **no-op**. Nada removido via Admin API (não havia o que remover).

### Storage — passo do dono (não feito no braço, de propósito)
- 2 objetos demo em `progress-photos` (`demo/mariana/antes.png`, `depois.png`) **não** removidos: apagar só a linha de
  `storage.objects` orfanaria o blob no S3 e a regra do WP proíbe mexer em metadados no braço. Remoção coerente
  (arquivo+registro) exige **Storage API** (service key) → passo do dono. Além disso o Plano 5 vai rearquitetar o bucket.
  - Comando sugerido (Node com service key, **NÃO** no client):
    `supabase.storage.from('progress-photos').remove(['demo/mariana/antes.png','demo/mariana/depois.png'])`

---

## PARTE 2 — PLANOS (desenho para aprovar; nada disto foi executado)

### Fundamentos de identidade (base de todos os planos) — Plano 2 núcleo
- Identidade: `auth.uid()` (JWT verificado) → `profiles.auth_user_id` → `profiles.id`. **Nunca** usar `user_metadata`.
- Helpers de autorização em schema **`private`** (não exposto na Data API), `security definer`, **`set search_path=''`**
  (tudo schema-qualified), `stable`, `execute` só a `authenticated`, `usage` no schema só a `authenticated`,
  `revoke` de `public`/`anon`.
- **[RT-crítico] NÃO usar `FORCE ROW LEVEL SECURITY`** nas tabelas lidas pelos helpers (patients/profiles/clinics/
  professionals/links): FORCE remove o bypass do owner e os helpers self-recursam (erro 42P17) + quebram o
  `handle_new_user` (provisionamento). Só `enable row level security` (já ligado). A linha "opcional force" do rascunho
  foi **removida**.
- **[RT] Anti-recursão:** NENHUM corpo de policy pode referenciar tabela com RLS diretamente. Toda travessia de FK
  passa por helper `private.*` SECURITY DEFINER (que bypassa RLS em modo ENABLE).

Helpers (conjunto final, já com correções [RT]):
```sql
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- identidade
private.current_profile_id() -> uuid            -- profiles.auth_user_id = auth.uid()
-- admin como CONJUNTO (ver decisão do dono #1), não só owner_profile_id
private.is_clinic_admin(clinic uuid) -> bool
private.is_clinic_member(clinic uuid) -> bool   -- profissional pertence à clínica (p/ agenda/calendar)
-- vínculo paciente (SEPARANDO externo)
private.is_self_patient(p uuid) -> bool
private.is_common_professional_of_patient(p uuid) -> bool   -- link.is_external = false, status='active'
private.is_external_professional_of_patient(p uuid) -> bool -- link.is_external = true, status='active'
private.patient_clinic(p uuid) -> uuid
private.can_access_patient(p uuid) -> bool        -- self OR common-prof OR clinic-admin  (NÃO inclui externo)
-- resolvedores de join p/ tabelas SEM patient_id  [RT-crítico]
private.can_access_via_nutrition_plan(id uuid) -> bool   -- meals
private.can_access_via_workout_plan(id uuid) -> bool     -- workouts
private.can_access_via_workout(id uuid) -> bool          -- workout_exercises
private.can_access_via_session_log(id uuid) -> bool      -- workout_set_logs
private.can_access_channel(id uuid) -> bool              -- chat_messages/participants (channel→patient)
private.can_access_via_message(id uuid) -> bool          -- chat_mentions
-- storage: 1º segmento de pasta como uuid SEGURO (sem 22P02)
private.folder_patient(name text) -> uuid               -- NULL se não for uuid
```
Cada função: `security definer`, `set search_path=''`, `stable`, `execute` só `authenticated`.

### PLANO 1 — Matriz de autorização (com correções [RT])

elo admin↔clínica: hoje o único elo é `clinics.owner_profile_id → profiles.id` (provado: clínica c1 owner = a1).
**[RT-alto]** Amarrar admin só a `owner_profile_id` tranca co-admins. → **Decisão do dono #1**: modelar admin como
CONJUNTO (tabela `clinic_admins(clinic_id, profile_id)` OU flag `professionals.is_clinic_admin`), semeando 1 membro a
partir de `owner_profile_id`. `owner_profile_id` fica só como "dono/faturamento".

| Ator | LÊ | ESCREVE |
|---|---|---|
| admin (membro de clinic_admins de X) | tudo da clínica X | pacientes/links/campanhas/planos de X; NÃO muda owner de clínica |
| profissional comum (link.is_external=false) | só pacientes com link ativo | planos clínicos do paciente linkado (nutri→nutrition_plans/meals; treino→workout_*); documentos/avaliações do linkado |
| profissional EXTERNO (link.is_external=true) | **subconjunto restrito** do paciente linkado (**Decisão do dono #2**) | idem restrito |
| paciente | só a si | self-writes do app (peso, refeição, suplemento, foto, chat) |

**[RT] "mesma clínica ≠ acesso"** é garantido: `can_access_patient` NÃO tem ramo de clínica p/ profissional comum
(só via link). Agenda/calendar (clinic-scoped) usa `is_clinic_admin OR dono-da-conexão`, nunca "membro da clínica" solto.

**[RT-alto] Externo restrito NÃO implementado no rascunho** (o helper ignorava is_external). Corrigido: `can_access_patient`
exclui externo; só uma **whitelist explícita** de tabelas (a definir na Decisão #2) também aceita
`is_external_professional_of_patient`. Sugestão de whitelist do externo: linha-núcleo do paciente + planos da própria
disciplina; **NUNCA** `patient_documents`, `body_assessments`, `chat_*`, agenda.

### Matriz de ESCRITA (novo — [RT-crítico], o rascunho só tinha SELECT+admin)
- **Paciente (app)** `is_self_patient`: weight_logs, meal_logs, supplement_intakes, activity_events, progress_photos,
  chat_messages (como participante do canal). Sem isto, **o app paciente para de gravar**.
- **Profissional** `is_common_professional_of_patient` (ou admin): nutrition_plans, meals, workout_plans/workouts/
  workout_exercises, patient_documents, body_assessments, muscle_recovery_states.
- **Só service_role / Edge Function**: adherence_snapshots, patient_achievements (engine), notifications (emissor),
  calendar_* (writes), clinics, professionals.
- **Só admin da clínica do paciente**: professional_patient_links (INSERT/UPDATE/DELETE) — **[RT-crítico]** senão um
  profissional se auto-concede acesso inserindo o próprio link.
- **profiles UPDATE**: só colunas `full_name`/`avatar_url` do próprio; `role`/`auth_user_id`/`email` **imutáveis** a
  `authenticated` (trigger BEFORE UPDATE ou column-grants). **[RT-alto]** + assert que NENHUMA policy referencia
  `profiles.role` (torna "role é cosmético" verificável por máquina).
- **clinics INSERT/UPDATE**: **deny-all** p/ authenticated (provisionamento via service_role). Proibir mudar
  `owner_profile_id`. **[RT-crítico]** senão vira admin criando/roubando clínica.
- **profiles/clinics/professionals SELECT** [RT-médio, PII]: escopar (self + alcançáveis por clínica/link
  compartilhados), não deixar leitura global de nomes/e-mails de todos os tenants.

### PLANO 2 — Anti-recursão + anti-self-promotion (resumo das correções [RT])
- Helpers SECURITY DEFINER bypassam RLS → sem recursão (desde que **sem FORCE**).
- **[RT-crítico] `profiles` PRECISA de policy de SELECT** senão o app não faz bootstrap (todo mundo lê 0 linhas):
  `create policy profiles_select_self on public.profiles for select to authenticated using (auth_user_id=(select auth.uid()));`
  (referencia só coluna própria → sem recursão) + visibilidade escopada de outros via helpers.
- **[RT-crítico] Tabelas sem `patient_id`** (meals/workouts/workout_exercises/workout_set_logs/chat_*): usar os
  resolvedores de join, NUNCA `can_access_patient(patient_id)` (não compila). Enumerar **todas as 39 tabelas** com
  predicado explícito.
- Anti-self-promotion: helpers só LEEM identidade do JWT; nunca recebem role do client; nunca escrevem. + as regras de
  escrita acima (links/clinics/profiles/professionals).
- **[RT-baixo] `achievements`**: precisa de policy de leitura própria `achievements_public_read` (senão vira deny-all e
  some o catálogo). Nome distinto (não `sprint_*`) p/ escapar do drop-all e ser a única exceção whitelisted.
- **[RT-baixo] Exposição da Data API**: dono deve confirmar em Settings > API que os schemas expostos = `public`
  (+`graphql_public`) e que **`private` NÃO** está exposto.

### PLANO 3 — Identidades de teste (2 níveis)
- **Nível 1 (dentro do banco, pgTAP já instalado):** transação com ROLLBACK, simula login por GUC:
  `set local role authenticated; set local request.jwt.claims = '{"sub":"<AUTH_UID>","role":"authenticated"}';`
  fixtures com `auth_user_id` fixo (o `current_profile_id` casa por isso). Asserts-chave (ver A5) incluem os do [RT]:
  P1 vê X, não Y (mesma clínica sem link); P1 NÃO auto-INSERTa link p/ Y; authenticated NÃO faz UPDATE
  `profiles.role='admin'` nem `clinics.owner_profile_id`; externo é negado nas tabelas restritas.
- **Nível 2 (E2E real, site+app):** **HONESTIDADE:** o trigger `handle_new_user` só linka signup por **Google**;
  conta Admin-API (provider 'email') cai em `skipped_unverified_provider` → sem profile. Caminho VIÁVEL:
  (a) Admin API cria o auth user → (b) provisionamento server-side (service role) insere/linka profile + professional/
  patient + links do cenário. Remoção: Admin API deleteUser + limpeza server-side.
  **Login-Google automático depende de config do dono (OAuth client/redirect) que pode não estar pronta e não é
  verificável por aqui — NÃO afirmo "teste Google passou".** Alternativa = contas Admin-API acima.

### PLANO 4 — Kill switch / rollback fail-closed (com correções [RT])
- **[RT-crítico] Teardown dos sprint_* é PROGRAMÁTICO**, não à mão (há ~69 policies, nomes heterogêneos, várias por
  tabela; PERMISSIVE se combinam por OR → 1 sobrevivente reabre tudo p/ anon):
  ```sql
  do $$ declare r record; begin
    for r in select schemaname, tablename, policyname from pg_policies where policyname like 'sprint\_%'
    loop execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
  end $$;   -- inclui schemaname='storage'
  ```
- **[RT-crítico] Migration-guard final** (timestamp depois de tudo) que **FALHA o build** se sobrar policy PERMISSIVE
  concedendo `anon` com `qual/with_check = 'true'` (whitelist só `achievements_public_read`). Vale contra
  db reset / preview branch / revert que replay os sprints e reabrem anon.
- **[RT-alto] Neutralizar os corpos dos sprints históricos** (esvaziar/guardar os CREATE nas migrations antigas) OU
  garantir o guard acima — senão qualquer replay recria anon-open num ambiente de dados de saúde. (**Decisão do dono #5**.)
- **Emergência = derrubar as policies novas → deny-all** (RLS fica ON, zero policy). **[RT-alto]** derrubar por grupo
  precisa nomear TODAS as policies do grupo (o `for all`/write também governa SELECT); melhor usar o drop-all
  programático escopado à(s) tabela(s) afetada(s). **NUNCA** recriar `sprint_*` anon.
- **[RT-alto] Storage no kill switch:** bucket público não obedece a policy → 1º comando de emergência de foto é
  `update storage.buckets set public=false where id='progress-photos'`.
- Sintoma→ação: (leak) usuário vê linha de outro paciente/clínica → drop-all da tabela + (foto) flip privado;
  (lockout) usuário legítimo recebe 0 linhas → conserta a policy p/ frente (lockout é fail-closed aceitável).

### PLANO 5 — Fotos de progresso = MUDANÇA DE CONTRATO (com correções [RT])
Hoje: bucket `progress-photos` **público**; `photo_url` = URL pública inteira; app usa `getPublicUrl`.
Alvo: espelhar `patient-documents` **de verdade** (ver abaixo — ele NÃO estava correto).
- (a) formato: coluna `storage_path text` = caminho (`<patient_id>/<uuid>.jpg`); depreca `photo_url`.
- (b) upload no app: p/ `${patientId}/${uuid}.jpg`; salva o PATH.
- (c/d) leitura app e site: `createSignedUrl(path, ttl)`.
- (e) **[RT-médio]** TTL **curto (~60–120s)**, re-assinar a cada view, **não** cachear a URL assinada em cache longo
  (é bearer token; senão vaza até TTL após revogar o vínculo). Testar a janela de revogação.
- (f) **[RT-crítico] pasta pertence ao paciente TAMBÉM no WRITE** (o rascunho só falava do read): policy de INSERT/UPDATE
  em `storage.objects` com `with check (bucket_id='progress-photos' and private.can_access_patient(private.folder_patient(name)))`;
  read idem no SELECT. Sem isto, ator B faz upload em `<pasta_do_A>/x.jpg` e envenena o prontuário de A.
- (g) **[RT-médio]** limites de tipo/tamanho **server-side de verdade**: `update storage.buckets set
  allowed_mime_types=array['image/jpeg','image/png','image/webp'], file_size_limit=<bytes> where id='progress-photos'`
  (o `insert ... on conflict do nothing` original NÃO aplica em bucket existente). Validação no client é só UX.
- (h) registros antigos com URL pública: a Fase A esvaziou `progress_photos` → 0 linhas reais; transform genérico =
  extrair path do prefixo `.../object/public/progress-photos/`. **[RT]** remover os 2 objetos demo (passo do dono) p/
  não sobrar pasta não-uuid.
- (i) **[RT-crítico] flip do bucket p/ PRIVADO é o PRIMEIRO passo**, não o último (bucket público ignora RLS; RLS na
  tabela não protege o blob). Sequência cross-repo (migrations no web): 1) bucket→privado + coluna + storage policies
  (com WITH CHECK) + drop das storage policies sprint; 2) app e web usam path+signed URL. **[RT-médio]** não subir foto
  real enquanto público.
- (j) **[RT-crítico] `patient-documents` NÃO está "já correto"**: `sprint_patient_documents_storage_read` é
  `using(bucket_id='patient-documents')` (bucket-wide) + tabela `using(true)` → qualquer authenticated assina o exame de
  qualquer paciente. **Incluir patient-documents no mesmo tratamento** (foldername=patient + can_access_patient no
  storage; can_access_patient/linked-prof/self na tabela).
- (k) **[RT-médio] cross-repo lockout:** o novo storage exige sessão autenticada linkada; se o app paciente ainda roda
  anon/demo, o paciente fica trancado da própria foto. Só flipar após E2E de paciente logado (liga na Decisão #4/Google).
- (l) **[RT-baixo]** cast de pasta seguro (`private.folder_patient` retorna NULL em pasta não-uuid) p/ evitar 22P02.
- (m) testes de acesso negado: ator B não assina URL da pasta de A (read) e não faz upload na pasta de A (write).

### A5 — Fixtures Nível 1 (cenário mínimo, com correções [RT])
2 clínicas, 3–4 profissionais, 3 pacientes + 1 vínculo externo:
- Clínica A (admin PA), Clínica B (admin PB); Prof P1(A,comum), P2(A,comum), P3(B); **Externo E (link is_external=true → X)**.
- Paciente X(A, link P1 + externo E), Y(A, SEM link), Z(B, link P3).
- Asserts: P1 vê X, não Y/Z. **P2 (mesma clínica A) NÃO vê X nem Y.** PA vê X e Y, não Z. P3 vê Z. paciente X vê só X.
  **E (externo) vê a linha-núcleo de X mas é NEGADO em patient_documents/body_assessments/chat/agenda.**
  **P1 NÃO consegue INSERTar link p/ Y; authenticated NÃO faz UPDATE role='admin' nem clinics.owner_profile_id;
  profissional não-linkado tem INSERT rejeitado.**
- Recriar: script SQL idempotente com ids fixos. Limpar: rodar dentro de transação com ROLLBACK (Nível 1).

---

## PARTE 3 — DECISÕES QUE PRECISO DE VOCÊ (antes da Fase B) + BLOQUEIOS

1. **Modelo de admin:** amarrar em `owner_profile_id` (1 dono só) ou permitir **co-admins** via tabela
   `clinic_admins` (recomendado)? — impacta o helper `is_clinic_admin`.
2. **"Subconjunto restrito" do profissional externo:** quais tabelas exatamente ele PODE ver? (proponho: núcleo do
   paciente + planos da própria disciplina; **nunca** exames/avaliações/chat/agenda).
3. **Profissional comum × agenda (`appointments`):** vê a agenda inteira da clínica ou só dos pacientes com quem tem
   vínculo? (proponho: só linkados + os próprios).
4. **Google OAuth (bloqueio):** a config de login Google (client/redirect) está pronta? Sem ela, o E2E de login real e o
   flip final das fotos ficam bloqueados; alternativa = contas técnicas via Admin API + provisionamento server-side.
5. **Neutralizar os sprints históricos:** posso esvaziar/guardar os CREATE `sprint_*` nas migrations antigas (para
   db reset/preview não reabrirem anon) além do guard final? Isso mexe no histórico de migrations.
6. **Passo do dono — Storage:** remover os 2 objetos demo (`demo/mariana/*.png`) via Storage API (service key).
7. **Passo do dono — Data API:** confirmar schemas expostos = `public`(+`graphql_public`) e `private` fora da lista.

**Bloqueios que me impediram de "terminar" algo na Fase A:** nenhum para a limpeza (feita e verificada). Para a Fase B,
os itens 1–4 acima são pré-requisitos de decisão; o login-Google (item 4) é um bloqueio real do E2E Nível 2 que é passo
do dono.

---

## PARTE 4 — Resumo da revisão adversarial (rigor aplicado)
6 revisores independentes atacaram o desenho (BOLA/mesma-clínica, recursão/lockout, self-promotion, rollback fail-open,
storage/fotos, completude). Furos **críticos** corrigidos no desenho acima: tabelas join-only mantendo `sprint_read_all`;
ausência de SELECT em `profiles` (lockout total); auto-concessão via INSERT em `professional_patient_links`; virar admin
via `clinics`; write-path inexistente quebrando o app paciente; `patient-documents` NÃO escopado; teardown incompleto de
sprints; FORCE RLS causando recursão. Nenhum ficou sem tratamento no plano.
