# Financeiro / Repasse / Estoque — Entrega 6 (fechamento mensal do repasse)

Nota para suporte e onboarding. Especificação: `escopo-v1.txt` (§2 D9–D10, D22, §3, §5.8–§5.9, §6, §11, §12.1 F2, F4, F6–F9, F13, F14); plano: `plano-entregas.md`.
Migration: `supabase/migrations/20261115100000_fin_e6_fechamento.sql` (aditiva; **não aplicada**). Prova SQL: `supabase/tests/fin_e6_fechamento.test.sql` (162 asserções), rodada por `scripts/fin-e6-sql-proof.sh` (Postgres local descartável; usa `fin_e5_stub.sql` e `fin_e6_stub.sql` — este só simula o Storage do Supabase).

## O que existe

**Telas** (Financeiro › **Repasse**)
- **Fechamento** (`/financeiro/repasse/fechamento`; Gestor, Financeiro e Admin) — competência (mês/ano em português; abre no mês anterior) e unidade. Sem fechamento iniciado: explicação e botão **Iniciar fechamento** (só depois do mês encerrado, a partir do dia 1 do mês seguinte). Com fechamento: **tabela do gestor** (uma linha por profissional: percentual, fixo por execução, fixo mensal, garantia, comissões, taxa de uso, ajustes, total bruto, retenções, líquido a pagar, aceite, NF, pagamento) com **total geral**, **pendências** (produção «sem regra» **bloqueia** a aprovação; atendimento sem venda, título não liquidado e saldo negativo são avisos), e as ações **Atualizar extratos**, **Notificar profissionais**, **Aprovar selecionados / todos prontos**, **Travar o mês**, **Destravar** (só Owner/Admin, com motivo), **Arquivo de pagamento** (CSV), CSV/Excel da tabela, CSV/Excel das retenções por tipo e profissional (para o contador) e **PDF do fechamento**.
- **Ver extrato** (diálogo; o mesmo do profissional) — componentes do mês, linhas mensais (ajuste de faixa, fixo mensal, garantia, taxa de uso, saldo trazido), retenções com alíquota e valor, líquido a pagar, lançamentos com **Como foi calculado**, contestações e respostas, NF e pagamento (com link para o arquivo por URL assinada), CSV/Excel e **PDF do extrato**.
- **Meu extrato** (`/financeiro/repasse/meu-extrato`; profissional) — lista só dos próprios extratos; no extrato: **Aceitar**, **Contestar** (o extrato inteiro ou uma linha, com comentário obrigatório), **Enviar NF** (número, data e arquivo) e **Baixar PDF**.
- Listas e tabelas viram **cartões abaixo de 640 px** (`FinTable`); botões e seletores com `flex-wrap`; diálogos empilham em uma coluna. Datas de formulário com `todayIsoBR` (Brasília); data-hora exibida em America/Sao_Paulo.
- **Correção da Entrega 5**: em 390 px, na Nova regra com faixas, a última faixa mostrava «Acima da faixa anterior» cortada num campo somente leitura; agora é um texto que quebra linha.

| Papel | Ver tabela | Iniciar / atualizar / notificar | Aprovar · travar · responder contestação · ajuste manual | NF e pagamento · arquivo de pagamento | Destravar | Meu extrato |
|---|---|---|---|---|---|---|
| Owner/Admin | sim | sim | sim | sim | **sim** | se for profissional |
| Gestor | sim | sim | sim | sim | não | se for profissional |
| Financeiro | sim | sim | **não** | sim | não | — |
| Profissional (clínico) | **não** | não | não | só a **própria NF** | não | **sim** (só o próprio): aceita, contesta |
| Recepção · Estoquista | não | não | não | não | não | não |

