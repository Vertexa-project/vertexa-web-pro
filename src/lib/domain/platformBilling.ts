// Platform Billing projections (BP05). Sem I/O. Sem HTTP Asaas.
// Delinquência é fato financeiro vencido — Pix REFUSED não é inadimplência.

import {
  billingMethodLabel,
  chargeStateLabel,
  chargeStateTone,
  formatBillingCivilDate,
  isBillingMethod,
  isChargeDisplayState,
  isPaymentDisplayState,
  isTimelineEventType,
  paymentStateLabel,
  paymentStateTone,
  providerEnvironmentLabel,
  timelineEventLabel,
  type BillingMethod,
  type BillingProviderEnvironment,
  type ChargeDisplayState,
  type ClinicBillingTimelineEvent,
  type PaymentDisplayState,
} from "./billingHub";
import { formatBillingPriceCents } from "./billingCheckout";
import {
  emptyEnvironmentFinancialBucket,
  type EnvironmentFinancialBucket,
} from "./billingEnvScoping";
import { pixAutomaticStatusLabel } from "./pixAutomaticReissue";

export const PLATFORM_BILLING_PAGE_SIZE = 50;

export const FINANCIAL_SUMMARIES = [
  "no_plan",
  "no_charges",
  "current",
  "pending",
  "overdue",
] as const;
export type PlatformFinancialSummary = (typeof FINANCIAL_SUMMARIES)[number];

export const ATTENTION_REASONS = [
  "overdue",
  "identity_incomplete",
  "customer_unbound",
  "pix_refused",
  "pix_absent",
  "none",
] as const;
export type PlatformAttentionReason = (typeof ATTENTION_REASONS)[number];

export const AGING_BUCKETS = ["d1_7", "d8_15", "d16_30", "d31_plus"] as const;
export type PlatformAgingBucket = (typeof AGING_BUCKETS)[number];

export const EVENT_ENTITY_TYPES = ["payment", "authorization", "unknown"] as const;
export type PlatformEventEntityType = (typeof EVENT_ENTITY_TYPES)[number];

export interface PlatformBillingNextCharge {
  amountCents: number;
  dueDate: string;
  displayState: ChargeDisplayState;
}

export interface PlatformProviderEnvFacts {
  pixStatus: string | null;
  pixGeneration: number | null;
  latestPaymentState: PaymentDisplayState | null;
  latestPaymentDate: string | null;
  nextCharge: PlatformBillingNextCharge | null;
  agingBucket: PlatformAgingBucket | null;
  overdueCount: number;
  overdueCents: number | null;
  pendingCents: number | null;
}

export interface PlatformClinicProviderFacts {
  sandbox: PlatformProviderEnvFacts;
  production: PlatformProviderEnvFacts;
}

export interface PlatformBillingClinicRow {
  clinicId: string;
  clinicName: string;
  planCode: string | null;
  planDisplayName: string | null;
  planPriceCents: number | null;
  planCurrency: string;
  billingCycle: string | null;
  contractStatus: string | null;
  contractEffectiveFrom: string | null;
  identityComplete: boolean;
  customerBound: boolean;
  provider: PlatformClinicProviderFacts;
  financialSummary: PlatformFinancialSummary;
  attention: boolean;
  attentionReason: PlatformAttentionReason;
  entitlementEnforcement: "OFF";
  entitlementGranted: false;
}

export interface PlatformAgingBucketMetric {
  clinicCount: number;
  amountCents: number;
}

export type PlatformAgingByEnvironment = Record<
  BillingProviderEnvironment,
  Record<PlatformAgingBucket, PlatformAgingBucketMetric>
>;

export interface PlatformEnvCount {
  sandbox: number;
  production: number;
}

export interface PlatformBillingOverview {
  timezone: "America/Sao_Paulo";
  periodStart: string;
  periodEnd: string;
  financial: {
    sandbox: EnvironmentFinancialBucket;
    production: EnvironmentFinancialBucket;
  };
  clinicsWithReceived: number;
  delinquent: PlatformEnvCount;
  activeCommercialContracts: number;
  activePixAutomaticAuthorizations: PlatformEnvCount;
  paymentSuccessCount: number;
  attentionClinicCount: number;
  aging: PlatformAgingByEnvironment;
  entitlementEnforcement: "OFF";
}

export interface PlatformBillingCharge {
  id: string;
  clinicId: string;
  clinicName?: string;
  environment?: BillingProviderEnvironment | null;
  amountCents: number;
  currency: string;
  dueDate: string | null;
  paidDate: string | null;
  displayState: ChargeDisplayState;
  method: BillingMethod;
}

