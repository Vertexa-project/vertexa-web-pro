import type { AuthMode } from "@/lib/auth/authMode";
import type { CurrentProfessional } from "@/lib/api/profile";

/**
 * Identidade do profissional atuante — resolução PURA (sem I/O), testável isoladamente.
 *
 * Contrato de identidade (ver docs/CONTRATO_INTEGRACAO.md):
 *   real: auth.uid() → profiles.auth_user_id → profiles.id → professionals → clinic.
 *   demo: pin de env (VITE_DEMO_PROFESSIONAL_PROFILE_ID).
 *
 * Estados:
 *   loading    — ainda resolvendo (sessão/profile/professional).
 *   anonymous  — modo real sem sessão.
 *   demo       — modo demo (identidade via pin).
 *   active     — modo real com professional+clinic resolvidos.
 *   pending    — modo real com sessão mas SEM professional/clinic (1º login sem match por
 *                e-mail → trigger criou profile 'pending'). A web mostra PendingAccess.
 */
export type IdentityStatus = "loading" | "anonymous" | "demo" | "active" | "pending";

export interface ResolvedIdentity {
  status: IdentityStatus;
  /** Registro do profissional (id + clinic + role) quando resolvido; senão null. */
  professional: CurrentProfessional | null;
  /** profile.id atuante (real: via auth_user_id; demo: pin). Usado como remetente no chat. */
  actingProfileId: string | null;
  /** E-mail da sessão real (só exibição); null em demo/anon. */
  email: string | null;
  /** Nome para exibição (professional.fullName → email). */
  displayName: string | null;
}

export interface ResolveIdentityInput {
  mode: AuthMode;
  /** true enquanto sessão/profile/professional ainda estão carregando. */
  loading: boolean;
  /** Pin de demo (VITE_DEMO_PROFESSIONAL_PROFILE_ID). */
  demoProfileId: string | null;
  /** Sessão real (só quando mode="real" e há sessão). */
  session: { userId: string; email: string | null } | null;
  /** profile.id resolvido a partir de auth_user_id (real). */
  profileId: string | null;
  /** Registro do profissional resolvido a partir do profileId. */
  professional: CurrentProfessional | null;
}

/**
 * Deriva a identidade a partir das peças já buscadas. PURA — não toca Supabase/react-query.
 */
export function resolveIdentity(input: ResolveIdentityInput): ResolvedIdentity {
  const { mode, loading, demoProfileId, session, profileId, professional } = input;

  if (loading) {
    return { status: "loading", professional: null, actingProfileId: null, email: null, displayName: null };
  }

  if (mode === "demo") {
    // Comportamento de hoje: identidade = pin. O seed sempre tem o professional da Dra. Camila.
    return {
      status: "demo",
      professional,
      actingProfileId: demoProfileId,
      email: null,
      displayName: professional?.fullName ?? null,
    };
  }

  // mode === "real"
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

  // Sessão real, mas sem professional/clinic resolvidos → acesso pendente.
  return {
    status: "pending",
    professional: null,
    actingProfileId: profileId,
    email: session.email,
    displayName: session.email,
  };
}