## Fluxo (escopo §6.1)
1. **Aberto** — as linhas se acumulam (E5). 2. **Em conferência** — *Iniciar fechamento* gera o extrato (fotografia do cálculo mensal) de cada profissional com movimento no mês e marca a notificação; prazo de aceite = `fin_settings.accept_days` (padrão 5 dias). 3. **Aceite** — o profissional aceita ou contesta (F7). 4. **Ajustes** — o gestor responde, corrige a origem (regra, participante, atendimento) ou lança ajuste manual (bônus, desconto, adiantamento, com motivo) e usa *Atualizar extratos*: o extrato que mudou **sobe de versão e volta para o aceite**; contestação toda respondida também devolve o extrato para reavaliação. 5. **Aprovado** — valores congelados. Sem aceite só depois do prazo (F8): fica registrado **«aprovado sem aceite»**. 6. **Pago** — data, forma, comprovante (e NF recebida quando o profissional é obrigado). 7. **Travado** — sozinho quando o último extrato com líquido a pagar é pago, ou à mão pelo Gestor quando todos estão aprovados.

## Tabelas (todas com RLS; escrita só por RPC; nada se apaga)
- `fin_closings` — um fechamento por clínica e mês (`conferencia` → `aprovado` → `travado`), com quem/quando iniciou, aprovou, travou e destravou (motivo).
- `fin_closing_pros` — extrato de cada profissional: colunas da tabela do gestor, `calc` (fotografia completa do cálculo), `stmt_version`, `status` (`open` | `approved` | `paid`), aceite (`pending` | `accepted` | `contested` | `approved_without`), prazo, NF (número, data, arquivo) e pagamento (data, forma, comprovante, observação).
- `fin_closing_disputes` — contestação (por linha ou geral), resposta do gestor e versão do extrato.
- `fin_share_period_locks` (E5) passa a ser preenchida ao travar e esvaziada só ao destravar.
- Bucket privado **`fin-repasse`**, caminho `<clínica>/<extrato>/<arquivo>`; sem UPDATE/DELETE (arquivo não se troca nem se apaga); leitura por URL assinada de 5 min. Políticas: gestor/financeiro/admin leem tudo; o profissional lê e envia só na pasta do próprio extrato; quem registra pagamento envia o comprovante.

## Como o congelamento funciona (decisão central desta entrega)
- **Aprovado ou pago = congelado, por profissional.** `private.share_month_calc` devolve a fotografia gravada (`calc`) para o extrato aprovado/pago: alterar depois regra, alíquota ou retenção não muda o que foi aprovado (testado: retenção do IRRF alterada de 1,5% para 3% depois da aprovação não mexe em junho).
- **Correção nova daquele profissional cai no próximo mês aberto** (`private.share_target_period(clínica, mês, profissional)`): um chargeback depois da aprovação vira uma linha `adjustment` negativa em julho, com mês e linha de origem. O mês de origem **não muda**, mesmo antes de travar.
- **Travar** grava a trava e o **razão do mês**: as linhas mensais (ajuste de faixa, fixo mensal, garantia, taxa de uso, saldo trazido e **retenções, com sinal negativo**) entram em `fin_share_lines` com `line_key = 'close:<nº do travamento>:<extrato>:<n>'`. A soma de **todas** as linhas do mês de cada profissional = o líquido do extrato (testado). Essas linhas não aparecem na lista de lançamentos nem entram na prévia (não contam duas vezes).
- **Destravar** (Owner/Admin, motivo obrigatório, no histórico): remove a trava, **estorna o razão com linhas novas** (`close:rev:…`, nada é apagado), volta o fechamento para conferência e reabre para aceite os extratos aprovados e **ainda não pagos** (o pago continua pago e congelado). Travar de novo grava o razão nº 2; a soma das linhas «close» continua igual às linhas mensais.
- **Aprovação confere de novo**: se o extrato mudou depois da fotografia (chegou lançamento novo), não aprova (`STATEMENT_CHANGED`) até *Atualizar extratos*.

