import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listDeliveries, revokeDelivery, savePdfAndSend, sendDocumentToPatient, type SendPdfInput } from "@/lib/api/deliveries";
import type { DeliveryKind } from "@/lib/domain/deliveries";
import { qk } from "@/lib/queryKeys";

export const useDeliveries = (patientId: string) =>
  useQuery({ queryKey: qk.patientDeliveries(patientId), queryFn: () => listDeliveries(patientId), enabled: Boolean(patientId) });

function useRefresh(patientId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.patientDeliveries(patientId) });
    qc.invalidateQueries({ queryKey: qk.patientExams(patientId) });
  };
}

export function useSendPdf(patientId: string) {
  const done = useRefresh(patientId);
  return useMutation({ mutationFn: (i: SendPdfInput) => savePdfAndSend(i), onSuccess: done, onError: done });
}
export function useSendDocument(patientId: string) {
  const done = useRefresh(patientId);
  return useMutation({ mutationFn: (v: { documentId: string; kind: DeliveryKind; title?: string | null }) => sendDocumentToPatient(v.documentId, v.kind, v.title), onSuccess: done });
}
export function useRevokeDelivery(patientId: string) {
  const done = useRefresh(patientId);
  return useMutation({ mutationFn: (id: string) => revokeDelivery(id), onSuccess: done });
}
