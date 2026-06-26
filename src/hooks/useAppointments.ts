import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

/**
 * Sessão 12: a busca é RANGE-DRIVEN — a janela [from, to) (ISO) vem da faixa visível do
 * FullCalendar (callback datesSet). As queries só rodam quando há clínica + faixa definida.
 */

/** Compromissos da clínica na janela [from, to). Escopado por clinic_id (isolamento). */
export function useAppointments(
  clinicId: string | null | undefined,
  fromISO: string | null,
  toISO: string | null,
) {
  return useQuery({
    queryKey: qk.appointments(clinicId ?? "none", fromISO ?? "none", toISO ?? "none"),
    queryFn: () => listAppointments(clinicId as string, fromISO as string, toISO as string),
    enabled: Boolean(clinicId && fromISO && toISO),
    // Faixa muda a cada navegação/troca de view (re-chaveia a query). Manter os eventos da janela
    // anterior visíveis durante o fetch evita que o calendário pisque vazio (Sessão 12 / revisão).
    placeholderData: keepPreviousData,
  });
}

/** Eventos do Google espelhados no cache, na MESMA janela da agenda interna. Read-only. */
export function useCalendarEvents(
  clinicId: string | null | undefined,
  fromISO: string | null,
  toISO: string | null,
) {
  return useQuery({
    queryKey: qk.calendarEvents(clinicId ?? "none", fromISO ?? "none", toISO ?? "none"),
    queryFn: () => listCalendarEvents(clinicId as string, fromISO as string, toISO as string),
    enabled: Boolean(clinicId && fromISO && toISO),
    placeholderData: keepPreviousData,
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
    appointmentType: a.type,
    appointmentStatus: a.status,
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
    googleEventStatus: e.status,
  }));
  // Mesma ordenação por início que a api da agenda interna já garante (.order('starts_at')).
  return [...internal, ...google].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * Agenda MESCLADA (Sessão 10): compromissos internos (CRUD da S6) + eventos do Google (read-only),
 * discriminados por `source`. O CRUD interno segue intacto; o Google nunca é editado/excluído.
 * isError reflete só a fonte interna (núcleo) — se o cache do Google falhar, ainda mostramos a interna.
 */
export function useAgenda(
  clinicId: string | null | undefined,
  fromISO: string | null,
  toISO: string | null,
) {
  const appts = useAppointments(clinicId, fromISO, toISO);
  const events = useCalendarEvents(clinicId, fromISO, toISO);

  const items = useMemo(
    () => mergeAgenda(appts.data ?? [], events.data ?? []),
    [appts.data, events.data],
  );

  return {
    items,
    isLoading: appts.isLoading || events.isLoading,
    // Atualizando = buscando uma faixa nova (com dados anteriores ainda visíveis via keepPreviousData).
    isFetching: appts.isFetching || events.isFetching,
    isError: appts.isError, // a fonte interna é o núcleo; erro do Google não derruba a agenda
    googleError: events.isError,
    refetch: () => {
      void appts.refetch();
      void events.refetch();
    },
  };
}

// Mutações invalidam TODA a agenda da clínica (todas as faixas) pelo prefixo da chave.
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
