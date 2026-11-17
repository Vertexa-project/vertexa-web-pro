// vertexa-plan-draft — A8: primeira versão de dieta e treino pela Vertexa IA. verify_jwt=true.
// Entrada: { action:"generate", patient_id, kind:"dieta"|"treino", patient_type, notes? } | { action:"resolve", draft_id, decision:"usado"|"descartado" }.
// Lê a ficha com o JWT do profissional (RLS); só quem tem a DISCIPLINA do plano e vínculo clínico gera. Grava o rascunho em
// ai_plan_drafts (NUNCA em nutrition_plans/workout_plans: o paciente não vê e o plano publicado não é substituído) e o rastro
// em vertexa_ai_events (sem texto de saúde). Sem OPENAI_API_KEY = modo demonstração determinístico.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { aiKey, UUID_RE } from "../_shared/clinical/caller.ts";
import { supabaseUser } from "../_shared/supabaseUser.ts";
import { hasClinicalAccess } from "../_shared/vertexa/access.ts";
import { buildFacts } from "../_shared/planDraft/facts.ts";
import { generateDraft, openaiModelCall } from "../_shared/planDraft/generate.ts";
import { resolvePatientTypes } from "../_shared/planDraft/patientTypes.ts";
import type { LibraryExercise, PlanKind } from "../_shared/planDraft/types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "unauthenticated" }, 401);
  const user = supabaseUser(req);
  const [{ data: u }, body] = await Promise.all([user.auth.getUser(token), req.json().catch(() => null) as Promise<Row | null>]);
  const uid = u.user?.id;
  if (!uid) return jsonResponse({ error: "unauthenticated" }, 401);
  if (!body) return jsonResponse({ error: "invalid_body" }, 400);

  const { data: pros } = await user.from("professionals")
    .select("id, clinic_id, profile_id, profile:profiles!professionals_profile_id_fkey!inner ( auth_user_id )")
    .eq("profile.auth_user_id", uid);
  const me = (pros ?? []).find((p: Row) => p.clinic_id) as Row | undefined;
  if (!me) return jsonResponse({ error: "forbidden" }, 403);
  const clinicId = me.clinic_id as string;
  const profileId = me.profile_id as string;

  const kind = body.kind === "dieta" || body.kind === "treino" ? (body.kind as PlanKind) : null;
  const patientId = String(body.patient_id ?? "");
  const admin = supabaseAdmin();

  // ---- decisão do profissional sobre o rascunho (rastro de quem usou/descartou)
  if (body.action === "resolve") {
    const draftId = String(body.draft_id ?? "");
    const decision = body.decision === "usado" || body.decision === "descartado" ? body.decision : null;
    if (!UUID_RE.test(draftId) || !decision) return jsonResponse({ error: "invalid_request" }, 400);
    const { data: d } = await user.from("ai_plan_drafts").select("id, clinic_id, patient_id, kind, mode, status").eq("id", draftId).maybeSingle();
    if (!d || d.clinic_id !== clinicId) return jsonResponse({ error: "forbidden" }, 403);
    const { data: can } = await user.rpc("plan_draft_can_generate", { p_patient: d.patient_id, p_kind: d.kind });
    if (can !== true) return jsonResponse({ error: "forbidden" }, 403);
    if (d.status !== "pendente") return jsonResponse({ ok: true, already: d.status });
    const { error } = await admin.from("ai_plan_drafts").update({ status: decision, resolved_by: profileId, resolved_at: new Date().toISOString() })
      .eq("id", draftId).eq("status", "pendente");
    if (error) return jsonResponse({ error: "save_failed" }, 500);
    await admin.from("vertexa_ai_events").insert({
      clinic_id: clinicId, profile_id: profileId, kind: decision === "usado" ? "rascunho_usado" : "rascunho_descartado", parent_id: draftId,
      patient_id: d.patient_id, screen: "paciente", mode: d.mode, draft_kind: d.kind === "dieta" ? "plano_dieta" : "plano_treino",
    });
    return jsonResponse({ ok: true });
  }

  // ---- gerar
  if (body.action !== "generate" || !kind || !UUID_RE.test(patientId)) return jsonResponse({ error: "invalid_request" }, 400);
  const typeKey = String(body.patient_type ?? "");
  const notes = typeof body.notes === "string" ? body.notes : "";
  if (notes.length > 1000) return jsonResponse({ error: "invalid_notes" }, 400);

  // Recepção/Financeiro/Estoque não veem dado clínico: nem tentamos ler.
  const [{ data: acc }, { data: access }, { data: can }] = await Promise.all([
    user.rpc("fin_my_access", { p_clinic: clinicId }),
    user.rpc("vertexa_ai_can_access_patient", { p_patient: patientId }),
    user.rpc("plan_draft_can_generate", { p_patient: patientId, p_kind: kind }),
  ]);
  const roles: string[] = ((acc?.roles ?? []) as Row[]).map((r) => String(r.role));
  if (!hasClinicalAccess(Boolean(acc?.is_admin), roles) || access !== true) return jsonResponse({ error: "forbidden" }, 403);
  if (can !== true) return jsonResponse({ error: "no_discipline" }, 403);

  const [pat, ass, enc, docs, cfg, lib, pending, published] = await Promise.all([
    user.from("patients").select("id, clinic_id, birth_date, sex, height_cm, goal, current_weight, target_weight").eq("id", patientId).maybeSingle(),
    user.from("body_assessments").select("assessed_at, weight, body_fat_pct").eq("patient_id", patientId).order("assessed_at", { ascending: false }).limit(1),
    user.from("clinical_encounters").select("finalized_at, final_fields").eq("patient_id", patientId).eq("status", "finalizado").order("finalized_at", { ascending: false }).limit(1),
    user.from("patient_documents").select("title").eq("patient_id", patientId).eq("kind", "exam").order("uploaded_at", { ascending: false }).limit(20),
    user.from("clinic_plan_draft_config").select("patient_types, method_dieta, method_treino").eq("clinic_id", clinicId).maybeSingle(),
    kind === "treino" ? user.from("exercise_library").select("id, name, group_key, group_label, sort_order").eq("active", true).order("sort_order", { ascending: true }) : Promise.resolve({ data: [] as Row[] }),
    user.from("ai_plan_drafts").select("id").eq("patient_id", patientId).eq("kind", kind).eq("status", "pendente").limit(1),
    kind === "dieta"
      ? user.from("nutrition_plans").select("id").eq("patient_id", patientId).limit(1)
      : user.from("workout_plans").select("id, is_draft").eq("patient_id", patientId).eq("is_draft", false).limit(1),
  ]);
  if (!pat.data || pat.data.clinic_id !== clinicId) return jsonResponse({ error: "forbidden" }, 403);

  const type = resolvePatientTypes(cfg.data?.patient_types).find((t) => t.key === typeKey);
  if (!type) return jsonResponse({ error: "invalid_patient_type" }, 400);
  const library = ((lib.data ?? []) as Row[]).map((r) => ({ id: r.id, name: r.name, group_key: r.group_key, group_label: r.group_label, sort_order: r.sort_order })) as LibraryExercise[];
  if (kind === "treino" && library.length < 10) return jsonResponse({ error: "library_unavailable" }, 409);

  const facts = buildFacts({ patient: pat.data as Row, assessment: (ass.data?.[0] ?? null) as Row | null, encounter: (enc.data?.[0] ?? null) as Row | null, docs: (docs.data ?? []) as Row[], notes });
  const key = aiKey();
  let result;
  try {
    result = await generateDraft({
      kind, facts, type, library, method: (kind === "dieta" ? cfg.data?.method_dieta : cfg.data?.method_treino) ?? null,
      call: key ? openaiModelCall(key) : null,
    });
  } catch (_e) {
    return jsonResponse({ error: "generation_failed" }, 500);
  }

  // O rascunho anterior ainda pendente é substituído (um pendente por paciente e tipo); o novo nasce com o mesmo id do rastro.
  const draftId = crypto.randomUUID();
  if ((pending.data ?? []).length > 0) {
    await admin.from("ai_plan_drafts").update({ status: "substituido", resolved_by: profileId, resolved_at: new Date().toISOString() })
      .eq("patient_id", patientId).eq("kind", kind).eq("status", "pendente");
  }
  const { data: saved, error } = await admin.from("ai_plan_drafts").insert({
    id: draftId, clinic_id: clinicId, patient_id: patientId, kind, patient_type: type.key, patient_type_label: type.label,
    mode: result.mode, payload: result.payload, created_by: profileId,
  }).select("id, kind, patient_type, patient_type_label, mode, payload, status, created_at").single();
  if (error || !saved) return jsonResponse({ error: "save_failed" }, 500);

  const trace = admin.from("vertexa_ai_events").insert({
    id: draftId, clinic_id: clinicId, profile_id: profileId, kind: "pedido", screen: "paciente", patient_id: patientId,
    mode: result.mode, intent: "primeira_versao", draft_kind: kind === "dieta" ? "plano_dieta" : "plano_treino", blocked: null,
  }).then(({ error: e }) => { if (e) console.error("vertexa-plan-draft: rastro não gravado", e.code); });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(trace); else await trace;

  return jsonResponse({ mode: result.mode, draft: saved, has_published_plan: ((published.data ?? []) as Row[]).length > 0 });
});
