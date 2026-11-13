// Consulta assistida — estado do prontuário e mescla IA × edição manual.
// Regra: campo editado à mão fica TRAVADO (locked) e a IA nunca o sobrescreve; a IA também nunca
// apaga um campo preenchido com um valor em branco ("campo sem informação fica vazio", não "esvazia").
// O servidor repete a mesma regra em public.clinical_apply_ai_fields (fonte da verdade, atômica).

export interface RecordField {
  value: string;
  /** `ord` dos trechos da transcrição que originaram o valor (para o profissional conferir). */
  sources: number[];
  locked: boolean;
  by?: "ai" | "manual";
  updated_at?: string;
}
export type RecordFields = Record<string, RecordField>;

export interface AiFieldProposal {
  value: string;
  sources: number[];
}
export type AiFields = Record<string, AiFieldProposal>;

export interface MergeResult {
  fields: RecordFields;
  applied: string[];
  skipped: string[];
}

export function mergeAiFields(
  current: RecordFields,
  proposal: AiFields,
  validKeys: ReadonlySet<string>,
  now: string = new Date().toISOString(),
): MergeResult {
  const fields: RecordFields = { ...current };
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [key, p] of Object.entries(proposal)) {
    const value = (p.value ?? "").trim();
    if (!validKeys.has(key) || value === "" || current[key]?.locked) {
      skipped.push(key);
      continue;
    }
    if (current[key]?.value === value) continue;
    fields[key] = { value, sources: p.sources ?? [], locked: false, by: "ai", updated_at: now };
    applied.push(key);
  }
  return { fields, applied, skipped };
}

/** Edição manual: grava e TRAVA o campo para a IA. */
export function applyManualEdit(
  current: RecordFields,
  key: string,
  value: string,
  now: string = new Date().toISOString(),
): RecordFields {
  return {
    ...current,
    [key]: { value, sources: current[key]?.sources ?? [], locked: true, by: "manual", updated_at: now },
  };
}
