import { describe, expect, it, afterEach, vi } from "vitest";

import { asaasBaseUrl, resolveOutboundEnvironment } from "./client.ts";
import {
  ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED,
  PIX_AUTOMATIC_AUTHORIZATIONS_PATH,
  PIX_AUTOMATIC_POLICY,
  buildCreatePixAutomaticAuthorizationPayload,
  createPixAutomaticAuthorization,
  extractAuthorizationFacts,
  extractTransientImmediateQr,
  extractInstructionFacts,
  findAuthorizationByContractId,
  getPixAutomaticAuthorization,
  pixAutomaticProviderContractId,
} from "./pixAutomatic.ts";
import { emptyResponse, jsonResponse, malformedResponse, readSentBody } from "./testHelpers.ts";

const creds = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pix automatic policy + payload", () => {
  it("freezes provider policy and does not use billingType PIX", () => {
    expect(PIX_AUTOMATIC_POLICY.frequency).toBe("MONTHLY");
    expect(PIX_AUTOMATIC_POLICY.paymentCreationMode).toBe("SUBSCRIPTION");
    expect(PIX_AUTOMATIC_POLICY.retryPolicy).toBe("ALLOW_THREE_IN_SEVEN_DAYS");
    expect(PIX_AUTOMATIC_POLICY.finishDate).toBeNull();
    expect(PIX_AUTOMATIC_POLICY.timezone).toBe("America/Sao_Paulo");
    expect(PIX_AUTOMATIC_POLICY.immediateQrExpirationSeconds).toBe(3600);
    expect(JSON.stringify(PIX_AUTOMATIC_POLICY)).not.toContain("PIX");
    expect(PIX_AUTOMATIC_POLICY.description.length).toBeLessThanOrEqual(35);
    expect(ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED).toBe(
      "ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED",
    );
  });

  it("maps contract UUID to 32-char non-PII contractId", () => {
    expect(pixAutomaticProviderContractId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400e29b41d4a716446655440000",
    );
  });

  it("builds official create payload without finishDate or invented pixKey", () => {
    const payload = buildCreatePixAutomaticAuthorizationPayload({
      customerId: "cus_1",
      contractId: "550e8400e29b41d4a716446655440000",
      startDate: "2026-10-12",
      valueCents: 39000,
    });
    expect(payload).toEqual({
      frequency: "MONTHLY",
      contractId: "550e8400e29b41d4a716446655440000",
      startDate: "2026-10-12",
      customerId: "cus_1",
      value: 390,
      description: "Vertexa - assinatura mensal",
      paymentCreationMode: "SUBSCRIPTION",
      retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
      immediateQrCode: {
        expirationSeconds: 3600,
        originalValue: 390,
      },
    });
    expect(payload).not.toHaveProperty("finishDate");
    expect(JSON.stringify(payload)).not.toContain("pixKey");
    expect(JSON.stringify(payload)).not.toContain("billingType");
  });
});

describe("environment selection", () => {
  it("sandbox and production resolve to distinct bases; invalid env is rejected", () => {
    expect(resolveOutboundEnvironment("sandbox")).toBe("sandbox");
    expect(resolveOutboundEnvironment("production")).toBe("production");
    expect(resolveOutboundEnvironment(undefined)).toBeNull();
    expect(resolveOutboundEnvironment("SANDBOX")).toBeNull();
    expect(resolveOutboundEnvironment("prod")).toBeNull();
    expect(asaasBaseUrl("sandbox")).toBe("https://api-sandbox.asaas.com/v3");
    expect(asaasBaseUrl("production")).toBe("https://api.asaas.com/v3");
  });
});

