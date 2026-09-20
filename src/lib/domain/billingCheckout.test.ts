import { describe, expect, it } from "vitest";

import {
  FOUNDER_CHECKOUT,
  assertNoClientPriceAuthority,
  billingCheckoutErrorMessage,
  billingCycleLabel,
  checkoutWizardStep,
  commercialContractCreatePayload,
  formatBillingPriceCents,
  isActiveCommercialContract,
  planIsFounderBlocked,
  resolveFourStates,
  sanitizeSellablePlans,
  type ClinicCommercialCheckout,
  type SellableBillingPlan,
} from "./billingCheckout";

const pulse: SellableBillingPlan = {
  planId: "plan-pulse",
  planVersionId: "ver-pulse",
  code: "pulse",
  displayName: "Pulse",
  priceCents: 39000,
  currency: "BRL",
  billingCycle: "monthly",
  tagline: "O pulso constante",
  marketingMessage: null,
  features: ["Painel de pacientes"],
  sellable: true,
};

const checkoutBase: ClinicCommercialCheckout = {
  clinicId: "c1",
  founderCheckout: FOUNDER_CHECKOUT,
  identityExists: true,
  identityComplete: true,
  localBillingAccountExists: false,
  commercialContract: null,
  pixAuthorizationStatus: null,
  entitlementEnforcement: "OFF",
  entitlementGranted: false,
};

describe("billingCheckout domain", () => {
  it("formata preço a partir dos centavos do servidor", () => {
    expect(formatBillingPriceCents(39000)).toMatch(/390/);
    expect(formatBillingPriceCents(49700)).toMatch(/497/);
    expect(billingCycleLabel("monthly")).toBe("Cobrança mensal");
  });

  it("bloqueia founder no catálogo genérico", () => {
    expect(FOUNDER_CHECKOUT).toBe("OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY");
    expect(planIsFounderBlocked("founder_2026")).toBe(true);
    expect(
      sanitizeSellablePlans([
        pulse,
        { ...pulse, code: "founder_2026", planVersionId: "ver-f", sellable: true },
      ]),
    ).toEqual([pulse]);
  });

  it("nunca colapsa contrato, Pix, pagamento e entitlement", () => {
    const states = resolveFourStates({
      ...checkoutBase,
      commercialContract: {
        id: "cc1",
        status: "active",
        planId: "plan-pulse",
        planVersionId: "ver-pulse",
        planCode: "pulse",
        planDisplayName: "Pulse",
        priceCents: 39000,
        currency: "BRL",
        billingCycle: "monthly",
      },
      pixAuthorizationStatus: null,
    });
    expect(states.commercialContractStatus).toBe("active");
    expect(states.pixAuthorizationStatus).toBeNull();
    expect(states.financialPaymentStatus).toBeNull();
    expect(states.entitlementEnforcement).toBe("OFF");
    expect(states.entitlementGranted).toBe(false);
    expect(isActiveCommercialContract(checkoutBase.commercialContract)).toBe(false);
  });

  it("projeta o wizard sem máquina persistida extra", () => {
    expect(
      checkoutWizardStep({ hasActiveContract: false, identityComplete: false, selectedPlanVersionId: null }),
    ).toBe("plan");
    expect(
      checkoutWizardStep({
        hasActiveContract: false,
        identityComplete: false,
        selectedPlanVersionId: "ver-pulse",
      }),
    ).toBe("identity");
    expect(
      checkoutWizardStep({
        hasActiveContract: false,
        identityComplete: true,
        selectedPlanVersionId: "ver-pulse",
      }),
    ).toBe("review");
    expect(
      checkoutWizardStep({ hasActiveContract: true, identityComplete: true, selectedPlanVersionId: "ver-pulse" }),
    ).toBe("confirmed");
  });

  it("payload de contrato envia só clínica e versão — nunca preço", () => {
    expect(commercialContractCreatePayload({ clinicId: "c1", planVersionId: "ver-pulse" })).toEqual({
      p_clinic_id: "c1",
      p_plan_version_id: "ver-pulse",
    });
    expect(() => assertNoClientPriceAuthority({ priceCents: 1 })).toThrow(/BILLING_CLIENT_PRICE_REJECTED/);
    expect(billingCheckoutErrorMessage({ hint: "BILLING_ACTIVE_CONTRACT_EXISTS" })).toMatch(/já tem um plano/);
  });
});
