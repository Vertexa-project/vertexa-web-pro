// A CORRIDA DA MENÇÃO NO PAINEL (WP-CHAT-B item 2).
//
// Enviar com marcação são DUAS chamadas sem transação: INSERT em chat_messages e, depois, INSERT
// em chat_mentions. A policy chat_mentions_insert (migration 20260806090000, em produção) exige
// que o MARCADO seja participante do canal:
//
//   is_channel_participant(message_channel(message_id))
//   AND EXISTS (select 1 from chat_participants
//                where channel_id = message_channel(message_id)
//                  and profile_id  = mentioned_profile_id)
//
// Entre o seletor carregar e o envio acontecer, o colega pode ter saído do roster — é literalmente
// o que `deactivate_patient_link` faz (remove do chat_participants na mesma transação). Quando a
// policy recusa, a MENSAGEM JÁ ESTÁ NO BANCO. Dizer "não foi possível enviar" seria mentira,
// reenviar duplicaria uma mensagem que a equipe já recebeu, e não há caminho de apagar (a tabela é
// append-only: `revoke update` + sem policy de delete). Só a marcação não entrou — é isso, e só
// isso, que a tela deve dizer.
//
// Mesma postura do app da paciente (WP-APP-3 item 2), de propósito: os dois lados da mesma corrida
// não podem contar histórias diferentes.

/** Postgres: insufficient_privilege. É o código que a RLS devolve ao recusar a linha. */
const RLS_DENIED = "42501";

export type MentionFailureReason = "not_participant" | "unknown";

/**
 * Traduz o erro do INSERT em chat_mentions.
 *
 * 42501 é a policy recusando. Das duas condições do WITH CHECK, a do AUTOR não pode ser a causa:
 * quem não é participante do canal não teria conseguido inserir a MENSAGEM um passo antes (a
 * policy chat_messages_insert exige a mesma participação). Sobra a outra — o marcado não está
 * mais em chat_participants.
 *
 * Qualquer outro erro (rede, timeout, 5xx) é `unknown`: não sabemos se a marcação entrou, e o
 * texto correspondente NÃO afirma o motivo.
 */
export function classifyMentionFailure(
  error: { code?: string | null } | null | undefined,
): MentionFailureReason {
  return error?.code === RLS_DENIED ? "not_participant" : "unknown";
}

/**
 * O aviso mostrado ao profissional. Começa SEMPRE afirmando que a mensagem foi enviada — porque
 * foi. Nunca sugere reenviar e nunca culpa quem escreveu: a corrida é do sistema, não dele.
 */
export function mentionFailureMessage(name: string, reason: MentionFailureReason): string {
  const who = name.trim() || "o profissional";
  return reason === "not_participant"
    ? `Mensagem enviada. Não foi possível marcar ${who}: essa pessoa não está mais nesta conversa.`
    : `Mensagem enviada. Não foi possível marcar ${who} desta vez. A equipe continua vendo a mensagem.`;
}
