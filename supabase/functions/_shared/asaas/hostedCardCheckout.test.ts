import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_CARD_CHECKOUT_EXPIRY_MINUTES,
  createHostedCardCheckout,
  hostedCardCheckoutPayload,
  type HostedCardCheckoutIntent,
} from "./hostedCardCheckout.ts";
import { jsonResponse, makeAdminClient, readSentBody } from "./testHelpers.ts";

const intent: HostedCardCheckoutIntent = {
  attemptId: "11111111-1111-4111-8111-111111111111",
  billingAccountId: "22222222-2222-4222-8222-222222222222",
  environment: "sandbox",
  externalCustomerId: null,
  externalReference: "vtx:hosted-card:opaque",
  priceCents: 12990,
  currency: "BRL",
  planName: "Plano Vertexa",
  expiresAt: "2026-09-24T12:00:00.000Z",
  hostedUrl: null,
  providerCheckoutId: null,
  canCreate: true,
  status: "CREATING",
};
const creds = { apiKey: "fake-key", baseUrl: "https://api-sandbox.asaas.test" };
const boundIntent: HostedCardCheckoutIntent = { ...intent, externalCustomerId: "cus_canonical" };

afterEach(() => vi.unstubAllGlobals());

describe("hosted recurring card checkout", () => {
  it("uses the approved 60-minute expiry and canonical recurring card payload", () => {
    const body = hostedCardCheckoutPayload(boundIntent, "https://app.vertexa.test");
    expect(HOSTED_CARD_CHECKOUT_EXPIRY_MINUTES).toBe(60);
    expect(body).toMatchObject({
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      externalReference: intent.externalReference,
      customer: "cus_canonical",
      subscription: { cycle: "MONTHLY" },
      callback: {
        successUrl: "https://app.vertexa.test/configuracoes/faturamento/checkout/success",
        cancelUrl: "https://app.vertexa.test/configuracoes/faturamento/checkout/cancel",
        expiredUrl: "https://app.vertexa.test/configuracoes/faturamento/checkout/expired",
      },
    });
    expect(body).not.toHaveProperty("customerData");
    expect(body).not.toHaveProperty("endDate");
  });

  it("refuses to create an anonymous hosted checkout when the canonical customer is not bound", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => ({ data: null, error: null }));
    await expect(createHostedCardCheckout({
      adminClient: adminClient as never,
      creds,
      appBaseUrl: "https://app.vertexa.test",
      intent,
    })).resolves.toEqual({ ok: false, errorCode: "customer_not_ready" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("cannot even construct a provider payload without the canonical customer", () => {
    expect(() => hostedCardCheckoutPayload(intent, "https://app.vertexa.test"))
      .toThrow("customer_not_ready");
  });

  it("never combines canonical customer with customerData or card payload fields", () => {
    const body = hostedCardCheckoutPayload(boundIntent, "https://app.vertexa.test");
    expect(body).toHaveProperty("customer", "cus_canonical");
    expect(body).not.toHaveProperty("customerData");
    expect(JSON.stringify(body)).not.toMatch(/cardNumber|cvv|creditCardToken/i);
  });

  it("builds the exact server-authoritative Sync R$497 Preview payload", () => {
    const sync = {
      ...boundIntent,
      priceCents: 49_700,
      planName: "Sync",
      externalReference: "vtx:hosted-card:33333333-3333-4333-8333-333333333333",
    };
    const body = hostedCardCheckoutPayload(sync, "https://preview.vertexa.test/");
    expect(Object.keys(body).sort()).toEqual([
      "billingTypes",
      "callback",
      "chargeTypes",
      "customer",
      "externalReference",
      "items",
      "minutesToExpire",
      "subscription",
    ]);
    expect(body).toMatchObject({
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      externalReference: sync.externalReference,
      customer: "cus_canonical",
      callback: {
        successUrl: "https://preview.vertexa.test/configuracoes/faturamento/checkout/success",
        cancelUrl: "https://preview.vertexa.test/configuracoes/faturamento/checkout/cancel",
        expiredUrl: "https://preview.vertexa.test/configuracoes/faturamento/checkout/expired",
      },
      items: [{
        name: "Sync",
        description: "Assinatura mensal Vertexa",
        quantity: 1,
        value: 497,
      }],
      subscription: { cycle: "MONTHLY" },
    });
    expect(body).not.toHaveProperty("customerData");
    expect(body).not.toHaveProperty("subscription.endDate");
    expect((body.subscription as { nextDueDate: string }).nextDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sync.externalReference).toHaveLength(52);
    expect(JSON.stringify(body)).not.toMatch(/clientPrice|browserPrice|priceOverride|cardNumber|cvv/i);
  });

  it("does not replay a retained creating attempt after an unknown provider outcome", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => ({ data: null, error: null }));
    const result = await createHostedCardCheckout({
      adminClient: adminClient as never, creds, appBaseUrl: "https://app.vertexa.test", intent: { ...intent, canCreate: false },
    });
    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("persists the provider checkout only after a successful create response", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(readSentBody(init)).toMatchObject({ minutesToExpire: 60, chargeTypes: ["RECURRENT"] });
      return jsonResponse(200, { id: "checkout_1", link: "https://checkout.asaas.test/opaque" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "complete_my_clinic_hosted_card_checkout") {
        return { data: { outcome: "active", hosted_url: "https://checkout.asaas.test/opaque" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    await expect(createHostedCardCheckout({ adminClient: adminClient as never, creds, appBaseUrl: "https://app.vertexa.test", intent: boundIntent }))
      .resolves.toEqual({ ok: true, hostedUrl: "https://checkout.asaas.test/opaque" });
    expect(calls[0]?.name).toBe("complete_my_clinic_hosted_card_checkout");
  });

  it("logs only the bounded safe diagnostic on provider rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, {
      errors: [{
        code: "invalid_item",
        description: "customer 44444444-4444-4444-8444-444444444444 email qa@example.test is invalid",
      }],
      customer: "cus_must_not_be_logged",
    })));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "fail_my_clinic_hosted_card_checkout") return { data: true, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const result = await createHostedCardCheckout({
      adminClient: adminClient as never,
      creds,
      appBaseUrl: "https://app.vertexa.test",
      intent: boundIntent,
    });
    expect(result).toEqual({ ok: false, errorCode: "provider_rejected" });
    expect(consoleSpy).toHaveBeenCalledOnce();
    const diagnostic = String(consoleSpy.mock.calls[0]?.[0]);
    expect(diagnostic).toContain('"operation":"create_checkout"');
    expect(diagnostic).toContain('"httpStatus":400');
    expect(diagnostic).toContain('"code":"invalid_item"');
    expect(diagnostic).toContain("[REDACTED_ID]");
    expect(diagnostic).toContain("[REDACTED_EMAIL]");
    expect(diagnostic).not.toContain("cus_must_not_be_logged");
    expect(diagnostic).not.toContain(creds.apiKey);
    expect(diagnostic).not.toContain("customerData");
  });
});
