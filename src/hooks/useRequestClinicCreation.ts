import { useMutation, useQueryClient } from "@tanstack/react-query";

import { requestClinicCreation, type ClinicCreationRequestResult } from "@/lib/api/clinics";
import { qk } from "@/lib/queryKeys";

export function useRequestClinicCreation() {
  const qc = useQueryClient();
  return useMutation<ClinicCreationRequestResult, unknown, string>({
    mutationFn: (name: string) => requestClinicCreation(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.clinicOnboardingState });
    },
  });
}
