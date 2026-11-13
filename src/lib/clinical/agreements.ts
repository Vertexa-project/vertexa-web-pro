import type { RecordFields } from "../../../supabase/functions/_shared/clinical/record";
import { AGREEMENTS_KEY, RETURN_KEY } from "../../../supabase/functions/_shared/clinical/template";

/** Texto inicial dos combinados enviados ao paciente: o campo "Combinados" + retorno, para o profissional revisar. */
export function agreementsDraft(fields: RecordFields): string {
  const base = fields[AGREEMENTS_KEY]?.value?.trim() ?? "";
  const ret = fields[RETURN_KEY]?.value?.trim();
  return [base, ret ? `Próximo retorno: ${ret}` : ""].filter(Boolean).join("\n\n");
}
