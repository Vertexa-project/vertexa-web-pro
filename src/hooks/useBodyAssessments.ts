import { useQuery } from "@tanstack/react-query";

import { getBodyAssessments, getProgressPhotos } from "@/lib/api/assessments";
import { getWeightSeries } from "@/lib/api/weight";
import { qk } from "@/lib/queryKeys";

export const useBodyAssessments = (patientId: string) =>
  useQuery({
    queryKey: qk.bodyAssessments(patientId),
    queryFn: () => getBodyAssessments(patientId),
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
    queryFn: () => getProgressPhotos(patientId),
    enabled: Boolean(patientId),
  });
