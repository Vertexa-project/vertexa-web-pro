import { describe, expect, it } from "vitest";

import {
  CANARY_PRODUCTION_OPERATIONS,
  isCommercialAuthFailure,
  isCommercialOnboardingPath,
  isMissingCommercialAccessFunction,
  isProductionProviderWriteAllowed,
  resolveCommercialAccess,
  resolveCommercialShellGate,
} from "./commercialAccess";

describe("resolveCommercialAccess", () => {
  it("grants FULL for an active contract even in ENFORCE", () => {
    expect(
      resolveCommercialAccess({
        rolloutMode: "ENFORCE",
        hasActiveContract: true,
        exemptionActive: false,
      }),
    ).toEqual({ accessClass: "FULL", reason: "ACTIVE_CONTRACT", productAllowed: true });
  });

  it("grants EXEMPT without a contract when a PA exemption is active", () => {
    expect(
      resolveCommercialAccess({
        rolloutMode: "ENFORCE",
        hasActiveContract: false,
        exemptionActive: true,
      }),
    ).toEqual({ accessClass: "EXEMPT", reason: "PLATFORM_EXEMPTION", productAllowed: true });
  });

  it("keeps product allowed in OBSERVE without a contract", () => {
    expect(
      resolveCommercialAccess({
        rolloutMode: "OBSERVE",
        hasActiveContract: false,
        exemptionActive: false,
      }),
    ).toEqual({ accessClass: "PRE_CONTRACT", reason: "OBSERVE_ONLY", productAllowed: true });
  });

  it("blocks product in ENFORCE without contract or exemption", () => {
    expect(
      resolveCommercialAccess({
        rolloutMode: "ENFORCE",
        hasActiveContract: false,
        exemptionActive: false,
      }),
    ).toEqual({
      accessClass: "PRE_CONTRACT",
      reason: "NO_ACTIVE_CONTRACT",
      productAllowed: false,
    });
  });

  it("does not treat payment or entitlement as inputs", () => {
    const src = resolveCommercialAccess.toString();
    expect(src).not.toMatch(/RECEIVED|entitlement|pix/i);
  });
});

describe("isCommercialOnboardingPath", () => {
  it("allows only billing/plan routes through the clinic shell", () => {
    expect(isCommercialOnboardingPath("/configuracoes/faturamento")).toBe(true);
    expect(isCommercialOnboardingPath("/pacientes")).toBe(false);
    expect(isCommercialOnboardingPath("/jornada")).toBe(false);
    expect(isCommercialOnboardingPath("/configuracoes/equipe")).toBe(false);
  });
});

describe("isProductionProviderWriteAllowed", () => {
  it("blocks every mutation while LOCKED", () => {
    expect(
      isProductionProviderWriteAllowed({
        writeMode: "LOCKED",
        clinicId: "c1",
        operationType: "ENSURE_CUSTOMER_FROM_IDENTITY",
        canaryClinicId: "c1",
        allowedOperations: [...CANARY_PRODUCTION_OPERATIONS],
      }),
    ).toBe(false);
  });

  it("allows only the canary clinic and listed operations", () => {
    expect(
      isProductionProviderWriteAllowed({
        writeMode: "CANARY",
        clinicId: "c1",
        operationType: "ENSURE_CUSTOMER_FROM_IDENTITY",
        canaryClinicId: "c1",
        allowedOperations: [...CANARY_PRODUCTION_OPERATIONS],
      }),
    ).toBe(true);
    expect(
      isProductionProviderWriteAllowed({
        writeMode: "CANARY",
        clinicId: "c2",
        operationType: "ENSURE_CUSTOMER_FROM_IDENTITY",
        canaryClinicId: "c1",
        allowedOperations: [...CANARY_PRODUCTION_OPERATIONS],
      }),
    ).toBe(false);
    expect(
      isProductionProviderWriteAllowed({
        writeMode: "OPEN",
        clinicId: "c9",
        operationType: "ENSURE_CUSTOMER_FROM_IDENTITY",
        canaryClinicId: null,
        allowedOperations: [],
      }),
    ).toBe(true);
    expect(
      isProductionProviderWriteAllowed({
        writeMode: "OPEN",
        clinicId: "c9",
        operationType: "ensure_customer",
        canaryClinicId: null,
        allowedOperations: [],
      }),
    ).toBe(false);
  });
});

describe("resolveCommercialShellGate", () => {
  it("allows OBSERVE resolved no-contract", () => {
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: false,
        productAllowed: true,
        pathname: "/pacientes",
      }),
    ).toBe("allow");
  });

  it("blocks ENFORCE PRE_CONTRACT on clinical routes", () => {
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: false,
        productAllowed: false,
        pathname: "/pacientes",
      }),
    ).toBe("pre_contract");
  });

  it("fail-closes unexpected ENFORCE resolver errors", () => {
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: true,
        error: { message: "network" },
        pathname: "/pacientes",
      }),
    ).toBe("resolution_failed");
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: true,
        error: { code: "500", message: "internal" },
        pathname: "/jornada",
      }),
    ).toBe("resolution_failed");
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: true,
        error: { code: "COMMERCIAL_ACCESS_MALFORMED", hint: "COMMERCIAL_ACCESS_MALFORMED" },
        pathname: "/pacientes",
      }),
    ).toBe("resolution_failed");
  });

  it("treats expired session as auth, not PRE_CONTRACT", () => {
    const error = { hint: "BILLING_NOT_AUTHENTICATED", code: "42501" };
    expect(isCommercialAuthFailure(error)).toBe(true);
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: true,
        error,
        pathname: "/pacientes",
      }),
    ).toBe("auth_required");
  });

  it("keeps a narrow missing-RPC compatibility path", () => {
    const error = { code: "PGRST202", message: "Could not find the function get_my_clinic_commercial_access" };
    expect(isMissingCommercialAccessFunction(error)).toBe(true);
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: true,
        error,
        pathname: "/pacientes",
      }),
    ).toBe("resolver_unavailable");
  });
});
