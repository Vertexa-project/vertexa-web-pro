// A8 — Primeira versão de dieta e treino pela Vertexa IA. Tipos compartilhados (Deno + Vitest). Sem I/O.
export const BASE_KEYS = [
  "emagrecimento", "hipertrofia", "recomposicao", "cardiometabolico", "abaixo_peso", "pre_diabetico", "retomada", "manutencao",
] as const;
export type BaseKey = (typeof BASE_KEYS)[number];

/** Tipo de paciente. `base` escolhe o modelo-base; `key`/`label`/`hint` a clínica edita em Configurações. */
export interface PatientTypeDef { key: string; label: string; base: BaseKey; hint?: string }

export type PlanKind = "dieta" | "treino";

/** Fatos REAIS da ficha (nada inventado). Campo ausente = null; o rascunho avisa o que faltou. */
export interface PlanFacts {
  sex: "f" | "m" | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  weightSource: string | null; // "avaliação corporal de 03/11/2026" | "peso atual da ficha"
  bodyFatPct: number | null;
  goal: string | null;
  targetWeightKg: number | null;
  /** Texto do prontuário finalizado + observações do profissional (só para detectar restrições; não vai ao log). */
  clinicalText: string;
  /** Rótulos dos campos do prontuário que existiam (para a lista "o que usei"). */
  encounterAt: string | null;
  examTitles: string[];
  /** Observações digitadas pelo profissional ao gerar (restrições, lesões, preferências). */
  notes: string;
}

export interface DraftMealOption { items: string[]; calories: number | null }
export interface DraftMeal { time: string; name: string; items: string[]; calories: number; options: DraftMealOption[] }
export interface DraftBasics { guidance: string[]; basis: string[]; warnings: string[] }

export interface NutritionDraft extends DraftBasics { title: string; meals: DraftMeal[]; totalKcal: number }

export interface DraftExercise {
  name: string; muscle_groups: string[]; sets: number; reps: number; load_kg: number | null; notes: string; rest_seconds: number;
}
export interface DraftWorkout { letter: string; name: string; primary_muscle_group: string; estimated_minutes: number; exercises: DraftExercise[] }
export interface WorkoutDraft extends DraftBasics { title: string; goal: string; workouts: DraftWorkout[] }

export interface LibraryExercise { id: string; name: string; group_key: string; group_label: string; sort_order?: number }
