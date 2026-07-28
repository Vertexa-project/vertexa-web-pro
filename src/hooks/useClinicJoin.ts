import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  countPendingJoinRequests,
  listMyJoinRequests,
  requestClinicAccess,
  rotateClinicJoinCode,
} from "@/lib/api/clinicJoin";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/providers/auth-context";

/**
 * Pedidos de acesso DO USUÁRIO LOGADO (WP-JOIN-1). Alimenta o estado "aguardando aprovação" na
 * tela de acesso pendente. Desabilitado em modo demo (não há sessão real para a RLS resolver).
 */
export function useMyJoinRequests() {
  const { demoMode, session } = useAuth();
  return useQuery({
    queryKey: qk.myJoinRequests,
    queryFn: listMyJoinRequests,
    enabled: !demoMode && Boolean(session),
    staleTime: 30_000,
  });
}

/** Envia a solicitação de acesso pelo código e reabre a consulta dos próprios pedidos. */
export function useRequestClinicAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (joinCode: string) => requestClinicAccess(joinCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.myJoinRequests });
    },
  });
}

/** Contagem de pedidos pendentes da clínica — indicador do admin (a lista é o WP-2). */
export function usePendingJoinRequestCount(clinicId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.pendingJoinRequests(clinicId ?? "none"),
    queryFn: () => countPendingJoinRequests(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 60_000,
  });
}

/**
 * Gera um novo código de acesso da clínica. Invalida a consulta da clínica para a tela refletir
 * o código novo — a `useClinic` tem staleTime Infinity, então sem isto o admin continuaria vendo
 * (e compartilhando) o código antigo, que a rotação acabou de invalidar.
 */
export function useRotateClinicJoinCode(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rotateClinicJoinCode(clinicId as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinic(clinicId ?? "none") });
    },
  });
}