## RPCs (security definer, `search_path=''`, `execute` só a `authenticated`)
Leitura: `fin_closing_get(clínica, mês, unidade?)`, `fin_closing_statement(extrato)`, `fin_closing_my_list(clínica)`, `fin_closing_payment_file(fechamento)` (grava `view_sensitive` no histórico).
Escrita: `fin_closing_start`, `fin_closing_refresh`, `fin_closing_notify`, `fin_closing_accept`, `fin_closing_contest`, `fin_closing_answer`, `fin_closing_adjust`, `fin_closing_approve` (devolve `{approved, skipped[]}`), `fin_closing_invoice_save`, `fin_closing_pay`, `fin_closing_lock`, `fin_closing_unlock`.
Recriadas (corpo da E5 preservado + o novo): `private.fin_area_roles` (áreas `close_prepare`, `close_decide`, `close_pay`), `public.fin_my_access`, `private.share_apply` (mês de destino por profissional), `private.share_month_calc` (extrato congelado; ignora linhas `close:%`), `public.fin_share_lines_list` (oculta `close:%`). Nova sobrecarga `private.share_target_period(uuid, text, uuid)`. Interna nova: `private.share_pro_frozen`, `private.close_*`.
Concessão nova: `grant execute on private.appt_is_pro to authenticated` (as políticas de leitura dos extratos e do bucket a chamam; o schema `private` não é exposto pela API).
Erros: `PERIOD_NOT_ENDED`, `PERIOD_LOCKED`, `UNRULED_PENDING`, `NOT_ALL_APPROVED`, `NOT_APPROVED`, `NOTHING_TO_PAY`, `INVOICE_REQUIRED`, `PROOF_REQUIRED`, `COMMENT_REQUIRED`, `STATEMENT_NOT_OPEN`, entre outros; a tela traduz todos.

## Provas
- **SQL** (162 asserções): início só com mês encerrado e idempotente; permissões por papel (Gestor, Financeiro, Recepção, Estoquista, profissional, outro profissional, admin de outra clínica); RLS direta; escrita direta negada; sem DELETE/TRUNCATE; **F13** (tabela × extrato × motor × soma dos itens; total geral = soma das linhas); **F2** (aprovação bloqueada com «sem regra», liberada ao marcar «sem repasse»); **F7** (contestar, responder, ajuste manual, extrato regenerado volta para aceite); **F8** (prazo vencido → «aprovado sem aceite»; extrato que mudou não aprova); congelamento e **F4** (correção no próximo mês); NF (própria, de outro profissional, sem arquivo, sem número, data futura); pagamento (sem NF, sem comprovante, data futura, forma inválida, comprovante de outra pasta, líquido 0, duas vezes); **F14** (arquivo de pagamento só dos aprovados a pagar, com documento e Pix; acesso no histórico); trava automática; **F9** (tudo recusado em mês travado; UPDATE em linha bloqueado; destravar só Owner, com motivo, estorno do razão); retravar (razão nº 2); julho com saldo negativo levado (**F6**) e correção de junho; bucket e políticas de arquivo; histórico com autor e hora. Regressão: as provas das Entregas 2, 4 e 5 passam com a E6 aplicada.
- **Verificação por mutação** (13 mutações no SQL, uma por vez, com a prova rodando de novo): sem o bloqueio «sem regra»; sem o congelamento do extrato aprovado; correção ignorando a aprovação do profissional; aprovar sem respeitar o prazo de aceite; Gestor podendo destravar; aprovar com extrato que mudou; pagar sem a NF; pagar em mês travado; profissional lendo extrato alheio; travar sem gravar o razão; destravar sem estornar o razão; lista de lançamentos mostrando o razão. **12 derrubam pelo menos um teste.** A 13ª (tirar o filtro `line_key not like 'close:%'` da soma de ajustes da prévia viva) é **equivalente**: enquanto está destravado o razão e o seu estorno somam zero, e travado a prévia devolve a fotografia; o filtro fica como defesa em profundidade.
- **vitest**: `finClosing.test.ts` (datas de Brasília, textos, erros, caminho de arquivo, exportações), `finAccess.test.ts` (matriz de papéis do fechamento) e `Closing.test.tsx` (22 testes de tela: tabela, pendências, aprovação em lote, travar/destravar, extrato, aceite, contestação, NF, pagamento, celular, abas).

