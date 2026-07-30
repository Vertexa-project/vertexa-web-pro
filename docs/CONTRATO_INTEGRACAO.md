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
`PendingAccessPage` (não vê dados de ninguém), agora com DOIS caminhos (WP-ONBOARDING): **(1) criar a PRÓPRIA
clínica** — RPC `create_clinic_with_owner` → vira admin na hora e destrava o painel; **(2) aguardar o cadastro**
por uma clínica que o convidou (comportamento anterior; vínculo/onboarding do paciente = **Parte B (app)** / WP futuro).

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
| Storage `chat-attachments` (bucket **PRIVADO**, WP-CHAT-ATTACH A; pasta = `channel_id`) | **envia** (participante) + **lê** (signed URL) | **envia** (participante) + **lê**; admin da clínica **lê** e **não envia** | sim (payload governado pelo SELECT) |
| `workout_plans` / `workouts` / `workout_exercises` / `nutrition_plans` / `meals` | lê (4c-3, futuro) | **escreve via RPC** `save_workout_plan`/`save_nutrition_plan` (WP-APP-1, transacional; nunca INSERT/DELETE direto) | — |
| `profiles`+`patients`+`professional_patient_links`+`body_assessments` (cadastro de paciente) | — (não escreve) | **escreve via RPC** `create_patient` (WP-APP-1; profile nasce aqui, não pelo client) | — |
| `appointments` (agenda interna, Sessão 6) | — (não usa) | **escreve + lê** (CRUD da Agenda) | — |
| `calendar_*` (Google Calendar, Sessão 10) | — (não usa) | **lê** connections/cache; tokens/state **deny-all** (só Edge Function/service_role) | — |
| `schema_migration_log` (ledger técnico interno, Sessão 7) | — (não usa) | — (não usa; sem API client/portal) | — |
| `messages` (legada) | — | — (repontado) | — |

Colunas-chave (verbatim do schema; **não renomear sem alinhar aqui**):
- `chat_messages(id, channel_id, sender_profile_id, sender_role, body, created_at, attachment_path, attachment_name, attachment_mime, attachment_size)` — **sem** `sender_professional_id`. **`body` é ANULÁVEL** (WP-CHAT-ATTACH A) + CHECK `body IS NOT NULL OR attachment_path IS NOT NULL` (proíbe row vazio; mensagem só-anexo permitida). `attachment_*` = 1 anexo/mensagem (dívida: N anexos → tabela filha). Ao ler, tratar `body` possivelmente `null` (render do anexo).
- `chat_mentions(id, message_id, mentioned_profile_id, read_at)` — `read_at IS NULL` = não lida (badge).

