# VERTEXA Web Profissional — Prompt-Mestre para Claude Code
### Paridade funcional/estrutural com o Nutrio · Identidade visual própria VERTEXA · Integração viva com o App Paciente

> **O que é este arquivo.** Cole o bloco da Seção 2 como mensagem inicial no Claude Code (na raiz do
> repo `vertexa-web-pro` que já tem o CLAUDE.md, docs e .claude/). As Seções 1, 3 e 4 são referência
> de apoio (mapa de telas, design tokens, regras anti-cópia). O prompt referencia esses docs.

---

## 1. Princípio diretor (leia antes de tudo)

**O objetivo NÃO é clonar o CSS/visual do Nutrio.** É replicar a *experiência, a estrutura de
navegação, a densidade de informação e o conjunto de funcionalidades* do Nutrio, vestidos com a
identidade visual do VERTEXA — que já existe e está consolidada no app paciente (preto + laranja).

Por que assim, e não pixel-a-pixel do verde Nutrio:
1. **Consistência de produto.** Paciente e profissional são o MESMO produto. Se o app é preto/laranja
   e a web é verde-Nutrio, vira Frankenstein. A web tem que parecer "o Nutrio em qualidade", mas
   "o VERTEXA em identidade".
2. **Proteção jurídica.** Copiar CSS, ícones, ilustrações e paleta de um concorrente em um produto
   que vai pra loja é risco real. Paridade de UX é legítima; cópia de identidade não é.
3. **O brand do VERTEXA já foi validado** com a cliente (Juliana) e o designer (Ernani).

Tradução prática: **mesma planta baixa do Nutrio, decoração do VERTEXA.**

---

## 2. >>> PROMPT PARA COLAR NO CLAUDE CODE <<<

