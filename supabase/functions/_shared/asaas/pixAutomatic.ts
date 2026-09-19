// Fundação Pix Automático — política + adapter HTTP no cliente Asaas existente.
// NÃO envia billingType=PIX. NÃO persiste payload/encodedImage. NÃO é entitlement.

import { asaasFetch, hasStringId, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import { ASAAS_PROVIDER_TIMEZONE, parseAsaasDateTime } from "./datetime.js";
import { centsToAsaasAmount, parseAsaasAmountToCents } from "./money.ts";

export { parseAsaasDateTime } from "./datetime.js";

export const PIX_AUTOMATIC_POLICY = {
  frequency: "MONTHLY",
  paymentCreationMode: "SUBSCRIPTION",
  retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
  finishDate: null,
  timezone: ASAAS_PROVIDER_TIMEZONE,
  description: "Vertexa - assinatura mensal",
  immediateQrExpirationSeconds: 3600,
} as const;

export const ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED =
  "ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED";

export const PIX_AUTOMATIC_AUTHORIZATIONS_PATH = "/pix/automatic/authorizations";
export const PIX_AUTOMATIC_PAYMENT_INSTRUCTIONS_PATH = "/pix/automatic/paymentInstructions";
export const PIX_TRANSACTIONS_PATH = "/pix/transactions";

const PROVIDER_AUTH_STATUSES = new Set(["CREATED", "ACTIVE", "CANCELLED", "EXPIRED", "REFUSED"]);
const INSTRUCTION_STATUSES = new Set(["AWAITING_REQUEST", "SCHEDULED", "REFUSED", "CANCELLED", "DONE"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function pixAutomaticProviderContractId(commercialContractId: string): string {
  const compact = commercialContractId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("invalid_commercial_contract_id");
  }
  return compact;
}

export interface CreatePixAutomaticAuthorizationInput {
  customerId: string;
  contractId: string;
  startDate: string;
  valueCents: number;
  description?: string;
}

export interface PixAutomaticAuthorizationCreatePayload {
  frequency: "MONTHLY";
  contractId: string;
  startDate: string;
  customerId: string;
  value: number;
  description: string;
  paymentCreationMode: "SUBSCRIPTION";
  retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS";
  immediateQrCode: {
    expirationSeconds: number;
    originalValue: number;
  };
}

/**
 * Payload server-authoritative. Sem finishDate (MVP indefinido). Sem pixKey inventado.
 *
 * OpenAPI oficial (docs.asaas.com, schema
 * PixReceiverAutomaticRecurringAuthorizationImmediateQrCodeRequestDTO):
 * required = expirationSeconds, originalValue.
 * opcional = pixKey, description.
 * minLimitValue é campo TOP-LEVEL da autorização e é proibido quando `value` já está preenchido.
 */
export function buildCreatePixAutomaticAuthorizationPayload(
  input: CreatePixAutomaticAuthorizationInput,
): PixAutomaticAuthorizationCreatePayload {
  const customerId = input.customerId.trim();
  const contractId = input.contractId.trim().toLowerCase();
  const startDate = input.startDate.trim();
  const description = (input.description ?? PIX_AUTOMATIC_POLICY.description).trim();

  if (!customerId) throw new Error("customer_id_required");
  if (!/^[0-9a-f]{32}$/.test(contractId)) throw new Error("invalid_provider_contract_id");
  if (!ISO_DATE_RE.test(startDate)) throw new Error("invalid_start_date");
  if (description.length === 0 || description.length > 35) throw new Error("invalid_description");

  const value = centsToAsaasAmount(input.valueCents);
  return {
    frequency: PIX_AUTOMATIC_POLICY.frequency,
    contractId,
    startDate,
    customerId,
    value,
    description,
    paymentCreationMode: PIX_AUTOMATIC_POLICY.paymentCreationMode,
    retryPolicy: PIX_AUTOMATIC_POLICY.retryPolicy,
    immediateQrCode: {
      expirationSeconds: PIX_AUTOMATIC_POLICY.immediateQrExpirationSeconds,
      originalValue: value,
    },
  };
}

export interface PixAutomaticAuthorizationFacts {
  providerAuthorizationId: string;
  providerStatus: "CREATED" | "ACTIVE" | "CANCELLED" | "EXPIRED" | "REFUSED";
  providerCustomerId: string;
  providerContractId: string | null;
  valueCents: number | null;
  conciliationIdentifier: string | null;
  qrExpiresAt: string | null;
}

/**
 * OpenAPI oficial (docs.asaas.com, POST /v3/pix/automatic/authorizations 200 →
 * PixReceiverAutomaticRecurringAuthorizationGetResponseDTO):
 *   payload       = top-level "QR Code payload" (copia-e-cola)
 *   encodedImage  = top-level base64 (não usado neste handoff)
 *   immediateQrCode.expirationDate = naive Asaas datetime (America/Sao_Paulo)
 *     → parseAsaasDateTime (canonical, runtime-TZ independent)
 *   immediateQrCode.conciliationIdentifier = só persistência
 *
 * Guia oficial (docs.asaas.com/docs/pix-automatico-implementacao):
 * o `payload` deve ser apresentado ao pagador. Não persistir.
 */
export interface PixAutomaticTransientQr {
  payload: string;
  expirationDate: string | null;
}

export const QR_UNAVAILABLE_ALREADY_COMPLETED = "already_completed";
export const QR_UNAVAILABLE_CREATE_RESPONSE_NOT_AVAILABLE = "provider_create_response_not_available";
export const QR_UNAVAILABLE_PAYLOAD_MISSING = "provider_qr_payload_missing";

export type PixAutomaticQrHandoffKind =
  | "fresh_create_with_qr"
  | "fresh_create_qr_unavailable"
  | "reconciled_existing_without_qr"
  | "already_completed_without_qr";

export interface PixAutomaticInstructionFacts {
  providerInstructionId: string;
  status: "AWAITING_REQUEST" | "SCHEDULED" | "REFUSED" | "CANCELLED" | "DONE";
  providerAuthorizationId: string;
  providerPaymentId: string | null;
  dueDate: string | null;
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

function normalizeInstructionStatus(
  raw: unknown,
): PixAutomaticInstructionFacts["status"] | null {
  const status = asTrimmedString(raw);
  if (!status) return null;
  if (status === "CREATED") return "AWAITING_REQUEST";
  if (INSTRUCTION_STATUSES.has(status)) {
    return status as PixAutomaticInstructionFacts["status"];
  }
  return null;
}

/**
 * Extrai fatos persistíveis. Campos extras do provider são ignorados.
 * Nunca devolve payload / encodedImage / pixKey / PII.
 */
export function extractAuthorizationFacts(
  obj: unknown,
  expected: { customerId: string; contractId?: string },
): { ok: true; facts: PixAutomaticAuthorizationFacts } | { ok: false; reason: string } {
  const rec = asRecord(obj);
  if (!rec || !hasStringId(rec)) {
    return { ok: false, reason: "invalid_success_shape" };
  }
  const status = asTrimmedString(rec.status);
  if (!status || !PROVIDER_AUTH_STATUSES.has(status)) {
    return { ok: false, reason: "invalid_provider_status" };
  }
  const customerId = asTrimmedString(rec.customerId) ?? asTrimmedString(rec.customer);
  if (!customerId) {
    return { ok: false, reason: "invalid_provider_customer" };
  }
  if (customerId !== expected.customerId) {
    return { ok: false, reason: "reconciliation_customer_mismatch" };
  }
  const contractId = asTrimmedString(rec.contractId);
  if (expected.contractId && contractId && contractId !== expected.contractId) {
    return { ok: false, reason: "reconciliation_contract_id_mismatch" };
  }

  let valueCents: number | null = null;
  if (rec.value !== undefined) {
    valueCents = parseAsaasAmountToCents(rec.value);
    if (valueCents === null) {
      return { ok: false, reason: "invalid_value" };
    }
  }

  const qr = asRecord(rec.immediateQrCode);
  return {
    ok: true,
    facts: {
      providerAuthorizationId: rec.id,
      providerStatus: status as PixAutomaticAuthorizationFacts["providerStatus"],
      providerCustomerId: customerId,
      providerContractId: contractId,
      valueCents,
      conciliationIdentifier: qr ? asTrimmedString(qr.conciliationIdentifier) : null,
      qrExpiresAt: qr ? parseAsaasDateTime(qr.expirationDate) : null,
    },
  };
}

/**
 * Handoff transitório só do POST 200 de create. GET/list NÃO é fonte de QR.
 * Lê `payload` top-level (OpenAPI). Ignora encodedImage.
 */
export function extractTransientImmediateQr(
  obj: unknown,
): { ok: true; qr: PixAutomaticTransientQr } | { ok: false; reason: typeof QR_UNAVAILABLE_PAYLOAD_MISSING } {
  const rec = asRecord(obj);
  const payload = rec ? asTrimmedString(rec.payload) : null;
  if (!payload) {
    return { ok: false, reason: QR_UNAVAILABLE_PAYLOAD_MISSING };
  }
  const qr = rec ? asRecord(rec.immediateQrCode) : null;
  return {
    ok: true,
    qr: {
      payload,
      expirationDate: qr ? parseAsaasDateTime(qr.expirationDate) : null,
    },
  };
}

export function extractInstructionFacts(
  obj: unknown,
): { ok: true; facts: PixAutomaticInstructionFacts } | { ok: false; reason: string } {
  const rec = asRecord(obj);
  if (!rec || !hasStringId(rec)) {
    return { ok: false, reason: "invalid_success_shape" };
  }
  const status = normalizeInstructionStatus(rec.status);
  if (!status) {
    return { ok: false, reason: "invalid_instruction_status" };
  }
  const authorization = asRecord(rec.authorization);
  const authorizationId =
    asTrimmedString(authorization?.id) ?? asTrimmedString(rec.authorizationId);
  if (!authorizationId) {
    return { ok: false, reason: "missing_authorization_id" };
  }
  // OpenAPI GET usa paymentId; webhook renderizado ainda documenta `payment`.
  const paymentId = asTrimmedString(rec.paymentId) ?? asTrimmedString(rec.payment);
  const dueDate = asTrimmedString(rec.dueDate);
  if (dueDate && !ISO_DATE_RE.test(dueDate)) {
    return { ok: false, reason: "invalid_due_date" };
  }
  return {
    ok: true,
    facts: {
      providerInstructionId: rec.id,
      status,
      providerAuthorizationId: authorizationId,
      providerPaymentId: paymentId,
      dueDate,
    },
  };
}

export async function getPixAutomaticAuthorization(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  providerAuthorizationId: string,
) {
  return asaasFetch<unknown>(
    creds,
    environment,
    "GET",
    `${PIX_AUTOMATIC_AUTHORIZATIONS_PATH}/${encodeURIComponent(providerAuthorizationId)}`,
  );
}

export async function getPixAutomaticPaymentInstruction(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  providerInstructionId: string,
) {
  return asaasFetch<unknown>(
    creds,
    environment,
    "GET",
    `${PIX_AUTOMATIC_PAYMENT_INSTRUCTIONS_PATH}/${encodeURIComponent(providerInstructionId)}`,
  );
}

/** GET oficial /v3/pix/transactions/{id}. Sem body. Sem listagem. */
export async function getPixTransaction(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  pixTransactionId: string,
) {
  const trimmed = pixTransactionId.trim();
  return asaasFetch<Record<string, unknown>>(
    creds,
    environment,
    "GET",
    `${PIX_TRANSACTIONS_PATH}/${encodeURIComponent(trimmed)}`,
  );
}

export type FindPaymentInstructionByPaymentIdResult =
  | { outcome: "found"; facts: PixAutomaticInstructionFacts }
  | { outcome: "not_found" }
  | { outcome: "ambiguous" }
  | { outcome: "lookup_failed"; category: string };

/**
 * Listagem oficial GET /pix/automatic/paymentInstructions?paymentId=.
 * Correlação determinística do ciclo futuro quando o webhook da instrução atrasou.
 */
export async function findPaymentInstructionByPaymentId(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  paymentId: string,
): Promise<FindPaymentInstructionByPaymentIdResult> {
  const trimmed = paymentId.trim();
  if (!trimmed) return { outcome: "lookup_failed", category: "missing_payment_id" };

  const path =
    `${PIX_AUTOMATIC_PAYMENT_INSTRUCTIONS_PATH}` +
    `?paymentId=${encodeURIComponent(trimmed)}` +
    `&limit=2&offset=0`;
  const lookup = await asaasFetch<AsaasList>(creds, environment, "GET", path);
  if (lookup.outcome !== "success") {
    return { outcome: "lookup_failed", category: lookup.category };
  }
  const rows = lookup.data?.data ?? [];
  if (rows.length === 0) return { outcome: "not_found" };
  if (rows.length > 1) return { outcome: "ambiguous" };
  const extracted = extractInstructionFacts(rows[0]);
  if (!extracted.ok) {
    return { outcome: "lookup_failed", category: extracted.reason };
  }
  return { outcome: "found", facts: extracted.facts };
}

interface AsaasList {
  data?: unknown[];
  hasMore?: unknown;
}

/**
 * Listagem oficial NÃO filtra por contractId — só customerId/status/offset/limit.
 * Reconciliação: listar por customerId e filtrar contractId no cliente.
 */
export async function findAuthorizationByContractId(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  customerId: string,
  contractId: string,
): Promise<
  | { outcome: "found"; object: unknown }
  | { outcome: "not_found" }
  | { outcome: "ambiguous" }
  | { outcome: "lookup_failed"; category: string }
> {
  const matches: unknown[] = [];
  let offset = 0;
  const limit = 100;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page += 1) {
    const path =
      `${PIX_AUTOMATIC_AUTHORIZATIONS_PATH}` +
      `?customerId=${encodeURIComponent(customerId)}` +
      `&limit=${limit}&offset=${offset}`;
    const lookup = await asaasFetch<AsaasList>(creds, environment, "GET", path);
    if (lookup.outcome !== "success") {
      return { outcome: "lookup_failed", category: lookup.category };
    }
    const rows = lookup.data?.data ?? [];
    for (const row of rows) {
      const rec = asRecord(row);
      if (asTrimmedString(rec?.contractId) === contractId) {
        matches.push(row);
      }
    }
    if (matches.length > 1) {
      return { outcome: "ambiguous" };
    }
    const exhausted = lookup.data?.hasMore !== true || rows.length < limit;
    if (exhausted) {
      if (matches.length === 1) return { outcome: "found", object: matches[0] };
      return { outcome: "not_found" };
    }
    offset += limit;
  }

  if (matches.length === 1) return { outcome: "found", object: matches[0] };
  // Cap local atingido com hasMore ainda verdadeiro: ausência NÃO está provada.
  return { outcome: "lookup_failed", category: "reconciliation_lookup_scan_capped" };
}

export async function createPixAutomaticAuthorization(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  input: CreatePixAutomaticAuthorizationInput,
) {
  const payload = buildCreatePixAutomaticAuthorizationPayload(input);
  return asaasFetch<unknown>(creds, environment, "POST", PIX_AUTOMATIC_AUTHORIZATIONS_PATH, payload);
}
