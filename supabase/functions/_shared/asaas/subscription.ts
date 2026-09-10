// WP-ASAAS-03 — algoritmo de idempotência para create_subscription (GATE 6 do plano).
// Pré-condição (customer provisionado) é imposta pela própria reserve RPC (CUSTOMER_NOT_PROVISIONED).
//
// ASAAS-03C: mesma regra de outcome desconhecido do customer.ts (ver client.ts /
// isOutcomeUnknownCategory). Além disso: a Asaas é SEMPRE a autoridade sobre os fatos
// técnicos de uma subscription (billingType/cycle/value/nextDueDate) — nunca persistimos
// esses campos recalculados localmente, seja na reconciliação (subscription já existente)
// seja no create-success (a Asaas pode normalizar o que enviamos). extractSubscriptionFacts
// é o único caminho para produzir o que é gravado em private.billing_subscriptions.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, isOutcomeUnknownCategory, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import { subscriptionExternalReference, subscriptionIdempotencyKey } from "./keys.ts";

export interface SubscriptionFixture {
  billingType: "BOLETO" | "CREDIT_CARD" | "PIX" | "UNDEFINED";
  cycle: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUALLY" | "YEARLY";
  valueCents: number;
  description: string;
}

export interface EnsureSubscriptionResult {
  ok: boolean;
  externalSubscriptionId?: string;
  errorCode?: string;
}

const VALID_BILLING_TYPES = new Set(["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]);
const VALID_CYCLES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUALLY", "YEARLY"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface AsaasSubscription {
  id?: unknown;
  customer?: unknown;
  externalReference?: unknown;
  billingType?: unknown;
  cycle?: unknown;
  value?: unknown;
  nextDueDate?: unknown;
}

interface AsaasList<T> {
  data: T[];
}

interface ReserveOutcome {
  outcome: string;
  operation_id: string;
  external_object_id?: string | null;
  last_error_category?: string | null;
}

interface SubscriptionFacts {
  externalSubscriptionId: string;
  billingType: SubscriptionFixture["billingType"];
  cycle: SubscriptionFixture["cycle"];
  valueCents: number;
  nextDueDate: string;
}

/** nextDueDate só para a REQUEST de criação — o que é persistido vem sempre da resposta. */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Único caminho para transformar um objeto de subscription devolvido pela Asaas (criação ou
 * reconciliação por lookup) nos fatos que private.billing_subscriptions grava. FAIL CLOSED em
 * qualquer campo ausente/fora do contrato — nunca completa a operação com uma fixture local
 * "chutada" no lugar do que o provider realmente confirmou.
 */
export function extractSubscriptionFacts(
  obj: AsaasSubscription,
  expected: { externalCustomerId: string; externalReference: string },
): { ok: true; facts: SubscriptionFacts } | { ok: false; reason: string } {
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    return { ok: false, reason: "invalid_success_shape" };
  }
  if (obj.customer !== expected.externalCustomerId) {
    return { ok: false, reason: "reconciliation_customer_mismatch" };
  }
  if (obj.externalReference !== expected.externalReference) {
    return { ok: false, reason: "reconciliation_external_reference_mismatch" };
  }
  if (typeof obj.billingType !== "string" || !VALID_BILLING_TYPES.has(obj.billingType)) {
    return { ok: false, reason: "invalid_billing_type" };
  }
  if (typeof obj.cycle !== "string" || !VALID_CYCLES.has(obj.cycle)) {
    return { ok: false, reason: "invalid_cycle" };
  }
  if (typeof obj.value !== "number" || !Number.isFinite(obj.value) || obj.value <= 0) {
    return { ok: false, reason: "invalid_value" };
  }
  const cents = Math.round(obj.value * 100);
  if (Math.abs(cents - obj.value * 100) > 1e-6) {
    // Conversão exata só — se o value não representa um número exato de centavos, não
    // inventamos arredondamento silencioso num valor financeiro.
    return { ok: false, reason: "value_not_exact_cents" };
  }
  if (typeof obj.nextDueDate !== "string" || !ISO_DATE_RE.test(obj.nextDueDate)) {
    return { ok: false, reason: "invalid_next_due_date" };
  }

  return {
    ok: true,
    facts: {
      externalSubscriptionId: obj.id,
      billingType: obj.billingType as SubscriptionFixture["billingType"],
      cycle: obj.cycle as SubscriptionFixture["cycle"],
      valueCents: cents,
      nextDueDate: obj.nextDueDate,
    },
  };
}

