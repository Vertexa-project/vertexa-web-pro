// WP-BILLING-PRODUCT-03 — action-level authority for asaas-outbound.
// Never replace the Edge gate with generic "authenticated".

export const ACTION_AUTHORITY = {
  ensure_customer: "PA_ONLY",
  ensure_customer_from_identity: "CLINIC_ADMIN_OWN_CLINIC",
  ensure_subscription: "PA_ONLY",
  list_subscription_payments: "PA_ONLY",
  confirm_sandbox_payment: "PA_ONLY",
  check_webhook_receipt: "PA_ONLY",
  execute_pix_automatic_authorization: "PA_OR_CLINIC_OWN_OPERATION",
  probe_pix_automatic_read: "PA_ONLY",
  reissue_pix_automatic_authorization: "PA_ONLY",
  create_hosted_card_checkout: "CLINIC_ADMIN_OWN_CLINIC",
} as const;

export type OutboundAction = keyof typeof ACTION_AUTHORITY;
export type ActionAuthority = (typeof ACTION_AUTHORITY)[OutboundAction];

export const ENSURE_CUSTOMER_FROM_IDENTITY_ACTION = "ensure_customer_from_identity";
export const CREATE_HOSTED_CARD_CHECKOUT_ACTION = "create_hosted_card_checkout";

export const PRODUCT_PATH_FORBIDDEN_KEYS = [
  "name",
  "legalName",
  "cpfCnpj",
  "taxId",
  "email",
  "phone",
  "mobilePhone",
  "customerId",
  "externalCustomerId",
  "external_customer_id",
  "environment",
  "amount",
  "value",
  "valueCents",
  "frequency",
  "retryPolicy",
  "paymentCreationMode",
  "minutesToExpire",
  "billingTypes",
  "chargeTypes",
  "subscription",
  "successUrl",
  "cancelUrl",
  "expiredUrl",
  "externalReference",
  "contractId",
  "providerAuthorizationId",
  "apiKey",
  "access_token",
  "fixture",
  "CUSTOMER_FIXTURE",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isOutboundAction(action: string): action is OutboundAction {
  return Object.prototype.hasOwnProperty.call(ACTION_AUTHORITY, action);
}

export function authorityForAction(action: string): ActionAuthority | null {
  if (!isOutboundAction(action)) return null;
  return ACTION_AUTHORITY[action];
}

export function hasForbiddenProductKeys(body: unknown): boolean {
  const rec = asRecord(body);
  if (!rec) return false;
  return PRODUCT_PATH_FORBIDDEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(rec, key));
}

export function parseEnsureCustomerFromIdentityRequest(
  body: unknown,
): { ok: true; clinicId: string } | { ok: false; error: string } {
  const rec = asRecord(body);
  if (!rec) return { ok: false, error: "invalid_json" };
  if (rec.action !== ENSURE_CUSTOMER_FROM_IDENTITY_ACTION) {
    return { ok: false, error: "invalid_action" };
  }
  if (hasForbiddenProductKeys(rec)) return { ok: false, error: "provider_payload_forbidden" };
  const clinicId = typeof rec.clinicId === "string" ? rec.clinicId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
    return { ok: false, error: "clinic_id_required" };
  }
  return { ok: true, clinicId };
}

export function parseCreateHostedCardCheckoutRequest(
  body: unknown,
): { ok: true; clinicId: string } | { ok: false; error: string } {
  const rec = asRecord(body);
  if (!rec || rec.action !== CREATE_HOSTED_CARD_CHECKOUT_ACTION) return { ok: false, error: "invalid_action" };
  if (hasForbiddenProductKeys(rec)) return { ok: false, error: "provider_payload_forbidden" };
  const clinicId = typeof rec.clinicId === "string" ? rec.clinicId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
    return { ok: false, error: "clinic_id_required" };
  }
  return { ok: true, clinicId };
}

export function sanitizeClinicCustomerResponse(): { customerBound: true } {
  return { customerBound: true };
}

export function sanitizeClinicExecuteResponse(body: Record<string, unknown>): Record<string, unknown> {
  const qr = body.immediateQrCode;
  const qrRec = qr && typeof qr === "object" && !Array.isArray(qr) ? (qr as Record<string, unknown>) : null;
  return {
    executed: body.executed === true,
    authorizationStatus: typeof body.providerStatus === "string" ? body.providerStatus : null,
    qrAvailable: body.qrAvailable === true,
    ...(body.qrAvailable === true && qrRec
      ? {
          immediateQrCode: {
            payload: typeof qrRec.payload === "string" ? qrRec.payload : "",
            expirationDate: typeof qrRec.expirationDate === "string" ? qrRec.expirationDate : null,
            ...(typeof qrRec.encodedImage === "string" ? { encodedImage: qrRec.encodedImage } : {}),
          },
        }
      : { qrUnavailableReason: body.qrUnavailableReason ?? "provider_create_response_not_available" }),
  };
}
