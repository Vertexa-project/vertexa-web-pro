import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getChatThread,
  listUnreadMentionPatientIds,
  markChannelMentionsRead,
  sendChatMessage,
} from "@/lib/api/chat";
import { qk } from "@/lib/queryKeys";
import { useIdentity } from "@/hooks/useIdentity";
import { supabase } from "@/lib/supabase";

// Sequência para tópicos de realtime ÚNICOS por montagem.
// `RealtimeClient.channel(topic)` reusa o channel se o tópico já existir no
// registro; como `removeChannel` é assíncrono, o double-invoke do StrictMode
// (ou uma troca rápida de canal) reencontraria um channel já inscrito e o
// `.on('postgres_changes')` lançaria "cannot add ... after subscribe()".
// Um tópico único garante sempre um channel novo (state=closed) para o `.on()`.
let realtimeSeq = 0;

/**
 * Thread de chat de um paciente: resolve canal + histórico e assina o realtime.
 * Mensagens novas (inclusive enviadas pelo app paciente) chegam ao vivo via
 * `postgres_changes` em `chat_messages` filtrado pelo canal.
 */
export function useChatThread(patientId: string) {
  const queryClient = useQueryClient();
  const { actingProfileId } = useIdentity();
  const query = useQuery({
    queryKey: qk.chatThread(patientId),
    queryFn: () => getChatThread(patientId, actingProfileId),
    enabled: Boolean(patientId),
  });

  const channelId = query.data?.channelId;

  useEffect(() => {
    if (!channelId) return;
    // Channel NOVO (tópico único) — .on() ANTES do .subscribe(); cleanup remove.
    const channel = supabase
      .channel(`chat:${channelId}:${++realtimeSeq}`)
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

export interface UnreadMentions {
  total: number;
  byPatient: Record<string, number>;
}

/**
 * Menções não lidas do profissional atuante (demo), agregadas por paciente +
 * total. Assina o realtime de `chat_mentions` para acender/limpar ao vivo
 * (o app paciente cria as menções; a web marca como lidas ao abrir a conversa).
 */
export function useUnreadMentions() {
  const queryClient = useQueryClient();
  const { actingProfileId: profileId } = useIdentity();

  const query = useQuery({
    queryKey: qk.unreadMentions(profileId ?? "none"),
    queryFn: async (): Promise<UnreadMentions> => {
      const patientIds = await listUnreadMentionPatientIds(profileId as string);
      const byPatient: Record<string, number> = {};
      for (const id of patientIds) byPatient[id] = (byPatient[id] ?? 0) + 1;
      return { total: patientIds.length, byPatient };
    },
    enabled: Boolean(profileId),
  });

  useEffect(() => {
    if (!profileId) return;
    // Channel NOVO (tópico único) — .on() ANTES do .subscribe(); cleanup remove.
    const channel = supabase
      .channel(`chat-mentions:${profileId}:${++realtimeSeq}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_mentions",
          filter: `mentioned_profile_id=eq.${profileId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: qk.unreadMentions(profileId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, queryClient]);

  return query;
}

/** Marca as menções de um canal como lidas e revalida os contadores. */
export function useMarkMentionsRead() {
  const queryClient = useQueryClient();
  const { actingProfileId: profileId } = useIdentity();
  return useMutation({
    mutationFn: (channelId: string) => {
      if (!profileId) return Promise.resolve();
      return markChannelMentionsRead(channelId, profileId);
    },
    onSuccess: () => {
      if (!profileId) return;
      queryClient.invalidateQueries({ queryKey: qk.unreadMentions(profileId) });
    },
  });
}
