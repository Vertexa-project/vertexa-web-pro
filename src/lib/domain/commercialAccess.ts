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
