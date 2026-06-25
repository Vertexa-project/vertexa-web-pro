import { useQuery } from "@tanstack/react-query";

import { getHydrationTodayLiters } from "@/lib/api/hydration";
import { qk } from "@/lib/queryKeys";

/** Total de água (litros) registrado hoje pelo paciente no app. */
export const useHydrationToday = (patientId: string) =>
  useQuery({
    queryKey: qk.hydrationToday(patientId),
    queryFn: () => getHydrationTodayLiters(patientId),
    enabled: Boolean(patientId),
  });
