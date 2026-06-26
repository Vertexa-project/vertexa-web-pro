# QA S8 — Release Gate (web ↔ app ↔ Supabase)

Data: 2026-06-26 · Sessão 8 (retomada).

## 1. Status do gate do ledger

Status: **`APLICADA`**

A migration `supabase/migrations/20260626123000_schema_migration_log_internal_only.sql` foi aplicada no
Supabase remoto **via MCP administrativo** (disponível nesta sessão; estava indisponível na sessão
interrompida — daí o `BLOCKED_REMOTE_MIGRATION` anterior). `supabase db push`/`db reset` NÃO foram usados.

Evidência (queries da Fase 2, pós-aplicação):

| Verificação | Esperado | Obtido |
|---|---|---|
| `count(*) schema_migration_log` | 12 (== 12 arquivos `.sql` locais) | **12** |
| `pg_policies` em `schema_migration_log` | nenhuma policy anon/authenticated (sem `miglog_read`) | **`[]`** |
| `has_table_privilege('anon', …, 'select')` | false | **false** |
| `has_table_privilege('authenticated', …, 'select')` | false | **false** |
| `relrowsecurity` | true | **true** |

O ledger continua sendo registro técnico **interno** (Supabase/MCP/migrations): sem API client, rota,
hook, componente ou leitura por `anon`/`authenticated`. O runbook `docs/ops/APPLY_S7_LEDGER_HARDENING.md`
foi marcado como aplicado (mantido como registro reproduzível).

## 2. Legenda de resultados

- `APROVADO_E2E` — escrita real → persistência → reflexo (no outro app **ou** round-trip no mesmo app),
  comprovada NESTA sessão. Onde for round-trip de um lado só, o rótulo traz o qualificador (ex.: "round-trip web").
- `APROVADO_LOCAL_UI` — UI renderiza dado real persistido (confirmado via MCP) + caminho de escrita
  conferido no código dos dois repos; a escrita app-UI não foi reexecutada nesta sessão.
- `NÃO_COMPROVADO` — não houve prova ponta a ponta nesta sessão (sem escrita controlada com cleanup seguro).
- `BLOQUEADO_POR_ACESSO` — depende de acesso/privilégio ausente.
- `MOCKADO` — placeholder de UI, sem backend real.

> Escrita controlada: só nos fluxos com cleanup simétrico claro (delete por id), em paciente seed
> (Mariana `…b1`), revertida imediatamente. Onde o cleanup seria arriscado (ex.: binário no bucket),
> não houve escrita → `NÃO_COMPROVADO`.

## 3. Matriz QA web ↔ app

| Fluxo | Origem (escrita) | Persistência | Reflexo web/app | Evidência | Resultado |
|---|---|---|---|---|---|
| **Hidratação** | app `Habits` "+0.25L" → `activity_events(hydration_logged, payload.liters)` | escrita controlada hoje (id `aea58597…`), somada e **removida** | web "Hidratação de hoje" foi de **0,0 → 0,3 L** e voltou a 0 | **E2E nesta sessão**: app gravou no banco (MCP) → web refletiu (Playwright) → cleanup confirmado | `APROVADO_E2E` |
| **Chat (profissional)** | web `chat.ts` → `chat_messages(sender_role='professional')` | msg controlada (id `71a20cc6…`) criada e **removida** | thread da Mariana renderizou a msg enviada (mesmo app, web) | **E2E nesta sessão**: web gravou (sender=Camila `a2`, MCP) → web leu → cleanup; canal voltou a 8 msgs | `APROVADO_E2E (round-trip web)` |
| Chat (paciente→web) | app `chat.ts` → `chat_messages(sender_role='patient')` + `chat_mentions` | 8 msgs seed no canal da Mariana | web Mensagens e app TeamChat leem o mesmo canal | MCP (8 msgs) + código (app TeamChat); envio do app não reexecutado | `APROVADO_LOCAL_UI` |
| **Peso** | app `api/weight.ts` → `weight_logs(source='app')` | 3 linhas (último 67,1 kg, 2026-06-12) | web Antropometria "Peso atual 67,1 kg" + gráfico (ponto laranja=app); app Home 67,1 | MCP + Playwright (web Antropometria) | `APROVADO_LOCAL_UI` |
| **VRI** | app → `adherence_snapshots` | 5 snapshots (último 88/alta, 2026-06-25) | web VRI **88** (ficha + dashboard); app Home **88** | MCP + Playwright (web+app) | `APROVADO_LOCAL_UI` |
| **Recuperação** | app `eventSync` → `muscle_recovery_states` | 9 estados da Mariana | web BodyMap/Recuperação | MCP + código | `APROVADO_LOCAL_UI` |
| **Treino (conclusão)** | app `workout_checked` → `eventSync` → recovery + VRI | seed: 8 `workout_checked`, 9 recovery, 5 snapshots | web Timeline/Recuperação; app pendência "treino do dia" | MCP + código; conclusão nova **não** executada (recalcularia VRI e sujaria a demo) | `APROVADO_LOCAL_UI` (conclusão E2E = `NÃO_COMPROVADO`) |
| **Timeline** | app → `activity_events` | eventos seed; +1 hidratação provada no E2E | web Timeline/ficha | MCP + E2E de hidratação (write→read de `activity_events`) | `APROVADO_LOCAL_UI` |
| **Foto** | app `api/photos.ts` → bucket `progress-photos` + `progress_photos` | 1 foto demo (data URI) | web Evolução/Fotos (grade); app pendência foto mensal | MCP + código; **upload novo não executado** (cleanup de binário no bucket não é simétrico/seguro via anon) | leitura `APROVADO_LOCAL_UI`; **upload app→bucket `NÃO_COMPROVADO`** |
| Plano alimentar | web `nutrition_plans/meals`; app lê | "Plano 1600 kcal", 3 refeições | web aba Plano alimentar + app Plan | MCP + Playwright | `APROVADO_LOCAL_UI` |
| Treino (plano) | web `workout_plans/workouts/workout_exercises`; app lê | "Treino de emagrecimento" (A/B) | web aba Treino + app WorkoutGuide | MCP + Playwright | `APROVADO_LOCAL_UI` |
| RBAC de UI | web `RoleProvider` (modo demonstração) | em memória, **não** persiste no banco | só portal profissional | Playwright (nutri/médico ao vivo; admin sem ledger) | `APROVADO_E2E` (UI) |
| WhatsApp / "Responder com IA" / import Financeiro | — | — | — | placeholders rotulados | `MOCKADO` |
| Ledger (`schema_migration_log`) | só migration (Supabase) | 12 linhas; sem leitura anon/auth | nenhum (sem UI no portal) | MCP (Fase 2) | `APLICADA` |

