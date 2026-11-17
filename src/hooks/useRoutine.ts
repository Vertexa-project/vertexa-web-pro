import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearPatientRoutineOverride, getClinicRoutineSettings, getPatientMission, getPatientRoutine, saveClinicRoutineSettings,
  savePatientRoutineOverride, startPatientMission, type RoutineOverrideInput,
} from "@/lib/api/routine";
import type { ClinicRoutineSettings } from "@/lib/domain/routine";

const keyClinic = (clinicId: string | null) => ["routine", "clinic", clinicId] as const;
const keyRoutine = (patientId: string) => ["routine", "patient", patientId] as const;
const keyMission = (patientId: string) => ["mission", "patient", patientId] as const;

export const useClinicRoutineSettings = (clinicId: string | null) =>
  useQuery({ queryKey: keyClinic(clinicId), queryFn: () => getClinicRoutineSettings(clinicId as string), enabled: Boolean(clinicId) });

export function useSaveClinicRoutine(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Partial<Omit<ClinicRoutineSettings, "clinic_id">>) => saveClinicRoutineSettings(clinicId as string, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["routine"] }); qc.invalidateQueries({ queryKey: ["mission"] }); },
  });
}

/** Rotina e missão são calculadas no banco; 1 consulta cada, em paralelo (sem N+1). */
export const usePatientRoutine = (patientId: string) =>
  useQuery({ queryKey: keyRoutine(patientId), queryFn: () => getPatientRoutine(patientId), enabled: Boolean(patientId), staleTime: 30_000 });
export const usePatientMission = (patientId: string) =>
  useQuery({ queryKey: keyMission(patientId), queryFn: () => getPatientMission(patientId), enabled: Boolean(patientId), staleTime: 30_000 });

export function useSaveRoutineOverride(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: RoutineOverrideInput | "clear") => (v === "clear" ? clearPatientRoutineOverride(patientId) : savePatientRoutineOverride(patientId, v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyRoutine(patientId) }),
  });
}

export function useStartMission(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restart: boolean) => startPatientMission(patientId, restart),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyMission(patientId) }),
  });
}
