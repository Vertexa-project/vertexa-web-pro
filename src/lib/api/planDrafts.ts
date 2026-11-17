import { supabase } from "@/lib/supabase";
import type { AiPlanDraft, PatientTypeDef, PlanDraftKind } from "@/lib/domain/planDraft";

async function invokeFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vertexa-plan-draft", { body });
  if (error) {
    let code = "function_error";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = (await ctx.json()) as { error?: string };
        if (p?.error) code = String(p.error);
      } catch {
        // corpo não-JSON
      }
    } else if (ctx && typeof ctx.status === "number" && ctx.status === 404) {
      code = "not_deployed";
    }
    throw new Error(code);
  }
  return data as T;
}

export interface GenerateResult { mode: "demo" | "openai"; draft: AiPlanDraft; has_published_plan: boolean }

export const generatePlanDraft = (input: { patientId: string; kind: PlanDraftKind; patientType: string; notes: string }) =>
  invokeFn<GenerateResult>({ action: "generate", patient_id: input.patientId, kind: input.kind, patient_type: input.patientType, notes: input.notes });

/** Rastro de quem usou/descartou. Falha em silêncio quando é só o rastro (usado); o descarte precisa dar certo. */
export const resolvePlanDraft = (draftId: string, decision: "usado" | "descartado") =>
  invokeFn<{ ok: boolean }>({ action: "resolve", draft_id: draftId, decision });

const DRAFT_COLS = "id, kind, patient_type, patient_type_label, mode, payload, status, created_at";

/** Rascunho pendente do paciente (RLS: só equipe com acesso clínico; o paciente nunca lê). */
export async function fetchPendingDraft(patientId: string, kind: PlanDraftKind): Promise<AiPlanDraft | null> {
  const { data, error } = await supabase.from("ai_plan_drafts").select(DRAFT_COLS)
    .eq("patient_id", patientId).eq("kind", kind).eq("status", "pendente").order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as AiPlanDraft | undefined) ?? null;
}

export interface DraftConfig { patient_types: PatientTypeDef[] | null; method_dieta: string | null; method_treino: string | null }

export async function fetchDraftConfig(clinicId: string): Promise<DraftConfig | null> {
  const { data, error } = await supabase.from("clinic_plan_draft_config").select("patient_types, method_dieta, method_treino").eq("clinic_id", clinicId).maybeSingle();
  if (error) throw error;
  return (data as DraftConfig | null) ?? null;
}

export async function saveDraftConfig(input: DraftConfig): Promise<void> {
  const { error } = await supabase.rpc("save_plan_draft_config", {
    p_patient_types: input.patient_types, p_method_dieta: input.method_dieta, p_method_treino: input.method_treino,
  });
  if (error) throw error;
}
