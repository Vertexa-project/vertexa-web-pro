// CITAÇÃO DE RESPOSTA — RESOLUÇÃO PURA (WP-CHAT-B itens 3 e 4).
//
// O painel passa a EXIBIR e a CRIAR resposta. Exibir só é honesto porque o app da paciente também
// exibe (PR #11 daquele repo) — um lado não cria o que o outro não mostra.
//
// A REGRA "a citada é do mesmo canal" NÃO É REIMPLEMENTADA AQUI, de propósito: a FK COMPOSTA
// (reply_to_message_id, channel_id) -> (id, channel_id) torna o contrário impossível de existir no
// banco. Reimplementar seria duplicar uma garantia mais forte que a nossa e criar um segundo lugar
// para ela divergir.
//
// Nada neste arquivo lê ou escreve: tudo é derivação da lista já carregada.
import type { ChatMessageView } from "@/types/db";

/** Texto quando a mensagem citada não pôde ser resolvida. Degrada; nunca quebra a lista. */
export const QUOTE_UNAVAILABLE = "Mensagem original indisponível";

/**
 * Trecho curto da mensagem citada. `body` é ANULÁVEL (mensagem só-anexo), então cai para o nome do
 * arquivo antes de virar rótulo genérico — citar "Mensagem sem texto" quando existe um PDF com
 * nome seria esconder a única informação útil.
 */
export function quotedPreview(msg: ChatMessageView, maxChars = 120): string {
  const body = msg.body?.trim();
  if (body) {
    return body.length > maxChars ? `${body.slice(0, maxChars).trimEnd()}…` : body;
  }
  const attachmentName = msg.attachment_name?.trim();
  if (attachmentName) return attachmentName;
  if (msg.attachment_path) return "Anexo";
  return "Mensagem sem texto";
}

/** Índice id -> mensagem. Aceita vários grupos para juntar a lista carregada com qualquer extra. */
export function indexById(...groups: ChatMessageView[][]): Map<string, ChatMessageView> {
  const map = new Map<string, ChatMessageView>();
  for (const group of groups) {
    for (const m of group) map.set(m.id, m);
  }
  return map;
}

/** Citação já pronta para a tela. `found=false` ⇒ degradou para QUOTE_UNAVAILABLE. */
export interface ResolvedQuote {
  found: boolean;
  author: string | null;
  preview: string;
}

/**
 * Resolve a citação de UMA mensagem contra o índice da lista.
 *
 * - sem `reply_to_message_id` ⇒ `null` (a mensagem simplesmente não é resposta);
 * - id presente mas ausente do índice ⇒ ResolvedQuote com found=false e QUOTE_UNAVAILABLE.
 *   NUNCA lança e nunca devolve string vazia: a lista tem de renderizar de qualquer jeito.
 *
 * `authorOf` é injetado porque o nome do remetente NÃO sai só desta camada — o do colega vem da
 * RPC channel_professionals (a RLS de profiles esconde colega de profissional comum).
 */
export function resolveQuote(
  message: Pick<ChatMessageView, "reply_to_message_id">,
  byId: Map<string, ChatMessageView>,
  authorOf: (quoted: ChatMessageView) => string,
): ResolvedQuote | null {
  const id = message.reply_to_message_id;
  if (!id) return null;

  const quoted = byId.get(id);
  if (!quoted) return { found: false, author: null, preview: QUOTE_UNAVAILABLE };

  return { found: true, author: authorOf(quoted), preview: quotedPreview(quoted) };
}
