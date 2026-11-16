// Ler PDF/foto (redesign P5) — regras PURAS da tela de Conferência: o que bloqueia o "Confirmar", quantos campos foram
// corrigidos e como o rascunho conferido vira os payloads dos caminhos de gravação que JÁ existem. Sem I/O.
import { hasClinicalAccess } from "../../../supabase/functions/_shared/docread/access";
import { parseDateBR, parseNumberBR, stripAccents } from "../../../supabase/functions/_shared/docread/numbers";
import { validateValue } from "../../../supabase/functions/_shared/docread/validate";
import type { DocKind, DocReadResult, ReadField } from "../../../supabase/functions/_shared/docread/types";
import { validateAssessment, type AssessmentForm, type ValidateResult } from "@/lib/domain/anthropometry";
import { canWriteSurface, DISCIPLINE_REASON, type DisciplinePermissions, type ScopedSurface } from "@/lib/domain/disciplines";
import type { MealInput } from "@/lib/api/planMutations";
import type { WorkoutInput } from "@/lib/api/planMutations";

export type { DocKind, DocReadResult, ReadField };

export const DOC_KIND_SURFACE: Record<DocKind, ScopedSurface> = {
  bioimpedancia: "bodyAssessment",
  dieta: "nutrition",
  treino: "workout",
};

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  bioimpedancia: "Bioimpedância",
  dieta: "Plano alimentar",
  treino: "Treino",
};

export const IMPORT_BUTTON_LABEL: Record<DocKind, string> = {
  bioimpedancia: "Importar bioimpedância (PDF ou foto)",
  dieta: "Importar dieta de PDF",
  treino: "Importar treino de PDF",
};

/** Texto fixo do selo do modo demonstração (sem OPENAI_API_KEY). */
export const DEMO_BADGE = "Modo demonstração: leio só PDFs com texto, por regras simples, até a Vertexa IA ser ativada neste ambiente.";

export interface ImportAccess {
  /** Papel clínico (Recepção/Financeiro/Estoquista = false). */
  clinical: boolean;
  /** Pode escrever o que o documento vira (disciplina). */
  canWrite: boolean;
  /** Mostra o botão? Sem papel clínico some; sem disciplina aparece travado com o motivo. */
  visible: boolean;
  reason: string | null;
}

/** Quem vê/usa o botão. A função e a RLS decidem de novo no servidor. */
export function importAccess(kind: DocKind, perms: DisciplinePermissions, isAdmin: boolean, staffRoles: string[], loading = false): ImportAccess {
  const clinical = !loading && hasClinicalAccess(isAdmin, staffRoles);
  const surface = DOC_KIND_SURFACE[kind];
  const canWrite = clinical && canWriteSurface(perms, surface);
  return { clinical, canWrite, visible: clinical, reason: canWrite ? null : DISCIPLINE_REASON[surface] };
}

// ───────────────────────── estado da Conferência
export interface ConferenceState {
  values: Record<string, string>;
  /** Campo incerto que o profissional tocou e confirmou. */
  checked: Record<string, boolean>;
}

export function initConference(result: DocReadResult): ConferenceState {
  return {
    values: Object.fromEntries(result.fields.map((f) => [f.key, f.value ?? ""])),
    checked: {},
  };
}

/** Editar um incerto tira o "conferido": o novo valor precisa ser confirmado de novo. */
export function setFieldValue(result: DocReadResult, st: ConferenceState, key: string, value: string): ConferenceState {
  const f = result.fields.find((x) => x.key === key);
  if (!f) return st;
  const checked = { ...st.checked };
  if (f.uncertain) delete checked[key];
  return { values: { ...st.values, [key]: value }, checked };
}

export function fieldError(kind: DocKind, f: ReadField, st: ConferenceState, today: string): string | null {
  return validateValue(kind, f.key, st.values[f.key], f.required, today);
}

