// A8 — Primeira versão de dieta e treino pela Vertexa IA: tipos, textos e conversões para os editores existentes.
// A lista padrão de tipos de paciente é ESPELHO de supabase/functions/_shared/planDraft/patientTypes.ts (um teste trava a igualdade).

export type PlanDraftKind = "dieta" | "treino";
export type PlanBaseKey = "emagrecimento" | "hipertrofia" | "recomposicao" | "cardiometabolico" | "abaixo_peso" | "pre_diabetico" | "retomada" | "manutencao";

export interface PatientTypeDef { key: string; label: string; base: PlanBaseKey; hint?: string }

export const BASE_OPTIONS: ReadonlyArray<{ value: PlanBaseKey; label: string }> = [
  { value: "emagrecimento", label: "Emagrecimento" },
  { value: "hipertrofia", label: "Hipertrofia" },
  { value: "recomposicao", label: "Recomposição" },
  { value: "cardiometabolico", label: "Cardiometabólico" },
  { value: "abaixo_peso", label: "Abaixo do peso" },
  { value: "pre_diabetico", label: "Pré-diabético" },
  { value: "retomada", label: "Retomada (iniciante)" },
  { value: "manutencao", label: "Manutenção" },
];

export const DEFAULT_PATIENT_TYPES: readonly PatientTypeDef[] = [
  { key: "emagrecimento", label: "Emagrecimento / acima do peso", base: "emagrecimento", hint: "Déficit moderado, proteína alta e saciedade." },
  { key: "hipertrofia", label: "Hipertrofia / ganho de massa", base: "hipertrofia", hint: "Superávit leve e treino de força dividido." },
  { key: "recomposicao", label: "Falso magro / recomposição", base: "recomposicao", hint: "Calorias de manutenção, proteína alta e treino de força." },
  { key: "cardiometabolico", label: "Cardiometabólico (coração, pressão, gordura visceral)", base: "cardiometabolico", hint: "Plano cardiometabólico: fibras, menos sódio, treino moderado e caminhada." },
  { key: "pre_diabetico", label: "Pré-diabético / resistência à insulina", base: "pre_diabetico", hint: "Carboidrato complexo, mais fibras e treino com cardio leve." },
  { key: "abaixo_peso", label: "Abaixo do peso", base: "abaixo_peso", hint: "Superávit com refeições densas e treino de força." },
  { key: "retomada", label: "Voltando a treinar (pós-maternidade, iniciante)", base: "retomada", hint: "Retomada gradual: dieta de normalização e treino de base." },
  { key: "manutencao", label: "Já treina e come bem (manutenção / base AB)", base: "manutencao", hint: "Treino de base AB/full body e dieta seguível, sem grande déficit." },
];

const BASES = new Set<string>(BASE_OPTIONS.map((b) => b.value));

/** Mesma regra do servidor: item inválido é ignorado; lista vazia/ausente = padrão da reunião. */
export function resolvePatientTypes(raw: unknown): PatientTypeDef[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PATIENT_TYPES];
  const out: PatientTypeDef[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!/^[a-z0-9_]{2,40}$/.test(key) || label.length < 2 || label.length > 80 || typeof o.base !== "string" || !BASES.has(o.base) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, base: o.base as PlanBaseKey, hint: typeof o.hint === "string" ? o.hint.slice(0, 400) : undefined });
  }
  return out.length > 0 ? out : [...DEFAULT_PATIENT_TYPES];
}

/** Chave estável para um tipo novo criado pela clínica (a partir do nome). */
export function typeKeyFromLabel(label: string, taken: readonly string[]): string {
  const slug = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "tipo";
  let key = slug.length >= 2 ? slug : `${slug}_x`;
  let n = 2;
  while (taken.includes(key)) key = `${slug.slice(0, 36)}_${n++}`;
  return key;
}

// ───────── rascunho

