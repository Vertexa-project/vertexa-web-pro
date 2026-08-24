import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getUnreadStaffNotificationsCount,
  listRecentStaffNotifications,
  markStaffNotificationRead,
} from "@/lib/api/staffNotifications";
import {
  mergeStaffNotificationInsert,
  nextUnreadCountAfterInsert,
} from "@/lib/domain/staffNotifications";
import { qk } from "@/lib/queryKeys";
import { useIdentity } from "@/hooks/useIdentity";
import { supabase } from "@/lib/supabase";
import type { StaffNotification } from "@/types/db";

// Mesma estratégia do chat: tópico único por montagem para o StrictMode
// não reusar um channel já inscrito (removeChannel é assíncrono).
let realtimeSeq = 0;

export function staffNotificationsChannelTopic(profileId: string, seq: number): string {
  return `staff-notifications:${profileId}:${seq}`;
}

function asStaffNotification(raw: unknown): StaffNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<StaffNotification>;
  if (typeof row.id !== "string" || typeof row.created_at !== "string") return null;
  if (typeof row.recipient_profile_id !== "string") return null;
  if (typeof row.message_id !== "string") return null;
  if (row.type !== "help_requested") return null;
  if (row.severity !== "critical") return null;
  return {
    id: row.id,
    clinic_id: typeof row.clinic_id === "string" ? row.clinic_id : "",
    recipient_profile_id: row.recipient_profile_id,
    actor_profile_id: row.actor_profile_id ?? null,
    patient_id: row.patient_id ?? null,
    channel_id: row.channel_id ?? null,
    message_id: row.message_id,
    type: "help_requested",
    severity: "critical",
    created_at: row.created_at,
    read_at: row.read_at ?? null,
  };
}

export function applyStaffNotificationRealtimeInsert(
  current: StaffNotification[] | undefined,
  incoming: StaffNotification,
): StaffNotification[] {
  return mergeStaffNotificationInsert(current ?? [], incoming);
}

/**
 * Lista recente + unread + mark read + subscription INSERT filtrada pelo
 * `actingProfileId` (não auth.uid). Vive no Topbar do shell autenticado.
 */
export function useStaffNotifications() {
  const queryClient = useQueryClient();
  const { actingProfileId } = useIdentity();
  const profileId = actingProfileId ?? null;

  const listQuery = useQuery({
    queryKey: qk.staffNotifications(profileId ?? "none"),
    queryFn: () => listRecentStaffNotifications(10),
    enabled: Boolean(profileId),
  });

  const unreadQuery = useQuery({
    queryKey: qk.staffNotificationsUnread(profileId ?? "none"),
    queryFn: () => getUnreadStaffNotificationsCount(),
    enabled: Boolean(profileId),
  });

  useEffect(() => {
    if (!profileId) return;
    const seq = ++realtimeSeq;
    const channel = supabase
      .channel(staffNotificationsChannelTopic(profileId, seq))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "staff_notifications",
          filter: `recipient_profile_id=eq.${profileId}`,
        },
        (payload) => {
          const incoming = asStaffNotification(payload.new);
          if (!incoming) {
            queryClient.invalidateQueries({ queryKey: qk.staffNotifications(profileId) });
            queryClient.invalidateQueries({ queryKey: qk.staffNotificationsUnread(profileId) });
            return;
          }
          const previous =
            queryClient.getQueryData<StaffNotification[]>(qk.staffNotifications(profileId)) ?? [];
          const alreadyPresent = previous.some((row) => row.id === incoming.id);
          queryClient.setQueryData(qk.staffNotifications(profileId), (old: StaffNotification[] | undefined) =>
            applyStaffNotificationRealtimeInsert(old, incoming),
          );
          queryClient.setQueryData(qk.staffNotificationsUnread(profileId), (old: number | undefined) =>
            nextUnreadCountAfterInsert(old ?? 0, incoming, alreadyPresent),
          );
          queryClient.invalidateQueries({ queryKey: qk.staffNotifications(profileId) });
          queryClient.invalidateQueries({ queryKey: qk.staffNotificationsUnread(profileId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, queryClient]);

  const markRead = useMutation({
    mutationFn: (id: string) => markStaffNotificationRead(id),
    onMutate: async (id) => {
      if (!profileId) return;
      await queryClient.cancelQueries({ queryKey: qk.staffNotifications(profileId) });
      await queryClient.cancelQueries({ queryKey: qk.staffNotificationsUnread(profileId) });
      const previousList = queryClient.getQueryData<StaffNotification[]>(
        qk.staffNotifications(profileId),
      );
      const previousUnread = queryClient.getQueryData<number>(qk.staffNotificationsUnread(profileId));
      const wasUnread = previousList?.find((row) => row.id === id)?.read_at == null;
      queryClient.setQueryData(qk.staffNotifications(profileId), (old: StaffNotification[] | undefined) =>
        (old ?? []).map((row) =>
          row.id === id ? { ...row, read_at: row.read_at ?? new Date().toISOString() } : row,
        ),
      );
      if (wasUnread) {
        queryClient.setQueryData(qk.staffNotificationsUnread(profileId), (old: number | undefined) =>
          Math.max(0, (old ?? 1) - 1),
        );
      }
      return { previousList, previousUnread };
    },
    onError: (_err, _id, ctx) => {
      if (!profileId || !ctx) return;
      queryClient.setQueryData(qk.staffNotifications(profileId), ctx.previousList);
      queryClient.setQueryData(qk.staffNotificationsUnread(profileId), ctx.previousUnread);
    },
    onSettled: () => {
      if (!profileId) return;
      queryClient.invalidateQueries({ queryKey: qk.staffNotifications(profileId) });
      queryClient.invalidateQueries({ queryKey: qk.staffNotificationsUnread(profileId) });
    },
  });

  return {
    profileId,
    items: listQuery.data ?? [],
    unreadCount: unreadQuery.data ?? 0,
    isLoading: listQuery.isLoading || unreadQuery.isLoading,
    isError: listQuery.isError || unreadQuery.isError,
    markRead: markRead.mutate,
    markReadAsync: markRead.mutateAsync,
  };
}
