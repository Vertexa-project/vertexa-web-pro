// Fundação comercial do checkout (BP02). Sem I/O. Sem HTTP Asaas.
// Quatro estados permanecem independentes — nunca colapsar em isPaidPlanActive.

export const FOUNDER_CHECKOUT = "OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY" as const;

export const COMMERCIAL_CONTRACT_STATUSES = ["pending", "active", "ended", "cancelled"] as const;
export type CommercialContractStatus = (typeof COMMERCIAL_CONTRACT_STATUSES)[number];

export const PIX_AUTHORIZATION_STATUSES = [
  "INTENT",
  "CREATED",
  "ACTIVE",
  "CANCELLED",
  "EXPIRED",
  "REFUSED",
] as const;
export type PixAuthorizationStatus = (typeof PIX_AUTHORIZATION_STATUSES)[number];

export const FINANCIAL_PAYMENT_STATUSES = ["pending", "received", "overdue"] as const;
export type FinancialPaymentStatus = (typeof FINANCIAL_PAYMENT_STATUSES)[number];

export const ENTITLEMENT_ENFORCEMENT = "OFF" as const;

export type CheckoutWizardStep = "plan" | "identity" | "review" | "confirmed";

export interface SellableBillingPlan {
  planId: string;
  planVersionId: string;
  code: string;
  displayName: string;
  priceCents: number;
  currency: string;
  billingCycle: "monthly";
  tagline: string | null;
  marketingMessage: string | null;
  features: string[];
  sellable: boolean;
}

export interface CommercialContractSummary {
  id: string;
  status: CommercialContractStatus;
  planId: string;
  planVersionId: string;
  planCode: string;
  planDisplayName: string;
  priceCents: number;
  currency: string;
  billingCycle: "monthly";
}

export interface BillingFourStates {
  commercialContractStatus: CommercialContractStatus | null;
  pixAuthorizationStatus: PixAuthorizationStatus | null;
  financialPaymentStatus: FinancialPaymentStatus | null;
  entitlementEnforcement: typeof ENTITLEMENT_ENFORCEMENT;
  entitlementGranted: false;
}

export const PIX_NEXT_ACTIONS = [
  "none",
  "complete_identity",
  "ensure_customer",
  "prepare_execute",
  "await_bank",
  "reissue",
  "done",
] as const;
export type PixNextAction = (typeof PIX_NEXT_ACTIONS)[number];

export interface ClinicCommercialCheckout {
  clinicId: string;
  founderCheckout: typeof FOUNDER_CHECKOUT;
  identityExists: boolean;
  identityComplete: boolean;
  localBillingAccountExists: boolean;
  localBillingAccountSandbox?: boolean;
  providerCustomerBound?: boolean;
  commercialContract: CommercialContractSummary | null;
  pixAuthorizationStatus: PixAuthorizationStatus | null;
  pixGeneration?: number | null;
  pixNextAction?: PixNextAction;
  qrAvailableNow?: false;
  entitlementEnforcement: typeof ENTITLEMENT_ENFORCEMENT;
  entitlementGranted: false;
}

export function formatBillingPriceCents(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function billingCycleLabel(cycle: "monthly"): string {
  return cycle === "monthly" ? "Cobrança mensal" : cycle;
}

export function resolveFourStates(checkout: ClinicCommercialCheckout): BillingFourStates {
  return {
    commercialContractStatus: checkout.commercialContract?.status ?? null,
    pixAuthorizationStatus: checkout.pixAuthorizationStatus,
    financialPaymentStatus: null,
    entitlementEnforcement: ENTITLEMENT_ENFORCEMENT,
    entitlementGranted: false,
  };
}

export function checkoutWizardStep(input: {
  hasActiveContract: boolean;
  identityComplete: boolean;
  selectedPlanVersionId: string | null;
}): CheckoutWizardStep {
  if (input.hasActiveContract) return "confirmed";
  if (!input.selectedPlanVersionId) return "plan";
  if (!input.identityComplete) return "identity";
  return "review";
}

export function isActiveCommercialContract(
  contract: CommercialContractSummary | null,
): contract is CommercialContractSummary {
  return contract?.status === "active";
}

export function planIsFounderBlocked(code: string): boolean {
  return code.trim().toLowerCase().startsWith("founder");
}

export function sanitizeSellablePlans(plans: SellableBillingPlan[]): SellableBillingPlan[] {
  return plans.filter((plan) => plan.sellable && !planIsFounderBlocked(plan.code));
}

const CHECKOUT_HINTS: Record<string, string> = {
  BILLING_NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente para continuar.",
  BILLING_NOT_CLINIC_ADMIN: "Apenas o administrador da clínica pode contratar um plano.",
  BILLING_CLINIC_REQUIRED: "Não foi possível identificar a clínica.",
  BILLING_PLAN_VERSION_REQUIRED: "Selecione um plano para continuar.",
  BILLING_PLAN_NOT_ELIGIBLE: "Este plano não está disponível para contratação.",
  BILLING_IDENTITY_INCOMPLETE: "Salve os dados de cobrança antes de confirmar.",
  BILLING_ACTIVE_CONTRACT_EXISTS: "Esta clínica já tem um plano contratado.",
  BILLING_PRODUCTION_LOCKED: "O ambiente de produção ainda não está liberado.",
  BILLING_CLIENT_PRICE_REJECTED: "O preço é definido pelo servidor. Recarregue e tente de novo.",
};

export function billingCheckoutErrorHint(error: unknown): string | null {
  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint in CHECKOUT_HINTS) return hint;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    const match = Object.keys(CHECKOUT_HINTS).find((code) => message.includes(code));
    return match ?? null;
  }
  return null;
}

export function isExpectedBillingCheckoutError(error: unknown): boolean {
  return billingCheckoutErrorHint(error) !== null;
}

export function billingCheckoutErrorMessage(error: unknown): string {
  const hint = billingCheckoutErrorHint(error);
  if (hint) return CHECKOUT_HINTS[hint];
  return "Não foi possível concluir a contratação agora. Tente novamente em instantes.";
}

export function assertNoClientPriceAuthority(body: Record<string, unknown>): void {
  const forbidden = ["amount", "price", "priceCents", "price_cents", "currency", "discount", "providerAmount"];
  for (const key of forbidden) {
    if (key in body) {
      const err = new Error("BILLING_CLIENT_PRICE_REJECTED");
      (err as { hint?: string }).hint = "BILLING_CLIENT_PRICE_REJECTED";
      throw err;
    }
  }
}

export function commercialContractCreatePayload(input: {
  clinicId: string;
  planVersionId: string;
}): { p_clinic_id: string; p_plan_version_id: string } {
  assertNoClientPriceAuthority(input as unknown as Record<string, unknown>);
  return {
    p_clinic_id: input.clinicId,
    p_plan_version_id: input.planVersionId,
  };
}
