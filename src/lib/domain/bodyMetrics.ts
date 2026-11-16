// Regras PURAS de medidas corporais: altura, IMC e peso "atual" (fonte única). Sem I/O.
import type { WeightPoint } from "@/types/db";

/** Faixa de peso aceita como medida válida (mesma do lançamento de avaliação). */
export const WEIGHT_VALID_RANGE = [20, 400] as const;

/**
 * Altura em cm. Cadastros antigos gravaram metros em `height_cm` (ex.: 1,81):
 * valor < 3 => metros (×100); >= 3 => já em cm. Fora de 50–260 cm => inválida (null).
 */
export function normalizeHeightCm(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : raw;
  if (!Number.isFinite(n) || n <= 0) return null;
  const cm = n < 3 ? n * 100 : n;
  return cm >= 50 && cm <= 260 ? cm : null;
}

/** IMC (kg/m²) com a altura normalizada; null se faltar peso/altura válidos. */
export function computeBmi(weightKg: number | null | undefined, heightRaw: number | string | null | undefined): number | null {
  const cm = normalizeHeightCm(heightRaw);
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0 || cm == null) return null;
  const m = cm / 100;
  return weightKg / (m * m);
}

export function isValidWeight(kg: number | null | undefined): kg is number {
  return kg != null && Number.isFinite(kg) && kg >= WEIGHT_VALID_RANGE[0] && kg <= WEIGHT_VALID_RANGE[1];
}

export interface WeightSummary {
  /** Primeira medida válida (ou peso inicial do cadastro). */
  start: number | null;
  /** Última medida válida por data de medição (ou fallback do cadastro). */
  current: number | null;
  /** current − start; null se faltar um dos dois. */
  delta: number | null;
  /** Data (ISO) da medida usada em `current`; null se vier do cadastro. */
  currentDate: string | null;
  source: "series" | "registration" | "none";
}

interface RegistrationWeights {
  start_weight?: number | null;
  current_weight?: number | null;
}

/**
 * FONTE ÚNICA do peso do paciente: última medida válida da série (avaliações + registros do app)
 * pela data de medição; sem série válida, cai para o peso inicial do cadastro (depois o atual do cadastro).
 * Variação = última válida − primeira válida.
 */
export function summarizeWeight(points: ReadonlyArray<WeightPoint> | null | undefined, reg?: RegistrationWeights | null): WeightSummary {
  const valid = (points ?? [])
    .filter((p) => isValidWeight(p.weight) && !Number.isNaN(new Date(p.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (valid.length > 0) {
    const first = valid[0];
    const last = valid[valid.length - 1];
    return { start: first.weight, current: last.weight, delta: last.weight - first.weight, currentDate: last.date, source: "series" };
  }
  const fallback = [reg?.start_weight, reg?.current_weight].find(isValidWeight) ?? null;
  return { start: fallback, current: fallback, delta: fallback != null ? 0 : null, currentDate: null, source: fallback != null ? "registration" : "none" };
}