export interface DraftMeal { time: string; name: string; items: string[]; calories: number; options: { items: string[]; calories: number | null }[] }
export interface DraftExercise { name: string; muscle_groups: string[]; sets: number; reps: number; load_kg: number | null; notes: string; rest_seconds: number }
export interface DraftWorkout { letter: string; name: string; primary_muscle_group: string; estimated_minutes: number; exercises: DraftExercise[] }
interface PayloadCommon { patientType?: { key: string; label: string; base: PlanBaseKey }; guidance?: string[]; basis?: string[]; warnings?: string[] }
export interface NutritionPayload extends PayloadCommon { kind: "dieta"; title: string; meals: DraftMeal[]; totalKcal: number }
export interface WorkoutPayload extends PayloadCommon { kind: "treino"; title: string; goal: string; workouts: DraftWorkout[] }

export interface AiPlanDraft {
  id: string;
  kind: PlanDraftKind;
  patient_type: string;
  patient_type_label: string;
  mode: "demo" | "openai";
  payload: NutritionPayload | WorkoutPayload;
  status: "pendente" | "usado" | "descartado" | "substituido";
  created_at: string;
}

/** Selo exato mostrado ao profissional (cartão, editor). */
export const draftSeal = (mode: "demo" | "openai") =>
  mode === "demo" ? "Rascunho · gerado pela Vertexa IA (demonstração) · revise antes de publicar" : "Rascunho · gerado pela Vertexa IA · revise antes de publicar";

export const NO_REPLACE_NOTICE = "Este paciente já tem plano ativo. O rascunho NÃO substitui o publicado até você revisar e salvar.";

export function summarizeDraft(d: AiPlanDraft): string {
  if (d.payload.kind === "dieta") return `${d.payload.meals.length} refeições · ${d.payload.totalKcal.toLocaleString("pt-BR")} kcal/dia`;
  const ex = d.payload.workouts.reduce((a, w) => a + w.exercises.length, 0);
  return `${d.payload.workouts.length} treinos (${d.payload.workouts.map((w) => w.letter).join("/")}) · ${ex} exercícios`;
}

// Formas dos formulários dos editores (strings, como digitado).
export interface NutritionFormShape { title: string; meals: { time: string; name: string; items: string; calories: string; options: { items: string; calories: string }[] }[] }
export interface WorkoutFormShape {
  title: string; goal: string;
  workouts: { letter: string; name: string; muscle: string; minutes: string; exercises: { name: string; muscleGroups: string; sets: string; reps: string; load: string; notes: string; rest: string }[] }[];
}

export function nutritionFormFromPayload(p: NutritionPayload): NutritionFormShape {
  return {
    title: p.title,
    meals: p.meals.map((m) => ({
      time: m.time, name: m.name, items: m.items.join("\n"), calories: String(m.calories),
      options: (m.options ?? []).map((o) => ({ items: o.items.join("\n"), calories: o.calories != null ? String(o.calories) : "" })),
    })),
  };
}

export function workoutFormFromPayload(p: WorkoutPayload): WorkoutFormShape {
  return {
    title: p.title, goal: p.goal,
    workouts: p.workouts.map((w) => ({
      letter: w.letter, name: w.name, muscle: w.primary_muscle_group, minutes: String(w.estimated_minutes),
      exercises: w.exercises.map((e) => ({
        name: e.name, muscleGroups: e.muscle_groups.join(", "), sets: String(e.sets), reps: String(e.reps),
        load: e.load_kg != null ? String(e.load_kg) : "", notes: e.notes, rest: String(e.rest_seconds),
      })),
    })),
  };
}

const ERRORS: Record<string, string> = {
  no_discipline: "Só quem tem a disciplina do plano (nutricionista para dieta, educador físico para treino) pode gerar a primeira versão.",
  forbidden: "Seu perfil não tem acesso clínico a este paciente.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  invalid_patient_type: "Esse tipo de paciente não existe mais. Escolha outro.",
  library_unavailable: "A Biblioteca de exercícios não está disponível agora. Tente de novo em instantes.",
  not_deployed: "A Vertexa IA ainda não está ativa neste ambiente.",
};
export const friendlyPlanDraftError = (code: string) => ERRORS[code] ?? "Não consegui gerar o rascunho agora. Nada foi criado ou enviado ao paciente. Tente de novo.";
