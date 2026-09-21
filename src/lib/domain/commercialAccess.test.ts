import { describe, expect, it } from "vitest";

import {
  CANARY_PRODUCTION_OPERATIONS,
  isCommercialOnboardingPath,
  isProductionProviderWriteAllowed,
  resolveCommercialAccess,
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
