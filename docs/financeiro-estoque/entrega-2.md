# Financeiro / Repasse / Estoque — Entrega 2 (vendas, recebimentos, títulos e caixa diário)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§2, 3, 4.2, 4.3, 4.5, 5.2, 11, 12.1 F15, F18–F20, 12.2 E13).
Migration: `supabase/migrations/20261113180000_fin_e2_vendas.sql` (aditiva; **não aplicada** até o veredito da Entrega 1). Prova SQL: `supabase/tests/fin_e2_vendas.test.sql`, rodada por `scripts/fin-e2-sql-proof.sh` (Postgres local descartável).

## O que existe

**Telas** (Financeiro, `/financeiro`; as abas aparecem pela matriz de papéis)
- **Vendas** (`/financeiro/vendas`) — lista com filtros (período, unidade, situação) e CSV/Excel. «Nova venda»: paciente (busca), itens (serviço, pacote, produto de revenda ou manipulado), quantidade, preço, desconto % por item e desconto no total, vendedor e indicador. Abrir a venda mostra itens, recebimentos e títulos; botões «Lançar recebimento» e «Cancelar venda» (motivo obrigatório).
- **Títulos** (`/financeiro/titulos`) — previstos, liquidados e estornados, com filtros e exportação; «Liquidar», «Corrigir» (só gestor) e «Estornar» (recusa/chargeback).
- **Caixa** (`/financeiro/caixa`) — «Meu caixa»: abrir com troco, sangria, suprimento, fechar (contado × esperado por forma, justificativa se há diferença). Abaixo, relatório por dia, operador e unidade com «Aprovar» (gestor).
- **Ficha do paciente** — só o botão «Nova venda» (leva a Vendas com o paciente já escolhido). Aparece para quem lança venda.

| Papel | Vendas | Títulos | Caixa | Cadastros |
|---|---|---|---|---|
| Owner/Admin | tudo | tudo | todos os caixas; aprova | tudo |
| Gestor | tudo; muda preço; cancela | tudo; corrige liquidação | todos; aprova | como na E1 |
| Financeiro | lança; muda preço; cancela | liquida e estorna | abre o próprio; vê todos | como na E1 |
| Recepção | registra venda e recebimento (sem mudar preço, sem cancelar) | **não vê** (taxa) | só o próprio caixa | sem acesso |
| Profissional | só as vendas em que é vendedor | não | não | não |

## Tabelas (RLS; escrita só por RPC; sem exclusão física)
`fin_sales`, `fin_sale_items`, `fin_payments`, `fin_payment_allocations`, `fin_receivables`, `fin_cash_registers`, `fin_cash_movements`, `fin_compliance_acceptances`, `fin_events` (sem leitura pelo cliente; fila para o repasse).

## RPCs (security definer, `search_path=''`, `execute` só a `authenticated`)
Venda: `fin_sale_catalog`, `fin_sale_patients`, `fin_compliance_status`, `fin_accept_compliance`, `fin_save_sale`, `fin_sales_list`, `fin_sale_get`, `fin_cancel_sale`.
Recebimento/títulos: `fin_payment_options`, `fin_add_payment`, `fin_settle_receivable`, `fin_correct_receivable`, `fin_reverse_receivable`, `fin_receivables_list`.
Caixa: `fin_open_cash`, `fin_cash_movement`, `fin_my_open_cash`, `fin_cash_summary`, `fin_close_cash`, `fin_approve_cash`, `fin_cash_report`.
Recriadas da E1 (comportamento anterior preservado): `private.fin_area_roles` (áreas novas: sales, sales_price, sale_cancel, cash, cash_all, cash_approve, receivables, receivables_fix, compliance) e `fin_my_access`.
Rotina diária: `private.fin_auto_settle_all()`, agendada em pg_cron `fin-e2-auto-settle` (00:10 de Brasília), só se a extensão existir.

