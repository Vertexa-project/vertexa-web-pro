import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyClinicCommercialAccess,
  grantPlatformCommercialAccessExemption,
  listPlatformCommercialAccess,
  revokePlatformCommercialAccessExemption,
  setPlatformCommercialAccessMode,
  setPlatformProviderWriteMode,
} from "@/lib/api/commercialAccess";
import { qk } from "@/lib/queryKeys";

export function useMyClinicCommercialAccess(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicCommercialAccess(clinicId ?? "none"),
    queryFn: () => getMyClinicCommercialAccess(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function usePlatformCommercialAccess(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformCommercialAccess,
    queryFn: listPlatformCommercialAccess,
    enabled,
    staleTime: 15_000,
  });
}

function useAccessMutation<T>(fn: (args: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.platformCommercialAccess });
      qc.invalidateQueries({ queryKey: ["billingCommercialAccess"] });
    },
  });
}

export function useSetCommercialAccessMode() {
  return useAccessMutation((mode: "observe" | "enforce") => setPlatformCommercialAccessMode(mode));
}

export function useGrantCommercialExemption() {
  return useAccessMutation((input: { clinicId: string; reason: string; expiresAt?: string | null }) =>
    grantPlatformCommercialAccessExemption(input),
  );
}

export function useRevokeCommercialExemption() {
  return useAccessMutation((exemptionId: string) => revokePlatformCommercialAccessExemption(exemptionId));
}

export function useSetProviderWriteMode() {
  return useAccessMutation((mode: "locked" | "canary" | "open") => setPlatformProviderWriteMode(mode));
}
