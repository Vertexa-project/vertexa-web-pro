import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  approveClinicCreationRequest,
  getPlatformClinicOnboardingSettings,
  listClinicCreationRequests,
  rejectClinicCreationRequest,
  setClinicOnboardingPolicy,
} from "@/lib/api/platformAdmin";
import type { ClinicOnboardingMode } from "@/lib/domain/clinicOnboarding";
import { qk } from "@/lib/queryKeys";

export function usePlatformOnboardingSettings(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformOnboardingSettings,
    queryFn: getPlatformClinicOnboardingSettings,
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function usePlatformClinicRequests(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformClinicRequests,
    queryFn: listClinicCreationRequests,
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function useSetClinicOnboardingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: ClinicOnboardingMode) => setClinicOnboardingPolicy(mode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformOnboardingSettings });
    },
  });
}

export function useApproveClinicCreationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => approveClinicCreationRequest(requestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformClinicRequests });
      void qc.invalidateQueries({ queryKey: qk.platformOnboardingSettings });
    },
  });
}

export function useRejectClinicCreationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason?: string }) =>
      rejectClinicCreationRequest(requestId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformClinicRequests });
      void qc.invalidateQueries({ queryKey: qk.platformOnboardingSettings });
    },
  });
}
