// Monta os "fatos" da ficha a partir das linhas lidas com o JWT do profissional (RLS). Sem I/O.
import type { PlanFacts } from "./types.ts";

type Obj = Record<string, unknown>;

const TZ = "America/Sao_Paulo";
export const brDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR", { timeZone: TZ });
};
const brIsoDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });

export function ageFrom(birth: string | null | undefined, now: Date): number | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return null;
  const [by, bm, bd] = birth.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = brIsoDay(now).split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

export function normSex(v: unknown): "f" | "m" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (["f", "fem", "feminino", "female", "mulher"].includes(s)) return "f";
  if (["m", "masc", "masculino", "male", "homem"].includes(s)) return "m";
  return null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function flattenFields(fields: unknown): string {
  if (!fields || typeof fields !== "object") return "";
  const out: string[] = [];
  for (const v of Object.values(fields as Obj)) {
    const t = typeof v === "string" ? v : typeof v === "object" && v !== null ? String((v as Obj).value ?? "") : "";
    if (t.trim()) out.push(t.trim());
  }
  return out.join("\n").slice(0, 8000);
}

export interface FactsInput {
  patient: Obj;
  assessment: Obj | null;
  encounter: Obj | null;
  docs: Obj[];
  notes: string;
  now?: Date;
}

export function buildFacts(i: FactsInput): PlanFacts {
  const now = i.now ?? new Date();
  const aWeight = num(i.assessment?.weight);
  const weightKg = aWeight ?? num(i.patient.current_weight);
  const notes = String(i.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const goal = typeof i.patient.goal === "string" && i.patient.goal.trim() ? i.patient.goal.trim() : null;
  return {
    sex: normSex(i.patient.sex),
    ageYears: ageFrom(i.patient.birth_date as string | null, now),
    heightCm: num(i.patient.height_cm),
    weightKg,
    weightSource: aWeight != null ? `avaliação corporal de ${brDate(String(i.assessment?.assessed_at ?? "")) ?? "data não informada"}` : weightKg != null ? "peso atual da ficha" : null,
    bodyFatPct: num(i.assessment?.body_fat_pct),
    goal,
    targetWeightKg: num(i.patient.target_weight),
    clinicalText: [flattenFields(i.encounter?.final_fields), goal ?? "", notes].filter(Boolean).join("\n"),
    encounterAt: brDate(i.encounter?.finalized_at as string | null),
    examTitles: i.docs.map((d) => String(d.title ?? "").trim()).filter(Boolean).slice(0, 20),
    notes,
  };
}
