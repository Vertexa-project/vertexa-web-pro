// Gerador: modo demonstração (determinístico) por padrão; com OPENAI_API_KEY pede o rascunho ao modelo, valida e,
// se vier inválido 2 vezes, cai no modelo-base (modo 'demo' + aviso). O prompt carrega o MÉTODO DA CLÍNICA (configurável).
import type { BaseKey, DraftMeal, LibraryExercise, NutritionDraft, PatientTypeDef, PlanFacts, PlanKind, WorkoutDraft } from "./types.ts";
import { buildNutritionDraft, estimateEnergy } from "./nutrition.ts";
import { buildWorkoutDraft } from "./workout.ts";
import { detectRestrictions, type Restrictions } from "./restrictions.ts";
import { canonicalizeWorkout, validateNutrition, validateWorkout } from "./validate.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const NUTRITION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "meals"],
  properties: {
    title: { type: "string" },
    meals: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["time", "name", "items", "calories"],
        properties: { time: { type: "string" }, name: { type: "string" }, items: { type: "array", items: { type: "string" } }, calories: { type: "integer" } },
      },
    },
  },
} as const;

export const WORKOUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "goal", "workouts"],
  properties: {
    title: { type: "string" }, goal: { type: "string" },
    workouts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["letter", "name", "primary_muscle_group", "estimated_minutes", "exercises"],
        properties: {
          letter: { type: "string" }, name: { type: "string" }, primary_muscle_group: { type: "string" }, estimated_minutes: { type: "integer" },
          exercises: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["name", "sets", "reps", "rest_seconds", "notes"],
              properties: { name: { type: "string" }, sets: { type: "integer" }, reps: { type: "integer" }, rest_seconds: { type: "integer" }, notes: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export function buildSystemPrompt(kind: PlanKind, method: string | null): string {
  const base = [
    "Você é a Vertexa IA, assistente de um profissional de saúde brasileiro. Escreva em português do Brasil.",
    kind === "dieta"
      ? "Tarefa: montar o RASCUNHO de um plano alimentar. O profissional vai revisar antes de qualquer envio ao paciente."
      : "Tarefa: montar o RASCUNHO de um plano de treino. O profissional vai revisar antes de qualquer envio ao paciente.",
    "Use APENAS os dados fornecidos. Se um dado faltar, não invente: siga o modelo-base do tipo de paciente.",
    "Responda somente com o JSON do formato pedido, sem texto fora dele.",
    kind === "dieta"
      ? "A soma das calorias das refeições deve ficar a menos de 5% da meta calórica informada (a meta foi calculada pelo sistema; não a mude). Quantidades em gramas ou medidas caseiras, itens simples e brasileiros."
      : "Use SOMENTE exercícios da lista da biblioteca, com o nome idêntico. Cada exercício tem séries, repetições inteiras, intervalo em segundos e uma instrução curta de execução (até 200 caracteres). Não prescreva carga.",
    "Respeite as restrições e limitações informadas. Nunca dê diagnóstico nem oriente suspender medicação.",
  ];
  if (method && method.trim()) base.push(`MÉTODO DA CLÍNICA (siga como prioridade, sem violar as regras acima):\n${method.trim().slice(0, 4000)}`);
  return base.join("\n");
}

export function buildUserPrompt(kind: PlanKind, facts: PlanFacts, type: PatientTypeDef, restrictions: Restrictions, extras: { targetKcal?: number; library?: readonly LibraryExercise[] }): string {
  // Sem nome do paciente: a IA não precisa dele.
  const payload: Obj = {
    tipo_de_paciente: { rotulo: type.label, modelo_base: type.base, orientacao: type.hint ?? null },
    dados: {
      sexo: facts.sex, idade_anos: facts.ageYears, altura_cm: facts.heightCm, peso_kg: facts.weightKg, gordura_corporal_pct: facts.bodyFatPct,
      objetivo: facts.goal, peso_meta_kg: facts.targetWeightKg, exames_anexados: facts.examTitles.length,
    },
    restricoes_detectadas: restrictions,
    prontuario_e_observacoes: facts.clinicalText.slice(0, 6000),
  };
  if (kind === "dieta") payload.meta_calorica_kcal = extras.targetKcal ?? null;
  else payload.biblioteca_de_exercicios = (extras.library ?? []).map((e) => `${e.name} (${e.group_key})`);
  return JSON.stringify(payload);
}

export type ModelCall = (system: string, user: string, schemaName: string, schema: unknown) => Promise<unknown>;

export function openaiModelCall(apiKey: string): ModelCall {
  return async (system, user, schemaName, schema) => {
    const model = Deno.env.get("VERTEXA_AI_MODEL") ?? "gpt-4.1-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0.2,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
      }),
    });
    if (!res.ok) throw new Error(`vertexa_provider_${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return JSON.parse(body.choices?.[0]?.message?.content ?? "null");
  };
}

function modelNutrition(raw: unknown, demo: NutritionDraft): NutritionDraft | null {
  if (!isObj(raw) || typeof raw.title !== "string" || !Array.isArray(raw.meals)) return null;
  const meals: DraftMeal[] = [];
  for (const m of raw.meals) {
    if (!isObj(m) || typeof m.time !== "string" || typeof m.name !== "string" || !Array.isArray(m.items) || typeof m.calories !== "number") return null;
    meals.push({ time: m.time, name: m.name, items: m.items.map(String), calories: Math.round(m.calories), options: [] });
  }
  const total = meals.reduce((a, m) => a + m.calories, 0);
  return { ...demo, title: raw.title, meals, totalKcal: total };
}

function modelWorkout(raw: unknown, demo: WorkoutDraft): WorkoutDraft | null {
  if (!isObj(raw) || typeof raw.title !== "string" || !Array.isArray(raw.workouts)) return null;
  const workouts = [];
  for (const w of raw.workouts) {
    if (!isObj(w) || typeof w.name !== "string" || !Array.isArray(w.exercises)) return null;
    const exercises = [];
    for (const e of w.exercises) {
      if (!isObj(e) || typeof e.name !== "string") return null;
      exercises.push({ name: e.name, muscle_groups: [] as string[], sets: Number(e.sets), reps: Number(e.reps), load_kg: null, notes: String(e.notes ?? ""), rest_seconds: Number(e.rest_seconds) });
    }
    workouts.push({ letter: String(w.letter ?? ""), name: w.name, primary_muscle_group: String(w.primary_muscle_group ?? ""), estimated_minutes: Number(w.estimated_minutes) || 45, exercises });
  }
  return { ...demo, title: raw.title, goal: typeof raw.goal === "string" ? raw.goal : demo.goal, workouts };
}

export interface GenerateArgs {
  kind: PlanKind; facts: PlanFacts; type: PatientTypeDef; library: readonly LibraryExercise[];
  method: string | null; call: ModelCall | null;
}
export interface GenerateResult { mode: "demo" | "openai"; payload: Obj }

export async function generateDraft(a: GenerateArgs): Promise<GenerateResult> {
  const restrictions = detectRestrictions(a.facts.clinicalText);
  const common = { patientType: { key: a.type.key, label: a.type.label, base: a.type.base as BaseKey } };

  if (a.kind === "dieta") {
    const demo = buildNutritionDraft({ facts: a.facts, base: a.type.base, typeLabel: a.type.label, restrictions, method: a.method });
    let draft = demo; let mode: "demo" | "openai" = "demo";
    if (a.call) {
      const user = buildUserPrompt("dieta", a.facts, a.type, restrictions, { targetKcal: estimateEnergy(a.facts, a.type.base).target });
      let ok = false;
      for (let i = 0; i < 2 && !ok; i++) {
        try {
          const cand = modelNutrition(await a.call(buildSystemPrompt("dieta", a.method), user, "vertexa_dieta", NUTRITION_SCHEMA), demo);
          if (cand && validateNutrition(cand).length === 0) { draft = cand; mode = "openai"; ok = true; }
        } catch (_e) { /* tenta de novo uma vez */ }
      }
      if (!ok) draft = { ...demo, warnings: [...demo.warnings, "A IA não respondeu no formato esperado; usei o modelo-base do tipo de paciente."] };
    }
    if (validateNutrition(draft).length > 0) draft = demo;
    return { mode, payload: { ...common, kind: "dieta", ...draft } as unknown as Obj };
  }

  const demo = buildWorkoutDraft({ facts: a.facts, base: a.type.base, typeLabel: a.type.label, restrictions, library: a.library });
  let draft = demo; let mode: "demo" | "openai" = "demo";
  if (a.call) {
    const user = buildUserPrompt("treino", a.facts, a.type, restrictions, { library: a.library });
    let ok = false;
    for (let i = 0; i < 2 && !ok; i++) {
      try {
        const cand = modelWorkout(await a.call(buildSystemPrompt("treino", a.method), user, "vertexa_treino", WORKOUT_SCHEMA), demo);
        if (cand) {
          canonicalizeWorkout(cand, a.library);
          if (validateWorkout(cand, a.library).length === 0) { draft = cand; mode = "openai"; ok = true; }
        }
      } catch (_e) { /* tenta de novo uma vez */ }
    }
    if (!ok) draft = { ...demo, warnings: [...demo.warnings, "A IA não respondeu no formato esperado; usei o modelo-base do tipo de paciente."] };
  }
  if (validateWorkout(draft, a.library).length > 0) throw new Error("draft_invalid");
  return { mode, payload: { ...common, kind: "treino", ...draft } as unknown as Obj };
}
