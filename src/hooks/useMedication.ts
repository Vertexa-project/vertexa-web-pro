import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  adjustDose, endTreatment, getMedication, getMedSettings, listStockOptions, recordApplication, recordDelivery, removeEntry, saveTreatment, setMedSettings,
} from "@/lib/api/medication";

const key = (patientId: string) => ["patient", patientId, "medication"] as const;

export const useMedication = (patientId: string) => useQuery({ queryKey: key(patientId), queryFn: () => getMedication(patientId), enabled: Boolean(patientId) });
export const useMedStockOptions = (patientId: string, enabled: boolean) =>
  useQuery({ queryKey: [...key(patientId), "stock"], queryFn: () => listStockOptions(patientId), enabled, staleTime: 15_000 });

/** Qualquer escrita refaz a ficha de medicação e o painel "atrasadas". */
function useDone(patientId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: key(patientId) });
}
export function useMedMutations(patientId: string) {
  const done = useDone(patientId);
  const o = { onSuccess: done };
  return {
    save: useMutation({ mutationFn: saveTreatment, ...o }),
    adjust: useMutation({ mutationFn: adjustDose, ...o }),
    end: useMutation({ mutationFn: endTreatment, ...o }),
    apply: useMutation({ mutationFn: recordApplication, ...o }),
    deliver: useMutation({ mutationFn: recordDelivery, ...o }),
    remove: useMutation({ mutationFn: (v: { kind: "application" | "delivery"; id: string }) => removeEntry(v.kind, v.id), ...o }),
  };
}

export const useMedSettings = (clinicId: string | null) =>
  useQuery({ queryKey: ["clinic", clinicId, "medSettings"], queryFn: () => getMedSettings(clinicId as string), enabled: Boolean(clinicId) });
export function useSetMedSettings(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (enabled: boolean) => setMedSettings(clinicId as string, enabled), onSuccess: () => qc.invalidateQueries({ queryKey: ["clinic", clinicId, "medSettings"] }) });
}
