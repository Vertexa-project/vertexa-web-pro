# CNPJ alfanumérico — contrato de suporte

## Escopo

O cadastro de faturamento aceita CPF numérico de 11 dígitos e CNPJ de 14 caracteres. O CNPJ aceita o formato legado numérico e o novo formato alfanumérico: posições 1–12 em `0-9` ou `A-Z`; posições 13–14 são DVs numéricos.

O valor canônico é sempre sem pontuação, em maiúsculas. A pontuação visual não é persistida. Não há consulta externa no fluxo de validação estrutural.

## Regra de DV

A implementação no cliente e no PostgreSQL usa módulo 11 com os pesos tradicionais do CNPJ: `5,4,3,2,9,8,7,6,5,4,3,2` e `6,5,4,3,2,9,8,7,6,5,4,3,2`. Para cada posição, o valor é `ASCII(caractere) - 48`; resto 0 ou 1 gera DV 0 e os demais geram `11 - resto`. O segundo DV inclui o primeiro.

Referência de regra: [documentação técnica da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos) e [serviço oficial de simulação](https://www.gov.br/pt-br/servicos/simulador-cnpj-alfanumerico?id=23597&origem=servico).

## Superfícies protegidas

| Superfície | Regra |
| --- | --- |
| `BillingIdentityForm` | Normaliza minúsculas para maiúsculas, mostra máscara e mantém letras. |
| `billingProfile.ts` | Validador puro, sem I/O, com CPF e CNPJ independentes da formatação. |
| `private.billing_tax_id_is_valid` | Autoridade do servidor; recalcula DV antes de gravar. |
| `customerBodyFromIdentity` | Recebe só identidade já validada pelo servidor e não remove letras do CNPJ. |

## Casos determinísticos

- `12.ABC.345/01DE-35` → `12ABC34501DE35`, válido.
- Mesmo conteúdo com DV `34` → inválido.
- Letra em DV ou caractere fora de `A-Z0-9` → inválido.
- `11222333000181` continua válido; `11222333000180` continua inválido.
- CPF precisa ter 11 dígitos, DV correto e não pode ser repetido.

## Limites deliberados

Validade estrutural não prova existência, situação cadastral ou razão social. Uma futura integração **server-side** com a Consulta CNPJ do SERPRO poderá ser avaliada separadamente; ela exigirá decisão humana, base legal, credenciais e política de retenção. Não foi adicionada dependência ou API externa nesta entrega.