/** Confirma um incerto (só se o valor atual é aceito pelas regras). */
export function markChecked(kind: DocKind, result: DocReadResult, st: ConferenceState, key: string, today: string): ConferenceState {
  const f = result.fields.find((x) => x.key === key);
  if (!f || fieldError(kind, f, st, today)) return st;
  return { ...st, checked: { ...st.checked, [key]: true } };
}

/** Escolher uma das alternativas lidas já conta como conferido. */
export function pickOption(kind: DocKind, result: DocReadResult, st: ConferenceState, key: string, option: string, today: string): ConferenceState {
  return markChecked(kind, result, setFieldValue(result, st, key, option), key, today);
}

export interface ConferenceStatus {
  /** Incertos que ainda não foram conferidos. */
  pending: string[];
  /** Campos (certos ou incertos) com valor recusado pelas regras. */
  invalid: string[];
  canConfirm: boolean;
  /** Mensagem do rodapé (como no protótipo: "Revise 2 campos para liberar"). */
  hint: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function conferenceStatus(kind: DocKind, result: DocReadResult, st: ConferenceState, today: string): ConferenceStatus {
  const pending = result.fields.filter((f) => f.uncertain && !st.checked[f.key]).map((f) => f.key);
  const invalid = result.fields.filter((f) => fieldError(kind, f, st, today) != null).map((f) => f.key);
  const nothing = result.fields.length === 0;
  const invalidOnly = invalid.filter((k) => !pending.includes(k));
  let hint = "";
  if (nothing) hint = "Nada foi lido neste arquivo. Cancele e monte à mão.";
  else if (pending.length > 0) hint = `Revise ${pending.length} ${plural(pending.length, "campo", "campos")} em laranja para liberar.`;
  else if (invalidOnly.length > 0) hint = `Corrija ${invalidOnly.length} ${plural(invalidOnly.length, "campo", "campos")} com valor inválido.`;
  else hint = kind === "bioimpedancia" ? "Tudo conferido. Nada foi salvo ainda." : "Tudo conferido. O plano atual será substituído ao confirmar.";
  return { pending, invalid, canConfirm: !nothing && pending.length === 0 && invalid.length === 0, hint };
}

/** Quantos campos o profissional mudou em relação ao que foi lido (só o número, nunca os valores). */
export function correctedCount(result: DocReadResult, st: ConferenceState): number {
  const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  return result.fields.filter((f) => norm(st.values[f.key]) !== norm(f.value)).length;
}

// ───────────────────────── Conferência → caminhos existentes
const isoOf = (br: string) => parseDateBR(br);

/** Bioimpedância → payload de body_assessments (mesma validação do lançamento manual; extras vão em measurements). */
export function buildAssessment(st: ConferenceState, today: string): ValidateResult {
  const v = (k: string) => (st.values[k] ?? "").trim();
  const day = isoOf(v("data")) ?? "";
  const extras: Record<string, unknown> = {};
  const put = (k: string, name: string, integer = false) => {
    const n = parseNumberBR(v(k), { integer });
    if (n != null) extras[name] = n;
  };
  put("massa_magra", "massa_magra_kg");
  put("massa_muscular", "massa_muscular_kg");
  put("agua", "agua_corporal_l");
  put("gordura_visceral", "gordura_visceral_nivel", true);
  put("tmb", "tmb_kcal", true);
  const form: AssessmentForm = {
    day,
    method: "bioimpedancia",
    weight: v("peso"),
    bodyFat: v("gordura_pct"),
    measures: { cintura: v("cintura"), quadril: v("quadril"), abdomen: v("abdomen") },
    notes: "Importada de documento e conferida pelo profissional.",
  };
  return validateAssessment(form, today, extras);
}

const fmtQty = (label: string, qty: string) => (qty.trim() ? `${label} — ${qty.trim()}` : label);

/** Dieta → refeições do plano alimentar (as mesmas de saveNutritionPlan). */
export function buildMeals(result: DocReadResult, st: ConferenceState): MealInput[] {
  return result.groups.map((g) => {
    const items = result.fields.filter((f) => f.group === g.id && /\.i\d+$/.test(f.key));
    const time = (st.values[`${g.id}.time`] ?? "").trim();
    const kcal = parseNumberBR(st.values[`${g.id}.kcal`] ?? "", { integer: true });
    const m = /^(\d{1,2})[:h](\d{2})$/.exec(time);
    return {
      time: m ? `${m[1].padStart(2, "0")}:${m[2]}` : null,
      name: g.title,
      items: items.map((f) => fmtQty(f.label, st.values[f.key] ?? "")),
      calories: kcal,
    };
  });
}

const MUSCLE_HINTS: Array<[string, RegExp]> = [
  ["chest", /peito|supino|crucifixo|peck|crossover/],
  ["triceps", /triceps|testa|frances/],
  ["biceps", /biceps|rosca/],
  ["lats", /costas|puxada|remada|dorsal|barra fixa|pulldown/],
  ["shoulders", /ombro|desenvolvimento|elevacao lateral|elevacao frontal/],
  ["quadriceps", /quadriceps|agachamento|leg press|extensora|afundo|perna/],
  ["hamstrings", /posterior|flexora|stiff|mesa flexora/],
  ["glutes", /gluteo|elevacao pelvica|hip thrust/],
  ["calves", /panturrilha|gemeos/],
  ["abs", /abdomen|abdominal|prancha/],
  ["traps", /trapezio|encolhimento/],
  ["lower_back", /lombar/],
  ["forearms", /antebraco/],
];

/** Grupos musculares por palavra-chave, na ordem em que aparecem no texto (só quando o nome deixa claro; senão vazio — nunca chuta). */
export function inferMuscles(text: string): string[] {
  const t = stripAccents(text);
  return MUSCLE_HINTS.map(([k, re]) => [k, t.search(re)] as const)
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k);
}

