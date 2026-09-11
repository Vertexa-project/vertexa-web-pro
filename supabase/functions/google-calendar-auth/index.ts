// Edge Function: google-calendar-auth (INIT do OAuth) — CALENDAR-02A.
// Autoridade = JWT → professional do caller. clinicId/professionalId do body são hints.
// State anti-CSRF (TTL 10min, single-use) grava clinic/professional SERVER-DERIVED.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { rejectIfClinicNotOperational } from "../_shared/clinicOperational.ts";
import { readHints, resolveCalendarCaller } from "../_shared/calendarCaller.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { calendarAuthHttpStatus } from "../_shared/calendarPolicy.ts";
import {
  buildConsentUrl,
  GOOGLE_SCOPES,
  randomState,
  readGoogleCredentials,
  safeRedirectBase,
} from "../_shared/google.ts";

const STATE_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { clinicId?: string; professionalId?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const db = supabaseAdmin();
  const resolved = await resolveCalendarCaller(req, db, readHints(body));
  if (!resolved.ok) return resolved.response;

  const redirect = safeRedirectBase(body.redirectTo);
  if (!redirect.ok) {
    return jsonResponse({ error: redirect.error }, calendarAuthHttpStatus(redirect.error));
  }

  let creds;
  try {
    creds = readGoogleCredentials();
  } catch (_e) {
    return jsonResponse({ error: "google_not_configured" }, 503);
  }

  const blocked = await rejectIfClinicNotOperational(db, resolved.caller.clinicId);
  if (blocked) return blocked;

  const state = randomState();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  const { error: stErr } = await db.from("calendar_oauth_state").insert({
    state,
    clinic_id: resolved.caller.clinicId,
    professional_id: resolved.caller.professionalId,
    redirect_to: redirect.origin,
    expires_at: expiresAt,
  });
  if (stErr) return jsonResponse({ error: "state_persist_failed" }, 500);

  // Só a URL de consentimento — nenhum token no browser.
  return jsonResponse({ url: buildConsentUrl(creds, state), scopes: GOOGLE_SCOPES.join(" ") });
});
