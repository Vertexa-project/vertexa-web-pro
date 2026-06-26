// Helpers da API do Google (OAuth + Calendar) para as Edge Functions (S10).
// READ-ONLY: escopos só de leitura; nunca criamos/editamos/excluímos no Google. Sem Google Meet.
// Segredos (client_id/secret/redirect_uri) vêm de Supabase Secrets — NUNCA do client Vite.

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// Read-only: eventos + lista de agendas. access_type=offline + prompt=consent garante refresh_token.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Lê e valida as credenciais do Google das Supabase Secrets. Lança se faltar alguma. */
export function readGoogleCredentials(): GoogleCredentials {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "";
  const redirectUri = Deno.env.get("GOOGLE_CALENDAR_REDIRECT_URI") ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("google_not_configured");
  }
  return { clientId, clientSecret, redirectUri };
}

/** Monta a URL de consentimento OAuth (read-only, offline). */
export function buildConsentUrl(creds: GoogleCredentials, state: string): string {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/** Troca o authorization code por tokens (inclui refresh_token na 1ª autorização offline). */
export async function exchangeCode(creds: GoogleCredentials, code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`token_exchange_failed:${res.status}:${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

export interface RefreshResult {
  ok: boolean;
  /** true quando o Google respondeu invalid_grant (refresh_token revogado/expirado). */
  revoked: boolean;
  accessToken?: string;
  expiresIn?: number;
}

/** Renova o access_token a partir do refresh_token. Detecta invalid_grant (revogado). */
export async function refreshAccessToken(
  creds: GoogleCredentials,
  refreshToken: string,
): Promise<RefreshResult> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (res.ok) {
    const data = (await res.json()) as GoogleTokens;
    return { ok: true, revoked: false, accessToken: data.access_token, expiresIn: data.expires_in };
  }
  const text = await res.text();
  const revoked = res.status === 400 && text.includes("invalid_grant");
  return { ok: false, revoked };
}

export interface PrimaryCalendar {
  id: string; // para a agenda primária, o id é o e-mail da conta
  summary: string;
}

/** Lê a agenda primária da conta (id = e-mail; summary = nome). Read-only. */
export async function getPrimaryCalendar(accessToken: string): Promise<PrimaryCalendar | null> {
  const res = await fetch(`${CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: Array<{ id: string; summary?: string; primary?: boolean }> };
  const primary = (data.items ?? []).find((c) => c.primary) ?? (data.items ?? [])[0];
  if (!primary) return null;
  return { id: primary.id, summary: primary.summary ?? primary.id };
}

export interface GoogleEvent {
  googleEventId: string;
  title: string | null;
  startsAt: string; // ISO timestamptz
  endsAt: string | null;
  allDay: boolean;
  status: string | null;
}

interface RawGoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** Status HTTP da listagem, p/ o sync distinguir 404 (agenda removida) de erro genérico. */
export interface ListEventsResult {
  ok: boolean;
  notFound: boolean;
  events: GoogleEvent[];
}

/** Lista eventos da agenda na janela [timeMin, timeMax). Read-only, eventos expandidos e ordenados. */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<ListEventsResult> {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return { ok: false, notFound: true, events: [] };
  if (!res.ok) return { ok: false, notFound: false, events: [] };
  const data = (await res.json()) as { items?: RawGoogleEvent[] };
  const events: GoogleEvent[] = [];
  for (const ev of data.items ?? []) {
    if (ev.status === "cancelled") continue;
    const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
    // All-day: ancora ao meio-dia UTC para não deslocar o dia em fusos negativos (ex.: BR -03).
    const startsAt = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T12:00:00Z` : null);
    if (!startsAt) continue;
    const endsAt = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T12:00:00Z` : null);
    events.push({
      googleEventId: ev.id,
      title: ev.summary ?? null,
      startsAt,
      endsAt,
      allDay,
      status: ev.status ?? null,
    });
  }
  return { ok: true, notFound: false, events };
}

/** Revoga o token no Google (best-effort; usado no disconnect). */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch (_e) {
    // best-effort: se falhar, ainda assim apagamos a conexão localmente.
  }
}

/** State anti-CSRF aleatório (32 bytes hex), com TTL gerido pela tabela calendar_oauth_state. */
export function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Janela de sync: agora → +N dias (superset de hoje/semana da agenda interna). */
export function syncWindow(days = 30): { timeMin: string; timeMax: string } {
  const now = Date.now();
  return {
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Valida o redirect_to do SPA. Exige http(s) e, se ALLOWED_REDIRECT_ORIGINS estiver setado
 * (origens separadas por vírgula), só permite as origens listadas (anti open-redirect). Sem o
 * env, cai no filtro de protocolo (fallback de dev). Em produção, configure a allowlist.
 */
export function safeRedirectBase(redirectTo: string | null | undefined): string | null {
  if (!redirectTo) return null;
  try {
    const u = new URL(redirectTo);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const allow = (Deno.env.get("ALLOWED_REDIRECT_ORIGINS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow.length > 0 && !allow.includes(u.origin)) return null;
    return u.origin;
  } catch (_e) {
    return null;
  }
}
