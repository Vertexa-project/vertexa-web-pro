// Hooks dos documentos clínicos (Entrega 9): react-query sobre src/lib/api/clinicalDocs.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useFinContext } from "@/hooks/useFin";
import * as api from "@/lib/api/clinicalDocs";

const K = ["docs"] as const;

export function useDocAccess(clinicId: string | null) {
  const q = useQuery({ queryKey: [...K, "access", clinicId], queryFn: () => api.getDocAccess(clinicId as string), enabled: Boolean(clinicId), staleTime: 60_000 });
  // fail-closed: carregando ou erro = sem acesso
  return { access: q.data ?? api.NO_DOC_ACCESS, isLoading: q.isLoading };
}
/** Clínica do usuário + acesso a documentos. */
export function useDocContext() {
  const { clinicId } = useFinContext();
  const { access, isLoading } = useDocAccess(clinicId);
  return { clinicId, access, isLoading };
}
export const useDocuments = (clinicId: string | null, f: api.DocListFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "list", clinicId, f], queryFn: () => api.listDocuments(clinicId as string, f), enabled: Boolean(clinicId) && enabled });
export const usePrescribedItems = (clinicId: string | null, patientId: string | null, f: { encounterId?: string | null; appointmentId?: string | null }, enabled = true) =>
  useQuery({ queryKey: [...K, "items", clinicId, patientId, f], queryFn: () => api.listPrescribedItems(clinicId as string, patientId as string, f), enabled: Boolean(clinicId && patientId) && enabled });

export function useDocMutations() {
  const qc = useQueryClient();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: K });
    await qc.invalidateQueries({ queryKey: ["patient"] }); // timeline do paciente
  };
  return {
    resend: useMutation({ mutationFn: (id: string) => api.resendDocument(id), onSuccess: refresh }),
    invalidate: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.invalidateDocument(v.id, v.reason), onSuccess: refresh }),
    refresh,
  };
}
