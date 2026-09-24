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

afterEach(() => vi.unstubAllGlobals());

describe("hosted recurring card checkout", () => {
  it("uses the approved 60-minute expiry and canonical recurring card payload", () => {
    const body = hostedCardCheckoutPayload(intent, "https://app.vertexa.test");
    expect(HOSTED_CARD_CHECKOUT_EXPIRY_MINUTES).toBe(60);
    expect(body).toMatchObject({
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      externalReference: intent.externalReference,
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
    await expect(createHostedCardCheckout({ adminClient: adminClient as never, creds, appBaseUrl: "https://app.vertexa.test", intent }))
      .resolves.toEqual({ ok: true, hostedUrl: "https://checkout.asaas.test/opaque" });
    expect(calls[0]?.name).toBe("complete_my_clinic_hosted_card_checkout");
  });
});
