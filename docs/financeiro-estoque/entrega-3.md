# Financeiro / Repasse / Estoque — Entrega 3 (estoque básico)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§2 D13–D17 e D20, §3, §8.1–8.4, §11, §12.2 E1, E4, E5, E9, E12, E14, E15); plano: `plano-entregas.md`.
Migration: `supabase/migrations/20261113230000_fin_e3_estoque.sql` (aditiva; **não aplicada**). Prova SQL: `supabase/tests/fin_e3_estoque.test.sql`, rodada por `scripts/fin-e3-sql-proof.sh` (Postgres local descartável).

## O que existe

**Telas** (Estoque, `/estoque`; as abas aparecem pela matriz de papéis; todas as listas viram cartões abaixo de 640 px)
- **Saldo** (`/estoque/saldo`) — item × unidade da clínica: saldo, custo médio, valor total, próxima validade, mínimo, lotes (vencido marcado) e fração em unidade aberta. Filtros: unidade, busca, «só com saldo». CSV e Excel.
- **Entradas** (`/estoque/entradas`) — documentos de entrada com filtros (período, unidade), «Ver itens» e «Estornar» (motivo obrigatório).
  - **Nova entrada**: saldo inicial, compra (fornecedor, nota, data, frete) e bonificação/doação (origem obrigatória). Por linha: item, quantidade (unidade de **estoque**), custo unitário, lote e validade.
  - **Importar XML da NF-e**: o arquivo é lido **no navegador** (nada vai ao servidor antes de «Confirmar entrada»). Mostra fornecedor (por CNPJ), nota, série, emissão, frete e chave; cada item vem vinculado sozinho (de/para salvo → código de barras → nome igual) ou pede o vínculo; o fator de conversão (caixa → ampola) é sugerido e editável; lote e validade vêm do `rastro` da nota (vários lotes no mesmo item viram uma linha por lote, com o valor rateado); item da nota pode ser marcado «não entra no estoque». A mesma chave não importa duas vezes.
- **Saídas** (`/estoque/saidas`) — lista (inclui a baixa automática das vendas) e **Nova saída**: consumo interno (setor/finalidade + motivo), perda/quebra/vencimento (tipo + motivo) e uso por paciente. Lote sugerido pela validade (vence primeiro, sai primeiro) e trocável; uso fracionado por **unidade aberta**; mostra de qual lote sai e o custo.
- **Movimentações** (`/estoque/movimentacoes`) — kardex: filtros por período, unidade, item, movimento e sentido; custo unitário, total e saldo depois de cada linha; «Estornar».
- **Itens** (Entrega 1) continua igual.

| Papel | Saldo / Entradas / Saídas / Movimentações | Lança entrada, saída e estorno | Vê custo e valor |
|---|---|---|---|
| Owner/Admin | sim | sim | sim |
| Gestor | sim | sim | sim |
| Estoquista | sim (só as unidades dele) | sim | sim (ele digita o custo) |
| Financeiro | só consulta | não | sim |
| Recepção | **não** (nem o saldo; o servidor devolve vazio/recusa) | não | não |
| Profissional | não (a baixa do kit é da Entrega 4) | não | não |

## Tabelas (todas com RLS; escrita só por RPC; sem exclusão física)
`stock_suppliers`, `stock_supplier_item_map` (de/para do fornecedor), `stock_entries` (cabeçalho), `stock_lots` (item + unidade + lote), `stock_balances` (saldo e custo médio por item + unidade), `stock_open_units` (unidade aberta: fração 0–1, paciente, validade), `stock_movements` (imutável).
- `stock_movements` tem trigger que **recusa UPDATE, DELETE e TRUNCATE** (até do dono do banco); apagar a clínica inteira (cascata) continua possível.
- Saldo nunca é editado: só muda dentro de `private.stock_apply`. Prova: saldo = soma dos lotes = soma das movimentações em todo item e unidade.

