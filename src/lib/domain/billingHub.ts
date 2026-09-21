// Clinic Billing Hub projections (BP04). Sem I/O. Sem HTTP Asaas.
// Quatro estados permanecem independentes — nunca colapsar em isPaidPlanActive.

import { formatBillingPriceCents, type PixAuthorizationStatus } from "./billingCheckout";
import { formatDate } from "./format";
import { pixProductLabel } from "./billingPixCheckout";

export const CHARGE_DISPLAY_STATES = ["PROGRAMMED", "PENDING", "PAID", "OVERDUE"] as const;
export type ChargeDisplayState = (typeof CHARGE_DISPLAY_STATES)[number];

export const PAYMENT_DISPLAY_STATES = ["pending", "received", "overdue"] as const;
export type PaymentDisplayState = (typeof PAYMENT_DISPLAY_STATES)[number];

export const BILLING_METHODS = ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

export const TIMELINE_EVENT_TYPES = [
  "plan_contracted",
  "pix_prepared",
  "pix_created",
  "pix_active",
  "pix_refused",
  "charge_programmed",
  "charge_created",
  "payment_received",
  "payment_overdue",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const FINANCIAL_SUMMARY_CODES = [
  "no_plan",
  "no_charges",
  "current",
  "pending",
  "overdue",
] as const;
export type FinancialSummaryCode = (typeof FINANCIAL_SUMMARY_CODES)[number];

export const OVERDUE_REGULARIZE_COPY =
  "Regularize esta cobrança pelo banco ou pelo mecanismo de pagamento atual. A Vertexa não cria outra cobrança.";

export const NEXT_CHARGE_EMPTY_COPY = "Nenhuma cobrança futura está disponível no momento.";

export const CHECKOUT_QR_RECOVERY = "NO_SUPPORTED_QR_RECOVERY" as const;

export interface ClinicBillingPlanSummary {
  displayName: string;
  priceCents: number;
  currency: string;
  billingCycle: "monthly";
  contractStatus: string;
}

export interface ClinicBillingNextCharge {
  amountCents: number;
  currency: string;
  dueDate: string;
  displayState: ChargeDisplayState;
}

export interface ClinicBillingFinancialSituation {
  summaryCode: FinancialSummaryCode;
  attention: boolean;
  overdueCount: number;
  overdueCents: number | null;
}

export interface ClinicBillingOverview {
  clinicId: string;
  plan: ClinicBillingPlanSummary | null;
  pixAuthorizationStatus: PixAuthorizationStatus | null;
  pixGeneration: number | null;
  identityComplete: boolean;
  nextCharge: ClinicBillingNextCharge | null;
  financialSituation: ClinicBillingFinancialSituation;
  latestPaymentDisplayState: PaymentDisplayState | null;
  chargeCount: number;
  entitlementEnforcement: "OFF";
  entitlementGranted: false;
}

export interface ClinicBillingCharge {
  id: string;
  amountCents: number;
  currency: string;
  dueDate: string | null;
  paidDate: string | null;
  displayState: ChargeDisplayState;
  method: BillingMethod;
}

export interface ClinicBillingPayment {
  id: string;
  amountCents: number;
  currency: string;
  dueDate: string | null;
  receivedDate: string | null;
  displayState: PaymentDisplayState;
  method: BillingMethod;
}

export type BillingProviderEnvironment = "sandbox" | "production";

export interface ClinicBillingTimelineEvent {
  id: string;
  occurredAt: string;
  type: TimelineEventType;
  environment?: BillingProviderEnvironment | null;
}

export function isBillingProviderEnvironment(value: string | null | undefined): value is BillingProviderEnvironment {
  return value === "sandbox" || value === "production";
}

export function providerEnvironmentLabel(environment: string | null | undefined): string | null {
  if (environment === "sandbox") return "Sandbox";
  if (environment === "production") return "Produção";
  return null;
}

export function isChargeDisplayState(value: string): value is ChargeDisplayState {
  return (CHARGE_DISPLAY_STATES as readonly string[]).includes(value);
}

export function isPaymentDisplayState(value: string): value is PaymentDisplayState {
  return (PAYMENT_DISPLAY_STATES as readonly string[]).includes(value);
}

export function isBillingMethod(value: string): value is BillingMethod {
  return (BILLING_METHODS as readonly string[]).includes(value);
}

export function isTimelineEventType(value: string): value is TimelineEventType {
  return (TIMELINE_EVENT_TYPES as readonly string[]).includes(value);
}

export function chargeStateLabel(state: ChargeDisplayState): string {
  const labels: Record<ChargeDisplayState, string> = {
    PROGRAMMED: "Programada",
    PENDING: "Pendente",
    PAID: "Paga",
    OVERDUE: "Vencida",
  };
  return labels[state];
}

export function paymentStateLabel(state: PaymentDisplayState): string {
  const labels: Record<PaymentDisplayState, string> = {
    pending: "Pendente",
    received: "Recebido",
    overdue: "Vencido",
  };
  return labels[state];
}

export function billingMethodLabel(method: BillingMethod): string {
  const labels: Record<BillingMethod, string> = {
    PIX: "Pix",
    BOLETO: "Boleto",
    CREDIT_CARD: "Cartão",
    UNDEFINED: "Não informado",
  };
  return labels[method];
}

export function timelineEventLabel(type: TimelineEventType): string {
  const labels: Record<TimelineEventType, string> = {
    plan_contracted: "Plano contratado",
    pix_prepared: "Pix Automático preparado",
    pix_created: "Pix Automático criado",
    pix_active: "Pix Automático autorizado",
    pix_refused: "Pix Automático recusado",
    charge_programmed: "Cobrança programada",
    charge_created: "Cobrança criada",
    payment_received: "Pagamento recebido",
    payment_overdue: "Pagamento vencido",
  };
  return labels[type];
}

export function chargeStateTone(
  state: ChargeDisplayState,
): "info" | "warning" | "success" | "destructive" {
  if (state === "PROGRAMMED") return "info";
  if (state === "PENDING") return "warning";
  if (state === "PAID") return "success";
  return "destructive";
}

export function paymentStateTone(
  state: PaymentDisplayState,
): "warning" | "success" | "destructive" {
  if (state === "pending") return "warning";
  if (state === "received") return "success";
  return "destructive";
}

export function formatBillingCivilDate(value: string | null | undefined): string {
  if (!value) return "sem data";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return formatDate(value);
  return formatDate(`${match[1]}-${match[2]}-${match[3]}T12:00:00`);
}

export function financialSituationCopy(situation: ClinicBillingFinancialSituation): string {
  if (situation.summaryCode === "no_plan") return "Nenhum plano contratado ainda.";
  if (situation.summaryCode === "no_charges") return "Ainda não há cobrança registrada.";
  if (situation.summaryCode === "overdue") {
    const count = situation.overdueCount;
    const amount =
      situation.overdueCents != null && situation.overdueCents > 0
        ? ` ${formatBillingPriceCents(situation.overdueCents)}`
        : "";
    return count === 1
      ? `Há 1 cobrança vencida${amount}. ${OVERDUE_REGULARIZE_COPY}`
      : `Há ${count} cobranças vencidas${amount}. ${OVERDUE_REGULARIZE_COPY}`;
  }
  if (situation.summaryCode === "pending") return "Há cobrança em aberto.";
  return "Nenhuma cobrança precisa de atenção agora.";
}

export function pixHubLabel(status: PixAuthorizationStatus | null | undefined): string {
  return pixProductLabel(status);
}

export function nextChargeCopy(next: ClinicBillingNextCharge | null): string {
  if (!next) return NEXT_CHARGE_EMPTY_COPY;
  return `${formatBillingCivilDate(next.dueDate)} · ${formatBillingPriceCents(next.amountCents, next.currency)}`;
}

export function resolveHubFourStates(overview: ClinicBillingOverview): {
  commercialContractStatus: string | null;
  pixAuthorizationStatus: PixAuthorizationStatus | null;
  financialPaymentStatus: PaymentDisplayState | null;
  entitlementEnforcement: "OFF";
  entitlementGranted: false;
} {
  return {
    commercialContractStatus: overview.plan?.contractStatus ?? null,
    pixAuthorizationStatus: overview.pixAuthorizationStatus,
    financialPaymentStatus: overview.latestPaymentDisplayState,
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
  };
}

export function emptyBillingOverview(clinicId: string): ClinicBillingOverview {
  return {
    clinicId,
    plan: null,
    pixAuthorizationStatus: null,
    pixGeneration: null,
    identityComplete: false,
    nextCharge: null,
    financialSituation: {
      summaryCode: "no_plan",
      attention: false,
      overdueCount: 0,
      overdueCents: null,
    },
    latestPaymentDisplayState: null,
    chargeCount: 0,
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
  };
}

export function sortTimelineNewestFirst(
  events: ClinicBillingTimelineEvent[],
): ClinicBillingTimelineEvent[] {
  return [...events].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    if (a.type !== b.type) return a.type < b.type ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

export function billingHubErrorMessage(error: unknown): string {
  const hint =
    error && typeof error === "object" && "hint" in error
      ? String((error as { hint?: unknown }).hint ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const code = hint || message;
  if (code.includes("BILLING_NOT_AUTHENTICATED")) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (code.includes("BILLING_NOT_CLINIC_ADMIN")) {
    return "Apenas o administrador da clínica pode ver o faturamento.";
  }
  return "Não foi possível carregar o faturamento agora. Tente novamente em instantes.";
}
