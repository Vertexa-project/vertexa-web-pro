# EXECUTION_STATE — VERTEXA Web Pro (entrega 26/06)

> **Estado de execução por sessão.** Complementa (não substitui) `docs/CONTRATO_INTEGRACAO.md`,
> que é a fonte de verdade do **contrato de dados cross-repo**. Aqui mora o "onde estamos" da
> reta final: o que cada sessão fez, o que falta, riscos e o contrato de dados em movimento.
>
> Disciplina: toda sessão começa lendo `CONTRATO_INTEGRACAO.md` + `CLAUDE.md` + este arquivo;
> na dúvida sobre o app, consulta o banco via MCP (1 só Supabase). Atualiza o **Tracker** (§3) e a
> **§5** ao terminar.

## 1. Objetivo da entrega
Painel web profissional estável e com o **spine de dados** pronto para o app paciente gravar
**peso, foto e água de verdade** e a web LÊ-los. Demo via "modo demonstração" (sem auth real).

## 2. Sessões
- **Sessão 1:** (A) eliminar o crash da Review; (B) preparar o banco p/ peso/foto/água + ligar a leitura da web.
- **Sessão 2 (app):** app grava de fato em `weight_logs` / bucket `progress-photos` / `payload.liters` (ver CONTRATO #16).
- **Sessão 3 (app):** assets oficiais da cliente (GIFs + onboarding).
- **Sessão 4 (web — esta):** Review do painel — tudo gira em torno do paciente. Navegação enxuta
  (Retenção/Planos fora da lateral), Retenção dentro do Dashboard, **cadastro real de paciente**,
  abas da ficha completas (incl. Evolução/Fotos e Documentos) e **mensagem do profissional enviando de verdade** (verificada).
- **Sessão 8 (dívida):** bucket de fotos privado + signed URL; RLS por papel/clínica (#11–#14).

## 3. Tracker
| # | Tarefa | Status | Evidência |
|---|---|---|---|
| S1-A | Reproduzir + corrigir crash (env ausente → tela branca) | ✅ | Reproduzido (5174 sem `.env` → tela branca + throw em `supabase.ts`); corrigido |
| S1-A | ErrorBoundary global (render-time) | ✅ | `src/app/ErrorBoundary.tsx`, montado em `main.tsx` |
| S1-A | Boot tolerante a env ausente (sem throw de módulo) | ✅ | `lib/supabase.ts` (`isSupabaseConfigured`) + `EnvConfigError` |
| S1-A | Sweep de fluxos (open/login/demo/navegação/refresh) | ✅ | Playwright: dashboard, pacientes, perfil + 6 abas, mensagens, planos, campanhas, retenção, config — 0 erros de console |
| S1-B | Migration aditiva `weight_logs` + bucket `progress-photos` | ✅ | `migrations/20260625120000_…sql` (aplicada via MCP) |
| S1-B | Web lê peso (merge `body_assessments` + `weight_logs`) | ✅ | `api/weight.ts`, `WeightChart` — gráfico com pontos clínicos (azul) + app (laranja) |
| S1-B | Web lê foto (`progress_photos`) | ✅ | seed renderiza "Foto demo" na aba Antropometria |
| S1-B | Web lê água do dia (regra `activity_events`) | ✅ | `api/hydration.ts` → card "Hidratação de hoje: 1,8 L" |
| S1 | typecheck + lint + build | ✅ | todos exit 0 |
| S2 | App grava peso/foto/água reais | ✅ | `vertexa-app-paciente` Sessão 2: peso→`weight_logs`(source='app'), foto→bucket `progress-photos`+`progress_photos`, água→`activity_events.hydration_logged.payload.liters` (incrementos). E2E Playwright + verificação via MCP nas tabelas canônicas. |
| S2 | App: pendências reais + VRI de dados reais | ✅ | Home deriva pendências (foto/peso/treino) de dados reais; engine lê `activity_events`; Home lê o ÚLTIMO `adherence_snapshot` → consistente web↔app. Mariana reconciliada 88/alta. |
| S2 | App: treino do Records → recuperação + VRI | ✅ | `Records.tsx` conclui treino com workoutId REAL → `muscle_recovery_states` (lats/biceps `fatigued`) + snapshot VRI. |
| S2 | App: anti-crash (boot tolerante a env + ErrorBoundary) | ✅ | `lib/supabase.ts`/`currentPatient.ts` sem throw de módulo; gate em `main.tsx`; `app/ErrorBoundary.tsx`. Espelha o fix da web. |
| S2 | Migration aditiva: INSERT em `progress_photos` (tabela) | ✅ | `migrations/20260625170000_progress_photos_table_insert_policy.sql` (gap simétrico ao bucket; aplicada via MCP). |
| S2 | App: vitest + typecheck + lint + build | ✅ | 25 testes (hydrationMath/pendingLogic/adherenceEngine/welcomeMessages) + tsc 0 + build 0. Lint: 0 problema nos arquivos da S2 (4 erros pré-existentes em arquivos não tocados). |
| S3 | App: GIFs oficiais da cliente (28/30) | ✅ | `workoutData.ts` resolve `src/assets/exercises/*` via `import.meta.glob` (chave normalizada). ex-23/ex-30 seguem fallback de terceiros (pendência pontual); ex-24 renomeado p/ "Cadeira adutora". Sem URL `fitnessprogramer` nos exercícios oficiais. |
| S3 | App: onboarding com telas oficiais (01..05) | ✅ | `Onboarding.tsx` mostra as 5 telas oficiais full-bleed; removidos overlays duplicados (logo/headline/mockup); mantidos swipe/dots/CTA/`tracker('onboarding_completed')`. |
| S3 | App: body map mantido em SVG (não quebrar) | ✅ | `Progress.tsx PremiumBodyMap` (SVG por região/recuperação) preservado; PNGs `Body_front/back` registrados como melhoria futura. |
| S3 | App: typecheck + lint + build + Playwright | ✅ | tsc 0 · lint 0 nos arquivos da S3 · build 0 (assets oficiais bundlados) · Playwright: Onboarding (5 telas) + WorkoutGuide (GIFs oficiais carregam) — 0 erro de console. |
| S4 | Navegação enxuta (sidebar) | ✅ | `app/routes.ts`: "Retenção" e "Planos" fora da lateral (Diários/Questionários nunca estiveram). `/retencao` e `/planos` seguem montados em `router.tsx` (deep-link não quebra). Editores de plano vivem na ficha (WorkoutTab/NutritionTab). |
| S4 | Retenção dentro do Dashboard | ✅ | `RetentionPanel` reutilizável (coortes: reativar/pendências/adesão por profissional) renderizado no Dashboard + na rota `/retencao`. Playwright: seção "Retenção & coortes" no Dashboard. |
| S4 | Dashboard com indicadores úteis | ✅ | 5 KPIs (ativos, em risco, em atenção, adesão média, **pendências** via `lib/domain/pendencies`), Foco do dia (críticos) + adesão semanal. Skeleton alinhado a 5 cards. |
| S4 | Cadastrar novo paciente (cria de verdade) | ✅ | `PatientCreateDialog` (identificação + objetivo/metas + anamnese) → `createPatient` (profiles `role='patient'` → patients → vínculo c/ profissional logado → body_assessments). Migration `20260625180000` (INSERT policies; `profiles` restrito a `role='patient'`). Playwright: criou paciente real (clinic_id=c1, vínculo e2, anamnese), navegou à ficha; verificado via MCP. |
| S4 | Ficha: "Ver paciente" + 8 abas operáveis | ✅ | `PatientsPage` com "Ver paciente" por linha + CTA no empty-state. Ficha com Visão geral, Timeline, Antropometria, **Evolução/Fotos**, **Documentos**, Plano alimentar, Treino, Recuperação — dados reais (peso/foto/água/treino/recuperação/VRI/documentos). |
| S4 | Aba Documentos (real) | ✅ | `DocumentsTab` lê `body_assessments` com `document_url` (allowlist `isSafeDocumentUrl`). Seed aditivo `20260625190000` (laudo fictício data:PDF p/ Mariana). Playwright: "Laudo · Bioimpedância" + "Abrir documento". |
| S4 | Mensagem real do profissional | ✅ | `sendChatMessage` insere `chat_messages` (`sender_role='professional'`, remetente = Dra. Camila via env) + realtime; "Responder com IA" rotulado placeholder. Playwright: enviou → apareceu; MCP confirmou linha (role professional, sender a2, canal da Mariana). |
| S4 | Revisão adversarial + correções | ✅ | Workflow 5 dimensões + verificação (33 agents). 11 achados confirmados; corrigidos: allowlist de URL de documento (XSS), `profiles` INSERT restrito a `role='patient'`, skeleton 5 cards, a11y do cadastro (required/aria/focus), `<th>` da ação nomeado (sr-only), emoji removido, CTA no empty-state. Diferidos (RPC transacional, isolamento server-side, embeds sem limite) → PENDENCIAS #16/#17. |
| S4 | typecheck + lint + build + Playwright | ✅ | tsc 0 · lint 0 (`--max-warnings 0`) · build 0 · Playwright: Dashboard→paciente→8 abas, cadastro real, envio de mensagem — 0 erro de console. Seed restaurado (paciente/mensagem de teste removidos via MCP). |

## 4. Como rodar / verificar
- `npm run dev` (precisa de `.env` — copie de `.env.example`). Sem `.env`: tela de configuração (não mais branca).
- `npm run typecheck` · `npm run lint` · `npm run build`.
- Demo: botão "Entrar em modo demonstração" → paciente **Mariana** (`/pacientes/10000000-0000-0000-0000-0000000000b1`) → aba **Antropometria**.

## 5. Contrato de dados em movimento  *(o que a Sessão 2 precisa saber)*
Detalhe canônico e inequívoco vive em `docs/CONTRATO_INTEGRACAO.md → "Spine de dados"`. Resumo:

| Dado | Onde o APP grava (Sessão 2) | Como a WEB lê (já feito) |
|---|---|---|
| **Peso (valor)** | `weight_logs (patient_id, weight_kg, measured_at, source='app')` | `getWeightSeries()` faz merge com `body_assessments.weight` → gráfico |
| **Foto** | upload p/ bucket **`progress-photos`** + insert `progress_photos (patient_id, photo_url, taken_at)` | `getProgressPhotos()` → `<img src=photo_url>` |
| **Água (hoje)** | `activity_events (type='hydration_logged', payload.liters)` — **sem tabela** | `getHydrationTodayLiters()` soma `payload.liters` do dia |

✅ **Drifts do app — RESOLVIDOS na Sessão 2 (CONTRATO #16):**
- `Records.tsx` agora insere o VALOR em `weight_logs` (`source='app'`) via `api/weight.ts` (o `weight_logged` permanece só como MARCADOR de Timeline).
- `Records.tsx` aba Foto: input real de arquivo (câmera+galeria) → upload do binário ao bucket `progress-photos` + insert em `progress_photos` (`photo_url` = URL pública) via `api/photos.ts`.
- `Habits.tsx` + `Records.tsx` gravam HIDRATAÇÃO em `payload.liters` (INCREMENTOS; "água de hoje" = soma do dia) via `api/hydration.ts`. (A web mantém a tolerância ao alias `amount` na leitura.)

## 6. Riscos e pendências
- **RLS permissiva (sprint):** `weight_logs`/bucket usam policies `*_write` always-true (igual aos demais
  `sprint_*`). OK só com seed fictício; travar por papel/clínica antes de dado real (#11–#14).
- **Bucket público (LGPD):** foto corporal = dado de saúde. Bucket é público + policy de INSERT sem
  escopo de paciente/pasta nem limite de mime/tamanho. **BLOQUEANTE antes de paciente real** (Sessão 8 +
  #11–#14): privado + signed URL + INSERT escopado. Hoje só seed fictício sobe ao bucket.
- **Seed de foto** é um data URI placeholder (não há binário no bucket ainda) — some quando o app subir fotos reais.
- **VRI da Mariana** — RECONCILIADO na Sessão 2 (app): snapshot mais recente = **88/alta** (CONTRATO #3), consistente entre web e app (ambos leem o último snapshot). Ações reais (ex.: concluir treino) recomputam o VRI de dados reais e sobem o valor (demonstra "VRI muda com ação real"); o engine satura no topo p/ paciente muito ativo (pesos do VRI provisórios, #3).

## 7. Log da Sessão 1
- **Crash:** raiz = `lib/supabase.ts` lançava no carregamento do módulo quando faltava env
  (`.env` é gitignored; só `.env.example` versionado) → React nem montava (tela branca). Reproduzido
  com 2º dev server sem `.env`. Fix: flag `isSupabaseConfigured` (sem throw) + `EnvConfigError` no boot
  + `ErrorBoundary` global p/ erros de render. Logs de erro só em DEV (dados de saúde).
- **Dados:** migration aditiva `20260625120000` (weight_logs + bucket + policies de sprint). Seed
  fictício p/ Mariana (3 pesos de app, 1 foto placeholder, 2 hidratações de hoje). Web religada:
  `api/weight.ts`, `api/hydration.ts`, hooks, `WeightChart`, `AnthropometryTab`.
- **Testes:** typecheck/lint/build = 0; Playwright = 0 erros de console em todos os fluxos.

## 8. Log da Sessão 4 (web — Review do painel)
- **Foco:** tudo gira em torno do paciente; Dashboard como centro; mensagem do profissional enviando de verdade.
- **Navegação:** `app/routes.ts` já sem "Retenção"/"Planos" na lateral (Diários/Questionários nunca estiveram).
  `/retencao` e `/planos` seguem montados em `router.tsx` — deep-link não quebra. Editores de treino/alimentar
  vivem na ficha (`WorkoutTab`/`NutritionTab`), não como módulo solto.
- **Retenção no Dashboard:** `components/retention/RetentionPanel.tsx` (coortes reutilizáveis) renderizado no
  Dashboard e na rota `/retencao`. Dashboard ganhou o 5º KPI "Com pendências" (`lib/domain/pendencies.ts`,
  recência de peso/foto/treino).
- **Cadastro real:** `PatientsPage` com "Cadastrar novo paciente" (`PatientCreateDialog`: identificação +
  objetivo/metas + anamnese/pré-consulta) → `createPatient` encadeia profiles(`role='patient'`) → patients
  (clinic_id do profissional logado) → vínculo → body_assessments. Migration aditiva
  `20260625180000_sprint_patient_create_write_policies.sql` (INSERT policies; `profiles` restrito a
  `role='patient'`). "Ver paciente" explícito por linha + CTA no empty-state.
- **Ficha:** 8 abas (Visão geral, Timeline, Antropometria, **Evolução/Fotos**, **Documentos**, Plano alimentar,
  Treino, Recuperação). Fotos comparativas movidas de Antropometria → Evolução/Fotos (+ resumo início/atual/meta).
  `DocumentsTab` lê `body_assessments.document_url` com allowlist de esquema (`isSafeDocumentUrl`). Seed aditivo
  `20260625190000_seed_demo_patient_document.sql` (laudo fictício data:PDF p/ Mariana).
- **Mensagem real:** já implementada (Etapas 3/3b) — `sendChatMessage` → `chat_messages` (`sender_role='professional'`,
  remetente = Dra. Camila via env) + realtime. **Verificada** ponta a ponta: envio pela web apareceu na thread e
  a linha foi confirmada no banco via MCP (canal da Mariana, sender `a2`). "Responder com IA" segue placeholder rotulado.
- **Revisão adversarial:** Workflow 5 dimensões + verificação (contrato, segurança/RLS/LGPD, correção, UI/a11y,
  cobertura de aceite). 11 achados confirmados. Corrigidos nesta sessão: allowlist de URL de documento (XSS via
  `javascript:`/`data:text/html` que o INSERT permissivo permitiria), `profiles` INSERT restrito a `role='patient'`,
  `DashboardSkeleton` (5 cards), a11y do cadastro (required/aria-required/aria-invalid/aria-describedby + foco no erro),
  `<th>` da coluna de ação nomeado (sr-only), emoji removido do painel de retenção (identidade sóbria), CTA no
  empty-state de Pacientes. Diferidos para pré-produção: cadastro transacional via RPC, isolamento por clínica no
  servidor, embeds de `listPatients` sem limite → `docs/PENDENCIAS.md #16/#17/#18`.
- **Testes:** typecheck 0 · lint 0 (`--max-warnings 0`) · build 0. Playwright: Dashboard (sidebar sem Retenção/Planos,
  5 KPIs, coortes) → ficha (8 abas, Documentos e Evolução com dado real) → cadastro real (criou + navegou) →
  Mensagens (envio real). 0 erro de console. Paciente/mensagem de teste E2E removidos via MCP (seed pristino: 3 pacientes, 1 doc).
