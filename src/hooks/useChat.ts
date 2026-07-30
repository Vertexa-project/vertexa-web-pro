import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  chatStageOf,
  getChatAttachmentSignedUrl,
  getChatThread,
  listChannelProfessionals,
  listUnreadMentionPatientIds,
  markChannelMentionsRead,
  sendChatMessage,
  type SendChatMessageInput,
} from "@/lib/api/chat";
import { captureException } from "@/lib/observability/sentry";
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
    queryFn: async () => {
      try {
        return await getChatThread(patientId, actingProfileId);
      } catch (err) {
        // Reporta com a ETAPA no scope para separar "não abri a conversa" de "não carreguei
        // as mensagens" — foi o erro genérico que escondeu o 42501 da criação de canal.
        // SEM PII: nada de conteúdo de mensagem, nome ou id de paciente; só a etapa.
        const stage = chatStageOf(err);
        captureException(new Error(`chat thread failed at stage: ${stage ?? "unknown"}`), {
          source: "chat",
          scope: stage === "messages" ? "load-messages" : "open-channel",
        });
        throw err;
      }
    },
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

/**
 * Profissionais de um canal (RPC channel_professionals).
 *
 * `includeMessageAuthors` escolhe QUAL PERGUNTA está sendo feita — e as duas têm respostas
 * diferentes assim que alguém é desativado (WP-FRONT-2bii-A item 2):
 *   false → ROSTER: "quem eu posso marcar agora". É a fonte do seletor de @.
 *   true  → ROSTER ∪ AUTORES: "quem escreveu isto". É a fonte do nome na bolha e na citação.
 * As duas chamadas têm CHAVES DE CACHE distintas de propósito (ver queryKeys) — se dividissem
 * cache, o seletor passaria a oferecer quem já saiu.
 *
 * SEM `retry: false` e SEM valor de fallback de propósito: erro aqui tem de CHEGAR à tela. Uma
 * lista vazia silenciosa é exatamente o defeito que a RPC veio matar. `staleTime` curto porque o
 * roster muda quando um vínculo é desativado — e é essa mudança que provoca a corrida do item 2.
 */
export function useChannelProfessionals(
  channelId: string | null | undefined,
  includeMessageAuthors = false,
) {
  return useQuery({
    queryKey: qk.channelProfessionals(channelId ?? "none", includeMessageAuthors),
    queryFn: () => listChannelProfessionals(channelId as string, includeMessageAuthors),
    enabled: Boolean(channelId),
    staleTime: 30_000,
  });
}

/** Envia mensagem (texto e/ou anexo, com marcação e citação opcionais) e revalida a thread. */
export function useSendChatMessage(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: SendChatMessageInput) => sendChatMessage(vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.chatThread(patientId) });
    },
    onError: (_err, vars) => {
      // Só reporta o fluxo de ANEXO (upload/insert). Erro SANITIZADO (sem nome de arquivo/caminho = sem PII).
      if (vars.file) {
        captureException(new Error("chat attachment send failed"), {
          source: "chat-attachment",
          scope: "send",
        });
      }
    },
  });
}

/**
 * URL assinada (TTL 600s) de um anexo, gerada SOB DEMANDA. `staleTime` < TTL para nunca reusar
 * um link além da validade. Erro de assinatura é reportado ao Sentry (source:"chat-attachment", sem PII).
 */
export function useChatAttachmentUrl(path: string | null) {
  return useQuery({
    queryKey: qk.chatAttachmentUrl(path ?? "none"),
    queryFn: async () => {
      try {
        return await getChatAttachmentSignedUrl(path as string);
      } catch (err) {
        captureException(new Error("chat attachment signed url failed"), {
          source: "chat-attachment",
          scope: "sign",
        });
        throw err;
      }
    },
    enabled: Boolean(path),
    staleTime: 540_000, // 9 min < TTL 10 min
    gcTime: 540_000,
    retry: 1,
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
          // A MENÇÃO chega DEPOIS da mensagem — são duas chamadas sem transação. O evento de
          // chat_messages já invalidou a thread, mas naquele instante a linha de chat_mentions
          // ainda não existia: sem esta segunda invalidação a bolha ficaria SEM o destaque do
          // item 5 até a próxima troca de conversa. Predicado (e não chave fixa) porque este hook
          // é global e não sabe de qual paciente é o canal da menção; só a thread montada refaz.
          queryClient.invalidateQueries({
            predicate: (q) => q.queryKey[0] === "patient" && q.queryKey[2] === "chat",
          });
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