## 4. QA local executada

### Web (`vertexa-web-pro`)
- `npm run typecheck` → 0 · `npm run lint` (`--max-warnings 0`) → 0 · `npm run build` → 0.
- `rg -n "schema_migration_log|Migrations aplicadas|useMigrationLog|migrationLog|api/migrations" src` → **0 matches** (ledger 100% fora do frontend; `api/migrations.ts` e `useMigrationLog.ts` removidos).
- Playwright (`localhost:5173`, modo demonstração): Antropometria (peso/IMC/%gordura/gráfico/hidratação reais), Mensagens, RBAC (nutri→Treino bloqueado c/ motivo+`aria-disabled`; médico→Treino editável; admin sem migrations em nenhuma tela), refresh. **0 `console.error`/`pageerror`.**

### App (`vertexa-app-paciente`)
- `npm run test` (vitest) → **25/25 passam** (5 arquivos: hydrationMath, welcomeMessages, pendingLogic, adherenceEngine, example).
- `npm run typecheck` → 0 · `npm run build` → 0 (aviso de chunk >500kB, não bloqueante).
- `npm run lint` → **3 erros + 9 warnings PRÉ-EXISTENTES** em arquivos shadcn não tocados (`components/ui/textarea.tsx`, `components/ui/toggle.tsx` → `no-empty-object-type`; `tailwind.config.ts` → `no-require-imports`) + warnings `react-refresh`/`react-hooks`. NÃO introduzidos na S8 (repo do app sem alterações); registrados como dívida de lint do scaffolding, sem refatoração ampla.
- Playwright (`localhost:8081`): `/onboarding` (5 telas oficiais), `/login`, `/home` (VRI 88, peso 67,1, pendências reais), `/habits` (hidratação). **0 `console.error`/`pageerror`** (apenas warnings de dev/future-flags).

## 5. Consistência cross-repo observada
App Home e web ficha mostram os MESMOS dados da Mariana lidos do único Supabase: peso 67,1 kg (meta 62,
início 74,2), VRI 88, 18 dias de sequência, 80% da semana. O E2E de hidratação provou o caminho completo
app→banco→web em tempo real.

## 6. O que NÃO foi mutado / preservação da demo
Exceto as duas escritas controladas (hidratação e chat) — ambas criadas e **removidas** com verificação por
MCP —, nenhum dado remoto de peso, foto, treino, VRI ou recuperação foi alterado, para preservar a coerência
da demo de 26/06. Os fluxos app-UI desses, e o upload de foto ao bucket, ficam `APROVADO_LOCAL_UI`/`NÃO_COMPROVADO`.
