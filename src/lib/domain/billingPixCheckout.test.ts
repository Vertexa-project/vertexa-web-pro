import { describe, expect, it } from "vitest";

import type { ClinicCommercialCheckout } from "./billingCheckout";
import {
  CHECKOUT_QR_RECOVERY,
  PIX_AUTOMATIC_RETRY_POLICY,
  PIX_BANK_COPY,
  PIX_PAYMENT_CREATION_MODE,
  PIX_RELOAD_COPY,
  assertNoClientPixAuthority,
  ensureCustomerFromIdentityPayload,
  executeClinicPixPayload,
  qrMustStayTransient,
  resolvePixCheckoutSurface,
} from "./billingPixCheckout";

const checkout = (over: Partial<ClinicCommercialCheckout> = {}): ClinicCommercialCheckout => ({
  clinicId: "c1",
  founderCheckout: "OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY",
  identityExists: true,
  identityComplete: true,
  localBillingAccountExists: true,
  localBillingAccountSandbox: true,
  providerCustomerBound: true,
  commercialContract: {
    id: "cc1",
    status: "active",
    planId: "p",
    planVersionId: "v",
    planCode: "pulse",
    planDisplayName: "Pulse",
    priceCents: 39000,
    currency: "BRL",
    billingCycle: "monthly",
  },
  pixAuthorizationStatus: null,
  pixNextAction: "prepare_execute",
  qrAvailableNow: false,
  entitlementEnforcement: "OFF",
  entitlementGranted: false,
  ...over,
});

describe("billingPixCheckout domain", () => {
  it("fixes retry policy and subscription mode for new product authorizations", () => {
    expect(PIX_AUTOMATIC_RETRY_POLICY).toBe("ALLOW_THREE_IN_SEVEN_DAYS");
    expect(PIX_PAYMENT_CREATION_MODE).toBe("SUBSCRIPTION");
    expect(CHECKOUT_QR_RECOVERY).toBe("NO_SUPPORTED_QR_RECOVERY");
  });

  it("keeps QR session-local and maps reload to awaiting copy", () => {
    expect(qrMustStayTransient(checkout({ pixAuthorizationStatus: "CREATED" }))).toBe(false);
    expect(resolvePixCheckoutSurface({
      checkout: checkout({ pixAuthorizationStatus: "CREATED", pixNextAction: "await_bank" }),
      sessionQr: { payload: "000201", expirationDate: null },
      confirming: false,
    })).toBe("qr");
    expect(resolvePixCheckoutSurface({
      checkout: checkout({ pixAuthorizationStatus: "CREATED", pixNextAction: "await_bank" }),
      sessionQr: null,
      confirming: false,
    })).toBe("awaiting");
    expect(PIX_RELOAD_COPY.title).toMatch(/autorização criada/i);
    expect(PIX_BANK_COPY).toMatch(/não pede senha/i);
    expect(PIX_BANK_COPY).not.toMatch(/nubank|itaú|itau/i);
  });

  it("rejects client financial and provider overrides", () => {
    expect(() => assertNoClientPixAuthority({ retryPolicy: "NOT_ALLOWED" })).toThrow();
    expect(() => assertNoClientPixAuthority({ environment: "production" })).toThrow();
    expect(ensureCustomerFromIdentityPayload("11111111-1111-4111-8111-111111111111")).toEqual({
      action: "ensure_customer_from_identity",
      clinicId: "11111111-1111-4111-8111-111111111111",
    });
    expect(executeClinicPixPayload("22222222-2222-4222-8222-222222222222").action).toBe(
      "execute_pix_automatic_authorization",
    );
  });
});
