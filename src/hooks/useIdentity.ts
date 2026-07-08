import { useQuery } from "@tanstack/react-query";

import { AUTH_MODE } from "@/lib/auth/authMode";
import { resolveIdentity, type ResolvedIdentity } from "@/lib/auth/identity";
import { getCurrentProfessional, getProfileByAuthUserId } from "@/lib/api/profile";
import { captureException } from "@/lib/observability/sentry";
import { qk } from "@/lib/queryKeys";
import { DEMO_PROFESSIONAL_PROFILE_ID } from "@/lib/session";
import { useAuth } from "@/providers/auth-context";

/**
 * Fonte ÚNICA da identidade do profissional atuante (real OU demo). Orquestra as buscas e
 * delega a decisão à função pura `resolveIdentity`.
 *
 * - demo: identidade = pin de env (comportamento de hoje).
 * - real: auth.uid() → getProfileByAuthUserId → getCurrentProfessional → professional+clinic.
 *   Sessão sem professional/clinic = pending (PendingAccess).
 *
 * Falhas de resolução são reportadas ao Sentry com source:"auth" (sem PII).
 */
export function useIdentity(): ResolvedIdentity {
  const { session, loading: authLoading } = useAuth();

  const authUserId = AUTH_MODE === "real" ? session?.user.id ?? null : null;

  const profileQuery = useQuery({
    queryKey: qk.profileByAuthUser(authUserId ?? "none"),
    queryFn: async () => {
      try {
        return await getProfileByAuthUserId(authUserId as string);
      } catch (err) {
        captureException(err, { source: "auth", scope: "resolve-profile" });
        throw err;
      }
    },
    enabled: AUTH_MODE === "real" && Boolean(authUserId),
    staleTime: Infinity,
  });

  // profile atuante: demo → pin; real → profile.id resolvido por auth_user_id.
  const actingProfileId =
    AUTH_MODE === "demo" ? DEMO_PROFESSIONAL_PROFILE_ID : profileQuery.data?.id ?? null;

  const professionalQuery = useQuery({
    queryKey: qk.currentProfessionalRecord(actingProfileId ?? "none"),
    queryFn: async () => {
      try {
        return await getCurrentProfessional(actingProfileId as string);
      } catch (err) {
        captureException(err, { source: "auth", scope: "resolve-professional" });
        throw err;
      }
    },
    enabled: Boolean(actingProfileId),
    staleTime: Infinity,
  });

  const loading =
    authLoading ||
    (AUTH_MODE === "real" && Boolean(authUserId) && profileQuery.isLoading) ||
    (Boolean(actingProfileId) && professionalQuery.isLoading);

  return resolveIdentity({
    mode: AUTH_MODE,
    loading,
    demoProfileId: DEMO_PROFESSIONAL_PROFILE_ID,
    session:
      AUTH_MODE === "real" && session
        ? { userId: session.user.id, email: session.user.email ?? null }
        : null,
    profileId: actingProfileId,
    professional: professionalQuery.data ?? null,
  });
}
