import {
  buildChatAttachmentPath,
  sendWithOrphanCleanup,
  validateChatAttachment,
  type PreparedChatAttachment,
} from "@/lib/domain/chatAttachment";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, ChatMessageView, ChatThread } from "@/types/db";

// Bucket PRIVADO de anexos do chat (Parte A). Sem URL pública: leitura só por createSignedUrl.
const ATTACHMENT_BUCKET = "chat-attachments";
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 600; // 10 min

// Linha de chat_messages com o profile do remetente embutido (join PostgREST).
interface RawChatMessageRow extends ChatMessage {
  sender: { full_name: string | null } | null;
}

/**
 * Garante 1 canal por paciente. O backfill da Etapa 2 já criou um canal para
 * cada paciente do seed; cria sob demanda caso falte (idempotente pelo unique
 * em patient_id). Retorna o id do canal.
 */
export async function getOrCreateChannel(patientId: string): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("patient_id", patientId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return (existing as { id: string }).id;

  const { data: created, error: insErr } = await supabase
    .from("chat_channels")
    .insert({ patient_id: patientId })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return (created as { id: string }).id;
}

/** Histórico do canal, ordenado, com o nome do remetente já resolvido. */
export async function listChatMessages(channelId: string): Promise<ChatMessageView[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select(`*, sender:profiles!sender_profile_id ( full_name )`)
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawChatMessageRow[];
  return rows.map(({ sender, ...m }) => ({
    ...m,
    sender_name: sender?.full_name ?? null,
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
  const channelId = await getOrCreateChannel(patientId);
  const messages = await listChatMessages(channelId);
  return { channelId, actingProfileId, messages };
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
}

/**
 * Envia uma mensagem como profissional (remetente = clínica/profissional), com anexo OPCIONAL.
 * Se houver arquivo: valida → sobe → insere. Se o insert falhar, o objeto órfão é removido
 * (sendWithOrphanCleanup). Exige body OU anexo (espelha o CHECK do banco).
 */
export async function sendChatMessage(input: SendChatMessageInput): Promise<ChatMessage> {
  const body = input.body?.trim() ? input.body.trim() : null;
  if (!body && !input.file) throw new Error("Escreva uma mensagem ou anexe um arquivo.");

  return sendWithOrphanCleanup<ChatMessage>({
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
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ChatMessage;
    },
    removeObject: (path) => deleteChatAttachmentObject(path),
  });
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
