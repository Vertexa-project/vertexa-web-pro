export type CommercialRolloutMode = "OBSERVE" | "ENFORCE";
export type CommercialAccessClass = "FULL" | "PRE_CONTRACT" | "EXEMPT";
export type CommercialAccessReason =
  | "ACTIVE_CONTRACT"
  | "PLATFORM_EXEMPTION"
  | "NO_ACTIVE_CONTRACT"
  | "OBSERVE_ONLY";

export interface CommercialAccessInput {
  rolloutMode: CommercialRolloutMode;
  hasActiveContract: boolean;
  exemptionActive: boolean;
}

export interface CommercialAccessDecision {
  accessClass: CommercialAccessClass;
  reason: CommercialAccessReason;
  productAllowed: boolean;
}

export function resolveCommercialAccess(input: CommercialAccessInput): CommercialAccessDecision {
  if (input.hasActiveContract) {
    return { accessClass: "FULL", reason: "ACTIVE_CONTRACT", productAllowed: true };
  }
  if (input.exemptionActive) {
    return { accessClass: "EXEMPT", reason: "PLATFORM_EXEMPTION", productAllowed: true };
  }
  if (input.rolloutMode === "OBSERVE") {
    return { accessClass: "PRE_CONTRACT", reason: "OBSERVE_ONLY", productAllowed: true };
  }
  return { accessClass: "PRE_CONTRACT", reason: "NO_ACTIVE_CONTRACT", productAllowed: false };
}

export function isCommercialOnboardingPath(pathname: string): boolean {
  return (
    pathname === "/configuracoes/faturamento" ||
    pathname.startsWith("/configuracoes/faturamento/")
  );
}

export function isMissingCommercialAccessFunction(error: unknown): boolean {
  const code =
    error && typeof error === "object"
      ? `${String((error as { code?: unknown }).code ?? "")} ${String((error as { message?: unknown }).message ?? "")} ${String((error as { hint?: unknown }).hint ?? "")}`
      : String(error ?? "");
  return /PGRST202|42883|function.*get_my_clinic_commercial_access/i.test(code);
}

export type CommercialShellDecision =
  | "allow"
  | "pre_contract"
  | "resolver_unavailable"
  | "resolution_failed"
  | "auth_required";

export function isCommercialAuthFailure(error: unknown): boolean {
  const code =
    error && typeof error === "object"
      ? `${String((error as { code?: unknown }).code ?? "")} ${String((error as { message?: unknown }).message ?? "")} ${String((error as { hint?: unknown }).hint ?? "")}`
      : String(error ?? "");
  return /BILLING_NOT_AUTHENTICATED|PGRST301|JWT expired|not authenticated|invalid jwt/i.test(code);
}

export function isMalformedCommercialAccessPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
  const rec = raw as Record<string, unknown>;
  return (
    typeof rec.product_allowed !== "boolean" ||
    typeof rec.access_class !== "string" ||
    typeof rec.rollout_mode !== "string"
  );
}

export function resolveCommercialShellGate(input: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  productAllowed?: boolean;
  pathname: string;
}): CommercialShellDecision {
  if (input.isLoading) {
    return "allow";
  }
  if (input.isError) {
    if (isCommercialAuthFailure(input.error)) return "auth_required";
    if (isMissingCommercialAccessFunction(input.error)) return "resolver_unavailable";
    return "resolution_failed";
  }
  if (input.productAllowed === false && !isCommercialOnboardingPath(input.pathname)) {
    return "pre_contract";
  }
  return "allow";
}

export type ProviderWriteMode = "LOCKED" | "CANARY" | "OPEN";

export function isProductionProviderWriteAllowed(input: {
  writeMode: ProviderWriteMode;
  clinicId: string | null;
  operationType: string;
  canaryClinicId: string | null;
  allowedOperations: readonly string[];
}): boolean {
  if (input.writeMode === "LOCKED") return false;
  if (input.writeMode === "OPEN") {
    return (
      input.operationType === "ENSURE_CUSTOMER_FROM_IDENTITY" ||
      input.operationType === "PIX_AUTOMATIC_CREATE"
    );
  }
  if (!input.clinicId || input.clinicId !== input.canaryClinicId) return false;
  return input.allowedOperations.includes(input.operationType);
}

export const CANARY_PRODUCTION_OPERATIONS = [
  "ENSURE_CUSTOMER_FROM_IDENTITY",
  "PIX_AUTOMATIC_CREATE",
] as const;