## RPCs (security definer, `search_path=''`, `execute` só a `authenticated`; toda uma passa por `private.fin_can(…, 'stock_move', unidade)`)
Escrita: `fin_stock_entry`, `fin_stock_exit`, `fin_stock_reverse`, `fin_stock_reverse_entry`, `fin_stock_save_supplier`.
Leitura: `fin_stock_balances`, `fin_stock_movements`, `fin_stock_entries`, `fin_stock_lots` (lotes FEFO e unidades abertas de um item), `fin_stock_patients` (busca de paciente para o uso individual).
Internas: `private.stock_apply`, `private.stock_exit`, `private.stock_reverse_one`, `private.stock_lot_open_qty`, gatilhos `stock_on_sale_item` e `stock_on_sale_cancel`.
Recriadas da E2 (mesmo corpo + a área nova): `private.fin_area_roles` e `fin_my_access` (área `stock_move`: escreve Estoquista/Gestor; lê também Financeiro).

## Regras que valem no servidor
- **Custo médio** por item + unidade (não por lote), 4 casas de centavo, meio-para-cima: `(saldo × CM + valor que entra) ÷ (saldo + qtde)`. **E1**: 10 un a R$ 40 + 20 un a R$ 46 → R$ 44,00; saída de 3 un = R$ 132,00. Saída não muda o custo médio; estorno é a mesma conta com sinais trocados.
- **Saldo inicial** (E15): uma vez por item e unidade; estornado libera de novo. **Compra**: fornecedor e número da nota obrigatórios, custo > 0; **bonificação**: origem obrigatória, custo pode ser zero; **XML**: chave de 44 dígitos obrigatória e única entre entradas ativas. Mesmo fornecedor + mesmo número de nota também não entra duas vezes.
- **Frete** rateado pelo valor dos itens (meio-para-cima por linha, resto na última): 1.000 e 3.000 com frete 400 → 1.100 e 3.300.
- **Lote e validade**: item com controle de lote exige lote e validade em toda linha; validade já vencida não entra; mesmo lote com outra validade é recusado. Item sem controle usa o lote único «SEM LOTE».
- **Saída** (E4): lote vencido **não sai** para consumo/venda; só como perda por vencimento, e com confirmação. Perda por vencimento só vale para lote vencido. Sem lote escolhido, o sistema pula o vencido e usa FEFO; só sobrou vencido → «lote vencido». Saldo negativo é proibido.
- **Motivo obrigatório**: perda/quebra/vencimento (tipo + motivo), consumo de setor (finalidade + motivo), estorno.
- **Uso fracionado** (E5, E12, D20): até 3 casas; item não fracionado só sai inteiro; acima de 1 só inteiro. A dose sai de uma **unidade aberta**: validade = a menor entre a do lote e (abertura + «validade após aberto»); item de uso individual: a unidade fica do paciente que a abriu e dose para outro paciente é bloqueada (abre-se uma nova); unidade aberta vencida não dá dose (só descarte como perda); descartar a sobra fecha a unidade. A fração reservada por unidade aberta não sai em saída de unidade inteira.
- **Estorno**: linha nova apontando para a original (mesmo lote, mesmo custo); não estorna estorno nem estorna duas vezes; entrada já consumida não estorna (REVERSAL_NO_STOCK) — estorne antes as saídas; estorno do documento inteiro estorna todas as linhas dele.
- **Log** (`fin_audit_log`, mesma transação): toda movimentação (create/reverse, com nome do item, lote, validade, quantidade, custo, saldo e custo médio depois, motivo), cada entrada, fornecedor e de/para. Aparece em Financeiro › Cadastros › Histórico (gestor).
- **Venda de produto baixa o estoque (E9)**: gatilho em `fin_sale_items` — só quando o item **já tem saldo lançado** na unidade da venda. Saldo insuficiente recusa a venda inteira (`INSUFFICIENT_STOCK`; nenhuma venda nasce). Item sem estoque lançado vende como na Entrega 2. **Cancelar a venda** (`fin_cancel_sale`) devolve o estoque (estorno ligado à baixa); a baixa de venda não se estorna à mão.

## Código
- Domínio puro (testado): `src/lib/domain/stockMoves.ts` (custo médio, valor de saída, frete, FEFO, validade, fração/unidade aberta, validação do formulário, mensagens), `src/lib/domain/nfe.ts` (leitura do XML, de/para, linhas da entrada); acesso: `finAccess.ts` (`canSeeStockMoves`, `canMoveStock`, `stockTabs`).
- API: `src/lib/api/stockMoves.ts`; hooks: `src/hooks/useStockMoves.ts`.
- Telas: `src/pages/stock/{StockShell,StockBalanceTab,StockEntriesTab,StockExitsTab,StockMovementsTab,ManualEntryDialog,XmlImportDialog,ExitDialog,ReverseDialog,MovementTable,movementFormat}`; `StockPage` (Itens) passou a usar a mesma casca.

