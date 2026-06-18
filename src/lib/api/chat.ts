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

/**
 * Profissional atuante do canal = remetente das mensagens enviadas pela web em
 * modo demo (não há auth real). Pega o primeiro participante com role
 * 'professional'. Sob RLS real isto vira `auth.uid()` (ver PENDENCIAS #14).
 */
async function getActingProfileId(channelId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("chat_participants")
    .select("profile_id")
    .eq("channel_id", channelId)
    .eq("role", "professional")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { profile_id: string | null } | null)?.profile_id ?? null;
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
  const [messages, actingProfileId] = await Promise.all([
    listChatMessages(channelId),
    getActingProfileId(channelId),
  ]);
  return { channelId, actingProfileId, messages };
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
