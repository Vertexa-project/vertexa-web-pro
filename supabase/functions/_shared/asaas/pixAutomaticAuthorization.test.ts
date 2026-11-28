import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ensurePixAutomaticAuthorization,
  isPixAutomaticPreparedFirstWrite,
  isProviderWriteWindowClosed,
  PIX_AUTHORIZATION_RETRY_WINDOW_MS,
} from "./pixAutomaticAuthorization.ts";
import type { AsaasCredentials, AsaasEnvironment } from "./client.ts";
import { parseAsaasDateTime } from "./pixAutomatic.ts";
import { jsonResponse, makeAdminClient, readSentBody } from "./testHelpers.ts";

const creds: AsaasCredentials = {
  apiKey: "fake-sandbox-key-never-real",
  baseUrl: "https://api-sandbox.asaas.test",
};
const environment: AsaasEnvironment = "sandbox";
const billingAccountId = "11111111-1111-1111-1111-111111111111";
const commercialContractId = "550e8400-e29b-41d4-a716-446655440000";
const authorizationId = "33333333-3333-4333-8333-333333333333";
const contractId = "550e8400e29b41d4a716446655440000";
const attemptKey = `${billingAccountId}:create_pix_automatic_authorization:${authorizationId}`;
const attemptRef = `vtx:sandbox:${billingAccountId}:pix_automatic_authorization:${authorizationId}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function intent(externalCustomerId: string | null = "cus_1") {
  return {
    billingAccountId,
    commercialContractId,
    authorizationId,
    providerContractId: contractId,
    idempotencyKey: attemptKey,
    externalReference: attemptRef,
    externalCustomerId,
    contractedPriceCents: 39000,
    startDate: "2026-10-12",
  };
}

describe("isPixAutomaticPreparedFirstWrite", () => {
  it("CASE 1 marker: in_flight_retry attempt=2 null last_error null external id", () => {
    expect(
      isPixAutomaticPreparedFirstWrite({
        outcome: "in_flight_retry",
        operation_id: "op1",
        attempt_count: 2,
        last_error_category: null,
      }),
    ).toBe(true);
  });

  it("CASE 8/9/10/12: completed, reserved, claimed, or other types-equivalent states are not first-write", () => {
    expect(
      isPixAutomaticPreparedFirstWrite({
        outcome: "already_completed",
        operation_id: "op1",
        attempt_count: 2,
        external_object_id: "auth_1",
      }),
    ).toBe(false);
    expect(
      isPixAutomaticPreparedFirstWrite({
        outcome: "reserved",
        operation_id: "op1",
        attempt_count: 1,
      }),
    ).toBe(false);
    expect(
      isPixAutomaticPreparedFirstWrite({
        outcome: "claimed_for_retry",
        operation_id: "op1",
        attempt_count: 2,
        last_error_category: "http_4xx",
      }),
    ).toBe(false);
    expect(
      isPixAutomaticPreparedFirstWrite({
        outcome: "in_flight_retry",
        operation_id: "op1",
        attempt_count: 2,
        last_error_category: null,
        external_object_id: "auth_existing",
      }),
    ).toBe(false);
  });
});

describe("ensurePixAutomaticAuthorization", () => {
  it("does not POST without provider customer", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("não deveria reservar sem customer");
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(null),
    });
    expect(result).toEqual({ ok: false, errorCode: "customer_not_provisioned" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("first reserved attempt creates once and persists provider facts without QR payload", async () => {
    const fetchSpy = vi.fn(async () =>
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
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return {
          data: { outcome: "completed", provider_authorization_id: "auth_1", provider_status: "CREATED" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result).toEqual({
      ok: true,
      providerAuthorizationId: "auth_1",
      providerStatus: "CREATED",
      handoffKind: "fresh_create_with_qr",
      qrAvailable: true,
      immediateQrCode: {
        payload: "00020126SECRET",
        expirationDate: parseAsaasDateTime("2026-09-13 12:00:00"),
        encodedImage: "iVBORw0KGgo",
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]?.method).toBe("POST");
    const body = readSentBody(fetchSpy.mock.calls[0][1]);
    expect(body.customerId).toBe("cus_1");
    expect(body.value).toBe(390);
    expect(body.frequency).toBe("MONTHLY");
    expect(calls[1].params.p_conciliation_identifier).toBe("ASAAS1");
    expect(JSON.stringify(calls[1].params)).not.toContain("00020126");
    expect(JSON.stringify(calls[1].params)).not.toContain("iVBORw0KGgo");
  });

  it("fresh 200 with auth facts but missing payload completes safely — no fabricated QR, no second POST", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        id: "auth_1",
        status: "CREATED",
        customerId: "cus_1",
        contractId,
        value: 390,
        encodedImage: "iVBORw0KGgo",
        immediateQrCode: { conciliationIdentifier: "ASAAS1", expirationDate: "2026-09-13 12:00:00" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return {
          data: { outcome: "completed", provider_authorization_id: "auth_1", provider_status: "CREATED" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result).toEqual({
      ok: true,
      providerAuthorizationId: "auth_1",
      providerStatus: "CREATED",
      handoffKind: "fresh_create_qr_unavailable",
      qrAvailable: false,
      qrUnavailableReason: "provider_qr_payload_missing",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(calls[1].params)).not.toContain("iVBORw0KGgo");
  });

  it("HARD GATE: timeout then lookup finds existing → complete, POST count remains 1", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return jsonResponse(200, {
        data: [{ id: "auth_1", status: "CREATED", customerId: "cus_1", contractId, value: 390 }],
        hasMore: false,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    let reserveCalls = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        reserveCalls += 1;
        if (reserveCalls === 1) {
          return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
        }
        return {
          data: {
            outcome: "claimed_for_retry",
            operation_id: "op1",
            last_error_category: "network_timeout",
          },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation" || name === "fail_billing_outbound_operation_after_unknown_write") {
        return { data: { outcome: "failed" }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return {
          data: { outcome: "completed", provider_authorization_id: "auth_1", provider_status: "CREATED" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const first = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(first).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });

    const second = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(second).toEqual({
      ok: true,
      providerAuthorizationId: "auth_1",
      providerStatus: "CREATED",
      handoffKind: "reconciled_existing_without_qr",
      qrAvailable: false,
      qrUnavailableReason: "provider_create_response_not_available",
    });
    expect(JSON.stringify(second)).not.toContain("00020126");
    const posts = fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST");
    expect(posts).toHaveLength(1);
  });

  it("HARD GATE: timeout then lookup empty → BLOCKED, zero second POST", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return jsonResponse(200, { data: [], hasMore: false });
    });
    vi.stubGlobal("fetch", fetchSpy);
    let reserveCalls = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        reserveCalls += 1;
        if (reserveCalls === 1) {
          return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
        }
        return {
          data: {
            outcome: "claimed_for_retry",
            operation_id: "op1",
            last_error_category: "network_timeout",
          },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation" || name === "fail_billing_outbound_operation_after_unknown_write") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    const retry = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(retry.errorCode).toBe("BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION");
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("scan cap after unknown POST stays blocked and never POSTs again", async () => {
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
    let reserveCalls = 0;
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        reserveCalls += 1;
        if (reserveCalls === 1) {
          return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
        }
        return {
          data: {
            outcome: "claimed_for_retry",
            operation_id: "op1",
            last_error_category: "network_timeout",
          },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation" || name === "fail_billing_outbound_operation_after_unknown_write") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    const retry = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(retry.errorCode).toBe("reconciliation_lookup_failed");
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("already_completed returns existing id with zero HTTP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "already_completed", operation_id: "op1", external_object_id: "auth_1" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result).toEqual({
      ok: true,
      providerAuthorizationId: "auth_1",
      handoffKind: "already_completed_without_qr",
      qrAvailable: false,
      qrUnavailableReason: "already_completed",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the supplied credentials base URL (sandbox vs production mocks)", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { id: "auth_1", status: "CREATED", customerId: "cus_1", contractId }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return { data: { outcome: "completed", provider_authorization_id: "auth_1" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const prodCreds = { apiKey: "fake-production-key-never-real", baseUrl: "https://api.asaas.test/v3" };
    await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment: "production",
      creds: prodCreds,
      intent: intent(),
    });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^https:\/\/api\.asaas\.test\/v3\//);
  });

  it("CASE 1: prepared in_flight_retry attempt=2 last_error null wins first-write and POSTs once", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        id: "auth_1",
        status: "CREATED",
        customerId: "cus_1",
        contractId,
        value: 390,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: {
            outcome: "in_flight_retry",
            operation_id: "op1",
            attempt_count: 2,
            last_error_category: null,
          },
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
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result.ok).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("CASE 2/11 + PREPARE-stolen token: attempt=3 last_error null does not POST", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [], hasMore: false }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: {
            outcome: "in_flight_retry",
            operation_id: "op1",
            attempt_count: 3,
            last_error_category: null,
          },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result).toEqual({ ok: false, errorCode: "BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION" });
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(0);
  });

  it("CASE 3: already reserved in-flight attempt>=2 with unknown last_error never POSTs", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [], hasMore: false }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: {
            outcome: "in_flight_retry",
            operation_id: "op1",
            attempt_count: 2,
            last_error_category: "network_timeout",
          },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result.errorCode).toBe("BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION");
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(0);
  });

  it("CASE 5: lookup multiple matches blocks with zero CREATE", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        data: [
          { id: "auth_a", status: "CREATED", customerId: "cus_1", contractId },
          { id: "auth_b", status: "CREATED", customerId: "cus_1", contractId },
        ],
        hasMore: false,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: {
            outcome: "claimed_for_retry",
            operation_id: "op1",
            attempt_count: 3,
            last_error_category: "network_timeout",
          },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation" || name === "fail_billing_outbound_operation_after_unknown_write") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result.errorCode).toBe("reconciliation_ambiguous_multiple");
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(0);
  });

  it("CASE 9/10: pending row with external_object_id is not first-write", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [], hasMore: false }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: {
            outcome: "in_flight_retry",
            operation_id: "op1",
            attempt_count: 2,
            last_error_category: null,
            external_object_id: "auth_existing",
          },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result.ok).toBe(false);
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(0);
  });

  it("CASE 7: deterministic 4xx on first-write fails the operation and does not retry POST", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(400, { errors: [{ code: "invalid" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: {
            outcome: "in_flight_retry",
            operation_id: "op1",
            attempt_count: 2,
            last_error_category: null,
          },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation" || name === "fail_billing_outbound_operation_after_unknown_write") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result).toEqual({ ok: false, errorCode: "provider_rejected" });
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("refuses to execute without persisted authorization correlation", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("não deveria reservar sem correlação");
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: {
        ...intent(),
        providerContractId: "",
        idempotencyKey: "",
        externalReference: "",
      },
    });
    expect(result).toEqual({ ok: false, errorCode: "authorization_correlation_missing" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("reserves the attempt key, not the historical primary commercial-contract key", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        id: "auth_2",
        status: "CREATED",
        customerId: "cus_1",
        contractId,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op2" }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return { data: { outcome: "completed", provider_authorization_id: "auth_2" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(calls[0].params.p_idempotency_key).toBe(attemptKey);
    expect(calls[0].params.p_external_reference).toBe(attemptRef);
    expect(String(calls[0].params.p_idempotency_key)).not.toContain(":primary:");
  });

  it("completed historical key cannot be reused as authorization #2", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "already_completed", operation_id: "op1", external_object_id: "auth_1" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    const result = await ensurePixAutomaticAuthorization({
      adminClient: adminClient as never,
      environment,
      creds,
      intent: intent(),
    });
    expect(result.handoffKind).toBe("already_completed_without_qr");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("saída depois de timeout do Asaas (cartão 1568, D108)", () => {
  const qrBody = {
    id: "auth_2",
    status: "CREATED",
    customerId: "cus_1",
    contractId,
    value: 390,
    payload: "00020126QR2",
    encodedImage: "iVBORw0KGgoQR2",
    immediateQrCode: { conciliationIdentifier: "ASAAS2", expirationDate: "2026-11-28 12:00:00" },
  };

  function adminFor(reserveSecond: Record<string, unknown>) {
    let reserveCalls = 0;
    return makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        reserveCalls += 1;
        if (reserveCalls === 1) return { data: { outcome: "reserved", operation_id: "op1" }, error: null };
        return { data: { operation_id: "op1", ...reserveSecond }, error: null };
      }
      if (name === "fail_billing_outbound_operation" || name === "fail_billing_outbound_operation_after_unknown_write") {
        return { data: { outcome: "failed" }, error: null };
      }
      if (name === "complete_billing_pix_automatic_authorization_operation") {
        return { data: { outcome: "completed", provider_authorization_id: "auth_2", provider_status: "CREATED" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
  }

  function timeoutThenQrFetch() {
    let posts = 0;
    return vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts += 1;
        if (posts === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        return jsonResponse(200, qrBody);
      }
      return jsonResponse(200, { data: [], hasMore: false });
    });
  }

  const longAgo = () => new Date(Date.now() - PIX_AUTHORIZATION_RETRY_WINDOW_MS - 1000).toISOString();
  const justNow = () => new Date(Date.now() - 30_000).toISOString();

  it("timeout marca a janela da escrita incerta com a RPC própria", async () => {
    vi.stubGlobal("fetch", timeoutThenQrFetch());
    const { adminClient, calls } = adminFor({});
    const first = await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    expect(first.errorCode).toBe("outcome_unknown_requires_reconciliation");
    const names = calls.map((c) => c.name);
    expect(names).toContain("fail_billing_outbound_operation_after_unknown_write");
    expect(names).not.toContain("fail_billing_outbound_operation");
  });

  it("passado o intervalo e sem nada no Asaas, tenta de novo uma vez e devolve o QR", async () => {
    const fetchSpy = timeoutThenQrFetch();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = adminFor({
      outcome: "claimed_for_retry",
      attempt_count: 3,
      last_error_category: "network_timeout",
      provider_write_window_at: longAgo(),
    });
    await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    const retry = await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    expect(retry.ok).toBe(true);
    expect(retry.handoffKind).toBe("fresh_create_with_qr");
    expect(retry.immediateQrCode?.payload).toBe("00020126QR2");
    const methods = fetchSpy.mock.calls.map((c) => c[1]?.method ?? "GET");
    expect(methods).toEqual(["POST", "GET", "POST"]);
  });

  it("dentro do intervalo não posta de novo e devolve a operação a falhou com a mesma causa", async () => {
    const fetchSpy = timeoutThenQrFetch();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = adminFor({
      outcome: "claimed_for_retry",
      attempt_count: 3,
      last_error_category: "network_timeout",
      provider_write_window_at: justNow(),
    });
    await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    const retry = await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    expect(retry.errorCode).toBe("BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION");
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
    const refail = calls.filter((c) => c.name === "fail_billing_outbound_operation");
    expect(refail).toHaveLength(1);
    expect((refail[0].params as { p_error_category: string }).p_error_category).toBe("network_timeout");
  });

  it("linha pendente recente (outra tentativa em voo) não posta nem mexe na operação", async () => {
    const fetchSpy = timeoutThenQrFetch();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = adminFor({
      outcome: "in_flight_retry",
      attempt_count: 3,
      last_error_category: null,
      provider_write_window_at: justNow(),
    });
    await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    const before = calls.length;
    const retry = await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    expect(retry.errorCode).toBe("BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION");
    expect(fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "POST")).toHaveLength(1);
    expect(calls.slice(before).map((c) => c.name)).toEqual(["reserve_billing_outbound_operation"]);
  });

  it("passado o intervalo, se o Asaas mostra a autorização, reconcilia sem novo POST", async () => {
    let posts = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts += 1;
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return jsonResponse(200, { data: [{ id: "auth_2", status: "CREATED", customerId: "cus_1", contractId, value: 390 }], hasMore: false });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = adminFor({
      outcome: "claimed_for_retry",
      attempt_count: 3,
      last_error_category: "network_timeout",
      provider_write_window_at: longAgo(),
    });
    await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    const retry = await ensurePixAutomaticAuthorization({ adminClient: adminClient as never, environment, creds, intent: intent() });
    expect(retry.handoffKind).toBe("reconciled_existing_without_qr");
    expect(posts).toBe(1);
  });

  it("isProviderWriteWindowClosed: sem data ou data inválida mantém fechado o novo POST", () => {
    const now = Date.parse("2026-11-28T12:00:00Z");
    expect(isProviderWriteWindowClosed(null, now)).toBe(false);
    expect(isProviderWriteWindowClosed("lixo", now)).toBe(false);
    expect(isProviderWriteWindowClosed("2026-11-28T11:58:00Z", now)).toBe(false);
    expect(isProviderWriteWindowClosed("2026-11-28T11:57:00Z", now)).toBe(true);
  });
});
