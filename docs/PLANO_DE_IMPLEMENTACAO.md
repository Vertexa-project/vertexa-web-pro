# Plano de Implementação — VERTEXA Web Pro (até 22/06)

> Execução para Claude Code. Cada fase = um conjunto de commits pequenos. Não avançar de fase
> com build quebrado. Ao fim de cada fase, rodar `npm run typecheck && npm run build`.

## Fase 0 — Scaffold (dia 1)
- [ ] Criar projeto Vite React+TS. Instalar Tailwind, shadcn/ui, react-router, react-query,
      recharts, date-fns, lucide-react, @supabase/supabase-js.
- [ ] Copiar os design tokens do app paciente (preto/laranja) e ADAPTAR para a versão clean
      (base branca, laranja só como acento). Definir em `src/index.css` / `tailwind.config.ts`.
- [ ] Layout base: `src/layouts/AppShell.tsx` = sidebar fixa esquerda + topbar + outlet.
      Itens da sidebar: Dashboard, Pacientes, Planos, Campanhas, Mensagens, Retenção, Config.
- [ ] `src/lib/supabase.ts` com anon key via env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **Aceite:** app sobe, sidebar navega entre rotas vazias, visual sóbrio com acento laranja.

## Fase 1 — Schema + camada de dados (dia 1–2)
- [ ] Rodar `docs/SCHEMA.sql` no Supabase (mesmo projeto do app paciente).
- [ ] Rodar `supabase/seed.sql` (clínica + 3 pacientes: 1 saudável, 1 em risco, 1 recuperando).
- [ ] Gerar tipos: `src/types/db.ts`.
- [ ] `src/lib/api/`: `listPatients`, `getPatient`, `getPatientTimeline` (activity_events),
      `getWorkoutPlan`, `getNutritionPlan`, `getBodyAssessments`, `getMuscleRecovery`,
      `getAdherenceSnapshot`, `listCampaigns`, `getMessages`.
- [ ] `src/lib/domain/muscleRecovery.ts` — função pura (mesma do app paciente).
- **Aceite:** uma página de teste lista os 3 pacientes vindos do Supabase real.

## Fase 2 — Pacientes + Dashboard (dia 2–3)
- [ ] **Pacientes (lista):** tabela com nome, profissional, status (badge por VRI), última
      atividade, aderência %, busca, filtro por status/responsável. Loading/vazio/erro.
- [ ] **Dashboard:** cards (ativos, em risco, retornos pendentes, exames pendentes, mensagens
      hoje, tarefas do dia) + "Foco do dia" (3 pacientes risco crítico) + mini-gráfico adesão
      semanal + bloco financeiro discreto (receita mês, projeção, impacto de abandono).
- **Aceite:** dashboard e lista populados com dados reais do seed.

## Fase 3 — Perfil do Paciente / Prontuário (dia 3–4) — TELA MAIS IMPORTANTE
- [ ] Cabeçalho: foto, nome, objetivo, profissional responsável, VRI grande.
- [ ] Abas: Visão geral | Timeline | Antropometria & Evolução | Plano alimentar | Treino |
      Recuperação muscular | Check-ins | Mensagens | Observações.
- [ ] **Timeline:** feed cronológico de `activity_events` (treino feito, foto, peso, check-in).
- [ ] **Antropometria:** peso/IMC/circunferências/dobras/bioimpedância/DEXA com método
      SELECIONÁVEL. Gráfico de peso (recharts) + álbum de fotos comparativas.
- [ ] **Recuperação muscular:** mapa corporal (frente+costas) colorido por status. Pode reusar
      o SVG do app paciente (`Progress.tsx`).
- **Aceite:** abrir paciente "Mariana" mostra prontuário completo com dados reais.

## Fase 4 — Planos + Integração viva com o app (dia 4–5)
- [ ] **Planos:** criar/editar treino (A/B/C, exercícios, séries/reps/carga, grupos musculares)
      e plano alimentar (refeições, horários, itens, kcal). Escreve em `workout_plans`/`workouts`/
      `workout_exercises`/`nutrition_plans`/`meals`.
- [ ] **Happy path de demo:** plano criado aqui aparece no app paciente; quando o paciente
      conclui treino no app, a Timeline e a Recuperação muscular desta web atualizam (via
      `activity_events` + `muscle_recovery_states`).
- **Aceite:** o ciclo profissional→paciente→profissional funciona ponta a ponta.

## Fase 5 — Campanhas + Mensagens + Retenção (dia 5–6)
- [ ] **Campanhas:** lista (Boas-vindas, Pós-consulta, Check-in 15d, Retorno 30d, Lembrete de
      exame/foto/bioimpedância, Reativação, Aniversário, NPS), público-alvo, msg editável,
      ativa/inativa, botão "novo disparo". (Disparo real é placeholder.)
- [ ] **Central de mensagens:** lista de conversas + thread; remetente = clínica/profissional
      (nunca "Vertexa"). Botão "responder com IA" visual/desabilitado.
- [ ] **Dashboard de Retenção (VRI):** ativos, em risco, sem peso/foto/treino recente, adesão
      por profissional, tendência de engajamento.
- **Aceite:** as 3 telas navegáveis com dados do seed.

## Fase 6 — Polish + entrega (dia 6)
- [ ] Estados vazios/erro revisados. Skeletons. Responsividade. Contraste AA.
- [ ] Rodar agents de revisão: `security-reviewer`, `premium-ui-reviewer` (ver `.claude/agents`).
- [ ] `npm run typecheck && npm run lint && npm run build` limpos.
- [ ] Gravar vídeo/roteiro do happy path para a apresentação ao cliente.

## Ordem de prioridade se o tempo apertar
P1 (não pode faltar): Fases 0,1,2,3,4. P2: Fase 5. P3: Fase 6 (polish).
A demo vende com Dashboard + Perfil do Paciente + ciclo vivo com o app. Campanhas/Mensagens
reforçam, mas o coração é o prontuário + integração.
