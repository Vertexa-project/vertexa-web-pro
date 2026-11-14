# Financeiro / Repasse / Estoque — Entrega 7 (painel financeiro com números clicáveis)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§3 permissões, §4.4 e §4.5 filas, §7 dashboard, §12.1 F12, E10); plano: `plano-entregas.md` (item 7).
Migration: `supabase/migrations/20261116100000_fin_e7_painel.sql` (aditiva, só leitura; **não aplicada**). Prova SQL: `supabase/tests/fin_e7_painel.test.sql` (111 asserções), rodada por `scripts/fin-e7-sql-proof.sh` (Postgres local descartável). Medição de desempenho: `supabase/tests/fin_e7_perf.sql`.

## O que existe

**Tela** — Financeiro › **Painel** (`/financeiro/painel`; Admin, Gestor e Financeiro). Mês em português (padrão: o mês atual de Brasília) e unidade.
- **Indicadores do topo** (nomes e definições do escopo §7.1): Vendido · Recebido · A receber · Em atraso · Taxas de pagamento · Repasses do mês · Custo de material · Margem da clínica · Ticket médio.
- **Pendências** (filas, §7.2): atendidos sem venda · atendimentos sem regra de repasse · títulos em atraso · pacotes vencendo em 30 dias com sessões não realizadas · caixas não fechados ou com diferença · itens abaixo do mínimo (E10).
- **Blocos** (§7.2): evolução mensal de 12 meses (vendido, recebido e margem) · recebido por forma de pagamento · agenda de recebimentos (próximos 90 dias, por semana, mais «depois de 90 dias») · por profissional (atendimentos, receita gerada, repasse, % repassado, margem gerada) · por serviço (quantidade, receita, custo médio de material, margem por unidade) · produtos (receita, custo, comissões, margem) · imposto.
- **Todo número é um botão (F12)**: abre a lista de linhas que o compõe, em tabela (cartões abaixo de 640 px), com **Total = soma das linhas**, CSV/Excel, atalho para a tela onde o assunto é trabalhado (Vendas, Títulos, Atendimentos, Caixa, Estoque…) e «Carregar mais» quando a lista passa de 300 linhas (o total já soma todas). Em cadeia: **Margem** → cada componente (Recebido, Taxas, Imposto, Material, Repasses, Custo dos produtos); **Repasse** → extrato do fechamento (quando existe) ou lançamentos do profissional; **margem gerada** → receita, repasse e material do profissional. Cada mês da evolução abre a mesma lista daquele mês.
- Celular: cartões de indicadores em grade que quebra (1, 2 e 3 colunas), tabelas viram cartões, nada rola de lado em 390 px; em 1280 px as tabelas cabem sem rolar de lado (conferido no navegador com nomes longos).

| Papel | Painel |
|---|---|
| Owner/Admin | sim, todas as unidades |
| Gestor, Financeiro | sim, **só as unidades do papel** (por unidade, nunca pela clínica inteira) |
| Recepção, Estoquista | não (a Recepção continua com o próprio Caixa) |
| Profissional (clínico) | não (vê só a própria produção e o próprio extrato) |

Aba «Painel»: primeira aba para Gestor e Financeiro; para o Admin vem logo depois de «Mensalidades» (que continua como estava, cartão 707). Trocar a ordem é uma linha em `financeTabs`.

## Definições (decisões desta entrega — podem ser trocadas)
- **Vendido** = vendas criadas no mês (Brasília), líquidas de desconto, sem as canceladas. **Ticket médio** = Vendido ÷ nº de vendas (meio-para-cima).
- **Recebido** = títulos liquidados no mês, bruto. **Taxas** = bruto − **líquido liquidado** dos títulos liquidados no mês (assim a correção do gestor sobre o líquido entra; sem correção é igual à taxa do título).
- **A receber** = títulos «esperados» com vencimento **de hoje em diante** (o escopo diz «após hoje»; incluí o dia de hoje para nenhum título ficar fora de A receber e de Em atraso). **Em atraso** = títulos esperados vencidos + vendas sem nenhum recebimento há mais de 7 dias (parâmetro `p_overdue_days`, padrão 7). **A receber e Em atraso não dependem do mês escolhido** (são o retrato de hoje).
- **Imposto** = alíquota do mês de cada unidade (`fin_tax_rates`: a do mês ou a mais recente anterior) × recebido bruto da unidade, arredondado por unidade. **Custo de material** = `material_cost_cents` dos atendimentos realizados no mês. **Custo dos produtos vendidos** = saídas de estoque ligadas a venda, já com estornos e devoluções (cancelar a venda devolve o custo).
- **Repasses do mês**: com **todas as unidades** e fechamento iniciado, o **bruto de cada extrato** (nunca negativo: o saldo negativo é levado ao mês seguinte dentro do bruto dele); sem fechamento, a **soma dos lançamentos do mês**; com uma unidade (ou gestor restrito), os lançamentos daquelas unidades. **Limite conhecido**: na prévia (sem fechamento), fixo mensal, garantia, ajuste de faixa e taxa de uso só entram quando o fechamento é iniciado — por isso a prévia pode ser menor que a do «Repasse › Lançamentos» (que calcula o mês completo, mais lento). A tela mostra a origem («Prévia dos lançamentos do mês», «Fechamento: Em conferência», «Lançamentos da unidade»).
- **Margem da clínica** = Recebido − taxas − imposto − material − repasses − custo dos produtos (a lista é a composição, cada linha clicável).
- **Por profissional**: receita gerada e margem gerada contam os atendimentos que ele **respondeu** (papel responsável); «atendimentos» conta toda participação. Receita = valor-base do atendimento. **Por serviço**: receita = valor-base dos atendimentos realizados.
- **Pendências** não dependem do mês: atendidos sem venda (todos os tempos), sem regra (últimos 12 meses), títulos vencidos, pacotes que vencem em até 30 dias com sessão por realizar, caixa de dia anterior ainda aberto + fechamento aguardando aprovação + fechamentos dos últimos 30 dias com diferença, itens com saldo abaixo do mínimo.