## Decisões desta entrega (podem ser trocadas)
- **Destravar é só do Owner/Admin** (escopo §6.1 e F9: «só Owner destrava»); o Gestor trava, não destrava. O brief citava «Admin/Gestor destravam» — se a cliente quiser o Gestor também, é só incluir `close_decide` na RPC.
- **Comprovante é obrigatório** para registrar pagamento (escopo §6.1: «data, forma, comprovante anexado»); a NF é obrigatória só para quem tem «exige NF» nos dados financeiros.
- **Aprovação por profissional** (lote = vários de uma vez); o fechamento fica «aprovado» quando todos estão aprovados/pagos. Aprovação sem aceite só depois do prazo.
- **Extrato sem líquido a pagar** (zero ou negativo) é aprovado normalmente, não tem pagamento e não impede a trava automática.
- **Notificação**: nesta entrega «notificar» marca `notified_at` e o extrato aparece em «Meu extrato»; **não há push, e-mail ou WhatsApp** (fica para quando a cliente escolher o canal; não é pessoa externa tocada por esta entrega).
- **Filtro por unidade**: a tabela mostra os profissionais com lançamento na unidade escolhida, com o valor total do extrato (o fechamento é por clínica e mês, o extrato é único por profissional).
- **PDF**: extrato e fechamento em fonte padrão (Helvetica), sem dado clínico; o paciente aparece como a clínica configurou (iniciais por padrão, P3).
- **Arquivo de pagamento** só traz profissionais **aprovados e ainda não pagos** com líquido maior que zero.
- Atendimento sem venda e título não liquidado são **avisos**, não bloqueios (escopo §6.1).

## Riscos para aplicar a migration
1. **Ordem**: depois de E1…E5 (`20261113100000`, `20261113180000`, `20261113213000`, `20261113230000`, `20261114090000`, `20261114100000`, `20261114180000`). Versão `20261115100000`, nome sem versão `fin_e6_fechamento`.
2. **Ledger**: aplicando por `apply_migration`, corrigir a versão de relógio do ledger da CLI na mesma sessão e conferir os dois ledgers (`docs/ops/MIGRATIONS_E_LEDGERS.md` §1 e §3).
3. **Recria 5 funções existentes** (`private.fin_area_roles`, `public.fin_my_access`, `private.share_apply`, `private.share_month_calc`, `public.fin_share_lines_list`): cópia exata do corpo da E5 + o novo. **Comparar com o que está em produção antes** (se houve ajuste manual, ele se perde). Nenhuma outra função das E1–E5 muda.
4. **Bucket**: o bloco do Storage só roda se `storage.buckets`/`storage.objects` existirem (no Supabase existem); cria o bucket privado `fin-repasse` e 2 políticas em `storage.objects`. Sem UPDATE/DELETE nas políticas.
5. **`grant execute on private.appt_is_pro to authenticated`** é a única concessão nova em função existente.
6. **Sem backfill e sem dado novo**: a migration não cria fechamento. Para fechar um mês já calculado na Clínica Teste, rodar *Recalcular repasse* (E5), depois *Iniciar fechamento* (só meses encerrados).
7. **Tempo**: *Iniciar fechamento* e *Atualizar extratos* calculam o mês de cada profissional (cadeia de até 36 meses para saldo trazido e garantia). Medir na Clínica Teste logo após aplicar (meta: abaixo de 3 s; recomendado 1 s); com muitos profissionais a chamada é por clínica, não por tela.
8. **Reversão** (sem fechamento ainda): derrubar as 3 tabelas novas, as funções `public.fin_closing_*` e `private.close_*`/`share_pro_frozen`/`share_target_period(uuid,text,uuid)`, as políticas `fin_repasse_files_*` e o bucket `fin-repasse` (vazio); restaurar `fin_area_roles`, `fin_my_access`, `share_apply`, `share_month_calc` e `fin_share_lines_list` de `20261114180000`. Com fechamento gravado, **não** derrubar: destravar e encerrar.
9. A prova SQL usa **datas fixas de 2026** (junho e julho); o início do fechamento exige mês encerrado, então depois de 2026 nada muda para esses testes.

## Fica para as próximas entregas
- **Entrega 7**: dashboard com números clicáveis (F12), fila «atendido sem venda» (hoje só aviso no fechamento) e o indicador «Repasses do mês» ligado ao fechamento.
- **Entrega 8**: inventário cego, transferências, alertas e relatórios de estoque (consumo por serviço/profissional).
- **Entrega 9**: documentos clínicos.
- Canais de notificação (push/e-mail/WhatsApp) quando a cliente escolher; guias de retenção (emissão fora do v1, §5.8); log de visualização de extrato pelo profissional (hoje só o acesso a dado bancário/fiscal é registrado).
