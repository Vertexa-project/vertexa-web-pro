// WP-ASAAS-04 — processor idempotente de eventos financeiros Asaas.
//
// Fluxo por drain (bounded, sem recursão/polling): claim de um batch (FOR UPDATE SKIP LOCKED)
// -> para cada event: GET /payments/{id} (autoridade) -> política de falha/404 -> correlação
// subscription-only -> integridade de tenant (fail closed) -> normalização -> apply atômico.
//
// Princípios não negociáveis:
//  * O GET atual é a AUTORIDADE do snapshot; a ordem de chegada dos webhooks é irrelevante.
//    RECEIVED não é terminal — um refund/chargeback posterior reescreve o snapshot pelo GET.
//  * CORREÇÃO 2 (subscription-only): payment sem subscription => ignored_non_subscription_payment,
//    ZERO write. Nunca correlaciona por nome/email/CPF/value/externalReference.
//  * CORREÇÃO 3 (404 != voided): 404 é delegado ao handle_missing_payment_on_get.
//  * CORREÇÃO 1: não classificamos pelo tipo do evento; qualquer PAYMENT_* com correlação
//    válida atualiza o snapshot a partir do objeto atual (forward-compatible).
//  * ZERO retry quente: falhas retryable viram failed com backoff (next_attempt_at), nunca
//    um loop de re-tentativa dentro do mesmo drain.
//  * Um erro por evento nunca aborta os demais.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import { classifyAsaasEvent } from "./events.ts";
import { parseAsaasAmountToCents } from "./money.ts";
import { type AsaasPaymentFull, normalizePaymentSnapshot } from "./paymentSnapshot.ts";
import {
  extractAuthorizationFacts,
  extractInstructionFacts,
  getPixAutomaticAuthorization,
  getPixAutomaticPaymentInstruction,
  parseAsaasDateTime,
} from "./pixAutomatic.ts";

const PROVIDER = "asaas";

interface ClaimedEvent {
  id: string;
  external_event_id: string;
  event_type: string;
  event_created_at: string | null;
  external_resource_type: string | null;
  external_resource_id: string | null;
  environment: string;
  attempts: number;
  provider_facts?: Record<string, unknown> | null;
}

export interface EventOutcome {
  event_id: string;
  external_event_id: string;
  outcome: "processed" | "ignored" | "failed" | "voided" | "skipped";
  category: string;
}

export interface DrainResult {
  claimed: number;
  processed: number;
  ignored: number;
  failed: number;
  voided: number;
  skipped: number;
  outcomes: EventOutcome[];
}

