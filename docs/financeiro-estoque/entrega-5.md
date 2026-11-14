# Financeiro / Repasse / Estoque — Entrega 5 (motor de repasse)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§2 D5–D9, D12, D22–D27, §3, §5.1–§5.9, §11, §12.1 F1–F6, F11, F15–F17, F21); plano: `plano-entregas.md`.
Migration: `supabase/migrations/20261114180000_fin_e5_repasse.sql` (aditiva; **não aplicada**). Prova SQL: `supabase/tests/fin_e5_repasse.test.sql` (132 asserções), rodada por `scripts/fin-e5-sql-proof.sh` (Postgres local descartável; usa `supabase/tests/fin_e5_stub.sql` só para a coluna `professionals.type`).

## O que existe

**Telas** (Financeiro › **Repasse**, `/financeiro/repasse`)
- **Lançamentos** — competência (mês/ano em português) + profissional. Mostra a **prévia do mês** (percentual, fixo por execução, comissões, estornos/ajustes, ajuste de faixa, fixo mensal, garantia, taxa de uso, saldo negativo trazido, retenções, **líquido a pagar**), a lista de lançamentos (data, paciente, serviço, papel, tipo, base, %, valor) e **Como foi calculado** em cada linha (regra aplicada, bruto, taxa, imposto, material, base, %, fórmula; nas correções, o valor anterior e o mês de origem). CSV/Excel. Gestor/Financeiro veem o total de **todos os profissionais** do mês, o alerta de **saldo negativo**, o aviso de **«sem regra»** e o botão **Recalcular repasse**. O **profissional vê só os próprios** lançamentos (sem seletor de profissional).
- **Regras** (Gestor/Admin configuram; Financeiro consulta) — lista por profissional com tipo, papel, «vale para» (padrão · categoria · serviço · item), valor (ou faixas), vigência. **Nova regra / Editar / Encerrar / Desativar**, fila **«sem regra»** com atalho «Criar regra» já preenchido, aviso de soma acima de 100 % do serviço, aceite do Owner para comissão sobre Medicação/Manipulado (alerta do art. 69 do CEM) e o relatório dessas comissões.
- **Simulador** (Gestor/Financeiro/Admin) — serviço, data, valor liquidado, taxa, material, imposto %, base já acumulada (faixas) e participantes → repasse de cada um e margem da clínica, com a conta. Nada é gravado. Usa o mesmo domínio testado nos exemplos A–H.
- Listas viram **cartões abaixo de 640 px** (`FinTable`); linhas de botões com `flex-wrap`; diálogos com grade que empilha.

| Papel | Lançamentos | Regras | Simulador | Recalcular |
|---|---|---|---|---|
| Owner/Admin | todos | configura | sim | sim |
| Gestor | todos | configura | sim | sim |
| Financeiro | todos | consulta | sim | sim |
| Profissional (clínico) | só os próprios, com memória | não vê | não | não |
| Recepção · Estoquista | **não** | não | não | não |

Recepção/Financeiro também são linhas em `professionals` (type `other` + papel): o «é profissional?» do repasse usa `private.appt_is_pro` (a versão da E4-clinical-pro), então a Recepção **não** enxerga repasse mesmo tendo linha de profissional.

## Tabelas (todas com RLS; escrita só por RPC; nada se apaga)
- `fin_share_rules` — regra por profissional · papel · alvo · tipo · valor · deduções · vigência · unidades. **Não se apaga** (trigger); desativa-se. Leitura por RLS (Gestor/Financeiro/Admin).
- `fin_share_lines` — lançamento de repasse **imutável** (nem UPDATE, nem DELETE, nem TRUNCATE). Chave de origem (`line_key`), mês do extrato (`period`), mês de origem, `origin_line_id` (a linha que está sendo corrigida), `kind` (`original` | `correction`), regra, bruto, base, %, valor **com sinal** e `memory` jsonb. **Sem SELECT direto** (o paciente só sai pela RPC, com a máscara da clínica).
- `fin_share_period_locks` — meses travados. **Preenchida pela Entrega 6** (fechamento); aqui só é consultada.

