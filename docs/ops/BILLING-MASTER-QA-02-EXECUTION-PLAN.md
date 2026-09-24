# WP-BILLING-MASTER-QA-02 — execução Sandbox E2E

## Pré-condições bloqueantes

1. Migration QA-01 aplicada primeiro em ambiente de teste e testes/verificações aprovados.
2. `ASAAS_OUTBOUND_ENVIRONMENT=sandbox`, chave Sandbox, webhook Sandbox autenticado e base `https://api-sandbox.asaas.com/v3` confirmados.
3. Produção bloqueada: sem chave, canary, cliente, cobrança, contrato real, Founder real ou enforcement comercial.
4. Navegador/manual disponível para o checkpoint visual; não usar dados de terceiros.

## Sequência remota planejada

1. Inventariar somente os fixtures `VERTEXA_BILLING_MASTER_QA_*` e preservar a evidência Pix prévia sem mutá-la.
2. Criar as identidades/contas de teste isoladas e ligar customers pelo fluxo Vertexa.
3. Para cada uma das 12 combinações plano × método, criar contrato comercial pelo catálogo servidor, validar preço/Founder e registrar correlation IDs.
4. CARD: usar apenas cartões fictícios oficiais do Sandbox; exercitar aprovação, recusa, expiração de 60 min, timeout/ambiguidade e geração de ciclo futuro. Confirmar que `CHECKOUT_EXPIRED` não altera contrato/Founder/entitlement, que evento duplicado tem um único efeito e que a nova tentativa tem correlação nova sem repetir POST cego.
5. PIX_AUTOMATIC: criar autorização `SUBSCRIPTION`, apresentar QR apenas na sessão, simular primeiro pagamento/autorização e esperar evento `ACTIVATED`; testar refusal, expiry, cancelamento e reissue.
6. Capturar webhook, repetir/atrasar/reordenar cópias controladas e executar o processador; provar um único efeito financeiro.
7. Confirmar UI de Clínica e Plataforma, relatórios/CSV e separação contrato/pagamento/entitlement.
8. Limpar somente objetos QA-02 identificados por namespace; registrar o que não é removível e por quê.

## Limitações conhecidas do Sandbox

O Asaas documenta cartões fictícios para aprovações/recusas, recorrências, webhooks e testes de QR/Pix em Sandbox, mas alerta que sua cobertura não reproduz integralmente Produção. A ativação de Pix Automático depende de primeiro pagamento + consentimento e deve ser comprovada pelos webhooks. Critérios e links oficiais: [Sandbox](https://docs.asaas.com/docs/sandbox), [cartões](https://docs.asaas.com/docs/testando-pagamento-com-cart%C3%A3o-de-cr%C3%A9dito), [autorização Pix](https://docs.asaas.com/reference/criar-uma-autorizacao-pix-automatico), [eventos Pix](https://docs.asaas.com/docs/eventos-para-pix-autom%C3%A1tico).

## Critério de saída

Cada linha da matriz deve conter `PASS` ou `FAIL`, IDs redigidos, ambiente, timestamps, evento recebido e resultado do processor. Qualquer duplicidade, preço divergente, autorização sem webhook, dado sensível persistido ou transição de entitlement inferida interrompe a aprovação de Produção.