export async function ensureSubscription(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  billingAccountId: string;
  externalCustomerId: string;
  scope: string;
  fixture: SubscriptionFixture;
}): Promise<EnsureSubscriptionResult> {
  const { adminClient, environment, creds, billingAccountId, externalCustomerId, scope, fixture } = params;

  const idempotencyKey = subscriptionIdempotencyKey(billingAccountId, scope);
  const externalReference = subscriptionExternalReference(environment, billingAccountId, scope);
  const expected = { externalCustomerId, externalReference };

  const { data: reserveData, error: reserveError } = await adminClient.rpc("reserve_billing_outbound_operation", {
    p_billing_account_id: billingAccountId,
    p_provider: "asaas",
    p_environment: environment,
    p_operation_type: "create_subscription",
    p_idempotency_key: idempotencyKey,
    p_external_reference: externalReference,
  });
  if (reserveError) {
    const hint = (reserveError as { hint?: string }).hint;
    if (hint === "CUSTOMER_NOT_PROVISIONED") {
      return { ok: false, errorCode: "customer_not_provisioned" };
    }
    return { ok: false, errorCode: "reserve_failed" };
  }
  if (!reserveData) {
    return { ok: false, errorCode: "reserve_failed" };
  }
  const reserve = reserveData as ReserveOutcome;

  if (reserve.outcome === "already_completed") {
    return { ok: true, externalSubscriptionId: reserve.external_object_id ?? undefined };
  }

  const operationId = reserve.operation_id;
  let canPost = reserve.outcome === "reserved";

  if (reserve.outcome === "in_flight_retry" || reserve.outcome === "claimed_for_retry") {
    const lookup = await asaasFetch<AsaasList<AsaasSubscription>>(
      creds,
      environment,
      "GET",
      `/subscriptions?externalReference=${encodeURIComponent(externalReference)}&customer=${encodeURIComponent(externalCustomerId)}`,
    );
    if (lookup.outcome !== "success") {
      await failOperation(adminClient, operationId, "reconciliation_lookup_failed");
      return { ok: false, errorCode: "reconciliation_lookup_failed" };
    }
    const found = lookup.data?.data ?? [];
    if (found.length === 1) {
      const extracted = extractSubscriptionFacts(found[0], expected);
      if (!extracted.ok) {
        await failOperation(adminClient, operationId, extracted.reason);
        return { ok: false, errorCode: extracted.reason };
      }
      return await completeSubscription(adminClient, operationId, scope, extracted.facts, externalReference);
    }
    if (found.length > 1) {
      await failOperation(adminClient, operationId, "reconciliation_ambiguous_multiple");
      return { ok: false, errorCode: "reconciliation_ambiguous_multiple" };
    }
    // 0 resultados: só seguro repetir o POST se a tentativa anterior teve rejeição
    // determinística comprovada. Outcome desconhecido (ou nenhuma categoria ainda) bloqueia.
    if (isOutcomeUnknownCategory(reserve.last_error_category)) {
      return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
    }
    canPost = true;
  }

  if (!canPost) {
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  const createRes = await asaasFetch<AsaasSubscription>(creds, environment, "POST", "/subscriptions", {
    customer: externalCustomerId,
    billingType: fixture.billingType,
    value: fixture.valueCents / 100,
    nextDueDate: todayISODate(),
    cycle: fixture.cycle,
    description: fixture.description,
    externalReference,
  });

  if (createRes.outcome === "deterministic_rejection") {
    await failOperation(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "provider_rejected" };
  }
  if (createRes.outcome === "unknown" || !createRes.data) {
    await failOperation(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  // Create-success: mesmo princípio da reconciliação — os fatos gravados vêm do objeto que a
  // Asaas devolveu, nunca da fixture local que enviamos (a Asaas pode normalizar/ajustar).
  const extracted = extractSubscriptionFacts(createRes.data, expected);
  if (!extracted.ok) {
    await failOperation(adminClient, operationId, extracted.reason);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  return await completeSubscription(adminClient, operationId, scope, extracted.facts, externalReference);
}

async function completeSubscription(
  adminClient: SupabaseClient,
  operationId: string,
  scope: string,
  facts: SubscriptionFacts,
  externalReference: string,
): Promise<EnsureSubscriptionResult> {
  const { data, error } = await adminClient.rpc("complete_billing_subscription_operation", {
    p_operation_id: operationId,
    p_external_subscription_id: facts.externalSubscriptionId,
    p_subscription_scope: scope,
    p_billing_type: facts.billingType,
    p_billing_cycle: facts.cycle,
    p_value_cents: facts.valueCents,
    p_next_due_date: facts.nextDueDate,
    p_external_reference: externalReference,
  });
  if (error || !data) {
    return { ok: false, errorCode: "complete_failed" };
  }
  const result = data as { outcome: string; external_subscription_id?: string };
  if (result.outcome === "conflict") {
    return { ok: false, errorCode: "external_id_conflict" };
  }
  return { ok: true, externalSubscriptionId: result.external_subscription_id ?? facts.externalSubscriptionId };
}

async function failOperation(adminClient: SupabaseClient, operationId: string, category: string): Promise<void> {
  await adminClient.rpc("fail_billing_outbound_operation", {
    p_operation_id: operationId,
    p_error_category: category,
  });
}
