// WP-ASAAS-04 — A04-25..A04-38: processor idempotente (processor.ts).
// Roda sob Vitest/Node — mesma base dos demais testes asaas (fetch mockado + adminClient fake).
import { describe, it, expect, afterEach, vi } from "vitest";
import { drainBillingEvents } from "./processor.ts";
import type { AsaasCredentials, AsaasEnvironment } from "./client.ts";
import { jsonResponse, makeAdminClient, type RpcCall } from "./testHelpers.ts";

const creds: AsaasCredentials = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };
const environment: AsaasEnvironment = "sandbox";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface ClaimedEvent {
  id: string;
  external_event_id: string;
  event_type: string;
  event_created_at: string | null;
  external_resource_type: string | null;
  external_resource_id: string | null;
  environment: string;
  attempts: number;
  provider_facts?: Record<string, unknown> | null;
}

function makeEvent(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    external_event_id: "evt_1",
    event_type: "PAYMENT_RECEIVED",
    event_created_at: "2026-09-10T11:43:00Z",
    external_resource_type: "payment",
    external_resource_id: "pay_1",
    environment: "sandbox",
    attempts: 1,
    ...overrides,
  };
}

interface Cfg {
  events: ClaimedEvent[];
  resolve?: unknown;
  resolveError?: unknown;
  resolvePix?: unknown | ((params: Record<string, unknown>) => unknown);
  resolvePixError?: unknown;
  apply?: unknown;
  applyError?: unknown;
  applyPix?: unknown;
  applyPixError?: unknown;
  missing?: unknown;
  missingError?: unknown;
  applyAuth?: unknown;
  applyAuthError?: unknown;
  applyEligibility?: unknown;
  applyInstruction?: unknown;
  fallback?: unknown;
  fallbackError?: unknown;
}

function makeClient(cfg: Cfg) {
  return makeAdminClient(async (name, params) => {
    switch (name) {
      case "claim_billing_provider_events":
        return { data: cfg.events, error: null };
      case "resolve_billing_target_by_subscription":
        return { data: cfg.resolve ?? null, error: cfg.resolveError ?? null };
      case "resolve_billing_target_by_pix_automatic_payment":
        return {
          data: typeof cfg.resolvePix === "function"
            ? cfg.resolvePix(params)
            : (cfg.resolvePix ?? { found: false }),
          error: cfg.resolvePixError ?? null,
        };
      case "apply_billing_payment_snapshot":
        return { data: cfg.apply ?? null, error: cfg.applyError ?? null };
      case "apply_hosted_card_payment_with_checkout_fallback":
        return { data: cfg.fallback ?? null, error: cfg.fallbackError ?? null };
      case "apply_billing_pix_automatic_payment_snapshot":
        return { data: cfg.applyPix ?? null, error: cfg.applyPixError ?? null };
      case "handle_missing_payment_on_get":
        return { data: cfg.missing ?? null, error: cfg.missingError ?? null };
      case "apply_billing_pix_automatic_authorization_event":
        return { data: cfg.applyAuth ?? { outcome: "applied" }, error: cfg.applyAuthError ?? null };
      case "apply_billing_pix_automatic_eligibility_event":
        return { data: cfg.applyEligibility ?? { outcome: "applied" }, error: null };
      case "apply_billing_pix_automatic_instruction_event":
        return { data: cfg.applyInstruction ?? { outcome: "applied", financial_authority: "PAYMENT_EVENTS" }, error: null };
      case "ignore_billing_provider_event":
        return { data: { outcome: "ignored" }, error: null };
      case "fail_billing_provider_event":
        return { data: { outcome: "failed" }, error: null };
      default:
        throw new Error(`RPC inesperada: ${name}`);
    }
  });
}

function status(code: number, body: unknown = "") {
  const init: ResponseInit = body === "" ? { status: code } : { status: code, headers: { "content-type": "application/json" } };
  return new Response(body === "" ? "" : JSON.stringify(body), init);
}

