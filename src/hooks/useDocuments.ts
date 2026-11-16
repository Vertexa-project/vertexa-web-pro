import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listPatientDocuments,
  updatePatientDocumentKind,
  uploadPatientDocument,
  type UploadPatientDocumentInput,
} from "@/lib/api/documents";
import { qk } from "@/lib/queryKeys";

/**
 * Documentos/exames REAIS do paciente (tabela patient_documents), mais recentes primeiro.
 * queryKey `patientExams` (["patient", id, "exams"]) — NÃO colide com o `patientDocuments`
 * legado (["patient", id, "documents"]) dos laudos de body_assessments.
 */
export const usePatientExams = (patientId: string) =>
  useQuery({
    queryKey: qk.patientExams(patientId),
    queryFn: () => listPatientDocuments(patientId),
    enabled: Boolean(patientId),
  });

/** Upload de documento/exame pela web; invalida a lista de exames no sucesso. */
export const useUploadPatientDocument = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UploadPatientDocumentInput, "patientId">) =>
      uploadPatientDocument({ ...input, patientId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.patientExams(patientId) });
    },
  });
};

/** Troca o tipo de um documento enviado; recarrega a lista. */
export const useUpdateDocumentKind = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; kind: string }) => updatePatientDocumentKind(v.id, v.kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientExams(patientId) }),
  });
};
