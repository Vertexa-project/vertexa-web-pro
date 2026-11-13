# Financeiro / Repasse / Estoque — Entrega 4 (atendimento com participantes, kit automático e pacotes)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§2 D3–D4, D8, D14, D20, §3, §4.4, §5.4, §8.2, §8.5, §9, §11, §12.2 E2, E3, E11, E12, E17); plano: `plano-entregas.md`.
Migration: `supabase/migrations/20261114090000_fin_e4_atendimento.sql` (aditiva; **não aplicada**). Prova SQL: `supabase/tests/fin_e4_atendimento.test.sql`, rodada por `scripts/fin-e4-sql-proof.sh` (Postgres local descartável; usa `supabase/tests/fin_e4_stub.sql` só para agenda, consulta e acesso ao paciente).

## O que existe

**Telas**
- **Financeiro › Atendimentos** (`/financeiro/atendimentos`) — lista com filtros (período, unidade, situação, «só atendidos sem venda», «só com consumo sem saldo»), CSV/Excel e **Novo atendimento**. Abrir um atendimento mostra participantes, origem (venda ou pacote), material e custo; botões **Realizar atendimento**, **Editar**, **Trocar participantes**, **Corrigir kit** e **Cancelar atendimento**.
  - *Novo atendimento*: paciente (busca), unidade, data, serviço, **origem** (venda avulsa do paciente, sessão de pacote com saldo, ou «sem venda») e participantes por papel (responsável obrigatório; executor e auxiliares conforme o serviço prevê).
  - *Realizar atendimento — confirmar o kit*: o kit do serviço vem pré-preenchido (unidade de **consumo**), com o lote que vence primeiro sugerido; o executor troca o lote, muda a quantidade, remove ou adiciona item. Mostra saldo, quanto sai do estoque e o custo estimado (a quem vê custo). Sem saldo, avisa que o atendimento **é salvo mesmo assim**.
- **Financeiro › Pacotes dos pacientes** (`/financeiro/pacotes`) — saldo de sessões e itens de cada pacote vendido, validade, valor rateado e **Entregar** (item de produto), que baixa o estoque.
- **Estoque › Consumo sem saldo** (`/estoque/sem-saldo`) — alerta com o total em aberto; cada baixa que faltou, com o atendimento, a quantidade e o custo estimado; **Dar baixa** (retroativa) ou **Resolver por ajuste**.
- **Estoque › Movimentações** — nova ação **Devolução de paciente** nas linhas de venda e de entrega de item de pacote; o **Estornar** some das entregas e devoluções (e a baixa de atendimento se corrige no atendimento).
- **Ficha do paciente** — botão **Novo atendimento** (abre Financeiro › Atendimentos já com o paciente) e cartão **Pacotes do paciente** (saldo de sessões/itens e validade; sem valores para o profissional). A ficha não muda para quem não tem acesso.
- Todas as listas viram **cartões abaixo de 640 px** (`FinTable`); os diálogos usam grade que empilha no celular.

| Papel | Atendimentos | Custo do material | Cria/realiza/corrige/cancela | Pacotes dos pacientes | Entrega item de pacote | Consumo sem saldo |
|---|---|---|---|---|---|---|
| Owner/Admin | todos | sim | qualquer um | sim | sim | resolve |
| Gestor | todos | sim | qualquer um | sim | sim | resolve |
| Financeiro | todos (paciente, serviço, valor, data) | sim | **não** (consulta) | sim | não | só consulta |
| Estoquista | não | — | não | não | sim | resolve |
| Recepção | não | **não** | não | sim | sim (sem ver custo) | não |
| Profissional | só os que participa | **não** | o **próprio** (responsável/executor) | só do paciente a que tem acesso, sem valores | não | não |

