// WP-BILLING-PRODUCT-03 — inspect provider objects without exposing QR contents.

export type QrRecoveryDecision = "SUPPORTED_RECOVERY" | "NO_SUPPORTED_QR_RECOVERY";

export interface AuthorizationFieldPresence {
  topLevelKeys: string[];
  hasAuthorizationId: boolean;
  hasPayload: boolean;
  hasEncodedImage: boolean;
  hasImmediateQrCode: boolean;
  immediateQrCodeKeys: string[];
  hasConciliationIdentifier: boolean;
  hasExpirationDate: boolean;
  hasPaymentId: boolean;
  hasSubscriptionId: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function presentString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function inspectAuthorizationFieldPresence(obj: unknown): AuthorizationFieldPresence {
  const rec = asRecord(obj);
  const qr = rec ? asRecord(rec.immediateQrCode) : null;
  return {
    topLevelKeys: rec ? Object.keys(rec).sort() : [],
    hasAuthorizationId: presentString(rec?.id),
    hasPayload: presentString(rec?.payload),
    hasEncodedImage: presentString(rec?.encodedImage),
    hasImmediateQrCode: qr !== null,
    immediateQrCodeKeys: qr ? Object.keys(qr).sort() : [],
    hasConciliationIdentifier: presentString(qr?.conciliationIdentifier) || presentString(rec?.conciliationIdentifier),
    hasExpirationDate: presentString(qr?.expirationDate) || presentString(rec?.expirationDate),
    hasPaymentId: presentString(rec?.paymentId) || presentString(rec?.payment),
    hasSubscriptionId: presentString(rec?.subscriptionId) || presentString(rec?.subscription),
  };
}

export function decideQrRecovery(input: {
  createHasPayload: boolean;
  getHasPayload: boolean;
  getHasEncodedImage: boolean;
  paymentQrPathSupported: boolean;
}): QrRecoveryDecision {
  if (input.getHasPayload || input.getHasEncodedImage || input.paymentQrPathSupported) {
    return "SUPPORTED_RECOVERY";
  }
  if (input.createHasPayload) return "NO_SUPPORTED_QR_RECOVERY";
  return "NO_SUPPORTED_QR_RECOVERY";
}

// Official GET DTO lists payload/encodedImage with example null.
// Live sandbox CREATE+GET was not executed in this WP (keys stay on Edge).
// Product fail-safe: do not treat GET as a recoverable QR source.
export const CHECKOUT_QR_RECOVERY: QrRecoveryDecision = "NO_SUPPORTED_QR_RECOVERY";

export const QR_RELOAD_COPY = {
  title: "Autorização criada / aguardando conclusão",
  body:
    "O QR Code desta tentativa só fica disponível nesta tela. Depois de recarregar, não geramos outro QR e não criamos outra autorização. Conclua no aplicativo do banco se ainda estiver aberta, ou aguarde esta tentativa terminar para começar outra.",
} as const;