## RPCs (security definer, `search_path=''`, `execute` só a `authenticated`)
- `public.fin_dashboard_summary(p_clinic, p_period 'AAAA-MM' = mês atual, p_unit, p_overdue_days = 7)` — **uma chamada por tela**: cartões, evolução (12 meses), por forma de pagamento, por profissional, por serviço, agenda (14 faixas), contagem das pendências.
- `public.fin_dashboard_detail(p_clinic, p_metric, p_period, p_unit, p_params jsonb, p_overdue_days, p_limit = 300 (máx. 1000), p_offset)` — F12. Devolve `{count, total_cents, truncated, rows[]}`; cada linha traz `value_cents` (a parte dela no número). Métricas: `sold`, `ticket`, `received`, `fees`, `to_receive` (aceita `from`/`to` = faixa da agenda), `overdue`, `overdue_titles`, `repasse`, `pro_lines`, `material`, `tax`, `products_revenue`, `products_cost`, `products_commission`, `margin`, `pro_appointments`, `pro_margin`, `service_appointments`, `appt_no_sale`, `unruled`, `packages`, `cash`, `stock` (`p_params`: `professional`, `service`, `method`, `from`, `to`).
- Painel e lista leem dos **mesmos auxiliares** `private.dash_*` (um só lugar para cada definição). Recriadas (corpo da E6 preservado, só a área `dash` a mais): `private.fin_area_roles`, `public.fin_my_access`. Erros: `INVALID_PERIOD`, `INVALID_METRIC`, `forbidden` (42501).
- Índices novos (parciais, nos filtros do painel): títulos liquidados e esperados por clínica/data, vendas sem recebimento, lançamentos por clínica/mês, movimentações de venda por dia, pacotes por validade, caixas abertos/pendentes, atendimentos realizados por data.

