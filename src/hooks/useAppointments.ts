import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, startOfDay } from "date-fns";

import {
  createAppointment,
  deleteAppointment,
  listAppointments,
  updateAppointment,
  type AppointmentInput,
} from "@/lib/api/appointments";
import { listCalendarEvents } from "@/lib/api/calendar";
import { qk } from "@/lib/queryKeys";
import type { AgendaItem, AppointmentView, CalendarEventCache } from "@/types/db";

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

/** Eventos do Google espelhados no cache, na MESMA janela da agenda interna. Read-only. */
export function useCalendarEvents(clinicId: string | null | undefined, scope: AgendaScope) {
  return useQuery({
    queryKey: qk.calendarEvents(clinicId ?? "none", scope),
    queryFn: () => {
      const { from, to } = rangeFor(scope);
      return listCalendarEvents(clinicId as string, from, to);
    },
    enabled: Boolean(clinicId),
  });
}

function mergeAgenda(appts: AppointmentView[], events: CalendarEventCache[]): AgendaItem[] {
  const internal: AgendaItem[] = appts.map((a) => ({
    id: `internal:${a.id}`,
    source: "internal",
    title: a.title,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    all_day: false,
    patient_name: a.patient_name,
    professional_name: a.professional_name,
    appointment: a,
  }));
  const google: AgendaItem[] = events.map((e) => ({
    id: `google:${e.id}`,
    source: "google",
    title: e.title ?? "(sem título)",
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    all_day: e.all_day,
    patient_name: null,
    professional_name: null,
  }));
  // Mesma ordenação por início que a api da agenda interna já garante (.order('starts_at')).
  return [...internal, ...google].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * Agenda MESCLADA (Sessão 10): compromissos internos (CRUD da S6) + eventos do Google (read-only),
 * discriminados por `source`. O CRUD interno segue intacto; o Google nunca é editado/excluído.
 * isError reflete só a fonte interna (núcleo) — se o cache do Google falhar, ainda mostramos a interna.
 */
export function useAgenda(clinicId: string | null | undefined, scope: AgendaScope) {
  const appts = useAppointments(clinicId, scope);
  const events = useCalendarEvents(clinicId, scope);

  const items = useMemo(
    () => mergeAgenda(appts.data ?? [], events.data ?? []),
    [appts.data, events.data],
  );

  return {
    items,
    isLoading: appts.isLoading || events.isLoading,
    isError: appts.isError, // a fonte interna é o núcleo; erro do Google não derruba a agenda
    googleError: events.isError,
    refetch: () => {
      void appts.refetch();
      void events.refetch();
    },
  };
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
