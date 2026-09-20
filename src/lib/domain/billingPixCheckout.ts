// WP-BILLING-PRODUCT-03 — Clinic Pix checkout projection. Sem I/O.
// QR só existe em memória de sessão. Reload NÃO recupera payload.

import type { ClinicCommercialCheckout, PixAuthorizationStatus, PixNextAction } from "./billingCheckout";

export const PIX_AUTOMATIC_RETRY_POLICY = "ALLOW_THREE_IN_SEVEN_DAYS" as const;
export const PIX_PAYMENT_CREATION_MODE = "SUBSCRIPTION" as const;
export const CHECKOUT_QR_RECOVERY = "NO_SUPPORTED_QR_RECOVERY" as const;

export const PIX_BANK_COPY =
  "Abra o aplicativo do seu banco, escaneie o QR Code ou use o Pix Copia e Cola. Revise o primeiro pagamento e autorize as cobranças recorrentes. A Vertexa não pede senha, token nem dados do seu banco.";

export const PIX_RELOAD_COPY = {
  title: "Autorização criada / aguardando conclusão",
  body:
    "O QR Code desta tentativa só fica disponível nesta tela. Depois de recarregar, não geramos outro QR e não criamos outra autorização. Conclua no aplicativo do banco se ainda estiver aberta, ou aguarde esta tentativa terminar para começar outra.",
} as const;

export const PIX_STATUS_LABEL: Record<PixAuthorizationStatus, string> = {
  INTENT: "pronta para gerar o Pix",
  CREATED: "aguardando autorização no banco",
  ACTIVE: "autorizada",
  REFUSED: "recusada",
  CANCELLED: "encerrada",
  EXPIRED: "expirada",
};

export interface TransientPixQr {
  payload: string;
  expirationDate: string | null;
  encodedImage?: string;
}

export type PixCheckoutSurface =
  | "cta"
  | "confirm"
  | "identity"
  | "qr"
  | "awaiting"
  | "active"
  | "refused"
  | "none";

export function pixProductLabel(status: PixAuthorizationStatus | null | undefined): string {
  if (!status) return "ainda não configurado";
  return PIX_STATUS_LABEL[status] ?? status;
}

export function resolvePixCheckoutSurface(input: {
  checkout: ClinicCommercialCheckout;
  sessionQr: TransientPixQr | null;
  confirming: boolean;
}): PixCheckoutSurface {
  const status = input.checkout.pixAuthorizationStatus;
  const next = input.checkout.pixNextAction;
  if (status === "ACTIVE") return "active";
  if (status === "REFUSED" || next === "reissue") return "refused";
  if (status === "CREATED" && input.sessionQr) return "qr";
  if (status === "CREATED") return "awaiting";
  if (!input.checkout.identityComplete) return "identity";
  if (input.confirming) return "confirm";
  if (next === "none") return "none";
  return "cta";
}

export function assertNoClientPixAuthority(body: Record<string, unknown>): void {
  const forbidden = [
    "amount",
    "value",
    "valueCents",
    "environment",
    "retryPolicy",
    "paymentCreationMode",
    "frequency",
    "customerId",
    "externalCustomerId",
    "contractId",
    "cpfCnpj",
    "name",
    "fixture",
  ];
  for (const key of forbidden) {
    if (key in body) {
      const err = new Error("BILLING_CLIENT_PIX_AUTHORITY_REJECTED");
      (err as { hint?: string }).hint = "BILLING_CLIENT_PIX_AUTHORITY_REJECTED";
      throw err;
    }
  }
}

export function ensureCustomerFromIdentityPayload(clinicId: string): { action: string; clinicId: string } {
  const body = { action: "ensure_customer_from_identity", clinicId };
  assertNoClientPixAuthority(body);
  return body;
}

export function executeClinicPixPayload(operationId: string): { action: string; operationId: string } {
  const body = { action: "execute_pix_automatic_authorization", operationId };
  assertNoClientPixAuthority(body);
  return body;
}

export function prepareClinicPixPayload(clinicId: string): { p_clinic_id: string } {
  const body = { p_clinic_id: clinicId };
  assertNoClientPixAuthority(body);
  return body;
}

export function qrMustStayTransient(_checkout: ClinicCommercialCheckout): false {
  return false;
}

export function nextActionAllowsExecute(next: PixNextAction | undefined, status: PixAuthorizationStatus | null): boolean {
  return next === "prepare_execute" || status === "INTENT" || status == null;
}
