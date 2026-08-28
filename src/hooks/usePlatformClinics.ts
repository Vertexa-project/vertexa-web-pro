import { useQuery } from "@tanstack/react-query";

import { listPlatformClinics } from "@/lib/api/platformAdmin";
import { qk } from "@/lib/queryKeys";

/**
 * Catálogo global. Só dispara depois do guard confirmar autoridade (`enabled`).
 * Sem fallback para patients/chat/adherence.
 */
export function usePlatformClinics(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformClinics,
    queryFn: listPlatformClinics,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}
