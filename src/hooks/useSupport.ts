import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMySupportUnread,
  getPlatformSupportCounts,
  getSupportTicket,
  listMySupportTickets,
  listPlatformSupportTickets,
  listSupportClinics,
  openSupportTicket,
  replySupportTicket,
  setSupportStatus,
  supportAttachmentUrl,
  type SupportStatus,
} from "@/lib/api/support";

export const supportKeys = {
  all: ["support"] as const,
  clinics: ["support", "clinics"] as const,
  mine: ["support", "mine"] as const,
  unread: ["support", "unread"] as const,
  platform: (status: SupportStatus | null) => ["support", "platform", status ?? "todos"] as const,
  counts: ["support", "platform-counts"] as const,
  ticket: (id: string) => ["support", "ticket", id] as const,
  attachment: (path: string) => ["support", "attachment", path] as const,
};

export function useSupportClinics(enabled = true) {
  return useQuery({ queryKey: supportKeys.clinics, queryFn: listSupportClinics, enabled, staleTime: 5 * 60_000 });
}

export function useMySupportTickets(enabled = true) {
  return useQuery({ queryKey: supportKeys.mine, queryFn: listMySupportTickets, enabled, refetchInterval: 60_000 });
}

/** Respostas da equipe Vertexa ainda não lidas (badge no menu). */
export function useMySupportUnread(enabled = true) {
  return useQuery({
    queryKey: supportKeys.unread,
    queryFn: getMySupportUnread,
    enabled,
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });
}

export function usePlatformSupportTickets(status: SupportStatus | null) {
  return useQuery({
    queryKey: supportKeys.platform(status),
    queryFn: () => listPlatformSupportTickets(status),
    refetchInterval: 60_000,
  });
}

export function usePlatformSupportCounts(enabled = true) {
  return useQuery({
    queryKey: supportKeys.counts,
    queryFn: getPlatformSupportCounts,
    enabled,
    refetchInterval: 120_000,
    retry: false,
  });
}

export function useSupportTicket(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: supportKeys.ticket(id ?? ""),
    queryFn: async () => {
      const t = await getSupportTicket(id ?? "");
      // Abrir marca como lido: atualiza os contadores.
      void qc.invalidateQueries({ queryKey: supportKeys.unread });
      void qc.invalidateQueries({ queryKey: supportKeys.counts });
      return t;
    },
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useSupportAttachmentUrl(path: string | null) {
  return useQuery({
    queryKey: supportKeys.attachment(path ?? ""),
    queryFn: () => supportAttachmentUrl(path ?? ""),
    enabled: Boolean(path),
    staleTime: 20 * 60_000,
  });
}

export function useOpenSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: openSupportTicket,
    onSuccess: () => void qc.invalidateQueries({ queryKey: supportKeys.all }),
  });
}

export function useReplySupportTicket(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string; image: File | null }) => replySupportTicket(ticketId, v.body, v.image),
    onSuccess: () => void qc.invalidateQueries({ queryKey: supportKeys.all }),
  });
}

export function useSetSupportStatus(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: SupportStatus) => setSupportStatus(ticketId, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: supportKeys.all }),
  });
}
