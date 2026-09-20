import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ensureMyClinicCustomerFromIdentity,
  executeMyClinicPixAutomaticAuthorization,
  prepareMyClinicPixAutomaticAuthorization,
  reissueMyClinicPixAutomaticAuthorization,
} from "@/lib/api/billingPixCheckout";
import { qk } from "@/lib/queryKeys";

export function useEnsureClinicCustomerFromIdentity(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!clinicId) throw new Error("BILLING_CLINIC_REQUIRED");
      return ensureMyClinicCustomerFromIdentity(clinicId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicCommercialCheckout(clinicId ?? "none") });
    },
  });
}

export function usePrepareClinicPixAuthorization(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!clinicId) throw new Error("BILLING_CLINIC_REQUIRED");
      return prepareMyClinicPixAutomaticAuthorization(clinicId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicCommercialCheckout(clinicId ?? "none") });
    },
  });
}

export function useExecuteClinicPixAuthorization() {
  return useMutation({
    mutationFn: (operationId: string) => executeMyClinicPixAutomaticAuthorization(operationId),
  });
}

export function useReissueClinicPixAuthorization(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!clinicId) throw new Error("BILLING_CLINIC_REQUIRED");
      return reissueMyClinicPixAutomaticAuthorization({ clinicId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicCommercialCheckout(clinicId ?? "none") });
    },
  });
}
