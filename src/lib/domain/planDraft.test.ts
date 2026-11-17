import { describe, expect, it } from "vitest";

import { DEFAULT_PATIENT_TYPES as SERVER_TYPES } from "../../../supabase/functions/_shared/planDraft/patientTypes";
import {
  DEFAULT_PATIENT_TYPES, draftSeal, friendlyPlanDraftError, nutritionFormFromPayload, resolvePatientTypes, summarizeDraft, typeKeyFromLabel,
  workoutFormFromPayload, type AiPlanDraft, type NutritionPayload, type WorkoutPayload,
} from "./planDraft";

describe("planDraft (A8)", () => {
  it("a lista padrão do painel é idêntica à do servidor (um único padrão)", () => {
    expect(DEFAULT_PATIENT_TYPES).toEqual(SERVER_TYPES);
  });
  it("selo exato, com e sem modo demonstração", () => {
    expect(draftSeal("demo")).toBe("Rascunho · gerado pela Vertexa IA (demonstração) · revise antes de publicar");
    expect(draftSeal("openai")).toBe("Rascunho · gerado pela Vertexa IA · revise antes de publicar");
  });
  it("lista da clínica vale; inválidos saem; vazia volta ao padrão", () => {
    expect(resolvePatientTypes([{ key: "gestante", label: "Gestante", base: "retomada" }, { key: "Ruim!", label: "x", base: "retomada" }]).map((t) => t.key)).toEqual(["gestante"]);
    expect(resolvePatientTypes(undefined)).toEqual([...DEFAULT_PATIENT_TYPES]);
    expect(resolvePatientTypes([])).toEqual([...DEFAULT_PATIENT_TYPES]);
  });
  it("chave de tipo novo: sem acento, única e válida", () => {
    expect(typeKeyFromLabel("Gestação & Pós-parto", [])).toBe("gestacao_pos_parto");
    expect(typeKeyFromLabel("Gestação & Pós-parto", ["gestacao_pos_parto"])).toBe("gestacao_pos_parto_2");
    expect(typeKeyFromLabel("???", [])).toMatch(/^[a-z0-9_]{2,40}$/);
  });
  const nutri: NutritionPayload = { kind: "dieta", title: "Plano 1.800 kcal", totalKcal: 1800, meals: [{ time: "07:00", name: "Café", items: ["2 ovos", "Pão"], calories: 400, options: [{ items: ["Iogurte"], calories: 380 }] }] };
  const treino: WorkoutPayload = { kind: "treino", title: "Treino A/B", goal: "Emagrecimento", workouts: [{ letter: "A", name: "Inferiores", primary_muscle_group: "quadriceps", estimated_minutes: 45, exercises: [{ name: "Agachamento goblet", muscle_groups: ["quadriceps"], sets: 3, reps: 12, load_kg: null, notes: "Desça devagar.", rest_seconds: 60 }] }] };
  it("converte o rascunho para o formato dos editores (um item por linha, números como texto)", () => {
    const f = nutritionFormFromPayload(nutri);
    expect(f.meals[0]).toEqual({ time: "07:00", name: "Café", items: "2 ovos\nPão", calories: "400", options: [{ items: "Iogurte", calories: "380" }] });
    const w = workoutFormFromPayload(treino);
    expect(w.workouts[0].exercises[0]).toEqual({ name: "Agachamento goblet", muscleGroups: "quadriceps", sets: "3", reps: "12", load: "", notes: "Desça devagar.", rest: "60" });
  });
  it("resumo e erros em português", () => {
    const mk = (payload: AiPlanDraft["payload"], kind: "dieta" | "treino"): AiPlanDraft => ({ id: "d", kind, patient_type: "x", patient_type_label: "X", mode: "demo", payload, status: "pendente", created_at: "2026-11-17T12:00:00Z" });
    expect(summarizeDraft(mk(nutri, "dieta"))).toBe("1 refeições · 1.800 kcal/dia");
    expect(summarizeDraft(mk(treino, "treino"))).toBe("1 treinos (A) · 1 exercícios");
    expect(friendlyPlanDraftError("no_discipline")).toContain("disciplina");
    expect(friendlyPlanDraftError("qualquer")).toContain("Nada foi criado");
  });
});
