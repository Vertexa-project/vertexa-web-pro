import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listPlatformClinicPixAutomaticStatuses,
  listPlatformClinics,
  reactivatePlatformClinic,
  reissuePixAutomaticAuthorization,
  suspendPlatformClinic,
} from "@/lib/api/platformAdmin";
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

export function useSuspendPlatformClinic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clinicId, reason }: { clinicId: string; reason: string }) =>
      suspendPlatformClinic(clinicId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformClinics });
    },
  });
}

export function useReactivatePlatformClinic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clinicId, reason }: { clinicId: string; reason?: string | null }) =>
      reactivatePlatformClinic(clinicId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformClinics });
    },
  });
}

export function usePlatformClinicPixStatuses(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformClinicPixStatuses,
    queryFn: listPlatformClinicPixAutomaticStatuses,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useReissuePixAutomaticAuthorization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      clinicId: string;
      commercialContractId: string;
      authorizationId: string;
      reason?: string;
    }) => reissuePixAutomaticAuthorization(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformClinicPixStatuses });
    },
  });
}
