// Regras PURAS do financeiro (espelham 20261027090000_wp_finance_a.sql). Valores sempre em CENTAVOS (inteiro).
export const MAX_CENTS = 100_000_000;
export const MAX_FORM_CENTS = 1_000_000_00; // R$ 1.000.000,00 por mês, teto prático da tela

export type ChargeStatus = "pending" | "paid" | "canceled";
export interface FinanceOverview {
  month: string;
  expected_cents: number; received_cents: number; pending_cents: number; overdue_cents: number; overdue_count: number;
  charges_count: number; at_risk_patients: number; at_risk_cents: number; billed_patients: number; unconfigured_patients: number;
  ticket_avg_cents: number | null; tenure_avg_months: number | null;
  projection: Array<{ month: string; expected_cents: number }>;
}
export interface FinanceCharge { charge_id: string; patient_id: string; full_name: string | null; due_on: string; amount_cents: number; status: ChargeStatus; paid_on: string | null; overdue: boolean }
export interface FinancePatient { patient_id: string; full_name: string | null; monthly_amount_cents: number | null; due_day: number | null; is_active: boolean | null; idle_days: number }

export function formatBRL(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "250", "250,5", "1.250,50", "R$ 1.250,50" → centavos; inválido/negativo/zero-excedente → null. */
export function parseBRL(raw: string): number | null {
  const t = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!t || /[^0-9.,]/.test(t)) return null;
  let normalized: string;
  if (t.includes(",")) {
    const [intPart, decPart, ...rest] = t.split(",");
    if (rest.length || (decPart ?? "").length > 2 || !/^\d{1,3}(\.\d{3})*$|^\d+$/.test(intPart ?? "")) return null;
    normalized = `${(intPart ?? "").replace(/\./g, "")}.${(decPart ?? "").padEnd(2, "0")}`;
  } else {
    if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(t)) return null; // "1.250" = mil e duzentos e cinquenta
    normalized = t.replace(/\./g, "");
  }
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) && cents >= 0 && cents <= MAX_FORM_CENTS ? cents : null;
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export function validateBilling(amount: string, dueDay: string): Result<{ amountCents: number; dueDay: number }> {
  const cents = parseBRL(amount);
  if (cents === null) return { ok: false, error: "Informe um valor válido, por exemplo 250,00." };
  const d = Number(dueDay.trim());
  if (!Number.isInteger(d) || d < 1 || d > 28) return { ok: false, error: "O dia de vencimento vai de 1 a 28." };
  return { ok: true, value: { amountCents: cents, dueDay: d } };
}

const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-10" → "outubro de 2026". */
export function monthTitle(ym: string): string { const [y, m] = ym.split("-"); return `${MONTHS_LONG[Number(m) - 1] ?? ym} de ${y}`; }
export function monthShort(ym: string): string { const [y, m] = ym.split("-"); return `${MONTHS_SHORT[Number(m) - 1] ?? ym}/${(y ?? "").slice(2)}`; }
/** Primeiro dia do mês ("2026-10-01") a partir de uma data. */
export function monthStart(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
export function shiftMonth(ymd: string, delta: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date((y as number), (m as number) - 1 + delta, 1);
  return monthStart(d);
}
/** Mesmos limites do servidor: de 12 meses atrás até o próximo mês. */
export function monthInRange(ymd: string, todayYmd: string): boolean {
  return ymd >= shiftMonth(todayYmd, -12) && ymd <= shiftMonth(todayYmd, 1);
}

export function fmtDay(ymd: string | null): string { if (!ymd) return ""; const [, m, d] = ymd.split("-"); return `${d}/${m}`; }
export function statusText(c: Pick<FinanceCharge, "status" | "overdue" | "paid_on">): string {
  if (c.status === "paid") return `Pago em ${fmtDay(c.paid_on)}`;
  if (c.status === "canceled") return "Cancelada";
  return c.overdue ? "Em atraso" : "A vencer";
}
