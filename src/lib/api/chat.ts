import { DEMO_PROFESSIONAL_PROFILE_ID } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, ChatMessageView, ChatThread } from "@/types/db";

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

/** Tudo que a tela de Mensagens precisa para um paciente em uma única query. */
export async function getChatThread(patientId: string): Promise<ChatThread> {
  const channelId = await getOrCreateChannel(patientId);
  const messages = await listChatMessages(channelId);
  // Remetente = profissional atuante em modo demo (Dra. Camila via env).
  return { channelId, actingProfileId: DEMO_PROFESSIONAL_PROFILE_ID, messages };
}

export interface SendChatMessageInput {
  channelId: string;
  senderProfileId: string;
  body: string;
}

/** Envia uma mensagem como profissional (remetente = clínica/profissional). */
export async function sendChatMessage(input: SendChatMessageInput): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      channel_id: input.channelId,
      sender_profile_id: input.senderProfileId,
      sender_role: "professional",
      body: input.body,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ChatMessage;
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
