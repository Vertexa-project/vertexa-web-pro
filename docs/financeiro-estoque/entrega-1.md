# Financeiro / Repasse / Estoque — Entrega 1 (base e cadastros)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§2, 3, 4.1, 8.1, 11, 12); plano: `plano-entregas.md`.
Migration: `supabase/migrations/20261113100000_fin_e1_base.sql` (aditiva; só cria objetos novos). Prova SQL: `supabase/tests/fin_e1_base.test.sql`.

## O que existe

**Telas (caminho de clique)**
- Configurações › Unidades (`/configuracoes/unidades`) — admin cria, renomeia e desativa unidades; a principal não desativa; licença sanitária (número e validade) por unidade.
- Configurações › Equipe (`/configuracoes/equipe`) — em cada pessoa ativa, botão **Papéis**: o admin atribui/retira Gestor, Financeiro, Recepção e Estoquista, para todas as unidades ou uma lista.
- Financeiro (`/financeiro`) — duas abas: **Mensalidades** (a tela de sempre, só admin, sem alteração) e **Cadastros**.
  - Cadastros › Serviços · Pacotes · Profissionais · Meios de pagamento · Impostos e configurações · Histórico.
- Estoque (`/estoque`) — aba **Itens** (saldos, entradas, saídas e inventário chegam nas entregas 3 e 8).
- Toda tabela nova tem exportação CSV (`;`, vírgula decimal, BOM) e Excel (.xlsx); estados vazio, carregando, erro e sucesso; 390 px sem rolagem lateral da página.

**Menu pela matriz de papéis** (a barreira real é o banco; o menu só esconde o que seria recusado)

| Papel | Financeiro › Mensalidades | Financeiro › Cadastros | Histórico | Estoque › Itens | Unidades |
|---|---|---|---|---|---|
| Owner/Admin | sim | escreve tudo | lê | escreve | escreve |
| Gestor | não | escreve (configurações financeiras só ele e o admin) | lê | escreve | lê |
| Financeiro | não | escreve cadastros (configurações: só leitura) | não | só consulta | lê |
| Recepção | não | **sem acesso** | não | não | lê |
| Estoquista | não | não | não | escreve | lê |
| Profissional | não | não | não | não | — (só lê o **próprio** dado financeiro) |

Papéis por unidade: papel com «unidades autorizadas» só alcança linhas daquelas unidades; cadastros da organização (serviço, pacote, item) valem com qualquer papel de escrita.

## Tabelas (todas com RLS; escrita só por RPC)
`clinic_units`, `clinic_staff_roles`, `fin_audit_log`, `fin_settings`, `stock_items`, `stock_item_minimums`, `fin_services`, `fin_service_unit_prices`, `fin_service_kit_items`, `fin_packages`, `fin_package_items`, `fin_professional_finance`, `fin_withholding_rules`, `fin_acquirers`, `fin_fee_rows`, `fin_tax_rates`.
- `fin_audit_log` e `fin_professional_finance`/`fin_withholding_rules` não têm SELECT direto: leitura só pelas RPCs.
- Backfill: toda clínica ganhou «Unidade principal», `fin_settings` padrão e os meios Pix, Dinheiro, Transferência e Boleto (taxa 0, D+0). Clínica nova ganha o mesmo pelo trigger `trg_fin_seed_clinic` (AFTER INSERT em `clinics`).

## RPCs (security definer, `search_path=''`, `grant execute` só a `authenticated`)
`fin_my_access`, `fin_save_unit`, `fin_set_staff_roles`, `fin_audit_list`, `fin_save_settings`, `fin_set_tax_rate`, `fin_effective_tax_rate`, `fin_save_stock_item`, `fin_save_service`, `fin_set_service_kit`, `fin_save_package`, `fin_list_professional_finance`, `fin_get_professional_finance`, `fin_save_professional_finance`, `fin_save_acquirer`.
Helpers internos (`private.`): `fin_can(clinic, area, unit, write)` — **toda** RPC passa por ele —, `fin_has_role`, `fin_gate`, `fin_log`, `fin_valid_tax_id`, `fin_mask_sensitive`.

## Regras que valem no servidor
- Sem exclusão física: cadastro se desativa (`is_active`); desativar exige **motivo**; toda criação/edição/desativação grava `fin_audit_log` (antes, depois, motivo, quem, quando) na mesma transação.
- Dados do profissional: CPF/CNPJ com dígitos verificadores; o log guarda CPF/CNPJ, Pix e conta **mascarados**; cada leitura do dado sensível grava `view_sensitive`. Quem lê: admin, gestor, financeiro e o próprio profissional.
- Item de estoque: nome e categoria obrigatórios; lote e validade obrigatórios (e travados) em Medicação aplicada e Manipulado; Medicação e Material de consumo **não vendem**; Produto de revenda sempre vendável e exige preço; Manipulado vendido exige preço; uso fracionado exige validade após aberto; EAN 8–14 dígitos; **controlado (Portaria 344) é recusado** (`STOCK_CONTROLLED_BLOCKED`, e há CHECK na tabela).
- Pacote: rateio `referência × (valor ÷ Σ referência×qtd)`, meio-para-cima por linha, diferença na última linha (3.600 → 450/270/90). Produto no pacote só revenda ou manipulado.
- Alíquota: `fin_effective_tax_rate(clinic, 'AAAA-MM', unit)` devolve a do mês ou a mais recente anterior, com `inherited`; a tela avisa o gestor (F21).

## Código
- Domínio puro (com testes): `src/lib/domain/{money,stockUnits,packageAllocation,stockItemRules,taxRate,taxId,finAccess,finAudit,licenseState,tableExport}.ts`.
- Exportação XLSX sem dependência nova: monta o .xlsx com `fflate` (já usado no app).
- API: `src/lib/api/{finRegistry,finCatalog,finProfessionals,stockItems}.ts`; hooks: `src/hooks/useFin.ts`.

## Decisões desta entrega (podem ser trocadas)
- Financeiro escreve cadastros financeiros; configurações financeiras (liquidação, deduções, limite do caixa, aceite) são só do gestor e do admin.
- Recepção lê só a lista de unidades (vai precisar na venda); nada de cadastros financeiros.
- Desativar exige motivo; criar e editar têm motivo opcional.
- Uso fracionado exige «validade após aberto» no cadastro.
- Retenção que sai da lista do profissional é desativada, nunca apagada.
- Unidades por papel: o servidor já filtra; a tela de Equipe permite escolher as unidades.

## Fora desta entrega
Vendas, recebimentos, caixa, saldos e movimentações de estoque, motor de repasse, fechamento, dashboard, inventário, transferências, documentos clínicos (entregas 2 a 9). Os campos de «comissão» do item de estoque e «códigos do fornecedor» entram com o motor de repasse (5) e a importação de XML (3).
