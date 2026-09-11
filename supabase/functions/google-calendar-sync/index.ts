// Edge Function: google-calendar-sync — CALENDAR-02A.
// JWT → professional do caller → somente a conexão DESSE professional.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { rejectIfClinicNotOperational } from "../_shared/clinicOperational.ts";
import { readHints, resolveCalendarCaller } from "../_shared/calendarCaller.ts";
import { selectOwnGoogleConnection } from "../_shared/calendarPolicy.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { listEvents, readGoogleCredentials, refreshAccessToken, syncWindow } from "../_shared/google.ts";

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

  let creds;
  try {
    creds = readGoogleCredentials();
  } catch (_e) {
    return jsonResponse({ error: "google_not_configured" }, 503);
  }

  const { data: rows } = await db
    .from("calendar_connections")
    .select("id, clinic_id, professional_id, provider, status, updated_at, google_calendar_id")
    .eq("clinic_id", resolved.caller.clinicId)
    .eq("professional_id", resolved.caller.professionalId)
    .eq("provider", "google");

  const conn = selectOwnGoogleConnection(
    rows ?? [],
    resolved.caller.professionalId,
    resolved.caller.clinicId,
  );
  if (!conn) return jsonResponse({ error: "no_connection" }, 404);

  const setStatus = (status: string) =>
    db.from("calendar_connections")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", conn.id)
      .eq("professional_id", resolved.caller.professionalId);

  const { data: refreshToken, error: tokErr } = await db.rpc("get_calendar_refresh_token", {
    p_connection_id: conn.id,
  });
  if (tokErr || !refreshToken) {
    await setStatus("error");
    return jsonResponse({ error: "no_token", status: "error" }, 409);
  }

  const refreshed = await refreshAccessToken(creds, refreshToken as string);
  if (!refreshed.ok) {
    const status = refreshed.revoked ? "revoked" : "error";
    await setStatus(status);
    return jsonResponse({ error: refreshed.revoked ? "revoked" : "refresh_failed", status }, 409);
  }
  await db.rpc("set_calendar_access_token", {
    p_connection_id: conn.id,
    p_access_token: refreshed.accessToken,
    p_token_expires_at: new Date(Date.now() + (refreshed.expiresIn ?? 3600) * 1000).toISOString(),
  });

  const calendarId = (rows ?? []).find((r) => r.id === conn.id)?.google_calendar_id ?? "primary";
  const { timeMin, timeMax } = syncWindow(30);
  const result = await listEvents(refreshed.accessToken!, calendarId, timeMin, timeMax);
  if (!result.ok) {
    const status = result.notFound ? "stale" : "error";
    await setStatus(status);
    return jsonResponse({ error: result.notFound ? "calendar_not_found" : "list_failed", status }, 409);
  }

  await db.from("calendar_event_cache").delete().eq("connection_id", conn.id);
  if (result.events.length > 0) {
    const cacheRows = result.events.map((e) => ({
      connection_id: conn.id,
      clinic_id: conn.clinic_id,
      google_event_id: e.googleEventId,
      title: e.title,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      all_day: e.allDay,
      status: e.status,
      synced_at: new Date().toISOString(),
    }));
    const { error: insErr } = await db.from("calendar_event_cache").insert(cacheRows);
    if (insErr) {
      await setStatus("error");
      return jsonResponse({ error: "cache_write_failed", status: "error" }, 500);
    }
  }

  await db.from("calendar_connections")
    .update({
      status: "connected",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id)
    .eq("professional_id", resolved.caller.professionalId);

  return jsonResponse({ synced: result.events.length, status: "connected" });
});
