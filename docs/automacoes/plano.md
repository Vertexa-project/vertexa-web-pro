# Vertexa — Plano de implementação das automações (reunião de 28/10/2026)

Fonte: transcrição "Impromptu Google Meet Meeting - October 28" (Fathom, 98 min; PDF enviado por Djeimyson no tópico em 13/11; fora do repositório porque tem dados de saúde).
Participantes: Juliana Santiago, Ernani Santiago, equipe Dizevolv (no papel de paciente-teste).

## O que já existe no Vertexa (não refazer)
- Campanhas automáticas no app (boas-vindas, check-in, retorno, reativação, aniversário), só como notificação no app, desligadas por padrão (WP-CAMP A).
- Recado semanal da equipe, revisão de peso suspeito, esforço do treino, opções de refeição, sequência com falha perdoada.
- Documentos do paciente, jornada (kanban), sinais de risco, agenda interna + Google Agenda (só leitura).
- Falta: pré-consulta, controle de exames/retornos com prazo, controle de aplicação de medicação, rotina configurável
  (foto/peso/feedback), missão de adesão, WhatsApp, transcrição de consulta e rascunho de dieta/treino por IA.

## Automações pedidas na reunião (com o minuto)
| # | Automação | Dor citada |
|---|---|---|
| A1 | Pré-consulta: ficha de perguntas + envio de exames ao marcar a consulta; resumo para o profissional | 27:03, 36:29, 38:06 |
| A2 | Exames e retornos: data de retorno, exames pedidos com prazo, aviso ~1 mês antes, prazo ~2 semanas antes do retorno, cobrança automática do atrasado, painel do pendente | 41:03–45:36, 48:58 |
| A3 | Controle de aplicação (tirzepatida): início, dose em mg, dia de aplicação, entregas | 43:27 |
| A4 | Rotina por paciente: período de foto, peso e feedback (ex.: sexta), configurável por clínica/paciente; app pede o feedback | 1:04:38–1:09:23 |
| A5 | Missão da primeira semana: checklist gamificado (fotos frente/lado/costas, balança, suplementos, bio) que “desbloqueia” a consulta | 1:04:38, 38:30 |
| A6 | Reengajamento: paciente X dias sem falar → sequência de mensagens no tom da Juliana | 44:11 |
| A7 | Consulta assistida: gravação → transcrição → prontuário/anamnese preenchidos + “combinados” enviados ao paciente ao fim | 25:47, 55:16 |
| A8 | Primeira versão de dieta e treino por IA em 24–48 h, pelo tipo de paciente e pela metodologia da Juliana; profissional revisa | 38:30, 47:00, 1:01:23 |
| C1 | Canal WhatsApp (2 números PJ da Juliana) para A1, A2, A6 e A7 | 1:29:33 |

Fora deste plano (citado na reunião, não é automação do sistema): tutoriais de uso (23:41), stories/building in public (Ernani),
telas da App Store, design do PDF de finalização (Ernani e Juliana alinham o design).

## Entregas (ordem pela dor da Juliana)
Cada entrega: onde, dispara, passos, testes, depende de, custo/mês. Tudo nasce desligado por clínica e testado com paciente TESTE.

1. **A2 Exames e retornos** — onde: ficha do paciente (web) + app do paciente + painel “Pendências”. Dispara: profissional
   registra retorno e exames pedidos. Passos: lembrete no app 30 dias antes; prazo do exame = retorno − 14 dias; atrasou →
   cobrança diária por 3 dias e depois semanal; exame enviado pelo app marca como entregue. Testes: retorno em +30/+14/−1 dia,
   envio parcial. Depende de: nada (WhatsApp entra quando C1 ligar). Custo: R$ 0. Previsão: ~6 h.
2. **A1 Pré-consulta** — onde: agenda (web) e app/link. Dispara: consulta marcada. Passos: envia ficha curta + pedido de exames;
   respostas e arquivos caem na ficha; resumo de 5 linhas para o profissional antes da consulta. Depende de: perguntas da Juliana
   (sem resposta, usamos o roteiro da anamnese dela da reunião). Custo: ~R$ 0,05 por resumo (IA). Previsão: ~4 h.
3. **A4 + A5 Rotina e missão** — onde: configuração da clínica/paciente (web) + app. Dispara: paciente ativado / dia da rotina.
   Passos: clínica escolhe períodos (padrão Juliana: foto e peso mensais, feedback semanal na sexta); no dia, o app abre a
   missão até concluir; primeira semana com checklist de adesão e “parabéns” ao fim. Depende de: lista de passos da Juliana
   (sem resposta: fotos frente/lado/costas, balança em jejum, foto dos suplementos, bio se tiver). Custo: R$ 0. Previsão: ~5 h.
4. **A6 Reengajamento** — amplia a campanha “reativação” já existente: sequência de 3 mensagens (dia 5, 8, 12 sem interação),
   para quando o paciente responde. Depende de: tom/texto da Juliana (sugerimos o texto da reunião). Custo: R$ 0 no app.
   Previsão: ~3 h.
5. **A3 Aplicação de medicação** — onde: ficha do paciente + app (lembrete do dia). Registra início, dose (mg), dia, aplicação
   feita e entrega; histórico de doses. Liga ao Estoque (cartão 707, entrega 4) quando a medicação é aplicada na clínica.
   Custo: R$ 0. Previsão: ~3 h.
6. **C1 WhatsApp** — API oficial (WhatsApp Cloud) num dos números PJ; modelos de mensagem aprovados pela Meta para A1, A2, A6.
   Depende de: número + acesso ao Meta Business da clínica. Custo: ~R$ 0,04–0,10 por mensagem de aviso (tabela Meta; a
   confirmar). Previsão: ~3 h + espera da aprovação da Meta (1–3 dias).
7. **A7 Consulta assistida** — onde: botão “Iniciar atendimento” na ficha. Grava (com aceite do paciente na tela), transcreve,
   preenche a anamnese nos campos e gera os “combinados” para o profissional revisar e enviar (app/WhatsApp).
   Depende de: texto de consentimento aprovado pelo jurídico; modelo de prontuário da Juliana. Custo: ~R$ 2–3 por consulta de
   1 h (transcrição + IA; a confirmar). Previsão: ~6 h.
8. **A8 Rascunho de dieta e treino por IA** — dispara: anamnese + exames prontos. Gera rascunho no editor de plano
   (alimentar e treino, com a Biblioteca de exercícios), por tipo de paciente; nada vai ao paciente sem o profissional publicar.
   Depende de: tipos de paciente, chats do ChatGPT da Juliana (dieta e treino) e modelo do plano cardiometabólico.
   Custo: ~R$ 0,50 por rascunho (a confirmar). Previsão: ~6 h.

Total de construção: ~36 h de agente, com a conferência. Esperas de gente/terceiro à parte.

## O que falta da Juliana (pedido único)
Prioridade agora: (1) perguntas da pré-consulta ou o “relatoriozinho” de anamnese dela; (2) passos da missão/rotina;
(3) um dos números PJ + acesso de administrador ao Meta Business. Logo depois: tipos de paciente, chats do ChatGPT de dieta e treino,
modelo do plano cardiometabólico, guias de exames (Manaus, Ribeirão, Rio Preto, SP), texto jurídico de consentimento da gravação.
