// WP-ASAAS-05E0B — create Pix Automatic authorization no ledger outbound existente.
// Lookup-first após outcome unknown. Nunca POST cego. Sem ação de browser.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isOutcomeUnknownCategory, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import {
  QR_UNAVAILABLE_ALREADY_COMPLETED,
  QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE,
  QR_UNAVAILABLE_PAYLOAD_MISSING,
  createPixAutomaticAuthorization,
  extractAuthorizationFacts,
  extractTransientImmediateQr,
  findAuthorizationByContractId,
  type PixAutomaticAuthorizationFacts,
  type PixAutomaticQrHandoffKind,
  type PixAutomaticTransientQr,
} from "./pixAutomatic.ts";

export interface EnsurePixAutomaticAuthorizationInput {
  billingAccountId: string;
  commercialContractId: string;
  authorizationId: string;
  providerContractId: string;
  idempotencyKey: string;
  externalReference: string;
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
  attempt_count?: number;
  external_object_id?: string | null;
  last_error_category?: string | null;
  provider_write_window_at?: string | null;
}

/**
 * Intervalo de segurança depois de uma escrita sem resultado conhecido (timeout/5xx/linha
 * pendente abandonada). Passado esse tempo, uma requisição ao Asaas já terminou de um jeito ou de
 * outro (a Edge Function morre bem antes) e a listagem por contractId é prova de ausência: só
 * então um novo POST é seguro. Antes disso, a clínica recebe "tente de novo em alguns minutos".
 */
export const PIX_AUTHORIZATION_RETRY_WINDOW_MS = 3 * 60 * 1000;

export function isProviderWriteWindowClosed(
  windowAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!windowAt) return false;
  const at = Date.parse(windowAt);
  if (!Number.isFinite(at)) return false;
  return nowMs - at >= PIX_AUTHORIZATION_RETRY_WINDOW_MS;
}

/**
 * Pix Automatic first-write reservation (EXECUTE side).
 *
 * Safe ONLY if PREPARE is insert-only: pending/attempt=1/last_error NULL/no
 * provider HTTP, and a repeated PREPARE must NOT increment attempt_count.
 * Then the first EXECUTE unique_violation increments 1→2 under FOR UPDATE.
 * That 1→2 transition is FIRST_WRITE_RESERVED. A concurrent loser sees
 * attempt_count>=3 and must lookup-first / fail closed.
 *
 * Current live PREPARE uses insert-only SQL (WP-ASAAS-05E1B-R2). A second
 * PREPARE returns the existing row and does not increment attempt_count.
 * Do not deploy this helper without that migration.
 *
 * Not valid for create_customer/create_subscription: those INSERT reserved at
 * attempt=1 and may already be mid-POST.
 */
export function isPixAutomaticPreparedFirstWrite(reserve: ReserveOutcome): boolean {
  return (
    reserve.outcome === "in_flight_retry" &&
    reserve.attempt_count === 2 &&
    (reserve.last_error_category == null || reserve.last_error_category === "") &&
    (reserve.external_object_id == null || reserve.external_object_id === "")
  );
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

  const authorizationId = intent.authorizationId.trim();
  const contractId = intent.providerContractId.trim().toLowerCase();
  const idempotencyKey = intent.idempotencyKey.trim();
  const externalReference = intent.externalReference.trim();
  if (
    !authorizationId ||
    !/^[0-9a-f]{32}$/.test(contractId) ||
    !idempotencyKey ||
    !externalReference
  ) {
    return { ok: false, errorCode: "authorization_correlation_missing" };
  }
  const expected = { customerId: externalCustomerId, contractId };

  const { data: reserveData, error: reserveError } = await adminClient.rpc(
    "reserve_billing_outbound_operation",
    {
      p_billing_account_id: intent.billingAccountId,
      p_provider: "asaas",
      p_environment: environment,
      p_operation_type: "create_pix_automatic_authorization",
      p_idempotency_key: idempotencyKey,
      p_external_reference: externalReference,
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
  const preparedFirstWrite = isPixAutomaticPreparedFirstWrite(reserve);
  let canPost = reserve.outcome === "reserved" || preparedFirstWrite;

  if ((reserve.outcome === "in_flight_retry" || reserve.outcome === "claimed_for_retry") && !preparedFirstWrite) {
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
    // 0 resultados: POST de novo se a tentativa anterior foi rejeição determinística, ou se a
    // escrita sem resultado já saiu do intervalo de segurança (a busca acima prova a ausência).
    if (
      isOutcomeUnknownCategory(reserve.last_error_category) &&
      !isProviderWriteWindowClosed(reserve.provider_write_window_at)
    ) {
      if (reserve.outcome === "claimed_for_retry") {
        // Devolve a operação a "falhou" com a mesma causa; o relógio do intervalo não reinicia.
        await failOperation(
          adminClient,
          operationId,
          reserve.last_error_category || "reconciliation_retry_later",
        );
      }
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
    await failAfterUnknownWrite(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  const extracted = extractAuthorizationFacts(createRes.data, expected);
  if (!extracted.ok) {
    await failAfterUnknownWrite(adminClient, operationId, extracted.reason);
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

async function failAfterUnknownWrite(
  adminClient: SupabaseClient,
  operationId: string,
  category: string,
): Promise<void> {
  await adminClient.rpc("fail_billing_outbound_operation_after_unknown_write", {
    p_operation_id: operationId,
    p_error_category: category,
  });
}

async function failOperation(adminClient: SupabaseClient, operationId: string, category: string): Promise<void> {
  await adminClient.rpc("fail_billing_outbound_operation", {
    p_operation_id: operationId,
    p_error_category: category,
  });
}