## Tabelas (todas com RLS; escrita só por RPC; sem exclusão física)
`fin_appointments`, `fin_appointment_participants`, `fin_appointment_materials`, `stock_shortfalls`, `fin_patient_packages`, `fin_patient_package_items`, `fin_package_ledger`, `stock_patient_returns`.
- **Atendimento, participantes e materiais não têm SELECT direto**: o custo do material só sai pelas RPCs, mascarado para quem não lê o estoque. Pacotes, razão, sobras e devoluções têm leitura por RLS (papéis da tabela acima).
- `fin_appointments`, `fin_appointment_materials`, `stock_shortfalls`, `fin_patient_packages` e `fin_patient_package_items` **não se apagam** (nem TRUNCATE); `fin_package_ledger` e `stock_patient_returns` são **imutáveis** (nem UPDATE). Apagar a clínica inteira (cascata) continua possível, como na E3.

## RPCs (security definer, `search_path=''`, `execute` só a `authenticated`)
Escrita: `fin_appt_save`, `fin_appt_complete`, `fin_appt_correct`, `fin_appt_cancel`, `fin_appt_set_participants`, `fin_package_deliver`, `fin_stock_patient_return`, `fin_shortfall_resolve`.
Leitura: `fin_appt_context`, `fin_appt_patients`, `fin_appt_list`, `fin_appt_get`, `fin_appt_kit`, `fin_patient_packages_list`, `fin_shortfalls_list`.
Recriadas (corpo anterior preservado + o novo): `private.fin_area_roles` e `fin_my_access` (áreas `appt`, `patient_pkg`, `package_deliver`; `own_appt` para o profissional), `private.stock_on_sale_cancel` (respeita devolução parcial) e `public.fin_stock_reverse` (recusa estorno manual de baixa de atendimento ativa, de entrega de pacote e de devolução).
Internas: `private.appt_apply_materials` (baixa), `private.appt_reverse_materials` (estorno), `private.appt_recalc`, `private.appt_can`/`appt_self`, `private.pkg_use_session`, `private.pkg_item_value`, `private.fin_emit`, gatilhos `pkg_on_sale_item` e `pkg_on_sale_cancel`.

