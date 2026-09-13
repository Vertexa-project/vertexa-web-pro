// WP-ASAAS-05E0B — create Pix Automatic authorization no ledger outbound existente.
// Lookup-first após outcome unknown. Nunca POST cego. Sem ação de browser.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isOutcomeUnknownCategory, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import { pixAutomaticAuthorizationIdempotencyKey } from "./keys.ts";
import {
  QR_UNAVAILABLE_ALREADY_COMPLETED,
  QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE,
  QR_UNAVAILABLE_PAYLOAD_MISSING,
  createPixAutomaticAuthorization,
  extractAuthorizationFacts,
  extractTransientImmediateQr,
  findAuthorizationByContractId,
  pixAutomaticProviderContractId,
  type PixAutomaticAuthorizationFacts,
  type PixAutomaticQrHandoffKind,
  type PixAutomaticTransientQr,
} from "./pixAutomatic.ts";

export interface EnsurePixAutomaticAuthorizationInput {
  billingAccountId: string;
  commercialContractId: string;
  externalCustomerId: string | null;
  contractedPriceCents: number;
  startDate: string;
  description?: string;
}

export interface EnsurePixAutomaticAuthorizationResult {
  ok: boolean;
  providerAuthorizationId?: string;
  providerStatus?: string;
  errorCode?: string;
  handoffKind?: PixAutomaticQrHandoffKind;
  qrAvailable?: boolean;
  qrUnavailableReason?: string;
  immediateQrCode?: PixAutomaticTransientQr;
}

interface ReserveOutcome {
  outcome: string;
  operation_id: string;
  external_object_id?: string | null;
  last_error_category?: string | null;
}

