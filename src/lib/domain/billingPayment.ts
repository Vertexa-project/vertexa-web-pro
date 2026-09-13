// Estratégia de pagamento Vertexa. NÃO usar billingType Asaas como autoridade.
// PIX ordinário (billingType=PIX) ≠ Pix Automático.

export const BILLING_PAYMENT_STRATEGIES = ["pix_automatic", "pix_manual", "credit_card"] as const;
export type BillingPaymentStrategy = (typeof BILLING_PAYMENT_STRATEGIES)[number];

export const BILLING_PAYMENT_STATUS = {
  pix_automatic: "MVP_RECOMMENDED",
  pix_manual: "MVP_AVAILABLE",
  credit_card: "PLANNED_NEXT",
} as const;

export const PIX_AUTOMATIC_POLICY = {
  frequency: "MONTHLY",
  paymentCreationMode: "SUBSCRIPTION",
  retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
  finishDate: null,
  timezone: "America/Sao_Paulo",
  description: "Vertexa - assinatura mensal",
} as const;

export function isBillingPaymentStrategy(value: string): value is BillingPaymentStrategy {
  return (BILLING_PAYMENT_STRATEGIES as readonly string[]).includes(value);
}

/** UUID sem hífens. 32 hex. Sem PII. */
export function pixAutomaticContractId(commercialContractId: string): string {
  return commercialContractId.replace(/-/g, "").toLowerCase();
}

/**
 * Aritmética de mês civil a partir de uma data YYYY-MM-DD.
 * Mantém o dia âncora original; se o mês destino não tiver esse dia, usa o último.
 * Não usa +30 dias nem o fuso local do runtime.
 */
export function addCalendarMonths(isoDate: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("invalid_civil_date");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const total = year * 12 + monthIndex + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}
