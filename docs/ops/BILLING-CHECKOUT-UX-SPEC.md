# Checkout de faturamento — especificação de UX

## Jornada atual

`plano no catálogo do servidor → identidade fiscal → contrato comercial → Cartão hospedado ou Pix Automático → webhook → fatos financeiros → UI de faturamento`.

O browser envia apenas `clinicId` e `planVersionId`; valor, moeda, desconto, elegibilidade Founder e estado financeiro são derivados no servidor. A página de ativação encaminha o administrador a Faturamento/Planos. Para cartão, o browser envia apenas `clinicId`; o servidor deriva contrato, plano, preço, moeda, Founder e a correlação opaca da tentativa. Nenhum PAN/CVV passa pela Vertexa.

## Regras de comunicação

- **Cartão:** “assinatura mensal recorrente no cartão”. O checkout é hospedado, dura 60 minutos e tem retorno de sucesso, cancelamento ou expiração apenas para navegação. Redirect nunca é confirmação financeira.
- **Pix Automático:** “o primeiro pagamento também autoriza cobranças mensais futuras”. Não chamar uma cobrança Pix mensal manual de Pix Automático.
- A criação da autorização não é pagamento recebido, contrato ativo nem liberação de produto.
- QR/Pix Copia e Cola é transitório em memória de sessão: não é persistido, recuperado após refresh nem registrado em telemetria.

## Identidade fiscal

| Campo atual | UX / forma canônica | Autoridade |
| --- | --- | --- |
| Nome legal | trim, 2–180 caracteres | servidor |
| CPF/CNPJ | CPF numérico ou CNPJ alfanumérico em maiúsculas, sem pontuação persistida | servidor recalcula DV |
| E-mail | minúsculas, formato básico | servidor |
| Celular | opcional, `(DD) 9NNNN-NNNN`; aceita `+55`, persiste 11 dígitos nacionais | servidor |

CEP, endereço, número, complemento, bairro, cidade e UF não existem hoje no modelo de identidade de cobrança nem são enviados ao Asaas. Eles não podem aparentar ser coletados ou validados até que uma decisão de modelo/migration inclua a necessidade contratual e de provedor. Currency e preço são exibição de centavos vindos do catálogo/contrato do servidor, nunca entrada do browser.

## Estados e acessibilidade

- Botões ficam desabilitados durante operações; erros são mensagens específicas em `role=alert`.
- Campos usam `Label`, `aria-required`, `aria-invalid`, autocomplete adequado e teclado `tel` no celular.
- CPF/CNPJ usa capitalização automática e uma mensagem que identifica documento inválido; não elimina letras.
- O fluxo Pix tem CTA, confirmação, QR temporário, espera após reload, ativo, recusado e nova tentativa somente após recusa.
- Cartão oferece nova tentativa depois de cancelamento/expiração. Ela nunca reutiliza o checkout expirado, não cria outro contrato e aguarda webhook para qualquer verdade financeira.
- Checkpoint manual ainda necessário em desktop, ~390×844, navegação por teclado, leitor de tela, rede lenta, voltar, refresh, expiração e recuperação de erro. A automação de navegador desta sessão não está disponível.