describe("extractAuthorizationFacts", () => {
  const expected = { customerId: "cus_1", contractId: "550e8400e29b41d4a716446655440000" };

  it("keeps only persistible QR metadata and ignores payload/encodedImage/extra fields", () => {
    const result = extractAuthorizationFacts(
      {
        id: "auth_1",
        status: "CREATED",
        customerId: "cus_1",
        contractId: "550e8400e29b41d4a716446655440000",
        value: 390,
        payload: "00020126SECRET",
        encodedImage: "iVBORw0KGgoAAA=",
        unexpectedProviderField: { nested: true },
        immediateQrCode: {
          conciliationIdentifier: "ASAAS0001",
          expirationDate: "2026-09-13 12:00:00",
          pixKey: "should-not-persist",
        },
      },
      expected,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.conciliationIdentifier).toBe("ASAAS0001");
    expect(result.facts.qrExpiresAt).toBe("2026-09-13T15:00:00.000Z");
    expect(JSON.stringify(result.facts)).not.toContain("00020126");
    expect(JSON.stringify(result.facts)).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(result.facts)).not.toContain("pixKey");
  });

  it("extracts official top-level copy/paste payload without encodedImage", () => {
    const qr = extractTransientImmediateQr({
      id: "auth_1",
      payload: "00020126SYNTHETIC_VERTEXA_QA",
      encodedImage: "iVBORw0KGgoAAA=",
      immediateQrCode: { conciliationIdentifier: "ASAAS0001", expirationDate: "2026-09-13 12:00:00" },
    });
    expect(qr.ok).toBe(true);
    if (!qr.ok) return;
    expect(qr.qr.payload).toBe("00020126SYNTHETIC_VERTEXA_QA");
    expect(qr.qr.expirationDate).toBe("2026-09-13T15:00:00.000Z");
    expect(JSON.stringify(qr.qr)).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(qr.qr)).not.toContain("conciliationIdentifier");
  });

  it("fails closed when official payload is missing on a create-shaped object", () => {
    expect(
      extractTransientImmediateQr({
        id: "auth_1",
        encodedImage: "iVBORw0KGgoAAA=",
        immediateQrCode: { expirationDate: "2026-09-13 12:00:00" },
      }),
    ).toEqual({ ok: false, reason: "provider_qr_payload_missing" });
  });

  it("rejects customer mismatch", () => {
    const result = extractAuthorizationFacts(
      { id: "auth_1", status: "CREATED", customerId: "cus_OTHER", contractId: expected.contractId },
      expected,
    );
    expect(result).toEqual({ ok: false, reason: "reconciliation_customer_mismatch" });
  });
});

