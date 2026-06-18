# Roteiro de demonstração — VERTEXA Web Profissional

> Demo da sprint (até 22/06). Dados fictícios (seed): **Mariana** (saudável/alta adesão),
> **Ricardo** (em risco), **Beatriz** (recuperando). Rodar `npm run dev` → `http://localhost:5173`.

## Preparação (1x)
- `npm install` && `npm run dev`.
- A demo entra por **"Entrar em modo demonstração"** (não precisa de usuário auth real nesta sprint).
- Tema: pode mostrar o **modo escuro** (toggle no topo) — persiste ao recarregar.

## Roteiro (8–10 min)

1. **Login** — split-screen com a marca VERTEXA (gradiente laranja→preto). Clicar **"Entrar em modo
   demonstração"** → cai no Dashboard. *(Mostrar que existe login real via Supabase; o modo demo é o
   atalho da sprint.)*

2. **Dashboard** — saudação + data; 4 cards (ativos, em risco, em atenção, adesão média); **"Foco do
   dia"** com os 3 críticos (botão *Tratar*); **gráfico de adesão** por paciente (cor pela faixa).

3. **Pacientes** — lista real: badge de status por VRI, profissional responsável, adesão, última
   atividade. Mostrar **busca**, **filtros** (status/profissional), abas **Todos/Pendentes** e
   **paginação**. Clicar na **Mariana**.

4. **Prontuário (Mariana) — a tela mais importante.** Cabeçalho com **VRI** grande. Passear pelas abas:
   - **Visão geral**: objetivo, peso→meta, sequência, adesão, sinais e planos ativos.
   - **Timeline**: eventos reais (treino, hidratação, peso, foto) com ícone e "há X".
   - **Antropometria**: **gráfico de evolução de peso** (74,2 → 68,4 kg) + IMC + seletor de método.
   - **Plano alimentar** e **Treino**: refeições e treinos A/B com exercícios.
   - **Recuperação muscular**: **mapa corporal** (frente/costas) com músculos coloridos por status.

5. **Ciclo vivo (clímax) — profissional → paciente → profissional:**
   1. Abrir **Ricardo** (em risco, sem plano) → aba **Treino** → **Criar plano** → preencher e **Salvar**.
   2. Mostrar que o plano **persistiu**: aba Treino mostra o plano; **/Planos** lista ele ("há instantes").
      *(É o que o app do paciente leria.)*
   3. **Simular o paciente executando** (no SQL Editor do Supabase — o app paciente faria isso):
      ```sql
      insert into activity_events (patient_id, type, payload, created_at) values
        ('10000000-0000-0000-0000-0000000000b2','workout_checked','{"workout":"A — Peito e Tríceps"}', now());
      insert into muscle_recovery_states (patient_id, muscle_group, last_trained_at, last_intensity, status) values
        ('10000000-0000-0000-0000-0000000000b2','chest', now(), 80, 'fatigued'),
        ('10000000-0000-0000-0000-0000000000b2','triceps', now(), 75, 'fatigued')
      on conflict (patient_id, muscle_group) do update
        set last_trained_at=excluded.last_trained_at, status=excluded.status, calculated_at=now();
      ```
   4. **Recarregar** o prontuário do Ricardo → **Timeline** mostra o treino concluído e **Recuperação**
      mostra peito/tríceps fatigados (vermelho). Ciclo fechado.

6. **Retenção** — coortes de VRI (ativos, em risco, sem atividade 7d, adesão média), lista **"Para
   reativar"** e **adesão por profissional**.

7. **Mensagens** — conversa da Mariana; remetente = **clínica/profissional** (Dra. Camila Rocha),
   **nunca "Vertexa"**. *(Envio e "responder com IA" são placeholders nesta sprint.)*

8. **Campanhas** — automações de retenção (boas-vindas, check-in, reativação, NPS…). *(Disparo é
   placeholder.)*

## Observações honestas (dizer se perguntarem)
- **Reflexo do ciclo vivo é por recarregar** a tela (não há realtime/websocket nesta sprint). O app
  reflete porque lê as mesmas tabelas do Supabase compartilhado.
- **VRI e recuperação muscular não são calculados na web** — vêm do app paciente/backend
  (`adherence_snapshots`, `muscle_recovery_states`); a web só **lê e exibe**.
- **Segurança/RLS**: a sprint roda com RLS permissiva + dados fictícios. A RLS real por papel/clínica
  e o resto do checklist de produção estão em `docs/PENDENCIAS.md` (#11–#14) — **não publicar com dados
  reais antes disso**.
- Fora do escopo desta sprint (placeholder): WhatsApp real, pagamentos, IA, Modelos/Financeiro/
  Diários/Questionários/Videochamada/Biblioteca e a maior parte de Configurações.
