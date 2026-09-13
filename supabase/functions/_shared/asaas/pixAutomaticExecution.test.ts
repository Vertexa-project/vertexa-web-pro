import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";
import { asaasBaseUrl } from "./client.ts";
import {
  CRON_DOES_NOT_INVOKE_OUTBOUND,
  EXECUTE_PIX_AUTOMATIC_ACTION,
  LOAD_PREPARED_PIX_AUTOMATIC_RPC,
  PREPARE_DOES_NOT_EXECUTE_PROVIDER,
  PROBE_PIX_AUTOMATIC_READ_ACTION,
  SQL_LOADER_SUCCESS_KEYS,
  assertExecutionEnvironment,
  executePreparedPixAutomaticAuthorization,
  expectedProviderBaseUrl,
  hasForbiddenProviderPayload,
  loadPreparedPixAutomaticAuthorization,
  parseExecutePixAutomaticRequest,
  parsePreparedFacts,
  probePixAutomaticRead,
  toEnsureIntent,
} from "./pixAutomaticExecution.ts";
import { CRON_JOB_NAME } from "./cronDrain.ts";
import { jsonResponse, makeAdminClient, readSentBody } from "./testHelpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const billingAccountId = "11111111-1111-1111-1111-111111111111";
const commercialContractId = "550e8400-e29b-41d4-a716-446655440000";
const contractId = "550e8400e29b41d4a716446655440000";