/** Backoff exponencial limitado, derivado de attempts (já incrementado no claim). */
function backoffSeconds(attempts: number): number {
  const base = 30;
  const capped = Math.min(3600, base * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.floor(capped);
}

async function ignoreEvent(
  adminClient: SupabaseClient,
  eventId: string,
  reason: string,
): Promise<void> {
  await adminClient.rpc("ignore_billing_provider_event", { p_event_id: eventId, p_reason: reason });
}

async function failEvent(
  adminClient: SupabaseClient,
  eventId: string,
  category: string,
  retryable: boolean,
  backoff: number,
): Promise<void> {
  await adminClient.rpc("fail_billing_provider_event", {
    p_event_id: eventId,
    p_error_category: category,
    p_retryable: retryable,
    p_backoff_seconds: backoff,
  });
}

function asFacts(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function factString(facts: Record<string, unknown>, key: string): string {
  const value = facts[key];
  return typeof value === "string" ? value.trim() : "";
}

async function applyAuthorizationFacts(
  adminClient: SupabaseClient,
  ev: ClaimedEvent,
  environment: AsaasEnvironment,
  facts: {
    providerAuthorizationId: string;
    providerStatus: string;
    providerCustomerId: string;
    providerContractId: string | null;
    valueCents: number | null;
    conciliationIdentifier: string | null;
    qrExpiresAt: string | null;
  },
): Promise<{ outcome: string; reason?: string; amount_mismatch?: boolean }> {
  const { data, error } = await adminClient.rpc("apply_billing_pix_automatic_authorization_event", {
    p_event_id: ev.id,
    p_environment: environment,
    p_provider_authorization_id: facts.providerAuthorizationId,
    p_provider_status: facts.providerStatus,
    p_provider_customer_id: facts.providerCustomerId,
    p_provider_contract_id: facts.providerContractId,
    p_provider_value_cents: facts.valueCents,
    p_event_created_at: ev.event_created_at,
    p_conciliation_identifier: facts.conciliationIdentifier,
    p_qr_expires_at: facts.qrExpiresAt,
  });
  if (error) return { outcome: "apply_error" };
  return (data as { outcome?: string; reason?: string; amount_mismatch?: boolean }) ?? { outcome: "" };
}

async function processPixAutomaticAuthorization(
  adminClient: SupabaseClient,
  environment: AsaasEnvironment,
  creds: AsaasCredentials,
  ev: ClaimedEvent,
  base: { event_id: string; external_event_id: string },
): Promise<EventOutcome> {
  const webhookFacts = asFacts(ev.provider_facts);
  const authorizationId =
    (ev.external_resource_id ?? "").trim() || factString(webhookFacts, "providerAuthorizationId");
  if (!authorizationId) {
    await ignoreEvent(adminClient, ev.id, "missing_resource_id");
    return { ...base, outcome: "ignored", category: "missing_resource_id" };
  }

  const res = await getPixAutomaticAuthorization(creds, environment, authorizationId);
  if (res.outcome === "unknown") {
    await failEvent(adminClient, ev.id, res.category, true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: res.category };
  }
  if (res.outcome === "success" && res.data) {
    const getCustomer =
      typeof (res.data as { customerId?: unknown }).customerId === "string"
        ? (res.data as { customerId: string }).customerId
        : "";
    const extracted = extractAuthorizationFacts(res.data, { customerId: getCustomer || "missing" });
    if (!extracted.ok) {
      await failEvent(adminClient, ev.id, extracted.reason, false, 0);
      return { ...base, outcome: "failed", category: extracted.reason };
    }
    const applied = await applyAuthorizationFacts(adminClient, ev, environment, extracted.facts);
    return mapPixApplyOutcome(base, applied);
  }

  if (res.status === 401 || res.status === 403) {
    await failEvent(adminClient, ev.id, "provider_auth_error", false, 0);
    return { ...base, outcome: "failed", category: "provider_auth_error" };
  }
  if (res.category === "rate_limited") {
    await failEvent(adminClient, ev.id, "rate_limited", true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: "rate_limited" };
  }

  const fallbackStatus = factString(webhookFacts, "providerStatus");
  const fallbackCustomer = factString(webhookFacts, "providerCustomerId");
  if (authorizationId && fallbackStatus && fallbackCustomer) {
    const valueCents =
      typeof webhookFacts.providerValue === "number"
        ? parseAsaasAmountToCents(webhookFacts.providerValue)
        : null;
    const applied = await applyAuthorizationFacts(adminClient, ev, environment, {
      providerAuthorizationId: authorizationId,
      providerStatus: fallbackStatus,
      providerCustomerId: fallbackCustomer,
      providerContractId: factString(webhookFacts, "providerContractId") || null,
      valueCents,
      conciliationIdentifier: factString(webhookFacts, "conciliationIdentifier") || null,
      qrExpiresAt: parseAsaasDateTime(webhookFacts.qrExpiresAt),
    });
    return mapPixApplyOutcome(base, applied);
  }

  await ignoreEvent(adminClient, ev.id, "ignored_unmanaged_resource");
  return { ...base, outcome: "ignored", category: "ignored_unmanaged_resource" };
}

function mapPixApplyOutcome(
  base: { event_id: string; external_event_id: string },
  applied: { outcome: string; reason?: string; amount_mismatch?: boolean },
): EventOutcome {
  if (applied.outcome === "applied") {
    return {
      ...base,
      outcome: "processed",
      category: applied.amount_mismatch ? "PROVIDER_AMOUNT_MISMATCH" : "applied",
    };
  }
  if (applied.outcome === "ignored") {
    return { ...base, outcome: "ignored", category: applied.reason || "ignored" };
  }
  if (applied.outcome === "failed") {
    return { ...base, outcome: "failed", category: applied.reason || "apply_failed" };
  }
  return { ...base, outcome: "skipped", category: applied.outcome || "not_claimed" };
}

async function processPixAutomaticEligibility(
  adminClient: SupabaseClient,
  environment: AsaasEnvironment,
  ev: ClaimedEvent,
  base: { event_id: string; external_event_id: string },
): Promise<EventOutcome> {
  const facts = asFacts(ev.provider_facts);
  const status = factString(facts, "eligibilityStatus");
  if (status !== "ELIGIBLE" && status !== "INELIGIBLE") {
    await ignoreEvent(adminClient, ev.id, "invalid_provider_facts");
    return { ...base, outcome: "ignored", category: "invalid_provider_facts" };
  }
  const { data, error } = await adminClient.rpc("apply_billing_pix_automatic_eligibility_event", {
    p_event_id: ev.id,
    p_environment: environment,
    p_provider_account_id: factString(facts, "providerAccountId") || ev.external_resource_id,
    p_status: status,
    p_event_created_at: ev.event_created_at,
  });
  if (error) {
    await failEvent(adminClient, ev.id, "apply_error", true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: "apply_error" };
  }
  return mapPixApplyOutcome(base, (data as { outcome?: string; reason?: string }) ?? { outcome: "" });
}

async function processPixAutomaticInstruction(
  adminClient: SupabaseClient,
  environment: AsaasEnvironment,
  creds: AsaasCredentials,
  ev: ClaimedEvent,
  base: { event_id: string; external_event_id: string },
): Promise<EventOutcome> {
  const webhookFacts = asFacts(ev.provider_facts);
  const instructionId =
    (ev.external_resource_id ?? "").trim() || factString(webhookFacts, "providerInstructionId");
  if (!instructionId) {
    await ignoreEvent(adminClient, ev.id, "missing_resource_id");
    return { ...base, outcome: "ignored", category: "missing_resource_id" };
  }

  const res = await getPixAutomaticPaymentInstruction(creds, environment, instructionId);
  let facts = null as ReturnType<typeof extractInstructionFacts> | null;
  if (res.outcome === "unknown") {
    await failEvent(adminClient, ev.id, res.category, true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: res.category };
  }
  if (res.outcome === "success" && res.data) {
    facts = extractInstructionFacts(res.data);
  } else if (res.status === 401 || res.status === 403) {
    await failEvent(adminClient, ev.id, "provider_auth_error", false, 0);
    return { ...base, outcome: "failed", category: "provider_auth_error" };
  } else if (res.category === "rate_limited") {
    await failEvent(adminClient, ev.id, "rate_limited", true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: "rate_limited" };
  } else {
    facts = extractInstructionFacts({
      id: instructionId,
      status: factString(webhookFacts, "instructionStatus"),
      dueDate: factString(webhookFacts, "dueDate") || undefined,
      paymentId: factString(webhookFacts, "providerPaymentId") || undefined,
      authorization: { id: factString(webhookFacts, "providerAuthorizationId") },
    });
  }

  if (!facts || !facts.ok) {
    await ignoreEvent(adminClient, ev.id, facts?.ok === false ? facts.reason : "invalid_provider_facts");
    return { ...base, outcome: "ignored", category: "invalid_provider_facts" };
  }

  const { data, error } = await adminClient.rpc("apply_billing_pix_automatic_instruction_event", {
    p_event_id: ev.id,
    p_environment: environment,
    p_provider_instruction_id: facts.facts.providerInstructionId,
    p_instruction_status: facts.facts.status,
    p_provider_authorization_id: facts.facts.providerAuthorizationId,
    p_provider_payment_id: facts.facts.providerPaymentId,
    p_due_date: facts.facts.dueDate,
    p_event_created_at: ev.event_created_at,
  });
  if (error) {
    await failEvent(adminClient, ev.id, "apply_error", true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: "apply_error" };
  }
  return mapPixApplyOutcome(base, (data as { outcome?: string; reason?: string }) ?? { outcome: "" });
}

/** Processa um único evento reivindicado. Nunca lança: sempre resolve num EventOutcome. */
async function processOneEvent(
  adminClient: SupabaseClient,
  environment: AsaasEnvironment,
  creds: AsaasCredentials,
  ev: ClaimedEvent,
): Promise<EventOutcome> {
  const base = { event_id: ev.id, external_event_id: ev.external_event_id };
  const eventType = (ev.event_type ?? "").trim();
  const classified = classifyAsaasEvent(eventType);

  if (classified.family === "pix_automatic_authorization") {
    return processPixAutomaticAuthorization(adminClient, environment, creds, ev, base);
  }
  if (classified.family === "pix_automatic_eligibility") {
    return processPixAutomaticEligibility(adminClient, environment, ev, base);
  }
  if (classified.family === "pix_automatic_payment_instruction") {
    return processPixAutomaticInstruction(adminClient, environment, creds, ev, base);
  }

  // Só eventos de payment são materializáveis no pipeline financeiro. Qualquer outro => ignore.
  if (!eventType.startsWith("PAYMENT_") || ev.external_resource_type !== "payment") {
    await ignoreEvent(adminClient, ev.id, "unsupported_event");
    return { ...base, outcome: "ignored", category: "unsupported_event" };
  }
  const paymentId = (ev.external_resource_id ?? "").trim();
  if (paymentId === "") {
    await ignoreEvent(adminClient, ev.id, "missing_resource_id");
    return { ...base, outcome: "ignored", category: "missing_resource_id" };
  }

  // GET autoritativo. Nunca lança (asaasFetch é total).
  const res = await asaasFetch<AsaasPaymentFull>(
    creds,
    environment,
    "GET",
    `/payments/${encodeURIComponent(paymentId)}`,
  );

  // ── Política de falha do GET (GATE 11) ────────────────────────────────────────────
  if (res.outcome === "unknown") {
    // timeout / 5xx / 2xx vazio ou malformado: pode ser transitório => retryable com backoff.
    await failEvent(adminClient, ev.id, res.category, true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: res.category };
  }
  if (res.outcome === "deterministic_rejection") {
    if (res.status === 404) {
      // CORREÇÃO 3: 404 nunca é voided genérico — delega a política controlada ao DB.
      const { data, error } = await adminClient.rpc("handle_missing_payment_on_get", {
        p_event_id: ev.id,
        p_provider: PROVIDER,
        p_environment: environment,
        p_external_payment_id: paymentId,
        p_event_type: eventType,
        p_event_created_at: ev.event_created_at,
      });
      if (error) {
        await failEvent(adminClient, ev.id, "missing_payment_handler_error", true, backoffSeconds(ev.attempts));
        return { ...base, outcome: "failed", category: "missing_payment_handler_error" };
      }
      const outcome = (data as { outcome?: string; reason?: string } | null)?.outcome ?? "";
      if (outcome === "voided") return { ...base, outcome: "voided", category: "payment_deleted_voided" };
      if (outcome === "ignored") return { ...base, outcome: "ignored", category: "ignored_unmanaged_resource" };
      if (outcome === "failed") {
        return { ...base, outcome: "failed", category: "provider_resource_not_found_requires_review" };
      }
      // event_not_claimed/event_not_found: outro worker resolveu — não conta como nosso.
      return { ...base, outcome: "skipped", category: outcome || "not_claimed" };
    }
    if (res.status === 401 || res.status === 403) {
      // Credencial/permissão inválida: erro de configuração — non-retryable até intervenção humana.
      await failEvent(adminClient, ev.id, "provider_auth_error", false, 0);
      return { ...base, outcome: "failed", category: "provider_auth_error" };
    }
    if (res.category === "rate_limited") {
      // 429: recusa determinística mas transitória => retryable com backoff.
      await failEvent(adminClient, ev.id, "rate_limited", true, backoffSeconds(ev.attempts));
      return { ...base, outcome: "failed", category: "rate_limited" };
    }
    // Outro 4xx num GET (400/422...): anômalo e determinístico => non-retryable p/ review.
    await failEvent(adminClient, ev.id, "provider_get_client_error", false, 0);
    return { ...base, outcome: "failed", category: "provider_get_client_error" };
  }

  // ── outcome === "success" ───────────────────────────────────────────────────────
  const payment = res.data;
  if (!payment || typeof payment !== "object") {
    await failEvent(adminClient, ev.id, "invalid_payment_shape", false, 0);
    return { ...base, outcome: "failed", category: "invalid_payment_shape" };
  }

  // CORREÇÃO 2 (subscription-only): payment sem subscription NUNCA vira billing_payment.
  const subscription = typeof payment.subscription === "string" ? payment.subscription.trim() : "";
  if (subscription === "") {
    await ignoreEvent(adminClient, ev.id, "ignored_non_subscription_payment");
    return { ...base, outcome: "ignored", category: "ignored_non_subscription_payment" };
  }

  const normalized = normalizePaymentSnapshot(payment);
  if (!normalized.ok) {
    // Shape/valor determinísticos: non-retryable (dado do provider precisa de revisão).
    await failEvent(adminClient, ev.id, normalized.errorCode, false, 0);
    return { ...base, outcome: "failed", category: normalized.errorCode };
  }
  const snap = normalized.snapshot;

  // Correlação server-side (subscription -> tenant). Nunca por PII/value.
  const { data: target, error: resolveError } = await adminClient.rpc(
    "resolve_billing_target_by_subscription",
    {
      p_provider: PROVIDER,
      p_environment: environment,
      p_external_subscription_id: snap.externalSubscriptionId,
    },
  );
  if (resolveError) {
    await failEvent(adminClient, ev.id, "correlation_lookup_error", true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: "correlation_lookup_error" };
  }
  const resolved = target as
    | { found?: boolean; external_customer_id?: string | null }
    | null;
  if (!resolved?.found) {
    // subscription existe no Asaas mas não é gerenciada pelo Vertexa.
    await ignoreEvent(adminClient, ev.id, "ignored_unmanaged_resource");
    return { ...base, outcome: "ignored", category: "ignored_unmanaged_resource" };
  }

  // Integridade de tenant: customer do payment DEVE bater com o da conta. FAIL CLOSED.
  if ((resolved.external_customer_id ?? null) !== snap.externalCustomerId) {
    await failEvent(adminClient, ev.id, "customer_mismatch", false, 0);
    return { ...base, outcome: "failed", category: "customer_mismatch" };
  }

  // Apply atômico (upsert do snapshot + complete do event na mesma tx).
  const { data: applyData, error: applyError } = await adminClient.rpc("apply_billing_payment_snapshot", {
    p_event_id: ev.id,
    p_external_event_id: ev.external_event_id,
    p_provider: PROVIDER,
    p_environment: environment,
    p_external_payment_id: snap.externalPaymentId,
    p_external_subscription_id: snap.externalSubscriptionId,
    p_external_customer_id: snap.externalCustomerId,
    p_provider_status: snap.providerStatus,
    p_financial_state: snap.financialState,
    p_billing_type: snap.billingType,
    p_value_cents: snap.valueCents,
    p_net_value_cents: snap.netValueCents,
    p_refunded_value_cents: snap.refundedValueCents,
    p_due_date: snap.dueDate,
    p_payment_date: snap.paymentDate,
    p_confirmed_date: snap.confirmedDate,
    p_event_type: eventType,
    p_event_created_at: ev.event_created_at,
  });
  if (applyError) {
    await failEvent(adminClient, ev.id, "apply_error", true, backoffSeconds(ev.attempts));
    return { ...base, outcome: "failed", category: "apply_error" };
  }
  const applyOutcome = (applyData as { outcome?: string } | null)?.outcome ?? "";
  if (applyOutcome === "applied") {
    return { ...base, outcome: "processed", category: snap.financialState };
  }
  if (applyOutcome === "customer_mismatch") {
    await failEvent(adminClient, ev.id, "customer_mismatch", false, 0);
    return { ...base, outcome: "failed", category: "customer_mismatch" };
  }
  if (applyOutcome === "unmanaged_subscription") {
    await ignoreEvent(adminClient, ev.id, "ignored_unmanaged_resource");
    return { ...base, outcome: "ignored", category: "ignored_unmanaged_resource" };
  }
  // event_not_claimed/event_not_found: já resolvido por outro worker.
  return { ...base, outcome: "skipped", category: applyOutcome || "not_claimed" };
}

/**
 * Drena até `limit` eventos (o RPC de claim faz o clamp 1..25). Bounded e sem polling: um
 * claim, processa cada event de forma independente, retorna o sumário técnico (sem PII).
 */
export async function drainBillingEvents(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  limit: number;
}): Promise<DrainResult> {
  const { adminClient, environment, creds, limit } = params;

  const { data, error } = await adminClient.rpc("claim_billing_provider_events", {
    p_provider: PROVIDER,
    p_environment: environment,
    p_limit: limit,
  });
  if (error) {
    throw new Error("claim_failed");
  }
  const events = (data as ClaimedEvent[] | null) ?? [];

  const result: DrainResult = {
    claimed: events.length,
    processed: 0,
    ignored: 0,
    failed: 0,
    voided: 0,
    skipped: 0,
    outcomes: [],
  };

  for (const ev of events) {
    let outcome: EventOutcome;
    try {
      outcome = await processOneEvent(adminClient, environment, creds, ev);
    } catch (_e) {
      // Nunca deixamos um erro inesperado abortar o batch. Marca failed retryable.
      await failEvent(adminClient, ev.id, "unexpected_processor_error", true, backoffSeconds(ev.attempts));
      outcome = {
        event_id: ev.id,
        external_event_id: ev.external_event_id,
        outcome: "failed",
        category: "unexpected_processor_error",
      };
    }
    result.outcomes.push(outcome);
    switch (outcome.outcome) {
      case "processed":
        result.processed++;
        break;
      case "ignored":
        result.ignored++;
        break;
      case "failed":
        result.failed++;
        break;
      case "voided":
        result.voided++;
        break;
      case "skipped":
        result.skipped++;
        break;
    }
  }

  return result;
}
