import type { CurrentProfessional } from "@/lib/api/profile";

/**
 * Identidade do profissional atuante — resolução PURA (sem I/O), testável isoladamente.
 *
 * Cadeia: auth.uid() → profiles.auth_user_id → profiles.id → professionals → clinic.
 *
 * Estados:
 *   loading    — ainda resolvendo (sessão/profile/professional).
 *   anonymous  — sem sessão.
 *   active     — professional+clinic resolvidos.
 *   pending    — sessão sem professional/clinic (1º login → profile patient/pending).
 */
export type IdentityStatus = "loading" | "anonymous" | "active" | "pending";

export interface ResolvedIdentity {
  status: IdentityStatus;
  professional: CurrentProfessional | null;
  actingProfileId: string | null;
  email: string | null;
  displayName: string | null;
}

export interface ResolveIdentityInput {
  loading: boolean;
  session: { userId: string; email: string | null } | null;
  profileId: string | null;
  professional: CurrentProfessional | null;
}

export function resolveIdentity(input: ResolveIdentityInput): ResolvedIdentity {
  const { loading, session, profileId, professional } = input;

  if (loading) {
    return { status: "loading", professional: null, actingProfileId: null, email: null, displayName: null };
  }

  if (!session) {
    return { status: "anonymous", professional: null, actingProfileId: null, email: null, displayName: null };
  }

  if (professional && profileId) {
    return {
      status: "active",
      professional,
      actingProfileId: profileId,
      email: session.email,
      displayName: professional.fullName ?? session.email,
    };
  }

  return {
    status: "pending",
    professional: null,
    actingProfileId: profileId,
    email: session.email,
    displayName: session.email,
  };
}