**Anexo do chat (WP-CHAT-ATTACH A):** bucket **PRIVADO** `chat-attachments` (`public=false`, `allowed_mime_types = pdf/jpeg/png/webp`, `file_size_limit = 10 MB`). Caminho **`{channel_id}/{uuid}.{ext}`** (pasta = `channel_id`, não a pasta do paciente — a autorização do chat é por PARTICIPAÇÃO, não por acesso ao paciente). Enviar = upload no storage + INSERT em `chat_messages` com `attachment_path` (o path DEVE ser do próprio canal — item v do INSERT). Ler = `createSignedUrl` (padrão de `documents.ts`). **Quem envia:** participante (profissional ou paciente). **Quem lê:** `can_read_channel` (participantes + admin da clínica, oversight). **Admin lê mas NÃO envia.** UPDATE negado; DELETE só de objeto **órfão do próprio uploader** (`owner=auth.uid()` + sem mensagem referenciando). MIME/tamanho validados também no client (Partes B/C).
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
- Persistência é **PROVISÓRIA** até a Juliana confirmar (pendência #1).
- ⚠️ **CORREÇÃO DE TEXTO (2026-07-29, WP-METRIC-1a — nenhum código mudou aqui).** Esta linha dizia
  *"o status não decai sozinho (não há job de recálculo); ok pra demo de mesma sessão"*. Está
  DESATUALIZADA desde o WP-RLS2 (migration `20260722090000`). **O job existe e roda todo dia:**
  pg_cron `wp-rls2-recovery-decay`, `5 9 * * *` (09:05 UTC = 06:05 BRT), chamando
  `private.recompute_recovery_decay()` — que recomputa o status a partir de `last_trained_at`
  (fatigued→recovering→recovered→weakened) e grava apenas as linhas cujo status mudaria.
  Verificado em produção: **10/10 execuções `succeeded`**, a última em 2026-07-29 09:05 UTC.
  A cadência de **1x/dia** (um status pode ficar até ~24 h defasado) é a **DÍVIDA-RLS2-1**,
  registrada em `docs/PENDENCIAS.md`.

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

**EXECUTION_STATE (RLS-FAM2 · Comportamento do Paciente) = ✅ CONCLUÍDA (aguardando auditoria).** Migrations
`20260712090000_wp05b_fam2_helpers` + `20260712091000_wp05b_fam2_behavior_rls`, versionadas e APLICADAS. RLS real
por vínculo em 11 tabelas: `weight_logs`, `activity_events`, `activity_sessions`, `meal_logs`, `supplement_intakes`,
`muscle_recovery_states`, `adherence_snapshots`, `workout_session_logs`, `workout_set_logs` (via pai
`session_log_patient`), `progress_photos` (só metadado; bucket = família Storage), `body_assessments`. **Modelo:**
self-logs → SELECT `can_access_patient` (inclui externo), escrita `is_self_patient` (**anti-forja**: `patient_id` vem
do client, WITH CHECK amarra ao próprio). **`body_assessments` (clínico) → EXTERNO EXCLUÍDO** (`can_access_patient_internal`);
escrita = prof comum vinculado/admin. `patient_id` imutável (append-only sem UPDATE; col-priv onde há UPDATE). Novos
helpers: `session_log_patient`, `can_access_patient_internal`. Testes Nível 1 (`supabase/tests/wp05b_fam2_behavior_test.sql`):
suite verde — isolamento paciente-paciente nas 11, forja de `patient_id` negada (todas), via-pai negada, não-vinculado
negado, externo-mínimo (vê behavioral, NÃO vê `body_assessments`), reescrita de `patient_id` negada, anon negado, IDOR.
Advisors: as 11 saíram de `rls_policy_always_true`. **Cross-repo:** app grava sempre o próprio `patient_id`
(compatível sob login real; demo/anon quebra por design); web só LÊ o comportamental e ESCREVE `body_assessments`.
Kill switch (deny-all) no header da migration de policies. **Bucket de Storage NÃO alterado.** Dívida:
`adherence_snapshots`/`muscle_recovery_states` são gravadas pelo paciente (contrato atual) — idealmente engine
server-side no futuro (paciente poderia inflar o próprio score). Famílias restantes: **Agenda, Dados clínicos/planos,
Chat, Storage/Fotos** seguem em `sprint_*`.

**EXECUTION_STATE (RLS-FAM3 · Prescrição) = ✅ CONCLUÍDA (aguardando auditoria).** Migrations
`20260713090000_wp05b_fam3_helpers` + `20260713091000_wp05b_fam3_prescription_rls`, versionadas e APLICADAS. **EIXO
INVERTIDO** (profissional prescreve, paciente só LÊ) em 6 tabelas: `workout_plans`, `workouts` (via
`workout_plan_patient`), `workout_exercises` (via `workout_patient`), `nutrition_plans`, `meals` (via
`nutrition_plan_patient`), `supplements`. **SELECT** = `can_access_patient_internal` (paciente dono + prof comum
vinculado + admin; **EXTERNO EXCLUÍDO** das prescrições — AUTH-EXT-1, consistente c/ `body_assessments`).
**INSERT/UPDATE/DELETE** = `can_prescribe_for_patient` (prof comum vinculado OU admin) — o **PACIENTE NÃO ESCREVE**
(negativo central da família). `patient_id`/plan-fk imutáveis (col-priv). Coerência: `supplements` (prescrição) ↔
`supplement_intakes` (tomada, Fam2). Helpers novos: `workout_plan_patient`, `workout_patient`, `nutrition_plan_patient`,
`can_prescribe_for_patient`. Testes `supabase/tests/wp05b_fam3_prescription_test.sql` (suite verde: paciente-não-edita,
isolamento via-pai, prescrição p/ não-vinculado negada, reescrita de patient_id/plan_id negada, externo excluído, anon,
IDOR). Advisors: as 6 saíram de `rls_policy_always_true`. **Cross-repo:** web prescreve (`planMutations.ts`,
`supplements.ts`); app só LÊ (nenhuma escrita nas 6). **DÍVIDA-APP-1** (save = DELETE+INSERT não-transacional): a RLS
**não piora** — p/ prof não-vinculado o DELETE afeta 0 linhas e o INSERT é negado (falha limpa). Storage NÃO tocado.
Famílias restantes: **Agenda, Chat, Storage/Fotos (buckets), notificações/gamificação, legado `messages`.**

**EXECUTION_STATE (RLS-FAM4 · Chat) = ✅ CONCLUÍDA (aguardando auditoria).** Migrations
`20260714090000_wp05b_fam4_helpers` + `20260714091000_wp05b_fam4_chat_rls`, versionadas e APLICADAS. Autorização por
**PARTICIPAÇÃO** (não por patient_id) em 4 tabelas: `chat_channels`, `chat_participants`, `chat_messages`,
`chat_mentions`. Contrato real: canal por-paciente (`chat_channels.patient_id → patients.id`, unique); participante =
`chat_participants.profile_id`; remetente = `chat_messages.sender_profile_id` (NÃO há `sender_professional_id`).
**REALTIME:** `chat_messages`/`chat_mentions` estão em `supabase_realtime` → o Realtime aplica a RLS de SELECT; logo
`SELECT = can_read_channel` **FECHA o push** (não-participante que assine NÃO recebe — provado por `P2_REALTIME_NEG_CX`).
Modelo: SELECT `can_read_channel` (participante **OU admin da clínica** do canal — AUTH-ADMIN-1, decisão reportada);
`chat_messages` INSERT = participante **E** `sender_profile_id = current_profile_id()` (**anti-forja de remetente**),
APPEND-ONLY (sem UPDATE/DELETE → `channel_id`/sender imutáveis); `chat_participants` geridos por prof vinculado/admin
(**anti-join**; app não escreve participants); `chat_mentions` `read_at` só pelo próprio mencionado. Admin **lê** por
oversight mas **NÃO envia** (envio exige ser participante). Helpers: `is_channel_participant`, `channel_patient`,
`can_read_channel`, `can_manage_channel`, `message_channel`. Testes `supabase/tests/wp05b_fam4_chat_test.sql` (suite
verde: realtime-negado, forja-remetente, canal-alheio, auto-join, mover-mensagem, menção-alheia, isolamento-clínica,
anon, IDOR). Advisors: as 4 saíram de `rls_policy_always_true`. **Cross-repo:** web (`useChat.ts`/`chat.ts`) e app
(`chat.ts`) enviam com `sender_profile_id = identidade própria` (amarrado pelo WITH CHECK); web assina `postgres_changes`
em `chat_messages` filtrado por canal (governado pela RLS de SELECT). **KILL SWITCH:** deny-all nas 4 TAMBÉM desliga o
realtime (fail-closed correto). Storage NÃO tocado. Dívida: `sender_profile_id` vem do client (a RLS amarra ao
current_profile_id; endurecimento futuro = default/trigger server-side). Famílias restantes: **Agenda, Storage/Fotos
(buckets + tabela `patient_documents`), notificações/gamificação, legado `messages`.**

**EXECUTION_STATE (RLS-FAM5 · Documentos) = ✅ CONCLUÍDA (aguardando auditoria).** Migration
`20260715090000_wp05b_fam5_patient_documents_rls` (versionada e APLICADA). ESCOPO: **SÓ a TABELA `patient_documents`**
(metadado) — bucket/`storage.objects` **NÃO tocados**. `patient_id` direto; autoria `uploaded_by_role`/
`uploaded_by_professional_id`; `file_path` = caminho no bucket privado (não tocado). SELECT `can_access_patient_internal`
(paciente dono + prof comum vinculado + admin; **EXTERNO EXCLUÍDO** — documento clínico); INSERT/UPDATE/DELETE
`can_prescribe_for_patient` (prof vinculado/admin — **paciente NÃO escreve**: app não consome documentos, verificado por
grep). `patient_id`/`file_path` imutáveis (col-priv). Testes `supabase/tests/wp05b_fam5_documents_test.sql` (suite verde:
isolamento X⟂Y, não-vinculado negado, externo excluído, paciente-não-sobe, reescrita de patient_id negada, anon, IDOR).
Advisors: `patient_documents` saiu de `rls_policy_always_true`. Cross-repo: web escreve+lê (`documents.ts`, DocumentsTab);
app NÃO consome documentos. **A exibição atual NÃO quebra** (a signed URL do arquivo depende da policy de `storage.objects`,
que segue intacta). **DEPENDÊNCIA / STORAGE PENDENTE:** o bucket privado `patient-documents` continua com a policy sprint
bucket-wide (`sprint_patient_documents_storage_read`) — qualquer authenticated ainda pode ASSINAR uma URL se souber o
`file_path`; fechar a tabela reduz a exposição (não dá p/ enumerar `file_path`) mas o BUCKET só fecha no **WP de Storage
dedicado**. Kill switch = deny-all na tabela (nunca sprint_*). Famílias restantes: **Agenda, Storage (buckets
`progress-photos`+`patient-documents`), notificações/gamificação, legado `messages`.**

**EXECUTION_STATE (RLS-FAM6 · Agenda/Clínica) = ✅ CONCLUÍDA (aguardando auditoria).** Migrations
`20260716090000_wp05b_fam6_helpers` + `20260716091000_wp05b_fam6_agenda_clinic_rls`. **DUAS CHAVES:**
- **appointments (chave PACIENTE, AUTH-AGENDA-1):** SELECT = admin-da-clínica OU (paciente vinculado, prof comum) OU
  (prof ATRIBUÍDO lê a sua consulta); WRITE = admin OU (paciente vinculado) OU (bloco sem paciente do próprio prof) —
  **não auto-atribui a paciente não-vinculado** (mesma clínica NÃO basta). **Paciente e EXTERNO EXCLUÍDOS** (app não
  consome agenda; `notes` sensível). `patient_id`/`clinic_id` imutáveis.
- **campaigns (chave CLÍNICA):** SELECT = staff da clínica (admin+profissionais; **paciente NÃO vê**); escrita = admin.
- **calendar_connections / calendar_event_cache (chave CLÍNICA/PROF):** **SELECT-only p/ client** (dono da conexão OU
  admin); **Edge (service_role) escreve**. `calendar_event_cache` escopado ao **dono da conexão** → **fecha a porta
  lateral do Google** (quem não veria a consulta também não vê o cache do outro profissional — provado por `P2_SIDEDOOR_cache0`).
- **`calendar_connection_tokens` + `calendar_oauth_state`: deny-all mantido** (sem policy nem grant; tokens nunca ao
  client) — **NÃO tocados**.
Helpers: `is_clinic_staff`, `owns_calendar_connection`. Testes `supabase/tests/wp05b_fam6_agenda_test.sql` (suite verde:
não-vinculado⟂agenda, cache-side-door fechado, campanhas só staff, tokens inacessíveis, isolamento clínica,
reescrita patient_id/clinic_id negada, anon, IDOR). Advisors: `appointments` saiu de `rls_policy_always_true`.
Cross-repo: web escreve appointments (`appointments.ts`); NÃO escreve campaigns/calendar_* (Edge do Google usa
service_role → bypass, não quebra); app NÃO consome agenda. Storage NÃO tocado. Famílias restantes: **Storage
(buckets), notificações/gamificação (`notifications`/`patient_achievements`), catálogo `achievements`, legado `messages`.**

**EXECUTION_STATE (RLS-FAM7 · Gamificação/Notificações) = ✅ CONCLUÍDA (aguardando auditoria).** Migration
`20260717090000_wp05b_fam7_gamification_rls` (sem helper novo). **TRÊS MODELOS:**
- **`achievements` (CATÁLOGO, sem patient_id):** SELECT p/ qualquer authenticated (`achievements_catalog_read`,
  **anon negado** — fecha o catálogo anon-open que sobrava); **escrita de ninguém pelo client** (sem policy + revoke;
  só service_role/migration). Os 12 itens do catálogo (dado preservado na Fase A) intactos.
- **`patient_achievements`:** SELECT `can_access_patient_internal` (paciente dono + prof comum vinculado + admin;
  **EXTERNO EXCLUÍDO**); INSERT `is_self_patient` (**anti-forja**: só desbloqueia p/ si); **append-only** (sem UPDATE/
  DELETE; `patient_id` imutável). **DÍVIDA (não resolvida): desbloqueio é CLIENT-SIDE** (app faz `upsert` —
  `achievements.ts`), então o paciente pode inflar a própria gamificação (mesma classe do VRI/adherence da Fam2);
  idealmente engine server-side.
- **`notifications`:** SELECT/UPDATE **só o DESTINATÁRIO** (`is_self_patient`; prof/admin NÃO veem a caixa pessoal);
  UPDATE **só `read_at`** (col-priv; não edita título/corpo/tipo); INSERT/DELETE do client **negado** (emissor =
  seed/server-side; criar emissor real é dívida à parte). App só marca `read_at` (`notifications.ts`).
Testes `supabase/tests/wp05b_fam7_gamification_test.sql` (suite verde: catálogo read-only-client, forja-de-conquista
negada, notificação-alheia negada, read_at-only, isolamento, externo, anon, IDOR). **Advisors: `rls_policy_always_true`
agora VAZIO** (`notifications`/`patient_achievements` eram os últimos). Storage NÃO tocado. Famílias restantes: **apenas
o WP de Storage (buckets `progress-photos`/`patient-documents` + `storage.objects`) e o legado `messages` (aposentar, #15).**

**EXECUTION_STATE (RLS-FAM8 · legado `messages`) = ✅ CONCLUÍDA (aguardando auditoria).** Migration
`20260718090000_wp05b_fam8_drop_legacy_messages`. **VEREDITO da prova = MORTA → DROP (Caminho A):** 0 linhas,
**0 FK de terceiros**, **0 uso no web e no app** (único match = um comentário em `types/db.ts`), fora do realtime —
substituída pelo `chat_*` (Família 4). `DROP TABLE public.messages` (idempotente; guard `if exists`). Rollback no
header = recriar a tabela vazia (CREATE original do base_schema). **DÍVIDA #15 FECHADA.** Verificação: `messages` não
existe mais; tabelas public 39→38; nenhuma policy/publicação referencia `messages`; **build verde** (prova indireta de
que o web não a usava); advisors sem regressão (`rls_policy_always_true` segue VAZIO). `chat_*`/Storage/demais NÃO tocados.

**EXECUTION_STATE (WP-APP-1 · Provisionamento server-side) = ✅ CONCLUÍDA (aguardando auditoria).** Migration
`20260719090000_wp_app1_server_provisioning_rpcs` (versionada e APLICADA; ledger `20260719090000`). Paga a **DÍVIDA-APP-1**
(#28/#16/#13): sob a RLS real (Fam1/Fam3) o client NÃO insere em `profiles` (nasce via trigger) e o `save*Plan` era
DELETE+INSERT não-atômico. Três **RPCs SECURITY DEFINER** viram o **caminho de escrita CONTROLADO** — DEFINER **não é
bypass**: cada uma REVALIDA a autorização com os helpers `private.*` (as mesmas checagens que a RLS faria):
- **`create_patient(p_clinic_id, p_full_name, p_email, p_birth_date, p_sex, p_height_cm, p_goal, p_start_weight,
  p_target_weight, p_anamnese_method, p_anamnese_weight, p_anamnese_body_fat_pct, p_anamnese_notes) → uuid`** — cria
  `profiles(role='patient')`+`patients`+vínculo+`body_assessments`(opcional) **atômico**. **AUTORIZAÇÃO INTERNA:** o
  chamador tem de ser **profissional da clínica-alvo OU `is_clinic_admin`** — não cria em clínica alheia. **Anti-escalação:**
  `role` SEMPRE `'patient'` (hardcoded), `auth_user_id` **NUNCA** setado (o login liga depois via `handle_new_user`
  match-by-email), **vínculo AMARRADO ao chamador** (não se vincula a paciente de terceiro). Admin sem professional row
  não gera vínculo automático.
- **`save_workout_plan(p_patient_id, p_title, p_goal, p_workouts jsonb) → uuid`** e **`save_nutrition_plan(p_patient_id,
  p_title, p_meals jsonb) → uuid`** — **TRANSACIONAIS**: o DELETE do plano vigente + os INSERTs do novo são UMA transação
  (erro no meio ⇒ plano antigo **INTACTO**, sem plano parcial). Autorização = `private.can_prescribe_for_patient`
  (prof vinculado/admin; paciente/externo negados). `day_index`/`order_index` derivados server-side pela ordem do array.

Todas: `search_path=''`, schema-qualified, **EXECUTE só `authenticated`** (revogado de `public`/`anon`), sem caminho de
auto-promoção. **Advisor:** `authenticated_security_definer_function_executable` (0029) marca as 3 como WARN —
**intencional** (SÃO o endpoint de escrita autenticado via `/rpc`; a segurança está na revalidação interna), não é
regressão. Testes Nível 1 em `supabase/tests/wp_app1_provisioning_test.sql` (suite verde: cria-só-staff, clínica-alheia
negada, paciente-não-cria, role sempre patient + auth_user_id null, vínculo=chamador, admin sem vínculo espúrio,
**atomicidade** — payload que falha deixa o plano antigo vivo, não-vinculado/externo/paciente não prescrevem, anon não
executa). **INTEGRAÇÃO WEB (permitida — código deste repo):** `src/lib/api/patients.ts::createPatient` e
`src/lib/api/planMutations.ts::saveWorkoutPlan/saveNutritionPlan` passam a chamar `supabase.rpc(...)` em vez do
INSERT/DELETE direto; `professionalId` do input não é mais enviado (servidor deriva o autor/vínculo do chamador —
anti-forja). Gates verdes (typecheck/lint/build). **Cross-repo:** app **NÃO** afetado — nunca chamou esses fluxos (grep
read-only confirma: no app, `workout_plans`/`nutrition_plans`/`patients`/`profiles` são **SELECT**; os únicos INSERTs são
`chat_*`). **E2E real depende do Google OAuth configurado (passo do dono)** — provado em Nível 1 (harness); E2E real
**não forjado**. **KILL SWITCH:** `drop function` das 3 RPCs volta ao estado anterior — mas esse estado é o fluxo QUEBRADO
sob RLS, então o rollback REAL reverte **também** a integração do web (voltar aos INSERT/DELETE diretos). RLS **NÃO**
afrouxada (nenhuma policy nova; `profiles` segue sem INSERT de client). Header da migration documenta tudo.

**As 3 RPCs são CONTRATO OFICIAL de escrita** (parte deste documento): a web escreve paciente/planos SÓ por elas; o app
não escreve nessas tabelas. Assinaturas verbatim acima — **não renomear parâmetros sem alinhar aqui**.

**EXECUTION_STATE (WP-ONBOARDING · Criação da própria clínica) = ✅ CONCLUÍDA (BANCO + WEB; PR sem merge; NÃO aplicado).**
Migration `20260801090000_wp_onboarding_create_clinic` (ledger `20260801090000`; **NÃO aplicada** — dry-run em ROLLBACK).
Fecha o vazio "não havia caminho para a PRIMEIRA clínica". **RPC oficial de onboarding `create_clinic_with_owner(p_name text)
→ jsonb{clinic_id, professional_id}`** (SECURITY DEFINER, `search_path=''`, EXECUTE só `authenticated`, revoke public/anon):
(1) autor SEMPRE do servidor (`private.current_profile_id()`←`auth.uid()`; **não forjável** — sem parâmetro de owner);
(2) **guarda-corpo: UMA clínica por perfil COMO DONO** (recusa a 2ª, hint `ALREADY_OWNS_CLINIC`); (3) valida nome
(obrigatório; **2..120**); (4) cria `clinics(name, owner_profile_id=chamador)`; (5) cria `professionals(profile_id=chamador,
clinic_id, type='other', clinic_role='admin')` — mínimos coerentes; (6) destrava o perfil (`role='professional',
status='active'`) — **COSMÉTICO**: autoridade segue posse/clinic_role (`is_clinic_admin` não lê `profiles.role`, AUTH-ADMIN-1);
(7) **transacional tudo-ou-nada**. **PORTÃO COMERCIAL** (código de ativação/plano/aprovação da Vertexa) = decisão FUTURA:
**NÃO implementado**, com **UM ÚNICO ponto de encaixe COMENTADO** na função (após a auth, antes de qualquer escrita) — ao ligar,
lança `ONBOARDING_NOT_ALLOWED` e nada mais na UI muda (trata por `hint`). **Web:** `PendingAccessPage` com 2 caminhos
(criar a própria clínica → vira admin na hora; ou aguardar o cadastro por uma clínica). `CreateClinicForm` → `useCreateOwnClinic`
→ RPC → invalida identidade (`profileByAuthUser`/`currentProfessional`/`clinicAdmin`). Erros por `hint`
(`src/lib/domain/clinicOnboarding.ts`); só o inesperado ao Sentry (`source:"onboarding"`, sem PII). **Nenhuma policy existente
alterada; nenhuma tabela nova** (policies 116, hash inalterado). **KILL SWITCH:** `revoke execute … from authenticated`
desativa a criação (fail-closed). Assinatura verbatim — **não renomear sem alinhar aqui**.

**EXECUTION_STATE (WP-STORAGE-P1 · Arquivo físico/buckets) = ✅ PARTE 1 (BANCO) CONCLUÍDA (aguardando auditoria;
Parte 2 cross-repo PENDENTE).** Migration `20260720090000_wp_storage2_p1_storage_objects_rls` (versionada e APLICADA;
ledger `WP-STORAGE-P1`). **CONTRATO DE PATH (oficial, parte deste documento):** o storage key dos DOIS buckets é
**`{patient_id}/{arquivo}`** — a 1ª pasta É o `patient_id`. Já era o padrão dos dois writers (app `photos.ts` e web
`documents.ts`, ambos `${patientId}/${Date.now()}.ext`) — **sem gap** p/ objetos novos; únicos fora do padrão = 2
objetos-demo órfãos `demo/mariana/*.png` (sem linha de metadado; ficam INACESSÍVEIS a todo papel; remoção via Storage
API = owner-check). Extração do `patient_id` via helper novo **`private.storage_object_patient(name)`** (parser puro
NULL-safe: exige pasta + uuid válido, senão NULL ⇒ todo helper nega — sem cast error no legado). **`progress-photos`
virou PRIVADO (`public=false`)** — URL pública morta (provado: HTTP 400 "Bucket not found"). Policies por
bucket+comando (todas `TO authenticated`; **anon: zero policy** — as sprint davam até a anon):
- **fotos:** SELECT `can_access_patient` (**EXTERNO INCLUÍDO — ESPELHA a TABELA `progress_photos` (Fam2)**; divergir
  deixaria o externo vendo a linha sem o arquivo; se o dono reclassificar foto corporal como clínico, trocar nos DOIS
  lados — decisão REPORTADA); INSERT só o paciente na PRÓPRIA pasta; UPDATE/DELETE negados (sem fluxo; upsert:false).
- **documentos:** SELECT `can_access_patient_internal` (**EXTERNO EXCLUÍDO**, AUTH-EXT-1/Fam5 — **assinar URL agora
  exige vínculo real**); INSERT/DELETE `can_prescribe_for_patient` (DELETE habilita a limpeza de órfão de
  `documents.ts`); UPDATE negado (mover objeto = UPDATE de name — negado).
As 3 `sprint_*` bucket-wide **ELIMINADAS** (drop só após dry-run verde). Testes
`supabase/tests/wp_storage2_p1_storage_objects_test.sql` (verde pré-drop em transação E pós-apply: IDOR de path,
não-vinculado, isolamento de clínica, externo⟂docs e foto-sim, INSERT em pasta alheia negado, mover negado, anon⟂tudo,
demo invisível até p/ admin). Nota de plataforma: trigger `protect_objects_delete` (statement-level) bloqueia DELETE
via SQL direto; o Storage API seta `storage.allow_delete_query=true` sozinho — o teste seta o GUC p/ exercitar a RLS
real. Advisors: **zero apontamento de storage**. **JANELA POR DESIGN (sem dado real): exibição de fotos QUEBRADA até
a Parte 2** — o app grava/lê **URL PÚBLICA** em `progress_photos.photo_url` (e `pdf/images.ts` do web consome essa
URL); a Parte 2 migra app+web p/ **path relativo + `createSignedUrl`** (padrão de `documents.ts`). Kill switch
fail-closed = deny-all em `storage.objects`; **NUNCA `public=true` de volta, JAMAIS recriar sprint_***. Gates web
verdes (tsc/lint/build).

---

## 🏁 FECHAMENTO DA FASE B (BANCO) — 8 FAMÍLIAS

Toda tabela de DADOS do schema `public` agora tem **RLS real por papel/clínica/vínculo/participação** (ou foi
aposentada). Helpers de autorização vivem em `private` (SECURITY DEFINER, `search_path=''`, execute só `authenticated`,
fora da Data API). anon negado em tudo; `service_role` mantém bypass (Edge Functions).

| # | Família | Tabelas | Chave |
|---|---|---|---|
| 1 | Identidade | profiles, professionals, patients, professional_patient_links, clinics | papel/posse/vínculo |
| 2 | Comportamento | weight_logs, activity_events/sessions, meal_logs, supplement_intakes, muscle_recovery_states, adherence_snapshots, workout_session_logs, workout_set_logs, progress_photos(tabela), body_assessments | paciente (self-write) |
| 3 | Prescrição | workout_plans, workouts, workout_exercises, nutrition_plans, meals, supplements | prof prescreve, paciente lê |
| 4 | Chat | chat_channels, chat_participants, chat_messages, chat_mentions | participação (realtime) |
| 5 | Documentos | patient_documents (só a tabela) | clínico (externo excluído) |
| 6 | Agenda/Clínica | appointments, campaigns, calendar_connections, calendar_event_cache | paciente + clínica |
| 7 | Gamificação/Notif | achievements(catálogo), patient_achievements, notifications | 3 modelos |
| 8 | Legado | messages | **DROP** (morta) |

**`sprint_*` remanescentes = 3, APENAS em `storage.objects`** (nenhuma tabela de dados). `calendar_connection_tokens`/
`calendar_oauth_state`/`schema_migration_log`/`auth_trigger_events` = deny-all intencional.
**FALTA PARA O RELEASE GATE: o WP de STORAGE** (`storage.objects`: bucket `progress-photos` público→privado com
path+signed URL; bucket `patient-documents` bucket-wide → fechar por pasta=patient_id).

**DÍVIDAS CONSOLIDADAS EM ABERTO (para o dono):**
- **STORAGE-2** — buckets `progress-photos` (público) e `patient-documents` (bucket-wide) ainda em `sprint_*` (WP dedicado).
- **RLS-2 (métricas client-side)** — VRI/`adherence_snapshots`, `muscle_recovery_states` e `patient_achievements` são
  gravados/desbloqueados pelo paciente no client → inflável; mover p/ engine server-side.
- ~~**APP-1** — web `createPatient` (insere `profiles` direto, negado pela RLS de identidade) e `save*Plan` DELETE+INSERT
  não-transacional → mover p/ provisionamento/RPC server-side (PENDENCIAS #28/#16).~~ **✅ RESOLVIDO (WP-APP-1):** RPCs
  SECURITY DEFINER `create_patient`/`save_workout_plan`/`save_nutrition_plan` (transacionais, autorização interna
  `private.*`) + integração do web. Ver EXECUTION_STATE (WP-APP-1) acima. Resta só o E2E real (owner: configurar OAuth).
- **AUTH-4 (promoção)** — promover `pending`→`professional` exige mecanismo confiável server-side (não default).
- **AUTH-#22** — cifrar `refresh_token` do Google em repouso (`calendar_connection_tokens`).
- **Owner-checks** — `Settings > API` expor só `public`(+`graphql_public`), `private` FORA; remover 2 objetos demo
  `demo/mariana/*.png` via Storage API.

**Consequência no app web — ✅ RESOLVIDA em WP-APP-1:** `createPatient` (`src/lib/api/patients.ts`) e
`saveWorkoutPlan`/`saveNutritionPlan` (`src/lib/api/planMutations.ts`) já **NÃO** escrevem direto — chamam as RPCs
SECURITY DEFINER `create_patient`/`save_workout_plan`/`save_nutrition_plan` (provisionamento server-side transacional,
autorização revalidada; ver EXECUTION_STATE acima). O fluxo de cadastro/prescrição volta a funcionar sob a RLS real.

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

## Disciplinas por profissional (WP-DISC-A) — contrato de escrita
**Modelo (fonte de verdade no banco), migration `20260725090000`:**
- `disciplines(code PK, label, is_clinical)` — lista canônica: `medico`, `nutricionista`, `fisioterapeuta`, `educador_fisico`, `psicologo`, `outro`.
- `professional_disciplines(professional_id → professionals ON DELETE CASCADE, discipline → disciplines.code, granted_by, created_at, PK(professional_id, discipline))` — **1:N** (um profissional pode ter N disciplinas; **sem** constraint/enum/coluna única que impeça múltiplas).
- `professionals.type` **mantido** por compatibilidade (dívida; a **disciplina** é a nova fonte de autorização de escrita).

**Semântica de autorização (LEI): UNIÃO / OU.** Pode ESCREVER numa tabela se o profissional possuir **QUALQUER** disciplina exigida por ela. Acumular disciplinas **sempre amplia, nunca restringe**. Helper `private.can_write_discipline(p_patient, p_disciplines text[])` = `can_prescribe_for_patient(p_patient)` (vínculo ativo **não-externo** OU admin) **E** posse de alguma disciplina do conjunto pelo profissional do chamador na clínica do paciente.

**Mapa disciplina → escrita:**
| Tabela(s) | Disciplina exigida (OU) |
|---|---|
| `nutrition_plans`, `meals`, `supplements` | `nutricionista` |
| `workout_plans`, `workouts`, `workout_exercises` | `educador_fisico` OU `fisioterapeuta` |
| `body_assessments` | `nutricionista` OU `educador_fisico` OU `fisioterapeuta` OU `medico` |
| `patient_documents`, `appointments` | **não escopado** (mantêm a regra anterior — `can_prescribe`/administrativo) |

- **Leitura (DISC-2):** integrada — qualquer profissional vinculado lê tudo. As policies de **SELECT NÃO foram tocadas**.
- **Atribuição:** SÓ admin da clínica **do profissional-ALVO** via `assign_professional_discipline` / `revoke_professional_discipline` (SECDEF, individual, idempotente). **WP-DISC-FIX (migration `20260802090000`): o admin PODE conceder/revogar a SI MESMO** — a trava de auto-atribuição foi removida porque travava a clínica solo (o dono nasce sem disciplina e não há outra pessoa para conceder); não é escalada (o admin já promove pessoas e já concede a terceiros). **Segue negado:** não-admin (a si ou a terceiros) e admin em clínica alheia. O client (`anon`/`authenticated`) não escreve nas 2 tabelas novas (RLS: só SELECT — o próprio profissional ou staff/admin da clínica leem).
- **RPCs SECDEF:** `save_workout_plan` e `save_nutrition_plan` **revalidam** a disciplina internamente (senão seriam porta lateral que ignora a policy).
- **Exceção:** a anamnese (`body_assessment`) criada dentro de `create_patient` é **administrativa** (SECDEF, não passa pela policy) — **não** é bloqueada por disciplina (staff/admin sem disciplina segue cadastrando).
- **Mudança de comportamento:** admin **sem** disciplina clínica **perde** a escrita de `body_assessments` (antes tinha) — DISC-ADMIN-1, intencional. **Lacuna:** `medico` só escreve `body_assessments` (o sistema não tem superfície de prescrição médica/medicamento — decisão de produto).
- **Onde o mapa vive:** em CÓDIGO (constante de disciplina por policy/RPC). Porta aberta para "personalizável por clínica" no futuro (tabela de config) **sem** mudar a forma das policies.

## Exportação de relatório de UM paciente (WP-REPORT A) — contrato oficial
A ÚNICA forma de obter o **pacote agregado** de um paciente é a RPC (autoriza + audita + retorna); não há caminho paralelo.

**RPC** `public.export_patient_report(p_patient_id uuid, p_from date, p_to date, p_sections text[], p_surface text default 'web') → jsonb`
— SECURITY DEFINER, `search_path=''`, VOLATILE, EXECUTE só `authenticated`.
- **Autorização:** `private.can_prescribe_for_patient(p_patient_id)` = profissional **vinculado não-externo** OU **admin da clínica**. Externo/paciente/não-vinculado/outra-clínica ⇒ **42501** (transação desfeita: nada gravado, nada retornado). **Paciente NÃO exporta.**
- **Validação:** `p_from ≤ p_to`, janela **≤ 366 dias**; `p_sections` contra **lista fixa** (`identity, weight, anthropometry, workout_plan, nutrition_plan, supplements, adherence, recovery, workout_execution, documents, appointments, photos, achievements, timeline`) — nome desconhecido ⇒ erro. `p_sections` vazio/`null` ⇒ default `{identity,weight,anthropometry}`.
- **Retorno:** `{ meta:{patient_id,from,to,sections,record_count,truncated,generated_at,exported_by}, patient:{…}, sections:{…} }`. **Tetos por seção** (weight 1000; séries 500; docs 200; fotos 24) ⇒ quando excede, trunca e marca `truncated:true` (o PDF exibe aviso).
- **Fotos/documentos:** só **metadado** (`storage_path`/`file_path`); o binário sai por **URL assinada gerada no cliente** (bucket privado). **Chat excluído** do relatório.

**Trilha** `public.report_exports` (auditoria, **sem conteúdo clínico**): `exported_by_profile_id, patient_id, clinic_id, exported_at, period_from, period_to, sections[], record_count, surface`.
- **Gravação:** SÓ pela RPC (definer). **RLS SELECT** = `is_clinic_admin(clinic_id)` OU autor (`exported_by_profile_id = current_profile_id()`); **UPDATE/DELETE negados a todos os clientes** (imutável); anon sem acesso.
- **Kill switch:** `revoke execute on function public.export_patient_report(...) from authenticated` desativa a exportação sem afetar o resto.

### Exportação multi-paciente + auditoria (WP-REPORT B)
- **`export_patient_report` ganhou `p_batch_id uuid default null`** (6º parâmetro). A versão de 5 args foi removida; chamadas de 1 paciente continuam válidas (default null). **Autorização inalterada** (`can_prescribe_for_patient`).
- **Lote = N chamadas da MESMA RPC** (1 por paciente, mesmo `batch_id` gerado no cliente): cada paciente gera 1 linha na trilha e é autorizado individualmente. **Nenhuma função de agregação nova.** Falha parcial (ex.: 42501 por vínculo removido) NÃO aborta o lote. Teto: 50 pacientes/lote. `report_exports.batch_id` (anulável) agrupa as linhas do lote.
- **Leitura da trilha (auditoria):** `report_exports` via PostgREST com joins (author=profiles, patient=patients→profiles). A **RLS** já escopa: admin da clínica vê as da clínica; autor vê as próprias; terceiros ⟂. A tela `/configuracoes/auditoria` (admin-only, `am_i_clinic_admin`) lista quem/paciente/quando/período/seções/registros/lote — **sem conteúdo clínico**.

### Jornada do paciente / kanban (WP-KANBAN A) — modelo de banco
- **`journey_columns`**(clinic_id, name, position, color, is_initial) — colunas do quadro POR CLÍNICA; **1 inicial/clínica** (índice único parcial). Clínica nova nasce com o padrão (trigger); admin administra (CRUD direto, policy `is_clinic_admin`); todos os membros leem (`is_clinic_member`). Semear padrão: "Novos"/"Em acompanhamento"/"Retorno"/"Concluídos".
- **`patient_journey_state`**(patient_id PK, column_id, moved_at, moved_by_profile_id) — coluna ATUAL do paciente (1 linha). **Paciente sem linha ⇒ derivado para a coluna `is_initial`** da clínica.
- **`patient_journey_moves`**(patient_id, from_column_id, to_column_id, moved_by_profile_id, moved_at) — histórico **append-only** (imutável).
- **`journey_milestone_ack`**(patient_id, milestone_key, acked_by_profile_id, acked_at; unique(patient_id,milestone_key)) — RECONHECIMENTO de marco. Marcos são **DERIVADOS** de `patients.start_date`/`birth_date` (não materializados); só o ack é gravado. Chaves canônicas: `start`, `birthday:<ano>`, `day_<offset>` com offset em `private.journey_day_offsets()` ({30,60,90}, extensível). Janela de alerta (client): 7 dias. **Marco é informação — não move cartão.**
- **RPCs (SECURITY DEFINER, EXECUTE só authenticated; moved_by/acked_by do SERVIDOR):**
  - `public.move_patient_journey(p_patient_id uuid, p_to_column_id uuid) → jsonb` — autz `is_clinic_admin OR is_common_professional_of_patient` (**externo NÃO move**); coluna destino tem de ser da mesma clínica; grava estado + histórico atômicos.
  - `public.ack_journey_milestone(p_patient_id uuid, p_milestone_key text) → jsonb` — mesma autz; valida a chave canônica; idempotente.
- **`create_patient`** ganhou `p_start_date date default null` (K1): null ⇒ CURRENT_DATE; **recusa data futura**. Chamada sem o parâmetro é idêntica à anterior.

## WP-ARTE · A — Consentimento de MÍDIA por peça e por versão (SÓ BANCO; em PR sem merge; NÃO aplicado)

Modelo que torna **IMPOSSÍVEL usar uma peça sem consentimento ATIVO** — a checagem vive no banco (função canônica), não na interface. Consentimento é **por PEÇA e por VERSÃO** (nunca genérico). Escrita de estado **só por RPC SECURITY DEFINER** com autor derivado do servidor (anti-forja). **Nenhuma policy existente alterada.**

**Tabelas (public):** `media_channels` (canais, extensível sem migration — seed: instagram/site/whatsapp/tela_interna/impresso/anuncio_pago); `media_pieces`→`media_piece_versions` (imutável; qualquer alteração relevante de PEÇA gera nova versão) →`media_piece_version_professionals`; `media_consent_terms` (texto imutável por versão); `media_consents` (amarrado à `piece_version_id`; `origin` app|in_person com CHECK dos campos presenciais; `status` pending|authorized|change_requested|refused|revoked|expired; `expires_at`=concessão+12m) →`media_consent_channels`.

**Contrato de escrita (RPCs oficiais — não renomear params sem alinhar aqui):**
| Ação | RPC | Quem chama |
|---|---|---|
| Criar peça+versão 1 | `media_piece_create(...)` | **WEB** (staff interno vinculado/admin) |
| Nova versão (D1) | `media_piece_new_version(...)` | **WEB** (staff) |
| **Conceder no app** | `media_consent_grant_app(version, channels[], term, purpose, sponsored)` | **APP** (o PACIENTE dono — autor do servidor) |
| Registrar presencial | `media_consent_record_in_person(version, channels[], term, method, obtained_at, proof_path, ...)` | **WEB** (staff; exceção presencial) |
| **Revogar** | `media_consent_revoke(consent, reason?)` | **APP** (só o PACIENTE, sozinho, sem justificativa) |
| Pode usar? (canônica) | `media_use_check(version, channel)` → `{usable, reason, expires_at}` | WEB/APP (todo USO passa por ela) |
| Vencendo em N dias | `media_consents_expiring(N)` | WEB (alertas da clínica — etapa D) |

**Regras (lei do cliente + orquestrador):** consentimento por peça+versão+canais selecionados+clínica/profissionais; validade 12m OU até revogação; revogação bloqueia download/edição/duplicação/republicação e tira da biblioteca (derivado da função canônica); auditoria preservada e **NUNCA reutilizável como ativa**. **D1** peça muda ⇒ nova versão+consentimento / uso muda (canal/pago/finalidade) ⇒ novo consentimento na MESMA versão. **D3** três fronteiras: GERIR (staff vê/cria sem consent) · DECIDIR (paciente vê a própria peça p/ consentir — ver ≠ usar) · USAR (baixar/publicar exige consent ativo p/ o canal). **D4** menor OU `birth_date` nula ⇒ concessão NEGADA (requer modelo de responsável legal — etapa C). **D6** link assinado publicável = **300s**; limitação (link já emitido não é revogável, só expira) consta no termo.

**Cross-repo:** quando implementado, o **app** concede/revoga consentimento (RPCs acima, identidade do próprio paciente amarrada pelo servidor); a **web** cria peças/versões e registra presencial; **externo NÃO acessa**. app/patient-native NÃO tocados nesta fase (só banco).

---

## Entrada de profissional na clínica — fluxo de JOIN (WP-JOIN-1)

**A direção do fluxo é o contrato.** O admin **nunca** descobre um profile pendente: quem pede é o
profissional, apresentando o **código da clínica**. Consequência de desenho: o pedido já nasce com
`clinic_id`, então a leitura pelo admin é RLS trivial — sem consulta global, sem oráculo de
enumeração de e-mail, sem depender de envio de e-mail.

**Por que não pode ser o contrário:** `private.can_see_profile()` é FALSA para um profile
`status='pending'` (os 4 ramos exigem ser o próprio, um paciente acessível, ou alguém que já tenha
linha em `professionals`). O pendente é invisível até para um `SELECT` do admin — qualquer desenho
em que o admin "procura" a pessoa exigiria afrouxar esse helper, que é load-bearing em toda a RLS.

| Passo | Quem | Superfície |
|---|---|---|
| Compartilha o código (`clinics.join_code`, 8 chars base32 sem `O/0/I/1`) | admin | WEB — Configurações → Clínica |
| Solicita acesso: `request_clinic_access(p_join_code)` | profissional `pending` | WEB — tela de acesso pendente (campo ou link `?code=`) |
| Vê a fila da própria clínica (`clinic_join_requests`, RLS) | admin | WEB — indicador no v1; tela de aprovação = WP-2 |
| Aprova: `approve_join_request(p_request_id)` → chama `promote_to_professional` | admin | WEB (WP-2) |
| Rejeita: `reject_join_request(p_request_id)` | admin | WEB (WP-2) |
| Troca o código: `rotate_clinic_join_code(p_clinic_id)` | admin | WEB — Configurações → Clínica |

**Invariantes.** Autor do pedido SEMPRE derivado do servidor (`private.current_profile_id()`), nunca
parâmetro do client. Escrita nas duas tabelas só por RPC `SECURITY DEFINER` — não há policy de
INSERT/UPDATE/DELETE. `promote_to_professional` é **reusada sem alteração**. `handle_new_user`,
`can_see_profile` e `is_clinic_admin` **não são tocados**.

**`join_code` NÃO é segredo.** A segurança está na aprovação explícita do admin. Adivinhar um código
gera ruído (um pedido pendente), nunca privilégio. Código vazado ⇒ `rotate_clinic_join_code`.

**Erro neutro por desenho:** código inexistente devolve `P0002` com mensagem que **não afirma nada
sobre a clínica existir**. Se dissesse "clínica não encontrada", a tela viraria um oráculo de
enumeração de códigos.

**Degrau para o convite por e-mail (WP futuro):** o convite não substitui este fluxo — ele apenas
**pré-cria um `clinic_join_request` já aprovado** para o e-mail convidado e reusa a mesma tabela, as
mesmas policies e a mesma tela. Nada aqui é trabalho descartável.

**Cross-repo:** fluxo exclusivo da **web** (superfície profissional). `app`/`patient-native` NÃO
participam e NÃO foram tocados.

---

## WP-CHAT-FIX — criação de canal, leitura por vínculo vivo e escrita por roster (2026-07-28)

> **Regra de ouro:** a **web** é a única superfície que **cria** canal. O **app do paciente só
> abre canal que já existe** (`getMyChannel` é SELECT puro) — por isso o app **não** precisa
> chamar a RPC e **não** foi tocado neste PR.

### Criação/obtenção do canal — SEMPRE por RPC
`public.get_or_create_channel(p_patient_id uuid) → uuid` (SECURITY DEFINER, `search_path=''`,
EXECUTE só `authenticated`).

- **Nunca** faça `INSERT…RETURNING` em `chat_channels` no client. Falha com **42501** — não por
  recursão de policy, mas por **visibilidade de snapshot**: na mesma statement a policy de SELECT
  chama `private.channel_patient()`, que é `STABLE` e não enxerga a linha que a própria statement
  está inserindo.
- Autorização: `private.can_access_patient_internal(p_patient_id)` — o **mesmo** predicado do
  `WITH CHECK` de `chat_channels_insert`. Sem acesso ⇒ `42501`. Zero superfície nova.
- **Idempotente** pelo `UNIQUE (patient_id)`: chamar duas vezes devolve o mesmo `id`.
- Efeito colateral **desejado**: cada chamada **reconcilia o roster** (`chat_participants`) —
  adiciona os profissionais com vínculo **ativo e não-externo**, e remove linhas
  `role='professional'` de quem **perdeu** o vínculo. Linhas `patient` e `admin` não são tocadas.

### LEITURA — derivada do vínculo ATUAL (viva)
`private.can_read_channel(p_channel)` =
`is_channel_participant(p_channel) OR can_access_patient_internal(channel_patient(p_channel))`.

Governa 4 policies de SELECT: `chat_channels`, `chat_messages`, `chat_participants`, `chat_mentions`.

| Quem | Lê? | Por quê |
|---|---|---|
| Paciente dono do canal | **sim** | `is_self_patient` |
| Profissional com vínculo **ativo, não-externo** | **sim, na hora** | `is_common_professional_of_patient` — derivado do vínculo, **sem precisar reabrir o canal** |
| Admin da clínica da paciente | **sim** | `is_clinic_admin` (oversight; já valia antes) |
| Profissional **externo** (`is_external = true`) | **não** | filtro que já existe em `is_common_professional_of_patient` |
| Vínculo `status ≠ 'active'` | **não** | idem — é isto que dá "perdeu o vínculo, perdeu o chat" |
| Não vinculado / outra clínica / anon | **não** | nenhum ramo o alcança |

### ESCRITA — continua exigindo estar no roster
`chat_messages_insert` **não foi alterada**: exige `is_channel_participant` **e**
`sender_profile_id = current_profile_id()` (anti-forja). Consequência **deliberada**:

> Quem acabou de ser vinculado **lê imediatamente**, mas só **escreve** depois que a conversa for
> aberta pela RPC (que o coloca no roster). Assimetria aprovada: leitura viva, escrita por roster.

E o inverso: quem perdeu o vínculo **para de ler na hora** se não estava no roster; se estava,
perde leitura **e** escrita na próxima abertura do canal, quando a RPC reconcilia.

### `chat_participants` continua sendo o roster — não foi abolido
Além de ser o gate de escrita, é a fonte do **seletor de @menção do app do paciente**
(`listChannelProfessionals` filtra `role='professional'`). Um desenho "derivar tudo e não manter
linhas" **esvaziaria esse seletor** — por isso o roster é **reconciliado**, não removido.

### Erro no client — distinguir as duas etapas
`getChatThread` lança `ChatThreadError` com `stage`:

| `stage` | Significado | Mensagem na tela |
|---|---|---|
| `"channel"` | não abriu/criou a conversa | "Não foi possível abrir a conversa" |
| `"messages"` | conversa OK, histórico não veio | "Não foi possível carregar as mensagens" |

Use `chatStageOf(error)`. Sentry: `source:"chat"`, scope `open-channel` / `load-messages`,
**sem PII** (nunca conteúdo de mensagem, nome ou id de paciente).

## Estado do PROFISSIONAL na clínica (WP-TEAM-2b-ii — migration 20260808090000, em PR SEM MERGE)

⚠️ **Nada aqui está aplicado em produção ainda.** O contrato fica registrado porque muda a
superfície de RPC que os dois repos veem.

- **`deactivate_professional(p_professional_id uuid, p_reason text default null) → uuid`** —
  desativa a PESSOA na clínica. **Admin da clínica DAQUELE profissional**; qualquer outro `42501`.
  Recusa o **DONO** (`42501`, hint `OWNER_CANNOT_BE_DEACTIVATED` — transferir a posse antes) e a
  **autodesativação** (`42501`, hint `SELF_DEACTIVATION_NOT_ALLOWED`). Grava trilha imutável em
  `professional_status_events` com autor do SERVIDOR. **Cascateia**: todos os vínculos ativos caem
  na MESMA transação, com `reason` prefixado por `[DESATIVACAO_DO_PROFISSIONAL]` na trilha do
  vínculo, e o profissional sai do roster do chat. **Idempotente** (desativar 2x não erra e não
  duplica trilha).
- **`reactivate_professional(p_professional_id uuid, p_reason text default null) → uuid`** —
  simétrica na autorização e na trilha, com **assimetria deliberada: NÃO religa vínculo nenhum**.
  Quem volta, volta sem carteira de pacientes; cada vínculo se reconquista por
  `reactivate_patient_link`. A ESCRITA no chat só volta quando a conversa for reaberta por
  `get_or_create_channel` (assimetria herdada do 2b-i).
- **`my_clinic_memberships() → TABLE(clinic_id uuid, clinic_name text, status text)`** — caminho
  ESTREITO para a interface explicar uma desativação. **Sem parâmetro**: devolve só as linhas do
  PRÓPRIO chamador. **Nunca** `join_code`, **nunca** `owner_profile_id`, nunca dado de terceiro.
  Fail-closed: sem profile resolvido devolve **vazio** (não erro). `anon` ⇒ `42501`.
  Existe porque o desativado deixa de ler `public.clinics` (o registro inteiro incluía o
  `join_code`, credencial de entrada).
- **`channel_professionals(p_channel_id uuid, p_include_message_authors boolean default false)`** —
  a assinatura de 1 argumento **deixa de existir**; a chamada de hoje (`{p_channel_id}`) continua
  válida e cai no default. Com `false`, resultado **idêntico** ao anterior (provado em 7 canais
  reais). Com `true`, inclui também os AUTORES de mensagens do canal que são profissionais da
  clínica, para o nome do histórico não desaparecer quando alguém sai do roster. **Não filtra
  status de propósito** (identidade preservada). O opt-in do frontend é WP seguinte.
- **`promote_to_professional(...)`** — passa a **RECUSAR** profile com cadastro `inactive` naquela
  clínica: `22023`, hint `PROFESSIONAL_INACTIVE`. Consequência: `approve_join_request` **falha** e
  a solicitação **permanece `pending`** (antes retornava a linha desativada e marcava "approved",
  ou seja, aprovava sem devolver acesso). Linha existente **ATIVA**: dedup inalterado.
- **Cross-repo:** `vertexa-app-paciente` e `vertexa-patient-native` **não** chamam nenhuma dessas
  RPCs. ⚠️ Mas há um efeito de leitura no app da paciente: ver **DÍVIDA-2bii-4** em
  `docs/PENDENCIAS.md` — com o vínculo desativado, a paciente deixa de ler o `profiles` (o nome) do
  profissional pelo ramo R4 de `private.can_see_profile`, que este WP **não** tocou.
- **Advisor `authenticated_security_definer_function_executable` (0029): 29 → 32.** As 3 novas são
  intencionais, pelo mesmo motivo das RPCs do APP-1: SÃO o endpoint autenticado, e a segurança está
  na revalidação interna (`is_clinic_admin`) e, no caso da `my_clinic_memberships`, na ausência de
  parâmetro + `WHERE` no autor.
