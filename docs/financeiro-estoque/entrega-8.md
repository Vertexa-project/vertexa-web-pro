# Financeiro / Repasse / Estoque — Entrega 8 (inventário cego, transferências entre unidades, alertas e relatórios de estoque)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§3 permissões, §8.2, §8.6 inventário, §8.7 transferência, §8.8 alertas e relatórios, §11, §12.2 E6/E7/E10/E16); plano: `plano-entregas.md` (item 8).
Migration: `supabase/migrations/20261117100000_fin_e8_inventario.sql` (aditiva; **não aplicada**). Prova SQL: `supabase/tests/fin_e8_inventario.test.sql` (205 asserções), rodada por `scripts/fin-e8-sql-proof.sh` (Postgres local descartável). Medição: `supabase/tests/fin_e8_perf.sql` (`PERF=1 scripts/fin-e8-sql-proof.sh`).

## Telas (Estoque › abas novas, para Admin, Gestor, Estoquista e Financeiro-consulta)
- **Inventário** (`/estoque/inventario`, detalhe em `?id=`): *Abrir inventário* (Gestor/Admin: unidade, nome, escopo todo/categoria/tipo, **contagem cega ligada por padrão**) congela o saldo de cada item/lote. Quem conta (Estoquista/Gestor) vê só item, lote e o campo «Contado» — o servidor não devolve esperado, movimentado, custo nem diferença a quem conta nem durante a contagem cega. Botões: *Salvar contagem* (só o que mudou, em lotes de 500), *Contar item fora da lista* (item/lote que não constava), *Encerrar contagem* (exige tudo contado, ou a confirmação «o que sobrou é zero»). **Revisão** (Gestor/Admin; Financeiro só consulta): esperado × movimentado durante a contagem × contado × diferença × valor, resumo (sobra, falta, efeito), filtro «só com diferença», CSV/Excel. *Aprovar e ajustar estoque* (motivo obrigatório quando há diferença) lança um movimento `inventory` por linha a custo médio vigente; *Reabrir para recontar* e *Cancelar inventário* pedem motivo. Um inventário aberto por unidade.
- **Transferências** (`/estoque/transferencias`): *Nova transferência* (origem, destino, itens com saldo disponível em unidades inteiras; lote pelo vencimento mais próximo, vencido não vai); *Receber* confere cada linha (quantidade, lote, validade) — **quantidade a menos ou lote diferente exige motivo** e a diferença vira perda da origem; *Cancelar* antes de receber devolve tudo à origem (estorno), com motivo. Em trânsito há mais de N dias (padrão 3) aparece «Parada há X dias» e um aviso.
- **Alertas** (`/estoque/alertas`): lotes vencidos, lotes vencendo (janelas 90/60/30, configuráveis por Gestor/Admin em «Janelas dos alertas»), abaixo do mínimo, consumo sem saldo e transferências paradas; cada linha leva à tela que resolve (Saídas, Saldo, Entradas, Consumo sem saldo, Transferências). A contagem total (`fin_stock_alert_counts`) está pronta para o painel; o painel da E7 já mostra «abaixo do mínimo» e não foi alterado.
- **Relatórios** (`/estoque/relatorios`): posição e valor, movimentações no período, consumo por atendimento (por serviço, profissional ou item), perdas (perda, quebra, vencimento e diferença de transferência), validade, itens sem giro e compras por fornecedor. Filtros de unidade/período/parâmetros; **total = soma de todas as linhas do filtro** (também quando a tela mostra só as primeiras 2.000); CSV, Excel e PDF.
- Celular: `FinTable` (cartões abaixo de 640 px), botões e seletores com `flex-wrap`, diálogos com `max-w-[calc(100vw-1.5rem)]`, valores sem «-R$ 0,00» (`moneyOrZero`), datas de formulário por `todayIsoBR` e exibição em America/Sao_Paulo.

| Papel | Inventário | Transferência | Alertas / Relatórios |
|---|---|---|---|
| Owner/Admin, Gestor | abre, reabre, cancela, **aprova**, revisa valores | envia, recebe, cancela | vê; configura janelas |
| Estoquista (suas unidades) | conta e encerra a contagem (cego) | envia, recebe, cancela | vê (com custo) |
| Financeiro | consulta a revisão (esperado × contado × valor) | consulta | consulta |
| Recepção, profissional | sem acesso | sem acesso | sem acesso |

