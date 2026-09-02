import { useQuery } from "@tanstack/react-query";

import { resolveIdentity, type ResolvedIdentity } from "@/lib/auth/identity";
import { listMyClinicMemberships } from "@/lib/api/professionalStatus";
import { getCurrentProfessional, getProfileByAuthUserId } from "@/lib/api/profile";
import { captureException } from "@/lib/observability/sentry";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/providers/auth-context";

/**
 * Fonte única da identidade do profissional atuante.
 * auth.uid() → getProfileByAuthUserId → getCurrentProfessional.
 * Sessão sem professional/clinic = pending (PendingAccess).
 */
export function useIdentity(): ResolvedIdentity {
  const { session, loading: authLoading } = useAuth();
  const authUserId = session?.user.id ?? null;

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
    enabled: Boolean(authUserId),
    staleTime: Infinity,
  });

  const actingProfileId = profileQuery.data?.id ?? null;

  const membershipsQuery = useQuery({
    queryKey: qk.myClinicMemberships,
    queryFn: listMyClinicMemberships,
    enabled: Boolean(actingProfileId),
    staleTime: 15_000,
    retry: false,
  });

  const clinicFingerprint = (membershipsQuery.data ?? [])
    .map((m) => `${m.clinicId}:${m.clinicStatus ?? "active"}:${m.status}`)
    .sort()
    .join("|");

  const professionalQuery = useQuery({
    queryKey: [...qk.currentProfessionalRecord(actingProfileId ?? "none"), clinicFingerprint],
    queryFn: async () => {
      try {
        return await getCurrentProfessional(actingProfileId as string);
      } catch (err) {
        captureException(err, { source: "auth", scope: "resolve-professional" });
        throw err;
      }
    },
    enabled:
      Boolean(actingProfileId) && (membershipsQuery.isFetched || membershipsQuery.isError),
    staleTime: 15_000,
  });

  const loading =
    authLoading ||
    (Boolean(authUserId) && profileQuery.isLoading) ||
    (Boolean(actingProfileId) && (membershipsQuery.isLoading || professionalQuery.isLoading));

  return resolveIdentity({
    loading,
    session: session ? { userId: session.user.id, email: session.user.email ?? null } : null,
    profileId: actingProfileId,
    professional: professionalQuery.data ?? null,
  });
}
