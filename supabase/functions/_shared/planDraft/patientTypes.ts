// Lista PADRÃO de tipos de paciente (reunião de 28/10 com a Juliana: "acima do peso, abaixo do peso, problema no coração…",
// pré-diabético, "falso magro", voltando depois da maternidade, treino de base AB para quem já tem hábito).
// A clínica troca/amplia em Configurações (clinic_plan_draft_config.patient_types); sem configuração vale esta.
import { BASE_KEYS, type BaseKey, type PatientTypeDef } from "./types.ts";

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

const isBase = (v: unknown): v is BaseKey => typeof v === "string" && (BASE_KEYS as readonly string[]).includes(v);

/** Normaliza a lista da clínica; qualquer item inválido é ignorado. Vazia/ausente = padrão. */
export function resolvePatientTypes(raw: unknown): PatientTypeDef[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PATIENT_TYPES];
  const out: PatientTypeDef[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!/^[a-z0-9_]{2,40}$/.test(key) || label.length < 2 || label.length > 80 || !isBase(o.base) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, base: o.base, hint: typeof o.hint === "string" ? o.hint.slice(0, 400) : undefined });
  }
  return out.length > 0 ? out : [...DEFAULT_PATIENT_TYPES];
}

export const BASE_LABEL: Record<BaseKey, string> = {
  emagrecimento: "Emagrecimento", hipertrofia: "Hipertrofia", recomposicao: "Recomposição", cardiometabolico: "Cardiometabólico",
  abaixo_peso: "Abaixo do peso", pre_diabetico: "Pré-diabético", retomada: "Retomada", manutencao: "Manutenção",
};
