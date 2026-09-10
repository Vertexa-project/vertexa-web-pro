// WP-ASAAS-03 — algoritmo de idempotência para create_subscription (GATE 6 do plano).
// Pré-condição (customer provisionado) é imposta pela própria reserve RPC (CUSTOMER_NOT_PROVISIONED).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, classifyAsaasFailure, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
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

interface AsaasSubscription {
  id: string;
}

interface AsaasList<T> {
  data: T[];
}

interface ReserveOutcome {
  outcome: string;
  operation_id: string;
  external_object_id?: string | null;
}

/** nextDueDate calculado fresco no momento da chamada — seguro pq lookup-first sempre roda antes de repetir POST. */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
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

  if (reserve.outcome === "in_flight_retry" || reserve.outcome === "claimed_for_retry") {
    const lookup = await asaasFetch<AsaasList<AsaasSubscription>>(
      creds,
      environment,
      "GET",
      `/subscriptions?externalReference=${encodeURIComponent(externalReference)}&customer=${encodeURIComponent(externalCustomerId)}`,
    );
    if (!lookup.ok) {
      await failOperation(adminClient, operationId, classifyAsaasFailure(lookup));
      return { ok: false, errorCode: "reconciliation_lookup_failed" };
    }
    const found = lookup.data?.data ?? [];
    if (found.length === 1) {
      return await completeSubscription(adminClient, operationId, found[0].id, scope, fixture, externalReference);
    }
    if (found.length > 1) {
      await failOperation(adminClient, operationId, "reconciliation_ambiguous_multiple");
      return { ok: false, errorCode: "reconciliation_ambiguous_multiple" };
    }
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

  if (!createRes.ok || !createRes.data) {
    await failOperation(adminClient, operationId, classifyAsaasFailure(createRes));
    return { ok: false, errorCode: "provider_error" };
  }

  return await completeSubscription(adminClient, operationId, createRes.data.id, scope, fixture, externalReference);
}

async function completeSubscription(
  adminClient: SupabaseClient,
  operationId: string,
  externalSubscriptionId: string,
  scope: string,
  fixture: SubscriptionFixture,
  externalReference: string,
): Promise<EnsureSubscriptionResult> {
  const { data, error } = await adminClient.rpc("complete_billing_subscription_operation", {
    p_operation_id: operationId,
    p_external_subscription_id: externalSubscriptionId,
    p_subscription_scope: scope,
    p_billing_type: fixture.billingType,
    p_billing_cycle: fixture.cycle,
    p_value_cents: fixture.valueCents,
    p_next_due_date: todayISODate(),
    p_external_reference: externalReference,
  });
  if (error || !data) {
    return { ok: false, errorCode: "complete_failed" };
  }
  const result = data as { outcome: string; external_subscription_id?: string };
  if (result.outcome === "conflict") {
    return { ok: false, errorCode: "external_id_conflict" };
  }
  return { ok: true, externalSubscriptionId: result.external_subscription_id ?? externalSubscriptionId };
}

async function failOperation(adminClient: SupabaseClient, operationId: string, category: string): Promise<void> {
  await adminClient.rpc("fail_billing_outbound_operation", {
    p_operation_id: operationId,
    p_error_category: category,
  });
}
