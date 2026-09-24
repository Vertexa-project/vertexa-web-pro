import { useMutation } from "@tanstack/react-query";

import { createMyClinicHostedCardCheckout } from "@/lib/api/billingHostedCardCheckout";

export function useCreateHostedCardCheckout(clinicId: string | null) {
  return useMutation({
    mutationFn: () => {
      if (!clinicId) throw new Error("BILLING_CLINIC_REQUIRED");
      return createMyClinicHostedCardCheckout(clinicId);
    },
  });
}
