/**
 * Autoridade GLOBAL da plataforma (WP-10B2B).
 *
 * A prova REAL vive no banco (`public.am_i_platform_admin`). Aqui só consolidamos o sinal
 * para a UI de forma FAIL-CLOSED e DISTINGUINDO erro de `false`:
 *   - erro ≠ “não é Platform Admin”
 *   - erro NÃO libera onboarding clínico (criar clínica / join code)
 *   - `true` só quando a RPC respondeu explicitamente `true`
 *
 * Independente de clinic admin, `profiles.role`, membership e metadata.
 */

export type PlatformAdminAccess = "loading" | "granted" | "denied" | "error";

export interface PlatformAdminAccessInput {
  /** Retorno bruto da RPC. `undefined` enquanto não há dado. */
  data: boolean | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Resolve o sinal de Platform Admin.
 * Erro tem precedência sobre qualquer dado stale. `undefined` sem erro ⇒ loading (não deny).
 */
export function resolvePlatformAdminAccess(input: PlatformAdminAccessInput): PlatformAdminAccess {
  if (input.isError) return "error";
  if (input.isLoading || input.data === undefined) return "loading";
  return input.data === true ? "granted" : "denied";
}

export type PostAuthDestination =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "navigate"; to: "/platform" | "/" };

/** Destino único pós-login / callback — usado pelo AccessResolver. */
export function resolvePostAuthDestination(access: PlatformAdminAccess): PostAuthDestination {
  if (access === "loading") return { kind: "loading" };
  if (access === "error") return { kind: "error" };
  if (access === "granted") return { kind: "navigate", to: "/platform" };
  return { kind: "navigate", to: "/" };
}

export type PendingOnboardingGate = "loading" | "error" | "platform" | "onboarding";

/**
 * O que o gate clínico deve fazer quando a identidade está `pending` (a superfície que hoje
 * monta PendingAccessPage / CreateClinicForm).
 */
export function resolvePendingOnboardingGate(access: PlatformAdminAccess): PendingOnboardingGate {
  if (access === "loading") return "loading";
  if (access === "error") return "error";
  if (access === "granted") return "platform";
  return "onboarding";
}

export interface PlatformClinicStats {
  clinicCount: number;
  professionalCount: number;
  patientCount: number;
}

export interface PlatformClinicCounts {
  professionalCount: number;
  patientCount: number;
}

/** Agrega os counts da RPC `list_platform_clinics` no client. Não consulta outras tabelas. */
export function aggregatePlatformClinicStats(clinics: PlatformClinicCounts[]): PlatformClinicStats {
  return {
    clinicCount: clinics.length,
    professionalCount: clinics.reduce((sum, row) => sum + row.professionalCount, 0),
    patientCount: clinics.reduce((sum, row) => sum + row.patientCount, 0),
  };
}

/** Colunas visíveis na V1. `clinicId` e `ownerProfileId` ficam fora de propósito. */
export const PLATFORM_CLINIC_VISIBLE_COLUMNS = [
  "clinicName",
  "createdAt",
  "professionalCount",
  "patientCount",
] as const;
