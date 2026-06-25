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
- Projeto Supabase: `jlwbagkmpzbvasrsdroo` ("Vertexa").
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
| `muscle_recovery_states` | **escreve** (provisório, 4c-2) | **lê** (BodyMap/Recuperação) | — |
| `adherence_snapshots` | **escreve** (VRI, 4c-2b) | **lê** (VRI) | — |
| `workout_plans` / `workouts` / `workout_exercises` / `nutrition_plans` / `meals` | lê (4c-3, futuro) | **escreve** (editores) | — |
| `messages` (legada) | — | — (repontado) | — |

Colunas-chave (verbatim do schema; **não renomear sem alinhar aqui**):
- `chat_messages(id, channel_id, sender_profile_id, sender_role, body, created_at)` — **sem** `sender_professional_id`.
- `chat_mentions(id, message_id, mentioned_profile_id, read_at)` — `read_at IS NULL` = não lida (badge).
- `activity_events(id, patient_id, type, payload jsonb, created_at)` — `patient_id` = `patients.id`.
- `weight_logs(id, patient_id, weight_kg numeric, measured_at timestamptz, source text, created_at)` — `patient_id` = `patients.id`. **NÃO renomear `weight_kg`/`measured_at`.**
- `progress_photos(id, patient_id, photo_url text, captured_in_app bool, taken_at timestamptz)`.

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
  sem signed URL). **Dívida Sessão 8 (BLOQUEANTE p/ paciente real — foto corporal = dado de saúde/LGPD):**
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
- **GIFs** de exercício do app vêm de terceiros (fitnessprogramer.com) — licenciar antes de publicar.

## Provisórios (combinados temporários — trocar quando indicado)
- **`adherence_snapshots`**: o app **escreve** o VRI (4c-2b, policy `sprint_adherence_write`); a web só
  **lê**. OK p/ demo. ✅
- **GIFs de exercício**: resolvidos por **fallback de nome** (`workout_exercises.name` → catálogo de
  terceiros) **até a web preencher `gif_url`**. PROVISÓRIO (ver licenciamento na pendência de GIFs acima).
- **Aquecimento**: **estático** (hardcoded no app) **até existir tabela própria**. PROVISÓRIO.

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

**App (`vertexa-app-paciente`):**
- 4a — fundação (client Supabase + camada api) ✅ (`74806f2`)
- 4b — chat real (`TeamChat` sobre `chat_*` + @ + realtime) ✅ (`624e3b8`)
- 4c-1 — sink de eventos → `activity_events` ✅ (`ecba42f`)
- 4c-2 — recuperação muscular (provisória) ⏳ PENDENTE
- 4c-2b — VRI → `adherence_snapshots` ✅ (write `sprint_adherence_write`)
- 4c-3 — ler plano/treino reais (HomePage/Profile → "Mariana") ⏳ pendente
- **Sessão 2 — fluxos do paciente fora do mock (pendência #16): ✅** PESO real (`weight_logs`),
  FOTO real (bucket `progress-photos` + `progress_photos`), ÁGUA `payload.liters` (incrementos/soma do dia),
  pendências da Home derivadas de dados reais, treino do `Records` com `workoutId` real (recuperação + VRI),
  VRI de dados reais (engine lê `activity_events`; Home lê o último snapshot → consistente web↔app),
  anti-crash (boot tolerante a env + `ErrorBoundary`). Mariana reconciliada **88/alta**.
  Migration aditiva `20260625170000` (INSERT em `progress_photos`).

**Banco:**
- `chat_*` + realtime ✅ · read policies ✅ · write policies sprint versionadas ✅
  (`20260618130000` activity/muscle/plan + `20260618140000` adherence)

**Teste ponta a ponta (4d):** ⏳ pendente — app `@Camila` → badge ao vivo na web + bater ponto → Timeline/recuperação.
