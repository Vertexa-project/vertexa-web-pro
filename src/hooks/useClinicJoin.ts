import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  approveJoinRequest,
  countPendingJoinRequests,
  listMyJoinRequests,
  listPendingJoinRequests,
  rejectJoinRequest,
  requestClinicAccess,
  rotateClinicJoinCode,
} from "@/lib/api/clinicJoin";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/providers/auth-context";

/**
 * Pedidos de acesso DO USUÁRIO LOGADO (WP-JOIN-1). Alimenta o estado "aguardando aprovação" na
 * tela de acesso pendente. Só consulta com sessão real (a RLS resolve o remetente).
 */
export function useMyJoinRequests() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.myJoinRequests,
    queryFn: listMyJoinRequests,
    enabled: Boolean(session),
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

/** Fila de pedidos pendentes da clínica — tela de Equipe (admin). */
export function usePendingJoinRequests(clinicId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.pendingJoinRequestList(clinicId ?? "none"),
    queryFn: () => listPendingJoinRequests(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 30_000,
  });
}

/**
 * Invalidação compartilhada por Aprovar/Rejeitar: a fila, o badge de contagem e — no caso da
 * aprovação — a EQUIPE e as disciplinas, porque o aprovado acabou de virar professional e
 * precisa aparecer na lista para receber disciplina.
 */
function useAfterDecision(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.pendingJoinRequestList(clinicId ?? "none") });
    qc.invalidateQueries({ queryKey: qk.pendingJoinRequests(clinicId ?? "none") });
    qc.invalidateQueries({ queryKey: qk.clinicDisciplines(clinicId ?? "none") });
  };
}

/** Aprova o pedido (RPC existente: chama promote_to_professional). */
export function useApproveJoinRequest(clinicId: string | null | undefined) {
  const after = useAfterDecision(clinicId);
  return useMutation({ mutationFn: (requestId: string) => approveJoinRequest(requestId), onSuccess: after });
}

/** Rejeita o pedido (RPC existente). */
export function useRejectJoinRequest(clinicId: string | null | undefined) {
  const after = useAfterDecision(clinicId);
  return useMutation({ mutationFn: (requestId: string) => rejectJoinRequest(requestId), onSuccess: after });
}

/** Contagem de pedidos pendentes da clínica — indicador (badge) fora da tela de Equipe. */
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
