// Edge Function: google-calendar-disconnect — S10. Chamada pelo SPA (admin) via supabase.functions.invoke.
// Revoga o token no Google (best-effort) e APAGA a conexão — o ON DELETE CASCADE remove também os
// tokens (calendar_connection_tokens) e o cache (calendar_event_cache). Para de sincronizar.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { revokeToken } from "../_shared/google.ts";

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
  // clinic_id obrigatório: o disconnect (destrutivo) é SEMPRE escopado por clínica — sem caminho por
  // id solto, que permitiria apagar a conexão de outra clínica (ver review S10 #1 / IDOR).
  if (!clinicId) return jsonResponse({ error: "missing_clinic" }, 400);

  const db = supabaseAdmin();

  // Conexões alvo: SEMPRE dentro da clínica informada (+ profissional opcional).
  let q = db.from("calendar_connections").select("id").eq("clinic_id", clinicId);
  if (body.professionalId) q = q.eq("professional_id", body.professionalId);
  const { data: conns } = await q;
  const ids = (conns ?? []).map((c) => c.id);
  if (ids.length === 0) return jsonResponse({ disconnected: true, removed: 0 });

  // Revoga tokens no Google (best-effort), depois apaga as conexões (cascade → tokens + cache).
  for (const id of ids) {
    const { data: tok } = await db
      .from("calendar_connection_tokens")
      .select("refresh_token")
      .eq("connection_id", id)
      .maybeSingle();
    if (tok?.refresh_token) await revokeToken(tok.refresh_token);
  }

  const { error: delErr } = await db.from("calendar_connections").delete().in("id", ids);
  if (delErr) return jsonResponse({ error: "delete_failed" }, 500);

  return jsonResponse({ disconnected: true, removed: ids.length });
});