## Decisões desta entrega (podem ser trocadas)
- **Recepção não acessa o módulo** (nem o saldo em quantidade): «Recepção não vê custo» foi resolvido pelo caminho mais restrito. A venda de produto continua funcionando para ela (a baixa roda no servidor).
- **Quando a venda baixa estoque**: só item com saldo lançado na unidade; saldo insuficiente **bloqueia** a venda (não deixa negativo). A baixa de kit em atendimento sem saldo («consumo sem saldo», §8.5) é da Entrega 4.
- **Estoquista vê custo** (ele digita o custo nas entradas); Financeiro vê custo e valor, sem lançar.
- **Unidade aberta**: cada unidade aberta é de 0 a 1 unidade de estoque; dose acima de 1 só em unidades inteiras. Fração de 3 casas (ex.: 5 ml de frasco de 30 ml = 0,167) é o limite da especificação.
- **Importação de XML**: custo do item = `vProd − vDesc` da nota; frete = `vFrete` do total (ou a soma dos itens). Seguro/outras despesas não entram no custo. Fornecedor novo é criado na confirmação (CNPJ da nota). XML de NF-e de entrada de produtor rural/CPF também é aceito.
- Tudo ou nada: se qualquer linha falhar, nada da entrada é gravado.

## Riscos para aplicar a migration
1. **Ordem**: aplicar depois de `20261113100000` (E1), `20261113180000` (E2) e `20261113213000` (ajuste da busca de paciente; `fin_stock_patients` usa `profiles.status`, como esse ajuste). O arquivo tem versão `20261113230000`.
2. **Ledger**: aplicando por `apply_migration`, corrigir a versão de relógio do ledger da CLI na mesma sessão e conferir os dois ledgers (`docs/ops/MIGRATIONS_E_LEDGERS.md` §1 e §3); o nome do arquivo sem versão é `fin_e3_estoque`.
3. **Muda comportamento da venda** (único ponto): 2 gatilhos novos em `fin_sale_items` e `fin_sales`. Antes de lançar o primeiro saldo, nada muda; depois, a venda de produto daquele item/unidade passa a exigir saldo. Os gatilhos não alteram nenhuma função da E2.
4. Recria `private.fin_area_roles` e `fin_my_access` (cópia da E2 + `stock_move`). Se a E2 tiver sido editada depois, comparar antes.
5. Dados de teste QA ficam na Clínica Teste Hefesto (QA); a migration não cria dado.
6. Reversão (nenhum dado antes do uso): `drop trigger stock_on_sale_item on public.fin_sale_items; drop trigger stock_on_sale_cancel on public.fin_sales;` e, se preciso, derrubar as funções `fin_stock_*`/`private.stock_*` e as tabelas `stock_*` (menos `stock_items`). Com movimentos lançados, **não** derrubar: estornar.
7. Desempenho medido localmente (Postgres 18, `jit=off`, 1.000 itens × 2 unidades × 3 lotes, 72 mil movimentações): saldo (2.000 linhas) 46 ms; kardex (200 linhas de 72 mil) 8 ms; filtrado por item 8–17 ms. A lista de Itens (E1) lê a tabela por RLS (~0,4 s para 1.000 itens, como antes).

## Fica para as próximas entregas
- **Entrega 4**: baixa automática do kit no atendimento (editável), custo do material no atendimento, «consumo sem saldo» com alerta ao gestor, entrega de item de pacote, uso individual ligado ao Paciente 360 e ao atendimento (`appointment_id`), devolução de paciente.
- **Entrega 8**: inventário com contagem cega e ajuste, transferência entre unidades (em trânsito, perda na diferença), alertas (mínimo, vencimento 90/60/30, consumo sem saldo, transferência parada), relatórios (posição valorizada, consumo por serviço/profissional, perdas por motivo, sem giro, compras por fornecedor) e devolução ao fornecedor.
- **Entrega 5/6**: custo de material na base de repasse e ajuste de material no mês travado (E11).
- Cadastro/edição de fornecedor em tela própria e importação do saldo inicial por planilha (hoje só pelas telas de entrada; o fornecedor nasce na compra).
- Leitura de código de barras pela câmera.