## Provas
- **SQL** (111 asserções, Postgres local): cada número do topo com valor conferido à mão (R$ 6.540,00 vendido em 10 vendas; recebido R$ 3.440,00; taxas R$ 26,00 com a correção do gestor; imposto de duas unidades com alíquotas diferentes; margem R$ 1.806,60…); **F12** — total e soma das linhas de **cada** lista iguais ao número (incluindo cada forma de pagamento, cada profissional, cada serviço, cada faixa da agenda, cada componente da margem, cada mês da evolução); agenda fecha com «A receber» (hoje, 40 dias e além de 90); a venda criada às 23h30 do último dia do mês anterior (já mês seguinte em UTC) fica no mês anterior; mês com fechamento iniciado usa o extrato (fixo mensal incluído, extrato negativo entra como 0) e linhas `close:`/retenção nunca contam duas vezes; ajuste manual sem unidade entra no total da clínica e em nenhuma unidade; soma das unidades = clínica; gestor restrito à unidade 1 vê exatamente o painel da unidade 1 e é recusado na unidade 2; Recepção, Estoquista, profissional e admin de outra clínica recusados (painel e as 14 listas testadas); anônimo e funções `private.dash_*` sem execução; mês e métrica inválidos; clínica sem movimento (zeros, ticket vazio); paginação com total do número inteiro. Regressão: as provas das Entregas 2, 4 e 5 passam com a E7 aplicada (a da E3 falha só em «I3 TRUNCATE», e a da E6 em C10/F8b — **as duas já falham sem a E7**: a primeira por FK de tabelas posteriores, a segunda porque a migration `20261115120000_fin_e6_answer_refresh` mudou o comportamento que o teste da E6 esperava).
- **Verificação por mutação** (20 mutações no SQL, uma por vez, com a prova rodando de novo): vendas canceladas no Vendido, mês em UTC, recebido pela data prevista, taxa sem a correção, A receber sem o dia de hoje, Em atraso sem as vendas, razão `close:` no repasse, extrato negativo, painel sem a unidade do papel, Recepção com o painel, margem sem o custo dos produtos, custo sem o estorno, lista de Vendido com linha a menos, faixa «depois de 90 dias» fora, imposto sobre o líquido, Recebido sem filtro de unidade, evolução repetindo o mês, caixa sem o pendente de aprovação, pacote esgotado como pendência, atendimento aberto como «sem venda». **As 20 derrubam pelo menos um teste** (duas — pacote esgotado e atendimento aberto — sobreviviam à primeira versão da prova; os casos foram acrescentados).
- **vitest**: `finDash.test.ts` (dinheiro sem «-R$ 0,00», mês de Brasília, agenda, gráfico, unidades por papel, matriz de acesso e abas, exportações) e `Dashboard.test.tsx` (16 testes de tela: nove indicadores, **F12 na interface** — total e soma das linhas exibidas = número para 8 cartões —, composição da margem e «Voltar», repasse → extrato/lançamentos, números por profissional/serviço/forma/agenda/mês, pendências com atalho, troca de mês e unidade, gestor restrito, sem acesso, zero e negativo, «Carregar mais», erro, celular, grade dos cartões).
- **Navegador (Chromium, dados de exemplo com nomes longos, sem a API)**: 390 px e 1280 px — a página e todos os diálogos sem rolagem lateral; em 390 px listas em cartões, em 1280 px tabelas sem rolagem lateral.

## Tempos medidos (Postgres local, 6.000 vendas em 24 meses, 6.000 atendimentos, ~5.300 títulos, 5.000 lançamentos; como usuário, 5 rodadas)
| Chamada | Média |
|---|---|
| Painel completo (mês atual, todas as unidades) | **383 ms** (347–408) |
| Painel completo, mês de 11 meses atrás | 395 ms |
| Painel de uma unidade | 211 ms |
| Lista Vendido / Recebido / A receber / Margem | 3–6 ms |
| Lista Em atraso | 11 ms · Atendidos sem venda 25 ms · Atendimentos sem regra 210 ms |
Meta de 1 s cumprida no banco local; o maior custo é a fila «sem regra» (~200 ms) e os 12 meses da evolução. Medir de novo na Clínica Teste logo após aplicar (latência de rede soma ao tempo).

## Riscos para aplicar a migration
1. **Ordem**: depois de E1…E6 e `20261115120000_fin_e6_answer_refresh`. Versão `20261116100000`, nome sem versão `fin_e7_painel`.
2. **Ledger**: aplicando por `apply_migration`, corrigir a versão de relógio do ledger da CLI na mesma sessão e conferir os dois ledgers (`docs/ops/MIGRATIONS_E_LEDGERS.md` §1 e §3).
3. **Recria 2 funções existentes** (`private.fin_area_roles`, `public.fin_my_access`): cópia exata do corpo da E6 + a área `dash` (comentários encurtados). **Comparar com o que está em produção antes** (se houve ajuste manual, ele se perde). Nenhuma outra função das E1–E6 muda.
4. **Só leitura**: sem tabela nova, sem dado novo, sem backfill; os 8 índices são `create index if not exists` (criação rápida no volume atual; em tabelas grandes usar `concurrently` fora da migration).
5. **Reversão**: derrubar `public.fin_dashboard_summary/detail`, as funções `private.dash_*` e os 8 índices; restaurar `fin_area_roles` e `fin_my_access` de `20261115100000`. Nada de dado a desfazer.
6. Papéis que já existem em produção ganham o painel sem nova configuração: Gestor e Financeiro (por unidade do papel) e Admin/Owner.

## Fica para a Entrega 8 (e depois)
- Filtros do escopo §7 além de mês e unidade: **período personalizado**, **profissional**, **serviço/categoria** e **forma de pagamento** como filtros do painel inteiro (a forma de pagamento já filtra a lista de «Recebido» pelo bloco).
- Repasse da prévia com fixo mensal, garantia, faixa e taxa de uso (hoje só entram no fechamento) — exige o cálculo mensal completo por profissional (36 meses) e ficaria perto de 1 s por profissional.
- Estoque: alertas e relatórios (consumo por serviço/profissional) e inventário cego (Entrega 8); o painel já mostra só «itens abaixo do mínimo».
- Documentos clínicos (Entrega 9).
