import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_AUTHORITY,
  CREATE_HOSTED_CARD_CHECKOUT_ACTION,
  ENSURE_CUSTOMER_FROM_IDENTITY_ACTION,
  hasForbiddenProductKeys,
  parseEnsureCustomerFromIdentityRequest,
  parseCreateHostedCardCheckoutRequest,
  sanitizeClinicCustomerResponse,
  sanitizeClinicExecuteResponse,
} from "./outboundAuthority.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("outbound action authority", () => {
  it("keeps ops actions PA_ONLY and product customer/execute clinic-scoped", () => {
    expect(ACTION_AUTHORITY.ensure_customer).toBe("PA_ONLY");
    expect(ACTION_AUTHORITY.ensure_customer_from_identity).toBe("CLINIC_ADMIN_OWN_CLINIC");
    expect(ACTION_AUTHORITY.execute_pix_automatic_authorization).toBe("PA_OR_CLINIC_OWN_OPERATION");
    expect(ACTION_AUTHORITY.reissue_pix_automatic_authorization).toBe("PA_ONLY");
    expect(ACTION_AUTHORITY.confirm_sandbox_payment).toBe("PA_ONLY");
    expect(ACTION_AUTHORITY.probe_pix_automatic_read).toBe("PA_ONLY");
    expect(ACTION_AUTHORITY.create_hosted_card_checkout).toBe("CLINIC_ADMIN_OWN_CLINIC");
  });

  it("rejects browser price, provider, and expiry overrides on hosted card checkout", () => {
    expect(parseCreateHostedCardCheckoutRequest({
      action: CREATE_HOSTED_CARD_CHECKOUT_ACTION,
      clinicId: "11111111-1111-4111-8111-111111111111",
      valueCents: 1,
    }).ok).toBe(false);
    expect(parseCreateHostedCardCheckoutRequest({
      action: CREATE_HOSTED_CARD_CHECKOUT_ACTION,
      clinicId: "11111111-1111-4111-8111-111111111111",
      minutesToExpire: 1,
    }).ok).toBe(false);
  });

  it("rejects browser-supplied provider facts on the product customer action", () => {
    expect(
      parseEnsureCustomerFromIdentityRequest({
        action: ENSURE_CUSTOMER_FROM_IDENTITY_ACTION,
        clinicId: "11111111-1111-4111-8111-111111111111",
        cpfCnpj: "99991111140",
      }).ok,
    ).toBe(false);
    expect(
      parseEnsureCustomerFromIdentityRequest({
        action: ENSURE_CUSTOMER_FROM_IDENTITY_ACTION,
        clinicId: "11111111-1111-4111-8111-111111111111",
        environment: "production",
      }).ok,
    ).toBe(false);
    expect(
      parseEnsureCustomerFromIdentityRequest({
        action: ENSURE_CUSTOMER_FROM_IDENTITY_ACTION,
        clinicId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({ ok: true, clinicId: "11111111-1111-4111-8111-111111111111" });
  });

  it("sanitizes clinic responses without raw provider ids", () => {
    expect(sanitizeClinicCustomerResponse()).toEqual({ customerBound: true });
    const sanitized = sanitizeClinicExecuteResponse({
      executed: true,
      operationId: "op",
      providerAuthorizationId: "auth_xxx",
      providerStatus: "CREATED",
      qrAvailable: true,
      immediateQrCode: { payload: "000201", expirationDate: "2026-09-20T15:00:00.000Z" },
    });
    expect(sanitized.authorizationStatus).toBe("CREATED");
    expect(sanitized).not.toHaveProperty("providerAuthorizationId");
    expect(sanitized).not.toHaveProperty("operationId");
  });

  it("product path source never uses CUSTOMER_FIXTURE", () => {
    const src = readFileSync(resolve(here, "../../asaas-outbound/index.ts"), "utf8");
    const product = src.slice(
      src.indexOf("if (body.action === ENSURE_CUSTOMER_FROM_IDENTITY_ACTION)"),
      src.indexOf("if (body.action === EXECUTE_PIX_AUTOMATIC_ACTION)"),
    );
    expect(product).toContain("customerBodyFromIdentity");
    expect(product).toContain("billingAddress: ctx.billing_address");
    expect(product).toContain("billingAddressNumber: ctx.billing_address_number");
    expect(product).toContain("requireCheckoutReady: true");
    expect(product).not.toContain("CUSTOMER_FIXTURE");
    expect(src).toContain("am_i_clinic_admin");
    expect(hasForbiddenProductKeys({ fixture: true })).toBe(true);
  });

  it("blocks incomplete hosted-card identity before reserving an attempt or calling the provider", () => {
    const src = readFileSync(resolve(here, "../../asaas-outbound/index.ts"), "utf8");
    const hosted = src.slice(
      src.indexOf("if (body.action === CREATE_HOSTED_CARD_CHECKOUT_ACTION)"),
      src.indexOf("if (body.action === EXECUTE_PIX_AUTOMATIC_ACTION)"),
    );
    const readinessGate = hosted.indexOf("ctx.checkout_ready !== true");
    const prepareAttempt = hosted.indexOf("prepare_my_clinic_hosted_card_checkout");
    const ensure = hosted.indexOf("await ensureCustomer");
    const firstCreateCheckout = hosted.indexOf("await createHostedCardCheckout");
    const newAttemptCreateCheckout = hosted.lastIndexOf("await createHostedCardCheckout");
    expect(readinessGate).toBeGreaterThan(-1);
    expect(readinessGate).toBeLessThan(prepareAttempt);
    expect(readinessGate).toBeLessThan(firstCreateCheckout);
    expect(prepareAttempt).toBeLessThan(ensure);
    expect(ensure).toBeLessThan(newAttemptCreateCheckout);
    expect(hosted).toContain("billing_phone_required");
    expect(hosted).toContain("billing_address_required");
    expect(hosted).toContain("billing_address_number_required");
  });
});
