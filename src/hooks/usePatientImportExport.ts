import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  exportPatients,
  getImportDedupeKeys,
  getPatientImportOrigin,
  importPatients,
  listPatientExports,
} from "@/lib/api/patientImportExport";
import type { ExportGroup, ExportReasonKind } from "@/lib/domain/patientExport";
import type { ImportRpcRow } from "@/lib/domain/patientImport";
import { qk } from "@/lib/queryKeys";

/** Chaves de duplicado da clínica (só o admin; carrega com o diálogo aberto). */
export const useImportDedupeKeys = (clinicId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: qk.patientImportKeys(clinicId),
    queryFn: () => getImportDedupeKeys(clinicId as string),
    enabled: enabled && Boolean(clinicId),
    staleTime: 0,
    gcTime: 0,
  });

export const useImportPatients = (clinicId: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { filename: string; rows: ImportRpcRow[] }) => importPatients(clinicId as string, v.filename, v.rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.patients });
    },
  });
};

export const useExportPatients = (clinicId: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groups: ExportGroup[]; kind: ExportReasonKind; reason: string }) =>
      exportPatients(clinicId as string, v.groups, v.kind, v.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.patientExports(clinicId) });
    },
  });
};

export const usePatientExports = (clinicId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: qk.patientExports(clinicId),
    queryFn: () => listPatientExports(clinicId as string),
    enabled: enabled && Boolean(clinicId),
  });

export const usePatientImportOrigin = (patientId: string) =>
  useQuery({
    queryKey: qk.patientImportOrigin(patientId),
    queryFn: () => getPatientImportOrigin(patientId),
    enabled: Boolean(patientId),
  });
