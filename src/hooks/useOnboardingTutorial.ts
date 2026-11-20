import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyOnboardingTutorial,
  listPlatformOnboardingTutorials,
  markOnboardingTutorialSeen,
  savePlatformOnboardingTutorial,
  type SaveOnboardingTutorialInput,
  type TutorialAudience,
} from "@/lib/api/onboardingTutorials";

const keys = {
  mine: (audience: TutorialAudience) =>
    ["onboardingTutorial", "mine", audience] as const,
  platform: ["platform", "onboardingTutorials"] as const,
};

export function useMyOnboardingTutorial(
  audience: TutorialAudience,
  enabled = true,
) {
  return useQuery({
    queryKey: keys.mine(audience),
    queryFn: () => getMyOnboardingTutorial(audience),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useMarkOnboardingTutorialSeen(audience: TutorialAudience) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markOnboardingTutorialSeen(audience),
    onSuccess: () => {
      qc.setQueryData(keys.mine(audience), (old: unknown) =>
        old && typeof old === "object"
          ? { ...(old as object), pending: false }
          : old,
      );
    },
  });
}

export function usePlatformOnboardingTutorials(enabled: boolean) {
  return useQuery({
    queryKey: keys.platform,
    queryFn: listPlatformOnboardingTutorials,
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function useSavePlatformOnboardingTutorial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveOnboardingTutorialInput) =>
      savePlatformOnboardingTutorial(input),
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: keys.platform });
      void qc.invalidateQueries({ queryKey: keys.mine(input.audience) });
    },
  });
}