/** Treino → dias do plano de treino (os mesmos de saveWorkoutPlan). */
export function buildWorkouts(result: DocReadResult, st: ConferenceState): WorkoutInput[] {
  return result.groups.map((g) => {
    const letter = /^Treino ([A-F])$/.exec(g.title)?.[1] ?? null;
    const exKeys = [...new Set(result.fields.filter((f) => f.group === g.id).map((f) => f.key.split(".").slice(0, 2).join(".")))];
    const exercises = exKeys.map((ek) => {
      const label = result.fields.find((f) => f.key === `${ek}.sets`)?.label ?? ek;
      const name = label.split(" · ")[0].trim();
      const int = (k: string) => parseNumberBR(st.values[`${ek}.${k}`] ?? "", { integer: true });
      const load = parseNumberBR(st.values[`${ek}.load`] ?? "");
      return { name, muscle_groups: inferMuscles(name), sets: int("sets"), reps: int("reps"), load_kg: load != null && load > 0 ? load : null };
    });
    const main = inferMuscles(`${g.subtitle ?? ""} ${g.title}`)[0] ?? exercises.flatMap((e) => e.muscle_groups)[0] ?? null;
    return { letter, name: g.subtitle?.trim() || g.title, primary_muscle_group: main, estimated_minutes: null, exercises };
  });
}

export const IMPORTED_PLAN_TITLE: Record<Exclude<DocKind, "bioimpedancia">, string> = {
  dieta: "Plano alimentar importado",
  treino: "Treino importado",
};

/** Texto do título do documento em Documentos (a origem fica no nome: "lido pela Vertexa IA, conferido"). */
export function documentTitle(kind: DocKind, mode: "demo" | "openai", dateIso: string): string {
  const [y, m, d] = dateIso.split("-");
  return `${DOC_KIND_LABEL[kind]} · lido pela Vertexa IA${mode === "demo" ? " (demonstração)" : ""}, conferido em ${d}/${m}/${y}`;
}
