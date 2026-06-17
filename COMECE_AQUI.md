# 🚀 COMECE AQUI — VERTEXA Web Profissional

Guia único para sair do zero até o desenvolvimento rodando no Claude Code.
Siga na ordem. Cada passo depende do anterior.

---

## Visão geral (o que é o quê)

Você tem DOIS projetos que conversam pelo MESMO Supabase:

```
vertexa/
├── vertexa-web-pro/        ← ESTE repo (painel do profissional, feito no Claude Code)
└── vertexa-app-paciente/   ← o app que já existe (React+Vite, validado com a cliente)
```

> O zip antigo "vertexa-web-pro (anterior)" pode ser DESCARTADO — este repo já contém tudo dele
> mais o prompt-mestre e os design tokens.

---

## Passo 1 — Organize as pastas

Crie uma pasta-mãe `vertexa/` e coloque os dois projetos lado a lado (estrutura acima).
Ter os dois vizinhos importa: a Web Pro reaproveita o mapa muscular (SVG) e confere o contrato
de tabelas do app paciente. Descompacte este repo dentro de `vertexa-web-pro/`.

Confirme que na raiz de `vertexa-web-pro/` existem:
- `CLAUDE.md`
- pasta `.claude/` (agents, skills, commands, hooks)
- pasta `docs/`
- pasta `supabase/`

---

## Passo 2 — Supabase (ANTES de abrir o Claude Code)

1. Crie um projeto no Supabase (ou use o mesmo do app paciente — ver aviso no fim).
2. SQL Editor → rode **`docs/SCHEMA.sql`** (cria tabelas + enums).
3. SQL Editor → rode **`supabase/seed.sql`** (3 pacientes do happy path).
   - Rode SCHEMA primeiro, seed depois. Se der "duplicate key" no seed, limpe as tabelas
     ou recrie o schema e rode de novo.
4. Settings → API → copie `Project URL` e `anon public key`.
5. Crie `.env` na raiz de `vertexa-web-pro/`:
   ```
   VITE_SUPABASE_URL=cole_aqui
   VITE_SUPABASE_ANON_KEY=cole_aqui
   ```
> NUNCA use a `service_role key` no client. Só a `anon`.

---

## Passo 3 — Abra o Claude Code na pasta certa

Abra o Claude Code em `vertexa-web-pro/` (NÃO na pasta-mãe `vertexa/`).
Ele carrega o `CLAUDE.md` automaticamente.

---

## Passo 4 — Primeira mensagem (o prompt-mestre)

Abra `docs/PROMPT_MESTRE_CLAUDE_CODE.md`, copie **somente o bloco da Seção 2**
(começa em "Você é meu par técnico sênior...") e cole como primeira mensagem.

Esse bloco manda o Claude Code:
- ler os docs,
- **não codar ainda**,
- devolver entendimento + plano de fases + estrutura de pastas.

Revise o que ele propôs. Se estiver bom, responda: **"ok, pode começar a Fase 0"**.

---

## Passo 5 — Trabalhe fase a fase

Siga `docs/PLANO_DE_IMPLEMENTACAO.md` (Fases 0 → 6). Ao fim de CADA fase:

- `/review` → dispara os agents de segurança e UI (relatório, não corrige sozinho)
- `/ship`   → roda typecheck + lint + build + resumo para o ClickUp

Regra de ouro: **não avance de fase com build quebrado.**

Prioridade se o tempo apertar (até 22/06):
- **P1:** Login, Dashboard, Pacientes, Perfil do Paciente (prontuário), integração viva com o app
- **P2:** Modelos (ao menos Alimentos/Receitas/Cardápios), Financeiro, Configurações→Mensagens
- **P3:** Biblioteca (Lâminas), Videochamada, resto de Configurações

---

## Passo 6 — Demo do dia 22 (o que tem que funcionar)

1. Web Pro: abrir a paciente "Mariana" → ver VRI, Timeline, treino atribuído.
2. App Paciente (logado como Mariana): ver o treino → concluir ("bater ponto").
3. Web Pro (refresh): evento novo na Timeline + músculo muda de cor na Recuperação.

Esse ciclo vivo é o que vende. Ensaie antes de apresentar.

---

## Mapa dos documentos (onde está cada coisa)

| Arquivo | Para quê |
|---|---|
| `CLAUDE.md` | Regras do projeto (Claude Code lê sozinho) |
| `docs/PROMPT_MESTRE_CLAUDE_CODE.md` | O prompt para colar (Seção 2) + mapa de telas |
| `docs/PLANO_DE_IMPLEMENTACAO.md` | As 6 fases, passo a passo |
| `docs/SCHEMA.sql` | Schema do Supabase |
| `supabase/seed.sql` | Dados de demonstração (3 pacientes) |
| `docs/COMBINADOS.md` | Escopo real das calls (fonte de verdade) |
| `docs/PENDENCIAS.md` | O que validar com o cliente |
| `docs/DESIGN_TOKENS.md` | Cores/identidade VERTEXA (light + dark) |

---

## ⚠️ Avisos importantes

1. **Recuperação muscular — pendência nº1.** O app paciente usa `neutral/activated`; os combinados
   das calls usam `recovered/weakened`. NÃO persista esse campo no Supabase antes do Bruno confirmar
   o esquema oficial com a Juliana. (Ver `docs/PENDENCIAS.md`.)

2. **Mesmo Supabase do app paciente?** Se você apontar os dois para o mesmo projeto e o app já tiver
   criado tabelas com nomes iguais, pode haver conflito ao rodar o `SCHEMA.sql`. Se acontecer, me
   avise (ou use `create table if not exists` / um schema dedicado).

3. **Não copie identidade do Nutrio.** Use o Nutrio como referência de ESTRUTURA e UX. A identidade
   é VERTEXA (preto/laranja). Não copie logo, ícones, ilustrações, CSS ou textos de terceiros.

4. **GIFs de exercício.** O app paciente hoje usa URLs de terceiros (fitnessprogramer.com). Trocar
   por fonte própria/licenciada antes de publicar nas lojas.

5. **Plugins do Claude Code.** Você instalou supabase, context7, typescript-lsp, playwright etc.
   Eles ajudam já nas Fases 1-2. Se algum plugin (ex.: frontend-design, code-review) conflitar com
   as instruções, o `CLAUDE.md` deste repo tem prioridade.
