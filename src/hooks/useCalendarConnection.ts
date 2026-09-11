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

/** Status (metadado) da conexão Google do PRÓPRIO profissional. */
export function useCalendarConnection(
  clinicId: string | null | undefined,
  professionalId: string | null | undefined,
) {
  return useQuery({
    queryKey: qk.calendarConnection(clinicId ?? "none", professionalId ?? "none"),
    queryFn: () => getCalendarConnection(clinicId as string, professionalId as string),
    enabled: Boolean(clinicId && professionalId),
  });
}

function invalidateCalendar(
  qc: ReturnType<typeof useQueryClient>,
  clinicId: string,
  professionalId: string,
) {
  qc.invalidateQueries({ queryKey: qk.calendarConnection(clinicId, professionalId) });
  qc.invalidateQueries({ queryKey: ["calendarEvents", clinicId, professionalId] });
}

export function useConnectGoogleCalendar() {
  return useMutation({
    mutationFn: (input: StartConnectInput) => startGoogleCalendarConnect(input),
  });
}

export function useSyncGoogleCalendar(clinicId: string, professionalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarTargetInput) => syncGoogleCalendar(input),
    onSuccess: () => invalidateCalendar(qc, clinicId, professionalId),
  });
}

export function useDisconnectGoogleCalendar(clinicId: string, professionalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarTargetInput) => disconnectGoogleCalendar(input),
    onSuccess: () => invalidateCalendar(qc, clinicId, professionalId),
  });
}