export interface PlatformBillingPayment {
  id: string;
  clinicId: string;
  clinicName?: string;
  environment?: BillingProviderEnvironment | null;
  amountCents: number;
  currency: string;
  dueDate: string | null;
  receivedDate: string | null;
  displayState: PaymentDisplayState;
  method: BillingMethod;
}

export interface PlatformBillingEvent {
  id: string;
  eventType: string;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
  failureCategory: string | null;
  clinicId: string | null;
  clinicName?: string | null;
  relatedPaymentId: string | null;
  relatedEntityType: PlatformEventEntityType;
}

export interface PlatformClinicBillingDetail {
  found: boolean;
  clinicId: string;
  clinic: PlatformBillingClinicRow | null;
  charges: PlatformBillingCharge[];
  payments: PlatformBillingPayment[];
  businessTimeline: ClinicBillingTimelineEvent[];
  events: PlatformBillingEvent[];
}

export interface PlatformBillingPage<T> {
  limit: number;
  offset: number;
  items: T[];
}

export interface PlatformBillingClinicFilters {
  clinicQuery?: string;
  planCode?: string;
  contractStatus?: string;
  pixStatus?: string;
  financialStatus?: string;
  needsAttention?: boolean;
  limit?: number;
  offset?: number;
}

export interface PlatformBillingListFilters {
  clinicId?: string;
  displayState?: string;
  method?: string;
  planCode?: string;
  processingStatus?: string;
  limit?: number;
  offset?: number;
}

export function isFinancialSummary(value: string): value is PlatformFinancialSummary {
  return (FINANCIAL_SUMMARIES as readonly string[]).includes(value);
}

export function isAttentionReason(value: string): value is PlatformAttentionReason {
  return (ATTENTION_REASONS as readonly string[]).includes(value);
}

export function isAgingBucket(value: string): value is PlatformAgingBucket {
  return (AGING_BUCKETS as readonly string[]).includes(value);
}

export function financialSummaryLabel(summary: PlatformFinancialSummary): string {
  const labels: Record<PlatformFinancialSummary, string> = {
    no_plan: "Sem contrato",
    no_charges: "Sem cobrança",
    current: "Em dia",
    pending: "Em aberto",
    overdue: "Vencido",
  };
  return labels[summary];
}

export function attentionReasonLabel(reason: PlatformAttentionReason): string {
  const labels: Record<PlatformAttentionReason, string> = {
    overdue: "Cobrança vencida",
    identity_incomplete: "Identidade fiscal incompleta",
    customer_unbound: "Cliente do provedor não vinculado",
    pix_refused: "Pix Automático recusado",
    pix_absent: "Pix Automático ausente",
    none: "Sem atenção",
  };
  return labels[reason];
}

export function agingBucketLabel(bucket: PlatformAgingBucket): string {
  const labels: Record<PlatformAgingBucket, string> = {
    d1_7: "1 a 7 dias",
    d8_15: "8 a 15 dias",
    d16_30: "16 a 30 dias",
    d31_plus: "Mais de 30 dias",
  };
  return labels[bucket];
}

export function contractStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Ativo";
    case "pending":
      return "Pendente";
    case "ended":
      return "Encerrado";
    case "cancelled":
      return "Cancelado";
    case null:
    case undefined:
    case "":
      return "Sem contrato";
    default:
      return status;
  }
}

export function identityLabel(complete: boolean): string {
  return complete ? "Identidade completa" : "Identidade incompleta";
}

export function customerBoundLabel(bound: boolean): string {
  return bound ? "Cliente vinculado" : "Cliente não vinculado";
}

export function processingStatusLabel(status: string): string {
  switch (status) {
    case "received":
      return "Recebido";
    case "processed":
      return "Processado";
    case "failed":
      return "Falhou";
    default:
      return status;
  }
}

export function eventEntityLabel(type: PlatformEventEntityType): string {
  const labels: Record<PlatformEventEntityType, string> = {
    payment: "Pagamento",
    authorization: "Autorização",
    unknown: "Não correlacionado",
  };
  return labels[type];
}

export function eventTypeLabel(type: string): string {
  const known: Record<string, string> = {
    PAYMENT_RECEIVED: "Pagamento recebido",
    PAYMENT_CONFIRMED: "Pagamento confirmado",
    PAYMENT_OVERDUE: "Pagamento vencido",
    PAYMENT_CREATED: "Pagamento criado",
    PAYMENT_DELETED: "Pagamento removido",
  };
  return known[type] ?? type.split("_").join(" ");
}

export function financialSummaryTone(
  summary: PlatformFinancialSummary,
): "muted" | "success" | "warning" | "destructive" | "info" {
  if (summary === "overdue") return "destructive";
  if (summary === "pending") return "warning";
  if (summary === "current") return "success";
  if (summary === "no_plan") return "muted";
  return "info";
}

