// Regras PURAS do lançamento manual de avaliações antropométricas (inclusive antigas). Sem I/O.
export const ASSESSMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "bioimpedancia", label: "Bioimpedância" },
  { value: "adipometro", label: "Adipômetro" },
  { value: "dobras", label: "Dobras cutâneas" },
  { value: "circunferencias", label: "Circunferências" },
  { value: "dexa", label: "DEXA" },
];

/** Circunferências lançáveis (chaves do jsonb `measurements`, em cm). As 3 primeiras já existiam no relatório. */
export const MEASURE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "cintura", label: "Cintura" },
  { key: "quadril", label: "Quadril" },
  { key: "abdomen", label: "Abdômen" },
  { key: "torax", label: "Tórax" },
  { key: "braco", label: "Braço" },
  { key: "coxa", label: "Coxa" },
  { key: "panturrilha", label: "Panturrilha" },
];

export const NOTES_MAX = 1000;
const LIMITS = { weight: [20, 400], fat: [1, 70], measure: [10, 300] } as const;

export interface AssessmentForm {
  day: string; // aaaa-mm-dd
  method: string;
  weight: string;
  bodyFat: string;
  measures: Record<string, string>;
  notes: string;
}

export interface AssessmentPayload {
  assessed_at: string;
  method: string;
  weight: number | null;
  body_fat_pct: number | null;
  measurements: Record<string, unknown> | null;
}

/** "72,5" / "72.5" → 72.5 ; vazio → null ; lixo → NaN. */
export function parseDecimal(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,4}([.]\d{1,2})?$/.test(t)) return Number.NaN;
  return Number(t);
}

function inRange(n: number, [lo, hi]: readonly [number, number]): boolean {
  return n >= lo && n <= hi;
}

export type ValidateResult = { ok: true; value: AssessmentPayload } | { ok: false; error: string };

/**
 * Valida o formulário e monta o payload. `existing` = `measurements` atual da avaliação (na edição),
 * para NÃO perder chaves que o formulário não conhece (ex.: notas antigas, outras medidas).
 */
export function validateAssessment(form: AssessmentForm, today: string, existing?: Record<string, unknown> | null): ValidateResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.day)) return { ok: false, error: "Informe a data da avaliação." };
  if (form.day > today) return { ok: false, error: "A data da avaliação não pode ser futura." };
  if (form.day < "1900-01-01") return { ok: false, error: "Data inválida." };
  if (!ASSESSMENT_METHODS.some((m) => m.value === form.method)) return { ok: false, error: "Escolha o método da avaliação." };

  const weight = parseDecimal(form.weight);
  if (Number.isNaN(weight) || (weight != null && !inRange(weight, LIMITS.weight))) return { ok: false, error: "Peso inválido (entre 20 e 400 kg)." };
  const fat = parseDecimal(form.bodyFat);
  if (Number.isNaN(fat) || (fat != null && !inRange(fat, LIMITS.fat))) return { ok: false, error: "% de gordura inválido (entre 1 e 70)." };

  const meas: Record<string, unknown> = { ...(existing ?? {}) };
  for (const f of MEASURE_FIELDS) {
    const v = parseDecimal(form.measures[f.key]);
    if (Number.isNaN(v) || (v != null && !inRange(v, LIMITS.measure))) return { ok: false, error: `${f.label} inválido (entre 10 e 300 cm).` };
    if (v == null) delete meas[f.key];
    else meas[f.key] = v;
  }
  const notes = form.notes.trim();
  if (notes.length > NOTES_MAX) return { ok: false, error: `As observações passam de ${NOTES_MAX} caracteres.` };
  if (notes) meas.notes = notes;
  else delete meas.notes;

  const hasMeasure = MEASURE_FIELDS.some((f) => meas[f.key] != null);
  if (weight == null && fat == null && !hasMeasure) return { ok: false, error: "Informe ao menos o peso, o % de gordura ou uma circunferência." };

  return {
    ok: true,
    value: {
      assessed_at: form.day,
      method: form.method,
      weight,
      body_fat_pct: fat,
      measurements: Object.keys(meas).length ? meas : null,
    },
  };
}

/** Avaliação existente → formulário (edição). */
export function assessmentToForm(a: { assessed_at: string | null; method: string | null; weight: number | string | null; body_fat_pct: number | string | null; measurements: Record<string, unknown> | null }, today: string): AssessmentForm {
  const m = a.measurements ?? {};
  const str = (v: unknown) => (v == null || v === "" ? "" : String(v).replace(".", ","));
  return {
    day: a.assessed_at ?? today,
    method: a.method && ASSESSMENT_METHODS.some((x) => x.value === a.method) ? a.method : "manual",
    weight: str(a.weight),
    bodyFat: str(a.body_fat_pct),
    measures: Object.fromEntries(MEASURE_FIELDS.map((f) => [f.key, str(m[f.key])])),
    notes: typeof m.notes === "string" ? m.notes : "",
  };
}

export function emptyAssessmentForm(today: string): AssessmentForm {
  return { day: today, method: "manual", weight: "", bodyFat: "", measures: {}, notes: "" };
}
