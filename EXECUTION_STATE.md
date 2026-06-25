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
- **Sessão 1 (esta):** (A) eliminar o crash da Review; (B) preparar o banco p/ peso/foto/água + ligar a leitura da web.
- **Sessão 2 (app):** app grava de fato em `weight_logs` / bucket `progress-photos` / `payload.liters` (ver CONTRATO #16).
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
