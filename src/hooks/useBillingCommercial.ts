import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  admitPlatformFounderClinic,
  closePlatformFounderCampaign,
  getMyClinicCommercialUsage,
  getPlatformClinicCommercialDetail,
  getPlatformCommercialGovernance,
  listPlatformCommercialPlanOptions,
  markPlatformFounderClinicCancelled,
  restorePlatformFounderClinicEligibility,
  setPlatformClinicAdditionalCapacity,
} from "@/lib/api/billingCommercial";
import { qk } from "@/lib/queryKeys";

export function useClinicCommercialUsage(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicCommercialUsage(clinicId ?? "none"),
    queryFn: () => getMyClinicCommercialUsage(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function usePlatformCommercialGovernance(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformBillingCommercial,
    queryFn: getPlatformCommercialGovernance,
    enabled,
    staleTime: 15_000,
  });
}

export function usePlatformClinicCommercialDetail(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.platformClinicCommercialDetail(clinicId ?? "none"),
    queryFn: () => getPlatformClinicCommercialDetail(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function usePlatformCommercialPlanOptions(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformCommercialPlanOptions,
    queryFn: listPlatformCommercialPlanOptions,
    enabled,
    staleTime: 60_000,
  });
}

function useCommercialMutation<TArgs>(fn: (args: TArgs) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.platformBillingCommercial });
      qc.invalidateQueries({ queryKey: ["platform", "billing"] });
    },
  });
}

export function useAdmitPlatformFounder() {
  return useCommercialMutation((input: { clinicId: string; planCode: string }) =>
    admitPlatformFounderClinic(input.clinicId, input.planCode),
  );
}

export function useClosePlatformFounderCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => closePlatformFounderCampaign(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.platformBillingCommercial });
      qc.invalidateQueries({ queryKey: ["platform", "billing"] });
    },
  });
}

export function useCancelPlatformFounder() {
  return useCommercialMutation((clinicId: string) => markPlatformFounderClinicCancelled(clinicId));
}

export function useRestorePlatformFounder() {
  return useCommercialMutation((clinicId: string) => restorePlatformFounderClinicEligibility(clinicId));
}

export function useSetPlatformAdditionalCapacity() {
  return useCommercialMutation(
    (input: { clinicId: string; additionalProfessionals: number; additionalPatients: number }) =>
      setPlatformClinicAdditionalCapacity(input),
  );
}
