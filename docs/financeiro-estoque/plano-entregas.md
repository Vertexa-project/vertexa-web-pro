# Vertexa — Financeiro, Repasse e Estoque (v1) · plano de entregas

Fonte: "Vertexa — Especificação Financeiro, Repasse e Estoque (v1)" (Gabriel Queiroz, 13/11/2026),
cópia em texto em `escopo-v1.txt`. Pedido: Oficina, cartão #707 (Djeimyson), 13/11/2026.

Onde roda: mesmo Vertexa (web do profissional `vertexa-web-pro`), mesmo Supabase (cdhjfyyuhmwrcuxqavib),
publicação pela Vercel da cliente (push na main de Vertexa-project). Sem ambiente de teste: os módulos são
novos e aditivos, conferidos no ar na Clínica Teste Hefesto (QA).

Entregas:
1. Base e cadastros: unidades, papéis (Gestor, Financeiro, Recepção, Estoquista), log de auditoria, serviços com papéis, dados financeiros e retenções dos profissionais, meios de pagamento e taxas, alíquota mensal, licença sanitária, itens de estoque
2. Vendas, recebimentos, títulos (parcelas) e caixa diário da recepção
3. Estoque básico: saldo inicial, entradas (manual e XML da NF-e), saídas, lote e validade, uso fracionado e individual por paciente, custo médio, saldo por unidade
4. Atendimento com participantes e kit automático (baixa do estoque e custo do material no atendimento), pacotes
5. Motor de repasse: regras por profissional, serviço e papel; percentual, faixas, fixos, garantia, comissão, taxa de uso, estornos; exemplos A a H como testes automáticos
6. Fechamento mensal: tabela do gestor, extrato do profissional, retenções, aceite e contestação, NF, pagamento, travamento e exportações
7. Painel financeiro (dashboard) com números clicáveis
8. Inventário cego, transferências entre unidades, alertas e relatórios de estoque
9. Documentos clínicos: botão Novo documento no paciente e no atendimento, ligado ao provedor escolhido (modo demonstração até a escolha). Nota: `entrega-9.md`.

Pendências da seção 13.3 (padrão adotado até a cliente decidir):
- P1 provedor de prescrição: adaptador em modo demonstração (entrega 9).
- P2 prazo de aceite: 5 dias, configurável.
- P3 paciente no extrato: iniciais (configurável pela clínica).
- P4 contador/advogado: o sistema calcula o que a clínica configurar.
- P5 liquidação: automática na data prevista, com opção de confirmação manual por clínica.
- P6 volume: índices e paginação para clínicas grandes; sem impacto no v1.
- P7 textos jurídicos: texto inicial, aprovação do jurídico da cliente.
- P8 XML da NF-e e contagem cega: ligados.
