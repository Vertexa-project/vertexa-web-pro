// clinical-transcribe — transcreve UM pedaço de áudio de um atendimento (verify_jwt=true).
// Entrada: { chunk_id }. Saída: { mode: "demo"|"openai", segments: n, already?: true }.
// Sem OPENAI_API_KEY: MODO DEMONSTRAÇÃO (trechos do roteiro fictício, ver _shared/clinical/demoScript.ts).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { aiKey, canAccessEncounter, requireUser, UUID_RE } from "../_shared/clinical/caller.ts";
import { demoSegmentsForChunk } from "../_shared/clinical/demoScript.ts";
import { openaiTranscribe, type TranscribedSegment } from "../_shared/clinical/openai.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const body = (await req.json().catch(() => null)) as { chunk_id?: string } | null;
  const chunkId = body?.chunk_id ?? "";
  if (!UUID_RE.test(chunkId)) return jsonResponse({ error: "invalid_chunk_id" }, 400);

  const admin = supabaseAdmin();
  const { data: chunk } = await admin.from("clinical_audio_chunks").select("*").eq("id", chunkId).maybeSingle();
  if (!chunk) return jsonResponse({ error: "not_found" }, 404);
  if (!(await canAccessEncounter(auth.user, chunk.encounter_id))) return jsonResponse({ error: "forbidden" }, 403);

  const { data: enc } = await admin.from("clinical_encounters").select("status").eq("id", chunk.encounter_id).maybeSingle();
  if (!enc || enc.status === "finalizado" || enc.status === "cancelado") return jsonResponse({ error: "encounter_closed" }, 409);

  const key = aiKey();
  const mode = key ? "openai" : "demo";
  if (chunk.status === "done") return jsonResponse({ mode, segments: 0, already: true });

  // "Reserva" o pedaço (idempotente): uploaded/failed, ou transcribing parado há mais de 2 min.
  const stale = new Date(Date.now() - 120_000).toISOString();
  const { data: claimed } = await admin
    .from("clinical_audio_chunks")
    .update({ status: "transcribing", attempts: (chunk.attempts ?? 0) + 1, error: null, updated_at: new Date().toISOString() })
    .eq("id", chunkId)
    .or(`status.in.(uploaded,failed),and(status.eq.transcribing,updated_at.lt.${stale})`)
    .select("id")
    .maybeSingle();
  if (!claimed) return jsonResponse({ mode, segments: 0, in_progress: true });

  try {
    let segments: TranscribedSegment[];
    if (key) {
      const { data: file, error: dlErr } = await admin.storage.from("clinical-audio").download(chunk.storage_path);
      if (dlErr || !file) throw new Error("audio_download_failed");
      segments = await openaiTranscribe(key, file, chunk.storage_path.split("/").pop() ?? "audio.webm", chunk.seq, chunk.duration_ms);
    } else {
      segments = demoSegmentsForChunk(chunk.seq);
    }
    if (segments.length > 0) {
      const rows = segments.map((s) => ({
        encounter_id: chunk.encounter_id,
        clinic_id: chunk.clinic_id,
        chunk_id: chunk.id,
        ord: s.ord,
        start_ms: s.start_ms,
        speaker: s.speaker,
        text: s.text,
        is_demo: !key,
      }));
      const { error: insErr } = await admin
        .from("clinical_transcript_segments")
        .upsert(rows, { onConflict: "encounter_id,ord", ignoreDuplicates: true });
      if (insErr) throw new Error("segments_insert_failed");
    }
    await admin.from("clinical_audio_chunks").update({ status: "done", error: null, updated_at: new Date().toISOString() }).eq("id", chunkId);
    return jsonResponse({ mode, segments: segments.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 120) : "transcribe_failed";
    await admin.from("clinical_audio_chunks").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", chunkId);
    return new Response(JSON.stringify({ error: msg, mode }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
