// CALENDAR-02A — política pura de identidade/tenant do Google Calendar.
// Sem Deno, sem I/O: a Edge Function e o vitest compartilham as mesmas regras.
// Autoridade = JWT → professional do caller. clinicId/professionalId do browser são só hints.

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export const FORBIDDEN_GOOGLE_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const GOOGLE_EVENT_LIST_FIELDS = "items(id,status,summary,start,end),nextPageToken";
export const GOOGLE_CALENDAR_LIST_FIELDS = "items(id,summary,primary)";

export const PLAINTEXT_TOKEN_COLUMN_NAMES = ["refresh_token", "access_token"] as const;

export type CalendarAuthError =
  | "unauthenticated"
  | "not_professional"
  | "professional_inactive"
  | "clinic_suspended"
  | "tenant_mismatch"
  | "ambiguous_membership"
  | "redirect_not_configured"
  | "redirect_origin_denied"
  | "google_not_configured"
  | "no_connection";

export interface CalendarMembership {
  professionalId: string;
  clinicId: string;
  professionalStatus: string | null;
  clinicStatus: string | null;
}

export interface CalendarHints {
  clinicId?: string | null;
  professionalId?: string | null;
}

export interface CalendarConnectionRow {
  id: string;
  clinic_id: string;
  professional_id: string | null;
  provider: string;
  status: string;
  updated_at: string;
}

export function isActiveProfessionalStatus(status: string | null | undefined): boolean {
  return (status ?? "active") === "active";
}

export function isOperationalClinicStatus(status: string | null | undefined): boolean {
  return (status ?? "active") === "active";
}

function trimHint(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Escolhe a membership do caller. Hints do browser NÃO são autoridade:
 * se presentes, têm de coincidir com uma membership já elegível do JWT.
 */
export function selectCallerMembership(
  memberships: readonly CalendarMembership[],
  hints: CalendarHints = {},
): { ok: true; membership: CalendarMembership } | { ok: false; error: CalendarAuthError } {
  if (memberships.length === 0) return { ok: false, error: "not_professional" };

  const activeRows = memberships.filter((m) => isActiveProfessionalStatus(m.professionalStatus));
  if (activeRows.length === 0) return { ok: false, error: "professional_inactive" };

  const eligible = activeRows.filter((m) => isOperationalClinicStatus(m.clinicStatus));
  if (eligible.length === 0) return { ok: false, error: "clinic_suspended" };

  const hintClinic = trimHint(hints.clinicId);
  const hintProf = trimHint(hints.professionalId);
  if (hintClinic || hintProf) {
    const match = eligible.find((m) => {
      if (hintProf && m.professionalId !== hintProf) return false;
      if (hintClinic && m.clinicId !== hintClinic) return false;
      return true;
    });
    if (!match) return { ok: false, error: "tenant_mismatch" };
    return { ok: true, membership: match };
  }

  if (eligible.length > 1) return { ok: false, error: "ambiguous_membership" };
  return { ok: true, membership: eligible[0] };
}

export function parseAllowedRedirectOrigins(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fail-closed: allowlist vazia/ausente NÃO aceita origem arbitrária. */
export function resolveSafeRedirectOrigin(
  redirectTo: string | null | undefined,
  allowedOriginsRaw: string | null | undefined,
): { ok: true; origin: string } | { ok: false; error: "redirect_not_configured" | "redirect_origin_denied" } {
  const allow = parseAllowedRedirectOrigins(allowedOriginsRaw);
  if (allow.length === 0) return { ok: false, error: "redirect_not_configured" };
  if (!redirectTo) return { ok: false, error: "redirect_origin_denied" };
  try {
    const u = new URL(redirectTo);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "redirect_origin_denied" };
    }
    if (!allow.includes(u.origin)) return { ok: false, error: "redirect_origin_denied" };
    return { ok: true, origin: u.origin };
  } catch {
    return { ok: false, error: "redirect_origin_denied" };
  }
}

export function selectOwnGoogleConnection(
  rows: readonly CalendarConnectionRow[],
  professionalId: string,
  clinicId: string,
): CalendarConnectionRow | null {
  const mine = rows.filter(
    (r) =>
      r.provider === "google" &&
      r.professional_id === professionalId &&
      r.clinic_id === clinicId,
  );
  if (mine.length === 0) return null;
  const connected = mine.filter((r) => r.status === "connected");
  const pool = connected.length > 0 ? connected : mine;
  return [...pool].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

export function scopesAreReadOnly(scopes: readonly string[]): boolean {
  const forbidden = new Set<string>(FORBIDDEN_GOOGLE_WRITE_SCOPES);
  return scopes.every((s) => !forbidden.has(s));
}

export function payloadExposesRefreshToken(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.some((k) => k.toLowerCase() === "refresh_token" || k.toLowerCase() === "refreshtoken");
}

export function disconnectResultPayload(
  removed: number,
  providerRevocation: "ok" | "skipped" | "failed",
): { disconnected: true; removed: number; provider_revocation: "ok" | "skipped" | "failed" } {
  return { disconnected: true, removed, provider_revocation: providerRevocation };
}

export function isOAuthStateExpired(expiresAtIso: string, nowMs: number): boolean {
  return new Date(expiresAtIso).getTime() < nowMs;
}

/** State sem professional do caller não é autoridade — fail closed (nunca conexão “da clínica”). */
export function oauthStateHasProfessional(professionalId: string | null | undefined): boolean {
  return Boolean(professionalId && professionalId.trim().length > 0);
}

export function parseOAuthCallbackSearch(search: {
  get(name: string): string | null;
}):
  | { ok: true; code: string; state: string }
  | { ok: false; reason: "missing_state" | "oauth_error" | "missing_code" } {
  const state = search.get("state");
  if (!state) return { ok: false, reason: "missing_state" };
  if (search.get("error")) return { ok: false, reason: "oauth_error" };
  const code = search.get("code");
  if (!code) return { ok: false, reason: "missing_code" };
  return { ok: true, code, state };
}

export function calendarAuthHttpStatus(error: CalendarAuthError): number {
  if (error === "unauthenticated") return 401;
  if (error === "google_not_configured" || error === "redirect_not_configured") return 503;
  if (error === "no_connection") return 404;
  return 403;
}
