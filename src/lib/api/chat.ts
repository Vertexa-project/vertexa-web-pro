import {
  buildChatAttachmentPath,
  sendWithOrphanCleanup,
  validateChatAttachment,
  type PreparedChatAttachment,
} from "@/lib/domain/chatAttachment";
import { classifyMentionFailure, type MentionFailureReason } from "@/lib/domain/chatMention";
import { supabase } from "@/lib/supabase";
import type {
  ChannelProfessional,
  ChatMessage,
  ChatMessageView,
  ChatThread,
  ProfessionalType,
} from "@/types/db";

// Bucket PRIVADO de anexos do chat (Parte A). Sem URL pública: leitura só por createSignedUrl.
const ATTACHMENT_BUCKET = "chat-attachments";
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 600; // 10 min

// Linha de chat_messages com o profile do remetente e as marcações embutidos (join PostgREST).
interface RawChatMessageRow extends ChatMessage {
  sender: { full_name: string | null } | null;
  mentions: { mentioned_profile_id: string }[] | null;
}

/**
 * SELECT da lista. O embed de `chat_mentions` nomeia a FK explicitamente e traz APENAS
 * `mentioned_profile_id` — é o que o destaque do item 5 precisa, e vem na MESMA leitura da lista:
 * não existe segundo caminho de leitura de menção nesta tela.
 *
 * Este embed NÃO cai na armadilha do embed amputado: `chat_mentions_select` é
 * `mentioned_profile_id = current_profile_id() OR can_read_channel(message_channel(message_id))` —
 * quem lê a conversa lê as marcações dela.
 *
 * `*` já inclui `reply_to_message_id` (coluna de chat_messages desde a migration 20260806090000).
 */
const MESSAGE_SELECT = `
  *,
  sender:profiles!sender_profile_id ( full_name ),
  mentions:chat_mentions!chat_mentions_message_id_fkey ( mentioned_profile_id )
`;

const toMessageView = ({ sender, mentions, ...m }: RawChatMessageRow): ChatMessageView => ({
  ...m,
  sender_name: sender?.full_name ?? null,
  mentioned_profile_ids: (mentions ?? []).map((x) => x.mentioned_profile_id),
});

/**
 * Etapa do fluxo de abertura de uma conversa. São DOIS modos de falha diferentes e o
 * usuário precisa saber qual aconteceu: "não abri a conversa" ≠ "não carreguei as mensagens".
 */
export type ChatStage = "channel" | "messages";

/**
 * Erro de chat carregando a ETAPA que falhou.
 *
 * POR QUE EXISTE: `getChatThread` faz duas coisas — resolve o canal e carrega o histórico.
 * Antes, as duas caíam no mesmo `catch` genérico da tela ("Não foi possível carregar"), o que
 * escondeu a causa real do 42501 na CRIAÇÃO do canal: quem lia a tela concluía que o problema
 * era o histórico. Guardar a etapa é o que permite à UI e ao Sentry separarem os dois casos.
 */
export class ChatThreadError extends Error {
  readonly stage: ChatStage;
  /** Erro original do PostgREST/Supabase. NUNCA exibido cru ao usuário. */
  readonly cause: unknown;

  constructor(stage: ChatStage, message: string, cause: unknown) {
    super(message);
    this.name = "ChatThreadError";
    this.stage = stage;
    this.cause = cause;
  }
}

/** Etapa que falhou, ou `null` se o erro não veio desta camada. */
export function chatStageOf(error: unknown): ChatStage | null {
  return error instanceof ChatThreadError ? error.stage : null;
}

/**
 * Garante 1 canal por paciente via RPC `get_or_create_channel` (SECURITY DEFINER).
 *
 * POR QUE RPC E NÃO INSERT…RETURNING: o `.insert().select()` anterior falhava com 42501. O
 * INSERT em si passava — quem falhava era o RETURNING: na MESMA statement, a policy de SELECT
 * chama `channel_patient()`, que é STABLE e usa o snapshot do início da statement, logo não
 * enxerga a linha que a própria statement está inserindo. A RPC tira a criação de baixo da RLS
 * (a autorização continua explícita lá dentro, com o mesmo `can_access_patient_internal` do
 * WITH CHECK) e ainda reconcilia o roster de participantes. Idempotente pelo unique em patient_id.
 */
export async function getOrCreateChannel(patientId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_channel", {
    p_patient_id: patientId,
  });
  if (error) {
    throw new ChatThreadError(
      "channel",
      "Não foi possível abrir a conversa com este paciente.",
      error,
    );
  }
  if (!data) {
    throw new ChatThreadError(
      "channel",
      "Não foi possível abrir a conversa com este paciente.",
      null,
    );
  }
  return data as string;
}

/** Histórico do canal, ordenado, com o nome do remetente e as marcações já resolvidos. */
export async function listChatMessages(channelId: string): Promise<ChatMessageView[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_SELECT)
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawChatMessageRow[];
  return rows.map(toMessageView);
}

