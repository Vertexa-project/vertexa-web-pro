import { describe, expect, it, vi } from "vitest";

import { dispatchAsaasWebhook } from "../asaasWebhook.js";

function webhookRequest(token: string, environmentInBody?: string) {
  return new Request("https://example.test/asaas-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "asaas-access-token": token,
    },
    body: JSON.stringify({
      id: "evt_1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_1" },
      environment: environmentInBody,
    }),
  });
}

describe("dispatchAsaasWebhook environment attribution", () => {
  it("extracts hosted checkout correlation without retaining checkout URLs or card data", async () => {
    const ingest = vi.fn(async () => ({ outcome: "inserted" }));
    const req = new Request("https://example.test/asaas-webhook", {
      method: "POST", headers: { "asaas-access-token": "sandbox-token" },
      body: JSON.stringify({ id: "evt_checkout", event: "CHECKOUT_EXPIRED", checkout: { id: "co_1", externalReference: "vtx:hosted-card:opaque", link: "https://secret.test" } }),
    });
    await expect(dispatchAsaasWebhook(req, { sandboxToken: "sandbox-token", productionToken: "production-token", ingest })).resolves.toMatchObject({ status: 200 });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      externalResourceType: "hosted_card_checkout", externalResourceId: "co_1",
      providerFacts: { providerCheckoutId: "co_1", externalReference: "vtx:hosted-card:opaque" },
    }));
  });
  it("attributes sandbox from the matching token and ignores body environment", async () => {
    const ingest = vi.fn(async () => ({ outcome: "inserted" }));
    const res = await dispatchAsaasWebhook(webhookRequest("sandbox-token", "production"), {
      sandboxToken: "sandbox-token",
      productionToken: "production-token",
      ingest,
    });
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ environment: "sandbox" }));
  });

  it("attributes production from the production token", async () => {
    const ingest = vi.fn(async () => ({ outcome: "inserted" }));
    const res = await dispatchAsaasWebhook(webhookRequest("production-token"), {
      sandboxToken: "sandbox-token",
      productionToken: "production-token",
      ingest,
    });
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ environment: "production" }));
  });

  it("keeps current sandbox receipts compatible when Production token is absent", async () => {
    const ingest = vi.fn(async () => ({ outcome: "inserted" }));
    const res = await dispatchAsaasWebhook(webhookRequest("sandbox-token"), {
      sandboxToken: "sandbox-token",
      productionToken: "",
      ingest,
    });
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ environment: "sandbox" }));
  });

  it("rejects overlapping sandbox and production tokens", async () => {
    const res = await dispatchAsaasWebhook(webhookRequest("same"), {
      sandboxToken: "same",
      productionToken: "same",
      ingest: vi.fn(),
    });
    expect(res.status).toBe(503);
  });
});
