import { useQuery } from "@tanstack/react-query";

import { getClinicOnboardingState } from "@/lib/api/clinics";
import { qk } from "@/lib/queryKeys";

export function useClinicOnboardingState(enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicOnboardingState,
    queryFn: getClinicOnboardingState,
    enabled,
    staleTime: 15_000,
    refetchInterval: (query) => {
      const mode = query.state.data?.mode;
      const status = query.state.data?.request?.status;
      return mode === "manual_review" && status === "pending" ? 15_000 : false;
    },
    retry: false,
  });
}
