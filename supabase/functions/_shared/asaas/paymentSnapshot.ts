// WP-ASAAS-04 — normalização do payment Asaas (GET /payments/{id}) para o snapshot interno.
//
// Asaas é autoridade sobre o fato financeiro externo; este módulo traduz o objeto atual do
// payment para o vocabulário INTERNO financial_state (controlado por nós) + centavos inteiros.
// provider_status guarda o status verbatim do Asaas (fato externo). financial_state é a nossa
// classificação — desconhecido => 'unknown', nunca inventamos estado nem disparamos ação de
// produto. Nenhum payload bruto é retornado; só campos técnicos estruturados.
//
// CORREÇÃO OBRIGATÓRIA 1: PAYMENT_PARTIALLY_REFUNDED e PAYMENT_REFUND_DENIED são eventos
// OFICIAIS do Asaas. Não classificamos pelo tipo do evento — classificamos pelo objeto atual
// (status + refunds + deleted). Refund parcial é derivado de refunds[] com status DONE
// somando menos que o valor total. refunds PENDING/CANCELLED NÃO contam (só DONE representa
// valor efetivamente devolvido).

import { parseAsaasAmountToCents } from "./money.ts";

/** Vocabulário INTERNO controlado. Espelha o CHECK de private.billing_payments.financial_state. */
export type FinancialState =
  | "pending"
  | "authorized"
  | "confirmed"
  | "received"
  | "overdue"
  | "refund_in_progress"
  | "refunded"
  | "partially_refunded"
  | "chargeback_requested"
  | "chargeback_dispute"
  | "chargeback_reversal_pending"
  | "voided"
  | "unknown";

/** Subconjunto do objeto payment do Asaas que consumimos. Campos extras são ignorados (tolerância). */
export interface AsaasPaymentFull {
  id?: unknown;
  customer?: unknown;
  subscription?: unknown;
  status?: unknown;
  value?: unknown;
  netValue?: unknown;
  billingType?: unknown;
  dueDate?: unknown;
  paymentDate?: unknown;
  confirmedDate?: unknown;
  deleted?: unknown;
  refunds?: unknown;
}

export interface NormalizedPaymentSnapshot {
  externalPaymentId: string;
  externalCustomerId: string;
  externalSubscriptionId: string;
  providerStatus: string;
  financialState: FinancialState;
  billingType: string | null;
  valueCents: number;
  netValueCents: number | null;
  refundedValueCents: number | null;
  dueDate: string | null;
  paymentDate: string | null;
  confirmedDate: string | null;
  deleted: boolean;
}

export type NormalizeResult =
  | { ok: true; snapshot: NormalizedPaymentSnapshot }
  | { ok: false; errorCode: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mapeia o status verbatim do Asaas para o vocabulário interno. Status não reconhecido =>
 * 'unknown' (nunca lança). Forward-compatible: status novos do provider caem em unknown e o
 * snapshot ainda é gravado, sem quebrar o processor.
 */
export function mapFinancialState(providerStatus: string): FinancialState {
  switch (providerStatus) {
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return "pending";
    case "AUTHORIZED":
      return "authorized";
    case "CONFIRMED":
      return "confirmed";
    case "RECEIVED":
    case "RECEIVED_IN_CASH":
    case "DUNNING_RECEIVED":
      return "received";
    case "OVERDUE":
    case "DUNNING_REQUESTED":
      return "overdue";
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
      return "refund_in_progress";
    case "REFUNDED":
      return "refunded";
    case "CHARGEBACK_REQUESTED":
      return "chargeback_requested";
    case "CHARGEBACK_DISPUTE":
      return "chargeback_dispute";
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "chargeback_reversal_pending";
    default:
      return "unknown";
  }
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function asIsoDateOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return ISO_DATE.test(v) ? v : null;
}

/** Soma (em centavos) apenas os refunds com status DONE. Retorna null se não houver array de refunds. */
function sumDoneRefundsCents(refunds: unknown): number | null {
  if (!Array.isArray(refunds)) return null;
  let total = 0;
  for (const r of refunds) {
    if (typeof r !== "object" || r === null) continue;
    const status = (r as { status?: unknown }).status;
    if (status !== "DONE") continue;
    const cents = parseAsaasAmountToCents((r as { value?: unknown }).value);
    if (cents === null) continue; // refund com valor inválido: ignora contribuição (conservador)
    total += cents;
  }
  return total;
}

/**
 * Normaliza o objeto payment atual do Asaas. Exige id/customer/subscription/status e um value
 * exatamente representável em centavos (> 0). subscription é exigido porque nesta WP só
 * normalizamos payments de subscription (subscription-only) — o processor já garante isso
 * antes de chamar aqui, mas revalidamos como defesa em profundidade.
 */
export function normalizePaymentSnapshot(payment: AsaasPaymentFull): NormalizeResult {
  const id = asNonEmptyString(payment.id);
  const customer = asNonEmptyString(payment.customer);
  const subscription = asNonEmptyString(payment.subscription);
  const status = asNonEmptyString(payment.status);

  if (!id || !customer || !status) {
    return { ok: false, errorCode: "invalid_payment_shape" };
  }
  if (!subscription) {
    // Não deveria chegar aqui (processor filtra), mas nunca gravamos payment sem subscription.
    return { ok: false, errorCode: "missing_subscription" };
  }

  const valueCents = parseAsaasAmountToCents(payment.value);
  if (valueCents === null) {
    return { ok: false, errorCode: "value_not_exact_cents" };
  }
  if (valueCents <= 0) {
    return { ok: false, errorCode: "non_positive_value" };
  }

  const netValueCents = payment.netValue === undefined || payment.netValue === null
    ? null
    : parseAsaasAmountToCents(payment.netValue);

  const refundedValueCents = sumDoneRefundsCents(payment.refunds);
  const deleted = payment.deleted === true;

  // Classificação: deleted domina (voided). Refund parcial (DONE 0<x<total) sobrepõe estados
  // de "dinheiro recebido". Caso contrário, o status verbatim manda.
  const base = mapFinancialState(status);
  let financialState: FinancialState;
  if (deleted) {
    financialState = "voided";
  } else if (
    refundedValueCents !== null &&
    refundedValueCents > 0 &&
    refundedValueCents < valueCents &&
    (base === "received" || base === "confirmed")
  ) {
    financialState = "partially_refunded";
  } else {
    financialState = base;
  }

  return {
    ok: true,
    snapshot: {
      externalPaymentId: id,
      externalCustomerId: customer,
      externalSubscriptionId: subscription,
      providerStatus: status,
      financialState,
      billingType: asNonEmptyString(payment.billingType),
      valueCents,
      netValueCents: netValueCents ?? null,
      refundedValueCents,
      dueDate: asIsoDateOrNull(payment.dueDate),
      paymentDate: asIsoDateOrNull(payment.paymentDate),
      confirmedDate: asIsoDateOrNull(payment.confirmedDate),
      deleted,
    },
  };
}