## Regras no servidor
- **Venda**: preço de tabela só muda com papel gestor/financeiro/admin; desconto por item (valor ou %) e no total, este rateado entre os itens proporcionalmente ao líquido (meio-para-cima por linha, resto no último). F15: consulta R$ 500 com 10% → item líquido 450,00. Total > 0.
- **E13**: medicação aplicada não vende; material de consumo e item não vendável também não. **F18**: manipulado em unidade sem licença sanitária válida exige o aceite do Owner, gravado em `fin_compliance_acceptances` (uma vez por unidade e tipo) e no histórico.
- **Cancelamento**: motivo obrigatório; recebimentos e títulos viram «estornado» (nada é apagado); grava `fin_audit_log` (`reverse`) e eventos em `fin_events` (`sale_canceled`, `payment_reversed`, `receivable_reversed`, com `was_settled`) para o motor de repasse da Entrega 5.
- **Recebimento**: vários por venda; não passa do saldo; só o gestor lança com data passada. Gera um título por parcela: bruto ÷ n (meio-para-cima, resto na última), taxa meio-para-cima por linha. Crédito parcelado sem antecipação: parcela n em data + prazo × n. Com antecipação: todas no prazo de antecipação, com a taxa somada. Boleto: taxa fixa na 1ª linha. Exemplo C (R$ 2.000, 4×, 5%, 30 dias) → 4 × 500 bruto, 25 taxa, 475 líquido, +30/60/90/120 dias.
- **Distribuição por item** (§5.2): cada recebimento é rateado entre os itens pelo líquido de cada um, em `fin_payment_allocations` (base do repasse).
- **Liquidação**: automática na data prevista quando `fin_settings.auto_settle` (no ato, se a data já chegou — Pix D+0; depois, pela rotina diária); ou manual. Gestor corrige data/valor liquidado com motivo e antes/depois no log. Recusa/chargeback: título «estornado», venda volta a «paga parcialmente/aberta» e evento para o repasse.
- **Caixa**: um caixa aberto por operador (F20; também por índice único parcial). Recebimento do operador entra no caixa aberto dele na unidade da venda; espécie e Recepção sem outro papel exigem caixa aberto. Sangria e suprimento com motivo; sangria não passa do dinheiro em caixa. Fechamento: contado × esperado por forma (espécie, Pix, transferência, boleto e cartão por maquininha e bandeira; forma não contada vale o esperado). Soma das diferenças acima de `cash_diff_limit_cents` (padrão 0) exige justificativa e fica «aguarda aprovação» (F19); gestor/admin aprova, e quem fechou não aprova o próprio (exceto admin). Caixa de dia anterior aberto aparece como pendência no relatório.
- **Profissional** lê só vendas em que é vendedor (RLS e RPC), sem recebimentos nem títulos.

## Código
- Domínio puro (testado): `src/lib/domain/finSales.ts` (rateio, venda, títulos, caixa, mensagens); acesso: `finAccess.ts` (`financeTabs`, `canSeeSales/Cash/Receivables`).
- API: `src/lib/api/finSales.ts`; hooks: `src/hooks/useFinSales.ts`.
- Telas: `src/pages/finance/{SalesTab,TitlesTab,CashTab}.tsx`; `src/components/fin/{NewSaleDialog,PaymentDialog,FinFilters,NewSaleButton}.tsx`.

## Decisões desta entrega (podem ser trocadas)
- Recepção não vê títulos nem taxas; vê as formas de pagamento sem taxa (RPC `fin_payment_options` só devolve taxa a quem lê meios de pagamento).
- Cancelar venda: gestor e financeiro (Recepção não). Venda não é editada depois de salva: cancela-se e refaz-se.
- Limite de diferença do caixa vale sobre a soma das diferenças de todas as formas.
- Preço editável por gestor, financeiro e admin; desconto liberado a quem vende.
- Estorno em dinheiro de caixa já fechado não reabre o caixa: gera evento (`cash_register_closed`) para o fechamento do repasse/conciliação.

## Fica para a Entrega 5 (e seguintes)
Motor de repasse (consumo de `fin_events`, regras de estorno do §5.6, linha negativa no mês seguinte), baixa de estoque por venda de produto/kit, pacote com sessões consumidas, atendimento «realizado sem venda», dashboard e pendência de caixa no dashboard.
