# Billing MASTER QA matrix

Status inicial: `PLANNED`. Nenhum cenário abaixo foi executado nesta entrega.

| Grupo | Cenários obrigatórios | Prova de aprovação |
| --- | --- | --- |
| Planos | 3 Standard × CARD; 3 Standard × PIX_AUTOMATIC; 3 Founder × CARD; 3 Founder × PIX_AUTOMATIC | preço/snapshot do servidor e método corretos |
| Identidade | cliente novo/existente; e-mail igual com identidade inválida; retry duplicado; CPF; CNPJ numérico; CNPJ alfanumérico; DV inválido | uma identidade canônica, sem corrupção de CNPJ |
| Cartão | aprovado, recusado, vencido em 60 min, número/CVV inválidos, timeout, double-submit, retry ambíguo, `CHECKOUT_EXPIRED` duplicado, próxima cobrança recorrente | uma tentativa aberta por contrato; expirada preservada; nova tentativa com correlação distinta; webhooks processados |
| Pix Automático | autorização criada, QR, primeiro pagamento, ACTIVE, REFUSED, EXPIRED, CANCELLED, reissue, próxima instrução, webhook duplicado | QR transitório; mudança de estado só por fatos do provedor |
| Webhook/processor | repetido, atrasado, fora de ordem, desconhecido, token inválido, retry, replay, idempotência | exatamente um efeito financeiro por evento aceito |
| Produto | pending, received, contrato active, entitlement separado, Clínica Billing, Platform Billing, relatórios e CSV | estados não colapsados nem liberados por engano |
| UX | desktop, ~390px, rede lenta, voltar, refresh, checkout expirado, recuperação, sem spinner infinito, foco e erros | fluxo compreensível e acessível |

## Oráculo de preço e segurança

Para cada cenário alterar em interceptação local os campos `amount`, `price`, `priceCents`, `currency`, `discount`, `providerAmount`, customer/provider IDs e estratégias. A chamada deve ser rejeitada ou ignorar o campo; o preço final deve ser o snapshot que a RPC criou no servidor. Tentar plano Founder sem elegibilidade também deve falhar.

## Estados esperados

Contrato comercial, autorização Pix, pagamento financeiro e entitlement são quatro fatos distintos. `ACTIVE` de Pix não concede produto; `received` não deve ser inferido da resposta síncrona de criação; o webhook autenticado é persistido antes do processamento idempotente.

## Harness

- Testes de domínio: `src/lib/domain/billingProfile.test.ts`, checkout/pix existentes e testes de autoridade.
- Testes Edge: `supabase/functions/_shared/asaas/*.test.ts`, inclusive cliente, outbound, Pix, webhook e processador.
- Teste SQL de regressão desta entrega: `supabase/tests/wp_billing_master_qa_01_cnpj_identity_test.sql` em banco descartável.
- Teste SQL do checkout de cartão: `supabase/tests/wp_billing_card_01_hosted_checkout_test.sql`; cobre expiração terminal, replay idempotente e nova tentativa auditável.
- A execução integrada de Sandbox não é substituída por mocks e pertence à QA-02.