## Regras que valem no servidor
- **Participantes** (D3/D4): 1 responsável (obrigatório), até 1 executor, auxiliares à vontade; só os papéis que o serviço prevê; só profissionais ativos da clínica. Gravados em ordem; **nada de repasse é calculado aqui** — o atendimento realizado, cancelado, com material ajustado ou com participantes trocados gera um evento em `fin_events` (`appointment_done`, `appointment_canceled`, `appointment_material_adjusted`, `appointment_participants_changed`) para a Entrega 5.
- **Quem age** (`private.appt_can`): Gestor/Admin em qualquer atendimento; o profissional só no **próprio**, como responsável ou executor (auxiliar não realiza nem corrige). O profissional que não é gestor só registra atendimento em que consta como responsável/executor, de paciente a que tem acesso (`private.can_access_patient`).
- **Origem** (§4.4): atendimento ligado a um **item de venda de serviço** (uma venda de N unidades cobre N atendimentos) **ou** a uma **sessão do pacote** do paciente (mesmo serviço, pacote ativo, não vencido, com saldo), nunca os dois. Sem origem = «atendido sem venda» (filtro e evento `without_sale` para o dashboard da E7).
- **Valor-base** (para o repasse): venda → líquido do item ÷ quantidade; pacote → valor da sessão no momento (abaixo).
- **Kit** (§8.5): quantidade na unidade de **consumo**; o servidor converte para a de estoque (`÷ fator`, 3 casas: 5 ml de frasco de 30 ml = 0,167). A baixa usa `private.stock_exit` da E3 (lote que vence primeiro, lote vencido não sai, unidade aberta para dose fracionada, uso individual por paciente) e reaproveita a unidade aberta do paciente (individual) ou a que ainda tem fração (frasco compartilhado). O custo do material (`material_cost_cents`) é a soma do custo real das saídas + a estimativa do que faltou.
- **Consumo sem saldo** (E3): o registro clínico **nunca é bloqueado pelo estoque**. Se faltar saldo (total ou parcial), baixa o que há e a sobra vira `stock_shortfalls` (aberta), com custo estimado pelo custo médio do momento (R$ 0,00 se o item nunca teve saldo), log e evento; o gestor vê em Estoque › Consumo sem saldo. Só a **falta** vira consumo sem saldo; erro de dado (item, lote, fração) volta para quem confirma, e lote vencido **escolhido à mão** é recusado. Resolver: **baixa retroativa** (depois de lançar a entrada; a movimentação leva a data do atendimento e o custo passa da estimativa ao real, com evento de ajuste) ou **ajuste** (motivo obrigatório).
- **Correção depois de confirmado** (E11): estorna a rodada anterior (movimentações novas apontando para as originais) e lança a nova; as duas rodadas ficam no registro; a diferença de custo vai ao repasse como evento `appointment_material_adjusted` (o motor da E5/E6 aplica no próximo mês aberto se o mês estiver travado). Motivo obrigatório.
- **Cancelar**: motivo obrigatório; atendimento realizado estorna a baixa do estoque, fecha as sobras abertas e devolve a sessão ao pacote (lançamento negativo na razão); evento ao repasse. Atendimento ainda aberto cancela sem mexer em estoque.
- **Pacotes** (§5.4, D8, D23): ao vender um pacote, cada unidade vendida vira um **pacote do paciente** com validade (`dias`), sessões e itens. O **valor efetivamente pago** (líquido da venda, já com desconto) é rateado entre as linhas pelo rateio do cadastro (meio-para-cima, sobra na última): R$ 1.800,00 → consultas R$ 1.323,54 (3 × R$ 441,18) + suplementos R$ 476,46; com 10% de desconto, R$ 1.620,00 → R$ 1.191,19 + R$ 428,81. Cada sessão/entrega grava o valor proporcional na **razão** (`fin_package_ledger`), e a última leva a sobra. Pacote vencido ou com a venda cancelada não consome sessão nem entrega item (o saldo vencido é receita da clínica, sem repasse).
- **Entrega de item de pacote** (E17): baixa o estoque da unidade (tipo `package_delivery`, paciente e venda no registro) e **cobre o pacote pela data da entrega**; estoque insuficiente **bloqueia** (é entrega física) e nada é gravado; quantidade inteira; gera evento `package_item_delivered` (base da comissão, nunca repasse de atendimento).
- **Devolução de paciente** (§8.2): origem venda ou entrega de pacote; volta no **mesmo lote** e ao **custo da saída original**; parcial permitida; motivo obrigatório; nunca de dose de unidade aberta (D20). Devolução de item de pacote reabre o saldo e gera `package_item_returned`. **Cancelar a venda depois de uma devolução parcial devolve só o restante.**
- **Log** (`fin_audit_log`, mesma transação): atendimento (criação, realização, correção, troca de participantes, cancelamento), pacote do paciente (criação, entrega, cancelamento), sobra sem saldo (criação e resolução) e cada movimentação do estoque. Aparece em Financeiro › Cadastros › Histórico (gestor).

## Código
- Domínio puro (testado): `src/lib/domain/finAppointments.ts` (participantes, kit consumo→estoque, custo, consumo sem saldo, rateio e valor de sessão/entrega, mensagens); acesso: `finAccess.ts` (`canSeeAppointments`, `canManageAppointments`, `canStartAppointment`, `canSeePatientPackages`, `canDeliverPackageItem`, abas).
- API: `src/lib/api/finAppointments.ts`; hooks: `src/hooks/useFinAppointments.ts`.
- Telas: `src/pages/finance/{AppointmentsTab,PatientPackagesTab}.tsx`, `src/pages/finance/appointments/{AppointmentFormDialog,AppointmentDetail,KitDialog,ReasonDialog}.tsx`, `src/pages/stock/{StockShortfallsTab,PatientReturnDialog}.tsx`, `src/components/fin/{ParticipantsFields,NewAppointmentButton,PatientPackagesCard}.tsx`; `MovementTable` e `StockMovementsTab` ganharam a devolução; `PatientProfilePage` ganhou o botão e o cartão.

