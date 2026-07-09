# CONTRATO DE INTEGRAÇÃO — VERTEXA (web ↔ app ↔ Supabase)

> **Fonte única de verdade cross-repo.** Vive no repo web (`vertexa-web-pro/docs/CONTRATO_INTEGRACAO.md`).
> O app paciente referencia este arquivo por `../vertexa-web-pro/docs/CONTRATO_INTEGRACAO.md`.
> Verificado contra o código real (repomix dos dois repos) em 18/06/2026.

## Como usar (disciplina anti-drift)
1. **Toda sessão de Claude Code (web OU app) começa lendo este arquivo** + o `CLAUDE.md` do próprio repo.
2. **Na dúvida sobre o OUTRO lado, consulte o banco via MCP — nunca assuma.** É UM único Supabase;
   o banco é a verdade compartilhada. (O ruído do "#15" nasceu de assumir o comportamento do app
   sem olhar o banco.)
3. **Atualize o "Log de status" no fim deste arquivo** ao concluir cada etapa.
4. A memória de projeto do Claude Code **não cruza** entre os dois repos — fatos cross-repo moram AQUI.

## Topologia
- **Dois repos, UM Supabase.** Layout: `vertexa/vertexa-web-pro` + `vertexa/vertexa-app-paciente`.
- Projeto Supabase: `cdhjfyyuhmwrcuxqavib` ("Vertexa").
- Os dois clients leem `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (somente **anon** key no client).
- **web** = painel do profissional (light). **app** = PWA do paciente (dark). Mesmo brand laranja.

## Pins de demo (sem auth real nesta fase)
| Var | Repo | Valor | Quem é |
|---|---|---|---|
| `VITE_DEMO_PATIENT_PROFILE_ID` | app | `00000000-0000-0000-0000-0000000000b1` | Mariana (paciente) |
| `VITE_DEMO_PROFESSIONAL_PROFILE_ID` | web | `00000000-0000-0000-0000-0000000000a2` | Dra. Camila (nutri) |

A demo da menção é "@nutri" → a web logada como Camila (`a2`) recebe o badge "mencionado".

### IDs canônicos do seed
| Entidade | profile_id | id próprio | papel |
|---|---|---|---|
| Mariana Albuquerque | `…b1` | patient `10000000-…-b1` | patient |
| Dra. Juliana Santiago | `…a1` (role=admin) | professional `…e1` | médica (doctor) |
| Dra. Camila Rocha | `…a2` | professional `…e2` | nutri (nutritionist) |
| Clínica Vértice | — | clinic `…c1` | — |

Mariana está vinculada a `e1` (Juliana) **e** `e2` (Camila) → o canal dela tem 2 profissionais.
> ⚠️ `chat_channels.patient_id` = `patients.id` (`10…b1`), **não** o `profile_id`. Resolver sempre
> `profile → patients (por profile_id) → chat_channels (por patient_id)`.

## Contrato de identidade (auth real — WP-03 / AUTH-01)
> **A web tem DOIS modos** (flag `VITE_AUTH_MODE`, default `demo`). O contrato de DADOS abaixo
> é o mesmo nos dois; muda só de ONDE vem "o profissional logado".

- **demo** (`VITE_AUTH_MODE=demo`): identidade = pin de env `VITE_DEMO_PROFESSIONAL_PROFILE_ID`
  (Dra. Camila `…a2`). Comportamento de hoje, inalterado.
- **real** (`VITE_AUTH_MODE=real`): login Google (Supabase Auth). Cadeia canônica:
  `auth.uid() → profiles.auth_user_id → profiles.id → professionals.profile_id → professionals.clinic_id`.
  Resolvido por `useIdentity` (web) reusando `getCurrentProfessional`. **Não** há id novo — é
  `profiles.auth_user_id` (coluna que já existia, agora populada).

**Associação auth↔profile (1º login) — trigger `handle_new_user` (SECURITY DEFINER), migrations
`20260708120000` (WP-03) + `20260709120000` (WP-04/AUTH-02):** no signup de `auth.users`, **só a partir
de um provedor CONFIÁVEL (Google) e com e-mail confirmado** (mesma cadeia `uid → profiles.auth_user_id →
profiles.id → …` para profissional E paciente): se houver **exatamente 1** `profiles` órfão
(`auth_user_id IS NULL`) com aquele e-mail (case/trim-insensitive) → **vincula preservando o ROLE
existente** (match **role-agnóstico**: paciente semeado linka como `patient`, profissional como
`professional`, admin como `admin`); **senão (NO-MATCH) → FAIL-CLOSED: sempre cria `profiles`
`role='patient', status='pending'`** (neutro, sem privilégio). A associação é server-side porque
`profiles` **não tem policy de UPDATE** (RLS sprint).

**Anti account-takeover (WP-03):** a guarda NÃO pode ser só `email_confirmed_at` — se "Confirm email"
estiver OFF, o GoTrue auto-confirma signups por e-mail/senha (anon key pública) e um atacante casaria o
e-mail de um profissional/admin semeado. Por isso exige **provedor Google** (`raw_app_meta_data.provider`,
setado pelo OAuth, não pelo client). **Superfície de signup (WP-04):** `raw_user_meta_data.signup_surface`
é **user_metadata (CONTROLÁVEL PELO CLIENT)** → **nunca** seleciona/concede role; serve só de **diagnóstico**.
Por isso o NO-MATCH é fail-closed em `patient` (menor privilégio): um app paciente ou atacante **não** vira
`professional` por forjar/omitir a superfície. Promoção a `professional` exige mecanismo CONFIÁVEL
posterior (convite/admin/provisioning server-side). Diagnóstico técnico do trigger em
`public.auth_trigger_events` (**SEM PII**: `auth_user_id`/`surface`/`outcome`/`sqlstate`; deny-all p/
anon/authenticated) — paga a DÍVIDA-AUTH-2 (log por SQLSTATE, nunca SQLERRM).

**Estado `pending`:** sessão real válida mas sem professional/clinic (nem `patients`) → a web mostra
`PendingAccessPage` (não vê dados de ninguém). Onboarding/vínculo do paciente = **Parte B (app)** / WP futuro.

**⚠️ Cross-repo:** o trigger vive no Supabase COMPARTILHADO. Hoje só a web faz signup real (o app
paciente é demo/sem `auth.users`). Quando o app paciente adotar auth real, **revisar** o `role` do
`pending` (um paciente novo NÃO deve virar `professional`) — usar `raw_user_meta_data`. **RLS real por
papel/clínica segue pendente (WP-05 / #11-#14)** — o modo real NÃO expõe mais que o demo já expõe.

## Contrato de dados (quem escreve / quem lê)
| Tabela | App paciente | Web profissional | Realtime |
|---|---|---|---|
| `chat_channels` / `chat_participants` | lê | lê | — |
| `chat_messages` | **escreve** (sender_role=`patient`) + lê | **escreve** (sender_role=`professional`) + lê | sim |
| `chat_mentions` | **escreve** (só o paciente menciona) + lê | lê + `read_at` (markRead) | sim |
| `activity_events` | **escreve** (sink do eventTracker) | **lê** (Timeline + água do dia) | — |
| `weight_logs` | **escreve** (valor do peso; pendente no app) | **lê** (gráfico de peso) | — |
| `progress_photos` | **escreve** (URL pós-upload; pendente no app) | **lê** (Fotos comparativas) | — |
| Storage `progress-photos` | **upload** do binário (pendente no app) | **lê** via URL pública | — |
| `muscle_recovery_states` | **escreve** (provisório, 4c-2) + **lê** (body map dinâmico, S11) | **lê** (BodyMap/Recuperação) | — |
| `adherence_snapshots` | **escreve** (VRI, 4c-2b) | **lê** (VRI) | — |
| `achievements` (catálogo global) / `patient_achievements` (unlocks) — conquistas, S5 | **escreve** `patient_achievements` (pelo MOTOR) + **lê** ambas | lê (futuro) | — |
| `notifications` (S6) | **lê** + **escreve** `read_at` (marcar lida) | escreve (futuro emissor) | — |
| `patient_documents` (exames/documentos PDF/imagem, S-DOCS) | lê + **escreve** (`uploaded_by_role='patient'`, FUTURO — sessão do app) | **escreve** (`uploaded_by_role='professional'`) + **lê** | — |
| Storage `patient-documents` (bucket **PRIVADO**, S-DOCS) | upload + download via signed URL (FUTURO) | **upload** + **lê via signed URL** (createSignedUrl, TTL 10 min) | — |
| `workout_plans` / `workouts` / `workout_exercises` / `nutrition_plans` / `meals` | lê (4c-3, futuro) | **escreve** (editores) | — |
| `appointments` (agenda interna, Sessão 6) | — (não usa) | **escreve + lê** (CRUD da Agenda) | — |
| `calendar_*` (Google Calendar, Sessão 10) | — (não usa) | **lê** connections/cache; tokens/state **deny-all** (só Edge Function/service_role) | — |
| `schema_migration_log` (ledger técnico interno, Sessão 7) | — (não usa) | — (não usa; sem API client/portal) | — |
| `messages` (legada) | — | — (repontado) | — |

Colunas-chave (verbatim do schema; **não renomear sem alinhar aqui**):
- `chat_messages(id, channel_id, sender_profile_id, sender_role, body, created_at)` — **sem** `sender_professional_id`.
- `chat_mentions(id, message_id, mentioned_profile_id, read_at)` — `read_at IS NULL` = não lida (badge).
- `activity_events(id, patient_id, type, payload jsonb, created_at)` — `patient_id` = `patients.id`.
- `weight_logs(id, patient_id, weight_kg numeric, measured_at timestamptz, source text, created_at)` — `patient_id` = `patients.id`. **NÃO renomear `weight_kg`/`measured_at`.**
- `progress_photos(id, patient_id, photo_url text, captured_in_app bool, taken_at timestamptz)`.
- `appointments(id, clinic_id NOT NULL→clinics, patient_id?→patients, professional_id?→professionals, title, starts_at timestamptz, ends_at, notes, created_at)` — **agenda interna, web-only** (o app paciente NÃO consome). `notes` = texto livre → tratar como sensível sob RLS real.
- `calendar_connections(id, clinic_id NOT NULL→clinics, professional_id?→professionals, provider, google_account_email, google_calendar_id, calendar_name, scopes, status, last_synced_at, created_at, updated_at)` + `calendar_event_cache(id, connection_id→calendar_connections, clinic_id, google_event_id, title, starts_at, ends_at, all_day, status, synced_at)` — **web/Edge-only** (Sessão 10; o app NÃO consome). `calendar_connection_tokens(connection_id PK, access_token, refresh_token, token_expires_at)` e `calendar_oauth_state(...)` são **deny-all** (sem leitura `anon`/`authenticated`; só Edge Function/service_role). Título de evento Google pode conter nome de paciente → sensível.
- `patient_documents(id, patient_id→patients ON DELETE CASCADE, uploaded_by_role text CHECK in ('professional','patient'), uploaded_by_professional_id?→professionals ON DELETE SET NULL [auditoria; null quando o paciente envia], kind text default 'exam' [exam|report|other, flexível], title, file_path text [CAMINHO no bucket, NÃO URL pública], mime_type, file_size_bytes bigint, uploaded_at, created_at)` — **exames/documentos** (PDF/imagem). Bucket **PRIVADO** `patient-documents` (`public=false`) + **signed URL** (TTL 10 min) na leitura — `file_path` NÃO é URL pública. Modelo **BIDIRECIONAL**: a **web ESCREVE** (`'professional'`) nesta fase; o app paciente **lerá/ESCREVERÁ** (`'patient'`, professional_id NULL) no futuro (sessão do app) — hoje o app NÃO consome. Fecha a #12 para EXAME (privado + signed); a foto de progresso segue pública (dívida à parte).

## Spine de dados: PESO / FOTO / ÁGUA (Sessão 1 — fonte inequívoca p/ a Sessão 2)
> Contexto: hoje o app só dispara `activity_events` SEM valor confiável
> (`weight_logged` vem `{source:'records'}` ou `{weight:..}`; `progress_photo_uploaded` vem `{}`;
> hidratação vem `{amount}` em `Habits.tsx`). Isto define ONDE o app grava o **valor** e COMO a web lê.

### 1) PESO — tabela canônica `weight_logs`
- **App grava** (Sessão 2, pendente): `insert into weight_logs (patient_id, weight_kg, measured_at, source)`
  com `source='app'`, `weight_kg` = valor numérico, `measured_at` = momento do registro.
  Em `Records.tsx`, o `weightVal` (hoje só `{source:'records'}`) deve virar este insert.
- **Web lê**: `api/weight.ts → getWeightSeries(patientId)` faz **merge** de `body_assessments.weight`
  (avaliações clínicas) **+** `weight_logs.weight_kg` (auto-reporte do app), ordenado por data →
  `WeightChart` (aba Antropometria). "Peso atual" = última medição de qualquer origem.
- `activity_events(type='weight_logged')` **permanece** só como MARCADOR de Timeline (sem valor).
- **Visual (web):** no gráfico, ponto **laranja** (primary) = registro do app; **azul** (info) = avaliação clínica (com legenda). Padronizar essa leitura se o app vier a desenhar peso.

### 2) FOTO — tabela `progress_photos` + bucket `progress-photos`
- **App grava** (Sessão 2, pendente): faz **upload do binário** para o bucket **`progress-photos`**
  (Storage) e insere `progress_photos (patient_id, photo_url, captured_in_app=true, taken_at)` com
  `photo_url` = URL pública do objeto. Bucket é **público** na sprint (download via URL pública,
  sem signed URL). **Dívida S9/P1 (PENDENCIAS #12/#11–#14; BLOQUEANTE p/ paciente real — foto corporal = dado de saúde/LGPD):**
  bucket privado + signed URL + policy de INSERT escopada por paciente/pasta + limite de mime/tamanho.
  Hoje só seed fictício deve subir ao bucket.
- **Web lê**: `api/assessments.ts → getProgressPhotos(patientId)` → grade de `<img src=photo_url>`.
- Seed de demo usa um **data URI** (placeholder) só para a web exibir algo até o app subir binários.

### 3) ÁGUA — derivada de `activity_events` (SEM tabela)
- **Regra**: "água de hoje" = **soma de `activity_events(type='hydration_logged')` do dia**, campo
  **`payload.liters`** (número, em litros). **Chave canônica = `liters`.**
- **Web lê**: `api/hydration.ts → getHydrationTodayLiters(patientId)` (filtra `created_at >= início do dia`).
- ⚠️ **Drift a corrigir no app (Sessão 2):** `Habits.tsx` grava `{amount}` e `Records.tsx` grava
  `{source:'records'}`. A web tolera `amount` como alias por ora, mas o app deve padronizar `liters`.

## Vocabulários (a maior fonte de ruído — ler antes de tocar em músculos)
Existem **dois** vocabulários de músculo no sistema. Não confundir:

1. **Canônico (o que a web PINTA)** — `muscle_recovery_states.muscle_group`, `BodyMap.tsx`,
   `muscleGroupLabel()`. **Chaves em inglês minúsculo:**
   `chest, biceps, triceps, lats, shoulders, abs, forearms, quadriceps, hamstrings, glutes, calves, traps, lower_back`.

2. **Treino (português capitalizado)** — `workouts.primary_muscle_group`,
   `workout_exercises.muscle_groups` e o `workoutData.ts` do app:
   `Peito/Peitoral, Bíceps, Tríceps, Dorsais, Costas, Pernas, Ombros, Posteriores, Glúteo, Panturrilha, Trapézio, Lombar, Romboides, Abdômen…`

**Regra:** ao gravar `muscle_recovery_states`, o app DEVE traduzir do vocabulário de treino (2) para a
chave canônica (1). Senão o `BodyMap` não pinta. Mapa de tradução:

| Treino (PT) | Chave canônica |
|---|---|
| Peito / Peitoral | `chest` |
| Bíceps | `biceps` |
| Tríceps | `triceps` |
| Dorsais / Costas | `lats` |
| Ombro(s) | `shoulders` |
| Abdômen | `abs` |
| Antebraço(s) | `forearms` |
| Quadríceps | `quadriceps` |
| Posterior(es) | `hamstrings` |
| Glúteo(s) | `glutes` |
| Panturrilha(s) | `calves` |
| Trapézio | `traps` |
| Lombar | `lower_back` |
| **Romboides** | → `lats` (aproximação; não há chave própria) |
| **Pernas** (guarda-chuva) | → expandir p/ `quadriceps`+`hamstrings`+`glutes`+`calves`, ou ignorar |

### Status de recuperação muscular (esquema dos combinados — pendência #1)
`muscle_status` = `fatigued | recovering | recovered | weakened | neutral`. Cor na web:
- `fatigued` → vermelho · `recovering` → amarelo · `recovered` → azul · `weakened` → verde · `neutral` → cinza.
- **Recém-treinado = `fatigued`** (vermelho). **NÃO** usar o esquema antigo `neutral/activated`.
- Persistência é **PROVISÓRIA** até a Juliana confirmar (pendência #1). O status não decai sozinho
  (não há job de recálculo); ok pra demo de mesma sessão.

## Segurança / RLS (sprint vs produção)
- Modo sprint: RLS ligada com policies **permissivas** (`using(true)`) só com seed fictício.
  - Leitura (`sprint_read_all`, SELECT anon) em 17 tabelas → `migrations/20260617120000_sprint_anon_read_policies.sql`.
  - Chat (`sprint_chat_write`, ALL anon) nas 4 `chat_*` → `migrations/20260618120000_chat.sql`.
  - `activity_events` (`sprint_activity_write`, INSERT anon) → `migrations/20260618130000_sprint_write_policies.sql` ✅.
  - `muscle_recovery_states` (`sprint_muscle_write_insert` + `sprint_muscle_write_update`, anon) → `migrations/20260618130000_sprint_write_policies.sql` ✅.
  - Planos (`sprint_plan_write`, ALL anon) nas 5 tabelas → `migrations/20260618130000_sprint_write_policies.sql` ✅ (gap fechado).
  - `adherence_snapshots` (`sprint_adherence_write`, INSERT anon) → `migrations/20260618140000_sprint_adherence_write_policy.sql` ✅.
  - `weight_logs` (`sprint_weight_read` SELECT + `sprint_weight_write` INSERT, anon/auth) → `migrations/20260625120000_weight_logs_and_progress_photos_storage.sql` ✅.
  - Storage `progress-photos`: bucket público + `sprint_progress_photos_write` (INSERT anon/auth) →
    mesma migration `20260625120000`. **Sem** policy de SELECT (público serve download por URL; evita listagem).
  - `progress_photos` (TABELA): `sprint_progress_photos_insert` (INSERT anon/auth) → `migrations/20260625170000_progress_photos_table_insert_policy.sql` ✅ (a tabela só tinha SELECT; o INSERT anon era NEGADO — gap simétrico ao bucket, fechado na Sessão 2 do app).
  - **Cadastro de paciente pela web (Sessão 4)** → `migrations/20260625180000_sprint_patient_create_write_policies.sql` ✅: INSERT em `patients` / `professional_patient_links` / `body_assessments` (`with check (true)`) + `profiles` (`with check (role = 'patient')` — restrito ao papel já na sprint, p/ não forjar admin/professional). Isolamento por clínica é client-side na sprint (vem do env da Dra. Camila); validar no servidor antes de dado real (#11–#14).
  - **Agenda interna (Sessão 6)** → `migrations/20260626090000_appointments_internal_agenda.sql` ✅: `sprint_appointment_read` (SELECT) + `sprint_appointment_write` (ALL), anon/auth `using/with check (true)`. Isolamento por `clinic_id` é client-side; `notes` é dado sensível. Fechar por papel/clínica no servidor antes de dado real (PENDENCIAS #14/#19).
  - **Ledger técnico interno (Sessão 7)** → `migrations/20260626120000_schema_migration_log.sql` ✅ cria `schema_migration_log` como companion legível da `supabase_migrations.schema_migrations` do CLI; `migrations/20260626123000_schema_migration_log_internal_only.sql` ✅ remove a leitura pública (`miglog_read`) e revoga privilégios de `anon`/`authenticated`. Sem API client, hook, rota, card ou seção no portal; inspeção somente por MCP, SQL administrativo ou migrations. NÃO substitui a tabela do CLI.
  - **Documentos/exames (S-DOCS)** → `migrations/20260702230000_patient_documents.sql` ✅: `sprint_patient_document_read` (SELECT) + `sprint_patient_document_insert` (INSERT), `anon`/`authenticated` `using/with check (true)` — **SEM** UPDATE/DELETE (documento imutável na sprint). Storage bucket **PRIVADO** `patient-documents` (`public=false`) + `sprint_patient_documents_storage_read` (SELECT — é o que AUTORIZA o anon a ASSINAR a URL) + `sprint_patient_documents_storage_write` (INSERT), escopadas por `bucket_id`. Dado de SAÚDE mais sensível (exame) atrás de RLS permissiva → **AMBAS (tabela + storage) no checklist #14**; intenção da RLS real (S9: SELECT só profissionais vinculados + o paciente; INSERT do profissional via `auth.uid()→professionals`, do paciente só o próprio) no header da migration. Fecha a **#12** para EXAME (bucket privado + signed URL, TTL 10 min).
  - **Execução de treino (#S-EXEC)** → `migrations/20260702240000_workout_execution_logs.sql` ✅:
    `sprint_workout_session_read`/`sprint_workout_set_read` (SELECT) + `sprint_workout_session_write`/
    `sprint_workout_set_write` (INSERT), anon/auth `using/with check (true)` — **append-only** (SEM UPDATE/DELETE,
    espelha `activity_sessions`). Intenção da RLS real (S9: SELECT do paciente dono + profissionais vinculados;
    INSERT só o dono/profissional vinculado) no header. **AMBAS as tabelas no checklist #14.**
- **Migrations = fonte única no repo web** (`vertexa-web-pro/supabase/migrations`). Toda policy aplicada
  via MCP DEVE virar arquivo de migration aqui — **todas** as policies de escrita sprint já versionadas.
- **#11–#14 (BLOQUEANTE p/ dado real):** trocar tudo isso por RLS por papel/clínica/vínculo. Tabelas a
  travar: `chat_*`, `activity_events`, `muscle_recovery_states`, `adherence_snapshots`, planos, etc.
  O realtime (`postgres_changes`) respeita as policies → fechar a RLS também fecha o que vaza ao vivo.

## WP-05B · RLS REAL por família — DECISÕES + CONTRATO DE HELPERS

**Decisões do dono (lei):**
- **AUTH-ADMIN-1** — admin = **DONO** (`clinics.owner_profile_id`) **OU co-admin por MEMBERSHIP**
  (`professionals.clinic_role='admin'`, coluna aditiva do WP-05B). **NUNCA** derivar admin de `profiles.role`
  (mutável = auto-promoção). `clinic_role` é setável **só por admin** (RLS de `professionals`).
- **AUTH-EXT-1** — profissional externo (`professional_patient_links.is_external=true`) vê o **MÍNIMO** do caso
  (o paciente vinculado), nunca o acesso de um interno. No nível de identidade (Família 1) vê a linha-núcleo do
  paciente + o próprio vínculo; a exclusão fina (documentos/avaliações/chat/agenda) é aplicada nas famílias de dados.
- **AUTH-AGENDA-1** — profissional comum enxerga só paciente **VINCULADO** (nunca "mesma clínica").

**Contrato de helpers (schema `private`, SECURITY DEFINER, `search_path=''`, EXECUTE só `authenticated`, NÃO exposto
na Data API):** `current_profile_id()`, `current_patient_id()`, `owns_professional(uuid)`, `is_clinic_admin(uuid)`,
`is_clinic_member(uuid)`, `is_self_patient(uuid)`, `patient_clinic(uuid)`,
`is_common_professional_of_patient(uuid)`, `is_external_professional_of_patient(uuid)`, `can_access_patient(uuid)`,
`can_see_profile(uuid)`. Por serem DEFINER, bypassam RLS ao ler as tabelas → **quebram a recursão**; por isso
**NÃO usar `FORCE ROW LEVEL SECURITY`** nas tabelas que eles consultam. Nenhum corpo de policy referencia tabela
com RLS diretamente — sempre via helper. Owner-check em `Settings > API`: schemas expostos = `public`(+`graphql_public`),
`private` **fora** da lista.

**EXECUTION_STATE (RLS-FAM1) = ✅ CONCLUÍDA (aguardando auditoria do dono).** Migrations
`20260711093000_wp05b_fam1_coadmin` (aditiva) + `20260711094000_wp05b_fam1_auth_helpers` +
`20260711095000_wp05b_fam1_identity_rls`, **versionadas e APLICADAS** via `apply_migration`. Substituiu as `sprint_*`
das 5 tabelas de identidade (`profiles`, `professionals`, `patients`, `professional_patient_links`, `clinics`) por
RLS real por papel/clínica/vínculo, com **SELECT+INSERT+UPDATE+DELETE** definidos e **imutabilidade de colunas
sensíveis** via column privileges (`profiles.role/auth_user_id/status/email`; `clinics.owner_profile_id`;
`patients.profile_id/clinic_id`; chaves do vínculo). `anon` sem acesso a nenhuma das 5; `service_role` mantém bypass
(Edge). Testes Nível 1 (pgTAP-style, login simulado via `request.jwt.claims`, ROLLBACK) em
`supabase/tests/wp05b_fam1_identity_test.sql` — **77 asserções verdes** (inclui mesma-clínica-não-basta, co-admin por
membership, externo-mínimo, pending fail-closed, anon negado, e os 5 vetores de auto-promoção). Advisors: as 5 tabelas
saíram das listas `rls_policy_always_true`; nenhum issue novo. **KILL SWITCH (fail-closed)** documentado no header de
`20260711095000_wp05b_fam1_identity_rls.sql` (drop programático das policies da família → deny-all; NUNCA recriar
`sprint_*`). **Famílias restantes (Agenda, Dados clínicos, Chat, Storage/Fotos) seguem em `sprint_*` — NÃO tocadas.**

**Consequência no app web (dívida, fora do escopo desta família):** `createPatient` (`src/lib/api/patients.ts`)
insere `profiles` direto → agora **negado** (profile nasce via trigger `handle_new_user`). Fluxo precisa migrar para
provisionamento server-side (Edge Function `service_role`) ou convite. Gates (typecheck/lint/build) seguem verdes
(é comportamento de runtime). Ver PENDENCIAS.

## Pendências cross-repo
- **#1** esquema de recuperação muscular (provisório `recovered/weakened`; confirmar c/ Juliana).
- **#3** pesos do VRI (provisórios; web só lê snapshots). Baseline convergente da Mariana =
  **~96 / alta** (engine-computado a partir do seed rolante — ver #3b); o **88 autoral foi SUPERADO**
  (era incompatível com um perfil engajado sob a engine calibrada). Ainda "alta" — não contradizer o nível.
  **Calibração C7 (Sessão 15 — app): ✅** o motor NÃO crava mais 100 no primeiro toque. `computeScore`
  foi recomposto (recência = termo positivo LIMITADO sem reset + engajamento num orçamento + soft-cap
  por retornos decrescentes na banda [70,100]). Só APP (`adherenceEngine.ts`); shape do snapshot e clamp
  inalterados; monotonicidade + piso preservados por teste.
  **#3b (Sessão 16 — seed convergente): ✅ RESOLVIDO (via MCP, 02/07).** A Mariana passou a ter uma janela
  ROLANTE de ~18 dias de eventos REAIS (função versionada `refresh_demo_mariana_streak()`), de modo que a
  ENGINE CALCULA `streak=18 / weekly=80% / score ~96/alta` — **CONVERGENTE** com o recompute vivo (o
  snapshot que o web lê é ESCRITO PELA ENGINE, não cravado). Uma ação isolada NÃO derruba mais o streak
  (segue 18 → 19 no dia seguinte). Drift: datas fixas envelhecem (~2 dias) → o seed é REFRESHÁVEL (ritual
  pré-demo na Sessão 16).
- **#S-EXEC (app): captura de EXECUÇÃO de treino. ✅ RESOLVIDO (S-EXEC, 03/07).** O app agora CAPTURA o que
  foi FEITO (séries/reps/carga/RPE/duração), não só o marcador. 2 tabelas CANÔNICAS **`workout_session_logs`**
  (sessão: `workout_id`→workouts **SET NULL** [o link que faltava] + snapshot `workout_name`, `performed_on`
  LOCAL, `started_at`/`completed_at`/`total_duration_min` nullable, `source`) + **`workout_set_logs`** (série:
  `workout_exercise_id`→workout_exercises **SET NULL** + snapshot `exercise_name`, `set_index`, `weight_kg`,
  `reps_done`, `rpe` nullable 6-10, `rest_seconds` nullable). Volume (peso×reps) e 1RM = **DERIVADOS em leitura**
  (`src/lib/workoutExecution.ts`, puro/testado), NUNCA coluna. UI no WorkoutGuide: inputs por série pré-preenchidos
  com o prescrito (0-safe: peso corporal=0 é válido) + **finalizar antecipado** (=> "3 de 4" derivável por
  `count(set_logs)` vs `workout_exercises.sets`) + RPE opcional; grava sessão+séries via `src/lib/api/workoutLogs.ts`
  ANTES de navegar (não navega/não emite se falhar). **VRI INTOCADO:** o marcador `workout_checked` (started+completed)
  segue igual; o `adherenceEngine` lê só `activity_events.type/created_at` (dias distintos) — as tabelas de execução
  NÃO são input. Progresso RELIGADO (card "Desempenho do treino", escopado pelo seletor 7/14/28): volume, nº
  exercícios/séries/reps/carga, tempo, **Regiões mais trabalhadas** (via `workout_exercises.muscle_groups` → PT→EN
  pelo muscleMap). CONTINUAM vazios por falta de fonte honesta: **"Tipos de exercício %"** (não há coluna de
  categoria em `workout_exercises` nem catálogo global) e **CALORIAS de treino** (não há captura de HR/kcal). ⚠️
  contagem de treino segue por DIAS distintos (#13, dedup started+completed). Migrations `20260702240000` (tabelas)
  + `20260702250000` (seed Mariana). RLS sprint das 2 tabelas no **#14**.
- **#S-EXEC-2 (dívida ADITIVA registrada): exercício por TEMPO não é modelado.** Prancha/isometria (segundos) —
  `reps_done` não vira segundos. Solução futura ADITIVA (não implementada): `workout_set_logs.duration_seconds`
  nullable. Não bloqueia o plano atual da Mariana (tudo por reps).
- **#S-EXEC-3 (dívida registrada): escrita não-atômica sessão↔séries.** `logWorkoutSession` + `logWorkoutSetLogs`
  são 2 chamadas; falha entre elas + retry pode deixar uma sessão ÓRFÃ (com duração, 0 séries). Mitigado na LEITURA
  (o Progresso só conta tempo de sessões que TÊM séries → sem inflar o "Tempo"; a RLS sprint é append-only, sem DELETE
  anon). Fix real futuro: RPC transacional (sessão+séries num insert) ou policy de DELETE escopada.
- **#S5-JORNADA (S6 — app, Jornada viva): âncora temporal da jornada.** As conquistas de **constância** da
  S5 usam o **streak do motor como proxy** (D1 aprovada) — NÃO há marco de calendário. Mas a narrativa de
  "30 dias de jornada" fica incoerente com o `patients.start_date` da Mariana = **2026-06-30** (2 dias antes
  da demo de 02/07). Decidir na S6 (Jornada viva) UMA das opções, sem mutar o seed de eventos agora:
  (a) tornar `start_date` coerente via **seed** (ex.: recuar ~30–40 dias, alinhado à janela rolante de
  `refresh_demo_mariana_streak()`); ou (b) derivar a jornada de **outra âncora** (1º `activity_event`,
  ou o próprio streak) em vez de `start_date`. Só ANOTADO aqui (D1) — não resolver na S5.
- **#15** aposentar a tabela `messages` legada + migrar seed (não-bloqueante; web e app já no `chat_*`).
- **#16 (Sessão 2 — app): ✅ RESOLVIDO.** `Records.tsx` insere o VALOR do peso em `weight_logs`
  (`source='app'`, via `api/weight.ts`); aba Foto com input real (câmera+galeria) sobe o binário ao
  bucket `progress-photos` + insere `progress_photos` (`photo_url`=URL pública, via `api/photos.ts`);
  HIDRATAÇÃO padronizada em `payload.liters` (INCREMENTOS; "água de hoje"=soma do dia, via
  `api/hydration.ts`) tanto em `Habits.tsx` quanto em `Records.tsx`. `weight_logged`/`progress_photo_uploaded`
  permanecem como MARCADORES de Timeline. Pendências da Home derivadas de dados reais; treino concluído
  pelo `Records` carrega `workoutId` real → `muscle_recovery_states` + VRI. Migration aditiva
  `20260625170000` (INSERT em `progress_photos`). Verificado por E2E (Playwright) + MCP.
- **GIFs de exercício (Sessão 3 — app): ✅ RESOLVIDO p/ 28 de 30 exercícios.** O app agora usa os
  **GIFs OFICIAIS da cliente** (bundle `src/assets/exercises/*` via `import.meta.glob`, resolvidos por
  nome de arquivo normalizado). Não há mais URL `fitnessprogramer.com` nos exercícios oficiais.
  **Pendência pontual:** ex-23 (Elevação pélvica) e ex-30 (Abdominal infra) seguem com a URL de
  terceiros (sem asset oficial entregue) — substituir quando a cliente enviar. Os GIFs de
  **aquecimento** (mobilidade) seguem de terceiros (provisional separado — ver Aquecimento).
- **Origem/licença dos assets oficiais:** GIFs de exercício, telas de onboarding (`01..05`) e
  silhuetas de corpo (`Body_front/Body_back`) são **material proprietário da cliente VERTEXA**
  (entregues pela cliente). Substituem os placeholders/terceiros. Uso interno do produto.

## Provisórios (combinados temporários — trocar quando indicado)
- **`adherence_snapshots`**: o app **escreve** o VRI (4c-2b, policy `sprint_adherence_write`); a web só
  **lê**. OK p/ demo. ✅
- **GIFs de exercício**: ✅ Sessão 3 — o app resolve por **fallback de nome** (`workout_exercises.name`
  → `workoutData.ts`) para os **GIFs OFICIAIS bundlados** (não mais terceiros). Ainda PROVISÓRIO no
  sentido de que a web pode preencher `gif_url` no banco no futuro (tem precedência sobre o fallback).
  Aproximações (≈) anotadas — usam um asset oficial próximo: ex-8 Crucifixo→"Crucifixo Polia",
  ex-11 Desenv. militar→"desenvolvimento com halter", ex-22 Mesa flexora→"Cadeira Flexora",
  ex-29 Elev. lateral inclinado→"Elevação Lateral Cabo". ex-24 "Abdução de quadril" foi **renomeado para
  "Cadeira adutora"** (asset disponível; muscleGroups→["Adutores"]).
- **Aquecimento**: **estático** (hardcoded no app) e os GIFs de mobilidade **seguem de terceiros**
  (não há asset oficial de aquecimento) **até existir tabela/assets próprios**. PROVISÓRIO.
- **Body map do app** (`Progress.tsx` → `DynamicBodyMap`): ✅ **IMPLEMENTADO na S11.** A "melhoria futura" foi
  feita — PNG oficial `Body_front/Body_back` como base + overlay SVG das regiões por face (zonas `<path>`
  alinhadas à anatomia, bilaterais espelhadas). Lê `muscle_recovery_states` e pinta por status DERIVADO de
  `last_trained_at`. ⚠️ O alinhamento PNG↔SVG é **autoral** (coordenadas estimadas sobre a arte) e pode pedir
  ajuste fino no dispositivo — limitação conhecida, não é pixel-perfect. Pendência #1 (decaimento do status
  server-side) segue: hoje a derivação por dias é client-side.

## Log de status (atualizar a cada etapa)
**Web (`vertexa-web-pro`):**
- Fases 0–6 (MVP) ✅
- Etapa 2 — chat schema + backfill + realtime ✅ (`d18e6b3`)
- Etapa 3 — chat repontado p/ `chat_*` + envio + realtime ✅ (`1979677`)
- Etapa 3b — menções + não-lidos (badge) ✅ (`0f3a94a`)
- Reconciliação — policies de escrita sprint versionadas em migration ✅ (`24f28f3`)
- Fix — realtime com tópico único por montagem (StrictMode-safe) ✅ (`f2259ab`)
- Sessão 1 — **fix de crash** (env ausente → tela de config + ErrorBoundary global, sem tela branca)
  + **spine de dados**: `weight_logs` (gráfico lê merge clínico+app), bucket `progress-photos`,
  regra de água (`activity_events.hydration_logged.payload.liters`). Migration `20260625120000`. ✅
- Sessão 4 — **Review do painel** (tudo gira em torno do paciente): navegação enxuta (Retenção/Planos
  fora da lateral; deep-link mantido), **Retenção dentro do Dashboard** (`RetentionPanel`), **cadastro
  real de paciente** (`createPatient`; migration `20260625180000`), ficha com 8 abas (inclui
  **Evolução/Fotos** e **Documentos** — `body_assessments.document_url` com allowlist de esquema; seed
  `20260625190000`), e **mensagem do profissional verificada** (já escrevia em `chat_messages`
  `sender_role='professional'` + realtime; confirmado E2E + MCP). Contrato de DADOS inalterado (sem
  rename de coluna). ✅
- Sessão 5 — **redesign visual/identidade** (só UI/UX): contrato de dados inalterado. ✅
- Sessão 6 — **Agenda interna** (Review §3): nova tabela **`appointments`** (web-only) + CRUD real no
  Dashboard (`AgendaCard`) escopado por clínica + seed fictício (3 compromissos da c1). Migrations
  aditivas `20260626090000` (tabela+RLS sprint) e `20260626093000` (seed, fuso `America/Sao_Paulo`).
  "Conectar Google Agenda" = placeholder (#19); Google Meet fora. Verificado E2E (criar→reload→excluir) + MCP. ✅
- Sessão 7 — **Ledger técnico interno** (`schema_migration_log`, migrations `20260626120000` + `20260626123000`,
  backfill de 11 migrations + correção de acesso) + **RBAC de UI** (papel admin/médico/nutri deriva de `profiles.role`+`professionals.type`;
  helper `roles.ts` + `RoleProvider`/`useRole`; seletor de papel "modo demonstração" no menu de conta;
  edição por papel — nutri↔Plano alimentar, médico↔Treino). O ledger não é exposto no portal web,
  não possui API client e não concede SELECT a `anon`/`authenticated`; inspeção só por MCP/SQL administrativo/migrations.
  **RBAC de UI ≠ RLS de dados** (a RLS por papel/clínica segue como dívida #11–#14 / S9). Verificado por Playwright
  (alternando papel) + MCP. Contrato de DADOS cross-repo inalterado. ✅
- Sessão 8 — **Release gate + QA integrada.** Gate do ledger `20260626123000` **APLICADA** no remoto via MCP
  (12 linhas; `miglog_read` removida; SELECT anon/auth revogado; RLS on). QA web↔app com **E2E reais** (com
  cleanup): hidratação app→`activity_events(hydration_logged.liters)`→web "Hidratação de hoje" (0,0→0,3 L);
  chat web→`chat_messages`(`sender_role='professional'`, Camila)→thread. Demais fluxos do spine: dado seed real
  lido (MCP+UI) + escrita conferida no código dos 2 repos. Contrato de DADOS inalterado. RLS real por papel/clínica
  + storage privado seguem para S9/P1. Ver `docs/QA_S8_RELEASE_GATE.md` + `docs/DEMO_2606.md`. ✅
- Sessão 10 — **Google Calendar REAL (read-only, multi-tenant) via Supabase Edge Functions (Deno).** Substitui
  o placeholder da S6 (#19). Migrations `20260626140000` (4 tabelas `calendar_*`: tokens/state **deny-all**;
  connections/cache leitura sprint) e `20260626150000` (seed fictício). 4 Edge Functions
  (`google-calendar-auth`/`callback`/`sync`/`disconnect`) — troca OAuth + tokens **só no servidor**
  (service_role); o client (Vite) nunca vê `client_secret`/`refresh_token`. Agenda do Dashboard **mesclada**
  (interna S6 + Google, com chip de fonte; Google read-only; CRUD interno intacto) + card **Integrações** em
  Configurações (admin-gated). **web/Edge-only** — o app paciente NÃO consome `calendar_*`; contrato cross-repo
  inalterado. Cifra do refresh_token (#22), verificação de tenant no servidor (#23) e round-trip OAuth real
  (`NÃO_COMPROVADO_AUTOMATICAMENTE`, ver `docs/ops/SETUP_GOOGLE_CALENDAR.md`) seguem para a S9. ✅
- Sessão 12 — **Agenda do Dashboard como CALENDÁRIO (FullCalendar v6).** Migration aditiva `20260626160000`:
  `appointments` ganha `type` (consulta/retorno/previsao_retorno/outros) e `status` (confirmado/pendente/desmarcado)
  — `text` + CHECK + defaults; RLS sprint **intacta**; **NÃO** toca `calendar_*` (tokens/state seguem deny-all). A
  web passa a ler/gravar os novos campos; **web-only** (o app paciente NÃO consome `appointments`) → contrato
  cross-repo inalterado. Busca **range-driven** (faixa visível) + cor por tipo/status; Google (S10) segue mesclado
  read-only. A conexão Google migrou para um dropdown **Integrações** no topo da agenda (admin-gated). Fuso fixo
  (`@fullcalendar/luxon3`) diferido (PENDENCIAS #25); RLS real de `type/status` segue no guarda-chuva da S9. ✅

**App (`vertexa-app-paciente`):**
- 4a — fundação (client Supabase + camada api) ✅ (`74806f2`)
- 4b — chat real (`TeamChat` sobre `chat_*` + @ + realtime) ✅ (`624e3b8`)
- 4c-1 — sink de eventos → `activity_events` ✅ (`ecba42f`)
- 4c-2 — recuperação muscular (provisória): app **escreve** + (S11) **lê e pinta** no body map dinâmico ✅
- 4c-2b — VRI → `adherence_snapshots` ✅ (write `sprint_adherence_write`)
- 4c-3 — ler plano/treino reais (HomePage/Profile → "Mariana") ⏳ pendente
- **Sessão 2 — fluxos do paciente fora do mock (pendência #16): ✅** PESO real (`weight_logs`),
  FOTO real (bucket `progress-photos` + `progress_photos`), ÁGUA `payload.liters` (incrementos/soma do dia),
  pendências da Home derivadas de dados reais, treino do `Records` com `workoutId` real (recuperação + VRI),
  VRI de dados reais (engine lê `activity_events`; Home lê o último snapshot → consistente web↔app),
  anti-crash (boot tolerante a env + `ErrorBoundary`). Mariana reconciliada **88/alta**.
  Migration aditiva `20260625170000` (INSERT em `progress_photos`).
- **Sessão 3 — assets oficiais da cliente: ✅** 28/30 GIFs de exercício trocados por assets oficiais
  (`src/assets/exercises/*` via `import.meta.glob`; ex-23/ex-30 seguem fallback de terceiros como
  pendência pontual; ex-24 renomeado p/ "Cadeira adutora"). Onboarding usa as 5 telas oficiais
  (`src/assets/onboarding/01..05`), removendo os overlays duplicados (logo/headline/mockup) e mantendo
  swipe/dots/CTA/tracker. Body map mantido em SVG (melhoria registrada). typecheck/lint/build/testes
  verdes; verificado por Playwright (Onboarding + WorkoutGuide carregam os assets oficiais; 0 erro de console).
- **Sessão 11 — body map DINÂMICO de recuperação: ✅** (`3206b52`) o app agora **LÊ** `muscle_recovery_states`
  (antes só escrevia) e pinta um mapa por status **DERIVADO de `last_trained_at`** (regra pura `recoveryRule.ts`:
  0-2=fatigued, 3=recovering, 4=recovered, 5+=weakened, sem histórico=neutral; reusa `daysAgoLocal`/fuso local).
  A coluna `status` continua provisória (#1) e NÃO é a fonte da cor. Implementa a "melhoria futura" do body map:
  PNG oficial `Body_front/Body_back` + overlay SVG por face (viewBox próprio) com zonas `<path>` bilaterais
  espelhadas, flip frente↔costas (framer-motion + `prefers-reduced-motion`), legenda dos 5 estados, bottom
  sheet (Radix) por zona, tokens `--recovery-*` (recovered=azul, weakened=verde). Read path `getMuscleRecovery`
  + hook `useMuscleRecovery` (`['recovery', patientId]`) + invalidação em `eventSync` via QueryClient singleton.
  Removido o esquema antigo `activated` do body map. **SEM migration** (ENUM `muscle_status` já tem os 5 valores;
  `sprint_read_all` já permite anon SELECT — confirmado por MCP). vitest 39/39 · tsc/build 0 · Playwright /progress
  (dado real da Mariana, flip, tooltip, 430px). Conclusão de treino→repaint = wiring por código (não E2E p/ não
  mutar o seed). Pendência #1 (decaimento server-side do status) segue aberta — hoje a derivação é client-side.
- **Sessão 13 — REFEIÇÃO FEITA persiste (meal_logs): ✅ VERIFICADO VIA MCP (02/07).** O check verde da
  aba Alimentar (Plan.tsx) era sempre falso e não gravava. Agora: nova tabela CANÔNICA **`meal_logs`**
  (VALOR/ESTADO "refeição consumida no dia"; toggle idempotente por `unique(patient_id,meal_id,consumed_on)`);
  evento **`meal_logged`** no eventTracker (payload SÓ `{meal_id}`) espelhado pelo eventSync em
  `activity_events(type='meal_logged')` **apenas como MARCADOR** de timeline; `src/lib/api/meals.ts`
  (`toggleMealDone`/`getMealsDoneToday`/`getMealAdherenceToday`, tipado + react-query); Plan.tsx com toggle
  otimista + `tracker.track('meal_logged')` só ao MARCAR (fallback mock com check DESABILITADO); HomePage
  meta "Refeições" = done/total real + card de pendência que some quando done>0; **fator de adesão alimentar
  ADITIVO** no VRI (`adherenceEngine`, bônus não-negativo máx 6 antes do clamp -> **não rebaixa a Mariana
  88/alta**, pendência #3; provado por teste de monotonicidade). Migration aditiva
  `20260701120000_meal_logs.sql` (RLS sprint: `sprint_meal_read` + `sprint_meal_write_insert` +
  `sprint_meal_write_delete`, espelhando `weight_logs`; #11-#14 fecham por clínica). **web/VRI não regride**:
  o fator é estritamente aditivo e o marcador reusa o pipeline existente.
  Gates: **typecheck OK · vitest 59/59 OK · build OK · lint (diff) OK** (baseline do repo tem 3 erros
  pré-existentes em `ui/command.tsx`/`ui/textarea.tsx`/`tailwind.config.ts`, alheios a esta mudança).
  Gates: **typecheck OK · vitest 59/59 OK · build OK · lint (diff) OK** (baseline do repo tem 3 erros
  pré-existentes em `ui/command.tsx`/`ui/textarea.tsx`/`tailwind.config.ts`, alheios).
  **Verificado via MCP em 02/07:** `meal_logs` (source='app') + marcadores `meal_logged` (payload={meal_id})
  + VRI recalculado sem regressão; dado de teste limpo, Mariana restaurada a 88/alta. (Detalhe da evidência:
  3 refeições da Mariana marcadas geraram 3 linhas `meal_logs` com `consumed_on=2026-07-01` — fuso local
  correto, gravadas ~02:33 UTC = 23:33 de 01/07 em SP — + 3 marcadores `activity_events(meal_logged)` e o VRI
  subiu 88→100/alta, NUNCA rebaixando o nível; o app lê `meal_logs` com HTTP 200 e `/plan` mostra as refeições
  desmarcadas após o cleanup.) App: branch `feat/meal-done-persist`. Web: branch `feat/meal-logs-migration`.
- **Sessão 14 — ATIVIDADE COMPLEMENTAR persiste (activity_sessions): ✅ VERIFICADO VIA MCP (02/07).**
  `/log-activity` (LogActivity.tsx) era 100% visual — o "Salvar atividade" só trocava de step, sem gravar.
  Agora: nova tabela CANÔNICA **`activity_sessions`** (VALOR: `modality`/`duration_min`/`calories`/`source`/
  `performed_at`; `source` 'manual'|'device' — device cosmético mas o valor é persistido); evento
  **`activity_logged`** no eventTracker (payload `{modality,duration_min,calories,source}`) espelhado pelo
  eventSync em `activity_events(type='activity_logged')` **apenas como MARCADOR** de timeline + recomputa o VRI;
  `src/lib/api/activities.ts` (`logActivitySession`/`getRecentActivitySessions`/`getActivitySessionsSince`,
  tipado + react-query); catálogo único `src/lib/activityModalities.ts` (slug canônico
  corrida|caminhada|ciclismo|natacao|jiujitsu|tenis|cardio|outra, compartilhado LogActivity↔Progress).
  LogActivity persiste via `logActivitySession()` + `tracker.track('activity_logged')` ANTES de navegar pro
  sucesso (NÃO navega se a escrita falhar; loading/erro tratados). Progress LÊ `activity_sessions` REAIS no bloco
  "Atividades complementares" (lista + tempo/kcal reais da semana; estado vazio real; mock removido). **Fator de
  atividade complementar ADITIVO/NÃO-NEGATIVO** no VRI (`adherenceEngine`: bônus por DIA distinto com
  `activity_logged` nos últimos 7d, satura em 3 dias -> **máx +6**, ANTES do clamp -> **não rebaixa a Mariana
  88/alta**, pendência #3; provado por teste de monotonicidade + invariante Mariana-like). A subida do VRI a 100
  observada vem de fatores PRÉ-EXISTENTES do engine (reset do relógio de interação + bônus peso/foto/plano
  passando do teto), **não** do bônus +2 desta sessão — o fator é reforço, não driver. Migration aditiva
  `20260702120000_activity_sessions.sql` (RLS sprint: `sprint_activity_session_read` SELECT +
  `sprint_activity_session_write` INSERT, espelhando `weight_logs`; #11-#14 fecham por clínica).
  Gates: **typecheck OK · vitest 64/64 OK · build OK · lint (diff) OK** (baseline do repo mantém 3 erros
  pré-existentes em `ui/command.tsx`/`ui/textarea.tsx`/`tailwind.config.ts`, alheios a esta mudança).
  **Verificado via MCP em 02/07** (dev server local + Playwright MCP dirigindo o fluxo REAL): 1 atividade
  (Corrida 30min/330kcal) -> linha em `activity_sessions` + marcador `activity_events(activity_logged,
  payload={modality,duration_min,calories,source})` + Progresso mostra a atividade real e PERSISTE no reload;
  VRI recomputado 88->100/alta (NUNCA rebaixando). Dado de teste limpo CIRURGICAMENTE por id; Mariana restaurada
  a 88/alta (snapshot `a77e5c9b`). App: branch `feat/activity-sessions-persist`. Web (migration): branch
  `feat/activity-sessions-migration`.
- **Sessão 15 — CALIBRAÇÃO do motor de VRI (fim do "100 no primeiro toque"): ✅ VERIFICADO VIA MCP (02/07).**
  Diagnóstico (provado por breakdown fator-a-fator + agente independente): `computeScore` começava em 100
  (teto) e só subtraía por inatividade, somando um STACK aditivo (≤+63) MUITO maior que o decay (≤−45) →
  qualquer perfil ativo estourava 100 e o clamp mascarava tudo; além disso a recência RESETAVA a 0 em
  qualquer evento novo ("reset-and-re-saturate"). **Recomposição (Strategy 2, combinado C7, SÓ app —
  `adherenceEngine.ts`, SEM migration):** recência vira termo POSITIVO LIMITADO (`recencyPoints`, sem
  reset) + engajamento somado num orçamento (tiers por-sinal INALTERADOS) + soft-cap por RETORNOS
  DECRESCENTES na banda `[VRI_BASE=70, +VRI_HEADROOM=30]`, `VRI_CURVE=0.42`. NÃO baixa o clamp, NÃO
  subtrai cegamente, NÃO muda o shape do snapshot (`deriveAdherenceConfig`/`getLevel`/`getStatus`
  intactos). Resultado: perfil REAL da Mariana hoje **89/alta** (passivo), 1 ação isolada → **91/alta**
  (nudge crível), DEFAULT engajado → 95, topo 100 RESERVADO ao near-perfect. Monotonicidade + piso ≥88
  preservados (testes). Gates: **typecheck OK · vitest 67/67 · build OK · lint (diff limpo; baseline
  mantém 3 erros pré-existentes)**. **Verificado via MCP (02/07):** recompute vivo (1 atividade) gerou
  snapshot **91/alta, NÃO 100** → dado de teste limpo por id → Mariana restaurada a 88/alta (`a77e5c9b`).
  Ver pendência #3 (+ follow-up #3b: streak/weekly do recompute vivo ainda refletem os 4 eventos
  esparsos). App: branch `fix/vri-calibration` (PR aberto, sem merge).
- **Sessão 16 — SEED CONVERGENTE da Mariana (fecha #3b): ✅ VERIFICADO VIA MCP (02/07).**
  Problema: o snapshot autoral (88/streak18/weekly80) NÃO era reproduzível pela engine calibrada — o
  recompute vivo dava streak~0-1/weekly~20, então a 1ª ação derrubava a sequência 18→1. Solução (SÓ repo
  WEB, migration de seed — sem mudança de app): função versionada **`refresh_demo_mariana_streak()`** planta
  uma janela ROLANTE de 18 dias de eventos REAIS relativa a `now()` SÓ p/ a Mariana (17× `hydration_logged`
  D1..D17 + 4× `workout_checked` D0/D2/D4/D6 → weekly 80% + marcadores de timeline weight/photo), marcados
  com `payload->>'seed'='demo_mariana_streak'`. A função é DONA do estado (delete-all + replant),
  idempotente, SEM EXECUTE p/ anon/authenticated (espelha `20260630234139`). **Baseline COMPUTADO pela
  engine (não cravado):** 1 ação real no app (registrar Sono → `sleep_logged` → eventSync) fez a engine
  gravar o snapshot **96/alta/streak 18/weekly 80** (positive_factors
  ["Sequência de 18 dias","Treinos consistentes","Peso atualizado","Plano acompanhado"]). **Convergência
  provada:** o snapshot que o web lê == o recompute vivo; a ação isolada NÃO derrubou o streak (segue 18 →
  19 no dia seguinte). O "88" autoral foi SUPERADO por **~96/alta** (decisão aprovada — o 88 era
  incompatível com um perfil engajado sob a engine C7); o snapshot autoral `a77e5c9b` (88) segue como
  histórico (o web lê o mais recente). **DRIFT — seed REFRESHÁVEL** (datas fixas envelhecem; o streak
  colapsa em ~2 dias). **Ritual pré-demo CONSOLIDADO (2 passos, S-EXEC)** (via MCP + app):
  `select public.refresh_demo_mariana();` (guarda-chuva = streak + execução de treino) + 1 ação real da Mariana que dispare o tracker (ex.: Sono)
  para a engine regravar o snapshot fresco. Migration `20260702130000_seed_demo_mariana_streak_convergence.sql`.
  Gates do app (sem mudança de código): **typecheck OK · vitest 67/67 · build OK**. Web: branch
  `fix/seed-mariana-convergence` (sem merge).
- **Sessão 17 — SUPLEMENTOS vivos (S3: supplements + supplement_intakes): ✅ VERIFICADO VIA MCP (02/07).**
  A aba Plano › Suplem. era 100% mock (mockData.supplements) e não havia "tomado". Agora: a LISTA vem do
  banco (**`supplements`**, autoria do profissional/web como as refeições; hoje populada por SEED da
  Mariana com ids fixos `30000000-…-000000000001..05` — **DÍVIDA: editor de suplementos no web ainda não
  existe**) e o "tomado" persiste em **`supplement_intakes`** (VALOR/ESTADO; toggle idempotente por
  `unique(patient_id, supplement_id, taken_on)`; `taken_on` = data LOCAL do paciente). Marcador de
  timeline: `activity_events(type='supplement_checked', payload={supplement_id})` via tracker/eventSync
  (union já tinha o tipo; só entrou no allow-list) — disparado SÓ ao marcar, após a escrita. Camada
  `src/lib/api/supplements.ts` (getMySupplements/toggleSupplementTaken/getSupplementsTakenToday/
  getSupplementAdherenceToday, tipado + react-query); Plan.tsx com toggle otimista espelhando o de
  refeições + loading/empty/error reais (mock removido). **Fator de suplementos ADITIVO/NÃO-NEGATIVO**
  no VRI (`SUPPLEMENT_ADHERENCE_BONUS_MAX=4`, menor que o alimentar; entra no orçamento de engajamento
  SEM rebasear o denominador do soft-cap — overflow satura em 1 de propósito, preservando o invariante
  não-regressivo). INVARIANTE respeitado: Mariana convergente segue **96/alta** (recompute do teste deu
  96 idêntico -> dedup nem gravou snapshot; soft-cap não deixou cravar 100). Migration aditiva
  `20260702140000_supplements.sql` (RLS sprint: `sprint_supplement_read`+`sprint_supplement_write` ALL
  espelhando planos; intakes `_read`/`_insert`/`_delete` espelhando `meal_logs`; AMBAS anotadas no
  checklist #14). Gates: **typecheck OK · vitest 71/71 · build OK · lint (diff limpo; baseline 3 erros
  pré-existentes)**. **Verificado via MCP (02/07):** marcar Creatina -> linha em `supplement_intakes` +
  marcador correto -> reload PERSISTE -> desmarcar via UI (caminho DELETE real) -> cleanup cirúrgico do
  marcador por id; seed convergente da Mariana INTACTO (24 eventos; snapshot `a232d1a4` 96/alta).
  App: branch `feat/supplements-live`. Web (migration): branch `feat/supplements-migration` (sem merge).
- **Sessão 18 — PROGRESSO VIVO (Progress.tsx real; fim do `Math.random`): ✅ VERIFICADO VIA MCP (02/07).**
  Diagnóstico A/B/C aprovado. Viraram REAIS (via `api/*` + react-query, loading/empty/error em cada):
  **nº de treinos do período** (DIAS distintos com `workout_checked`), **Evolução do peso** (`weight_logs`:
  série cronológica + Δ real), **Constância** (`activity_events`, dias ativos distintos na janela 7/14/28 —
  **DETERMINÍSTICA**, matou o `Math.random`), **Índice VRI** (LÊ o último `adherence_snapshots` via
  `getLatestAdherenceState`, igual à Home — NÃO recomputa nem grava; engine intacto), **Fotos evolutivas**
  (`progress_photos` reais) + modal Comparar só com **Δpeso real** (removidos os números fabricados 92%/64).
  **REMOVIDOS** (sem fonte de EXECUÇÃO → dívida **#S-EXEC**): cards tempo/calorias/exercícios/séries/reps/
  carga, "Regiões mais trabalhadas", "Tipos de exercícios", "Volume semanal". Conquistas → estado vazio
  (motor é a S5). Seletor 7/14/28d MANTIDO e escopa constância + nº de treinos (muda de fato). Nova lib PURA
  `constancy.ts` (`deriveConstancy` determinística + `countWorkoutDaysInWindow`, que DEDUPLICA o
  `started`+`completed` do WorkoutGuide). **SEM migration** (100% derivação do que já existe). Review
  adversarial (workflow, 10 agentes): 3 achados confirmados e CORRIGIDOS (VRI sem branch de erro → agora
  tem retry; contagem de treino dobrava `started`+`completed` → passou a DIAS distintos). Gates: **typecheck
  OK · vitest 78/78 · build OK · lint (baseline 3 erros pré-existentes)**. **Verificado via MCP + Playwright
  (02/07):** /progress bate com o banco (4 treinos 7d · peso 71,5→68,4 = -3,1 kg em 8 pts · constância
  7/7=100% ↔ 18/28=64% · VRI 96/alta/streak18/80% · 2 fotos) e a constância é DETERMINÍSTICA (reload = igual).
  Tela READ-ONLY → sem dado de teste; seed convergente (18d) + baseline 96/alta INTACTOS. App: branch
  `feat/progress-live` (sem merge).
- **S5 — CONQUISTAS VIVAS (o motor prometido pela S18): ✅ VERIFICADO VIA MCP + Playwright (02/07).**
  A tela `/achievements` e o card "Conquistas recentes" do Progresso (a S18 deixou em estado vazio) agora leem
  dados REAIS. Novo motor PURO/DETERMINÍSTICO `src/lib/achievementsEngine.ts` (12 conquistas em 3 categorias:
  primeiros passos, **constância = streak como proxy da jornada [D1]**, **peso "desde o início do
  acompanhamento" [D2]** — recorte propositalmente diferente do "no período registrado" da tela de peso, p/
  ninguém achar que -3,1 kg × 5 kg é erro) + camada `src/lib/api/achievements.ts` (deriva fatos REAIS →
  UPSERT `patient_achievements` ON CONFLICT DO NOTHING; unlock MONOTÔNICO) + hook `useAchievements` + wiring
  ISOLADO em `eventSync` (roda DEPOIS e à parte do VRI). **Guard #13** respeitado (treino = DIAS distintos,
  dedup started+completed). **[D3]** conquistas de refeição/atividade/suplemento ficam TRAVADAS (tabelas-valor
  vazias) até a Mariana fazer de verdade — seed NÃO mutado. Unlock retroativo da Mariana **VIA MOTOR** (não
  INSERT manual): 7 destravadas (first_workout/weight/photo + streak_7/14 + weight_3kg/5kg), todas
  `source='engine'`. **INVARIANTE VRI PROVADO:** o snapshot da Mariana seguiu `a232d1a4` **96/alta/streak18/
  80%** BYTE-A-BYTE (mesmo id/calculated_at; snapshot_count permaneceu 1) — as conquistas NÃO tocam o
  `adherenceEngine`/denominador nem gravam `adherence_snapshots`. Migration ADITIVA
  `20260702210746_achievements.sql` (2 tabelas: catálogo global `achievements` + `patient_achievements`;
  RLS sprint: catálogo SELECT, unlocks SELECT+INSERT, SEM UPDATE/DELETE; AMBAS no checklist #14). Pendência da
  JORNADA (`start_date` 30/06 × narrativa de "30 dias") registrada como **#S5-JORNADA** (decidir na S6).
  Review adversarial (workflow, 5 dimensões × verificação): **0 Critical/Important**; 2 Minor de estado-de-erro
  CORRIGIDOS (isError da resolução de patientId + contador "0 de 0" no erro). Gates: **typecheck OK · vitest
  94/94 · build OK · lint (diff limpo; baseline mantém 3 erros pré-existentes)**. App: branch
  `feat/achievements-live` (sem merge). Web (migration + docs): branch `feat/achievements-migration` (sem merge).
- **S6 — JORNADA VIVA + NOTIFICAÇÕES REAIS + coerência temporal do seed: ✅ VERIFICADO VIA MCP + Playwright (02/07).**
  (A) **Jornada viva:** a /journey era 100% mock (`getJourneyCheckpoints` com datas fictícias + `getAdherenceState`
  local). Agora deriva de dado REAL via novo módulo PURO/determinístico `src/lib/journey.ts` (testado): "**Dia X do
  acompanhamento**" (a partir de `start_date`; dayNumber TZ-safe — DATE parseada como LOCAL) + marcos = onboarding +
  as CONQUISTAS reais (destravadas com data real, ordem CRONOLÓGICA; travadas = marcos futuros sem data) + fase/
  streak/VRI do ÚLTIMO snapshot (`getLatestAdherenceState` — NÃO recomputa). `adherenceEngine.ts` **NÃO foi tocado**
  (regra inviolável); `getJourneyCheckpoints` fica como export MORTO, substituído por `journey.ts`. (B) **Notificações
  reais:** nova tabela `notifications` (migration `20260702220402`; nasce de SEED — dívida do emissor web) +
  `src/lib/api/notifications.ts` (getMyNotifications/getUnreadCount/markAsRead/markAll) + hooks; a /notifications lê
  real e "marcar como lida" **PERSISTE** (`read_at`); o **badge do sino da Home = getUnreadCount real** (fim do ponto
  estático). (C) **Coerência temporal (#S5-JORNADA):** migration `20260702220213` alinhou `start_date`→**15/01** (1ª
  avaliação = início real do acompanhamento) e as 7 conquistas às datas REAIS de cruzamento (02/04..28/06) — **DISPLAY
  only**. **INVARIANTE VRI:** `start_date`/`unlocked_at` NÃO são inputs do adherenceEngine; snapshot da Mariana seguiu
  `a232d1a4` **96/alta/streak18/80% BYTE-A-BYTE** (SELECT antes/depois); a janela de 18d de `activity_events` (streak)
  não foi tocada. Gates: **typecheck OK · vitest 100/100 · build OK · lint (diff limpo; baseline 3 erros pré-existentes)**.
  **Verificado via Playwright** (Dia 169; timeline 15Jan→28Jun + 5 travados; badge **2→1** ao marcar lida e PERSISTE no
  reload; 0 erro de console) **+ MCP** (`read_at` gravado; VRI 96/alta inalterado; seed de teste restaurado a 2 não
  lidas). **Review adversarial (workflow, 5 dimensões × verificação): 0 achados.** App: branch
  `feat/journey-notifications-live`. Web: branch `feat/journey-notifications-migration` (empilhadas sobre S5; sem merge).
- **S-DOCS — UPLOAD de exame/documento pela web (bucket PRIVADO + signed URL): ✅ VERIFICADO VIA MCP +
  Playwright (02/07).** A aba Documentos tinha só um placeholder ("chega em breve") + os laudos legados de
  `body_assessments.document_url` (leitura). Agora o profissional ENVIA exame/documento (PDF/imagem) de
  verdade: nova tabela CANÔNICA **`patient_documents`** (bucket **PRIVADO** `patient-documents`, `public=false`
  + **signed URL** TTL 10 min no clique — `file_path` guarda o caminho, NÃO URL pública). Camada
  `src/lib/api/documents.ts` (`uploadPatientDocument` valida mime pdf/jpeg/png/webp + tamanho ≤15MB, sobe p/
  `<patient_id>/<ts>.<ext>` e insere a linha; `listPatientDocuments` resolve o nome de quem enviou via `.in`
  em professionals→profiles; `getDocumentSignedUrl` = createSignedUrl 600s), hook `useDocuments`
  (`usePatientExams`/`useUploadPatientDocument`, queryKey **`patientExams`** SEM colidir com o `patientDocuments`
  legado), `DocumentsTab` com upload real (select de tipo + input file oculto) + lista "quem enviou · data ·
  tamanho" + "Abrir" que assina a URL NO CLIQUE (aba aberta antes do await → sem pop-up blocker). A seção
  legada de laudos (`body_assessments.document_url`) foi PRESERVADA **somente leitura** (nada some; allowlist
  `isSafeDocumentUrl` intacta, #18). Modelo **BIDIRECIONAL**: só o lado do PROFISSIONAL (web) foi implementado;
  o lado do PACIENTE (`uploaded_by_role='patient'`) é sessão FUTURA do repo do app — a web NÃO tocou o app.
  Migration ADITIVA `20260702230000_patient_documents.sql` (RLS sprint SELECT+INSERT + storage SELECT+INSERT;
  **AMBAS no #14**; aplicada via `apply_migration`, ledger `20260702224214`). VRI/adherence intocados. Review
  adversarial (workflow, 5 dimensões × verificação independente): **0 Critical/Important**; 5 Minor confirmados
  e CORRIGIDOS (id de auditoria de quem enviou só grava com o profissional resolvido; rollback esvazia o bucket
  antes de dropá-lo; empty-state não pisca no refetch pós-upload; região aria-live sempre montada) — 3 refutados.
  Gates: **typecheck OK · lint OK (0/0) · build OK**. **Verificado via MCP + Playwright (02/07):** logado como
  Dra. Camila → aba Documentos do Ricardo (paciente de TESTE, NÃO a Mariana) → enviar 1 PDF → linha em
  `patient_documents` (`uploaded_by_role='professional'`, `uploaded_by_professional_id=…e2`, mime/tamanho/
  file_path corretos) + objeto no bucket → reload PERSISTE → "Abrir" gerou signed URL (scope=download, TTL 600s)
  → `HTTP 200 application/pdf 460 B`. Cleanup CIRÚRGICO por id (linha + objeto do storage); seed da Mariana
  INTACTO. Web (migration + código + docs): branch `feat/patient-documents-upload` (sem merge).
- **S-VRI-PDF — RELATÓRIO DE PONTOS / VRI (PDF client-side): ✅ VERIFICADO VIA MCP + Playwright (02/07).**
  Novo relatório PDF motivacional focado em PONTUAÇÃO/ENGAJAMENTO, pensado p/ o paciente LEVAR ao retorno
  (WhatsApp/impressão), reusando a infra `src/lib/pdf/*` (mesma casca `ReportShell` + primitivos do Relatório
  de Evolução). `src/lib/pdf/PointsReport.tsx` (herói do VRI + pontos fortes/atenção + resumo de peso + recado)
  + `generatePointsReport.tsx` (build→blob→download, `now` injetável) espelham o par Evolução; botão
  `ExportPointsButton` (self-contained, padrão do `ExportEvolutionButton`) na aba **Visão geral** do paciente.
  **O VRI é LIDO do último `adherence_snapshots`** (score/level/status/streak/weekly_completion_rate/
  positive_factors/risk_factors) — a web **NÃO recalcula** (nenhum valor fixo/hardcoded); resumo de peso reusa
  `getWeightSeries` + `WeightChartPdf`; recado é COPY derivada do nível (não é métrica inventada); **sem
  execução de treino** (#S-EXEC). Campos ausentes degradam com elegância. Único toque em arquivo compartilhado:
  `ReportShell` ganhou prop `footerLabel` (default preserva o Relatório de Evolução byte-a-byte). **READ-ONLY**
  (sem escrita no banco → sem cleanup). Gates: **typecheck OK · lint OK (0/0) · build OK**. **Verificado via
  Playwright (02/07):** ficha da Mariana → aba Visão geral → "Relatório de Pontos (PDF)" → download
  `pontos-mariana-albuquerque-2026-07-02.pdf` (PDF válido 35 KB) disparado com **0 erro de console**; números do
  relatório batem com o snapshot real via MCP (**96/alta · streak 18 · 80% · 4 pontos fortes · 0 riscos**); seed
  INTACTO. Web: branch `feat/vri-points-report` (a partir do main consolidado; sem merge).
- **S-RISK — SINAIS DE RISCO derivados (read-only) para o retorno: ✅ VERIFICADO VIA MCP + Playwright (03/07).**
  Painel "Sinais de risco" na aba Visão geral (COMPLEMENTAR ao VRI, não o duplica) que sinaliza, 100%
  DERIVADO do que a web já lê (SEM tabela nova, SEM escrita): **(a) sobrecarga muscular**, **(b) meta de água**,
  **(c) foto ausente** e **(d) mobilidade**. Nova lib PURA `src/lib/domain/riskSignals.ts` (`computeRiskSignals`
  + `RISK_THRESHOLDS` documentados) + leitor read-only `getHydrationDailyLiters` (litros/dia nos últimos N dias
  COMPLETOS; exclui hoje parcial) + hook `useHydrationDaily` + `RiskSignalsPanel` (self-contained, AsyncSection
  loading/empty/erro). **HONESTIDADE (regra "não inventar"):** mobilidade = `available:false` ("sem dados" — o
  app não registra mobilidade; não fabricado); água usa DEFAULT documentado (2,0 L/dia — **não há meta por
  paciente**) e só conta "abaixo da meta" em dias COM registro (ausência de log ≠ "não bebeu"); sobrecarga usa o
  `status` PERSISTIDO (mesma fonte da aba Recuperação) e só dispara com fadiga SUSTENTADA ≥3d (além da janela
  normal 0–2d), com o caveat de que o status **não decai server-side** (#1); **o VRI NÃO é recalculado nem
  duplicado**. **Verificado (03/07):** Mariana (96/alta) → estado honesto "Sem sinais de risco no período" +
  "Sem dados: Mobilidade" (biceps fadiga 2d NÃO sustentada; água 2,0 L batida nos dias com registro; foto há 8d
  <30d); Ricardo (teste) → 2 sinais ATIVOS "Atenção" (água sem registros 7d + foto nunca enviada) + mobilidade
  sem dados. 0 erro de console; read-only → sem cleanup; seed INTACTO. Gates: **typecheck OK · lint OK (0/0) ·
  build OK**. Review adversarial (workflow, 5 dimensões × verificação): 0 Critical/Important; 2 Minor + 1
  latente CORRIGIDOS (paridade do limite de foto com pendencies; tolerância de float na meta de água; comentário
  do empty-state). **THRESHOLDS pendentes de validação clínica com a Juliana** (ver PENDENCIAS #9). Web: branch
  `feat/injury-risk-signals` (sem merge).
- **S-SUPL-EDITOR — EDITOR DE SUPLEMENTOS no web (autoria que faltava): ✅ VERIFICADO VIA MCP + Playwright (03/07).**
  Fecha a dívida "editor de suplementos no web" (S17): a LISTA de `supplements` deixa de nascer só de seed — o
  profissional agora faz **CRUD completo** pela web, que o app já LÊ (`getMySupplements`). **Sem migration** (a
  tabela é da S3 do app; `sprint_supplement_write` ALL já permite INSERT/UPDATE/DELETE). `src/lib/api/supplements.ts`
  (`listPatientSupplements`/`createSupplement`/`updateSupplement`/`deleteSupplement`, tipado) escreve EXATAMENTE as
  colunas que o app consome (name, dose, time_label, order_index; ordena por order_index; novo item entra no fim) —
  **NÃO renomeia/remove coluna** e **NÃO toca `supplement_intakes`** (o "tomado" é do paciente/app). Hook
  `useSupplements` (query + mutations que invalidam a lista); aba própria **"Suplementos"** na ficha
  (`SupplementsTab` + `SupplementEditorDialog`), RBAC via `GatedAction` (**`canEditSupplements` = médico ou nutri**;
  os demais veem read-only) e **exclusão via AlertDialog** do design system (novo primitivo `ui/alert-dialog.tsx` +
  dep `@radix-ui/react-alert-dialog` — fecha a #19c "trocar window.confirm por AlertDialog"). Gates: **typecheck OK ·
  lint OK (0/0) · build OK**. **Verificado (03/07)** com paciente de TESTE **Ricardo** (nunca a Mariana): criar →
  linha em `supplements` com as colunas do app corretas (name/dose/time_label/order_index=0) → editar (dose "5 g",
  momento "Manhã" persistidos) → excluir via AlertDialog → lista vazia. Cleanup CIRÚRGICO por id via MCP; **os 5
  suplementos seed da Mariana INTACTOS** e `supplement_intakes` = 0 (intocado). ⚠️ Observação de ambiente: o browser
  do Playwright MCP estava sendo usado em paralelo por outra frente (S-EXEC) — a verificação foi confirmada pelo
  BANCO (MCP), que é imune à disputa. Web: branch `feat/supplements-editor` (sem merge).
- **S-EXEC — CAPTURA de EXECUÇÃO de treino (fecha #S-EXEC): ✅ VERIFICADO VIA MCP + Playwright (03/07).**
  O WorkoutGuide guiava o treino PRESCRITO mas DESCARTAVA o feito (só `workout_checked`). Agora CAPTURA
  séries/reps/carga/RPE/duração em 2 tabelas CANÔNICAS **`workout_session_logs`** + **`workout_set_logs`**
  (padrão Strong/Hevy; SET NULL + snapshots `workout_name`/`exercise_name` preservam histórico na edição do
  plano; volume/1RM DERIVADOS em leitura — `src/lib/workoutExecution.ts` puro/testado). UI: inputs por série
  pré-preenchidos (0-safe p/ peso corporal) + **finalizar antecipado** (=> "3 de 4" derivável) + RPE opcional;
  escreve via `src/lib/api/workoutLogs.ts` ANTES de navegar (não navega/emite se falhar). **VRI INTOCADO:**
  `workout_checked` inalterado; `adherenceEngine` não lê estas tabelas. Progresso RELIGADO (card "Desempenho do
  treino"): volume, nº exs/séries/reps/carga, tempo, regiões% (via `muscle_groups`→muscleMap). Vazios honestos:
  "Tipos de exercício %" (sem categoria no schema) e calorias de treino (sem captura). Dívidas: **#S-EXEC-2**
  (isométrico por tempo → `duration_seconds` futuro) e **#S-EXEC-3** (escrita não-atômica, mitigada na leitura).
  Seed retroativo da Mariana (2 sessões DISPLAY-only, `source='seed'`, relativo a now()/TZ SP) via
  `refresh_demo_mariana_workout_execution()`; ritual consolidado em `refresh_demo_mariana()` (guarda-chuva).
  Gates: **typecheck OK · vitest 116/116 · build OK · lint (diff limpo; baseline 3 erros pré-existentes)**.
  **Verificado (03/07):** 1 treino guiado (Puxada 42,5kg×10 RPE 8 + 40kg×12, finalizado em 2 de 4) → 1
  `workout_session_logs`(source='app', workout_id linkado, performed_on LOCAL) + 2 `workout_set_logs` (FK +
  snapshots + RPE) → Progresso "Desempenho do treino" bateu (volume 6.305 · 17 séries · 198 reps · 4 exs ·
  carga máx 42,5 · 1h46 · regiões) → **VRI `a232d1a4` 96/alta BYTE-A-BYTE** (recompute dedup: hoje já era dia de
  treino → nem gravou snapshot). Cleanup CIRÚRGICO (sessão app + 2 marcadores + restore de muscle_recovery
  biceps/lats); seed convergente da Mariana INTACTO. App: branch `feat/workout-execution-live`. Web (migrations):
  branch `feat/workout-execution-migration` (sem merge).

**Banco:**
- `chat_*` + realtime ✅ · read policies ✅ · write policies sprint versionadas ✅
  (`20260618130000` activity/muscle/plan + `20260618140000` adherence)
- `meal_logs` — migration `20260701120000_meal_logs.sql` **versionada** (RLS sprint) e **APLICADA** no
  remoto; linhas reais verificadas via MCP em 02/07 e dado de teste limpo (ver Sessão 13). ⚠️ Confirmar que
  está registrada no ledger do CLI (`supabase_migrations.schema_migrations`) antes do merge — é idempotente.
- `activity_sessions` — migration `20260702120000_activity_sessions.sql` **versionada** (RLS sprint espelhando
  `weight_logs`: read SELECT + write INSERT anon/auth) e **APLICADA** via `apply_migration` (registrada no
  ledger como `20260702103554`); linha real + marcador `activity_events(activity_logged)` verificados via MCP
  em 02/07 e dado de teste limpo por id (ver Sessão 14). Idempotente (`create table if not exists` + `drop
  policy if exists`). ⚠️ O nome do arquivo (`20260702120000`) difere do timestamp do ledger porque
  `apply_migration` usa o relógio do servidor — igual ao caso `meal_logs`.
- `refresh_demo_mariana_streak()` (seed CONVERGENTE da Mariana, #3b) — migration
  `20260702130000_seed_demo_mariana_streak_convergence.sql` **versionada** e **APLICADA** via
  `apply_migration`. Função REFRESHÁVEL: janela rolante de 18 dias relativa a `now()` (delete-all + replant),
  eventos com `payload.seed='demo_mariana_streak'`, SEM EXECUTE p/ anon/authenticated. O baseline
  (96/18/80/alta) é escrito pela ENGINE via app (não cravado). Rollback: `drop function` + delete por marcador.
  Ritual pré-demo CONSOLIDADO (S-EXEC): `select public.refresh_demo_mariana();` (guarda-chuva: streak + execução) + 1 ação da Mariana no app (recompute).
- `supplements` + `supplement_intakes` — migration `20260702140000_supplements.sql` **versionada** e
  **APLICADA** via `apply_migration` (registrada no ledger como `20260702152201`); linha real de intake +
  marcador `activity_events(supplement_checked)` verificados via MCP em 02/07 e dado de teste limpo
  (desmarque via UI + marcador por id; ver Sessão 17). Idempotente (`create table if not exists` + `drop
  policy if exists` + seed `on conflict do nothing`). Seed: 5 suplementos da Mariana (ids fixos
  `30000000-…-01..05`) — o editor no web **✅ EXISTE (S-SUPL-EDITOR): a web faz CRUD (autoria) além do seed**.
  RLS sprint no checklist #14.
- `seed_mariana_timeline_coherence` — migration `20260702220213_seed_mariana_timeline_coherence.sql` **versionada** e
  **APLICADA** via `apply_migration`. UPDATE reversível (rollback no header) escopado à Mariana: `start_date`→15/01 +
  `patient_achievements.unlocked_at` retroativos. DISPLAY only — VRI (a232d1a4 96/alta) inalterado, comprovado por MCP.
- `notifications` — migration `20260702220402_notifications.sql` **versionada** e **APLICADA** via `apply_migration`.
  Aditiva/idempotente (`create table if not exists` + `drop policy if exists`); RLS sprint SELECT + UPDATE (marcar
  lida), SEM INSERT/DELETE p/ anon (nascem de seed — dívida do emissor web); CHECK no `type`; #14. Seed: 3 da Mariana
  (2 não lidas). Verificado via MCP (markAsRead grava `read_at`; dado de teste restaurado) + Playwright.
- `patient_documents` + bucket **PRIVADO** `patient-documents` — migration `20260702230000_patient_documents.sql`
  **versionada** e **APLICADA** via `apply_migration` (registrada no ledger como `20260702224214`; o nome do
  arquivo difere do ledger porque `apply_migration` usa o relógio do servidor — igual a meal_logs/supplements).
  Idempotente (`create table if not exists` + `drop policy if exists` + `insert bucket on conflict do nothing`).
  Linha real de documento (Ricardo, teste) + objeto no bucket verificados via MCP em 02/07 (signed URL HTTP 200
  application/pdf, 460 B) e dado de teste limpo CIRURGICAMENTE por id (linha + objeto; deletar o objeto do
  storage exige a Storage API ou bypass do trigger `protect_delete` — feito via `set local
  session_replication_role='replica'`). RLS sprint (tabela SELECT+INSERT; storage SELECT+INSERT) no checklist
  #14. Fecha a #12 para EXAME (bucket privado + signed URL).
- `workout_session_logs` + `workout_set_logs` (execução de treino, #S-EXEC) — migration
  `20260702240000_workout_execution_logs.sql` **versionada** e **APLICADA** via `apply_migration`. Aditiva/
  idempotente (`create table if not exists` + `drop policy if exists`); FKs `workout_id`/`workout_exercise_id`
  **ON DELETE SET NULL** (histórico sobrevive à edição do plano) + snapshots `workout_name`/`exercise_name`;
  CHECKs `weight_kg>=0`/`reps_done>=0`/`rpe 6..10`; RLS sprint SELECT+INSERT (append-only), AMBAS no #14. Default
  de `performed_on` endurecido p/ data LOCAL (America/Sao_Paulo), não UTC. Volume/1RM = derivados em leitura.
- `refresh_demo_mariana_workout_execution()` + guarda-chuva `refresh_demo_mariana()` — migration
  `20260702250000_seed_demo_mariana_workout_execution.sql` **versionada** e **APLICADA**. Função REFRESHÁVEL
  (delete-all `source='seed'` + replant relativo a now(), `performed_on` em TZ SP), resolve workout/exercise
  DINAMICAMENTE (letra + order_index) → robusta a regeneração do plano; SEM EXECUTE p/ anon/authenticated.
  **VRI-invariante** (não cria `activity_events`). Ritual consolidado: `select public.refresh_demo_mariana();`
  (= streak + execução) + 1 ação da Mariana no app. Rollback no header (drop functions + delete seed rows).

**Teste ponta a ponta (4d):** ⏳ pendente — app `@Camila` → badge ao vivo na web + bater ponto → Timeline/recuperação.