## Regras de cálculo (espelhadas em `src/lib/domain/finPayout.ts`; quem decide é o servidor)
- **Qual regra vale** (§5.1): profissional + papel + (serviço > categoria > padrão), vigente na **data do atendimento** e na unidade. Só vale o nível mais específico que existir; percentual e fixo por execução do mesmo nível valem juntos. «Sem repasse» (`none`) tira o participante do cálculo e da fila. Nenhuma regra → fila «sem regra» (`fin_share_unruled`; a Entrega 6 usa para bloquear a aprovação do fechamento).
- **Base** (§5.2): bruto liquidado − taxa do título − imposto (alíquota do mês, ou a mais recente anterior: F21) − material (custo do kit baixado), cada dedução só se ligada na clínica ou na regra (a regra sobrescreve). A parte do título que cabe ao item sai da distribuição proporcional da E2. Material em parcelado: proporcional a cada parcela. **A base nunca fica negativa** (decisão desta entrega).
- **Percentual** (D6): uma linha por participante × título liquidado, no **mês da liquidação** (regime de caixa) — ou no mês da execução, se o atendimento for realizado depois do dinheiro. Só nasce com atendimento realizado e título **liquidado** de pagamento ativo.
- **Fixo por execução** (D7): ao realizar o atendimento, no mês da execução, mesmo que o paciente ainda deva.
- **Faixas** (D26): cada linha usa a faixa atingida pela base acumulada do mês (prévia); a **prévia mensal** recalcula de forma progressiva e a diferença vira «ajuste de faixa» (Exemplo G). Base acumulada de toda a organização (padrão) ou só da unidade (`tier_scope`).
- **Pacote** (D8, §5.4): cada sessão/entrega tem o valor rateado da E4; só **libera** quando o liquidado acumulado do pacote cobre o valor rateado dela, por ordem de data, sempre inteira; antes disso fica «aguardando recebimento». Taxa e imposto pela taxa efetiva do pacote (taxa total ÷ valor total). Item de produto do pacote só gera **comissão**.
- **Comissão de produto** (D12): papel «Vendedor» (vendedor/indicador da venda); % ou R$ por unidade; base «liquidado − taxa» ou margem. Comissão sobre item de **Medicação/Manipulado** exige aceite do Owner (alerta do art. 69), gravado em `fin_audit_log` e em `fin_compliance_acceptances`; regra «todos os produtos» não gera comissão sobre medicação/manipulado enquanto não houver o aceite.
- **Estornos** (D9, §5.6): o motor é uma **reconciliação idempotente** — compara o que *deve* existir (por chave atendimento/título/regra/mês) com o que existe e só grava a **diferença**, como linha nova. Título estornado/chargeback, venda cancelada, atendimento cancelado, material ajustado e participantes trocados mudam o que deve existir. Mês de origem **aberto**: a linha é recalculada (soma volta a zero, sem apagar nada). Mês **travado**: linha `adjustment` negativa no **próximo mês aberto**, com `origin_period` e `origin_line_id`. «Serviço realizado, mas dinheiro devolvido» remove só o percentual; o fixo por execução fica (F5).
- **Prévia mensal** (`fin_share_month`, §5.9): 1 percentual (+ ajuste de faixa) · 2 fixo por execução · 3 fixo mensal (proporcional aos dias de vigência) · 4 complemento de **garantia mínima** (compara 1+2; com compensação, o excedente abate o saldo) · 5 comissões · 6 **taxa de uso** (negativa; fixa ou % do liquidado) · 7 ajustes (±) e saldo negativo trazido · 8 **retenções** sobre o total bruto positivo (dispensa por tipo para optante do Simples; valor mínimo). Total negativo: sem retenção, líquido 0, valor levado ao mês seguinte e marcado para o alerta do gestor (F6). As linhas mensais **não são gravadas aqui**: a Entrega 6 as grava no fechamento.
- **Regra usada não se reescreve**: depois que gerou repasse só o fim da vigência muda (e nunca antes do último atendimento que a usou); o tipo nunca muda; para trocar o regime, encerra-se a regra e cria-se outra a partir do dia seguinte (Exemplo E, F3). Sobreposição de vigência para a mesma pessoa/papel/alvo/tipo é recusada (`RULE_OVERLAP`).

