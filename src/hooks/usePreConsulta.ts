import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getDocumentSignedUrl } from "@/lib/api/documents";
import {
  cancelPreConsulta, getPreConsultaSettings, listPreConsultaFiles, listPreConsultas, savePreConsultaSettings, sendPreConsulta,
} from "@/lib/api/preConsulta";
import type { PreConsultaQuestion } from "@/lib/domain/preConsulta";

const keys = {
  list: (patientId: string) => ["patient", patientId, "preConsultas"] as const,
  files: (id: string) => ["preConsulta", id, "files"] as const,
  settings: (clinicId: string) => ["preConsulta", "settings", clinicId] as const,
};

export const usePreConsultas = (patientId: string) =>
  useQuery({ queryKey: keys.list(patientId), queryFn: () => listPreConsultas(patientId), enabled: Boolean(patientId) });

export const usePreConsultaFiles = (id: string | null) =>
  useQuery({ queryKey: keys.files(id ?? "none"), queryFn: () => listPreConsultaFiles(id as string), enabled: Boolean(id) });

export function useSendPreConsulta(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendPreConsulta(patientId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.list(patientId) }),
  });
}

export function useCancelPreConsulta(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelPreConsulta(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.list(patientId) }),
  });
}

export const useOpenPreConsultaFile = () => useMutation({ mutationFn: (path: string) => getDocumentSignedUrl(path) });

export const usePreConsultaSettings = (clinicId: string | null) =>
  useQuery({ queryKey: keys.settings(clinicId ?? "none"), queryFn: () => getPreConsultaSettings(clinicId as string), enabled: Boolean(clinicId) });

export function useSavePreConsultaSettings(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { autoSend: boolean; questions: PreConsultaQuestion[] | null }) => savePreConsultaSettings(clinicId as string, v.autoSend, v.questions),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings(clinicId ?? "none") }),
  });
}
