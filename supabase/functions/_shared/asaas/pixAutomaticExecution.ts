// WP-ASAAS-05E0D — ponte de execução: operação outbound já preparada → adapter 05E0B.
// Sem segundo HTTP client / ledger / retry / webhook. Sem payload de browser.
// Ambiente e preço vêm só de fatos confiáveis (DB/loader). Sem HTTP real nos testes.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  asaasBaseUrl,
  asaasFetch,
  readAsaasCredentials,
  resolveOutboundEnvironment,
  type AsaasCredentials,
  type AsaasEnvironment,
} from "./client.ts";
import { PIX_AUTOMATIC_AUTHORIZATIONS_PATH } from "./pixAutomatic.ts";
import {
  QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE,
  type PixAutomaticTransientQr,
} from "./pixAutomatic.ts";
import {
  ensurePixAutomaticAuthorization,
  type EnsurePixAutomaticAuthorizationInput,
  type EnsurePixAutomaticAuthorizationResult,
} from "./pixAutomaticAuthorization.ts";

export const EXECUTE_PIX_AUTOMATIC_ACTION = "execute_pix_automatic_authorization";
export const PROBE_PIX_AUTOMATIC_READ_ACTION = "probe_pix_automatic_read";
export const LOAD_PREPARED_PIX_AUTOMATIC_RPC = "load_prepared_pix_automatic_authorization";
export const PIX_AUTOMATIC_OPERATION_TYPE = "create_pix_automatic_authorization";

export const CRON_DOES_NOT_INVOKE_OUTBOUND = true;
export const PREPARE_DOES_NOT_EXECUTE_PROVIDER = true;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FORBIDDEN_EXECUTION_BODY_KEYS = [
  "customerId",
  "contractId",
  "amount",
  "value",
  "valueCents",
  "contracted_price_cents",
  "startDate",
  "frequency",
  "retryPolicy",
  "paymentCreationMode",
  "environment",
  "providerAuthorizationId",
  "external_customer_id",
  "externalCustomerId",
  "apiKey",
  "access_token",
] as const;

export type PreparedPixAutomaticFacts = {
  operationId: string;
  operationType: string;
  operationStatus: string;
  provider: string;
  environment: AsaasEnvironment;
  billingAccountId: string;
  commercialContractId: string;
  externalCustomerId: string | null;
  contractedPriceCents: number;
  recurrenceStartDate: string;
  actionable: boolean;
  loadState?: string;
  lastErrorCategory?: string | null;
  contractedCurrency?: string;
  authorizationId?: string;
  authorizationProviderStatus?: string;
  providerContractId?: string;
  generation?: number;
  idempotencyKey?: string;
  externalReference?: string;
};