async function run(cfg: Cfg, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchSpy = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchSpy);
  const { adminClient, calls } = makeClient(cfg);
  const result = await drainBillingEvents({ adminClient: adminClient as never, environment, creds, limit: 10 });
  return { result, calls, fetchSpy };
}

function findCall(calls: RpcCall[], name: string): RpcCall | undefined {
  return calls.find((c) => c.name === name);
}
function names(calls: RpcCall[]): string[] {
  return calls.map((c) => c.name);
}

describe("drainBillingEvents", () => {
  it("A04-25: evento não-PAYMENT -> ignored unsupported_event, ZERO fetch", async () => {
    const { result, calls, fetchSpy } = await run(
      { events: [makeEvent({ event_type: "SUBSCRIPTION_UPDATED", external_resource_type: null, external_resource_id: null })] },
      async () => jsonResponse(200, {}),
    );
    expect(result.ignored).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("unsupported_event");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("A04-26: PAYMENT_* sem external_resource_id -> ignored missing_resource_id, ZERO fetch", async () => {
    const { result, calls, fetchSpy } = await run(
      { events: [makeEvent({ external_resource_id: null })] },
      async () => jsonResponse(200, {}),
    );
    expect(result.ignored).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("missing_resource_id");
  });

  it("A04-27: happy path (GET+subscription+correlação+customer match) -> processed, apply chamado com centavos exatos", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolve: { found: true, external_customer_id: "cus_1" },
        apply: { outcome: "applied", billing_payment_id: "bp_1" },
      },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", subscription: "sub_1", status: "RECEIVED", value: 10 }),
    );
    expect(result.processed).toBe(1);
    const apply = findCall(calls, "apply_billing_payment_snapshot");
    expect(apply?.params.p_external_payment_id).toBe("pay_1");
    expect(apply?.params.p_financial_state).toBe("received");
    expect(apply?.params.p_value_cents).toBe(1000);
    expect(apply?.params.p_external_subscription_id).toBe("sub_1");
    expect(apply?.params.p_external_customer_id).toBe("cus_1");
  });

  it("A04-28: subscription-only — payment SEM subscription -> ignored_non_subscription_payment, ZERO apply, ZERO resolve", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()] },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 10 }),
    );
    expect(result.ignored).toBe(1);
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("ignored_non_subscription_payment");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
    expect(names(calls)).not.toContain("resolve_billing_target_by_subscription");
  });

  it("A04-29: subscription não gerenciada pelo Vertexa (found=false) -> ignored_unmanaged_resource, ZERO apply", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolve: { found: false } },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", subscription: "sub_x", status: "RECEIVED", value: 10 }),
    );
    expect(result.ignored).toBe(1);
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("ignored_unmanaged_resource");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("R7: PAYMENT_CONFIRMED without a local subscription binds only through the authoritative checkout session", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent({ event_type: "PAYMENT_CONFIRMED" })],
        resolve: { found: false },
        fallback: { outcome: "applied", fallback: "checkout_session" },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        subscription: "sub_1",
        checkoutSession: "checkout_1",
        status: "CONFIRMED",
        value: 390,
      }),
    );
    expect(result.processed).toBe(1);
    const fallback = findCall(calls, "apply_hosted_card_payment_with_checkout_fallback");
    expect(fallback?.params).toMatchObject({
      p_provider_checkout_id: "checkout_1",
      p_external_subscription_id: "sub_1",
      p_financial_state: "confirmed",
      p_environment: "sandbox",
    });
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("R7: missing checkoutSession remains unmanaged and creates no fallback or financial apply", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolve: { found: false } },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", subscription: "sub_1", status: "CONFIRMED", value: 390 }),
    );
    expect(result.ignored).toBe(1);
    expect(names(calls)).not.toContain("apply_hosted_card_payment_with_checkout_fallback");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("R7: conflicting checkout-session correlation fails closed without a financial apply", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolve: { found: false },
        fallback: { outcome: "provider_subscription_conflict" },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        subscription: "sub_conflict",
        checkoutSession: "checkout_conflict",
        status: "CONFIRMED",
        value: 390,
      }),
    );
    expect(result.failed).toBe(1);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_error_category).toBe("provider_subscription_conflict");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("A04-30: customer mismatch -> failed customer_mismatch NON-retryable (backoff 0), ZERO apply", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolve: { found: true, external_customer_id: "cus_1" } },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_OUTRO", subscription: "sub_1", status: "RECEIVED", value: 10 }),
    );
    expect(result.failed).toBe(1);
    const fail = findCall(calls, "fail_billing_provider_event");
    expect(fail?.params.p_error_category).toBe("customer_mismatch");
    expect(fail?.params.p_retryable).toBe(false);
    expect(fail?.params.p_backoff_seconds).toBe(0);
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("A04-31: GET 404 sem billing_payment prévio -> handle_missing -> ignored_unmanaged_resource", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], missing: { outcome: "ignored", reason: "ignored_unmanaged_resource" } },
      async () => status(404, { errors: [{ code: "not_found" }] }),
    );
    expect(result.ignored).toBe(1);
    const missing = findCall(calls, "handle_missing_payment_on_get");
    expect(missing?.params.p_external_payment_id).toBe("pay_1");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("A04-32: GET 404 + PAYMENT_DELETED + managed -> handle_missing -> voided", async () => {
    const { result, calls } = await run(
      { events: [makeEvent({ event_type: "PAYMENT_DELETED" })], missing: { outcome: "voided" } },
      async () => status(404, { errors: [{ code: "not_found" }] }),
    );
    expect(result.voided).toBe(1);
    expect(findCall(calls, "handle_missing_payment_on_get")?.params.p_event_type).toBe("PAYMENT_DELETED");
  });

  it("A04-33: GET 404 + managed sem PAYMENT_DELETED -> handle_missing -> failed requires_review (fail closed)", async () => {
    const { result } = await run(
      { events: [makeEvent()], missing: { outcome: "failed", reason: "provider_resource_not_found_requires_review" } },
      async () => status(404, { errors: [{ code: "not_found" }] }),
    );
    expect(result.failed).toBe(1);
    expect(result.outcomes[0].category).toBe("provider_resource_not_found_requires_review");
  });

  it("A04-34: GET 401 -> failed provider_auth_error NON-retryable (config)", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()] },
      async () => status(401, { errors: [{ code: "unauthorized" }] }),
    );
    expect(result.failed).toBe(1);
    const fail = findCall(calls, "fail_billing_provider_event");
    expect(fail?.params.p_error_category).toBe("provider_auth_error");
    expect(fail?.params.p_retryable).toBe(false);
    expect(fail?.params.p_backoff_seconds).toBe(0);
    expect(names(calls)).not.toContain("handle_missing_payment_on_get");
  });

  it("A04-35: GET 429 -> failed rate_limited RETRYABLE com backoff > 0", async () => {
    const { result, calls } = await run({ events: [makeEvent()] }, async () => status(429));
    expect(result.failed).toBe(1);
    const fail = findCall(calls, "fail_billing_provider_event");
    expect(fail?.params.p_error_category).toBe("rate_limited");
    expect(fail?.params.p_retryable).toBe(true);
    expect(fail?.params.p_backoff_seconds as number).toBeGreaterThan(0);
  });

  it("A04-36: GET 5xx -> failed provider_5xx RETRYABLE com backoff > 0", async () => {
    const { result, calls } = await run({ events: [makeEvent()] }, async () => status(500));
    expect(result.failed).toBe(1);
    const fail = findCall(calls, "fail_billing_provider_event");
    expect(fail?.params.p_error_category).toBe("provider_5xx");
    expect(fail?.params.p_retryable).toBe(true);
    expect(fail?.params.p_backoff_seconds as number).toBeGreaterThan(0);
  });

  it("A04-37: drain agrega múltiplos; PAYMENT_* subtype desconhecido com correlação válida ainda é aplicado (forward-compat)", async () => {
    const events = [
      makeEvent({ id: "aaaaaaaa-0000-0000-0000-000000000001", external_event_id: "evt_a", event_type: "PAYMENT_SOMETHING_NEW", external_resource_id: "pay_1" }),
      makeEvent({ id: "bbbbbbbb-0000-0000-0000-000000000002", external_event_id: "evt_b", event_type: "SUBSCRIPTION_DELETED", external_resource_type: null, external_resource_id: null }),
    ];
    const { result, calls } = await run(
      { events, resolve: { found: true, external_customer_id: "cus_1" }, apply: { outcome: "applied", billing_payment_id: "bp_1" } },
      async (url) => {
        if (String(url).includes("/payments/pay_1")) {
          return jsonResponse(200, { id: "pay_1", customer: "cus_1", subscription: "sub_1", status: "CONFIRMED", value: 10 });
        }
        return jsonResponse(200, {});
      },
    );
    expect(result.claimed).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.ignored).toBe(1);
    // O subtype desconhecido foi materializado a partir do GET (financial_state=confirmed), não pelo tipo do evento.
    expect(findCall(calls, "apply_billing_payment_snapshot")?.params.p_financial_state).toBe("confirmed");
  });

  it("A04-38: GET success com value inválido -> failed value_not_exact_cents NON-retryable, ZERO apply", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolve: { found: true, external_customer_id: "cus_1" } },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", subscription: "sub_1", status: "RECEIVED", value: 10.005 }),
    );
    expect(result.failed).toBe(1);
    const fail = findCall(calls, "fail_billing_provider_event");
    expect(fail?.params.p_error_category).toBe("value_not_exact_cents");
    expect(fail?.params.p_retryable).toBe(false);
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });
});

