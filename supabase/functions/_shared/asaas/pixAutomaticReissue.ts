// WP-ASAAS-05G1 — PA-gated local REISSUE. Zero Asaas HTTP. Zero QR.
// Edge verifies am_i_platform_admin, then calls the public wrapper with the user JWT.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const REISSUE_PIX_AUTOMATIC_ACTION = "reissue_pix_automatic_authorization";
export const REISSUE_PIX_AUTOMATIC_RPC = "reissue_pix_automatic_authorization";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FORBIDDEN_REISSUE_BODY_KEYS = [
  "environment",
  "generation",
  "providerCustomerId",
  "providerAuthorizationId",
  "providerContractId",
  "status",
  "isPrimary",
  "amount",
  "value",
  "valueCents",
  "apiKey",
  "access_token",
  "operationId",
  "paymentId",
  "qr",
  "pixPayload",
  "payload",
  "encodedImage",
  "immediateQrCode",
] as const;

export type ReissuePixAutomaticSuccessBody = {
  outcome: "reissued" | "already_reissued";
  oldAuthorizationId: string;
  newAuthorizationId: string;
  oldGeneration: number;
  newGeneration: number;
  newStatus: string;
  operationId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asUuid(value: unknown): string | null {
  const text = asTrimmedString(value);
  return text && UUID_RE.test(text) ? text : null;
}

export function hasForbiddenReissueKeys(body: unknown): boolean {
  const rec = asRecord(body);
  if (!rec) return false;
  return FORBIDDEN_REISSUE_BODY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(rec, key));
}

export function parseReissuePixAutomaticRequest(
  body: unknown,
):
  | {
      ok: true;
      clinicId: string;
      commercialContractId: string;
      authorizationId: string;
      reason: string | null;
    }
  | { ok: false; error: string } {
  const rec = asRecord(body);
  if (!rec) return { ok: false, error: "invalid_json" };
  if (rec.action !== REISSUE_PIX_AUTOMATIC_ACTION) return { ok: false, error: "invalid_action" };
  if (hasForbiddenReissueKeys(rec)) return { ok: false, error: "provider_payload_forbidden" };
  const clinicId = asUuid(rec.clinicId);
  const commercialContractId = asUuid(rec.commercialContractId);
  const authorizationId = asUuid(rec.authorizationId);
  if (!clinicId || !commercialContractId || !authorizationId) {
    return { ok: false, error: "reissue_ids_required" };
  }
  const reasonRaw = rec.reason;
  if (reasonRaw != null && typeof reasonRaw !== "string") {
    return { ok: false, error: "invalid_reason" };
  }
  const reason = asTrimmedString(reasonRaw);
  return {
    ok: true,
    clinicId,
    commercialContractId,
    authorizationId,
    reason: reason && reason.length > 500 ? reason.slice(0, 500) : reason,
  };
}

export function sanitizeReissueResponse(raw: unknown): ReissuePixAutomaticSuccessBody | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const outcome = asTrimmedString(rec.outcome);
  if (outcome !== "reissued" && outcome !== "already_reissued") return null;
  const oldAuthorizationId = asUuid(rec.old_authorization_id) ?? asUuid(rec.oldAuthorizationId);
  const newAuthorizationId = asUuid(rec.new_authorization_id) ?? asUuid(rec.newAuthorizationId);
  const oldGeneration = rec.old_generation ?? rec.oldGeneration;
  const newGeneration = rec.new_generation ?? rec.newGeneration;
  const newStatus = asTrimmedString(rec.new_status) ?? asTrimmedString(rec.newStatus);
  const operationId = asUuid(rec.operation_id) ?? asUuid(rec.operationId);
  if (
    !oldAuthorizationId ||
    !newAuthorizationId ||
    typeof oldGeneration !== "number" ||
    !Number.isInteger(oldGeneration) ||
    typeof newGeneration !== "number" ||
    !Number.isInteger(newGeneration) ||
    !newStatus
  ) {
    return null;
  }
  return {
    outcome,
    oldAuthorizationId,
    newAuthorizationId,
    oldGeneration,
    newGeneration,
    newStatus,
    operationId,
  };
}

export function mapReissueRpcError(error: {
  hint?: string | null;
  message?: string | null;
  code?: string | null;
}): { status: number; error: string } {
  const hint = (error.hint ?? "").trim();
  switch (hint) {
    case "NOT_PLATFORM_ADMIN":
      return { status: 403, error: "forbidden" };
    case "REISSUE_IDS_REQUIRED":
      return { status: 400, error: "reissue_ids_required" };
    case "BILLING_REISSUE_NOT_REFUSED":
      return { status: 409, error: "authorization_not_refused" };
    case "BILLING_REISSUE_STATUS_UNSUPPORTED":
      return { status: 409, error: "authorization_status_unsupported" };
    case "BILLING_REISSUE_NOT_PRIMARY":
      return { status: 409, error: "authorization_not_primary" };
    case "BILLING_CLINIC_MISMATCH":
    case "BILLING_CONTRACT_MISMATCH":
      return { status: 409, error: "resource_mismatch" };
    case "BILLING_ENVIRONMENT_MISMATCH":
      return { status: 409, error: "environment_mismatch" };
    case "BILLING_REISSUE_PRIMARY_RACE":
      return { status: 409, error: "reissue_conflict" };
    case "BILLING_ACCOUNT_UNKNOWN":
    case "BILLING_CONTRACT_UNKNOWN":
    case "BILLING_AUTHORIZATION_UNKNOWN":
    case "BILLING_REISSUE_NO_PRIMARY":
      return { status: 404, error: "not_found" };
    default:
      if (error.code === "42501") return { status: 403, error: "forbidden" };
      return { status: 400, error: "reissue_failed" };
  }
}

export async function invokeReissuePixAutomaticAuthorization(
  userClient: SupabaseClient,
  parsed: {
    clinicId: string;
    commercialContractId: string;
    authorizationId: string;
    reason: string | null;
  },
): Promise<
  | { ok: true; status: 200; body: ReissuePixAutomaticSuccessBody }
  | { ok: false; status: number; body: { error: string } }
> {
  const { data, error } = await userClient.rpc(REISSUE_PIX_AUTOMATIC_RPC, {
    p_clinic_id: parsed.clinicId,
    p_commercial_contract_id: parsed.commercialContractId,
    p_authorization_id: parsed.authorizationId,
    p_reason: parsed.reason,
  });
  if (error) {
    const mapped = mapReissueRpcError(error);
    return { ok: false, status: mapped.status, body: { error: mapped.error } };
  }
  const body = sanitizeReissueResponse(data);
  if (!body) return { ok: false, status: 502, body: { error: "reissue_response_invalid" } };
  return { ok: true, status: 200, body };
}
