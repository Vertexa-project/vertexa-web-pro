import { useQuery } from "@tanstack/react-query";

import { getHydrationDailyLiters, getHydrationTodayLiters } from "@/lib/api/hydration";
import { qk } from "@/lib/queryKeys";

/** Total de água (litros) registrado hoje pelo paciente no app. */
export const useHydrationToday = (patientId: string) =>
  useQuery({
    queryKey: qk.hydrationToday(patientId),
    queryFn: () => getHydrationTodayLiters(patientId),
    enabled: Boolean(patientId),
  });

/** Litros de água por dia nos últimos `days` dias completos (sinais de risco). */
export const useHydrationDaily = (patientId: string, days = 7) =>
  useQuery({
    queryKey: qk.hydrationDaily(patientId, days),
    queryFn: () => getHydrationDailyLiters(patientId, days),
    enabled: Boolean(patientId),
  });