## RPCs (security definer, `search_path=''`, `execute` só a `authenticated`)
Leitura: `fin_share_context`, `fin_share_rules_list`, `fin_share_lines_list`, `fin_share_month`, `fin_share_month_all`, `fin_share_unruled`, `fin_share_med_commissions`.
Escrita: `fin_share_rule_save` (retorna `{id, warnings, pct_sum}`), `fin_share_rule_set_active`, `fin_share_recalc`.
Recriadas (corpo anterior preservado + o novo): `private.fin_area_roles` (áreas `share_rules`, `share_lines`, `share_recalc`) e `public.fin_my_access` (versão da `20261114100000_fin_e4_clinical_pro`, mais as áreas novas e `own_share`).
Internas: `private.share_*` (período, regra vigente, faixas, deduções, construtores `share_build_sale_item` / `share_build_pkg` / `share_build_appt_fixed`, `share_apply`, `share_reconcile_*`, `share_month*`, `share_handle_event`).
Gatilhos novos: `trg_share_event` (AFTER INSERT em `fin_events`), `trg_share_receivable` (AFTER UPDATE de status/data/valor liquidado em `fin_receivables`), `trg_share_sale` (AFTER UPDATE de status/pago em `fin_sales`, que roda depois da alocação do recebimento aos itens). **Falha do motor nunca bloqueia** venda, recebimento nem atendimento: o erro vai para `fin_audit_log` (`entity = 'share_engine'`) e o evento fica sem `processed_at`; `fin_share_recalc` reprocessa.
Log: criação/alteração/desativação de regra (`share_rule`), recálculo (`share_recalc`), aceite de comissão sobre medicamento (`compliance`), na mesma transação.

## Exemplos do documento como testes automáticos
Os mesmos números, nos dois lados: **vitest** (`src/lib/domain/finPayout.test.ts`, 49 testes, domínio puro, centavos exatos) e **SQL** (`fin_e5_repasse.test.sql`, pelo motor real em Postgres, com os mesmos valores):

| Exemplo | Valor provado |
|---|---|
| A — consulta no cartão | base 455,00 → **273,00** no extrato de novembro (liquida 09/11; atendimento 10/10); alíquota de novembro herdada de outubro (F21) |
| B — aplicação, 2 participantes, material | base 708,00 → médico **212,40** + enfermeira **30,00** em outubro; margem **465,60** |
| C — procedimento 4× | **237,50** em nov, dez, jan e fev |
| D — pacote multiprofissional | rateio 450/270/90; outubro: **216,00 · 129,60 · 69,12**; novembro: **129,60 · 207,36** (consumido 1.710 de 1.800) |
| E — troca de regime | fixo mensal **1.250,00** + 22 × 30 = **660,00** → **1.910,00** |
| F — garantia mínima | sem compensação 8.000 / 10.000; com compensação 8.000 (saldo 2.000) / 8.000 (saldo 0) |
| G — faixas | 20.000 × 50 % + 10.000 × 60 % = **16.000,00**; linhas da prévia 16.500 e «ajuste de faixa» −500,00 |
| H — taxa de uso | 9.600 − 1.500 = **8.100,00** |
| §5.8 retenções | 10.000 − 150 − 465 = **9.385,00**; F16 Simples: sem retenção |
| F2 · F3 · F4 · F5 · F6 · F11 · F15 · F17 | fila «sem regra»; regra de 16/11; chargeback em mês travado → −300,00 em julho; fixo mantido; saldo negativo levado; aviso >100 %; base 450 → 270; aceite do Owner |

Também provados no SQL: permissões por papel (Gestor/Financeiro/Recepção/Estoquista/profissional/outra clínica), RLS, ausência de SELECT direto, imutabilidade (UPDATE/DELETE/TRUNCATE), log, idempotência (recalcular a clínica toda não grava nada), falha do motor, cancelamento de atendimento e de venda, venda de produto com comissão, execução depois do dinheiro, base nunca negativa, material por parcela, cobertura de pacote com 1 centavo faltando. Verificação por mutação (8 mutações no SQL — liberação, base, mês travado, idempotência, fixo mensal, progressivo, escopo do profissional, cobertura): todas derrubam pelo menos um teste.

## Código
- Domínio puro (testado): `src/lib/domain/finPayout.ts`; acesso: `finAccess.ts` (`canSeePayout`, `canSeeAllPayouts`, `canSeePayoutRules`, `canManagePayoutRules`, `canRecalcPayout`, aba «Repasse»).
- API: `src/lib/api/finPayout.ts`; hooks: `src/hooks/useFinPayout.ts`.
- Telas: `src/pages/finance/payout/{PayoutLayout,PayoutLinesTab,PayoutRulesTab,PayoutRuleDialog,PayoutMemoryDialog,PayoutSimulatorTab}.tsx`, `payoutText.ts`; rota em `src/app/router.tsx`.

