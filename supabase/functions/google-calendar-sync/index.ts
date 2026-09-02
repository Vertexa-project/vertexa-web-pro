// Edge Function: google-calendar-sync — S10. Chamada pelo SPA (admin) via supabase.functions.invoke.
// Renova o access_token, lê eventos READ-ONLY da agenda e faz o espelho em calendar_event_cache.
// Trata: invalid_grant → status='revoked'; agenda 404 → status='stale'; outras falhas → status='error'.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { rejectIfClinicNotOperational } from "../_shared/clinicOperational.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { listEvents, readGoogleCredentials, refreshAccessToken, syncWindow } from "../_shared/google.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { clinicId?: string; professionalId?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  const clinicId = (body.clinicId ?? "").trim();
  // clinic_id é obrigatório: a conexão é SEMPRE resolvida dentro da clínica (sem caminho por id solto,
  // que removeria a amarração de tenant — ver review S10 #1 / IDOR).
  if (!clinicId) return jsonResponse({ error: "missing_clinic" }, 400);

  let creds;
  try {
    creds = readGoogleCredentials();
  } catch (_e) {
    return jsonResponse({ error: "google_not_configured" }, 503);
  }

  const db = supabaseAdmin();

  const blocked = await rejectIfClinicNotOperational(db, clinicId);
  if (blocked) return blocked;

  // Conexão alvo: por id, ou a mais recente da clínica (+ profissional se informado).
  let connQuery = db
    .from("calendar_connections")
    .select("id, clinic_id, google_calendar_id, status")
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (body.professionalId) connQuery = connQuery.eq("professional_id", body.professionalId);
  const { data: conn } = await connQuery.maybeSingle();
  if (!conn) return jsonResponse({ error: "no_connection" }, 404);

  const setStatus = (status: string) =>
    db.from("calendar_connections")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", conn.id);

  // Token (cifrado EM REPOUSO, deny-all) — decifrado só aqui via RPC service-role-only
  // get_calendar_refresh_token (pgcrypto + chave no Vault). O client não alcança o token. (WP-A2)
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
  // Persiste o novo access_token CIFRADO via RPC service-role-only (WP-A2).
  await db.rpc("set_calendar_access_token", {
    p_connection_id: conn.id,
    p_access_token: refreshed.accessToken,
    p_token_expires_at: new Date(Date.now() + (refreshed.expiresIn ?? 3600) * 1000).toISOString(),
  });

  const { timeMin, timeMax } = syncWindow(30);
  const result = await listEvents(refreshed.accessToken!, conn.google_calendar_id ?? "primary", timeMin, timeMax);
  if (!result.ok) {
    const status = result.notFound ? "stale" : "error";
    await setStatus(status);
    return jsonResponse({ error: result.notFound ? "calendar_not_found" : "list_failed", status }, 409);
  }

  // Espelho: limpa o cache da conexão e reinsere a janela atual (cache é só leitura no front).
  await db.from("calendar_event_cache").delete().eq("connection_id", conn.id);
  if (result.events.length > 0) {
    const rows = result.events.map((e) => ({
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
    const { error: insErr } = await db.from("calendar_event_cache").insert(rows);
    if (insErr) {
      await setStatus("error");
      return jsonResponse({ error: "cache_write_failed", status: "error" }, 500);
    }
  }

  await db.from("calendar_connections")
    .update({ status: "connected", last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", conn.id);

  return jsonResponse({ synced: result.events.length, status: "connected" });
});
