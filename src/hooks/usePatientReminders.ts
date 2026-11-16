import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  completePatientReminder, deletePatientReminder, listOpenReminders, listPatientReminders, upsertPatientReminder,
  type UpsertReminderInput,
} from "@/lib/api/patientReminders";
import { qk } from "@/lib/queryKeys";

export const usePatientReminders = (patientId: string) =>
  useQuery({ queryKey: qk.patientReminders(patientId), queryFn: () => listPatientReminders(patientId), enabled: Boolean(patientId) });

/** Hoje do profissional: lembretes abertos da clínica (a RLS já limita aos pacientes que a pessoa acompanha). */
export const useOpenReminders = (enabled = true) =>
  useQuery({ queryKey: qk.clinicReminders, queryFn: () => listOpenReminders(), enabled, staleTime: 60_000 });

function useInvalidate(patientId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.patientReminders(patientId) });
    qc.invalidateQueries({ queryKey: qk.clinicReminders });
  };
}

export function useSaveReminder(patientId: string) {
  const done = useInvalidate(patientId);
  return useMutation({ mutationFn: (i: UpsertReminderInput) => upsertPatientReminder(i), onSuccess: done });
}
export function useDeleteReminder(patientId: string) {
  const done = useInvalidate(patientId);
  return useMutation({ mutationFn: (id: string) => deletePatientReminder(id), onSuccess: done });
}
export function useCompleteReminder(patientId: string) {
  const done = useInvalidate(patientId);
  return useMutation({ mutationFn: (v: { id: string; done: boolean }) => completePatientReminder(v.id, v.done), onSuccess: done });
}