## Servidor (migration)
- Tabelas novas `stock_transfers`, `stock_transfer_lines`, `stock_inventories`, `stock_inventory_lines`; colunas `transfer_id`/`inventory_id` em `stock_movements`; `fin_settings` ganha `stock_expiry_alert_days` (90/60/30), `stock_idle_days` (90), `stock_transfer_alert_days` (3). Escrita só por RPC security definer (`search_path=''`); gatilhos impedem apagar; `stock_inventory_lines` não tem leitura direta (RLS) — a contagem cega é garantida no servidor.
- RPCs: `fin_stock_transfer_send/receive/cancel`, `fin_stock_transfers`; `fin_inventory_open/count/finish/reopen/cancel/approve`, `fin_inventory_list`, `fin_inventory_lines`; `fin_stock_alerts`, `fin_stock_alert_counts`, `fin_stock_alert_settings_save`; `fin_stock_report` (7 relatórios). Área nova `inv_manage` (aprovar: Gestor/Admin; consultar: + Financeiro) em `fin_area_roles`/`fin_my_access` (recriadas a partir da E7).
- `private.stock_apply` e `private.stock_reverse_one` recriadas (corpo da E3 + vínculo com transferência/inventário). **Mudança de comportamento**: estorno manual de movimento de transferência/inventário é recusado (usar cancelar transferência / reabrir inventário).
- Diferença do inventário = contado − (esperado congelado + movimentado entre o congelamento e o fim da contagem): venda/atendimento durante a contagem não vira falsa diferença. Custo médio: transferência sai e entra ao custo médio da origem; a diferença no recebimento é perda da origem (registrada na linha e no log).
- Saldo continua = soma das movimentações imutáveis; todo ajuste/saída/entrada passa por `stock_apply` e grava em `fin_audit_log` na mesma transação.

## Desempenho
Volume: 1.000 itens × 2 unidades × 3 lotes (6.000 lotes), ~72 mil movimentações, inventário de 3.000 linhas. Postgres 16 local, como usuário Gestor, média de 5 rodadas (ms): saldo E3 (2.000 linhas) **36**; alertas completos 16; contagem de alertas (painel) 5; relatórios: posição 47, movimentação 30 d 118 / 12 m 125, consumo 52 / 89, perdas 73, validade 52, sem giro 34, compras 3; lista de transferências 16; abrir inventário (3.000 linhas) 95; contar 500 linhas 44; encerrar contagem 124; revisão 10; **aprovar inventário (500 ajustes) 577**. Tudo abaixo de 1 s.

**Causa e correção da lentidão do saldo (E3).** A medição inicial dava média 4,7 s e máximo 23 s em `fin_stock_balances`. `EXPLAIN`/`auto_explain` mostrou que as 5 primeiras chamadas na mesma conexão levam ~50 ms e **a 6ª passa a usar o plano genérico** do PostgreSQL para a consulta interna da função (parâmetros `p_unit`/`p_item`/`p_search` desconhecidos), que fica ~500× mais lento (23 s). Conexões reaproveitadas do pooler caem nisso em produção. A migration recria a função da E3 (mesmo corpo, resultado idêntico, grants preservados) com `set plan_cache_mode = force_custom_plan`. Após a correção: 36–46 ms em todas as rodadas (inclusive 8+ chamadas seguidas). Efeito colateral: nenhum além de planejar a consulta a cada chamada (~1 ms).

## Provas
- SQL (local, apagado ao fim): E8 205 asserções (RLS, permissões por papel, imutabilidade, contagem cega, saldos depois de inventário e transferência, custo médio, divergência, cancelamento, alertas, relatórios com soma = total). Regressão com a E8 aplicada: E3 (130), E4 (155), E5 (132), E6 (163, com C10/F8b e C7b alinhados à resposta que já devolve o extrato ao aceite), E7 (111) — todas verdes. A prova da E3 (I3, TRUNCATE) agora aceita o bloqueio por FK (0A000), que passa a ocorrer antes do gatilho.
- Vitest: 224 arquivos, 1.811 testes verdes (novos: `stockE8.test.ts`, `StockE8.test.tsx`, `finAccess.test.ts` ampliado); `tsc`, `eslint --max-warnings 0` e `vite build` verdes.

## Para aplicar
1. Aplicar `20261117100000_fin_e8_inventario.sql` antes do merge (cria objetos novos; recria 4 funções da E3/E7: `fin_area_roles`, `fin_my_access`, `stock_apply`, `stock_reverse_one`, e `fin_stock_balances`). Conferir o ledger em `docs/ops/MIGRATIONS_E_LEDGERS.md`.
2. Riscos: `stock_apply`/`stock_reverse_one` são o caminho de toda movimentação (E3/E4): rodar a prova da E3/E4 contra o banco clonado é recomendável. Estorno de movimento de transferência/inventário passa a exigir o fluxo próprio.
3. Aceite no ar na Clínica Teste Hefesto (QA): criar dados de teste (itens com saldo em 2 unidades) e percorrer inventário cego (Estoquista e Gestor), transferência com divergência, alertas e relatórios.

## Fora desta entrega / Entrega 9
- Conferência visual no navegador (390 e 1280 px) das quatro telas novas e dos diálogos: só testada por vitest (cartões < 640 px) — falta o clicado no ar.
- Alerta do Estoque no painel financeiro (E7): `fin_stock_alert_counts` existe, o painel não consome ainda (a fila «abaixo do mínimo» da E7 segue).
- Escolha manual de lote no envio da transferência (o RPC aceita `lot_id`; a tela usa FEFO) e leitura de código de barras na contagem.
