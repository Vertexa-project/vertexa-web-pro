// clinical-structure — gera/atualiza o rascunho estruturado do prontuário a partir da transcrição
// (verify_jwt=true). Entrada: { encounter_id }. Saída: { mode, applied, skipped, warning|null }.
// Resposta da IA inválida: tenta 1 vez de novo; se falhar, MANTÉM o rascunho anterior e devolve aviso.
// Campo editado à mão (locked) nunca é sobrescrito — a regra final está em clinical_apply_ai_fields.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { aiKey, canAccessEncounter, requireUser, UUID_RE } from "../_shared/clinical/caller.ts";
import { buildJsonSchema, validateAiOutput } from "../_shared/clinical/aiSchema.ts";
import { demoStructure } from "../_shared/clinical/demoScript.ts";
import { openaiStructure } from "../_shared/clinical/openai.ts";
import { buildSystemPrompt, buildUserPrompt } from "../_shared/clinical/prompt.ts";
import { listFieldKeys, type TemplateSection } from "../_shared/clinical/template.ts";
import type { AiFields, RecordFields } from "../_shared/clinical/record.ts";

const WARNING = "A organização automática não deu certo desta vez; o rascunho anterior foi mantido. Tente reprocessar.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const body = (await req.json().catch(() => null)) as { encounter_id?: string } | null;
  const encId = body?.encounter_id ?? "";
  if (!UUID_RE.test(encId)) return jsonResponse({ error: "invalid_encounter_id" }, 400);
  if (!(await canAccessEncounter(auth.user, encId))) return jsonResponse({ error: "forbidden" }, 403);

  const admin = supabaseAdmin();
  const { data: enc } = await admin.from("clinical_encounters").select("id,status,template_snapshot").eq("id", encId).maybeSingle();
  if (!enc) return jsonResponse({ error: "not_found" }, 404);
  if (enc.status === "finalizado" || enc.status === "cancelado") return jsonResponse({ error: "encounter_closed" }, 409);

  const sections = (enc.template_snapshot?.sections ?? []) as TemplateSection[];
  const validKeys = new Set(listFieldKeys(sections));
  const { data: segs } = await admin
    .from("clinical_transcript_segments")
    .select("ord,speaker,text")
    .eq("encounter_id", encId)
    .order("ord", { ascending: true });
  const segments = (segs ?? []) as Array<{ ord: number; speaker: string | null; text: string }>;
  const key = aiKey();
  const mode = key ? "openai" : "demo";
  if (segments.length === 0) return jsonResponse({ mode, applied: 0, skipped: 0, warning: null, empty: true });

  const validOrds = new Set(segments.map((s) => s.ord));
  const { data: rec } = await admin.from("clinical_records").select("fields").eq("encounter_id", encId).maybeSingle();
  const current = (rec?.fields ?? {}) as RecordFields;

  let proposal: AiFields = {};
  let warning: string | null = null;
  if (!key) {
    const v = validateAiOutput({ fields: demoStructure(validOrds) }, validKeys, validOrds);
    proposal = v.ok ? v.fields : {};
  } else {
    const schema = buildJsonSchema(sections);
    const system = buildSystemPrompt();
    const user = buildUserPrompt(sections, segments, current);
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const v = validateAiOutput(await openaiStructure(key, system, user, schema), validKeys, validOrds);
        if (v.ok) {
          proposal = v.fields;
          ok = true;
        }
      } catch (_e) {
        // tenta de novo uma vez; depois mantém o rascunho anterior
      }
    }
    if (!ok) warning = WARNING;
  }

  const { data: res, error } = await admin.rpc("clinical_apply_ai_fields", {
    p_encounter: encId,
    p_fields: proposal,
    p_warning: warning,
    p_demo: !key,
  });
  if (error) return jsonResponse({ error: "apply_failed" }, 500);
  return jsonResponse({ mode, applied: res?.applied ?? 0, skipped: res?.skipped ?? 0, warning });
});
