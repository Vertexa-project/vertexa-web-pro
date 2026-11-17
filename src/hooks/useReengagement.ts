import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getPatientReengagementLine, getReengagementConfig, listReengagementHistory, listReengagementOverview, saveReengagementConfig,
} from "@/lib/api/reengagement";
import type { ReengagementConfig } from "@/lib/domain/reengagement";

const KEY = ["reengagement"] as const;

export const useReengagementConfig = (clinicId: string | null) =>
  useQuery({ queryKey: [...KEY, "config", clinicId], queryFn: () => getReengagementConfig(clinicId!), enabled: !!clinicId });
export const useReengagementOverview = (clinicId: string | null) =>
  useQuery({ queryKey: [...KEY, "overview", clinicId], queryFn: () => listReengagementOverview(clinicId!), enabled: !!clinicId });
export const useReengagementHistory = (clinicId: string | null) =>
  useQuery({ queryKey: [...KEY, "history", clinicId], queryFn: listReengagementHistory, enabled: !!clinicId });
export const usePatientReengagementLine = (patientId: string) =>
  useQuery({ queryKey: [...KEY, "line", patientId], queryFn: () => getPatientReengagementLine(patientId), staleTime: 60_000, retry: false });

export const useSaveReengagement = (clinicId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: ReengagementConfig) => saveReengagementConfig(clinicId, c),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
};
