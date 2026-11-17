// Controle de aplicação de medicação (A3). Regras puras: rótulos, validação, texto de estado e mensagens de erro.
// O estado "hoje/atrasada" é calculado no banco (America/Sao_Paulo); aqui só se apresenta.

export const DEFAULT_MEDICATION = "Tirzepatida";
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export type MedPlace = "home" | "clinic";
export const PLACE_LABEL: Record<MedPlace, string> = { home: "Em casa", clinic: "Na clínica" };

export interface MedTreatment {
  id: string; patient_id: string; medication: string; started_on: string; dose_mg: number; weekday: number;
  applied_where: MedPlace; notes: string | null; stock_item_id: string | null; stock_unit_id: string | null; status: "active" | "ended"; ended_on: string | null;
}
export interface MedDose { id: string; treatment_id: string; dose_mg: number; effective_on: string; note: string | null; created_at: string }
export interface MedApplication {
  id: string; treatment_id: string; applied_on: string; dose_mg: number; place: MedPlace; source: "patient" | "professional";
  applied_by_name: string | null; note: string | null; stock_item_id: string | null; created_at: string;
}
export interface MedDelivery { id: string; treatment_id: string; delivered_on: string; quantity: number; note: string | null; stock_item_id: string | null; created_at: string }
export interface MedStockOption { item_id: string; item_name: string; unit_id: string; unit_name: string; qty_on_hand: number }
export interface MedState { state: "today" | "overdue" | "ok" | "upcoming" | "ended"; due_on: string | null; days_late: number }

/** 2,5 mg · 10 mg (vírgula decimal, sem zeros sobrando). */
export function formatMg(mg: number): string {
  return `${Number(mg).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} mg`;
}
export function weekdayLabel(d: number): string { return WEEKDAYS[d] ?? "—"; }
export function dateBR(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
}

/** "2,5" ou "2.5" → 2.5; vazio/ruim → null. */
export function parseMg(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

export function stateText(s: MedState): { label: string; tone: "destructive" | "primary" | "muted" } | null {
  if (s.state === "today") return { label: "Hoje é o dia da aplicação", tone: "primary" };
  if (s.state === "overdue") return { label: `Aplicação atrasada · ${s.days_late === 1 ? "1 dia" : `${s.days_late} dias`}`, tone: "destructive" };
  if (s.state === "upcoming") return { label: "Ainda não começou", tone: "muted" };
  return null;
}

export interface TreatmentForm { medication: string; startedOn: string; doseMg: string; weekday: number | null; where: MedPlace; notes: string; isNew: boolean }
export function validateTreatment(f: TreatmentForm, todayIso: string): string | null {
  if (f.medication.trim().length > 80) return "O nome da medicação pode ter até 80 letras.";
  if (!f.startedOn) return "Informe a data de início.";
  if (f.startedOn > addDays(todayIso, 365)) return "A data de início está muito à frente.";
  if (f.isNew && parseMg(f.doseMg) === null) return "Informe a dose em mg (ex.: 2,5).";
  if (f.weekday === null) return "Escolha o dia da semana da aplicação.";
  return null;
}
export function validateApplication(i: { appliedOn: string; doseMg: string; place: MedPlace; stockItem: string }, todayIso: string): string | null {
  if (!i.appliedOn) return "Informe a data da aplicação.";
  if (i.appliedOn > todayIso) return "A data da aplicação não pode ser no futuro.";
  if (parseMg(i.doseMg) === null) return "Informe a dose em mg (ex.: 2,5).";
  if (i.stockItem && i.place !== "clinic") return "A baixa de estoque vale para aplicação feita na clínica.";
  return null;
}
export function validateDelivery(i: { deliveredOn: string; quantity: string }, todayIso: string): string | null {
  if (!i.deliveredOn) return "Informe a data da entrega.";
  if (i.deliveredOn > todayIso) return "A data da entrega não pode ser no futuro.";
  const q = Number(i.quantity);
  if (!Number.isInteger(q) || q < 1 || q > 99) return "Informe a quantidade (de 1 a 99).";
  return null;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Mensagem em português para o erro do banco (código/mensagem das RPCs med_*). */
export function medErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? "";
  if (msg.includes("INSUFFICIENT_STOCK")) return "Saldo insuficiente no estoque. Nada foi registrado.";
  if (msg.includes("APPLICATION_EXISTS")) return "Já existe uma aplicação registrada nesse dia.";
  if (msg.includes("TREATMENT_EXISTS")) return "Este paciente já tem um tratamento ativo com essa medicação.";
  if (msg.includes("DOSE_UNCHANGED")) return "A dose informada é a mesma que já está em uso.";
  if (msg.includes("STOCK_ONLY_CLINIC")) return "A baixa de estoque vale para aplicação feita na clínica.";
  if (msg.includes("EXPIRED") || msg.includes("LOT_")) return "O lote desse item está vencido ou indisponível. Nada foi registrado.";
  if (msg.includes("INVALID_ITEM") || msg.includes("INVALID_UNITS")) return "Item de estoque inválido. Escolha outro.";
  if (e?.code === "42501" || msg.includes("forbidden")) return "Só médico ou nutricionista que acompanha o paciente registra medicação.";
  return "Não foi possível salvar. Tente novamente.";
}

// Seletor de item de estoque: valor "item|unidade" ou "none" (só registrar).
export const NO_STOCK = "none";
export const stockValue = (itemId: string | null, unitId: string | null) => (itemId && unitId ? `${itemId}|${unitId}` : NO_STOCK);
export function splitStock(v: string): { item: string | null; unit: string | null } {
  if (v === NO_STOCK) return { item: null, unit: null };
  const [item, unit] = v.split("|");
  return { item: item || null, unit: unit || null };
}

