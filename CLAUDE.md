# VERTEXA — Painel Web Profissional

## Produto
SaaS B2B2C de **retenção clínica multiprofissional**. Médicos, nutricionistas,
fisioterapeutas e personal trainers acompanham pacientes. Quem paga é a clínica/profissional
(B2B); o paciente usa o app mobile (projeto separado) sem pagar. Este repo é **só a web
profissional**. O app paciente é outro repo (React+Vite) e ambos compartilham um Supabase.

Dor central (validada nas calls com os clientes Juliana e Gabriel): médico, nutri e personal
trabalham de forma fragmentada; o paciente se perde; o profissional não tem gestão de
recorrência/retorno/adesão. O VERTEXA unifica isso e reduz abandono.

## Benchmark e identidade
- **Benchmark de UX/densidade:** softwares modernos de gestão clínica/nutricional (ex.: Nutrio).
  Use como referência de QUALIDADE e FLUXO. **NUNCA copie** logo, textos, ícones, ilustrações,
  CSS ou identidade de terceiros. A identidade é própria do VERTEXA.
- **Identidade VERTEXA (web = clean/corporativa):** base branco + cinza claro, texto quase-preto.
  Preto e **laranja `hsl(24 95% 53%)`** como ACENTO (logo, item de menu ativo, botão primário,
  badges). Não inunde de laranja. Cores de status: verde=saudável/recuperado, amarelo=atenção,
  vermelho=risco/fadiga, azul=recuperado/neutro. Fontes: Inter / Plus Jakarta Sans.
- O **app paciente** usa visual mais "dopaminérgico" (laranja forte). A web é o oposto: sóbria.

## Stack
- Frontend: React 18 + Vite + TypeScript
- Estilo: Tailwind + shadcn/ui (Radix). Mesmos tokens do app paciente.
- Dados: Supabase (mesmo projeto do app paciente). Cliente `@supabase/supabase-js`.
- Estado servidor: @tanstack/react-query
- Gráficos: recharts. Datas: date-fns. Ícones: lucide-react.
- Roteamento: react-router-dom.

## Comandos
- Install: `npm install`
- Dev: `npm run dev`
- Typecheck: `npm run typecheck` (tsc --noEmit)
- Lint: `npm run lint`
- Build: `npm run build`

## Regras de arquitetura
- `src/lib/supabase.ts` — cliente único (apenas anon key).
- `src/lib/api/` — toda leitura/escrita de dados em funções tipadas (ex.: `getPatient`,
  `listPatients`). Telas NÃO chamam Supabase direto; chamam funções de `api/` via react-query.
- `src/lib/domain/` — regras puras compartilháveis (ex.: status de recuperação muscular).
- `src/components/` — UI reutilizável. `src/pages/` — telas. `src/layouts/` — sidebar+topbar.
- Tipos do banco em `src/types/db.ts` (idealmente gerados pelo Supabase).

## Regras de segurança (dados de SAÚDE — tratar com rigor)
- **NUNCA** exponha `service_role` no client. Só `anon`.
- Validação/autorização real é responsabilidade do backend (RLS). No client, nunca confie só
  no "botão escondido".
- Permissões: admin da clínica vê tudo; profissional vê só seus pacientes; profissional externo
  convidado vê só o paciente vinculado.
- Não logar dados sensíveis (nome+diagnóstico) no console em produção.
- Fotos/exames: storage privado + URL assinada (pós-MVP).

## Regras de UI
- Toda lista tem estado de loading (skeleton), vazio e erro.
- Mobile responsivo, mas otimizado para desktop.
- Acessibilidade: contraste AA, navegação por teclado, labels.

## O que NÃO fazer nesta sprint (até 22/06)
- Não implementar WhatsApp real, pagamentos (Stripe/Pagar.me), nem IA. Só estrutura/placeholder.
- Não criar RLS complexa ainda (anon + mock controlado). Anotar como pendência.
- Não inventar features fora do escopo das calls. Em dúvida, perguntar.

## Workflow obrigatório por tarefa
1. Investigar sem alterar arquivos. 2. Explicar entendimento + plano em etapas.
3. Implementar em commits pequenos. 4. Rodar typecheck/lint/build. 5. Não avançar com build
quebrado. 6. Não refatorar fora de escopo.

## Docs
- docs/PLANO_DE_IMPLEMENTACAO.md — fases até 22/06
- docs/SCHEMA.sql — schema Supabase
- docs/COMBINADOS.md — combinados informais das calls (fonte de verdade do escopo)
- docs/PENDENCIAS.md — o que validar com o cliente