```
Você é meu par técnico sênior. Vamos construir o VERTEXA Web Profissional: o painel web de uma
plataforma SaaS B2B2C de retenção clínica multiprofissional (médicos, nutricionistas,
fisioterapeutas, personal trainers acompanham pacientes). Stack já definida no CLAUDE.md:
React + Vite + TypeScript + Tailwind + shadcn/ui + Supabase + react-query.

ANTES DE CODAR:
1. Leia CLAUDE.md, docs/PLANO_DE_IMPLEMENTACAO.md, docs/COMBINADOS.md, docs/SCHEMA.sql e
   docs/DESIGN_TOKENS.md (vou colar os tokens abaixo se não existir).
2. Não altere arquivos ainda. Me devolva: entendimento do produto, ordem de execução por fases,
   e a estrutura de pastas que vai criar. Aguarde meu "ok" para a Fase 0.

REFERÊNCIA DE PRODUTO (Nutrio como benchmark — NÃO copiar marca/CSS/ícones/ilustrações):
A interface espelha a ESTRUTURA do Nutrio, mas com identidade visual VERTEXA (ver tokens).
Layout global:
- Sidebar fixa à esquerda com navegação principal: Dashboard, Pacientes, Diários, Questionários,
  Financeiro, Modelos, Videochamada, Biblioteca (Lâminas), e Configurações no rodapé.
- Topbar: busca global, ícone de WhatsApp (placeholder), notificações (painel lateral deslizante),
  avatar + nome com dropdown (Configurações, Assinatura, Modo escuro, Sair).
- Item de menu ativo: destaque em LARANJA (não verde). Modo escuro deve existir (toggle no dropdown).
- Conteúdo: cards elegantes, tabelas com paginação ("Linhas por página", "Página X de Y"),
  estados vazios com ilustração + título + subtítulo + CTA, modais centrais para criação/edição.

MÓDULOS E TELAS (todas com loading/skeleton, vazio e erro):

1. Login — split screen: lado esquerdo com brand VERTEXA (gradiente laranja→preto, logo,
   tagline "Plataforma de retenção clínica"), lado direito card de acesso (email, senha com
   olho, "Esqueceu a senha?", botão entrar, link cadastro). Auth via Supabase.

2. Dashboard — saudação dinâmica ("Bom dia, {nome}") + data. Abas Pacientes/Pendentes/
   Aniversariantes. Cards-resumo no topo: pacientes ativos, em risco, retornos pendentes,
   exames pendentes, mensagens a responder, tarefas do dia. Bloco "Foco do dia" (3 pacientes
   risco crítico, botão tratar). Coluna lateral "Diários" recentes. Agenda semanal (grade
   dia x hora, navegação semana/dia/lista, legenda de tipos: Consulta/Retorno/Previsão de
   retorno/Outros, status: Confirmado/Pendente/Desmarcado). Botão "Integrações" e
   "Link de agendamento".

3. Pacientes — lista (abas Todos/Pendentes). Botões "Importar pacientes" e "Criar paciente".
   Botão Exportar. Tabela: nome, profissional responsável, status (badge por VRI), última
   atividade, aderência %, tags. Filtros e busca. Estado vazio com ilustração.
   - Modal "Criar paciente": foto, nome*, email, gênero*, data nascimento*, celular com DDD*,
     CPF/CNPJ, tags, observação.

4. Perfil do Paciente (PRONTUÁRIO — tela mais importante) — cabeçalho com foto, nome, objetivo,
   profissional responsável, VRI grande. Abas:
   - Visão geral: resumo, próximos compromissos, planos ativos, alertas.
   - Timeline: feed cronológico de activity_events (treino feito, foto, peso, check-in, mensagem).
   - Antropometria & Evolução: método SELECIONÁVEL (bioimpedância, adipômetro, dobras,
     circunferências, DEXA, manual). Peso/altura/IMC/%gordura/circunferências/dobras. Gráfico de
     evolução de peso (recharts). Álbum de fotos comparativas mês a mês. Upload de documento (PDF).
   - Plano alimentar: visualização do plano ativo (refeições, horários, itens, kcal/macros).
   - Treino: treinos A/B/C, exercícios, séries/reps/carga, grupos musculares, vídeo.
   - Recuperação muscular: mapa corporal frente+costas, músculos coloridos por status
     (fadigado/em recuperação/recuperado/enfraquecido). Lógica em docs/COMBINADOS.md.
   - Check-ins: sono, dor, humor, fome, energia, adesão.
   - Mensagens: thread com o paciente (remetente = profissional/clínica, NUNCA "Vertexa").
   - Observações: anotações clínicas do profissional.

5. Modelos — área com submenu lateral próprio (segunda coluna), espelhando o Nutrio. Cada item
   tem abas "Meus {X}" e "{X} VERTEXA" (conteúdo próprio do profissional vs biblioteca da
   plataforma) e tabela paginada. Subitens:
   - Alimentos (tabela com base grande tipo TACO; modal visualizar/criar com nutrientes +
     micronutrientes recolhíveis + medidas caseiras com pluralização automática).
   - Grupos de alimentos (com equivalência automática; modal ver/editar).
   - Cardápios (criar: por alimentos / por texto livre).
   - Refeições (criar: por alimentos / por texto livre; modal ver refeição/alimentos do cardápio).
   - Receitas (abas Minhas/Nutrio→VERTEXA/Comunidade; cards com foto, duplicar, ver, abrir PDF;
     modal receita com Detalhes/Nutrientes — macros coloridos + micronutrientes em grid;
     editor de receita com alimentos, medidas caseiras, modo de preparo rich-text,
     "compartilhar com outros profissionais", "visível no app").
   - Lista de substitutos (por grupo, com média calórica; modal alimentos substitutos).
   - Exames (modelos de solicitação; modal com lista de exames; criar via editor rich-text).
   - Marcadores laboratoriais (modal detalhes: unidades + fatores de conversão + referências +
     interpretações clínicas; criar marcador personalizado).
   - Prescrições (modo Inteligente: manipulados com compostos+qtd, suplementos+qtd, modo de uso /
     modo Texto livre com editor rich-text).
   - Documentos (modelos: atestado, encaminhamento, declaração; editor rich-text).
   - Observações (editor rich-text).
   - Instruções nutricionais (modal ver; criar via rich-text).
   - Metas (modelos: "Caminhar 30 min", "Beber 2L de água"...; criar via rich-text).
   - Anamnese (criar: por texto / formulário de anamnese).
   - Questionário (público / paciente; criador com preview lado a lado e perguntas; importar modelo).
   - Materiais de apoio (texto/arquivo; "visível no app", selecionar pacientes).

6. Diários — feed dos registros alimentares dos pacientes (abas Explorar/Feed/Perfil; toggle
   "apenas não reagidos"). Estado vazio com ilustração.

7. Questionários — públicos e por paciente (Todos/Respondidos/Aguardando). Criar questionário.

8. Financeiro — período selecionável (no mês/intervalo). Cards: Entradas, Saídas, Saldo, A receber.
   Gráficos "Entradas x Saídas por dia" e "Saídas por categoria". Abas Todas/Entradas/Saídas/Saldo.
   Botão "Nova movimentação" (dropdown: Entrada/Saída/Saldo). Exportar.

9. Videochamada — criar sala virtual (placeholder; só UI + aviso de privacidade).

10. Biblioteca (Lâminas) — grid de cards de conteúdo educativo (foto + título + descrição),
    busca, alguns com cadeado (premium) e badge "Novo". (Conteúdo é placeholder/mock VERTEXA.)

11. Configurações — submenu: Conta, Segurança, Locais, Link de agendamento, Membros (secretária/
    equipe), Customização e app (logo, cor do sistema, customização de PDF), Assinatura (planos
    Mensal/Semestral/Anual/Diário + pagamento), Uso de funcionalidades (limites/créditos de IA),
    Mensagens (templates de e-mail/WhatsApp por evento: agendamento, lembrete, confirmação,
    cancelamento, feedback, aniversário, plano liberado — com variáveis {nome}/{data}/{horário}),
    WhatsApp (conectar via QR + FAQ).

INTEGRAÇÃO COM O APP PACIENTE (mesmo Supabase):
- O profissional CRIA planos/treinos/metas/avaliações → o paciente vê no app dele.
- O paciente EXECUTA (treino, peso, foto, check-in) → grava em activity_events e
  muscle_recovery_states → a web reflete na Timeline, no VRI e na Recuperação muscular.
- Não renomear tabelas/colunas do SCHEMA.sql sem alinhar (o app paciente depende delas).

PRIORIDADE (se faltar tempo até 22/06): Login, Dashboard, Pacientes, Perfil do Paciente e a
integração viva são P1. Modelos (ao menos Alimentos/Receitas/Cardápios), Financeiro e
Configurações(Mensagens) são P2. Biblioteca, Videochamada e o resto de Configurações são P3.

REGRAS (reforço do CLAUDE.md):
- Identidade VERTEXA, nunca CSS/ícones/ilustrações/marca de terceiros.
- Dados de saúde: só anon key no client; nunca service_role; permissões por papel.
- Toda lista com loading/vazio/erro. Modo escuro funcional.
- Commits pequenos; rodar typecheck/lint/build ao fim de cada fase; não avançar com build quebrado.
- Ao fim de cada fase, chamar os agents security-reviewer e premium-ui-reviewer.

Comece me devolvendo o entendimento + plano de fases + estrutura de pastas. Não code ainda.
```

