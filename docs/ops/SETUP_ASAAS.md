# Setup — Fundação Asaas (WP-ASAAS-02)

Contrato técnico **somente**. Sem valores de secret. Sem playbook comercial.
Nada disto está aplicado/deployado em produção nesta WP.

## URLs oficiais (docs.asaas.com — Authentication)

| Ambiente | Base URL |
|---|---|
| Sandbox | `https://api-sandbox.asaas.com/v3` |
| Produção | `https://api.asaas.com/v3` |

Chamadas **futuras** (ASAAS-03) usam o header `access_token` (a API Key).
**Não** usar `Authorization: Bearer`.
`User-Agent` identificável é obrigatório no outbound (ex.: `Vertexa/asaas-02 (Deno; sandbox)`).

## Webhook (docs.asaas.com — About Webhooks / Receive events)

- Entrega **at least once**.
- `body.id` = **chave oficial de idempotência** (`external_event_id`).
- `payload_hash` = integridade/auditoria. **Não** substitui `body.id`.
- Header de autenticação do POST inbound: `asaas-access-token`.
- `authToken` do webhook é **obrigatório** na configuração Asaas (32–255 chars; não é a API Key).
- Após persistência/idempotência: **HTTP 200** (ACK de transporte).
- Resposta **fora de 2xx** pode provocar retry e penalização da fila Asaas.
- Processamento financeiro: posterior/assíncrono (ASAAS-04). HTTP 200 **não** significa aceite financeiro.
- Mesmo `external_event_id` + `payload_hash` divergente: ACK 200, row original intacta, `last_error_category=payload_hash_mismatch`.
- Envelope sem `id` ou `event`: HTTP 400, zero write (não há chave durável para ACK idempotente).

## Environment (fail-closed)

`ASAAS_WEBHOOK_ENVIRONMENT` aceita **somente** os literais:

- `sandbox`
- `production`

Ausente, vazio ou inválido (`prod`, `SANDBOX`, `staging`, …) → HTTP **503**, zero write.
Sem default silencioso. Sem lowercase automático.
O body e os headers da request **não** escolhem environment.

## Secrets (Supabase Edge secrets — nunca `VITE_*`, nunca o repo)

| Nome | Uso |
|---|---|
| `ASAAS_WEBHOOK_AUTH_TOKEN_SANDBOX` | Comparar com `asaas-access-token` **somente** quando environment = `sandbox` |
| `ASAAS_WEBHOOK_AUTH_TOKEN_PRODUCTION` | Idem **somente** quando environment = `production` |
| `ASAAS_WEBHOOK_ENVIRONMENT` | `sandbox` ou `production`. Sem fallback |
| `ASAAS_API_KEY_SANDBOX` | Futuro outbound (ASAAS-03). Sem valor aqui |
| `ASAAS_API_KEY_PRODUCTION` | Futuro outbound. Sem valor aqui |

Não há secret genérico compartilhado.
Sandbox nunca autentica com o token de production, e vice-versa.
Secret do environment válido ausente/vazio → HTTP **503**, zero write.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados no runtime das Edge Functions.

## Function

`asaas-webhook` — `verify_jwt = false` (caller Asaas). Auth real = `asaas-access-token`.
Não deployar nesta WP.

## Dívida futura (não implementar agora)

Antes de ativar eventos de subscription em produção, ASAAS-03/04 precisa extrair `subscription.id` ou definir lookup oficial. Esta WP não persiste JSONB bruto nem modela subscription.

## O que esta WP **não** faz

HTTP para Asaas, customer, subscription, charge, grant `source=asaas`, backfill de clínicas, UI.
