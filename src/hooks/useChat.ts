import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getChatThread, sendChatMessage } from "@/lib/api/chat";
import { qk } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

/**
 * Thread de chat de um paciente: resolve canal + histórico e assina o realtime.
 * Mensagens novas (inclusive enviadas pelo app paciente) chegam ao vivo via
 * `postgres_changes` em `chat_messages` filtrado pelo canal.
 */
export function useChatThread(patientId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.chatThread(patientId),
    queryFn: () => getChatThread(patientId),
    enabled: Boolean(patientId),
  });

  const channelId = query.data?.channelId;

  useEffect(() => {
    if (!channelId) return;
    const channel = supabase
      .channel(`chat:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: qk.chatThread(patientId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelId, patientId, queryClient]);

  return query;
}

/** Envia mensagem como profissional e revalida a thread ao concluir. */
export function useSendChatMessage(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { channelId: string; senderProfileId: string; body: string }) =>
      sendChatMessage(vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.chatThread(patientId) });
    },
  });
}
