import { useQuery } from "@tanstack/react-query";

import { getProfileName } from "@/lib/api/profile";
import { qk } from "@/lib/queryKeys";
import { DEMO_PROFESSIONAL_PROFILE_ID } from "@/lib/session";

/**
 * Nome do profissional atuante (demo = Dra. Camila via env). Usado p/ saudação.
 * Sob auth real isto viria de auth.uid()/profiles (ver docs/PENDENCIAS.md #14).
 */
export const useCurrentProfessionalName = () =>
  useQuery({
    queryKey: qk.currentProfessional(DEMO_PROFESSIONAL_PROFILE_ID ?? "none"),
    queryFn: () => getProfileName(DEMO_PROFESSIONAL_PROFILE_ID as string),
    enabled: Boolean(DEMO_PROFESSIONAL_PROFILE_ID),
    staleTime: Infinity,
  });