---

## 3. Design tokens VERTEXA Web (o "irmão clean" do app paciente)

> O app paciente é **dark-first** (fundo preto). A web profissional é **light-first** (fundo branco),
> mas usa a MESMA cor primária laranja e as MESMAS cores de status — é o mesmo brand, outro modo.
> Crie `docs/DESIGN_TOKENS.md` e `src/index.css` com isto. Modo escuro = os tokens do app paciente.

```css
/* LIGHT (padrão da web profissional) */
:root {
  --background: 0 0% 100%;          /* branco */
  --foreground: 0 0% 12%;           /* quase-preto */
  --card: 0 0% 100%;
  --card-foreground: 0 0% 12%;
  --muted: 0 0% 96%;                /* cinza muito claro p/ fundos de seção */
  --muted-foreground: 0 0% 45%;
  --border: 0 0% 90%;
  --input: 0 0% 90%;

  --primary: 24 95% 53%;            /* LARANJA VERTEXA — igual ao app */
  --primary-foreground: 0 0% 100%;
  --ring: 24 95% 53%;

  /* status — iguais ao app paciente, p/ coerência entre web e mobile */
  --success: 142 71% 45%;           /* verde: saudável / recuperado-destreinado */
  --warning: 45 93% 47%;            /* amarelo: atenção / em recuperação */
  --destructive: 0 72% 51%;         /* vermelho: risco / fadigado */
  --info: 207 90% 54%;              /* azul: recuperado (pronto p/ treinar) */

  --sidebar-background: 0 0% 100%;  /* sidebar branca, item ativo = primary */
  --sidebar-foreground: 0 0% 25%;
  --sidebar-primary: 24 95% 53%;
  --radius: 0.875rem;               /* mesmo raio do app */
}
/* DARK (modo escuro) = reutilize os tokens do app paciente:
   --background:0 0% 7%; --card:0 0% 11%; --foreground:0 0% 96%; --primary:24 95% 53% ... */
```
Tipografia: Inter ou Plus Jakarta Sans. Sombras suaves (`0 4px 24px -4px hsla(0,0%,0%,0.08)` no light).
Laranja é ACENTO no light (botão primário, item ativo, badges, ícones de destaque), nunca fundo de tela.