## Decisões desta entrega (podem ser trocadas)
- **Base nunca negativa** (material maior que o recebido → base 0).
- **Regra «todos os produtos»** não gera comissão sobre Medicação/Manipulado sem o aceite do Owner registrado na clínica.
- **Garantia mínima e taxa de uso valem em todo mês de vigência**, mesmo sem produção (piso/aluguel não dependem de atendimento). Quem não quer, encerra a vigência.
- **Fixo mensal só entra na prévia**; vira linha gravada no fechamento (Entrega 6).
- **Quantidade vendida > 1 de serviço**: cada atendimento ligado à venda leva `1/N` de cada título (repasse por unidade).
- **Correção de data/valor liquidado** (`fin_correct_receivable`): a linha muda de mês (estorno no mês antigo + nova no mês novo), pela mesma regra de mês aberto/travado. O repasse usa o **bruto e a taxa do título** (não o `settled_net_cents`).
- Entrega e devolução de item de pacote entram na cobertura (devolução como valor negativo) e geram/estornam só **comissão**; implementado, **sem teste dedicado no SQL** (o domínio cobre a ordem de cobertura). A devolução não reabre sessão já liberada.
- Comissão por **margem** (custo médio) e a regra «todos os produtos» sobre medicação/manipulado sem aceite estão implementadas, mas sem teste dedicado no SQL.

## Riscos para aplicar a migration
1. **Ordem**: depois de E1 (`20261113100000`), E2 (`20261113180000`, `20261113213000`), E3 (`20261113230000`), E4 (`20261114090000`) e E4-clinical-pro (`20261114100000`). Versão `20261114180000`, nome sem versão `fin_e5_repasse`.
2. **Ledger**: aplicando por `apply_migration`, corrigir a versão de relógio do ledger da CLI na mesma sessão e conferir os dois ledgers (`docs/ops/MIGRATIONS_E_LEDGERS.md` §1 e §3).
3. **Recria 2 funções existentes** (`private.fin_area_roles`, `public.fin_my_access`) — cópia do corpo da E4 / E4-clinical-pro + o novo. **Comparar com o que está em produção antes** (se houve ajuste manual de permissões, ele se perde). Nenhuma outra função das E1–E4 muda.
4. **Três gatilhos novos em tabelas quentes** (`fin_events`, `fin_receivables`, `fin_sales`): somam um recálculo por título/venda/atendimento dentro da mesma transação, protegido por `exception when others` (não bloqueia). **Tempo não medido em volume**; na Clínica Teste, conferir o tempo de `fin_add_payment` e `fin_appt_complete` logo após aplicar (meta: abaixo de 1 s).
5. **Sem backfill**: vendas, recebimentos e atendimentos **anteriores** à migration não geram lançamento sozinhos. Para calcular o histórico (Clínica Teste Hefesto), cadastrar as regras e rodar **Recalcular repasse** (idempotente; pode ser repetido).
6. **Dados de teste QA** ficam na Clínica Teste Hefesto (QA); a migration não cria dado.
7. **Prova das E2–E4 com a E5 aplicada**: `TEST_FILE=supabase/tests/fin_e2_vendas.test.sql scripts/fin-e5-sql-proof.sh` (e `…e4_atendimento…`) passam. O teste do estoque da E3 (`I3 TRUNCATE`) só vale na pilha E3 sozinha (as tabelas da E4 já referenciam `stock_movements`); rodar com `scripts/fin-e3-sql-proof.sh`.
8. **Reversão** (sem lançamento ainda): `drop trigger trg_share_event on public.fin_events; drop trigger trg_share_receivable on public.fin_receivables; drop trigger trg_share_sale on public.fin_sales;`, derrubar `fin_share_*` (RPCs), `private.share_*` e as 3 tabelas novas; restaurar `fin_area_roles` e `fin_my_access` de `20261114090000`/`20261114100000`. Com lançamento gravado, **não** derrubar: encerrar as regras.
9. A prova SQL usa **datas fixas de 2026**; os Exemplos A, B, D, Y passam pelo caminho real das RPCs de atendimento (janela de 400 dias): depois de ~nov/2027 trocar as datas dessas quatro seções.

## Fica para as próximas entregas
- **Entrega 6**: fechamento mensal (travar o mês grava em `fin_share_period_locks`; gravar as linhas mensais — ajuste de faixa, fixo mensal, garantia, taxa de uso, retenções); bloqueio da aprovação com «sem regra» (`fin_share_unruled`); extrato do profissional, aceite/contestação (F7, F8), NF, pagamento, destravar com motivo (F9), exportações e arquivo de pagamento (F14); tabela do gestor × extratos (F13).
- **Entrega 7**: dashboard com números clicáveis (F12) e fila «atendido sem venda».
- **Entrega 8**: relatórios de consumo por serviço/profissional.
- Ligação do evento de **venda de produto no estoque** à comissão por margem usa o custo das saídas (`stock_movements` da venda); conferir com estoque real antes de ligar margem como base padrão.