## Decisões desta entrega (podem ser trocadas)
- **Quem registra atendimento**: qualquer profissional ativo da clínica registra o **próprio** (precisa constar como responsável ou executor). Os papéis financeiros (Recepção, Financeiro, Estoquista) também são «profissionais» no cadastro; se a clínica quiser impedir que um desses se nomeie participante, o filtro vai em `private.appt_is_pro` (um ponto só).
- **Recepção não registra nem vê atendimento** (nem custo); vê o saldo dos pacotes e entrega o item do pacote (sem ver custo). A Recepção segue sem acesso a Estoque.
- **Estoquista entrega item de pacote e resolve consumo sem saldo**; **Financeiro só consulta** os dois (vê custo).
- **Quantidade de pacote vendida tem de ser inteira** (`PACKAGE_QUANTITY_INTEGER`).
- **Devolução de paciente** só devolve estoque; o dinheiro devolvido segue o fluxo do financeiro (estorno do recebimento / cancelamento da venda).
- Item **adicionado** ao kit só tem lote «automático» (o lote que vence primeiro); a troca manual de lote vale para os itens do kit.

## Riscos para aplicar a migration
1. **Ordem**: aplicar depois de E1 (`20261113100000`), E2 (`20261113180000`, `20261113213000`) e E3 (`20261113230000`). Versão `20261114090000`, nome sem versão `fin_e4_atendimento`.
2. **Ledger**: aplicando por `apply_migration`, corrigir a versão de relógio do ledger da CLI na mesma sessão e conferir os dois ledgers (`docs/ops/MIGRATIONS_E_LEDGERS.md` §1 e §3).
3. **Dependências do app, não da E1–E3**: tabelas `public.appointments` e `public.clinical_encounters` (FKs `on delete set null`) e a função `private.can_access_patient(uuid)` — existem em produção; a prova local usa um stub.
4. **Muda comportamento da venda** (2 pontos): (a) vender **pacote** em quantidade fracionada passa a ser recusado; (b) vender um pacote cujo cadastro não tem itens/rateio recusa a venda (`PACKAGE_WITHOUT_ITEMS`; o cadastro já exige itens). Vendas de pacote **antigas** (antes da migration) **não** ganham saldo para o paciente — não há backfill (as vendas de teste QA da Clínica Teste podem ser refeitas).
5. **Recria 4 funções existentes** (`fin_area_roles`, `fin_my_access`, `stock_on_sale_cancel`, `fin_stock_reverse`) — cópia do corpo da E3 + o novo. Se a E3 tiver sido editada depois, comparar antes. `fin_events` perde e recria a constraint de tipo de evento (amplia a lista; os 4 tipos antigos continuam válidos).
6. **Dados de teste QA** ficam na Clínica Teste Hefesto (QA); a migration não cria dado.
7. **Reversão** (sem dado ainda): `drop trigger pkg_on_sale_item on public.fin_sale_items; drop trigger pkg_on_sale_cancel on public.fin_sales;` e derrubar as funções `fin_appt_*`, `fin_package_*`, `fin_patient_packages_list`, `fin_shortfall*`, `fin_stock_patient_return`, `private.appt_*`, `private.pkg_*` e as 8 tabelas novas; restaurar `stock_on_sale_cancel` e `fin_stock_reverse` da E3. Com atendimento realizado ou pacote vendido, **não** derrubar: cancelar/estornar.

## Fica para as próximas entregas
- **Entrega 5**: motor de repasse (consumir os eventos `appointment_*`, `package_item_*`, `stock_shortfall`; regras por profissional/serviço/papel; dedução de material na base; exemplos A a H); a fila «atendido sem venda» no dashboard (E7) já tem o filtro e o evento.
- **Entrega 6**: fechamento mensal — «mês travado» e o ajuste do próximo mês para a diferença de material (hoje só o evento com `old/new/delta`).
- **Entrega 8**: alertas (consumo sem saldo no dashboard, mínimo, vencimento), inventário cego, transferências, relatórios de consumo por serviço/profissional, devolução ao fornecedor.
- **Entrega 9**: documento clínico no atendimento (botão Novo documento) e sugestão do kit a partir da prescrição.
- Integração do atendimento financeiro com a **agenda** (`appointments`) e com a **consulta assistida** (`clinical_encounters`): as colunas `agenda_appointment_id` e `encounter_id` já existem e o servidor valida o vínculo; as telas de agenda/consulta ainda não passam esses ids.