---

## 4. Mapa de status (cruzando Nutrio + combinados + app paciente)

| Conceito | Fonte | Cor VERTEXA |
|---|---|---|
| Paciente VRI alta (≥80) | adherenceEngine.ts | verde (success) |
| VRI moderada (50-79) | adherenceEngine.ts | amarelo (warning) |
| VRI baixa (20-49) | adherenceEngine.ts | laranja (primary) |
| VRI risco (<20) | adherenceEngine.ts | vermelho (destructive) |
| Recuperação: fadigado (1-2 dias) | combinados | vermelho |
| Recuperação: em recuperação (3) | combinados | amarelo |
| Recuperação: recuperado (4) | combinados | azul (info) |
| Recuperação: enfraquecido (5+) | combinados | verde |
| Agenda: Confirmado/Pendente/Desmarcado | Nutrio | verde/amarelo/vermelho |

> Pendência nº1 (docs/PENDENCIAS.md): o app paciente hoje usa `neutral/activated`; os combinados
> usam `recovered/weakened`. Alinhar antes de persistir em `muscle_recovery_states`.

---

## 5. Notas de execução
- **Banner de trial laranja** do Nutrio: NÃO replicar (era contexto de avaliação do Nutrio).
- **Editor rich-text** aparece em ~8 modais (receita, documento, observação, instrução, meta,
  exame, prescrição texto-livre, material). Crie UM componente `<RichTextEditor/>` reutilizável.
- **Tabela paginada** é padrão recorrente: crie UM `<DataTable/>` com busca/filtros/paginação.
- **Modal de criação** é padrão: crie UM `<FormModal/>` base.
- **Estado vazio** é padrão: crie UM `<EmptyState/>` (ícone/ilustração própria + título + sub + CTA).
- Abas "Meus X / X VERTEXA" em Modelos: a aba VERTEXA é a biblioteca-base (seed), a aba "Meus" é
  o conteúdo criado pelo profissional (escopo por professional_id).
- Não use ilustrações 3D do Nutrio. Use ícones lucide-react ou ilustrações próprias/abertas.
```
