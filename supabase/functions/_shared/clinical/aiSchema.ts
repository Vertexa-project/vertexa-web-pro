// Consulta assistida — contrato da resposta da IA (JSON validado). Sem dependência externa (zod
// não existe no projeto): validação explícita, usada nas Edge Functions e nos testes.
import type { AiFields } from "./record.ts";
import type { TemplateSection } from "./template.ts";
import { fieldKey } from "./template.ts";

export const MAX_FIELD_CHARS = 4000;
export const MAX_SOURCES = 20;

export type ValidationResult = { ok: true; fields: AiFields } | { ok: false; errors: string[] };

/** Valida a saída bruta do modelo: `{ fields: { "<secao>.<campo>": { value, sources } } }`. */
export function validateAiOutput(
  raw: unknown,
  validKeys: ReadonlySet<string>,
  validOrds: ReadonlySet<number>,
): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["raiz não é um objeto"] };
  const root = (raw as { fields?: unknown }).fields;
  if (!root || typeof root !== "object" || Array.isArray(root)) return { ok: false, errors: ["campo 'fields' ausente"] };

  const out: AiFields = {};
  for (const [key, entry] of Object.entries(root as Record<string, unknown>)) {
    if (!validKeys.has(key)) {
      errors.push(`campo desconhecido: ${key}`);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${key}: entrada inválida`);
      continue;
    }
    const { value, sources } = entry as { value?: unknown; sources?: unknown };
    if (typeof value !== "string") {
      errors.push(`${key}: value não é texto`);
      continue;
    }
    if (value.length > MAX_FIELD_CHARS) {
      errors.push(`${key}: texto longo demais`);
      continue;
    }
    if (!Array.isArray(sources) || sources.length > MAX_SOURCES || !sources.every((s) => Number.isInteger(s))) {
      errors.push(`${key}: sources inválido`);
      continue;
    }
    const srcs = sources as number[];
    if (srcs.some((s) => !validOrds.has(s))) {
      errors.push(`${key}: sources cita trecho que não existe`);
      continue;
    }
    const trimmed = value.trim();
    // Nada inventado: valor preenchido sem trecho de origem é recusado.
    if (trimmed !== "" && srcs.length === 0) {
      errors.push(`${key}: valor sem trecho de origem`);
      continue;
    }
    out[key] = { value: trimmed, sources: [...new Set(srcs)].sort((a, b) => a - b) };
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields: out };
}

/** JSON Schema (modo estrito de saída estruturada) para o mesmo contrato. */
export function buildJsonSchema(sections: TemplateSection[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const s of sections) {
    for (const f of s.fields) {
      const key = fieldKey(s.id, f.id);
      props[key] = {
        type: "object",
        additionalProperties: false,
        required: ["value", "sources"],
        properties: {
          value: { type: "string" },
          sources: { type: "array", items: { type: "integer" } },
        },
      };
      required.push(key);
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["fields"],
    properties: { fields: { type: "object", additionalProperties: false, required, properties: props } },
  };
}
