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
  apply?: unknown;
  applyError?: unknown;
  missing?: unknown;
  missingError?: unknown;
}

function makeClient(cfg: Cfg) {
  return makeAdminClient(async (name) => {
    switch (name) {
      case "claim_billing_provider_events":
        return { data: cfg.events, error: null };
      case "resolve_billing_target_by_subscription":
        return { data: cfg.resolve ?? null, error: cfg.resolveError ?? null };
      case "apply_billing_payment_snapshot":
        return { data: cfg.apply ?? null, error: cfg.applyError ?? null };
      case "handle_missing_payment_on_get":
        return { data: cfg.missing ?? null, error: cfg.missingError ?? null };
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
