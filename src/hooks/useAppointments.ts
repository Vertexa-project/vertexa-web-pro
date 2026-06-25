import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, startOfDay } from "date-fns";

import {
  createAppointment,
  deleteAppointment,
  listAppointments,
  updateAppointment,
  type AppointmentInput,
} from "@/lib/api/appointments";
import { qk } from "@/lib/queryKeys";

export type AgendaScope = "today" | "week";

/** Janela [from, to) para o escopo: hoje = 1 dia; semana = próximos 7 dias (a partir de hoje). */
function rangeFor(scope: AgendaScope): { from: string; to: string } {
  const start = startOfDay(new Date());
  return { from: start.toISOString(), to: addDays(start, scope === "today" ? 1 : 7).toISOString() };
}

/** Compromissos da clínica para o escopo (hoje/semana). Escopado por clinic_id (isolamento). */
export function useAppointments(clinicId: string | null | undefined, scope: AgendaScope) {
  return useQuery({
    queryKey: qk.appointments(clinicId ?? "none", scope),
    queryFn: () => {
      const { from, to } = rangeFor(scope);
      return listAppointments(clinicId as string, from, to);
    },
    enabled: Boolean(clinicId),
  });
}

// Mutações invalidam TODA a agenda da clínica (hoje + semana) pelo prefixo da chave.
function invalidateClinicAgenda(clinicId: string) {
  return ["appointments", clinicId] as const;
}

export function useCreateAppointment(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AppointmentInput) => createAppointment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: invalidateClinicAgenda(clinicId) }),
  });
}

export function useUpdateAppointment(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: AppointmentInput }) => updateAppointment(vars.id, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: invalidateClinicAgenda(clinicId) }),
  });
}

export function useDeleteAppointment(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAppointment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: invalidateClinicAgenda(clinicId) }),
  });
}