export async function ensurePixAutomaticAuthorization(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  intent: EnsurePixAutomaticAuthorizationInput;
}): Promise<EnsurePixAutomaticAuthorizationResult> {
  const { adminClient, environment, creds, intent } = params;
  const externalCustomerId = (intent.externalCustomerId ?? "").trim();
  if (!externalCustomerId) {
    return { ok: false, errorCode: "customer_not_provisioned" };
  }

  const contractId = pixAutomaticProviderContractId(intent.commercialContractId);
  const idempotencyKey = pixAutomaticAuthorizationIdempotencyKey(
    intent.billingAccountId,
    intent.commercialContractId,
  );
  const expected = { customerId: externalCustomerId, contractId };

  const { data: reserveData, error: reserveError } = await adminClient.rpc(
    "reserve_billing_outbound_operation",
    {
      p_billing_account_id: intent.billingAccountId,
      p_provider: "asaas",
      p_environment: environment,
      p_operation_type: "create_pix_automatic_authorization",
      p_idempotency_key: idempotencyKey,
      p_external_reference: `vtx:${environment}:${intent.billingAccountId}:pix_automatic_authorization:primary:${intent.commercialContractId}`,
    },
  );
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
    return {
      ok: true,
      providerAuthorizationId: reserve.external_object_id ?? undefined,
      handoffKind: "already_completed_without_qr",
      qrAvailable: false,
      qrUnavailableReason: QR_UNAVAILABLE_ALREADY_COMPLETED,
    };
  }

  const operationId = reserve.operation_id;
  let canPost = reserve.outcome === "reserved";

  if (reserve.outcome === "in_flight_retry" || reserve.outcome === "claimed_for_retry") {
    const lookup = await findAuthorizationByContractId(
      creds,
      environment,
      externalCustomerId,
      contractId,
    );
    if (lookup.outcome === "lookup_failed") {
      await failOperation(adminClient, operationId, "reconciliation_lookup_failed");
      return { ok: false, errorCode: "reconciliation_lookup_failed" };
    }
    if (lookup.outcome === "ambiguous") {
      await failOperation(adminClient, operationId, "reconciliation_ambiguous_multiple");
      return { ok: false, errorCode: "reconciliation_ambiguous_multiple" };
    }
    if (lookup.outcome === "found") {
      const extracted = extractAuthorizationFacts(lookup.object, expected);
      if (!extracted.ok) {
        await failOperation(adminClient, operationId, extracted.reason);
        return { ok: false, errorCode: extracted.reason };
      }
      return await completeAuthorization(adminClient, operationId, extracted.facts, {
        kind: "reconciled_existing_without_qr",
        qrAvailable: false,
        qrUnavailableReason: QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE,
      });
    }
    // 0 resultados: só POST de novo se a tentativa anterior foi rejeição determinística.
    if (isOutcomeUnknownCategory(reserve.last_error_category)) {
      return { ok: false, errorCode: "BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION" };
    }
    canPost = true;
  }

  if (!canPost) {
    return { ok: false, errorCode: "BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION" };
  }

  let createRes;
  try {
    createRes = await createPixAutomaticAuthorization(creds, environment, {
      customerId: externalCustomerId,
      contractId,
      startDate: intent.startDate,
      valueCents: intent.contractedPriceCents,
      description: intent.description,
    });
  } catch {
    await failOperation(adminClient, operationId, "invalid_create_payload");
    return { ok: false, errorCode: "invalid_create_payload" };
  }

  if (createRes.outcome === "deterministic_rejection") {
    await failOperation(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "provider_rejected" };
  }
  if (createRes.outcome === "unknown" || !createRes.data) {
    await failOperation(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  const extracted = extractAuthorizationFacts(createRes.data, expected);
  if (!extracted.ok) {
    await failOperation(adminClient, operationId, extracted.reason);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  const transientQr = extractTransientImmediateQr(createRes.data);
  if (transientQr.ok) {
    return await completeAuthorization(adminClient, operationId, extracted.facts, {
      kind: "fresh_create_with_qr",
      qrAvailable: true,
      immediateQrCode: transientQr.qr,
    });
  }
  return await completeAuthorization(adminClient, operationId, extracted.facts, {
    kind: "fresh_create_qr_unavailable",
    qrAvailable: false,
    qrUnavailableReason: QR_UNAVAILABLE_PAYLOAD_MISSING,
  });
}

type EnsureQrHandoff =
  | {
      kind: "fresh_create_with_qr";
      qrAvailable: true;
      immediateQrCode: PixAutomaticTransientQr;
    }
  | {
      kind: "fresh_create_qr_unavailable";
      qrAvailable: false;
      qrUnavailableReason: typeof QR_UNAVAILABLE_PAYLOAD_MISSING;
    }
  | {
      kind: "reconciled_existing_without_qr";
      qrAvailable: false;
      qrUnavailableReason: typeof QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE;
    };

async function completeAuthorization(
  adminClient: SupabaseClient,
  operationId: string,
  facts: PixAutomaticAuthorizationFacts,
  handoff: EnsureQrHandoff,
): Promise<EnsurePixAutomaticAuthorizationResult> {
  const { data, error } = await adminClient.rpc(
    "complete_billing_pix_automatic_authorization_operation",
    {
      p_operation_id: operationId,
      p_provider_authorization_id: facts.providerAuthorizationId,
      p_provider_status: facts.providerStatus,
      p_provider_customer_id: facts.providerCustomerId,
      p_conciliation_identifier: facts.conciliationIdentifier,
      p_qr_expires_at: facts.qrExpiresAt,
    },
  );
  if (error || !data) {
    return { ok: false, errorCode: "complete_failed" };
  }
  const result = data as { outcome: string; provider_authorization_id?: string; provider_status?: string };
  if (result.outcome === "conflict") {
    return { ok: false, errorCode: "external_id_conflict" };
  }
  return {
    ok: true,
    providerAuthorizationId: result.provider_authorization_id ?? facts.providerAuthorizationId,
    providerStatus: result.provider_status ?? facts.providerStatus,
    handoffKind: handoff.kind,
    qrAvailable: handoff.qrAvailable,
    ...(handoff.qrAvailable
      ? { immediateQrCode: handoff.immediateQrCode }
      : { qrUnavailableReason: handoff.qrUnavailableReason }),
  };
}

async function failOperation(adminClient: SupabaseClient, operationId: string, category: string): Promise<void> {
  await adminClient.rpc("fail_billing_outbound_operation", {
    p_operation_id: operationId,
    p_error_category: category,
  });
}
