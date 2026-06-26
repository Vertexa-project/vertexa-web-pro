import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  disconnectGoogleCalendar,
  getCalendarConnection,
  startGoogleCalendarConnect,
  syncGoogleCalendar,
  type CalendarTargetInput,
  type StartConnectInput,
} from "@/lib/api/calendar";
import { qk } from "@/lib/queryKeys";

/** Status (metadado) da conexão Google da clínica. Escopado por clinic_id (isolamento). */
export function useCalendarConnection(clinicId: string | null | undefined) {
  return useQuery({
    queryKey: qk.calendarConnection(clinicId ?? "none"),
    queryFn: () => getCalendarConnection(clinicId as string),
    enabled: Boolean(clinicId),
  });
}

// Connect/sync/disconnect invalidam o status da conexão E o cache de eventos (prefixo) da clínica.
function invalidateCalendar(qc: ReturnType<typeof useQueryClient>, clinicId: string) {
  qc.invalidateQueries({ queryKey: qk.calendarConnection(clinicId) });
  qc.invalidateQueries({ queryKey: ["calendarEvents", clinicId] });
}

/** Inicia o OAuth. Devolve a URL de consentimento — o componente faz o redirect do navegador. */
export function useConnectGoogleCalendar() {
  return useMutation({
    mutationFn: (input: StartConnectInput) => startGoogleCalendarConnect(input),
  });
}

export function useSyncGoogleCalendar(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarTargetInput) => syncGoogleCalendar(input),
    onSuccess: () => invalidateCalendar(qc, clinicId),
  });
}

export function useDisconnectGoogleCalendar(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarTargetInput) => disconnectGoogleCalendar(input),
    onSuccess: () => invalidateCalendar(qc, clinicId),
  });
}
