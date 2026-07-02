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
- **Migrations = fonte única no repo web** (`vertexa-web-pro/supabase/migrations`). Toda policy aplicada
  via MCP DEVE virar arquivo de migration aqui — **todas** as policies de escrita sprint já versionadas.
- **#11–#14 (BLOQUEANTE p/ dado real):** trocar tudo isso por RLS por papel/clínica/vínculo. Tabelas a
  travar: `chat_*`, `activity_events`, `muscle_recovery_states`, `adherence_snapshots`, planos, etc.
  O realtime (`postgres_changes`) respeita as policies → fechar a RLS também fecha o que vaza ao vivo.

## Pendências cross-repo
- **#1** esquema de recuperação muscular (provisório `recovered/weakened`; confirmar c/ Juliana).
- **#3** pesos do VRI (provisórios; web só lê snapshots). Mariana ≈ score **88 / alta** — não contradizer.
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

**Teste ponta a ponta (4d):** ⏳ pendente — app `@Camila` → badge ao vivo na web + bater ponto → Timeline/recuperação.
