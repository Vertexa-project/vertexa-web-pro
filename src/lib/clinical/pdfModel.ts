// Modelo do PDF do atendimento: só o que tem conteúdo (campo vazio e seção vazia não saem).
import type { RecordFields } from "../../../supabase/functions/_shared/clinical/record";
import { fieldKey, type TemplateSection } from "../../../supabase/functions/_shared/clinical/template";
import { formatDateTimeBr, professionalSectionValues } from "./display";
import type { Addendum, EncounterPeople } from "@/lib/api/clinical";

export interface PdfRow {
  label: string;
  lines: string[];
}
export interface PdfSection {
  title: string;
  rows: PdfRow[];
}
export interface EncounterPdfData {
  patientName: string;
  clinicName: string;
  professionalName: string;
  startedAt: string;
  finalizedAt: string | null;
  emittedAt: string;
  demo: boolean;
  sections: PdfSection[];
  professional: Array<{ label: string; value: string }>;
  addenda: Array<{ author: string; date: string; text: string }>;
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function buildEncounterPdfData(input: {
  patientName: string;
  clinicName: string;
  sections: TemplateSection[];
  fields: RecordFields;
  people: EncounterPeople | null | undefined;
  startedAt: string;
  finalizedAt: string | null;
  demo: boolean;
  addenda: Addendum[];
  now?: Date;
}): EncounterPdfData {
  const sections: PdfSection[] = [];
  for (const s of input.sections) {
    if (s.system) continue;
    const rows: PdfRow[] = [];
    for (const f of s.fields) {
      const v = input.fields[fieldKey(s.id, f.id)]?.value ?? "";
      const lines = splitLines(v);
      if (lines.length > 0) rows.push({ label: f.label, lines });
    }
    if (rows.length > 0) sections.push({ title: s.title, rows });
  }
  return {
    patientName: input.patientName,
    clinicName: input.clinicName,
    professionalName: input.people?.professional ?? "—",
    startedAt: formatDateTimeBr(input.startedAt),
    finalizedAt: input.finalizedAt ? formatDateTimeBr(input.finalizedAt) : null,
    emittedAt: formatDateTimeBr((input.now ?? new Date()).toISOString()),
    demo: input.demo,
    sections,
    professional: professionalSectionValues(input.people, input.startedAt),
    addenda: input.addenda.map((a) => ({ author: a.author ?? "—", date: formatDateTimeBr(a.created_at), text: a.text })),
  };
}

export function encounterPdfFilename(patientName: string, startedAt: string): string {
  const slug =
    patientName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .toLowerCase() || "paciente";
  return `prontuario-${slug}-${startedAt.slice(0, 10)}.pdf`;
}