/** Shape canônico do RPC 05E0D1. Chaves snake_case — autoridade SQL, não o mock TS. */
export const SQL_LOADER_SUCCESS_KEYS = [
  "found",
  "error",
  "operation_id",
  "operation_type",
  "operation_status",
  "last_error_category",
  "load_state",
  "actionable",
  "provider",
  "environment",
  "billing_account_id",
  "commercial_contract_id",
  "external_customer_id",
  "contracted_price_cents",
  "contracted_currency",
  "recurrence_start_date",
  "authorization_id",
  "authorization_provider_status",
  "provider_contract_id",
  "generation",
  "idempotency_key",
  "external_reference",
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ExecutePixAutomaticSuccessBody = {
  executed: true;
  operationId: string;
  providerAuthorizationId?: string;
  providerStatus?: string;
} & (
  | { qrAvailable: true; immediateQrCode: PixAutomaticTransientQr }
  | { qrAvailable: false; qrUnavailableReason: string }
);

export type ExecutionBridgeResult =
  | { ok: true; status: number; body: ExecutePixAutomaticSuccessBody }
  | { ok: false; status: number; body: { error: string } };

export function toExecuteSuccessBody(
  operationId: string,
  result: EnsurePixAutomaticAuthorizationResult,
): ExecutePixAutomaticSuccessBody {
  const ids = {
    executed: true as const,
    operationId,
    ...(result.providerAuthorizationId ? { providerAuthorizationId: result.providerAuthorizationId } : {}),
    ...(result.providerStatus ? { providerStatus: result.providerStatus } : {}),
  };
  if (result.qrAvailable === true && result.immediateQrCode) {
    return { ...ids, qrAvailable: true, immediateQrCode: result.immediateQrCode };
  }
  return {
    ...ids,
    qrAvailable: false,
    qrUnavailableReason: result.qrUnavailableReason ?? QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasForbiddenProviderPayload(body: unknown): boolean {
  const rec = asRecord(body);
  if (!rec) return false;
  return FORBIDDEN_EXECUTION_BODY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(rec, key));
}

export function parseExecutePixAutomaticRequest(
  body: unknown,
): { ok: true; operationId: string } | { ok: false; error: string } {
  const rec = asRecord(body);
  if (!rec) return { ok: false, error: "invalid_json" };
  if (rec.action !== EXECUTE_PIX_AUTOMATIC_ACTION) return { ok: false, error: "invalid_action" };
  if (hasForbiddenProviderPayload(rec)) return { ok: false, error: "provider_payload_forbidden" };
  const operationId = asTrimmedString(rec.operationId);
  if (!operationId || !UUID_RE.test(operationId)) return { ok: false, error: "operation_id_required" };
  return { ok: true, operationId };
}

export function assertExecutionEnvironment(
  configuredRaw: string | undefined,
  operationEnv: string,
): { ok: true; environment: AsaasEnvironment } | { ok: false; error: string } {
  const configured = resolveOutboundEnvironment(configuredRaw);
  if (!configured) return { ok: false, error: "asaas_outbound_not_configured" };
  if (operationEnv !== "sandbox" && operationEnv !== "production") {
    return { ok: false, error: "invalid_operation_environment" };
  }
  if (operationEnv !== configured) return { ok: false, error: "environment_mismatch" };
  return { ok: true, environment: configured };
}

export function credentialsForEnvironment(environment: AsaasEnvironment): AsaasCredentials {
  return readAsaasCredentials(environment);
}

export function expectedProviderBaseUrl(environment: AsaasEnvironment): string {
  return asaasBaseUrl(environment);
}

export function toEnsureIntent(facts: PreparedPixAutomaticFacts): EnsurePixAutomaticAuthorizationInput {
  return {
    billingAccountId: facts.billingAccountId,
    commercialContractId: facts.commercialContractId,
    authorizationId: facts.authorizationId ?? "",
    providerContractId: facts.providerContractId ?? "",
    idempotencyKey: facts.idempotencyKey ?? "",
    externalReference: facts.externalReference ?? "",
    externalCustomerId: facts.externalCustomerId,
    contractedPriceCents: facts.contractedPriceCents,
    startDate: facts.recurrenceStartDate,
  };
}

function asUuid(value: unknown): string | null {
  const text = asTrimmedString(value);
  return text && UUID_SHAPE_RE.test(text) ? text : null;
}

export function parsePreparedFacts(raw: unknown): PreparedPixAutomaticFacts | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  if (rec.found === false) return null;
  const environment = asTrimmedString(rec.environment);
  if (environment !== "sandbox" && environment !== "production") return null;
  const operationId = asUuid(rec.operation_id) ?? asUuid(rec.operationId);
  const billingAccountId = asUuid(rec.billing_account_id) ?? asUuid(rec.billingAccountId);
  const commercialContractId = asUuid(rec.commercial_contract_id) ?? asUuid(rec.commercialContractId);
  const operationType = asTrimmedString(rec.operation_type) ?? asTrimmedString(rec.operationType);
  const operationStatus = asTrimmedString(rec.operation_status) ?? asTrimmedString(rec.operationStatus);
  const provider = asTrimmedString(rec.provider);
  const startDate = asTrimmedString(rec.recurrence_start_date) ?? asTrimmedString(rec.recurrenceStartDate);
  const priceRaw = rec.contracted_price_cents ?? rec.contractedPriceCents;
  if (
    !operationId ||
    !billingAccountId ||
    !commercialContractId ||
    !operationType ||
    !operationStatus ||
    !provider ||
    !startDate ||
    !ISO_DATE_RE.test(startDate) ||
    typeof priceRaw !== "number" ||
    !Number.isInteger(priceRaw) ||
    priceRaw < 0
  ) {
    return null;
  }
  const customer =
    asTrimmedString(rec.external_customer_id) ?? asTrimmedString(rec.externalCustomerId);
  const loadState = asTrimmedString(rec.load_state) ?? asTrimmedString(rec.loadState);
  const currency =
    asTrimmedString(rec.contracted_currency) ?? asTrimmedString(rec.contractedCurrency);
  if (currency && currency !== "BRL") return null;
  return {
    operationId,
    operationType,
    operationStatus,
    provider,
    environment,
    billingAccountId,
    commercialContractId,
    externalCustomerId: customer,
    contractedPriceCents: priceRaw,
    recurrenceStartDate: startDate,
    actionable:
      rec.actionable === false
        ? false
        : rec.actionable === true ||
          ["pending", "failed", "claimed", "retryable", "completed"].includes(operationStatus),
    loadState: loadState ?? undefined,
    lastErrorCategory:
      rec.last_error_category === null || rec.lastErrorCategory === null
        ? null
        : (asTrimmedString(rec.last_error_category) ?? asTrimmedString(rec.lastErrorCategory)),
    contractedCurrency: currency ?? undefined,
    authorizationId: asUuid(rec.authorization_id) ?? asUuid(rec.authorizationId) ?? undefined,
    authorizationProviderStatus:
      asTrimmedString(rec.authorization_provider_status) ??
      asTrimmedString(rec.authorizationProviderStatus) ??
      undefined,
    providerContractId:
      asTrimmedString(rec.provider_contract_id) ?? asTrimmedString(rec.providerContractId) ?? undefined,
    generation: typeof rec.generation === "number" && Number.isInteger(rec.generation)
      ? rec.generation
      : undefined,
    idempotencyKey: asTrimmedString(rec.idempotency_key) ?? asTrimmedString(rec.idempotencyKey) ?? undefined,
    externalReference:
      asTrimmedString(rec.external_reference) ?? asTrimmedString(rec.externalReference) ?? undefined,
  };
}

export function authorizePreparedFacts(
  facts: PreparedPixAutomaticFacts,
  configuredEnv: AsaasEnvironment,
): { ok: true } | { ok: false; error: string } {
  if (facts.provider !== "asaas") return { ok: false, error: "operation_provider_mismatch" };
  if (facts.operationType !== PIX_AUTOMATIC_OPERATION_TYPE) {
    return { ok: false, error: "operation_type_mismatch" };
  }
  if (facts.environment !== configuredEnv) return { ok: false, error: "environment_mismatch" };
  if (!facts.actionable && facts.operationStatus !== "completed") {
    return { ok: false, error: "operation_not_actionable" };
  }
  return { ok: true };
}

export function mapEnsureError(errorCode: string | undefined): { status: number; error: string } {
  switch (errorCode) {
    case "customer_not_provisioned":
      return { status: 409, error: "customer_not_provisioned" };
    case "provider_rejected":
      return { status: 502, error: "provider_rejected" };
    case "BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION":
    case "outcome_unknown_requires_reconciliation":
    case "reconciliation_lookup_failed":
    case "reconciliation_ambiguous_multiple":
      return { status: 409, error: errorCode };
    case "authorization_correlation_missing":
      return { status: 409, error: "authorization_correlation_missing" };
    case "reserve_failed":
    case "complete_failed":
    case "invalid_create_payload":
    case "external_id_conflict":
      return { status: 502, error: errorCode ?? "provider_error" };
    default:
      return { status: 502, error: errorCode || "provider_error" };
  }
}

export async function loadPreparedPixAutomaticAuthorization(
  adminClient: SupabaseClient,
  operationId: string,
): Promise<{ ok: true; facts: PreparedPixAutomaticFacts } | { ok: false; error: string }> {
  const { data, error } = await adminClient.rpc(LOAD_PREPARED_PIX_AUTOMATIC_RPC, {
    p_operation_id: operationId,
  });
  if (error || !data) return { ok: false, error: "operation_not_found" };
  const rec = asRecord(data);
  if (rec?.found === false) {
    return { ok: false, error: asTrimmedString(rec.error) ?? "operation_not_found" };
  }
  const facts = parsePreparedFacts(data);
  if (!facts) return { ok: false, error: "operation_facts_invalid" };
  if (facts.operationId !== operationId) return { ok: false, error: "operation_id_mismatch" };
  return { ok: true, facts };
}

export async function executePreparedPixAutomaticAuthorization(params: {
  adminClient: SupabaseClient;
  configuredEnvironmentRaw: string | undefined;
  operationId: string;
  creds?: AsaasCredentials;
}): Promise<ExecutionBridgeResult> {
  const loaded = await loadPreparedPixAutomaticAuthorization(params.adminClient, params.operationId);
  if (!loaded.ok) {
    const status = loaded.error === "operation_not_found" ? 404 : 409;
    return { ok: false, status, body: { error: loaded.error } };
  }

  const envGate = assertExecutionEnvironment(params.configuredEnvironmentRaw, loaded.facts.environment);
  if (!envGate.ok) return { ok: false, status: 409, body: { error: envGate.error } };

  const authorized = authorizePreparedFacts(loaded.facts, envGate.environment);
  if (!authorized.ok) return { ok: false, status: 409, body: { error: authorized.error } };

  if (!loaded.facts.externalCustomerId) {
    return { ok: false, status: 409, body: { error: "customer_not_provisioned" } };
  }

  let creds: AsaasCredentials;
  try {
    creds = params.creds ?? credentialsForEnvironment(envGate.environment);
  } catch {
    return { ok: false, status: 503, body: { error: "asaas_not_configured" } };
  }

  const result = await ensurePixAutomaticAuthorization({
    adminClient: params.adminClient,
    environment: envGate.environment,
    creds,
    intent: toEnsureIntent(loaded.facts),
  });

  if (!result.ok) {
    const mapped = mapEnsureError(result.errorCode);
    return { ok: false, status: mapped.status, body: { error: mapped.error } };
  }

  return {
    ok: true,
    status: 200,
    body: toExecuteSuccessBody(loaded.facts.operationId, result),
  };
}

export type PixAutomaticReadProbeResult =
  | { ok: true; status: number; body: { reachable: true; empty: boolean; httpStatus: number } }
  | { ok: false; status: number; body: { error: string } };

/** GET /pix/automatic/authorizations?limit=1. Sem reserva, sem PII, sem proxy genérico. */
export async function probePixAutomaticRead(params: {
  configuredEnvironmentRaw: string | undefined;
  creds?: AsaasCredentials;
}): Promise<PixAutomaticReadProbeResult> {
  const environment = resolveOutboundEnvironment(params.configuredEnvironmentRaw);
  if (!environment) return { ok: false, status: 503, body: { error: "asaas_outbound_not_configured" } };

  let creds: AsaasCredentials;
  try {
    creds = params.creds ?? credentialsForEnvironment(environment);
  } catch {
    return { ok: false, status: 503, body: { error: "asaas_not_configured" } };
  }

  const res = await asaasFetch<{ object?: string; totalCount?: number; data?: unknown[] }>(
    creds,
    environment,
    "GET",
    `${PIX_AUTOMATIC_AUTHORIZATIONS_PATH}?limit=1`,
  );

  if (res.outcome === "success") {
    const empty =
      (typeof res.data?.totalCount === "number" && res.data.totalCount === 0) ||
      (Array.isArray(res.data?.data) && res.data.data.length === 0);
    return {
      ok: true,
      status: 200,
      body: { reachable: true, empty, httpStatus: res.status },
    };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 502, body: { error: "provider_auth_error" } };
  }
  if (res.status === 429) {
    return { ok: false, status: 502, body: { error: "rate_limited" } };
  }
  return { ok: false, status: 502, body: { error: "provider_read_failed" } };
}
