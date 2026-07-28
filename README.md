# VERTEXA Web Pro — Pacote Claude Code

Repo **novo e separado** para o painel web profissional, construído com Claude Code.
O app paciente é outro repo (Lovable, React+Vite) e ambos compartilham um Supabase.

## Como usar este pacote

### 1. Inicialize o repo
Coloque estes arquivos na raiz de um repo novo. Estrutura:
```
.claude/
  agents/        staff-architect, security-reviewer, premium-ui-reviewer, qa-engineer
  skills/        supabase-data-layer, app-patient-contract, clinical-ui-states
  commands/      /feature, /review, /ship
  hooks/         protect-sensitive-files.js
  settings.json  (ativa o hook)
CLAUDE.md        regras do projeto (Claude lê automaticamente)
docs/
  PLANO_DE_IMPLEMENTACAO.md   fases até 22/06
  SCHEMA.sql                  schema Supabase
  COMBINADOS.md               escopo real das calls
  PENDENCIAS.md               validar com cliente
supabase/
  seed.sql                    3 pacientes do happy path
```

### 2. Prepare o Supabase (uma vez)
- Use o MESMO projeto Supabase do app paciente.
- Rode `docs/SCHEMA.sql`, depois `supabase/seed.sql` no SQL Editor.
- Pegue `Project URL` e `anon key` → crie `.env`:
  ```
  VITE_SUPABASE_URL=...
  VITE_SUPABASE_ANON_KEY=...
  ```

### 3. Trabalhe por fases (no Claude Code)
Abra o Claude Code na raiz e siga `docs/PLANO_DE_IMPLEMENTACAO.md`. Sugestão de abertura:

> "Leia CLAUDE.md e docs/PLANO_DE_IMPLEMENTACAO.md. Vamos executar a Fase 0. Investigue,
> me mostre o plano, e implemente em commits pequenos. Não avance com build quebrado."

Comandos úteis durante o trabalho:
- `/feature` — investiga antes de implementar
- `/review` — roda os 3 agents de revisão
- `/ship` — typecheck + lint + build + resumo para ClickUp

### 4. O que é "use agora" vs "depois"
**Use já (movem a agulha até 22/06):** CLAUDE.md, PLANO, SCHEMA, seed, skill
supabase-data-layer, skill app-patient-contract, agent staff-architect.

**Use quando tiver fôlego (qualidade):** agents security-reviewer / premium-ui-reviewer /
qa-engineer, skill clinical-ui-states, hooks. Não gaste os 6 dias montando andaime — construa
as telas; chame os revisores ao fim de cada fase.

### 5. Happy path da demo (o que precisa funcionar no dia 22)
Web Pro: Dra. abre "Mariana" → vê VRI + timeline + treino. Cria/edita um plano.
App Paciente (logado como Mariana): vê o treino → conclui ("bater ponto").
Web Pro (refresh): evento novo na timeline + músculo muda de cor na recuperação.

Isso é o que vende. Dashboard + Perfil do Paciente + ciclo vivo com o app são P1.
build22