export function formatPlatformMoney(cents: number | null | undefined, currency = "BRL"): string {
  if (cents == null) return "—";
  return formatBillingPriceCents(cents, currency);
}

export function formatPlatformDate(value: string | null | undefined): string {
  return formatBillingCivilDate(value);
}

export function clinicPlanCopy(row: PlatformBillingClinicRow): string {
  if (!row.planDisplayName || row.planPriceCents == null) return "Nenhum plano contratado";
  return `${row.planDisplayName} · ${formatPlatformMoney(row.planPriceCents, row.planCurrency)}/mês`;
}

export function nextChargeCopy(next: PlatformBillingNextCharge | null): string {
  if (!next) return "Nenhuma cobrança futura disponível";
  return `${formatPlatformDate(next.dueDate)} · ${formatPlatformMoney(next.amountCents)}`;
}

export function emptyProviderEnvFacts(): PlatformProviderEnvFacts {
  return {
    pixStatus: null,
    pixGeneration: null,
    latestPaymentState: null,
    latestPaymentDate: null,
    nextCharge: null,
    agingBucket: null,
    overdueCount: 0,
    overdueCents: null,
    pendingCents: null,
  };
}

export function emptyClinicProviderFacts(): PlatformClinicProviderFacts {
  return {
    sandbox: emptyProviderEnvFacts(),
    production: emptyProviderEnvFacts(),
  };
}

export function emptyAgingBuckets(): Record<PlatformAgingBucket, PlatformAgingBucketMetric> {
  const zero: PlatformAgingBucketMetric = { clinicCount: 0, amountCents: 0 };
  return { d1_7: zero, d8_15: zero, d16_30: zero, d31_plus: zero };
}

export function emptyEnvCount(): PlatformEnvCount {
  return { sandbox: 0, production: 0 };
}

export function providerPixCopy(provider: PlatformClinicProviderFacts): string {
  return `Sandbox: ${pixAutomaticStatusLabel(provider.sandbox.pixStatus)} · Produção: ${pixAutomaticStatusLabel(provider.production.pixStatus)}`;
}

export function providerNextChargeCopy(provider: PlatformClinicProviderFacts): string {
  return `Sandbox: ${nextChargeCopy(provider.sandbox.nextCharge)} · Produção: ${nextChargeCopy(provider.production.nextCharge)}`;
}

export function providerOverdueCopy(facts: PlatformProviderEnvFacts): string {
  return facts.overdueCount > 0
    ? `${facts.overdueCount} · ${formatPlatformMoney(facts.overdueCents)}`
    : "—";
}

export function providerLatestPaymentCopy(facts: PlatformProviderEnvFacts): string {
  if (!facts.latestPaymentDate) return "—";
  return `${formatPlatformDate(facts.latestPaymentDate)}${
    facts.latestPaymentState ? ` · ${paymentStateLabel(facts.latestPaymentState)}` : ""
  }`;
}

export function platformBillingErrorMessage(error: unknown): string {
  const hint =
    error && typeof error === "object" && "hint" in error
      ? String((error as { hint?: unknown }).hint ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const code = `${hint} ${message}`;
  if (code.includes("BILLING_NOT_AUTHENTICATED")) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (code.includes("BILLING_NOT_PLATFORM_ADMIN")) {
    return "Apenas administradores da plataforma podem ver o faturamento global.";
  }
  if (code.includes("BILLING_CLINIC_REQUIRED")) {
    return "Informe a clínica para abrir o detalhe.";
  }
  return "Não foi possível carregar o faturamento da plataforma. Tente novamente.";
}

export function emptyOverview(): PlatformBillingOverview {
  return {
    timezone: "America/Sao_Paulo",
    periodStart: "",
    periodEnd: "",
    financial: {
      sandbox: emptyEnvironmentFinancialBucket(),
      production: emptyEnvironmentFinancialBucket(),
    },
    clinicsWithReceived: 0,
    delinquent: emptyEnvCount(),
    activeCommercialContracts: 0,
    activePixAutomaticAuthorizations: emptyEnvCount(),
    paymentSuccessCount: 0,
    attentionClinicCount: 0,
    aging: {
      sandbox: emptyAgingBuckets(),
      production: emptyAgingBuckets(),
    },
    entitlementEnforcement: "OFF",
  };
}

export {
  billingMethodLabel,
  chargeStateLabel,
  chargeStateTone,
  isBillingMethod,
  isChargeDisplayState,
  isPaymentDisplayState,
  isTimelineEventType,
  paymentStateLabel,
  paymentStateTone,
  pixAutomaticStatusLabel,
  providerEnvironmentLabel,
  timelineEventLabel,
};
