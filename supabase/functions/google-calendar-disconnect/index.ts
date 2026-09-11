// Edge Function: google-calendar-disconnect — CALENDAR-02A.
// JWT → professional do caller → somente a conexão DESSE professional.
// Revoke via RPC cifrada get_calendar_refresh_token. Falha no Google não prende o usuário.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { rejectIfClinicNotOperational } from "../_shared/clinicOperational.ts";
import { readHints, resolveCalendarCaller } from "../_shared/calendarCaller.ts";
import { disconnectResultPayload, selectOwnGoogleConnection } from "../_shared/calendarPolicy.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { revokeToken } from "../_shared/google.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { clinicId?: string; professionalId?: string } = {};
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const db = supabaseAdmin();
  const resolved = await resolveCalendarCaller(req, db, readHints(body));
  if (!resolved.ok) return resolved.response;

  const blocked = await rejectIfClinicNotOperational(db, resolved.caller.clinicId);
  if (blocked) return blocked;

  const { data: rows } = await db
    .from("calendar_connections")
    .select("id, clinic_id, professional_id, provider, status, updated_at")
    .eq("clinic_id", resolved.caller.clinicId)
    .eq("professional_id", resolved.caller.professionalId)
    .eq("provider", "google");

  const conn = selectOwnGoogleConnection(
    rows ?? [],
    resolved.caller.professionalId,
    resolved.caller.clinicId,
  );
  if (!conn) return jsonResponse(disconnectResultPayload(0, "skipped"));

  let providerRevocation: "ok" | "skipped" | "failed" = "skipped";
  const { data: refreshToken } = await db.rpc("get_calendar_refresh_token", {
    p_connection_id: conn.id,
  });
  if (typeof refreshToken === "string" && refreshToken.length > 0) {
    const revoked = await revokeToken(refreshToken);
    providerRevocation = revoked ? "ok" : "failed";
  }

  const { error: delErr } = await db
    .from("calendar_connections")
    .delete()
    .eq("id", conn.id)
    .eq("professional_id", resolved.caller.professionalId);
  if (delErr) return jsonResponse({ error: "delete_failed" }, 500);

  return jsonResponse(disconnectResultPayload(1, providerRevocation));
});
