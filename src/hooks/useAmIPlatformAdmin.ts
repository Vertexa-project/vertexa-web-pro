import { useQuery } from "@tanstack/react-query";

import { amIPlatformAdmin } from "@/lib/api/platformAdmin";
import { qk } from "@/lib/queryKeys";

export interface PlatformAdminSignal {
  /**
   * `true` / `false` só quando a RPC respondeu. `undefined` em loading OU erro —
   * o caller NÃO pode tratar `undefined` como false.
   */
  isPlatformAdmin: boolean | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Sinal de Platform Admin pela RPC pública `am_i_platform_admin`.
 * Erro permanece distinguível de `false` (não replica o fail-closed-as-false do clinic admin).
 */
export function useAmIPlatformAdmin(enabled = true): PlatformAdminSignal {
  const query = useQuery({
    queryKey: qk.platformAccess,
    queryFn: amIPlatformAdmin,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    isPlatformAdmin: query.isError ? undefined : query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