describe("drainBillingEvents — Pix Automatic", () => {
  function authEvent(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
    return makeEvent({
      event_type: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED",
      external_resource_type: "pix_automatic_authorization",
      external_resource_id: "auth_1",
      provider_facts: {
        providerAuthorizationId: "auth_1",
        providerStatus: "CREATED",
        providerCustomerId: "cus_1",
        providerContractId: "550e8400e29b41d4a716446655440000",
      },
      ...overrides,
    });
  }

  it("CREATED GET success → apply authorization, not payment snapshot", async () => {
    const { result, calls } = await run(
      { events: [authEvent()], applyAuth: { outcome: "applied", commercial_mutated: false } },
      async () =>
        jsonResponse(200, {
          id: "auth_1",
          status: "CREATED",
          customerId: "cus_1",
          contractId: "550e8400e29b41d4a716446655440000",
          value: 390,
          unexpected: true,
        }),
    );
    expect(result.processed).toBe(1);
    expect(names(calls)).toContain("apply_billing_pix_automatic_authorization_event");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("unknown PIX_AUTOMATIC event → ignored unsupported, does not crash batch", async () => {
    const { result, fetchSpy } = await run(
      {
        events: [
          makeEvent({
            event_type: "PIX_AUTOMATIC_SOMETHING_NEW",
            external_resource_type: null,
            external_resource_id: null,
          }),
          makeEvent(),
        ],
        resolve: { found: true, external_customer_id: "cus_1" },
        apply: { outcome: "applied" },
      },
      async (url) => {
        if (String(url).includes("/payments/")) {
          return jsonResponse(200, {
            id: "pay_1",
            customer: "cus_1",
            subscription: "sub_1",
            status: "RECEIVED",
            value: 10,
          });
        }
        return jsonResponse(200, {});
      },
    );
    expect(result.ignored).toBe(1);
    expect(result.processed).toBe(1);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/payments/pay_1"))).toBe(true);
  });

  it("eligibility uses sanitized facts and never GETs a charge", async () => {
    const { result, calls, fetchSpy } = await run(
      {
        events: [
          makeEvent({
            event_type: "PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED",
            external_resource_type: "pix_automatic_eligibility",
            external_resource_id: "acc_1",
            provider_facts: { eligibilityStatus: "ELIGIBLE", providerAccountId: "acc_1" },
          }),
        ],
        applyEligibility: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, {}),
    );
    expect(result.processed).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findCall(calls, "apply_billing_pix_automatic_eligibility_event")?.params.p_status).toBe("ELIGIBLE");
  });

  it("instruction GET success applies one row and keeps PAYMENT_* as financial authority", async () => {
    const { result, calls } = await run(
      {
        events: [
          makeEvent({
            event_type: "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED",
            external_resource_type: "pix_automatic_payment_instruction",
            external_resource_id: "inst_1",
          }),
        ],
        applyInstruction: { outcome: "applied", financial_authority: "PAYMENT_EVENTS" },
      },
      async () =>
        jsonResponse(200, {
          id: "inst_1",
          status: "SCHEDULED",
          dueDate: "2026-10-04",
          payment: "pay_1",
          authorization: { id: "auth_1" },
        }),
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_instruction_event")?.params.p_provider_payment_id).toBe("pay_1");
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
  });

  it("05F1: initial Pix Automatic PAYMENT_RECEIVED without subscription is ingested", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          pix_instruction_id: null,
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false, financial_state: "received" },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        status: "RECEIVED",
        value: 390,
        billingType: "PIX",
        paymentDate: "2026-09-19",
        confirmedDate: "2026-09-19",
        authorization: { id: "auth_2" },
      }),
    );
    expect(result.processed).toBe(1);
    const apply = findCall(calls, "apply_billing_pix_automatic_payment_snapshot");
    expect(apply?.params.p_value_cents).toBe(39000);
    expect(apply?.params.p_financial_state).toBe("received");
    expect(apply?.params.p_pix_authorization_id).toBe("9377b65a-ceb5-4e47-8bd2-c8b505a10472");
    expect(apply?.params.p_pix_instruction_id).toBeNull();
    expect(names(calls)).not.toContain("apply_billing_payment_snapshot");
    expect(findCall(calls, "ignore_billing_provider_event")).toBeUndefined();
  });

  it("05F1: PAYMENT_CREATED then same payment stays one apply path", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent({ event_type: "PAYMENT_CREATED" })],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 390 }),
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_external_payment_id).toBe("pay_1");
  });

  it("05F1: future instruction payment correlates even with unmanaged subscription", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent({ external_resource_id: "pay_future" })],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          pix_instruction_id: "inst_oct",
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, {
        id: "pay_future",
        customer: "cus_1",
        subscription: "sub_x",
        status: "PENDING",
        value: 390,
        dueDate: "2026-10-18",
      }),
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_instruction_id).toBe("inst_oct");
    expect(names(calls)).not.toContain("resolve_billing_target_by_subscription");
  });

  it("05F1: unrelated unmanaged payment remains ignored_non_subscription_payment", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolvePix: { found: false } },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 10 }),
    );
    expect(result.ignored).toBe(1);
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("ignored_non_subscription_payment");
    expect(names(calls)).not.toContain("apply_billing_pix_automatic_payment_snapshot");
  });

  it("05F1: RECEIVED pix payment does not treat apply as entitlement", async () => {
    const { calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 390 }),
    );
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")).toBeTruthy();
    expect(findCall(calls, "apply_billing_pix_automatic_eligibility_event")).toBeUndefined();
  });

  it("05F1-R3: customer inequality does not reject conciliation-correlated initial QR", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          pix_instruction_id: null,
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_OUTRO", status: "RECEIVED", value: 390 }),
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")).toBeTruthy();
    expect(findCall(calls, "fail_billing_provider_event")).toBeUndefined();
  });

  it("05F1-R1: initial payment correlates by conciliationIdentifier to #2 only", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: (params) => {
          expect(params.p_conciliation_identifier).toBe("ASAAS-CONCIL-2");
          expect(params.p_environment).toBe("sandbox");
          if (params.p_conciliation_identifier === "ASAAS-CONCIL-2") {
            return {
              found: true,
              pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
              pix_instruction_id: null,
              external_customer_id: "cus_1",
            };
          }
          return { found: false };
        },
        applyPix: { outcome: "applied", entitlement_granted: false, financial_state: "received" },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        status: "RECEIVED",
        value: 390,
        conciliationIdentifier: "ASAAS-CONCIL-2",
      }),
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_authorization_id)
      .toBe("9377b65a-ceb5-4e47-8bd2-c8b505a10472");
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_instruction_id).toBeNull();
  });

  it("05F1-R1: wrong conciliation fails closed without financial apply", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: { found: false, reason: "conciliation_unmatched" },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        status: "RECEIVED",
        value: 390,
        conciliationIdentifier: "ASAAS-WRONG",
      }),
    );
    expect(result.failed).toBe(1);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_error_category).toBe("conciliation_unmatched");
    expect(names(calls)).not.toContain("apply_billing_pix_automatic_payment_snapshot");
  });

  it("05F1-R1: missing deterministic id with two candidate authorizations does not guess", async () => {
    const { result, calls, fetchSpy } = await run(
      { events: [makeEvent()], resolvePix: { found: false } },
      async (url) => {
        if (String(url).includes("/pix/automatic/paymentInstructions")) {
          return jsonResponse(200, { data: [], hasMore: false });
        }
        return jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 390 });
      },
    );
    expect(result.ignored).toBe(1);
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("ignored_non_subscription_payment");
    expect(names(calls)).not.toContain("apply_billing_pix_automatic_payment_snapshot");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("paymentId=pay_1"))).toBe(true);
  });

  it("05F1-R1: delayed instruction resolves from provider list by paymentId", async () => {
    const { result, calls, fetchSpy } = await run(
      {
        events: [makeEvent({ event_type: "PAYMENT_CREATED", external_resource_id: "pay_future" })],
        resolvePix: (params) => {
          if (params.p_provider_authorization_id === "auth_2") {
            return {
              found: true,
              pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
              pix_instruction_id: null,
              external_customer_id: "cus_1",
            };
          }
          return { found: false };
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async (url) => {
        if (String(url).includes("/pix/automatic/paymentInstructions")) {
          return jsonResponse(200, {
            data: [{
              id: "instr_1",
              status: "AWAITING_REQUEST",
              paymentId: "pay_future",
              authorization: { id: "auth_2" },
              dueDate: "2026-10-18",
            }],
            hasMore: false,
          });
        }
        return jsonResponse(200, {
          id: "pay_future",
          customer: "cus_1",
          subscription: "sub_generated",
          status: "PENDING",
          value: 390,
          dueDate: "2026-10-18",
        });
      },
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_authorization_id)
      .toBe("9377b65a-ceb5-4e47-8bd2-c8b505a10472");
    expect(names(calls)).not.toContain("resolve_billing_target_by_subscription");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("paymentId=pay_future"))).toBe(true);
  });

  it("05F1-R1: instruction lookup failure is retryable, not permanently ignored", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolvePix: { found: false } },
      async (url) => {
        if (String(url).includes("/pix/automatic/paymentInstructions")) {
          return status(500, { errors: [{ code: "error", description: "down" }] });
        }
        return jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 390 });
      },
    );
    expect(result.failed).toBe(1);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_retryable).toBe(true);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_error_category)
      .toBe("pix_automatic_instruction_lookup_failed");
    expect(findCall(calls, "ignore_billing_provider_event")).toBeUndefined();
  });

  it("05F1-R1: duplicate RECEIVED is one apply path and never grants entitlement", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent(), makeEvent({ id: "22222222-2222-2222-2222-222222222222", external_event_id: "evt_2" })],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 390 }),
    );
    expect(result.processed).toBe(2);
    const applies = calls.filter((c) => c.name === "apply_billing_pix_automatic_payment_snapshot");
    expect(applies).toHaveLength(2);
    expect(applies.every((c) => c.params.p_external_payment_id === "pay_1")).toBe(true);
    expect(names(calls)).not.toContain("apply_billing_pix_automatic_eligibility_event");
  });

  it("05F1-R3: initial QR uses pixTransaction GET conciliation and matches #2 only", async () => {
    const { result, calls, fetchSpy } = await run(
      {
        events: [makeEvent({ external_resource_id: "pay_ojgo" })],
        resolvePix: (params) => {
          if (params.p_conciliation_identifier === "ASAAS-CONCIL-2") {
            return {
              found: true,
              pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
              pix_instruction_id: null,
              external_customer_id: "cus_account",
            };
          }
          if (params.p_conciliation_identifier === "ASAAS-CONCIL-1") {
            return { found: false, reason: "conciliation_unmatched" };
          }
          return { found: false };
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async (url) => {
        if (String(url).includes("/pix/transactions/")) {
          return jsonResponse(200, {
            id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            status: "DONE",
            type: "CREDIT",
            value: 390,
            conciliationIdentifier: "ASAAS-CONCIL-2",
            payment: "pay_ojgo",
          });
        }
        return jsonResponse(200, {
          id: "pay_ojgo",
          customer: "cus_payer",
          status: "RECEIVED",
          billingType: "PIX",
          value: 390,
          pixTransaction: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        });
      },
    );
    expect(result.processed).toBe(1);
    expect(calls.some((c) =>
      c.name === "resolve_billing_target_by_pix_automatic_payment"
      && c.params.p_conciliation_identifier === "ASAAS-CONCIL-2"
    )).toBe(true);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_authorization_id)
      .toBe("9377b65a-ceb5-4e47-8bd2-c8b505a10472");
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_instruction_id).toBeNull();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/pix/transactions/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"))).toBe(true);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/pix/automatic/paymentInstructions"))).toBe(false);
  });

  it("05F1-R3: wrong transaction conciliation fails closed", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: (params) => {
          if (params.p_conciliation_identifier === "ASAAS-WRONG") {
            return { found: false, reason: "conciliation_unmatched" };
          }
          return { found: false };
        },
      },
      async (url) => {
        if (String(url).includes("/pix/transactions/")) {
          return jsonResponse(200, { id: "tx_1", conciliationIdentifier: "ASAAS-WRONG", payment: "pay_1" });
        }
        return jsonResponse(200, {
          id: "pay_1",
          customer: "cus_1",
          status: "RECEIVED",
          value: 390,
          pixTransaction: "tx_1",
        });
      },
    );
    expect(result.failed).toBe(1);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_error_category).toBe("conciliation_unmatched");
    expect(names(calls)).not.toContain("apply_billing_pix_automatic_payment_snapshot");
  });

  it("05F1-R3: missing pixTransaction does not guess by customer", async () => {
    const { result, calls, fetchSpy } = await run(
      { events: [makeEvent()], resolvePix: { found: false } },
      async (url) => {
        if (String(url).includes("/pix/automatic/paymentInstructions")) {
          return jsonResponse(200, { data: [], hasMore: false });
        }
        return jsonResponse(200, { id: "pay_1", customer: "cus_1", status: "RECEIVED", value: 390 });
      },
    );
    expect(result.ignored).toBe(1);
    expect(findCall(calls, "ignore_billing_provider_event")?.params.p_reason).toBe("ignored_non_subscription_payment");
    expect(names(calls)).not.toContain("apply_billing_pix_automatic_payment_snapshot");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/pix/transactions/"))).toBe(false);
  });

  it("05F1-R3: Pix transaction GET failure is retryable", async () => {
    const { result, calls } = await run(
      { events: [makeEvent()], resolvePix: { found: false } },
      async (url) => {
        if (String(url).includes("/pix/transactions/")) {
          return status(500, { errors: [{ code: "error", description: "down" }] });
        }
        return jsonResponse(200, {
          id: "pay_1",
          customer: "cus_1",
          status: "RECEIVED",
          value: 390,
          pixTransaction: "tx_1",
        });
      },
    );
    expect(result.failed).toBe(1);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_retryable).toBe(true);
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_error_category)
      .toBe("pix_automatic_transaction_lookup_failed");
    expect(findCall(calls, "ignore_billing_provider_event")).toBeUndefined();
  });

  it("05F1-R3: initial path does not use future instruction payment id", async () => {
    const { result, calls, fetchSpy } = await run(
      {
        events: [makeEvent({ external_resource_id: "pay_ojgo" })],
        resolvePix: (params) => {
          if (params.p_external_payment_id === "pay_mpg9") {
            throw new Error("future instruction must not be queried");
          }
          if (params.p_conciliation_identifier === "ASAAS-CONCIL-2") {
            return {
              found: true,
              pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
              pix_instruction_id: null,
              external_customer_id: "cus_account",
            };
          }
          return { found: false };
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async (url) => {
        if (String(url).includes("/pix/transactions/")) {
          return jsonResponse(200, { id: "tx_1", conciliationIdentifier: "ASAAS-CONCIL-2", payment: "pay_ojgo" });
        }
        return jsonResponse(200, {
          id: "pay_ojgo",
          customer: "cus_payer",
          status: "RECEIVED",
          value: 390,
          pixTransaction: "tx_1",
        });
      },
    );
    expect(result.processed).toBe(1);
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_external_payment_id)
      .toBe("pay_ojgo");
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_instruction_id).toBeNull();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("pay_mpg9"))).toBe(false);
  });

  it("05F1-R3: PIX payment with subscription metadata still follows deterministic Pix path", async () => {
    const { result, calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          pix_instruction_id: "inst_oct",
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        subscription: "sub_generated",
        status: "PENDING",
        value: 390,
        billingType: "PIX",
      }),
    );
    expect(result.processed).toBe(1);
    expect(names(calls)).not.toContain("resolve_billing_target_by_subscription");
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_pix_instruction_id)
      .toBe("inst_oct");
  });

  it("05F1-R3: sandbox/prod isolation is passed to the resolver", async () => {
    const { calls } = await run(
      {
        events: [makeEvent()],
        resolvePix: {
          found: true,
          pix_authorization_id: "9377b65a-ceb5-4e47-8bd2-c8b505a10472",
          external_customer_id: "cus_1",
        },
        applyPix: { outcome: "applied", entitlement_granted: false },
      },
      async () => jsonResponse(200, {
        id: "pay_1",
        customer: "cus_1",
        status: "RECEIVED",
        value: 390,
        conciliationIdentifier: "ASAAS-CONCIL-2",
      }),
    );
    expect(findCall(calls, "resolve_billing_target_by_pix_automatic_payment")?.params.p_environment).toBe("sandbox");
    expect(findCall(calls, "apply_billing_pix_automatic_payment_snapshot")?.params.p_environment).toBe("sandbox");
  });

  it("fails closed when claimed event environment disagrees with drain", async () => {
    const { result, calls, fetchSpy } = await run(
      { events: [makeEvent({ environment: "production" })] },
      async () => jsonResponse(200, { id: "pay_1" }),
    );
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.category).toBe("environment_mismatch");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findCall(calls, "fail_billing_provider_event")?.params.p_error_category).toBe("environment_mismatch");
  });
});
