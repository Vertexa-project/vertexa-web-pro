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
