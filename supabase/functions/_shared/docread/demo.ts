// Modo demonstração (sem OPENAI_API_KEY): texto REAL do PDF + regras determinísticas. Foto/PDF sem texto = tudo vazio e incerto.
import { emptyBioFields, extractBio } from "./bio.ts";
import { extractDiet } from "./diet.ts";
import { extractWorkout } from "./workout.ts";
import { checkPatientName } from "./validate.ts";
import { NOTICE_NO_TEXT, NOTICE_PHOTO_NEEDS_AI, type DocKind, type DocReadResult } from "./types.ts";

export interface ReadInput {
  kind: DocKind;
  /** Texto por página (PDF com camada de texto). null = foto ou arquivo sem texto. */
  pages: string[] | null;
  isImage: boolean;
  patientName?: string | null;
  today?: string;
}

const NONE_FOUND: Record<Exclude<DocKind, "bioimpedancia">, string> = {
  dieta: "Não encontrei refeições neste PDF. Nada foi lido; monte o plano alimentar à mão.",
  treino: "Não encontrei exercícios neste PDF. Nada foi lido; monte o treino à mão.",
};

function empty(kind: DocKind, notice: string): DocReadResult {
  return { kind, mode: "demo", groups: [], fields: kind === "bioimpedancia" ? emptyBioFields("Não li o arquivo. Preencha à mão.") : [], notice, warnings: [], unrecognized: [], legible: false };
}

export function readDemo(i: ReadInput): DocReadResult {
  if (i.isImage || !i.pages) return empty(i.kind, NOTICE_PHOTO_NEEDS_AI);
  const total = i.pages.reduce((n, p) => n + p.replace(/\s/g, "").length, 0);
  if (total < 30) return empty(i.kind, NOTICE_NO_TEXT);
  const warn = checkPatientName(i.pages, i.patientName);
  const warnings = warn ? [warn] : [];
  if (i.kind === "bioimpedancia") {
    return { kind: i.kind, mode: "demo", groups: [], fields: extractBio(i.pages, i.today), notice: null, warnings, unrecognized: [], legible: true };
  }
  const r = i.kind === "dieta" ? extractDiet(i.pages) : extractWorkout(i.pages);
  if (r.fields.length === 0) return { ...empty(i.kind, NONE_FOUND[i.kind]), warnings };
  return { kind: i.kind, mode: "demo", groups: r.groups, fields: r.fields, notice: null, warnings, unrecognized: r.unrecognized, legible: true };
}
