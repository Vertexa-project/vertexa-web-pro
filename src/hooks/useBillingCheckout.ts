import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createMyClinicCommercialContract,
  getMyClinicCommercialCheckout,
  listSellableBillingPlans,
} from "@/lib/api/billingCheckout";
import { qk } from "@/lib/queryKeys";

export function useSellableBillingPlans(enabled: boolean) {
  return useQuery({
    queryKey: qk.sellableBillingPlans(),
    queryFn: listSellableBillingPlans,
    enabled,
    staleTime: 60_000,
  });
}

export function useClinicCommercialCheckout(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicCommercialCheckout(clinicId ?? "none"),
    queryFn: () => getMyClinicCommercialCheckout(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function useCreateClinicCommercialContract(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planVersionId: string) => {
      if (!clinicId) throw new Error("BILLING_CLINIC_REQUIRED");
      return createMyClinicCommercialContract({ clinicId, planVersionId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicCommercialCheckout(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicCommercialUsage(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicBillingIdentity(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicBillingOverview(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicBillingCharges(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicBillingPayments(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicBillingTimeline(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.sellableBillingPlans() });
      // Faixa "ainda não tem contrato" no topo do app lê o acesso comercial (cartão 1568).
      qc.invalidateQueries({ queryKey: qk.clinicCommercialAccess(clinicId ?? "none") });
    },
  });
}
