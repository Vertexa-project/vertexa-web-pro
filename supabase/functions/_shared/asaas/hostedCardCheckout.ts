import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, isOutcomeUnknownCategory, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";

export const HOSTED_CARD_CHECKOUT_EXPIRY_MINUTES = 60;

export interface HostedCardCheckoutIntent {
  attemptId: string;
  billingAccountId: string;
  environment: AsaasEnvironment;
  externalCustomerId: string | null;
  externalReference: string;
  priceCents: number;
  currency: "BRL";
  planName: string;
  expiresAt: string;
  hostedUrl: string | null;
  providerCheckoutId: string | null;
  canCreate: boolean;
  status: "CREATING" | "ACTIVE" | "PAID" | "CANCELED" | "EXPIRED" | "FAILED";
}

interface ProviderCheckout {
  id?: unknown;
  link?: unknown;
  status?: unknown;
}

function amount(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("invalid_cents");
  return cents / 100;
}

function firstDueDate(): string {
  // Existing Vertexa subscription creation treats the current business date as
  // the first charge date. This is activation, not a trial or delayed charge.
  return new Date().toISOString().slice(0, 10);
}

function callback(baseUrl: string, state: "success" | "cancel" | "expired"): string {
  return `${baseUrl.replace(/\/$/, "")}/configuracoes/faturamento/checkout/${state}`;
}

export function hostedCardCheckoutPayload(intent: HostedCardCheckoutIntent, appBaseUrl: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: HOSTED_CARD_CHECKOUT_EXPIRY_MINUTES,
    externalReference: intent.externalReference,
    callback: {
      successUrl: callback(appBaseUrl, "success"),
      cancelUrl: callback(appBaseUrl, "cancel"),
      expiredUrl: callback(appBaseUrl, "expired"),
    },
    items: [{
      name: intent.planName,
      description: "Assinatura mensal Vertexa",
      quantity: 1,
      value: amount(intent.priceCents),
    }],
    subscription: {
      cycle: "MONTHLY",
      nextDueDate: firstDueDate(),
    },
  };
  // Existing canonical customer is safe to reuse. When absent, Asaas collects
  // payer data on the hosted page; never combine customer and customerData.
  if (intent.externalCustomerId) payload.customer = intent.externalCustomerId;
  return payload;
}

export async function createHostedCardCheckout(params: {
  adminClient: SupabaseClient;
  creds: AsaasCredentials;
  intent: HostedCardCheckoutIntent;
  appBaseUrl: string;
}): Promise<{ ok: true; hostedUrl: string } | { ok: false; errorCode: string }> {
  const { adminClient, creds, intent, appBaseUrl } = params;
  if (intent.hostedUrl && intent.providerCheckoutId) return { ok: true, hostedUrl: intent.hostedUrl };
  // A retained creating attempt is an ambiguous prior provider write.  Never
  // replay it; it needs reconciliation before a fresh attempt is authorized.
  if (!intent.canCreate) {
    return { ok: false, errorCode: intent.status === "PAID" ? "checkout_paid_awaiting_reconciliation" : "outcome_unknown_requires_reconciliation" };
  }

  const created = await asaasFetch<ProviderCheckout>(
    creds,
    intent.environment,
    "POST",
    "/checkouts",
    hostedCardCheckoutPayload(intent, appBaseUrl),
  );
  if (created.outcome === "deterministic_rejection") {
    await adminClient.rpc("fail_my_clinic_hosted_card_checkout", {
      p_attempt_id: intent.attemptId,
      p_error_category: "provider_rejected",
    });
    return { ok: false, errorCode: "provider_rejected" };
  }
  if (created.outcome === "unknown" || !created.data) {
    return { ok: false, errorCode: isOutcomeUnknownCategory(created.category) ? "outcome_unknown_requires_reconciliation" : "provider_error" };
  }
  if (typeof created.data.id !== "string" || !created.data.id || typeof created.data.link !== "string" || !created.data.link) {
    return { ok: false, errorCode: "invalid_provider_checkout_response" };
  }
  const { data, error } = await adminClient.rpc("complete_my_clinic_hosted_card_checkout", {
    p_attempt_id: intent.attemptId,
    p_provider_checkout_id: created.data.id,
    p_hosted_url: created.data.link,
  });
  if (error || !data) return { ok: false, errorCode: "complete_failed" };
  const result = data as { outcome?: unknown; hosted_url?: unknown };
  if ((result.outcome !== "active" && result.outcome !== "already_active") || typeof result.hosted_url !== "string") {
    return { ok: false, errorCode: result.outcome === "expired" ? "attempt_expired" : "complete_failed" };
  }
  return { ok: true, hostedUrl: result.hosted_url };
}