const prepared = {
  found: true,
  error: null,
  operation_id: operationId,
  operation_type: "create_pix_automatic_authorization",
  operation_status: "pending",
  last_error_category: null,
  load_state: "actionable",
  actionable: true,
  provider: "asaas",
  environment: "sandbox",
  billing_account_id: billingAccountId,
  commercial_contract_id: commercialContractId,
  external_customer_id: "cus_1",
  contracted_price_cents: 39000,
  contracted_currency: "BRL",
  recurrence_start_date: "2026-10-12",
  authorization_id: "22222222-2222-4222-8222-222222222222",
  authorization_provider_status: "INTENT",
  provider_contract_id: contractId,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockCreateSuccess() {
  return vi.fn(async () =>
    jsonResponse(200, {
      id: "auth_1",
      status: "CREATED",
      customerId: "cus_1",
      contractId,
      value: 390,
      payload: "00020126SECRET",
      encodedImage: "iVBORw0KGgo",
      immediateQrCode: { conciliationIdentifier: "ASAAS1", expirationDate: "2026-09-13 12:00:00" },
    }),
  );
}

describe("pixAutomaticExecution request authority", () => {
  it("accepts only action + operationId", () => {
    expect(
      parseExecutePixAutomaticRequest({
        action: EXECUTE_PIX_AUTOMATIC_ACTION,
        operationId,
      }),
    ).toEqual({ ok: true, operationId });
  });

  it("rejects browser/provider payload keys", () => {
    for (const key of ["customerId", "amount", "startDate", "environment", "frequency"]) {
      expect(
        parseExecutePixAutomaticRequest({
          action: EXECUTE_PIX_AUTOMATIC_ACTION,
          operationId,
          [key]: "injected",
        }),
      ).toEqual({ ok: false, error: "provider_payload_forbidden" });
    }
    expect(hasForbiddenProviderPayload({ customerId: "cus_x" })).toBe(true);
  });

  it("rejects non-uuid operation id and wrong action", () => {
    expect(
      parseExecutePixAutomaticRequest({ action: EXECUTE_PIX_AUTOMATIC_ACTION, operationId: "nope" }),
    ).toEqual({ ok: false, error: "operation_id_required" });
    expect(parseExecutePixAutomaticRequest({ action: "ensure_customer", operationId })).toEqual({
      ok: false,
      error: "invalid_action",
    });
  });

  it("intent uses DB facts only — caller amount/customer never enter the payload", () => {
    const intent = toEnsureIntent({
      operationId,
      operationType: "create_pix_automatic_authorization",
      operationStatus: "pending",
      provider: "asaas",
      environment: "sandbox",
      billingAccountId,
      commercialContractId,
      externalCustomerId: "cus_db",
      contractedPriceCents: 39000,
      recurrenceStartDate: "2026-10-12",
      actionable: true,
    });
    expect(intent).toEqual({
      billingAccountId,
      commercialContractId,
      externalCustomerId: "cus_db",
      contractedPriceCents: 39000,
      startDate: "2026-10-12",
    });
    expect(JSON.stringify(intent)).not.toContain("cus_browser");
    expect(intent.contractedPriceCents).not.toBe(1);
  });
});

describe("pixAutomaticExecution environment isolation", () => {
  it("sandbox op + sandbox config → sandbox URL", () => {
    expect(assertExecutionEnvironment("sandbox", "sandbox")).toEqual({
      ok: true,
      environment: "sandbox",
    });
    expect(expectedProviderBaseUrl("sandbox")).toBe(asaasBaseUrl("sandbox"));
    expect(expectedProviderBaseUrl("sandbox")).toBe("https://api-sandbox.asaas.com/v3");
  });

  it("production op + production config → production URL", () => {
    expect(assertExecutionEnvironment("production", "production")).toEqual({
      ok: true,
      environment: "production",
    });
    expect(expectedProviderBaseUrl("production")).toBe("https://api.asaas.com/v3");
  });

  it("rejects missing/invalid configured env and cross-env execution", () => {
    expect(assertExecutionEnvironment(undefined, "sandbox").ok).toBe(false);
    expect(assertExecutionEnvironment("prod", "sandbox").ok).toBe(false);
    expect(assertExecutionEnvironment("sandbox", "production")).toEqual({
      ok: false,
      error: "environment_mismatch",
    });
  });
});

describe("pixAutomaticExecution SQL loader contract", () => {
  it("parses the exact 05E0D1 JSON shape into ensure intent", () => {
    expect(Object.keys(prepared).sort()).toEqual([...SQL_LOADER_SUCCESS_KEYS].sort());
    const facts = parsePreparedFacts(prepared);
    expect(facts).toMatchObject({
      operationId,
      operationType: "create_pix_automatic_authorization",
      operationStatus: "pending",
      provider: "asaas",
      environment: "sandbox",
      billingAccountId,
      commercialContractId,
      externalCustomerId: "cus_1",
      contractedPriceCents: 39000,
      recurrenceStartDate: "2026-10-12",
      actionable: true,
      loadState: "actionable",
      contractedCurrency: "BRL",
      providerContractId: contractId,
    });
    expect(toEnsureIntent(facts!)).toEqual({
      billingAccountId,
      commercialContractId,
      externalCustomerId: "cus_1",
      contractedPriceCents: 39000,
      startDate: "2026-10-12",
    });
  });

  it("fail-closed on null, missing fields, invalid env/cents/uuid/date", async () => {
    expect(parsePreparedFacts(null)).toBeNull();
    expect(parsePreparedFacts({ ...prepared, environment: "prod" })).toBeNull();
    expect(parsePreparedFacts({ ...prepared, contracted_price_cents: 390.5 })).toBeNull();
    expect(parsePreparedFacts({ ...prepared, contracted_price_cents: -1 })).toBeNull();
    expect(parsePreparedFacts({ ...prepared, operation_id: "not-a-uuid" })).toBeNull();
    expect(parsePreparedFacts({ ...prepared, recurrence_start_date: "12/10/2026" })).toBeNull();
    expect(parsePreparedFacts({ ...prepared, contracted_currency: "USD" })).toBeNull();
    expect(parsePreparedFacts({ found: false, error: "operation_type_mismatch" })).toBeNull();

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const data of [null, { found: true }, { ...prepared, environment: "staging" }]) {
      const { adminClient } = makeAdminClient(async (name) => {
        if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data, error: null };
        throw new Error(`RPC inesperada: ${name}`);
      });
      const out = await executePreparedPixAutomaticAuthorization({
        adminClient: adminClient as never,
        configuredEnvironmentRaw: "sandbox",
        operationId,
        creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
      });
      expect(out.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it("maps structured SQL found=false errors without HTTP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { found: false, error: "operation_type_mismatch" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const loaded = await loadPreparedPixAutomaticAuthorization(adminClient as never, operationId);
    expect(loaded).toEqual({ ok: false, error: "operation_type_mismatch" });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out).toEqual({ ok: false, status: 409, body: { error: "operation_type_mismatch" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("pixAutomaticExecution auto-execution safety", () => {
  it("prepare and financial cron do not execute outbound provider work", () => {
    expect(PREPARE_DOES_NOT_EXECUTE_PROVIDER).toBe(true);
    expect(CRON_DOES_NOT_INVOKE_OUTBOUND).toBe(true);
    expect(CRON_JOB_NAME).toBe("vertexa-asaas-financial-drain");
    expect(PROBE_PIX_AUTOMATIC_READ_ACTION).toBe("probe_pix_automatic_read");
  });
});

describe("executePreparedPixAutomaticAuthorization", () => {
  it("success: one mocked POST, policy frozen, no QR payload persisted", async () => {
    const fetchSpy = mockCreateSuccess();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: prepared, error: null };
      }
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: operationId }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return {
          data: { outcome: "completed", provider_authorization_id: "auth_1", provider_status: "CREATED" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });

    expect(out).toEqual({
      ok: true,
      status: 200,
      body: {
        executed: true,
        operationId,
        providerAuthorizationId: "auth_1",
        providerStatus: "CREATED",
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/pix/automatic/authorizations");
    expect(fetchSpy.mock.calls[0][1]?.method).toBe("POST");
    const body = readSentBody(fetchSpy.mock.calls[0][1]);
    expect(body.frequency).toBe("MONTHLY");
    expect(body.paymentCreationMode).toBe("SUBSCRIPTION");
    expect(body.retryPolicy).toBe("ALLOW_THREE_IN_SEVEN_DAYS");
    expect(body.finishDate).toBeUndefined();
    expect(body.description).toBe("Vertexa - assinatura mensal");
    expect(body.value).toBe(390);
    expect(body.immediateQrCode).toEqual({ expirationSeconds: 3600, originalValue: 390 });
    expect(JSON.stringify(calls.find((c) => c.name.startsWith("complete"))?.params)).not.toContain("00020126");
  });

  it("customer prerequisite blocks POST", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { ...prepared, external_customer_id: null }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out).toEqual({ ok: false, status: 409, body: { error: "customer_not_provisioned" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects operation type spoofing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { ...prepared, operation_type: "create_subscription" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out.body).toEqual({ error: "operation_type_mismatch" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("repeat after completion is idempotent — 0 extra POST", async () => {
    const fetchSpy = mockCreateSuccess();
    vi.stubGlobal("fetch", fetchSpy);
    let reserves = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return {
          data: {
            ...prepared,
            operation_status: reserves === 0 ? "pending" : "completed",
            actionable: true,
          },
          error: null,
        };
      }
      if (name === "reserve_billing_outbound_operation") {
        reserves += 1;
        if (reserves === 1) return { data: { outcome: "reserved", operation_id: operationId }, error: null };
        return {
          data: { outcome: "already_completed", operation_id: operationId, external_object_id: "auth_1" },
          error: null,
        };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return {
          data: { outcome: "completed", provider_authorization_id: "auth_1", provider_status: "CREATED" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const first = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    const second = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("400 validation is deterministic — no second POST", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(400, { errors: [{ code: "invalid_object" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data: prepared, error: null };
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: operationId }, error: null };
      }
      if (name === "fail_billing_outbound_operation") return { data: { outcome: "failed" }, error: null };
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out).toEqual({ ok: false, status: 502, body: { error: "provider_rejected" } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("401/403 is provider auth failure without retry storm", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { errors: [{ code: "invalid_access_token" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data: prepared, error: null };
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: operationId }, error: null };
      }
      if (name === "fail_billing_outbound_operation") return { data: { outcome: "failed" }, error: null };
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out.body).toEqual({ error: "provider_rejected" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(out)).not.toMatch(/\$aact_|fake/);
  });

  it("429 and 5xx do not authorize a blind second create", async () => {
    for (const status of [429, 500]) {
      const fetchSpy = vi.fn(async () => jsonResponse(status, { errors: [{ code: "x" }] }));
      vi.stubGlobal("fetch", fetchSpy);
      const { adminClient } = makeAdminClient(async (name) => {
        if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data: prepared, error: null };
        if (name === "reserve_billing_outbound_operation") {
          return { data: { outcome: "reserved", operation_id: operationId }, error: null };
        }
        if (name === "fail_billing_outbound_operation") return { data: { outcome: "failed" }, error: null };
        throw new Error(`RPC inesperada: ${name}`);
      });
      const out = await executePreparedPixAutomaticAuthorization({
        adminClient: adminClient as never,
        configuredEnvironmentRaw: "sandbox",
        operationId,
        creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
      });
      expect(out.ok).toBe(false);
      expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
    }
  });

  it("timeout then lookup finds existing → complete, POST remains 1", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return jsonResponse(200, {
        data: [{ id: "auth_1", status: "CREATED", customerId: "cus_1", contractId, value: 390 }],
        hasMore: false,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    let reserves = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data: prepared, error: null };
      if (name === "reserve_billing_outbound_operation") {
        reserves += 1;
        if (reserves === 1) return { data: { outcome: "reserved", operation_id: operationId }, error: null };
        return {
          data: { outcome: "claimed_for_retry", operation_id: operationId, last_error_category: "network_timeout" },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation") return { data: { outcome: "failed" }, error: null };
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return {
          data: { outcome: "completed", provider_authorization_id: "auth_1", provider_status: "CREATED" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const first = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    const retry = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(first.body).toEqual({ error: "outcome_unknown_requires_reconciliation" });
    expect(retry.ok).toBe(true);
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("timeout then empty certain lookup stays blocked — no second POST", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return jsonResponse(200, { data: [], hasMore: false });
    });
    vi.stubGlobal("fetch", fetchSpy);
    let reserves = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data: prepared, error: null };
      if (name === "reserve_billing_outbound_operation") {
        reserves += 1;
        if (reserves === 1) return { data: { outcome: "reserved", operation_id: operationId }, error: null };
        return {
          data: { outcome: "claimed_for_retry", operation_id: operationId, last_error_category: "network_timeout" },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation") return { data: { outcome: "failed" }, error: null };
      throw new Error(`RPC inesperada: ${name}`);
    });
    await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    const retry = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(retry.body).toEqual({ error: "BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION" });
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("scan cap after unknown POST never assumes not_found", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return jsonResponse(200, {
        data: Array.from({ length: 100 }, () => ({
          id: "auth_other",
          contractId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          customerId: "cus_1",
          status: "CREATED",
        })),
        hasMore: true,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    let reserves = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) return { data: prepared, error: null };
      if (name === "reserve_billing_outbound_operation") {
        reserves += 1;
        if (reserves === 1) return { data: { outcome: "reserved", operation_id: operationId }, error: null };
        return {
          data: { outcome: "claimed_for_retry", operation_id: operationId, last_error_category: "network_timeout" },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation") return { data: { outcome: "failed" }, error: null };
      throw new Error(`RPC inesperada: ${name}`);
    });
    await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    const retry = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(retry.body).toEqual({ error: "reconciliation_lookup_failed" });
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("webhook-completed operation converges — execute after complete does 0 POST", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { ...prepared, operation_status: "completed", actionable: true }, error: null };
      }
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "already_completed", operation_id: operationId, external_object_id: "auth_webhook" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.body.providerAuthorizationId).toBe("auth_webhook");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing prepared operation is rejected without HTTP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { found: false }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out).toEqual({ ok: false, status: 404, body: { error: "operation_not_found" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sandbox config cannot execute a production prepared op", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { ...prepared, environment: "production" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const out = await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "sandbox",
      operationId,
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out).toEqual({ ok: false, status: 409, body: { error: "environment_mismatch" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("production prepared op uses production mock URL only", async () => {
    const fetchSpy = mockCreateSuccess();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === LOAD_PREPARED_PIX_AUTOMATIC_RPC) {
        return { data: { ...prepared, environment: "production" }, error: null };
      }
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: operationId }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return { data: { outcome: "completed", provider_authorization_id: "auth_1" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    await executePreparedPixAutomaticAuthorization({
      adminClient: adminClient as never,
      configuredEnvironmentRaw: "production",
      operationId,
      creds: { apiKey: "fake-production-key-never-real", baseUrl: "https://api.asaas.test/v3" },
    });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^https:\/\/api\.asaas\.test\/v3\//);
  });
});

describe("probePixAutomaticRead", () => {
  it("GET only, no reservation, no list items leaked", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { object: "list", totalCount: 0, data: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("probe não reserva outbound");
    });
    const out = await probePixAutomaticRead({
      configuredEnvironmentRaw: "sandbox",
      creds: { apiKey: "fake", baseUrl: "https://api-sandbox.asaas.test/v3" },
    });
    expect(out).toEqual({
      ok: true,
      status: 200,
      body: { reachable: true, empty: true, httpStatus: 200 },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]?.method).toBe("GET");
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/pix/automatic/authorizations?limit=1");
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain("cus_");
    void adminClient;
  });
});

describe("pixAutomaticExecution source contracts", () => {
  it("asaas-outbound keeps platform_admin before pix execute and skips get_or_create", () => {
    const src = readFileSync(resolve(here, "../../asaas-outbound/index.ts"), "utf8");
    const adminIdx = src.indexOf("am_i_platform_admin");
    const execIdx = src.indexOf("await executePreparedPixAutomaticAuthorization");
    const accountIdx = src.indexOf('rpc("get_or_create_billing_account"');
    expect(adminIdx).toBeGreaterThan(0);
    expect(execIdx).toBeGreaterThan(adminIdx);
    expect(accountIdx).toBeGreaterThan(execIdx);
    expect(src).toContain("if (!isAdmin)");
    expect(src).toContain("verify_jwt=true");
  });

  it("financial cron and prepare do not invoke outbound HTTP", () => {
    const cron = readFileSync(resolve(here, "./cronDrain.ts"), "utf8");
    expect(cron).not.toContain("asaas-outbound");
    expect(cron).not.toContain("pixAutomaticExecution");
    expect(cron).not.toContain("ensurePixAutomaticAuthorization");
    expect(cron).toContain("drainBillingEvents");

    const prepare = readFileSync(
      resolve(
        here,
        "../../../migrations/20260912233000_wp_asaas_05e0a_billing_profile_pix_multi_payment_foundation.sql",
      ),
      "utf8",
    );
    const start = prepare.indexOf("function private.billing_prepare_pix_automatic_authorization");
    const end = prepare.indexOf("comment on function private.billing_prepare_pix_automatic_authorization");
    const fn = prepare.slice(start, end);
    expect(fn).toContain("'http_blocked_reason', 'ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED'");
    expect(fn).not.toMatch(/pg_net|net\.http|http_post|http_get|asaasFetch/i);
    expect(fn).not.toContain("executePreparedPixAutomaticAuthorization");
  });
});
