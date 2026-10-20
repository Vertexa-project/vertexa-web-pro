// Validação PURA do formulário de suplemento/medicamento (espelha as constraints do banco).
export type SupplementKind = "supplement" | "medication";
export const KIND_LABEL: Record<SupplementKind, string> = { supplement: "Suplemento", medication: "Medicamento" };
export const BRAND_MAX = 80;
export const NOTES_MAX = 300;
export const DOSE_MAX = 80;

export interface SupplementForm {
  name: string;
  dose: string;
  timeLabel: string;
  brand: string;
  notes: string;
  reminderTime: string; // "HH:MM" ou ""
}

export interface SupplementPayload {
  name: string;
  dose: string | null;
  timeLabel: string | null;
  brand: string | null;
  notes: string | null;
  reminderTime: string | null; // "HH:MM:00"
}

export const emptySupplementForm = (): SupplementForm => ({ name: "", dose: "", timeLabel: "", brand: "", notes: "", reminderTime: "" });

/** "08:30" ou "8:30:00" → "08:30:00"; vazio → null; inválido → undefined. */
export function normalizeReminderTime(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

export function reminderToInput(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : "";
}

export type SupplementValidation = { ok: true; value: SupplementPayload } | { ok: false; error: string };

export function validateSupplement(form: SupplementForm, kind: SupplementKind): SupplementValidation {
  const label = KIND_LABEL[kind].toLowerCase();
  const name = form.name.trim();
  if (!name) return { ok: false, error: `Informe o nome do ${label}.` };
  if (name.length > 120) return { ok: false, error: "O nome é muito longo (máx. 120)." };
  if (form.dose.trim().length > DOSE_MAX) return { ok: false, error: `A dose passa de ${DOSE_MAX} caracteres.` };
  if (form.brand.trim().length > BRAND_MAX) return { ok: false, error: `A marca passa de ${BRAND_MAX} caracteres.` };
  if (form.notes.trim().length > NOTES_MAX) return { ok: false, error: `A observação passa de ${NOTES_MAX} caracteres.` };
  const reminder = normalizeReminderTime(form.reminderTime);
  if (reminder === undefined) return { ok: false, error: "Horário do lembrete inválido. Use o formato HH:MM." };
  return {
    ok: true,
    value: {
      name,
      dose: form.dose.trim() || null,
      timeLabel: form.timeLabel.trim() || null,
      brand: form.brand.trim() || null,
      notes: form.notes.trim() || null,
      reminderTime: reminder,
    },
  };
}
