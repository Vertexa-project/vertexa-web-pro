import { supabase } from "@/lib/supabase";
import type { Message, MessageWithSender } from "@/types/db";

interface RawMessageRow extends Message {
  sender: { profile: { full_name: string | null } | null } | null;
}

/**
 * Thread de mensagens do paciente. O remetente profissional é resolvido para o
 * nome da clínica/profissional — NUNCA "Vertexa".
 */
export async function getMessages(patientId: string): Promise<MessageWithSender[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(`*, sender:professionals ( profile:profiles ( full_name ) )`)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawMessageRow[];
  return rows.map((row) => ({
    ...row,
    sender_name: row.sender?.profile?.full_name ?? null,
  }));
}
