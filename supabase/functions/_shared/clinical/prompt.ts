// Consulta assistida — prompt de estruturação do prontuário (VERSIONADO; mudar = nova versão).
import type { TemplateSection } from "./template.ts";
import { fieldKey } from "./template.ts";
import type { RecordFields } from "./record.ts";

export const STRUCTURE_PROMPT_VERSION = "v1-2026-11";

export interface PromptSegment {
  ord: number;
  speaker: string | null;
  text: string;
}

export function buildSystemPrompt(): string {
  return [
    "Você é um assistente que organiza a transcrição de uma consulta clínica em português do Brasil num prontuário estruturado.",
    "Regras obrigatórias:",
    "1. Use SOMENTE o que foi dito na conversa. Não invente, não deduza diagnóstico, dose, exame ou prazo que não foi falado.",
    "2. Campo sem informação na conversa: devolva value vazio (\"\") e sources vazio ([]).",
    "3. Cada campo preenchido deve citar em `sources` o `ord` dos trechos da transcrição de onde veio a informação.",
    "4. Escreva de forma objetiva, em linguagem de prontuário, em português. Listas: uma linha por item.",
    "5. Em 'combinados', registre o que cada pessoa (profissional ou paciente) vai enviar/fazer e até quando, só se foi dito.",
    "6. Responda apenas com o JSON do esquema pedido.",
    `(prompt ${STRUCTURE_PROMPT_VERSION})`,
  ].join("\n");
}

export function buildUserPrompt(
  sections: TemplateSection[],
  segments: PromptSegment[],
  current: RecordFields,
): string {
  const schemaLines = sections.flatMap((s) =>
    s.fields.map((f) => `- ${fieldKey(s.id, f.id)}: ${s.title} / ${f.label}`),
  );
  const transcript = segments.map((g) => `[${g.ord}] ${g.speaker ? g.speaker + ": " : ""}${g.text}`).join("\n");
  const locked = Object.entries(current)
    .filter(([, v]) => v.locked)
    .map(([k]) => k);
  return [
    "Campos do prontuário (chave: seção / campo):",
    ...schemaLines,
    "",
    locked.length ? `Campos já editados pelo profissional (não preencha): ${locked.join(", ")}` : "",
    "",
    "Transcrição até agora ([ord] fala):",
    transcript || "(vazia)",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
