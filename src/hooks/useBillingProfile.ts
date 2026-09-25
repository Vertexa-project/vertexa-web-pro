import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyClinicBillingIdentity,
  upsertMyClinicBillingIdentity,
} from "@/lib/api/billingProfile";
import { qk } from "@/lib/queryKeys";

export function useClinicBillingIdentity(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicBillingIdentity(clinicId ?? "none"),
    queryFn: () => getMyClinicBillingIdentity(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 30_000,
  });
}

export function useUpsertClinicBillingIdentity(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      legalName: string;
      taxId: string;
      email: string;
      mobilePhone: string | null;
      billingAddress: string;
      billingAddressNumber: string;
    }) => {
      if (!clinicId) throw new Error("BILLING_CLINIC_REQUIRED");
      return upsertMyClinicBillingIdentity({ clinicId, ...input });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicBillingIdentity(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: qk.clinicCommercialCheckout(clinicId ?? "none") });
    },
  });
}