describe("extractInstructionFacts", () => {
  it("prefers official OpenAPI paymentId and still accepts webhook-doc payment alias", () => {
    const byId = extractInstructionFacts({
      id: "inst_1",
      status: "SCHEDULED",
      dueDate: "2026-10-04",
      paymentId: "pay_api",
      payment: "pay_webhook_alias",
      authorization: { id: "auth_1" },
      brandNewField: 1,
    });
    expect(byId).toEqual({
      ok: true,
      facts: {
        providerInstructionId: "inst_1",
        status: "SCHEDULED",
        providerAuthorizationId: "auth_1",
        providerPaymentId: "pay_api",
        dueDate: "2026-10-04",
      },
    });
    const byWebhookAlias = extractInstructionFacts({
      id: "inst_1",
      status: "SCHEDULED",
      dueDate: "2026-10-04",
      payment: "pay_1",
      authorization: { id: "auth_1" },
    });
    expect(byWebhookAlias.ok).toBe(true);
    if (byWebhookAlias.ok) expect(byWebhookAlias.facts.providerPaymentId).toBe("pay_1");
  });

  it("maps CREATED to AWAITING_REQUEST", () => {
    const result = extractInstructionFacts({
      id: "inst_1",
      status: "CREATED",
      authorization: { id: "auth_1" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts.status).toBe("AWAITING_REQUEST");
  });
});

describe("pix automatic HTTP adapter (mocked)", () => {
  it("POST 200 create success uses /pix/automatic/authorizations", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { id: "auth_1", status: "CREATED", customerId: "cus_1" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const res = await createPixAutomaticAuthorization(creds, "sandbox", {
      customerId: "cus_1",
      contractId: "550e8400e29b41d4a716446655440000",
      startDate: "2026-10-12",
      valueCents: 39000,
    });
    expect(res.outcome).toBe("success");
    expect(String(fetchSpy.mock.calls[0][0])).toContain(PIX_AUTOMATIC_AUTHORIZATIONS_PATH);
    expect(fetchSpy.mock.calls[0][1]?.method).toBe("POST");
    expect(readSentBody(fetchSpy.mock.calls[0][1]).finishDate).toBeUndefined();
  });

  it("classifies 400/401/429/500/timeout/malformed/extra fields", async () => {
    const cases: Array<{ res: Response | Promise<never>; outcome: string; category: string }> = [
      { res: jsonResponse(400, { errors: [{ description: "invalid" }] }), outcome: "deterministic_rejection", category: "http_4xx" },
      { res: jsonResponse(401, { errors: [{ description: "unauthorized" }] }), outcome: "deterministic_rejection", category: "http_4xx" },
      { res: new Response("slow", { status: 429 }), outcome: "deterministic_rejection", category: "rate_limited" },
      { res: new Response("err", { status: 500 }), outcome: "unknown", category: "provider_5xx" },
      { res: emptyResponse(200), outcome: "unknown", category: "empty_2xx_body" },
      { res: malformedResponse(200), outcome: "unknown", category: "malformed_2xx_body" },
    ];
    for (const c of cases) {
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", vi.fn(async () => c.res));
      const res = await createPixAutomaticAuthorization(creds, "sandbox", {
        customerId: "cus_1",
        contractId: "550e8400e29b41d4a716446655440000",
        startDate: "2026-10-12",
        valueCents: 1000,
      });
      expect(res.outcome).toBe(c.outcome);
      expect(res.category).toBe(c.category);
      expect(JSON.stringify(res)).not.toContain("fake-sandbox-key-never-real");
    }

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    const timeout = await createPixAutomaticAuthorization(creds, "sandbox", {
      customerId: "cus_1",
      contractId: "550e8400e29b41d4a716446655440000",
      startDate: "2026-10-12",
      valueCents: 1000,
    });
    expect(timeout).toMatchObject({ outcome: "unknown", category: "network_timeout" });
  });

  it("GET authorization and list-by-customer filter contractId client-side", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes("/pix/automatic/authorizations/auth_1")) {
        return jsonResponse(200, { id: "auth_1", status: "CREATED", customerId: "cus_1" });
      }
      return jsonResponse(200, {
        data: [
          { id: "auth_other", contractId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", customerId: "cus_1", status: "CREATED" },
          { id: "auth_1", contractId: "550e8400e29b41d4a716446655440000", customerId: "cus_1", status: "CREATED" },
        ],
        hasMore: false,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const get = await getPixAutomaticAuthorization(creds, "sandbox", "auth_1");
    expect(get.outcome).toBe("success");
    const found = await findAuthorizationByContractId(
      creds,
      "sandbox",
      "cus_1",
      "550e8400e29b41d4a716446655440000",
    );
    expect(found).toMatchObject({ outcome: "found" });
    expect(String(fetchSpy.mock.calls[1][0])).toContain("customerId=cus_1");
    expect(String(fetchSpy.mock.calls[1][0])).not.toContain("contractId=");
  });

  it("scan cap with hasMore does not claim not_found", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        data: Array.from({ length: 100 }, (_, i) => ({
          id: `auth_${i}`,
          contractId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          customerId: "cus_1",
          status: "CREATED",
        })),
        hasMore: true,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const found = await findAuthorizationByContractId(
      creds,
      "sandbox",
      "cus_1",
      "550e8400e29b41d4a716446655440000",
    );
    expect(found).toEqual({
      outcome: "lookup_failed",
      category: "reconciliation_lookup_scan_capped",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });
});