// Linha crua da RPC channel_professionals (nomes de coluna do banco).
interface RawChannelProfessionalRow {
  profile_id: string;
  full_name: string | null;
  type: ProfessionalType | null;
  specialty: string | null;
  disciplines: string[] | null;
}

/**
 * Profissionais de um canal — pela RPC `public.channel_professionals`, NÃO por embed.
 *
 * ⚠️ O EMBED EQUIVALENTE MENTE: `chat_participants -> profiles -> professionals(type, specialty)`
 * esbarra em DUAS policies. `professionals_select` (`profile_id = current_profile_id() OR
 * is_clinic_admin(clinic_id)`) esconde a linha do colega de um profissional COMUM, e
 * `profiles_select` (`can_see_profile`) esconde até o NOME dele — nenhum dos 4 ramos do helper
 * cobre "colega da mesma clínica". Embed aninhado bloqueado por RLS não devolve erro: devolve
 * VAZIO. A lista sairia curta, ou com nome e disciplina nulos, sem nenhum sinal de falha.
 *
 * A RPC é SECURITY DEFINER com portão fail-closed em `can_read_channel` (42501 antes de ler
 * qualquer dado), enumera as colunas (NÃO devolve registry_number) e ainda traz `disciplines`, que
 * o embed nem alcançava.
 *
 * ⚠️ AS DUAS PERGUNTAS SÃO DIFERENTES, E É O `includeMessageAuthors` QUE AS SEPARA
 * (WP-TEAM-2b-ii / WP-FRONT-2bii-A):
 *   · `false` (default) = **"quem eu posso marcar AGORA"** — só o ROSTER do canal. Um profissional
 *     desativado sai do roster na cascata da desativação, então ele NÃO pode ser oferecido: marcar
 *     alguém que não participa mais é uma menção que o banco recusa.
 *   · `true` = **"quem escreveu isto"** — roster ∪ AUTORES das mensagens do canal. Uma mensagem que
 *     existe tem de continuar tendo autor com nome depois que a pessoa sai; sem isto a bolha cairia
 *     para o genérico "Profissional" e o histórico perderia a autoria.
 * De propósito, NENHUM dos dois filtra `status`: identidade não se apaga com a desativação. O que
 * muda é a PERGUNTA, não o direito de ver o nome.
 *
 * O erro NÃO é engolido: propaga para a tela mostrar falha visível em vez de lista vazia.
 */
export async function listChannelProfessionals(
  channelId: string,
  includeMessageAuthors = false,
): Promise<ChannelProfessional[]> {
  const { data, error } = await supabase.rpc("channel_professionals", {
    p_channel_id: channelId,
    p_include_message_authors: includeMessageAuthors,
  });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawChannelProfessionalRow[];
  return rows.map((row) => ({
    profileId: row.profile_id,
    name: row.full_name?.trim() || "Profissional",
    type: row.type,
    specialty: row.specialty,
    disciplines: row.disciplines ?? [],
  }));
}

/**
 * Tudo que a tela de Mensagens precisa para um paciente em uma única query. O `actingProfileId`
 * (remetente) vem da identidade resolvida (real: profile do usuário logado; demo: pin) — o
 * chamador o injeta; esta camada não conhece mais o pin de env.
 */
export async function getChatThread(
  patientId: string,
  actingProfileId: string | null,
): Promise<ChatThread> {
  // Etapa 1 — abrir/criar o canal. Já lança ChatThreadError("channel").
  const channelId = await getOrCreateChannel(patientId);

  // Etapa 2 — carregar o histórico. Falha AQUI significa que a conversa existe e está
  // acessível, mas o histórico não veio: mensagem de erro (e scope no Sentry) diferentes.
  try {
    const messages = await listChatMessages(channelId);
    return { channelId, actingProfileId, messages };
  } catch (err) {
    throw new ChatThreadError(
      "messages",
      "Não foi possível carregar as mensagens desta conversa.",
      err,
    );
  }
}

/**
 * Sobe o anexo para o bucket privado e devolve os 4 campos. Caminho {channel_id}/{uuid}.{ext} —
 * o servidor exige que a pasta seja o próprio canal (item v da Parte A). Valida tipo/tamanho antes.
 */
export async function uploadChatAttachment(
  channelId: string,
  file: File,
): Promise<PreparedChatAttachment> {
  const invalid = validateChatAttachment(file);
  if (invalid) throw new Error(invalid);
  const path = buildChatAttachmentPath(channelId, crypto.randomUUID(), file.type);
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, name: file.name, mime: file.type, size: file.size };
}

/** Remove o objeto recém-enviado (auto-limpeza de órfão quando o INSERT falha). Best-effort. */
export async function deleteChatAttachmentObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  if (error) throw error;
}

