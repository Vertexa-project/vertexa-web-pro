// ASAAS-03C — testes de failure-path das actions QA-only (H13, H14) + fail-closed do
// payment.ts. Roda sob Vitest/Node — mesma base de customer.test.ts/subscription.test.ts.
import { describe, it, expect, afterEach, vi } from "vitest";
import { checkWebhookReceipt, confirmSandboxPayment, listSubscriptionPayments } from "./payment.ts";
import type { AsaasCredentials, AsaasEnvironment } from "./client.ts";
import { emptyResponse, jsonResponse, makeAdminClient } from "./testHelpers.ts";

const creds: AsaasCredentials = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };
const billingAccountId = "33333333-3333-3333-3333-333333333333";
const externalSubscriptionId = "sub_1";
const externalCustomerId = "cus_1";

afterEach(() => {
  vi.unstubAllGlobals();
});

function resolvedAdminClient(overrides: Record<string, unknown> = {}) {
  return makeAdminClient(async (name) => {
    if (name === "resolve_primary_asaas_subscription") {
      return { data: { found: true, external_customer_id: externalCustomerId, external_subscription_id: externalSubscriptionId }, error: null };
    }
    if (name in overrides) {
      return overrides[name] as { data: unknown; error: unknown };
    }
    throw new Error(`RPC inesperada: ${name}`);
  });
}

describe("confirmSandboxPayment", () => {
  it("H13: environment=production -> 403 sandbox_only, ZERO rpc, ZERO fetch (defesa em profundidade)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("não deveria chamar RPC nenhuma");
    });

    const result = await confirmSandboxPayment({
      adminClient: adminClient as never,
      environment: "production" as AsaasEnvironment,
      creds,
      billingAccountId,
    });

    expect(result).toEqual({ ok: false, errorCode: "sandbox_only", httpStatus: 403 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("H14: paymentId/subscriptionId/customerId arbitrários no params são ignorados — sempre resolve server-side", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [{ id: "pay_real", status: "PENDING", customer: externalCustomerId }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = resolvedAdminClient();

    // Um caller malicioso passaria campos extras no objeto — a assinatura de
    // confirmSandboxPayment/listSubscriptionPayments/checkWebhookReceipt nem tem esses
    // parâmetros: TypeScript não permite declará-los, e em runtime eles são simplesmente
    // ignorados porque a função só desestrutura os campos nomeados.
    const attackerParams = {
      adminClient: adminClient as never,
      environment: "sandbox" as AsaasEnvironment,
      creds,
      billingAccountId,
      paymentId: "pay_attacker_supplied",
      subscriptionId: "sub_attacker_supplied",
      customerId: "cus_attacker_supplied",
    };

    const result = await listSubscriptionPayments(attackerParams as never);

    // O resultado reflete o payment REAL resolvido via resolve_primary_asaas_subscription
    // (pay_real), nunca o id injetado pelo caller.
    expect(result.ok).toBe(true);
    expect(result.paymentId).toBe("pay_real");
    expect(result.paymentId).not.toBe("pay_attacker_supplied");
    // A URL chamada usa o subscriptionId RESOLVIDO (sub_1), nunca o injetado.
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain(externalSubscriptionId);
    expect(url).not.toContain("sub_attacker_supplied");
  });

  it("payment não pertence ao customer resolvido -> customer_mismatch, nunca confirma", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [{ id: "pay_1", status: "PENDING", customer: "cus_outro" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = resolvedAdminClient();

    const result = await confirmSandboxPayment({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result).toEqual({ ok: false, errorCode: "customer_mismatch", httpStatus: 409 });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET de listagem — nunca o POST de confirm.
  });

  it("0 payments -> 409 no_payments_yet, nunca um 200 ambíguo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: [] })));
    const { adminClient } = resolvedAdminClient();

    const result = await confirmSandboxPayment({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result).toEqual({ ok: false, errorCode: "no_payments_yet", httpStatus: 409, count: 0 });
  });

  it(">1 payments -> FAIL CLOSED, nunca escolhe automaticamente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          data: [
            { id: "pay_a", status: "PENDING", customer: externalCustomerId },
            { id: "pay_b", status: "PENDING", customer: externalCustomerId },
          ],
        }),
      ),
    );
    const { adminClient } = resolvedAdminClient();

    const result = await confirmSandboxPayment({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result).toEqual({ ok: false, errorCode: "ambiguous_payments", httpStatus: 409, count: 2 });
  });

  it("subscription ainda não criada (found mas sem external_subscription_id) -> 409, zero fetch de payments", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "resolve_primary_asaas_subscription") {
        return { data: { found: true, external_customer_id: externalCustomerId, external_subscription_id: null }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await confirmSandboxPayment({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result).toEqual({ ok: false, errorCode: "subscription_not_ready", httpStatus: 409 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("confirma com sucesso quando exatamente 1 payment do customer certo", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes("/confirm")) return jsonResponse(200, { id: "pay_1", status: "RECEIVED" });
      return jsonResponse(200, { data: [{ id: "pay_1", status: "PENDING", customer: externalCustomerId }] });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = resolvedAdminClient();

    const result = await confirmSandboxPayment({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result).toEqual({ ok: true, count: 1, paymentId: "pay_1", status: "RECEIVED", customerMatch: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2); // GET listagem + POST confirm.
  });

  it("confirm 2xx vazio -> outcome desconhecido, nunca reportado como sucesso", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes("/confirm")) return emptyResponse(200);
      return jsonResponse(200, { data: [{ id: "pay_1", status: "PENDING", customer: externalCustomerId }] });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = resolvedAdminClient();

    const result = await confirmSandboxPayment({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation", httpStatus: 502 });
  });
});

describe("checkWebhookReceipt", () => {
  it("read-only: nunca chama confirm, só find_billing_provider_events_for_resource", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [{ id: "pay_1", status: "RECEIVED", customer: externalCustomerId }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = resolvedAdminClient({
      find_billing_provider_events_for_resource: {
        data: [{ event_type: "PAYMENT_RECEIVED", external_event_id: "evt_1", processing_status: "received", received_at: "2026-09-10T00:00:00Z" }],
        error: null,
      },
    });

    const result = await checkWebhookReceipt({ adminClient: adminClient as never, environment: "sandbox", creds, billingAccountId });

    expect(result.ok).toBe(true);
    expect(result.paymentId).toBe("pay_1");
    expect(result.events).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET de listagem — never /confirm.
    expect(fetchSpy.mock.calls[0][0]).not.toContain("/confirm");
    expect(calls.map((c) => c.name)).toEqual(["resolve_primary_asaas_subscription", "find_billing_provider_events_for_resource"]);
  });
});
