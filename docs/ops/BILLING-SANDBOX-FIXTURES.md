# Fixtures isolados do Billing MASTER QA

## Namespace e isolamento

Todos os novos objetos de homologação devem usar `VERTEXA_BILLING_MASTER_QA_*`, conta e chave **Sandbox** e base `https://api-sandbox.asaas.com/v3`. Não reutilizar evidência Pix anterior, não tocar QA #2 e não usar pessoas, clínicas, contatos ou cartões reais.

Antes de qualquer escrita, registrar a lista/IDs existentes no Sandbox e verificar que cada external reference pertence ao namespace. A limpeza ocorre somente nos objetos criados por esta execução, após preservar IDs, timestamps, payloads redigidos e eventos.

## Catálogo de fixtures planejado

| Código | Plano | Valor mensal (R$) | Métodos |
| --- | --- | ---: | --- |
| `VERTEXA_BILLING_MASTER_QA_STANDARD_PULSE` | Standard Pulse | 390 | CARD, PIX_AUTOMATIC |
| `VERTEXA_BILLING_MASTER_QA_STANDARD_SYNC` | Standard Sync | 497 | CARD, PIX_AUTOMATIC |
| `VERTEXA_BILLING_MASTER_QA_STANDARD_APEX` | Standard Apex | 1467 | CARD, PIX_AUTOMATIC |
| `VERTEXA_BILLING_MASTER_QA_FOUNDER_PULSE` | Founder Pulse | 247 | CARD, PIX_AUTOMATIC |
| `VERTEXA_BILLING_MASTER_QA_FOUNDER_SYNC` | Founder Sync | 390 | CARD, PIX_AUTOMATIC |
| `VERTEXA_BILLING_MASTER_QA_FOUNDER_APEX` | Founder Apex | 890 | CARD, PIX_AUTOMATIC |

Founder não é concedido por payload de cliente: a fixture deve ter elegibilidade controlada no ambiente de teste e o preço precisa vir do snapshot de oferta do servidor.

## Identidades e dados de teste

- `VERTEXA_BILLING_MASTER_QA_CUSTOMER_*`: e-mail de domínio de teste, documento sintético válido e celular autorizado para Sandbox quando estritamente necessário.
- `VERTEXA_BILLING_MASTER_QA_CNPJ_ALPHA`: `12ABC34501DE35`, somente como vetor estrutural; não representa empresa real.
- Nunca registrar PAN, CVV, QR Copia e Cola, tokens, chaves Asaas ou payload bruto de webhook em documentos, commits ou telemetria.

## Evidência mínima por objeto

Guardar em artefato privado: timestamp, ambiente, external reference, IDs redigidos, resultado HTTP, estado antes/depois, ID de webhook e resultado do processador. Não guardar segredos ou dados de cartão.