/** URL assinada de curta duração para abrir/pré-visualizar o anexo (bucket privado; gerada no clique). */
export async function getChatAttachmentSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, ATTACHMENT_SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Não foi possível gerar o link do anexo.");
  return data.signedUrl;
}

export interface SendChatMessageInput {
  channelId: string;
  senderProfileId: string;
  /** Legenda opcional; pode ser vazia quando há anexo (mensagem só-anexo). */
  body?: string | null;
  /** Anexo opcional (PDF/imagem). */
  file?: File | null;
  /** Profissional marcado (WP-CHAT-B item 2). Vem do seletor alimentado pela RPC. */
  mentionedProfileId?: string | null;
  /**
   * Mensagem citada (WP-CHAT-B item 4). Vai CRU para o banco: a FK COMPOSTA com channel_id já
   * garante que a citada é do mesmo canal. A UI NÃO revalida isso.
   */
  replyToMessageId?: string | null;
}

export interface SendChatMessageResult {
  message: ChatMessage;
  /** true quando a MENSAGEM entrou e só a MARCAÇÃO falhou. Não é falha de envio. */
  mentionFailed: boolean;
  mentionFailureReason: MentionFailureReason | null;
}

/**
 * Envia uma mensagem como profissional (remetente = clínica/profissional), com anexo, marcação e
 * citação OPCIONAIS. Se houver arquivo: valida → sobe → insere; se o insert falhar, o objeto órfão
 * é removido (sendWithOrphanCleanup). Exige body OU anexo (espelha o CHECK do banco).
 *
 * ⚠️ A FALHA DA MENÇÃO NÃO É RELANÇADA — vira campo do resultado. São duas chamadas sem transação
 * e, quando a segunda falha, a mensagem JÁ ESTÁ no banco: relançar faria a tela dizer que o envio
 * falhou e o caminho de erro convidaria a reenviar, duplicando uma mensagem que a equipe já
 * recebeu. Nada é apagado (chat_messages é append-only). A falha do INSERT da MENSAGEM continua
 * sendo erro de verdade e continua sendo relançada. Ver lib/domain/chatMention.ts.
 */
export async function sendChatMessage(input: SendChatMessageInput): Promise<SendChatMessageResult> {
  const body = input.body?.trim() ? input.body.trim() : null;
  if (!body && !input.file) throw new Error("Escreva uma mensagem ou anexe um arquivo.");

  const message = await sendWithOrphanCleanup<ChatMessage>({
    upload: () => (input.file ? uploadChatAttachment(input.channelId, input.file) : Promise.resolve(null)),
    insert: async (attachment) => {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          channel_id: input.channelId,
          sender_profile_id: input.senderProfileId,
          sender_role: "professional",
          body,
          attachment_path: attachment?.path ?? null,
          attachment_name: attachment?.name ?? null,
          attachment_mime: attachment?.mime ?? null,
          attachment_size: attachment?.size ?? null,
          reply_to_message_id: input.replyToMessageId ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ChatMessage;
    },
    removeObject: (path) => deleteChatAttachmentObject(path),
  });

  if (!input.mentionedProfileId) {
    return { message, mentionFailed: false, mentionFailureReason: null };
  }

  const { error: mentionError } = await supabase.from("chat_mentions").insert({
    message_id: message.id,
    mentioned_profile_id: input.mentionedProfileId,
  });

  if (!mentionError) {
    return { message, mentionFailed: false, mentionFailureReason: null };
  }

  return {
    message,
    mentionFailed: true,
    mentionFailureReason: classifyMentionFailure(mentionError),
  };
}

// Linha de chat_mentions com o patient_id do canal resolvido pelos joins.
interface RawMentionRow {
  message: { channel: { patient_id: string | null } | null } | null;
}

/**
 * Menções NÃO lidas do profissional, retornadas como lista de patient_ids (uma
 * entrada por menção). Quem cria as menções é o app paciente (TeamChat). O
 * chamador agrega em contadores por paciente / total.
 */
export async function listUnreadMentionPatientIds(profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("chat_mentions")
    .select(`id, message:chat_messages!message_id ( channel:chat_channels!channel_id ( patient_id ) )`)
    .eq("mentioned_profile_id", profileId)
    .is("read_at", null);
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawMentionRow[];
  return rows
    .map((r) => r.message?.channel?.patient_id ?? null)
    .filter((id): id is string => Boolean(id));
}

/** Marca como lidas as menções do profissional num canal (ao abrir a conversa). */
export async function markChannelMentionsRead(channelId: string, profileId: string): Promise<void> {
  const { data: msgs, error: msgErr } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("channel_id", channelId);
  if (msgErr) throw msgErr;

  const ids = (msgs ?? []).map((m) => (m as { id: string }).id);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("chat_mentions")
    .update({ read_at: new Date().toISOString() })
    .in("message_id", ids)
    .eq("mentioned_profile_id", profileId)
    .is("read_at", null);
  if (error) throw error;
}
