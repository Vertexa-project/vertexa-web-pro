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
- **Sessão 4 (web):** Review do painel — tudo gira em torno do paciente. Navegação enxuta
  (Retenção/Planos fora da lateral), Retenção dentro do Dashboard, **cadastro real de paciente**,
  abas da ficha completas (incl. Evolução/Fotos e Documentos) e **mensagem do profissional enviando de verdade** (verificada).
- **Sessão 5 (web):** Review §6 — **redesign visual/identidade própria** (anti-template/Nutrio) +
  correção de telas vazias. Só visual/UX: sem módulos/menus novos, sem mexer em dados/fluxos.
- **Sessão 6 (web):** Review §3 — **Agenda interna no Dashboard** (tabela `appointments` + CRUD real
  + seed) com gancho-placeholder p/ Google Agenda. Financeiro (stretch) diferido (PENDENCIAS #20).
- **Sessão 7 (web):** **Ledger técnico interno** (`schema_migration_log` + backfill, somente Supabase/MCP/migrations)
  + **RBAC de UI** (papel controla ver/editar; seletor de papel "modo demonstração"). O ledger não tem
  exposição no portal, API client ou acesso `anon`/`authenticated`; RLS clínica segue para a S9.
- **Sessão 8 (release gate + QA):** gate do ledger `20260626123000` **APLICADA** no Supabase remoto via
  MCP (12 linhas; sem leitura anon/auth; RLS on). QA integrada web↔app com **E2E reais** (hidratação app→web
  e chat web, ambos com cleanup) + leitura de dado seed real nos demais fluxos. Roteiro de demo + runbook
  (marcado APLICADA). Bucket privado/RLS real por papel/clínica seguem para S9/P1.
- **Sessão 10 (web):** **integração REAL com Google Calendar** (read-only, multi-tenant) via **Supabase Edge
  Functions (Deno)** — substitui o placeholder da S6. 4 tabelas `calendar_*` (tokens/state **deny-all**;
  connections/cache leitura sprint), 4 funções (`auth`/`callback`(verify_jwt=false)/`sync`/`disconnect`),
  agenda do Dashboard **mesclada** (interna S6 + Google, com chip de fonte; Google read-only) e card
  **Integrações** em Configurações (Conectar/Atualizar/Desconectar admin-gated). Revisão adversarial (20
  agents): 5 achados corrigidos (IDOR de escopo em sync/disconnect, find-or-update do callback, aviso de
  erro do Google no estado vazio, allowlist anti open-redirect, layout do rodapé não-admin). Verificação de
  tenant no servidor segue para S9 (#23); **cifra do refresh_token em repouso RESOLVIDA no WP-A2 (#22)** —
  `bytea` cifrado (pgcrypto + chave no Vault), funções SECDEF service-role-only, client sem caminho ao token;
  migration `20260724090000` + edge functions callback/sync no PR (deploy coordenado = passo do dono). Round-trip
  OAuth real = `NÃO_COMPROVADO_AUTOMATICAMENTE` (depende dos secrets do Google; ver `docs/ops/SETUP_GOOGLE_CALENDAR.md`).
- **Sessão 12 (web):** Review §3 — **Agenda do Dashboard vira CALENDÁRIO** (FullCalendar v6.1.21, MIT) com
  4 views (Mês/Semana/Dia/Lista), pt-BR e busca **range-driven** (faixa visível → `datesSet`, `keepPreviousData`).
  Migration aditiva `20260626160000` adiciona `type` (consulta/retorno/previsao_retorno/outros) e `status`
  (confirmado/pendente/desmarcado) em `appointments` (CHECK + defaults; RLS sprint **intacta**). Cor por TIPO
  (preenchimento) + STATUS (barra à esquerda; desmarcado = riscado + esmaecido, contraste AA). CRUD da S6
  intacto (clique=editar, arrastar=remarcar, excluir no diálogo); Google da S10 mesclado **read-only** (laranja);
  a conexão migrou para um dropdown **Integrações** no topo (admin-gated), removendo o card de rodapé.
  FullCalendar em chunk próprio + `lazy()` (fora do bundle do Dashboard; sem import de CSS na v6). Revisão
  adversarial (10 dimensões, 23 agents): 8 achados corrigidos. Plugin de fuso fixo (luxon3) diferido (#25).

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
| S5 | Baseline + crítica honesta (template/vazio) | ✅ | Playwright 1440/1280 em todas as telas. Tells: neutros 0%-sat + laranja default (shadcn cru), logo "V" genérico, tudo em Inter, busca desabilitada dominando topbar, KPIs truncados; vazios: Configurações ("Em construção"), Campanhas (metade inferior), Foco do dia. |
| S5 | Identidade própria (tokens + tipo + assinatura) | ✅ | Neutros com **tinta quente** (hue ~32–40) ligados ao acento; **Plus Jakarta Sans = display** (títulos/números/VRI/wordmark) + Inter corpo; marca do **"pico/vertex"** (`Brand.tsx`) na sidebar/mobile/topbar/login + **favicon** atualizado; **spine** laranja no título e menu ativo; elevação quente. Laranja só acento; **status colors inalterados** (hue = app). |
| S5 | Telas vazias com utilidade real | ✅ | **Configurações**: 6 seções (conta, clínica, **aparência c/ troca de tema real**, plano, notificações, LGPD) no lugar do placeholder. **Campanhas**: faixa de KPIs reais + rodapé explicativo. **Dashboard**: "Foco do dia" com subtítulo + CTA "Ver todos os pacientes"; KPIs **não truncam** (1440/1280). Empty-states de Pacientes/Campanhas com CTA. |
| S5 | "Modelos" como roadmap (cadeado) | ✅ | Item de menu desabilitado com cadeado (`routes.ts` `locked` + `NavRow`); não navega, sem rota — sinaliza o que vem sem virar módulo (Review item 3). |
| S5 | Revisão adversarial + correções | ✅ | Workflow 5 dimensões (identidade/a11y/regressão/escopo/vazios) + verificação lendo screenshots (25 agents). 10 achados confirmados, **todos corrigidos**: foco de teclado na nav (regressão WCAG 2.4.7), favicon antigo, contraste AA de "Modelos"/"MENU", override de `shadow-sm` (tab dark), ARIA do controle de tema (radiogroup→aria-pressed), `<div>` locked, alturas de KPI a 1280, mark duplicado no login (variant `onDark`), vão do card Aparência. |
| S5 | typecheck + lint + build + Playwright | ✅ | tsc 0 · lint 0 (`--max-warnings 0`) · build 0 · Playwright (light+dark, 1440/1280): Dashboard, Pacientes, Ficha, Mensagens, Campanhas, Configurações — 0 erro de console. Screenshots antes/depois fora do repo (gitignored/scratchpad). |
| S6 | Migration `appointments` (aditiva/reversível) + RLS sprint | ✅ | `20260626090000`: tabela (clinic_id NOT NULL→clinics, patient_id?/professional_id?, title, starts_at, ends_at, notes) + FKs + índice (clinic_id, starts_at) + `sprint_appointment_read`/`_write`. Aplicada+verificada via MCP. |
| S6 | Camada de dados (api/ + react-query) | ✅ | `api/appointments.ts` (list por clínica+janela com joins de nome; create/update/delete), `useAppointments` (query + mutations + invalidação por clínica), `listClinicProfessionals`/`useClinicProfessionals`, types `Appointment`/`AppointmentView`, `qk.appointments`/`qk.clinicProfessionals`. Telas só via api/. |
| S6 | Seed fictício (idempotente, fuso SP) | ✅ | `20260626093000`: 3 compromissos da clínica c1 (09:00/14:30 hoje + 10:00 amanhã, `AT TIME ZONE 'America/Sao_Paulo'`). Guarda idempotente alinhada ao rollback (`[seed-demo]`). |
| S6 | AgendaCard no Dashboard + CRUD real | ✅ | Seção "Agenda" (toggle Hoje/Semana, lista com nomes, editar/excluir, "Novo compromisso" via `AppointmentDialog`), escopada por clínica do profissional logado. Delete com estado pending/erro; validação término≥início. "Conectar Google Agenda" = placeholder explícito (#19); Google Meet fora. |
| S6 | Verificação E2E (Playwright + MCP) | ✅ | Criou "Consulta de verificação S6" 16:00 (Mariana/Camila) → apareceu → **reload persistiu** → confirmado no banco (clinic c1) → **excluído** → voltou aos 3 seeds. 0 erro de console. Isolamento por clínica confirmado. |
| S6 | Revisão adversarial + correções | ✅ | Workflow 5 dimensões + verificação (33 agents). 12 achados confirmados; corrigidos: a11y do placeholder Google (texto no DOM, sem depender de tooltip), feedback de erro/pending no delete, validação término<início, `clinic_id` tipado NOT NULL, `qk.clinicProfessionals`, guarda do seed alinhada ao rollback. Documentados: RLS de `appointments` no #14, `notes` sensível, fuso, scope do select de paciente → PENDENCIAS #19/#20. |
| S6 | Financeiro (stretch) — DIFERIDO | ⏭️ | Não implementado. Gating correto (admin/gestor) o ocultaria da persona da demo (Camila=professional); spec permite "só Calendar". Forma proposta registrada em PENDENCIAS #20. |
| S6 | typecheck + lint + build | ✅ | tsc 0 · lint 0 (`--max-warnings 0`) · build 0 (pós-correções da revisão). 0 erro de console no Dashboard com a Agenda. |
| S7 | PART A — ledger `schema_migration_log` (aditiva/reversível) | ✅ | `20260626120000`: tabela (version PK/filename/description/session/applied_at) + BACKFILL de 11 migrations. Companion legível da tabela do CLI (não a substitui). |
| S7 | Correção — ledger interno ao Supabase | ✅ | `20260626123000`: remove `miglog_read`, revoga privilégios de `anon`/`authenticated`, mantém RLS ligada e registra a própria correção no ledger. O portal não possui seção, API client, hook ou query key para o ledger. |
| S7 | PART B — RBAC de UI (helper + provider) | ✅ | `lib/domain/roles.ts` (Role + mapa de permissões + `deriveRole`), `RoleProvider`/`useRole`; papel deriva de `profiles.role`+`professionals.type` (`getCurrentProfessional` agora traz `profileRole`). |
| S7 | PART B — seletor de papel "modo demonstração" | ✅ | No menu de conta (Topbar), só quando `demoMode`; troca admin/médico/nutri ao vivo (runtime, não persiste). `setDemoRole` é no-op fora do demo. Playwright: troca de persona muda a experiência sem reload. |
| S7 | PART B — edição por papel (gating) | ✅ | `GatedAction` (focável, `aria-disabled` + `aria-describedby` com motivo visível). Nutri edita Plano alimentar e NÃO Treino; médico o inverso (botão inerte + motivo). |
| S7 | Revisão adversarial + correções | ✅ | Correção incremental: nenhuma referência frontend ao ledger deve permanecer em `src`; RBAC de UI permanece; RLS de dados clínicos não foi alterada. |
| S7 | typecheck + lint + build + Playwright | ✅ | Correção incremental S7: typecheck 0 · lint 0 · build 0 · Playwright local: nutri/plano, médico/treino, admin sem ledger no portal, 0 erro de console. RLS de dados NÃO tocada (é a S9). |
| S8 | Gate da migration `20260626123000` | ✅ | **APLICADA** via MCP (esta sessão tem MCP admin; a anterior não tinha → era `BLOCKED_REMOTE_MIGRATION`). Validado: ledger=12 linhas; `pg_policies`=∅; `has_table_privilege(anon/authenticated,select)`=false; `relrowsecurity`=true. Sem `db push`/`db reset`. Runbook marcado APLICADA. |
| S8 | QA integrada web↔app | ✅ | `docs/QA_S8_RELEASE_GATE.md`. **E2E reais nesta sessão (com cleanup):** hidratação app→`activity_events`→web "Hidratação de hoje" 0,0→0,3 L; chat web→`chat_messages`(professional/Camila)→thread. Demais fluxos: dado seed real lido (MCP+UI) + escrita conferida no código dos 2 repos. Foto app→bucket e conclusão de treino = NÃO_COMPROVADO (sem cleanup seguro). |
| S8 | QA local (web + app) | ✅ | Web: tsc 0 · lint 0 (`--max-warnings 0`) · build 0 · `rg` ledger em `src`=0. App: vitest 25/25 · tsc 0 · build 0 · lint 3 erros+9 warns **pré-existentes** (shadcn não tocado). Playwright web+app: rotas + RBAC + 0 `console.error`/`pageerror`. |
| S8 | Roteiro da demo 26/06 | ✅ | `docs/DEMO_2606.md`: roteiro honesto (E2E validado / pronto-UI / seed / mockado / NÃO_COMPROVADO / S9), gate APLICADA. |
| S10 | Migration `calendar_integration` (aditiva/reversível) + RLS | ✅ | `20260626140000`: `calendar_connections` (metadado, leitura sprint), `calendar_connection_tokens` (**deny-all**: RLS on + revoke anon/auth, 0 policy), `calendar_event_cache` (leitura sprint), `calendar_oauth_state` (**deny-all**) + índices + linha no ledger. Aplicada+verificada via MCP (`has_table_privilege` anon/auth select = false em tokens/state; true em connections/cache; RLS on em todas). |
| S10 | Edge Functions (Deno) deployadas | ✅ | `google-calendar-auth`/`sync`/`disconnect` (verify_jwt=true) + `google-calendar-callback` (verify_jwt=false, validado por state). `list_edge_functions` = 4 ACTIVE. Troca OAuth + tokens só no servidor (service_role); client nunca vê client_secret/refresh_token. |
| S10 | Camada de dados + UI (agenda mesclada + Integrações) | ✅ | `api/calendar.ts` (functions.invoke + leitura de connection/cache), `useCalendarConnection`/`useAgenda`, tipos `CalendarConnection`/`CalendarEventCache`/`AgendaItem`. `AgendaCard` mescla interna+Google (chip de fonte; Google read-only; CRUD interno intacto). Card **Integrações** em Configurações (Conectar/Atualizar/Desconectar admin-gated; retorno `?calendar=`). Playwright: agenda mesclada (Hoje+Semana), gating nutri(disabled+motivo)/admin(ativo), 0 erro de console. |
| S10 | Seed fictício do Google (idempotente) | ✅ | `20260626150000`: 1 conexão `connected` (sem token) + 3 eventos no cache (clínica c1, fuso `America/Sao_Paulo`), p/ a demo exibir a agenda mesclada sem conta real. Rollback por marcador `seed-demo`. |
| S10 | Revisão adversarial + correções | ✅ | Workflow 5 dimensões + verificação (20 agents); 7 achados confirmados. Corrigidos 5: IDOR (sync/disconnect exigem `clinic_id`, sem caminho por id solto), find-or-update do callback espelha o índice unique, aviso de erro do Google no estado vazio, allowlist `ALLOWED_REDIRECT_ORIGINS` (open-redirect), rodapé compacto não-admin. Diferidos: cifra refresh_token (#22), tenant server-side (#23), seleção por status (#24). |
| S10 | Round-trip OAuth real | ⏭️ | `NÃO_COMPROVADO_AUTOMATICAMENTE`: depende dos secrets do Google (Cloud Console + `supabase secrets`) configurados pelo responsável. Sem secrets, `Conectar` responde `google_not_configured`; a demo usa o seed. Roteiro manual em `docs/ops/SETUP_GOOGLE_CALENDAR.md`. |
| S10 | typecheck + lint + build | ✅ | tsc 0 · lint 0 (`--max-warnings 0`) · build 0 (pós-correções da revisão). |
| S11 (app) | Body map dinâmico de recuperação | ✅ | `vertexa-app-paciente` Sessão 11: troca o `PremiumBodyMap` estático/mock por `DynamicBodyMap` que **LÊ** `muscle_recovery_states` (anon SELECT) e pinta cada grupo por status **DERIVADO de `last_trained_at`** (regra pura `recoveryRule.ts`; a coluna `status` é provisória/#1, não decai). Read path `getMuscleRecovery(patientId)` + hook `useMuscleRecovery` (`['recovery', patientId]`); invalidação pós-treino em `eventSync` via QueryClient singleton. PNG oficial (`Body_front/Body_back`) + overlay SVG por face (viewBox próprio), zonas `<path>` bilaterais espelhadas, flip frente↔costas (framer-motion `rotateY` + `prefers-reduced-motion`; face oculta `inert`), legenda dos 5 estados, bottom sheet (Radix) por zona. Tokens `--recovery-*` (recovered=AZUL, weakened=verde). SEM 'activated', SEM 3D, **SEM migration** (ENUM `muscle_status` já tem os 5 valores; RLS `sprint_read_all` já cobre anon SELECT). Commit `3206b52`. |
| S11 (app) | Verificação (testes + Playwright + MCP) | ✅ | vitest **39/39** (25 + 14 novos de `recoveryRule`, incl. bordas de faixa + meia-noite) · tsc 0 · build 0 · lint 0 nos arquivos novos (3 erros pré-existentes em shadcn intactos). Playwright `/progress` @430px: pinta dado real da Mariana (9 grupos treinados há 8–15d → `weakened`/verde; sem linha → `neutral`/cinza; `abs` gravado `fatigued` aparece `weakened` → prova a derivação por dias, não pela coluna), flip frente↔costas, bottom sheet (Esc fecha), face oculta `inert=true`, 0 erro de console. MCP confirmou ENUM `muscle_status` (5 valores) + `sprint_read_all`. Conclusão de treino→repaint = wiring por código (não rodado E2E p/ não mutar o seed da Mariana na entrega 26/06; ver S8 NÃO_COMPROVADO). |
| S11 (app) | Revisão adversarial + correções | ✅ | Workflow 4 dimensões + verificação (9 agents). 5 achados confirmados, todos corrigidos: bottom sheet → **Radix Sheet** (Esc/focus-trap/`aria-modal`/scroll-lock/devolução de foco), face oculta do flip `inert` (fora do tab/SR/hit-test), `aria-label` da zona em PT (ex.: "Quadríceps: Enfraquecido"), alvos de toque ampliados (hit path transparente). Demais achados = "no defect". |
| S12 | Migration type/status (aditiva) | ✅ | `20260626160000`: `add column if not exists type/status` + CHECK (4 tipos/3 status) + defaults `consulta`/`confirmado` + backfill + seed variado (Mariana consulta/confirmado · Ricardo retorno/pendente · Beatriz outros/desmarcado); ledger=**15**; RLS sprint intacta; tabelas sensíveis (tokens/state) não tocadas. MCP confirmou colunas/CHECK/defaults/distribuição. |
| S12 | Agenda → calendário FullCalendar v6.1.21 (MIT) | ✅ | 4 views (dayGrid/timeGrid/list/interaction), pt-BR, `timeZone:'local'`, `nowIndicator`. Busca **range-driven** (datesSet→{from,to}; queryKeys re-chaveadas por faixa; `keepPreviousData` evita piscar vazio). Mapeamento `AgendaItem→EventInput` (all-day do Google por data pura, sem off-by-one). Cor por TIPO + barra de STATUS; desmarcado riscado/AA. Chunk `fullcalendar` próprio + `lazy()`. Sem import de `.css` (v6 auto-injeta). |
| S12 | CRUD interno + Tipo/Status + Integrações no topo | ✅ | `AppointmentDialog` ganhou selects Tipo/Status + **Excluir**; criar por slot (`initialStart`), editar por clique, remarcar por arrastar/redimensionar (revert + aviso no erro; drop em all-day bloqueado p/ interno). Dropdown **Integrações** (status + Conectar/Atualizar/Desconectar, admin-gated via `GatedAction`) substituiu o rodapé; gestão detalhada segue em Configurações. |
| S12 | Revisão adversarial + correções | ✅ | Workflow 10 dimensões + verificação refutadora (23 agents): 13 achados, **8 confirmados e corrigidos** — `keepPreviousData`, indicador "Atualizando agenda…", aviso de falha no drag, bloqueio de drop all-day p/ interno, barra de status (legenda fiel + sem colisão de canal), `disabled` só p/ admin (motivo focável por teclado/SR), desmarcado AA (sem `opacity` no elemento), `aria-label` "Google somente leitura". 5 refutados (incl. off-by-one all-day — a Edge Function de sync ancora UTC-meio-dia). |
| S12 | Gate + Playwright + npm ci | ✅ | tsc 0 · lint 0 (`--max-warnings 0`) · build 0 · `npm ci && npm run build` limpo (espelho Vercel; chunk `fullcalendar` isolado, ~78 KB gzip). Playwright (tema claro): 4 views, CRUD (criar/editar/excluir verificado + MCP), cores por tipo + desmarcado riscado/legível, 2 legendas, dropdown Integrações nutri(desabilitado+motivo)↔admin(ativo), 0 erro de console. Seed restaurado pristino pós-E2E. |
| S12.1 | Polimento premium do calendário | ✅ | Janela **06:00–23:00** (slotDuration 30min, rótulo 1h, scrollTime 07:00, expandRows, altura 720); **businessHours** seg–sáb 08–19 com sombreado sutil (token `--fc-non-business-color`); **resumo da faixa visível** no header (deriva dos events — "N compromissos · X confirmados · … · W no Google" —, recalcula no datesSet); hover discreto + truncamento do chip. Seed cheio `20260626170000` (**17** compromissos na semana corrente+próxima, type/status variados, 08–19h, fuso BR; idempotente por `[seed-s12.1]` + `where not exists`, re-run não duplica; **ledger=16**). Revisão adversarial (5 dim, 7 agents): **2 achados corrigidos** — hover apagava a barra de STATUS (box-shadow recomposto por status); janela 06–23 podia ocultar compromisso criado fora do expediente (guarda 06–23 no diálogo: `min/max` + validação no submit). Gate verde + `npm ci && build` limpo; Playwright 1440/1024 (grade 06–23, semana viva com todas as cores + risca, 4 views proporcionais, businessHours sombreado, resumo batendo, 0 erro de console). |

| OBS-01 | Fundação Sentry (browser) — scrub puro + facade/client lazy | ✅ | `src/lib/observability/{scrub,sentry,sentry-client}.ts`; SDK `@sentry/react` carregado por `import()` só com DSN (chunk assíncrono ~30 KB gzip; sem DSN não é baixado). |
| OBS-01 | ErrorBoundary + rejection + erro Supabase reportando | ✅ | `ErrorBoundary.componentDidCatch → captureException`; `globalHandlers` (default) cobre `onunhandledrejection`/`onerror`; `QueryCache`/`MutationCache` `onError` no `query-client.ts` (sem tocar `api/`/`hooks/`). |
| OBS-01 | Scrubbing agressivo (LGPD/saúde) provado | ✅ | `beforeSend`/`beforeBreadcrumb` → `scrub.ts` puro; evento sintético com 16 agulhas de PII falsa → **PASS** (user/URL assinada/UUID/email/telefone/diagnóstico/plano/token fora; browser/os preservados). Residual (nome em prosa livre) documentado. |
| OBS-01 | release+environment+SHA + source maps | ✅ | `.env.example`+`vite-env.d.ts` (`VITE_SENTRY_DSN`/`VITE_APP_ENV`/`VITE_APP_RELEASE`); `vite.config.ts` `sourcemap:true` + fallback de release por SHA do git (`execFileSync`, sem shell). |
| OBS-01 | Gates + boot idêntico com/sem DSN | ✅ | tsc 0 · lint (`--max-warnings 0`) 0 · build 0 (com `.map`). `rg sentry` = só o módulo novo. Playwright (dev, com/sem `VITE_SENTRY_DSN`): app monta, 0 erro de console; sem DSN o chunk do SDK não é baixado. |
| AUTH-01 | Migration aditiva `auth_user_link` (trigger de associação) | ✅ | `20260708120000`: índice único parcial `profiles(auth_user_id)` + coluna `status` + `handle_new_user()` SECURITY DEFINER + trigger. Aplicada+verificada via MCP; ADITIVA/não-destrutiva; RLS sprint intocada; ledger AUTH-01. |
| AUTH-01 | Segurança: associação SÓ com e-mail verificado | ✅ | Revisão de commit pegou account-takeover por e-mail não verificado (anon key pública). Guarda `email_confirmed_at`; trigger dispara `after insert OR update of email_confirmed_at`. Provado (MCP, rollback): verified→link, verified-new→pending, **unverified→NÃO linka**, confirm-later→link. |
| AUTH-01 | Login Google real + resolução de identidade (flag) | ✅ | `VITE_AUTH_MODE` (default demo). `resolveIdentity` puro (proof node 14/14) + `useIdentity` (auth.uid()→profile→professional→clinic; pending). `signInWithGoogle`; `/auth/callback`; ProtectedRoute→PendingAccess; erros `captureException(source:"auth")`. |
| AUTH-01 | Repontar consumidores do pin p/ identidade resolvida | ✅ | `useCurrentProfessional`/chat/`useChat`/Topbar derivam de `useIdentity` (fonte única); `session.ts` = ramo demo. `getChatThread` recebe `actingProfileId`. |
| AUTH-01 | Gates + E2E (demo idêntico / Google no real) | ✅ | tsc 0 · lint 0 · build 0. Playwright: demo → login idêntico (só "modo demonstração", sem Google) + dashboard carrega (0 erro); real → botão "Entrar com Google" (demo escondido) + clique inicia OAuth (`…/auth/v1/authorize?provider=google&redirect_to=…/auth/callback`). `.env` restaurado. |
| AUTH-02 | Trigger ciente de superfície + FAIL-CLOSED (WP-04 Parte A) | ✅ | Migration aditiva `20260709120000`: NO-MATCH sempre cria **`patient` pending** neutro (nunca professional via `signup_surface`, que é user_metadata controlável). Provider-gate Google + match role-agnóstico **PRESERVADOS**. Aplicada+verificada via MCP. RLS sprint intocada; ledger AUTH-02. |
| AUTH-02 | DÍVIDA-AUTH-2 (observabilidade do trigger) | ✅ | `EXCEPTION` mudo → log **SQLSTATE** (nunca SQLERRM/PII) + `public.auth_trigger_events` (auth_user_id/surface/outcome/sqlstate, **sem e-mail/nome**; RLS deny-all anon/auth) via helper best-effort que nunca aborta o signup. |
| AUTH-02 | Prova adversarial (6 casos, rollback) + gates | ✅ | Transação com ROLLBACK (seed intacto): web-match→prof linked, patient_app-match→patient linked, novo→patient pending, **web forjado→patient (não professional)**, e-mail/senha→admin NÃO linka/sem pending, surface ausente→patient. Diagnóstico com outcomes corretos e **sem PII**; anon negado. Gates web tsc/lint/build 0 (Parte A não muda TS). |

## 4. Como rodar / verificar
- `npm run dev` (precisa de `.env` — copie de `.env.example`). Sem `.env`: tela de configuração (não mais branca).
- Observabilidade: preencher `VITE_SENTRY_DSN` liga o Sentry; vazio = no-op. Ver `docs/ops/OBSERVABILITY.md`.
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
  escopo de paciente/pasta nem limite de mime/tamanho. **BLOQUEANTE antes de paciente real** (S9/P1 +
  #11–#14, PENDENCIAS #12): privado + signed URL + INSERT escopado. Hoje só seed fictício sobe ao bucket.
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

## 8. WP-DISC · A — Disciplinas por profissional (fecha DÍVIDA-RLS-3)
Migration `20260725090000_wp_disc_a_disciplines.sql` (PR sem merge; provado Nível 1 em transação ROLLBACK: **48/48 checks**). Contrato detalhado em `docs/CONTRATO_INTEGRACAO.md → "Disciplinas por profissional"`.
- **Modelo:** `disciplines(code,label,is_clinical)` + `professional_disciplines(professional_id,discipline,granted_by,created_at; PK composta)` — **1:N** sem constraint limitante. Backfill idempotente `map(type)`; `professionals.type` mantido (dívida).
- **Autorização (UNIÃO/OU):** `private.can_write_discipline(patient, text[])` = vínculo (`can_prescribe_for_patient`) **E** posse de QUALQUER disciplina exigida. Acumular só amplia.
- **Mapa:** nutrição→`nutricionista`; treino→`educador_fisico`|`fisioterapeuta`; `body_assessments`→`nutricionista`|`educador_fisico`|`fisioterapeuta`|`medico`; `patient_documents`/`appointments` NÃO escopados. **SELECT / leitura integrada (DISC-2) INTACTOS.**
- **RPCs:** `save_workout_plan`/`save_nutrition_plan` revalidam a disciplina; atribuição só admin via `assign`/`revoke_professional_discipline` (nunca auto).
- **Comportamento/lacuna (ver PENDENCIAS):** admin sem disciplina perde escrita de `body_assessments` (DISC-ADMIN-1, intencional); `medico` só escreve `body_assessments` (sem superfície de prescrição médica — lacuna de produto).
- **Parte B (web):** alinhar `src/lib/domain/roles.ts` (hoje 1 role por `type`) ao modelo multi-disciplina — WP separado.

## 9. WP-DISC · B — UI multi-disciplina (permissões por união + administração)
Branch `feat/disciplines-ui-web` (PR sem merge). Gates: vitest **15/15** · tsc 0 · lint 0 · build 0. Detalhe em `docs/ops/DISCIPLINES_UI.md`.
- **Permissões por UNIÃO** das disciplinas do profissional (`useDisciplinePermissions` + `derivePermissions`), NUNCA de `type`. `roles.ts` reduzido ao administrativo (`isAdmin`); `type` só p/ display/listagem.
- **Espelho do mapa** do banco em `src/lib/domain/disciplines.ts` (`DISCIPLINE_WRITE_MAP`), travado por teste (`disciplines.test.ts`).
- **Gating em 3 camadas:** botão (`GatedAction`) + editor (*Salvar*) + mutation hook (`useWriteGuard` → `WriteForbiddenError`). `patient_documents`/`appointments` NÃO gateados; `body_assessments` é read-only na web (perm exposta p/ futuro).
- **B4 tela de administração** (`/configuracoes/disciplinas`, admin-only): concede/revoga disciplinas por profissional; auto-atribuição bloqueada na UI (o banco também nega).
- **B5 erro authz:** mensagem amigável + Sentry `source:"authz"` (sem PII).
- **Infra:** o repo web ganhou **vitest** (antes sem runner) — script `test`, `vitest.config.ts`, 1º teste unitário.

## 9.1 WP-CLINIC-ADMIN-SIGNAL — sinal REAL de admin da clínica (corrige AUTH-ADMIN-1)
Branch `feat/clinic-admin-signal` (PR base main, **sem merge**). Gates: vitest **24/24** (15 disc + 9 admin) · tsc 0 · lint 0 · build 0. **Nada aplicado em produção** (migration fica no PR até auditoria).
- **Problema:** a UI decidia "é admin?" por `profiles.role === 'admin'` — anti-padrão AUTH-ADMIN-1. A autoridade real é DONO (`clinics.owner_profile_id`) OU co-admin (`professionals.clinic_role='admin'`); o admin de verdade frequentemente NÃO tem `profiles.role='admin'` e não via a tela de disciplinas (travava a atribuição).
- **Banco (migration `20260726090000`, no PR):** `public.am_i_clinic_admin(uuid default null)` SECDEF, `search_path=''`, EXECUTE só `authenticated` (revoke public/anon). **DELEGA** a `private.is_clinic_admin` (mesma lógica, sem copiar/divergir); `p_clinic` null resolve a clínica do logado (professionals; senão owner). Só retorna boolean; **nenhuma policy tocada**.
- **Web:** `useIsClinicAdmin` (react-query, cache 5min) + derivação PURA `resolveClinicAdmin` (**fail-closed**: undefined/erro ⇒ não-admin; demo espelha a persona). Consumido por DisciplinesAdminPage (com estado de carregamento p/ não piscar), SettingsPage (linha de admin), IntegrationsMenu e GoogleCalendarConnection (calendário admin-gated). `roles.ts` `isAdmin` fica só como fallback de **demonstração**.
- **Testes:** unit `clinicAdmin.test.ts` (9: real true/false, loading/erro fail-closed, demo). Banco em ROLLBACK (`supabase/tests/wp_clinic_admin_signal_test.sql`): dono→true, co-admin→true, comum→false, outra clínica→false, anon não executa — provado com `profiles.role='professional'` (NÃO 'admin'), confirmando que o sinal não depende de `profiles.role`.

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

## 9. Log da Sessão 5 (web — redesign visual/identidade)
- **Escopo:** SÓ visual/UX (Review §6). Nenhuma mudança em `api/`, `hooks/`, `types/` ou rotas; status colors intactos.
- **Baseline honesto (Playwright 1440/1280):** o painel tinha "cara de shadcn cru" — neutros 0%-saturação + laranja default,
  logo "V" genérico, tudo em Inter (Plus Jakarta carregado e sem uso), busca desabilitada dominando a topbar, KPIs truncados;
  e telas vazias (Configurações = "Em construção", Campanhas com metade inferior vazia, "Foco do dia" com vão).
- **Identidade (frontend-design):** mantive as travas de marca (light/sóbrio, laranja `24 95% 53%` só acento, status = app) e
  diferenciei nos eixos livres: **neutros com tinta quente** (hue ~32–40, baixa sat) que "pertencem" ao laranja; **pareamento
  tipográfico** Plus Jakarta (display) + Inter (corpo); **marca do pico/vertex** (`src/components/Brand.tsx`, com variante
  `onDark`) reusada na sidebar/mobile/topbar/login + **favicon** atualizado p/ o mesmo símbolo; **spine** laranja como
  assinatura estrutural (título + menu ativo); elevação quente (`--shadow-card/elevated`).
- **Telas vazias → utilidade:** `SettingsPage` reescrita (6 seções, troca de tema real via `useTheme.setTheme`);
  `CampaignsPage` com KPIs reais + rodapé explicativo; Dashboard "Foco do dia" com CTA; empty-states com ação.
  **Sem dado falso** — tudo deriva de dados reais ou é claramente "em breve".
- **Bug de polish:** rótulos dos 5 KPIs deixaram de truncar (removido `truncate`; `min-h` p/ alinhar baseline a 1280).
- **Roadmap:** item **Modelos** com cadeado (desabilitado, sem rota).
- **Revisão adversarial (Workflow, 25 agents, lendo screenshots):** 10 achados, todos corrigidos — destaque p/ a
  **regressão de foco de teclado na nav** (reintroduzido o ring), favicon antigo, contraste AA de rótulos `/70`,
  override de `shadow-sm` (tab ativo pesado no dark), e ARIA do controle de tema.
- **Verificação:** light + dark, 1440 + 1280, todas as telas — 0 erro de console. Antes/depois capturados (fora do repo).

## 10. Log da Sessão OBS-01 (web — fundação de observabilidade / Sentry)
- **Escopo:** instrumentar Sentry (browser) SEM mudar comportamento de produto. Nada tocado em
  `api/`, `hooks/`, schema, migrations, RLS, rotas, UI de produto, Auth ou no repo do app. Contrato
  de backend intocado (nenhuma tabela/coluna/policy/evento).
- **Design (3 camadas):** `scrub.ts` (PURO, sem dep de framework — núcleo de scrubbing testável) +
  `sentry.ts` (facade leve, import estático, NÃO importa o SDK) + `sentry-client.ts` (camada pesada,
  única a importar `@sentry/react`, carregada por `import()` dinâmico só quando há DSN). Resultado:
  **sem DSN o SDK nem é baixado** (no-op absoluto, boot idêntico); com DSN, chunk assíncrono fora do
  caminho crítico (entry +1 KB; sentry ~30 KB gzip on-demand, tree-shaken).
- **Captura:** `ErrorBoundary` render-time → `captureException`; rejections/`onerror` pela integração
  default `globalHandlers`; erros de dados (Supabase/API) no `QueryCache`/`MutationCache` do
  `query-client.ts` (report-only, sem re-throw; **não** toca `api/`/`hooks/`). Query key só contribui
  o 1º segmento (ex.: "patient") como tag — id de paciente NÃO é anexado.
- **Privacidade (LGPD/saúde):** `sendDefaultPii:false` + `beforeSend`/`beforeBreadcrumb` → `scrub.ts`.
  **Provado** com evento sintético (16 agulhas de PII falsa) → PASS: `user`/`server_name` fora, query de
  URL descartada (mata URL assinada), UUID de paciente → `:id`, email/telefone/JWT/token redigidos,
  frases clínicas em texto livre redigidas, chaves sensíveis em extra/tags/contexts redigidas, vars de
  frame descartadas; `browser`/`os` preservados. **Tracing DESLIGADO** (`tracesSampleRate:0`) para não
  vazar URL de span. Residual (nome em prosa sem palavra-chave clínica) documentado em `OBSERVABILITY.md`.
- **Release/ambiente:** `VITE_SENTRY_DSN`/`VITE_APP_ENV`/`VITE_APP_RELEASE` (todas opcionais);
  `vite.config.ts` liga `sourcemap:true` (produção) + injeta o SHA curto do git como fallback de release.
- **Gates:** tsc 0 · lint (`--max-warnings 0`) 0 · build 0 (com `.map`) — antes e depois. `rg sentry` só
  aponta o módulo novo. Doc: `docs/ops/OBSERVABILITY.md` (como validar um evento de teste).
- **Fora de escopo / dívidas:** endurecer source maps (`hidden` + upload ao Sentry) antes de publicar;
  reabrir tracing exigiria `beforeSendTransaction`. Advisory pré-existente de `esbuild`/`vite` (dev-server)
  não relacionado — exige `vite@8` (major), não tocado.

## 11. Log da Sessão AUTH-01 (web — auth Google real por expansão, sem fechar RLS)
- **Base:** STACK sobre `feat/obs-sentry-web` (WP-01) — decisão do owner; observability é dependência
  (`captureException(source:"auth")`). Branch `feat/auth-google-web`. DÍVIDA-STACK-1: se o PR do WP-01
  mudar, rebasear. Não foi possível `git fetch` (sem credencial) → origin/main em cache = `9ecf1a3`.
- **Padrão EXPANSÃO:** identidade real passa a existir atrás da flag `VITE_AUTH_MODE` (default `demo`);
  com `demo` o app é IDÊNTICO ao de hoje. **RLS permissiva NÃO foi tocada** (fechar = WP-05 / #11-#14).
- **Migration ADITIVA** `20260708120000_auth_user_link.sql` (aplicada+verificada via MCP, ledger AUTH-01):
  índice único parcial `profiles(auth_user_id)`, coluna `status` (default 'active'), função/trigger
  `handle_new_user` SECURITY DEFINER (search_path fixo, idempotente, **nunca aborta o signup**). A função
  é server-side porque `profiles` não tem policy de UPDATE (RLS sprint) → client não consegue setar
  `auth_user_id`. Rollback documentado no header (drop trigger/função/índice/coluna).
- **Associação (1º login):** match-by-email (case/trim-insensitive, exatamente 1 órfão) senão cria
  `pending`. **Segurança:** revisão de commit pegou **account-takeover** (a anon key é pública → um
  signup por e-mail NÃO verificado poderia casar o e-mail de um profissional semeado e sequestrar o
  profile). Corrigido: guarda `email_confirmed_at` (Google já chega verificado; e-mail/senha associa só
  na confirmação → trigger `after insert OR update of email_confirmed_at`). Provado via MCP (transação
  com rollback, sem tocar o seed): verified→link · verified-new→pending · **unverified→NÃO linka** ·
  confirm-later→link.
- **Identidade (frontend):** `resolveIdentity` PURO (`src/lib/auth/identity.ts`, proof node 14/14 incl.
  "real ignora o pin demo") + `useIdentity` (auth.uid()→`getProfileByAuthUserId`→`getCurrentProfessional`
  → active/pending/anonymous/demo). Fonte ÚNICA: `useCurrentProfessional`/chat/`useChat`/Topbar/role
  derivam dela; `session.ts` = ramo demo. `signInWithGoogle` (`signInWithOAuth` google + `/auth/callback`);
  `ProtectedRoute` real+pending → `PendingAccessPage`. Erros de auth → `captureException(source:"auth")` sem PII.
- **Gates:** tsc 0 · lint (`--max-warnings 0`) 0 · build 0 (antes/depois). E2E Playwright: **demo** → login
  idêntico (só "modo demonstração", sem Google) + dashboard carrega (0 erro de console); **real** → botão
  "Entrar com Google" (demo escondido) + clique inicia o OAuth (`…/auth/v1/authorize?provider=google&
  redirect_to=…/auth/callback`). `.env` restaurado (VITE_AUTH_MODE removido → demo).
- **Dívidas:** onboarding/criação de clínica p/ `pending` (WP futuro); RLS real (WP-05); provider Google no
  Supabase Auth + round-trip real = `NÃO_COMPROVADO_AUTOMATICAMENTE` (passo externo); cross-repo: revisar
  role do `pending` quando o app paciente adotar auth real; DÍVIDA-STACK-1 (rebase se WP-01 mudar).

## 12. Log da Sessão AUTH-02 (WP-04 Parte A — trigger ciente de superfície, fail-closed, cross-repo)
- **Gate de base:** o executor NÃO conseguiu `git fetch` autenticado nesta sessão (sem credencial — falha
  rápido, não trava). O **owner confirmou externamente** (sessão Git autenticada, imediatamente antes) as
  duas bases: `vertexa-web-pro` origin/main = `22c474cf` e `vertexa-app-paciente` origin/main = `95d5ca86`;
  meu cache batia exatamente e os objetos estavam presentes (WP-01+WP-03 já mergeados no novo main).
  Autorizado a proceder por SHA. Branch `feat/auth-patient-surface` a partir de `22c474cf`.
- **Correção de segurança do owner (supera A6/A7 literais):** `raw_user_meta_data.signup_surface` é
  user_metadata **CONTROLÁVEL PELO CLIENT** → **nunca** pode conceder/selecionar `professional`. Regra
  fail-closed: **NO-MATCH sempre cria `patient` pending** (neutro), surface só para diagnóstico; promoção a
  professional exige mecanismo confiável posterior. (A7 caso 4 "web novo → professional" virou **→ patient**.)
- **Migration ADITIVA** `20260709120000_auth_patient_surface.sql` (aplicada+verificada, ledger AUTH-02):
  `CREATE OR REPLACE handle_new_user` preservando SECURITY DEFINER/search_path fixo/idempotência, o
  **provider-gate Google** (`raw_app_meta_data`) e o **match por e-mail role-agnóstico** (preserva o role do
  profile casado). NO-MATCH → `role='patient', status='pending'` (literal, sem depender de surface).
- **DÍVIDA-AUTH-2 (observabilidade):** o `EXCEPTION WHEN OTHERS` mudo virou log técnico **SEM PII** —
  `RAISE WARNING` com **SQLSTATE** (nunca SQLERRM) + linha em `public.auth_trigger_events`
  (`auth_user_id`/`surface`/`outcome`/`sqlstate`, **sem e-mail/nome**; RLS on deny-all anon/auth) via helper
  `log_auth_trigger_event` best-effort (swallow próprio → nunca aborta o signup).
- **Prova adversarial (MCP, transação com ROLLBACK — nada persiste; seed intacto):** os 6 casos do WP +
  os 6 adversariais do owner: (1) Google/web casa profissional → **linked, role preservado**; (2)
  Google/patient_app casa paciente → **linked patient**; (3) Google/patient_app novo → **pending patient**;
  (4) **Google/web novo (surface forjada) → pending PATIENT, não professional**; (5) e-mail/senha confirmado
  mirando **ADMIN → NÃO linka, sem pending** (provider-gate intacto); (6) **surface ausente → pending
  patient** (default seguro). `auth_trigger_events` com outcomes corretos (`linked`/`pending_patient`/
  `skipped_unverified_provider`) e **sem coluna de PII**; anon negado.
- **Revisão adversarial (workflow, 4 agents; security+correctness → verify):** correctness limpo; 2 achados
  **low CONFIRMADOS e corrigidos**: (1) provider-gate falhava ABERTO com `provider` NULL (lógica de 3
  valores) — **não** alcançável por client anon (GoTrue sempre seta provider), mas fechado por defesa em
  profundidade via `coalesce(...='google',false)` (fail-closed); (2) `surface` guardava texto livre do
  client → **normalizada** a {web,patient_app,other} (sem PII/sink). Re-provado via MCP (rollback): NULL
  provider mirando ADMIN → **skipped**; blob de 9 KB em `signup_surface` → surface `'other'` (len 5); 6
  casos originais sem regressão.
- **Gates web:** tsc 0 · lint (`--max-warnings 0`) 0 · build 0 (antes/depois; Parte A não muda TS).
- **Escopo/limite:** só o repo web (migration). **RLS sprint intocada** (WP-05). **Parte B (app paciente)
  NÃO iniciada** (aguarda "A verde" + spec da Parte B). Rollback: restaurar a função do WP-03 + drop
  helper/tabela (header da migration).

## 13. Log da Sessão STORAGE-P1 (WP-STORAGE Parte 1 — arquivo físico: buckets privados + RLS de storage.objects)
- **Gate de base:** fetch autenticado OK; `vertexa-web-pro` origin/main = `548ec9cc` (APP-1 contido — merge PR #10,
  `dd9f6c3` no topo) e `vertexa-app-paciente` origin/main = `b7233f8b4454493cb12367b8690fa2ed1532cb85` (ls-remote;
  batia com o esperado). Branch `feat/storage-rls-web` a partir da main do web.
- **Estado provado (P1.1):** `progress-photos` public=TRUE + `patient-documents` public=false; 3 policies sprint
  bucket-wide em `storage.objects` (read/write docs + write fotos — TODAS incluíam **anon**); objetos existentes:
  só 2 demo órfãos `demo/mariana/*.png` (tabelas de metadado VAZIAS pós-Fase A); app sobe foto em
  `${patientId}/${ts}.ext` e grava **URL PÚBLICA** em `photo_url`; web sobe doc em `${patientId}/${ts}.ext` e grava
  **PATH** em `file_path` (signed URL no clique). App nativo (`vertexa-patient-native`) não toca os buckets.
- **Contrato de path (P1.2):** `{patient_id}/{arquivo}` canonizado — JÁ era o padrão dos dois writers; sem gap p/
  objetos novos. Parser NULL-safe novo `private.storage_object_patient(name)` (exige pasta + uuid válido, senão
  NULL ⇒ deny — sem cast error no legado `demo/...`).
- **Migration `20260720090000_wp_storage2_p1_storage_objects_rls` (APLICADA + ledger):** bucket fotos →
  `public=false`; 5 policies novas por bucket+comando (fotos: SELECT `can_access_patient` ESPELHANDO a tabela Fam2
  — **EXTERNO INCLUÍDO, decisão reportada**; INSERT só paciente na própria pasta; docs: SELECT
  `can_access_patient_internal` (externo excluído), INSERT/DELETE `can_prescribe_for_patient`; UPDATE negado nos
  dois buckets); as 3 `sprint_*` dropadas SÓ depois do dry-run verde.
- **Testes (P1.4):** dry-run transacional (migration+suíte+ROLLBACK) ANTES do apply; suíte re-rodada pós-apply —
  verde 2×. Cobertura: X⟂Y (IDOR de path), prof não-vinculado (mesma clínica NÃO basta), isolamento entre clínicas
  (AdminB⟂A), externo⟂documentos (e foto SIM, espelho Fam2), INSERT em pasta alheia negado, mover objeto (UPDATE de
  name) negado, paciente não sobe doc, prof não sobe foto, anon⟂tudo, demo invisível até p/ admin. **Descoberta de
  plataforma:** trigger `protect_objects_delete` (statement-level, novo na plataforma) bloqueia DELETE via SQL
  direto — a suíte seta `storage.allow_delete_query=true` (transaction-local) p/ exercitar a RLS real; o Storage
  API seta esse GUC sozinho, então a policy de DELETE é o que vale no fluxo real.
- **Provas externas:** URL pública antiga do bucket de fotos → **HTTP 400 "Bucket not found"** (público morreu de
  fato). Advisors: **zero apontamento de storage** (restantes = pré-existentes intencionais: RPCs APP-1 WARN 0029,
  deny-all INFO, funções demo legadas). Gates web: tsc 0 · lint (`--max-warnings 0`) 0 · build ✓.
- **Janela POR DESIGN (sem dado real):** exibição de fotos de evolução QUEBRADA até a Parte 2 — o app grava/lê URL
  pública (`photo_url`) e o bucket agora é privado; `pdf/images.ts` (web) também consome essa URL. Parte 2 =
  path relativo + `createSignedUrl` nos dois repos (padrão `documents.ts`).
- **Kill switch (fail-closed):** deny-all em `storage.objects` (drop das policies); **NUNCA `public=true` de
  volta** (reabriria toda foto por URL), **JAMAIS recriar sprint_***. Header da migration documenta.
- **Escopo/limite:** SÓ repo web + banco (Nível 1). App paciente NÃO tocado (Parte 2 em branch própria, após
  auditoria desta Parte 1). PARADO para auditoria conforme o WP.

## 14. Log da Sessão CHAT-ATTACH-A (WP-CHAT-ATTACH Parte A — anexos: bucket + policies + modelo)
Branch `feat/chat-attachments-web` (PR base main, **SEM MERGE**; **NÃO aplicado em produção** — dry-run em ROLLBACK).
Gate: web origin/main `faa0a48`; app origin/main `9ef276e` (+1 docs-only `Update README.md`, caracterizado).
- **Decisão do modelo:** anexo em **COLUNAS anuláveis** de `chat_messages` (`attachment_path/name/mime/size`), **1 anexo/mensagem** (dívida: N → tabela filha). `body` vira **anulável** + CHECK `(body IS NOT NULL OR attachment_path IS NOT NULL)`. Autorização do anexo **herda** a do canal (Família 4) — zero policy de metadado nova.
- **Espaço dedicado ao chat, pasta = `channel_id`** (NÃO a pasta do paciente): a autorização do chat é por **PARTICIPAÇÃO**, não por acesso ao paciente — guardar na pasta do paciente vazaria para profissional vinculado fora do canal.
- **Migration `20260727090000` (no PR, não aplicada):** helpers `private.storage_object_channel` (espelha `storage_object_patient`, IMMUTABLE, search_path='') e `private.chat_attachment_is_orphan` (SECDEF, evita recursão de RLS). Bucket privado `chat-attachments` (mime pdf/jpeg/png/webp, 10 MB). Policies `storage.objects` por pasta=canal: SELECT `can_read_channel` (admin lê), INSERT `is_channel_participant` (admin não envia), UPDATE negado, DELETE só órfão do próprio uploader (`owner=auth.uid()` + `chat_attachment_is_orphan`). INSERT de `chat_messages` **SÓ ACRESCENTA** (item v) `attachment_path IS NULL OR storage_object_channel(attachment_path)=channel_id` — **nenhuma policy existente afrouxada**.
- **Realtime (não vaza):** `chat_messages` está na publicação `supabase_realtime`; o `attachment_path` viaja no payload do INSERT, mas (1) web e app **ignoram o payload** e refazem o `select` governado pelo SELECT (`can_read_channel`); (2) o Realtime aplica a RLS de SELECT no `postgres_changes` — não-participante não recebe o row.
- **Testes (dry-run transacional migration+suíte+ROLLBACK): PASS.** Cobertura: leitura P1/paciente/admin ✓; **VAZAMENTO** de profissional vinculado-mas-fora-do-canal (P2) bloqueado no **objeto E no metadado** ⟂; admin **lê e não envia** ⟂; pasta de canal alheio ⟂; **referência cruzada de canal (item v)** ⟂; forja de remetente (Fam4) ⟂; CHECK (msg vazia) ⟂; DELETE de anexo já referenciado ⟂; DELETE de órfão alheio ⟂; positivos (só-anexo, só-texto, upload) ✓; DELETE de órfão próprio ✓; anon ⟂ tudo; isolamento entre clínicas.
- **Advisors:** antes = 4 INFO rls_enabled_no_policy + 9 WARN authenticated_security_definer; perf 37. **Não aplicado ⇒ depois medido no apply auditado**; delta previsto: **+1 WARN** (`chat_attachment_is_orphan` SECDEF, mesma classe aceita), perf inalterada. Prod verificada intocada (bucket/fns/colunas/policies=0; `body` ainda NOT NULL; INSERT de chat = expressão original).
- **Kill switch (fail-closed):** drop das 3 policies do bucket + `delete from storage.buckets where id='chat-attachments'`; **NUNCA public=true, NUNCA reabrir anon**; restaura o INSERT de chat à versão anterior (remove só o item v); drop constraint/colunas/helpers. Header da migration documenta.
- **Escopo/limite:** SÓ repo web + banco (Nível 1). **Nenhuma policy de chat existente afrouxada** (INSERT só ganhou item v). `app`/`patient-native` **não tocados** (só leitura para insumo das Partes B/C). PARADO para auditoria.

## 15. Log da Sessão REPORT-A (WP-REPORT Parte A — exportação de relatório de UM paciente + trilha)
Branch `feat/patient-report-web` (PR base main, **SEM MERGE**; **NÃO aplicado em produção** — dry-run em ROLLBACK).
Gate: web origin/main `4869238`. Princípio: obter os dados agregados e auditar são **inseparáveis** — uma única RPC autoriza + grava a trilha + retorna.
- **Migration `20260728090000` (no PR, não aplicada):** tabela `public.report_exports` (SEM conteúdo clínico: quem/qual paciente/quando/período/seções/record_count/surface) + 3 índices ((clinic_id,exported_at),(patient_id,exported_at),(exported_by,exported_at)) + RLS (SELECT admin da clínica OU autor; **sem** INSERT/UPDATE/DELETE de cliente ⇒ escrita só pela RPC definer). RPC `public.export_patient_report(p_patient_id,p_from,p_to,p_sections,p_surface)` **SECDEF, search_path='', VOLATILE, EXECUTE só authenticated**.
- **RPC:** (1) autoriza via `private.can_prescribe_for_patient` (exclui **externo/paciente/não-vinculado/outra-clínica**); (2) valida período (≤366d, from≤to) + seções contra **lista fixa** (A2, desconhecida ⇒ erro); (3) agrega 14 seções com **tetos** (weight 1000, séries 500, docs 200, fotos 24) marcando `truncated`; (4) grava a trilha (record_count real); (5) retorna jsonb `{meta,patient,sections}`. Falha de autorização ⇒ **42501, transação desfeita** (nada gravado — A1).
- **Web:** `src/lib/api/report.ts` (RPC + `isReportAuthzError`), `src/lib/pdf/patientReportModel.ts` (PURO, monta o modelo do JSON), `PatientReport.tsx` (doc reusando `ReportShell`/primitivos, **aviso de truncamento A4**), `generatePatientReport.tsx` (RPC → modelo → fotos por URL assinada → blob → download), `ExportPatientReportButton.tsx` (período; **42501 ⇒ Sentry source:"authz" sem PII** + mensagem clara), ligado em `PatientProfilePage`. A RPC é o **ÚNICO** caminho para o pacote (o botão não busca dados por outra via). Relatórios existentes (Evolução/Pontos) **inalterados**.
- **Testes (dry-run migration+suíte+ROLLBACK): PASS.** vinculado exporta ✓ + 1 linha correta na trilha; admin ✓; não-vinculado/outra-clínica/externo/paciente/anon ⟂ **sem gravar sucesso**; seção desconhecida ⟂; período invertido/janela>366 ⟂; truncamento (501 eventos) ⇒ `truncated`+500+count real; trilha **imutável** (UPDATE/DELETE de cliente ⟂); leitura da trilha só admin/autor. Web: **vitest 45** (8 novos do modelo + truncamento) · tsc 0 · lint 0 · build 0.
- **Advisors:** antes 9 WARN authenticated_security_definer + 4 INFO; perf 37. Não aplicado ⇒ depois no apply auditado; **delta previsto +1 WARN** (`export_patient_report` SECDEF em public), perf inalterada (índices cobrem os FKs). Prod verificada intocada (tabela/fn=0, policies 101, ledger=0).
- **Kill switch (fail-closed):** `revoke execute on function public.export_patient_report(...) from authenticated` desativa a exportação sem afetar o resto (a trilha e o schema permanecem). Header da migration documenta.
- **Escopo/limite:** SÓ repo web + banco (Nível 1). **Nenhuma policy existente alterada** (só 1 tabela + 1 função novas). `app`/`patient-native` **não tocados**. PARADO para auditoria.

## 16. Log da Sessão REPORT-B (WP-REPORT Parte B — exportação multi-paciente + auditoria)
Branch `feat/patient-report-batch-web` (PR base main, **SEM MERGE**; **NÃO aplicado em produção** — dry-run em ROLLBACK). Gate: web origin/main `d9d7567`.
- **Decisão (lei):** o LOTE NÃO cria função de agregação — é N chamadas da MESMA RPC auditada (1 linha/paciente, mesmo `batch_id`); autz reavaliada por paciente; nenhuma superfície nova no banco.
- **Migration `20260729090000` (no PR, não aplicada):** `report_exports` ganha `batch_id uuid` (anulável) + índice parcial `idx_report_exports_batch`. `export_patient_report` ganha `p_batch_id` OPCIONAL (default null); a versão de 5 args é **dropada** (sem órfã/ambiguidade); EXECUTE só authenticated. **Autorização INALTERADA** (`can_prescribe_for_patient`); nenhuma policy existente tocada.
- **Web — lote:** `src/lib/pdf/batchReportModel.ts` (PURO: `runPatientBatch` sequencial, falha parcial não aborta, progresso; `buildBatchReportModel`), `BatchReport.tsx` (capa incluídos/falhados + 1 bloco/paciente, reusa `ReportShell`+`PatientReportSections`; sem embutir fotos p/ limitar tamanho), `generateBatchReport.tsx` (gera `batch_id`, N chamadas, PDF, download), `BatchReportPage.tsx` (seleção múltipla + período + progresso + resultado; teto **50** pacientes). Aviso de truncamento (A4) por paciente preservado.
- **Web — auditoria (Parte 3):** `ReportAuditPage.tsx` **admin-only** (`useIsClinicAdmin` = am_i_clinic_admin, NUNCA profiles.role); lista quem/paciente/quando/período/seções/registros/lote; filtros data+profissional+paciente; ordem desc; paginação. `listReportExports`/`listClinicProfessionalProfiles` (RLS escopa admin/autor; sem conteúdo clínico). Rotas `/relatorios/lote` e `/configuracoes/auditoria`; links em Pacientes (Exportar em lote) e Configurações (admin).
- **DECISÃO reportada:** a tela de auditoria é **admin-only** nesta fase; a visão pessoal do autor (a RLS já permite ler as PRÓPRIAS) fica como evolução (PENDENCIAS).
- **Testes:** dry-run (ROLLBACK) PASS — N linhas mesmo `batch_id`; paciente não-autorizado no meio ⟂ 42501 **sem gravar e sem abortar**; regressão 1-paciente sem `batch_id`; trilha imutável; leitura só admin/autor. Unit web (6): `runPatientBatch` (progresso + falha parcial não aborta), `buildBatchReportModel` (incluídos/falhados + truncamento por paciente). Gates: vitest **51** · tsc 0 · lint 0 · build 0.
- **Advisors:** baseline (pós-Parte A) 10 WARN + 4 INFO ; perf 40. Não aplicado ⇒ depois no apply; delta previsto: segurança inalterada (segue 1 export_patient_report SECDEF), perf **+1 unused_index INFO** (idx_report_exports_batch novo). Prod verificada intocada (batch_id=0; assinatura ainda 5 args; policies 102; ledger=0).
- **Kill switch (fail-closed):** `revoke execute on function public.export_patient_report(...,uuid) from authenticated` desativa a exportação (lote e individual). Rollback restaura a RPC de 5 args + remove batch_id/índice. Header documenta.
- **Escopo/limite:** SÓ repo web + banco. **Nenhuma policy existente alterada.** `app`/`patient-native` não tocados. PARADO para auditoria.

## 17. Log da Sessão KANBAN-A (WP-KANBAN Parte A — jornada do paciente: modelo/colunas/marcos)
Branch `feat/patient-journey-web` (PR base main, **SEM MERGE**; **NÃO aplicado em produção** — dry-run em ROLLBACK). Gate: web origin/main `10f48b6`. ESCOPO: SÓ banco (a UI é a Parte B).
- **Estado provado:** `patients.start_date` (date, default CURRENT_DATE) = início da jornada (não há created_at); `patients.birth_date` (date, nullable) = aniversário. NÃO havia conceito de etapa/kanban — o "status" de paciente é o VRI (`adherence_snapshots.status`, derivado), ortogonal.
- **Migration `20260730090000` (no PR, não aplicada):** 4 tabelas — `journey_columns` (colunas/clínica; 1 inicial via índice único parcial), `patient_journey_state` (atual), `patient_journey_moves` (append-only), `journey_milestone_ack` (reconhecimento). Offsets extensíveis `private.journey_day_offsets()` (add 180/365 = 1 linha). Seed padrão ("Novos"/"Em acompanhamento"/"Retorno"/"Concluídos") + backfill + trigger `after insert on clinics`.
- **RLS/policies:** `journey_columns` SELECT `is_clinic_member` / escrita `is_clinic_admin` (admin administra; comum só usa). `state`/`moves`/`ack` SELECT `can_access_patient`; **escrita só via RPC** (sem policy de escrita p/ cliente). `moves` **imutável** (sem UPDATE/DELETE).
- **RPCs (SECDEF, search_path='', EXECUTE só authenticated):** `move_patient_journey` (autz `is_clinic_admin OR is_common_professional_of_patient` — **externo NÃO move**; coluna destino tem de ser da MESMA clínica; **moved_by do servidor**; estado+histórico atômicos; from derivado = estado atual OU coluna inicial) e `ack_journey_milestone` (mesma autz; **acked_by do servidor**; chave canônica `start`/`birthday:YYYY`/`day_<offset>` validada).
- **K1:** `create_patient` ganhou `p_start_date` OPCIONAL (default null ⇒ CURRENT_DATE; **recusa data futura**). Versão de 13 args **dropada** (sem órfã/ambiguidade); revoke/grant reaplicados; **autorização interna inalterada**. Compatibilidade: chamada sem `p_start_date` idêntica.
- **Testes (dry-run migration+suíte+ROLLBACK): PASS.** move estado+histórico (autor correto), admin move, admin CRUD colunas, ack, paciente-sem-estado (deriva inicial), trigger semeia clínica nova, create_patient com/sem `p_start_date`. Negativos: não-vinculado/externo ⟂ mover; comum ⟂ criar coluna; cross-clínica ⟂; **forja moved_by/acked_by ⟂** (escrita só via RPC); histórico imutável; **duas iniciais ⟂**; chave desconhecida ⟂; **data futura ⟂**; leitura restrita; anon ⟂; **sem órfã** (1 assinatura de cada). Gates web: vitest 51 · tsc 0 · lint 0 · build 0 (DB-only, sem regressão).
- **Advisors:** baseline 10 WARN + 4 INFO; perf 39. Não aplicado ⇒ depois no apply; delta previsto: **+2 WARN** (`move_patient_journey`, `ack_journey_milestone`) + alguns INFO `unindexed_foreign_keys` (colunas de auditoria das novas tabelas, mesma classe dos 34 existentes). Prod verificada intocada (tabelas/RPCs=0; `create_patient` ainda 13 args; policies 102; ledger=0).
- **Kill switch (fail-closed):** `revoke execute` das RPCs desativa move/ack; rollback restaura `create_patient` de 13 args + dropa a jornada (header documenta). MARCO NÃO MOVE CARTÃO (só dado).
- **Escopo/limite:** SÓ banco. **Nenhuma policy existente alterada.** `create_patient` recriada (K1) mantendo autz. `app`/`patient-native` não tocados. PARADO para auditoria.

## WP-ARTE · A — Modelo de peça, consentimento por peça/versão, canais, termo, auditoria (SÓ BANCO)
Branch `feat/media-consent-model-web` (PR base main, **SEM MERGE**). **NADA aplicado em produção** (dry-run em ROLLBACK; migration+testes ficam no PR até auditoria). Gates web (tsc/lint/vitest/build) verdes — mudança só-banco (nenhum TS tocado).
- **Migration `20260731090000_wp_arte_a_media_consent.sql`** (no PR): 7 tabelas — `media_channels` (D2: canais em TABELA, seed instagram/site/whatsapp/tela_interna/impresso/anuncio_pago[is_paid_ad]), `media_pieces` + `media_piece_versions` (IMUTÁVEL) + `media_piece_version_professionals`, `media_consent_terms` (texto IMUTÁVEL por versão), `media_consents` (amarrado à VERSÃO; `origin` app|in_person com CHECK dos campos presenciais; status 6 estados; `expires_at`=granted+12m) + `media_consent_channels`.
- **Helpers `private`** (SECDEF, `search_path=''`): `media_piece_patient`/`media_version_patient`/`media_consent_patient`, `consent_blocked_by_age` (D4), **`media_version_channel_usable` (CANÔNICA)**.
- **RLS:** SELECT via helpers (**externo EXCLUÍDO**; paciente dono + staff interno/admin veem — D3 GERIR+DECIDIR); **escrita SÓ por RPC SECDEF** (nenhuma policy de INSERT/UPDATE/DELETE de client). **Nenhuma policy existente alterada.**
- **RPCs (autor DERIVADO do servidor):** `media_piece_create`, `media_piece_new_version` (D1 nova versão + guarda `content_hash`), `media_consent_grant_app` (paciente concede), `media_consent_record_in_person` (staff registra presencial), `media_consent_revoke` (só paciente, sozinho, sem justificativa), **`media_use_check` (D3 USAR — canônica)**, `media_consents_expiring` (D5 consultável).
- **Testes Nível 1** `supabase/tests/wp_arte_a_media_consent_test.sql` (dry-run ROLLBACK): **ALL_ASSERTIONS_PASSED**. Positivos: cria peça/versão; paciente VÊ; concede 12m (autor do servidor); canônica autoriza; presencial c/ campos+origem; revoga sozinho e corta o uso na hora. Negativos: sem consent / canal não autorizado / expirado / revogado; **consent de v1 NÃO vale p/ v2 (coração)**; prof não concede pelo paciente; presencial sem campos (RPC+CHECK); **menor/birth_date nula bloqueados (D4)**; externo/não-vinculado/outra clínica/anon; auditoria não alterável/apagável; revogação por não-dono.
- **Advisors:** antes (real) sec 16 / perf 44; NÃO aplicado ⇒ depois real == antes. Previsto se aplicado: **+7 WARN `authenticated_security_definer`** (as 7 RPCs — endpoint autenticado INTENCIONAL, segurança na revalidação interna), +~8 INFO `unindexed_foreign_keys` (colunas de auditoria) e +~8 INFO `unused_index` (índices novos em tabelas vazias). SEM `rls_enabled_no_policy` novo; SEM ERROR.
- **Decisões:** D1 dois níveis (versão vs consentimento) + content_hash; D2 canais em tabela; D3 três fronteiras; D4 menor bloqueado; D5 consultável (alertas+job = etapa D); D6 link 300s (documentado no termo). **V1 SEM foto** (campos `has_before_after_photo`/`photo_asset_path` PREVISTOS; RPCs fixam false/null). Lacunas (representante legal, notificação de staff, job 30d) → PENDENCIAS. **Kill switch fail-closed** no header (dropar = deny-by-absence). app/patient-native NÃO tocados.

## WP-ONBOARDING · Criação de clínica pelo próprio profissional (BANCO + WEB)
**✅ MERGEADA E APLICADA EM PRODUÇÃO em 2026-07-23.** PR **#27** MERGEADO (merge commit `3d49267`, base main); branch `feat/clinic-onboarding-web` (removida após o merge). Migration **`20260801090000_wp_onboarding_create_clinic.sql` APLICADA** (catálogo Supabase: version `20260723221137` / name `wp_onboarding_create_clinic`; ledger humano `public.schema_migration_log` = `20260801090000`). Verificado pós-apply: assinatura `create_clinic_with_owner(text)` com argumentos `p_name text` apenas, SECDEF, `search_path=""`, EXECUTE só `authenticated` (PUBLIC e `anon` = false por `has_function_privilege`); policies **116 / hash `d19d55adae35af55fb2b92db3a2adcc8` inalterados**. Advisors: security 23 → 24 (o +1 previsto é o WARN `authenticated_security_definer` da própria RPC, INTENCIONAL); performance 51 → 51. Gate original: origin/main `7b21180c7932dbe453fd023665755f2fcd02b79a` (contém WP-ARTE A / migration `20260731090000`). Resolve o vazio: não havia caminho para a PRIMEIRA clínica (cadastrar paciente exige ser profissional; virar profissional exige um admin promover; admin é dono de clínica — mas NADA criava clínica ⇒ intervenção manual no banco).
- **Estado provado (read-only):** `clinics` só exige `name` (id/owner_profile_id/created_at têm default/nullable; **não há colunas de documento/endereço/contato**). `professionals`: `type` (enum `professional_type` {doctor,nutritionist,physiotherapist,personal_trainer,other}) NOT NULL sem default + `clinic_role` NOT NULL default 'member' CHECK∈{member,admin}; profile_id/clinic_id nullable; registry_number/specialty opcionais; **sem unique em profile_id** ⇒ guarda-corpo é da RPC. `profiles.role` (enum `user_role`) e `status` (default 'active'); 1º login sem match → `handle_new_user` cria `role='patient', status='pending'`. **Nenhuma função criava clínica** (confirmado) — sem duplicação.
- **Migration `20260801090000_wp_onboarding_create_clinic.sql`** (no PR, não aplicada): UMA RPC **`create_clinic_with_owner(p_name text) → jsonb{clinic_id, professional_id}`** (SECURITY DEFINER, `search_path=''`, EXECUTE só `authenticated`, revoke public/anon). Passos: (1) autor SEMPRE do servidor `private.current_profile_id()`←`auth.uid()` (**não forjável**: assinatura sem owner); (2) **guarda-corpo — UMA clínica por perfil COMO DONO** (recusa a 2ª: errcode 42501, hint `ALREADY_OWNS_CLINIC`); (3) valida nome (obrigatório; **2..120** chars, hints `NAME_REQUIRED`/`NAME_TOO_SHORT`/`NAME_TOO_LONG`); (4) cria `clinics(name, owner_profile_id=chamador)`; (5) cria `professionals(profile_id=chamador, clinic_id, type='other', clinic_role='admin')` — valores mínimos coerentes; (6) destrava o perfil `role='professional', status='active'` (**COSMÉTICO** — autoridade continua sendo posse/clinic_role; `is_clinic_admin` NÃO lê `profiles.role`, AUTH-ADMIN-1); (7) **transacional tudo-ou-nada** (plpgsql única, sem COMMIT/EXCEPTION interno).
- **PORTÃO COMERCIAL (decisão futura do cliente): NÃO implementado**; **UM ÚNICO ponto de encaixe COMENTADO** dentro da função (após a auth, antes de qualquer escrita) — quando ligado, lança `ONBOARDING_NOT_ALLOWED` (a web já trata o hint; mensagem pronta). Não espalha lógica.
- **Web:** `PendingAccessPage` reescrita com **DOIS caminhos** — (1) "Criar minha clínica" (`CreateClinicForm`: nome → valida → `useCreateOwnClinic`→RPC → confirmação + próximos passos [Pacientes / Configurações→Disciplinas] → "Ir para o painel" que **invalida a identidade** `profileByAuthUser`/`currentProfessional`/`clinicAdmin` ⇒ entra como admin) e (2) "Fui cadastrada por uma clínica" (texto + Sair, comportamento anterior). Estados de carregamento/erro tratados; erro da RPC vira mensagem por `hint` (`src/lib/domain/clinicOnboarding.ts`, PURO/testado); só o INESPERADO vai ao Sentry (`source:"onboarding"`, **sem PII** — nunca o nome). Reusa a identidade e o sinal de admin existentes (não duplica `am_i_clinic_admin`).
- **Testes Nível 1** (dry-run: migration + suíte numa transação encerrada por RAISE ⇒ ROLLBACK): **ALL_ASSERTIONS_PASSED** + zero impacto em produção (função ausente, ledger 0, tabelas 0, policies 116 / hash inalterado). Positivos: pendente cria ⇒ dono correto + `professionals` admin (type='other') + perfil destravado + `am_i_clinic_admin(null/clinic)`=true + cadastra paciente + promove+atribui disciplina. Negativos: **2ª clínica ⟂** (guarda-corpo, hint), **dono não-forjável** (owner=chamador), **anon ⟂**, **sem acesso a clínica alheia** (não vê clínica/pacientes de B; não é admin de B), **nome vazio/whitespace/curto/longo ⟂** (hints) sem estado parcial, **atomicidade** (create ok + rollback do subtxn ⇒ clínica+professional+perfil revertem JUNTOS). Regressão: `promote_to_professional`/`create_patient`/`assign_professional_discipline` seguem OK; **policies 116 / hash `d19d55adae35af55fb2b92db3a2adcc8` inalterados** (a migration só ACRESCENTA a função).
- **Unit web (12):** `clinicOnboarding.test.ts` — `validateClinicName` (obrigatório/2..120/trim, limites 2 e 120) + `onboardingErrorMessage` (traduz hint; genérica sem vazar; `ONBOARDING_NOT_ALLOWED` já mapeado) + classificação p/ Sentry. Gates web: **vitest 96 (9 files) · tsc 0 · lint 0 · build 0**.
- **Advisors:** antes (real, pós-WP-ARTE) **sec 23 / perf 59**; NÃO aplicado ⇒ depois real == antes. Previsto se aplicado: **+1 WARN `authenticated_security_definer`** (`create_clinic_with_owner`, SECDEF intencional; endpoint autenticado com portão interno) → sec 24; perf inalterada (sem tabela/índice novo).
- **Kill switch (fail-closed):** `revoke execute on function public.create_clinic_with_owner(text) from authenticated` desativa a criação sem afetar o resto; rollback = `drop function`. Header documenta.
- **Escopo/limite:** SÓ repo web + banco. **Nenhuma policy existente alterada; nenhuma tabela nova.** `app`/`patient-native` NÃO tocados. PARADO para auditoria.
## WP-DISC-FIX · Admin pode atribuir disciplina a si mesmo (destrava a clínica solo)
**✅ MERGEADA E APLICADA EM PRODUÇÃO em 2026-07-23** (depois do PR #27, na ordem obrigatória). PR **#29** MERGEADO (merge commit `78f7577`, base main); branch `feat/disc-admin-self-assign` (removida após o merge). Migration **`20260802090000_wp_disc_fix_admin_self_assign.sql` APLICADA** (catálogo Supabase: version `20260723222251` / name `wp_disc_fix_admin_self_assign`; ledger humano `20260802090000`). Verificado pós-apply: `assign_professional_discipline` NÃO tem mais o bloco de self; `revoke_professional_discipline` byte-idêntica (md5 `da02add70f2656094611812eb77f51c9`); policies **116 / hash inalterados**; advisors sem lint novo. **FLUXO SOLO PROVADO PONTA A PONTA CONTRA A PRODUÇÃO** (transação com ROLLBACK): criar clínica → é admin → cadastrar paciente → sem disciplina o plano é NEGADO → auto-atribuir nutricionista → plano alimentar SALVO; negativos ⟂ (não-admin a si/a terceiros, clínica alheia, anon, 2ª clínica com hint `ALREADY_OWNS_CLINIC`, dono não forjável). Gate original: `origin/main` `5ac0c296b9add3fc9256988eb36e0a4b2358dd6e` (era `7b21180…`; a diferença é **docs-only**: `README.md`, 1 linha — caracterizada e aceita).
- **Impasse resolvido:** `create_clinic_with_owner` (WP-ONBOARDING/PR #27) cria o dono como `professional type='other'` **sem disciplina** → sem disciplina não escreve nada clínico (WP-DISC A) → conceder exigia OUTRA pessoa → numa clínica nova não há outra pessoa. A clínica nascia **travada**, atingindo a persona do plano de entrada (profissional solo).
- **Estado provado (read-only, no banco):** `assign_professional_discipline` negava o self com `if exists (select 1 from public.professionals where id = p_professional_id and profile_id = private.current_profile_id()) then raise … 'self-assignment is not allowed' (42501)`, **depois** do gate de admin ⇒ negava inclusive o admin. **`revoke_professional_discipline` NUNCA teve trava de self** (só exige `is_clinic_admin`) — o auto-revogar já era permitido. `create_clinic_with_owner` **não** concede disciplina alguma. UI: `DisciplinesAdminPage` desabilitava os chips do próprio admin (`disabled={isSelf || …}`) com o aviso "Você não pode atribuir disciplinas a si mesmo(a)".
- **Migration `20260802090000_wp_disc_fix_admin_self_assign.sql`** (no PR, **não aplicada**): `create or replace` de **uma única função** — `public.assign_professional_discipline(uuid,text)` — **removendo** o bloco de auto-atribuição. Não há condição nova a acrescentar: o gate `private.is_clinic_admin(<clínica do ALVO>)` PRECEDE a escrita, logo o self só é alcançável pelo ADMIN da clínica do alvo. **`revoke` intocada** (nada a mudar). **Nenhuma policy, tabela, coluna, índice, enum ou grant alterados.** SECDEF · `search_path=''` · EXECUTE só `authenticated` (reafirmado, idempotente). Header traz ROLLBACK verbatim (repõe a negação) e KILL SWITCH (`revoke execute … from authenticated`).
- **Web:** `DisciplinesAdminPage` — `disabled` deixa de usar `isSelf`; a própria linha ganha o marcador "(você)" e passa a mostrar a contagem de disciplinas como as demais; `aria-label` diz "de você". O bloqueio ao NÃO-admin **não mudou**: a página inteira é fail-closed por `useIsClinicAdmin` (RPC `am_i_clinic_admin`) com a mensagem "Apenas o administrador da clínica gerencia as disciplinas da equipe.". Comentários de `src/lib/api/disciplines.ts` e `docs/ops/DISCIPLINES_UI.md` alinhados à nova regra.
- **Testes Nível 1** `supabase/tests/wp_disc_fix_admin_self_assign_test.sql` (dry-run ROLLBACK): **ALL_ASSERTIONS_PASSED**. Positivos: admin atribui a si (com `granted_by` = ele) e revoga de si; segue atribuindo a terceiros; **FLUXO COMPLETO DA CLÍNICA SOLO** — criar clínica → é admin → cadastra paciente → **prova o impasse** (sem disciplina, `save_nutrition_plan` negado) → atribui `nutricionista` a si → **salva o plano alimentar** (plano + refeição gravados). Negativos: não-admin a si ⟂ e a terceiros ⟂; admin em clínica ALHEIA ⟂ (assign e revoke); anon ⟂ (assign e revoke); disciplina inexistente ⟂. Regressão: admin SEM disciplina não escreve (DISC-ADMIN-1) e **nutricionista ⟂ treino**; **suíte completa do WP-DISC A re-executada com a migration aplicada: 48/48** (inclusive `N_selfassign`, que usa um NÃO-admin e segue negado). **Controle negativo:** sem a migration, o self do admin é negado ⇒ a suíte não passa por vacuidade. Policies **116 / hash `d19d55adae35af55fb2b92db3a2adcc8`** idênticos antes e depois.
- **Advisors:** antes (real) **security 23 / performance 51**; NÃO aplicado ⇒ depois real == antes. Previsto se aplicado: **nenhum advisor novo** (a função já existia e já era SECDEF executável por `authenticated`; sem tabela/índice/policy novos).
- **Escopo/limite:** SÓ repo web + banco. `app`/`patient-native` NÃO tocados. Dependência: o bloco SOLO da suíte exige o PR #27 (não mergeado); se ausente, marca `SOLO_SKIPPED_NO_PR27` em vez de passar calado. PARADO para auditoria.

## WP-SEED · Ambiente de testes + limpeza de pendências (DADO, não estrutura)
Branch `feat/test-seed-web` (PR base main, **SEM MERGE**). Gate: `origin/main` `8e5204eaa0b0b88916e8bd211a6235397f5affa5` (era `78f7577…`; diferença **docs-only**: `README.md`, 1 linha, build18→build19 — caracterizada e aceita). **Seed APLICADO em produção em 2026-07-23** (é DADO; **não** é migration e **não** entra em nenhum ledger).
- **Housekeeping:** (a) EXECUTION_STATE e PENDENCIAS corrigidos — as seções de WP-ONBOARDING e WP-DISC-FIX diziam "SEM MERGE / NÃO aplicado" e agora registram PR #27 (`3d49267`) e PR #29 (`78f7577`) mergeados, as migrations aplicadas e as versões do catálogo. (b) Branches remotas mergeadas **removidas** (`feat/clinic-onboarding-web`, `feat/disc-admin-self-assign`), após provar contenção na main. (c) **Storage: PARADO por segurança** — os 2 objetos demo (`progress-photos`, `demo/mariana/*`) NÃO foram removidos: `storage.objects` tem o trigger `protect_objects_delete` (bloqueia DELETE por SQL) e apagar a linha de metadado por SQL deixaria o binário órfão no backend; o repo só tem a chave **anon** (`.env`), e a remoção coerente exige a Storage API com `service_role` ou o Dashboard. Comando pronto no retorno.
- **Ledger (SÓ DIAGNÓSTICO, não corrigido):** 67 arquivos × 69 linhas do catálogo ⇒ **46 dessincronizados** (mesmo nome, version diferente), 21 batendo por version (1 com nome diferente), **2 linhas órfãs** sem arquivo no repo, **0 arquivos por aplicar**. Comando de reconciliação proposto no retorno; escrita em `schema_migrations` aguarda autorização explícita.
- **Tensão dos perfis (PASSO 3.1) — RESOLVIDA com evidência empírica (ensaio em ROLLBACK):** `handle_new_user` casa por e-mail **exigindo `auth_user_id IS NULL` e exatamente 1 match**, e então faz `update profiles set auth_user_id = <novo user>` (outcome `linked`). Provado: (A) perfil semeado com `auth_user_id` NULL + e-mail igual ⇒ **vinculado**, status preservado, nenhum perfil extra; (B) perfil com `auth_user_id` SINTÉTICO ⇒ o trigger **ignora** o semeado e cria um segundo perfil `patient`/`pending`. Como não há FK de `profiles.auth_user_id` para `auth.users`, o modo (B) falharia em **silêncio**. **Escolha: semear com `auth_user_id = NULL` + e-mail real**; o seed usa ids sintéticos apenas durante a execução (para chamar as RPCs como cada ator) e os **zera no último passo**.
- **Seed pelos CAMINHOS REAIS:** `create_clinic_with_owner` → `assign_professional_discipline` (auto-atribuição da dona, WP-DISC-FIX) → `promote_to_professional` → `assign_professional_discipline` → `create_patient` (com `p_start_date`) → `save_workout_plan` (pelo educador físico) / `save_nutrition_plan` (pela nutricionista) → `move_patient_journey`. **INSERT direto só onde não há RPC** (profiles de profissional, vínculos extras, auto-registros do paciente, chat) — cada caso justificado no cabeçalho do script.
- **Cenário:** Alfa (dona admin nutricionista, educador_fisico, medico+nutricionista, **um sem disciplina e sem nenhum paciente** ⇐ o caso do teste de isolamento, e um **externo** ligado a 1 só paciente) + Beta (1 profissional, 1 paciente). 4 pacientes na Alfa: −100d (marcos 30/60/90 ocorridos), −28d (marco de 30 na janela de 7 dias), −3d (recente) e **aniversário nos próximos 7 dias**; todos com `birth_date` e maiores de idade. 1 plano de treino ABC + 1 alimentar (5 refeições), 15 pesagens, 21 dias de hidratação, 14 dias de refeições, 12 sessões de treino com séries, 1 conversa por paciente **nos dois sentidos** e 2 pacientes movidos na jornada (3 movimentos = histórico). **Sem** anexos/fotos (exigem binário no bucket) e **sem** peças de mídia.
- **Rastreabilidade:** âncora = 6 profiles com id determinístico `md5('wp-seed:v2:'||chave)::uuid`; todo o resto por FK. **Idempotente** (guarda pelo profile-âncora) e **reversível** (`wp_seed_test_data_remove.sql`, entregue junto).
- **Ensaio (ROLLBACK):** seed → contagens/relações → **seed 2ª vez** (snapshot idêntico ⇒ idempotência) → remoção (**volta exatamente ao inicial**) — tudo numa transação revertida. **Policies 116 / hash `d19d55adae35af55fb2b92db3a2adcc8` e hash do schema inalterados.** Relações conferidas: 2 clínicas com dono, 6 vínculos de disciplina, 1 profissional sem disciplina, 1 sem nenhum paciente, 1 vínculo externo, 0 pacientes sem nascimento, 0 menores, 1 com marcos 30/60/90, 1 com marco de 30 na janela, 1 com aniversário em 7 dias, 5 conversas com mensagem dos dois lados, 6 âncoras com `auth_user_id` NULL.
- **Escopo/limite:** SÓ repo web + dado no banco. Nenhuma migration, policy ou função de produto. `app`/`patient-native` NÃO tocados.

## WP-JOIN-1 · Solicitação de acesso à clínica (o profissional pede, o admin aprova)
Branch `feat/clinic-join-requests-web` (PR base main, **SEM MERGE**). Gate: `origin/main`
`939a2ea9471ec620430f19fd00aa32c3afabb1cc` (esperado `4db5789…`; diferença **docs-only**:
`README.md`, 1 linha — caracterizada e aceita). **Migration NÃO aplicada em produção.**
- **PR #33 (WP-TEAM-JOIN) FECHADO sem merge** e branch remota `feat/team-join-web` removida: foi
  desenhado antes da inversão de fluxo. Verificado antes de fechar que **nada dele havia sido
  aplicado** (join_code, tabela, RPCs e ledger todos ausentes; policies 116). Código NÃO reaproveitado.
- **Desenho (lei do dono): INVERSÃO DE DIREÇÃO.** O admin nunca descobre um pendente; o profissional
  pede acesso a UMA clínica com o código dela. O pedido nasce com `clinic_id` ⇒ leitura do admin é
  RLS trivial. Sem consulta global, sem oráculo de e-mail, sem dependência de envio de e-mail.
- **Banco (`20260803090000_wp_join1_clinic_join_requests.sql`, ADITIVA):** `private.new_join_code()`
  (base32 sem `O/0/I/1`, 8 chars) · `clinics.join_code` único, **NOT NULL com DEFAULT** + backfill ·
  `public.clinic_join_requests` (RLS: próprio solicitante OU `is_clinic_admin(clinic_id)`; escrita só
  por RPC) · RPCs `request_clinic_access` (idempotente, erro **neutro** para código inexistente),
  `approve_join_request` (CHAMA `promote_to_professional`, intocada), `reject_join_request`,
  `rotate_clinic_join_code`.
- **O DEFAULT não é opcional** — verificado lendo a função em produção: `create_clinic_with_owner`
  faz `insert into clinics (name, owner_profile_id)` sem informar `join_code`; `NOT NULL` sem
  `DEFAULT` quebraria a criação de clínica. Coberto pelo teste de regressão R1.
- **`approve_join_request(p_request_id)` tem UM parâmetro** (assinatura do WP), mas
  `promote_to_professional` exige `p_type` — adotado `'other'`, o MESMO tipo com que
  `create_clinic_with_owner` cria o dono. Coerente: `type` é grosso e a capacidade real vem das
  DISCIPLINAS; o admin ajusta depois (`professionals_admin_write` já concede UPDATE de `type`).
- **`rotate_clinic_join_code` recebe `p_clinic_id`** (o WP escreveu `()`): um profile pode
  administrar mais de uma clínica, e sem o parâmetro a função seria ambígua. Gate inalterado.
- **Dry-run em transação com ROLLBACK contra produção: VERDE.** P1–P6, N1–N10 e R1 passaram.
  Destaques: **admin de A ⟂ pedido de B (zero linhas)**, admin de outra clínica ⟂ aprovar/rejeitar,
  código inexistente ⇒ `P0002` com mensagem que não revela existência de clínica, 2º pedido idêntico
  não duplica, INSERT/UPDATE direto negado, autor não forjável, `create_clinic_with_owner` segue
  funcionando com a coluna NOT NULL.
- **Regressão provada por HASH, não por inspeção:** durante a transação as policies foram **117**
  (= 116 + 1 nova, nenhuma alterada) e `promote_to_professional` manteve o hash
  `b377d4b1cc40068a50627622e4b230a3`. Após o ROLLBACK: policies **116**, hash do conjunto
  `344f56bfc05c45eaa2909aaa427b3571`, e `promote_to_professional` / `create_clinic_with_owner` /
  `handle_new_user` com hashes idênticos ao baseline. Zero resíduo.
- **Advisors:** inalterados em natureza (4 INFO `rls_enabled_no_policy` pré-existentes + WARNs
  `authenticated_security_definer_function_executable` + `auth_leaked_password_protection`). As 4
  RPCs novas somam ao MESMO WARN 0029 já aceito para todas as RPCs do produto — é o padrão da casa
  (a segurança é a checagem interna `is_clinic_admin`, não a ausência de EXECUTE).
- **Web:** `PendingAccessPage` — o ramo "fui cadastrada por uma clínica" era **texto morto**; virou
  campo de código + "Solicitar acesso", com pré-preenchimento por link `?code=`, estado "aguardando
  aprovação" e retomada após rejeição. `SettingsPage` — código da clínica (copiar código / copiar
  convite pronto / gerar novo, com confirmação) e indicador de N pedidos pendentes, tudo só para
  admin; o `SoonButton` "Convidar profissional" foi **substituído** (o código É o convite no v1).
- **Kill switch:** revogar EXECUTE das 4 RPCs desliga o fluxo sem afetar o resto (documentado no
  cabeçalho da migration).
- **Gates:** eslint 0 · tsc 0 · vitest **115/115** (96 + 19 novos em `clinicJoin.test.ts`) · build OK.
- **Escopo/limite:** SÓ repo web + migration não aplicada. Nenhuma policy existente alterada.
  `promote_to_professional`, `handle_new_user` e a resolução de identidade **não tocados**.
  `app`/`patient-native` NÃO tocados. PARADO para auditoria.

## WP-CHAT-FIX — criação de canal por RPC + leitura por vínculo vivo (2026-07-28)

**Estado: implementada, TESTADA em transação com ROLLBACK, NÃO aplicada.** Branch
`feat/chat-channel-rpc-web`, base `origin/main` = `626b674`. PR aberto SEM MERGE.

- **Bug 1 (42501 ao abrir conversa de paciente sem canal).** O front fazia `INSERT…RETURNING`
  (`.insert().select()`) em `chat_channels`. Diagnóstico refinado pela prova: **o INSERT passa**
  (o `WITH CHECK` é `can_access_patient_internal` e é verdadeiro) — quem falha é **só o
  RETURNING**. Na mesma statement a policy de SELECT chama `private.channel_patient()`, que é
  **STABLE** e usa o snapshot do início da statement, logo **não enxerga a linha que a própria
  statement insere** ⇒ `NULL` ⇒ `is_clinic_admin(NULL)` = false ⇒ `can_read_channel` = false.
  **Não é recursão de policy: é visibilidade de snapshot.** Provado: num statement SEPARADO a
  mesma linha É legível.
- **Bug 2 (profissional comum vinculado não lia).** `can_read_channel` só concedia leitura a
  participante ou admin, e **nada** populava `chat_participants` além do seed. Já estava vivo:
  Bruno Salles e Clara Vieira, vinculados ativos a pacientes COM canal, não liam.
- **Bug 3 (achado durante o WP, não previsto).** `chat_messages_insert` exige
  `is_channel_participant` e **não tem ramo de admin** — o admin abria e lia o canal novo mas
  **não conseguia enviar** (42501). Por isso popular o roster não é opcional.
- **Correção (3 peças).** RPC `public.get_or_create_channel` (SECURITY DEFINER, `search_path=''`,
  EXECUTE só `authenticated`) autoriza com `can_access_patient_internal` — o MESMO gate do
  `WITH CHECK` — faz `on conflict (patient_id) do nothing` + SELECT (fora do RETURNING sob RLS) e
  **reconcilia o roster**. `private.can_read_channel` passa a
  `is_channel_participant OR can_access_patient_internal(channel_patient(...))` — **aditiva**: o
  ramo de admin já estava contido no novo predicado. **Escrita intocada** (assimetria deliberada:
  vinculado LÊ na hora, ESCREVE quando o canal é aberto pela RPC).
- **Backfill único, só aditivo:** +2 linhas de participante (Bruno e Clara). **Elisa Rocha ficou
  de fora corretamente — `is_external = true`**, e virou o melhor caso de teste negativo.
- **Testes (Nível 1, `request.jwt.claims`, ROLLBACK): 11 positivos + 11 negativos + 9 de vínculo
  vivo + 16 de regressão, todos verdes.** Destaques: comum vinculado LÊ e ESCREVE; idempotência
  (2ª chamada devolve o mesmo canal); externo ⟂; outra clínica ⟂; não-vinculado ⟂; anon ⟂;
  auto-inserção no roster ⟂ (42501); **vínculo vivo nos dois sentidos** — vincular ⇒ passa a ler
  SEM reabrir o canal e SEM linha no roster (prova que a leitura é derivada); desvincular ⇒ para
  de ler.
- **Limite honesto (V7):** quem **já estava** no roster continua lendo até a próxima abertura do
  canal, quando a RPC reconcilia e remove a linha (V8/V9 provam que aí perde leitura E escrita).
  A leitura derivada é imediata; a do roster é *eventual*. Registrado em PENDENCIAS.
- **Regressão por HASH:** `POLICIES_CHAT_HASH` **idêntico** (`166048e3…`, 11 policies) — nenhuma
  policy alterada. `HELPERS_HASH` mudou (`3d1a22c7…` → `54177cae…`) **porque a correção é o corpo
  de `can_read_channel`**; o hash dos **4 helpers não tocados** é idêntico
  (`0f54218f453b096a4f9f00bfa9b6ec64`), provando que só ele mudou. ACL, `security definer`,
  `stable` e `search_path=''` preservados pelo `create or replace`.
- **Advisors:** lint 0029 (SECURITY DEFINER executável por `authenticated`) 24 → **25**: +1 da
  classe já aceita para todas as RPCs do produto. Nenhuma classe nova.
- **Web:** `getOrCreateChannel` chama a RPC; novo `ChatThreadError` com a **etapa**
  (`channel` | `messages`) — a tela mostra "Não foi possível abrir a conversa" vs "Não foi
  possível carregar as mensagens" (o erro genérico anterior foi o que escondeu o 42501), e o
  Sentry recebe `source:"chat"` com scope `open-channel`/`load-messages`, **sem PII**.
- **Kill switch:** `revoke execute on function public.get_or_create_channel(uuid) from authenticated;`
- **Gates:** eslint 0 · tsc 0 · vitest **133/133** · build OK.
- **Escopo:** só o repo web. `chat_messages_insert`, identidade e os demais helpers **não tocados**.
  `app`/`patient-native` **NÃO tocados**. PARADO para auditoria.

## WP-TEAM-2b-i — desativação do vínculo profissional↔paciente (2026-07-28)

**Estado: migration escrita e PROVADA em transação com ROLLBACK, NÃO aplicada.** Branch
`feat/team-2bi-link-deactivation`, base `origin/main` = `9709bdb`. PR aberto SEM MERGE.
**Frontend NÃO entrou neste PR** — sem âncora óbvia na UI; opção reportada, aguardando decisão.

- **A tese, provada por hash:** `is_common_professional_of_patient` E
  `is_external_professional_of_patient` já filtram `coalesce(status,'active')='active'`. Logo
  virar o status para `inactive` derruba o acesso clínico inteiro — interno **e** externo —
  **sem tocar em uma linha de RLS**. GATE do PASSO 0 confirmou o filtro no ramo externo.
- **Entregue:** 3 colunas de carimbo em `professional_patient_links`; tabela IMUTÁVEL
  `ppl_status_events` (append-only: só policy de SELECT para admin da clínica, escrita só pelas
  RPCs); RPCs `deactivate_patient_link`, `reactivate_patient_link` e
  `patients_without_active_professional` (SECURITY DEFINER, `search_path=''`, EXECUTE só
  `authenticated`).
- **DÍVIDA V7 FECHADA:** desativar remove o profissional de `chat_participants` na MESMA
  transação. Provado: o desativado para de LER o canal (0 mensagens visíveis) **e** recebe
  42501 ao tentar ESCREVER. Sem esse DELETE a escrita sobreviveria até alguém reabrir a conversa.
- **PROVAS:** P1 — as **49 tabelas pré-existentes com hash de policy idêntico item a item**;
  único delta no `HASH_GLOBAL` (`e173eb30…` → `be1e5687…`) é a policy nova
  `ppl_status_events_select`; 107 → 108. P2 — **48 helpers de private com hash agregado
  IDÊNTICO** (`18b93d8411d3914247e9056ea4ec207c`), nenhum alterado. P3 — 4 âncoras idênticas
  (`b79d76307765af2f5efe842d98678cff`). P4 — lint 0029 25 → 28 (+3, as RPCs novas), lint 0008
  inalterado, `anon` não executa nenhuma. Nenhuma classe nova.
- **Matriz:** PERDA 1–5 (internas, `can_access_patient`, escrita, `patients_update`, chat),
  idempotência (2 desativações ⇒ 1 evento), reativação (lê na hora; escreve após reabrir),
  NÃO-GANHO 8–10 (outro comum ativo, admin e a própria paciente **idênticos item a item**),
  negativos 11–14 (outra clínica, comum inclusive no próprio vínculo, externo e anon ⇒ 42501),
  trilha imutável (UPDATE/DELETE/INSERT direto negados) e preservação (linha do vínculo e
  mensagens com autoria intactas).
- **Gates:** eslint 0 · tsc 0 · vitest 133/133 · build OK.
- **Escopo:** só o repo web. Nenhuma policy existente alterada, nenhum helper alterado,
  identidade e `promote_to_professional` intocados. NÃO faz soft-delete de `professionals`.
  `app`/`patient-native` NÃO tocados. PARADO para auditoria.

### EMENDA (endurecimento antes da aplicação) — mesmo PR #37, mesma migration `20260805090000`

**Estado: emenda escrita e PROVADA em transação com ROLLBACK, migration segue NÃO aplicada.**

- **VERIFICAÇÃO QUE PRECEDEU A EMENDA (o filtro de role do DELETE está completo).** O `DELETE`
  em `chat_participants` dentro de `deactivate_patient_link` filtra `role='professional'`. Medido
  no banco: **0 linhas** de `chat_participants` cujo `profile_id` é de um profissional com
  `role <> 'professional'`, e **0 linhas** cujo `profile_id` não é nem a paciente do canal nem
  profissional. As 16 linhas se dividem em 7 `patient` (todas = a paciente do próprio canal) e
  9 `professional` (todas = profissional de verdade). `role='admin'` em `chat_participants`: **0**.
  Nenhum profile é simultaneamente `professionals` e `patients`. **O filtro fica como está.**
- **A EMENDA:** `revoke update (status) on public.professional_patient_links from authenticated`.
  Fecha o UPDATE direto e torna as RPCs o **único** caminho de mudança de status. Sem ela, um
  UPDATE direto do admin (autorizado por `ppl_admin_write`, FOR ALL) cortava o acesso **sem**
  gravar trilha e **sem** remover o profissional do roster do chat — o desativado ficava sem
  acesso a nenhum dado clínico **mas ainda escrevendo na conversa** da paciente.
- **É PRIVILÉGIO, NÃO POLICY.** `HASH_GLOBAL` com a migration emendada aplicada em transação =
  **`be1e56872bdd6d6fcfb8f2eb937753c5` (108)** — **o mesmo valor** do retorno anterior. 48 helpers
  `18b93d8411d3914247e9056ea4ec207c` e 4 âncoras `b79d76307765af2f5efe842d98678cff`, ambos
  idênticos. O `relacl` da tabela é **byte a byte igual** antes/depois; o único delta é o
  `attacl` da coluna `status` (`{authenticated=w/postgres}` → sem grant).
- **PROVAS NOVAS (transação + ROLLBACK):** **T-A** admin (que PASSA na RLS — checado) tenta
  `update … set status` ⇒ **42501 `permission denied for table professional_patient_links`**.
  **T-B** o mesmo admin faz `update … set is_external` ⇒ **1 linha afetada**; `INSERT`+`DELETE` de
  vínculo também intactos ⇒ o revoke é cirúrgico, não bloqueio geral. **T-C** a RPC
  `deactivate_patient_link` **continua funcionando** depois do revoke (SECDEF roda como owner, que
  tem UPDATE de TABELA): status → `inactive`, 1 evento na trilha com autor do servidor, roster do
  profissional zerado e a linha da PACIENTE preservada. Extra: as 3 colunas de carimbo também são
  ingraváveis pelo client (42501).
- **`anon` não perdeu nada** (a Fam1 já o deixara sem UPDATE nesta tabela); **`service_role` e o
  owner `postgres` intactos** (UPDATE de TABELA não é recortado por privilégio de coluna).
- **⚠️ DÍVIDA-PRIV-1 (registrada em `docs/PENDENCIAS.md` e no cabeçalho da migration):** um
  `grant all on all tables in schema public to authenticated` futuro **desfaz este revoke
  silenciosamente** — sem erro e **sem alterar policy**, logo nenhuma prova de RLS deste PR
  detectaria. Teste de regressão barato:
  `has_column_privilege('authenticated','public.professional_patient_links','status','update')`
  deve ser **false** (e `is_external` deve seguir **true**). Mesma fragilidade vale para todos os
  recortes de coluna da WP-05B Fam1 (`20260711095000`).
- **Resíduo das provas: ZERO** — tabela/RPCs/colunas/ledger inexistentes, fixtures ausentes,
  10 vínculos todos `active`, 16 participantes, `HASH_GLOBAL` de volta a `e173eb30…` (107).
- **Gates:** eslint 0 · tsc 0 · vitest 133/133 · build OK. Frontend NÃO tocado (nenhum arquivo
  em `src/`). `app`/`patient-native` NÃO tocados. PARADO para auditoria.
