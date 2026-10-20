import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createBodyAssessment,
  deleteBodyAssessment,
  updateBodyAssessment,
  type SaveAssessmentInput,
  getBodyAssessments,
  getPatientDocuments,
  getProgressPhotosWithUrls,
  setProgressPhotoPose,
  uploadProgressPhotoForPatient,
  type UploadPatientPhotoInput,
} from "@/lib/api/assessments";
import type { PhotoPose } from "@/lib/domain/photoPose";
import { getWeightSeries } from "@/lib/api/weight";
import { qk } from "@/lib/queryKeys";

export const useBodyAssessments = (patientId: string) =>
  useQuery({
    queryKey: qk.bodyAssessments(patientId),
    queryFn: () => getBodyAssessments(patientId),
    enabled: Boolean(patientId),
  });

/** Documentos (avaliações com arquivo anexado) do paciente. */
export const usePatientDocuments = (patientId: string) =>
  useQuery({
    queryKey: qk.patientDocuments(patientId),
    queryFn: () => getPatientDocuments(patientId),
    enabled: Boolean(patientId),
  });

/** Série unificada de peso (avaliações clínicas + registros do app) para o gráfico. */
export const useWeightSeries = (patientId: string) =>
  useQuery({
    queryKey: qk.weightSeries(patientId),
    queryFn: () => getWeightSeries(patientId),
    enabled: Boolean(patientId),
  });

export const useProgressPhotos = (patientId: string) =>
  useQuery({
    queryKey: qk.progressPhotos(patientId),
    queryFn: () => getProgressPhotosWithUrls(patientId),
    enabled: Boolean(patientId),
  });

/** Envio de foto pelo profissional (inclusive retroativa). Recarrega a galeria ao concluir. */
export const useUploadProgressPhoto = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UploadPatientPhotoInput, "patientId">) => uploadProgressPhotoForPatient({ ...input, patientId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.progressPhotos(patientId) }),
  });
};

/** Classifica a posição de uma foto já existente. */
export const useSetProgressPhotoPose = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { photoId: string; pose: PhotoPose | null }) => setProgressPhotoPose(v.photoId, v.pose),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.progressPhotos(patientId) }),
  });
};

const invalidateBody = (qc: ReturnType<typeof useQueryClient>, patientId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: qk.bodyAssessments(patientId) }),
    qc.invalidateQueries({ queryKey: qk.weightSeries(patientId) }),
  ]);

/** Cria avaliação (inclusive antiga). Recarrega a lista e o gráfico de peso. */
export const useCreateAssessment = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveAssessmentInput, "patientId">) => createBodyAssessment({ ...input, patientId }),
    onSuccess: () => invalidateBody(qc, patientId),
  });
};

export const useUpdateAssessment = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; payload: Parameters<typeof updateBodyAssessment>[1] }) => updateBodyAssessment(v.id, v.payload),
    onSuccess: () => invalidateBody(qc, patientId),
  });
};

export const useDeleteAssessment = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBodyAssessment(id),
    onSuccess: () => invalidateBody(qc, patientId),
  });
};
