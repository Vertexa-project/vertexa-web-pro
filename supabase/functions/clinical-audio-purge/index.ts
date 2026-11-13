// clinical-audio-purge — apaga o ÁUDIO (a transcrição e o prontuário ficam) de atendimentos já
// finalizados/cancelados (verify_jwt=true). Decisão: áudio some 30 dias após finalizar
// (clinical_encounters.audio_delete_after). Entrada:
//   { encounter_id, now?: true }  apaga esse atendimento (now=true ignora o prazo de 30 dias);
//   {}                            varre os atendimentos VENCIDOS que o chamador enxerga (até 20).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { canAccessEncounter, requireUser, UUID_RE } from "../_shared/clinical/caller.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const body = ((await req.json().catch(() => null)) ?? {}) as { encounter_id?: string; now?: boolean };
  const admin = supabaseAdmin();
  let ids: string[] = [];
  if (body.encounter_id) {
    if (!UUID_RE.test(body.encounter_id)) return jsonResponse({ error: "invalid_encounter_id" }, 400);
    if (!(await canAccessEncounter(auth.user, body.encounter_id))) return jsonResponse({ error: "forbidden" }, 403);
    ids = [body.encounter_id];
  } else {
    // RLS limita a varredura ao que o chamador enxerga.
    const { data } = await auth.user
      .from("clinical_encounters")
      .select("id")
      .in("status", ["finalizado", "cancelado"])
      .is("audio_deleted_at", null)
      .lte("audio_delete_after", new Date().toISOString())
      .limit(20);
    ids = (data ?? []).map((r: { id: string }) => r.id);
  }

  let purged = 0;
  for (const id of ids) {
    const { data: enc } = await admin
      .from("clinical_encounters")
      .select("status,audio_delete_after,audio_deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (!enc || !["finalizado", "cancelado"].includes(enc.status) || enc.audio_deleted_at) continue;
    const due = enc.audio_delete_after && new Date(enc.audio_delete_after).getTime() <= Date.now();
    if (!due && !(body.encounter_id && body.now === true)) continue;
    const { data: chunks } = await admin
      .from("clinical_audio_chunks")
      .select("id,storage_path")
      .eq("encounter_id", id)
      .is("audio_deleted_at", null);
    const paths = (chunks ?? []).map((c: { storage_path: string }) => c.storage_path);
    if (paths.length > 0) {
      const { error } = await admin.storage.from("clinical-audio").remove(paths);
      if (error) continue;
    }
    const nowIso = new Date().toISOString();
    await admin.from("clinical_audio_chunks").update({ audio_deleted_at: nowIso }).eq("encounter_id", id).is("audio_deleted_at", null);
    await admin.from("clinical_encounters").update({ audio_deleted_at: nowIso }).eq("id", id);
    purged++;
  }
  return jsonResponse({ purged, checked: ids.length });
});
