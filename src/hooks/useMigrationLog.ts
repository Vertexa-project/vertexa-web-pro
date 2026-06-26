import { useQuery } from "@tanstack/react-query";

import { listMigrationLog } from "@/lib/api/migrations";
import { qk } from "@/lib/queryKeys";

/** Ledger de migrations (seção admin em Configurações). Só busca quando habilitado (admin vendo). */
export const useMigrationLog = (enabled: boolean) =>
  useQuery({
    queryKey: qk.migrationLog,
    queryFn: listMigrationLog,
    enabled,
    staleTime: Infinity,
  });
