// ASAAS-03C — testes de failure-path de ensureSubscription (H08-H11) + prova de que os fatos
// persistidos vêm sempre do objeto Asaas, nunca da fixture local (Blocker 1). Roda sob
// Vitest/Node — mesma base de customer.test.ts.
import { describe, it, expect, afterEach, vi } from "vitest";
import { ensureSubscription, extractSubscriptionFacts, type SubscriptionFixture } from "./subscription.ts";
import type { AsaasCredentials, AsaasEnvironment } from "./client.ts";
import { subscriptionExternalReference } from "./keys.ts";
import { emptyResponse, jsonResponse, makeAdminClient, readSentBody } from "./testHelpers.ts";

const creds: AsaasCredentials = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };
const environment: AsaasEnvironment = "sandbox";
const billingAccountId = "22222222-2222-2222-2222-222222222222";
const externalCustomerId = "cus_1";
const scope = "primary";
// Fixture DELIBERADAMENTE diferente do que os testes fazem a Asaas "devolver" — é exatamente
// essa divergência que prova que o código persiste os fatos do provider, não a fixture local.
const fixture: SubscriptionFixture = {
  billingType: "PIX",
  cycle: "MONTHLY",
  valueCents: 1000,
  description: "Vertexa Sandbox E2E",
};
const externalReference = subscriptionExternalReference(environment, billingAccountId, scope);

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseParams(adminClient: unknown) {
  return { adminClient: adminClient as never, environment, creds, billingAccountId, externalCustomerId, scope, fixture };
}

describe("extractSubscriptionFacts — Blocker 1 (autoridade é sempre o provider)", () => {
  const expected = { externalCustomerId, externalReference };

  it("extrai os fatos exatamente como o provider devolveu, mesmo divergindo da fixture local", () => {
    const result = extractSubscriptionFacts(
      {
        id: "sub_real",
        customer: externalCustomerId,
        externalReference,
        billingType: "BOLETO",
        cycle: "YEARLY",
        value: 25.5,
        nextDueDate: "2027-01-15",
      },
      expected,
    );
    expect(result).toEqual({
      ok: true,
      facts: { externalSubscriptionId: "sub_real", billingType: "BOLETO", cycle: "YEARLY", valueCents: 2550, nextDueDate: "2027-01-15" },
    });
  });

  it("FAIL CLOSED quando customer não bate com o esperado", () => {
    const result = extractSubscriptionFacts(
      { id: "sub_1", customer: "cus_outro", externalReference, billingType: "PIX", cycle: "MONTHLY", value: 10, nextDueDate: "2026-09-10" },
      expected,
    );
    expect(result).toEqual({ ok: false, reason: "reconciliation_customer_mismatch" });
  });

  it("FAIL CLOSED quando externalReference não bate com o esperado", () => {
    const result = extractSubscriptionFacts(
      { id: "sub_1", customer: externalCustomerId, externalReference: "outro:valor", billingType: "PIX", cycle: "MONTHLY", value: 10, nextDueDate: "2026-09-10" },
      expected,
    );
    expect(result).toEqual({ ok: false, reason: "reconciliation_external_reference_mismatch" });
  });

  it("FAIL CLOSED em billingType/cycle fora do enum, value <= 0, e nextDueDate inválido", () => {
    const base = { id: "sub_1", customer: externalCustomerId, externalReference };
    expect(extractSubscriptionFacts({ ...base, billingType: "CRYPTO", cycle: "MONTHLY", value: 10, nextDueDate: "2026-09-10" }, expected).ok).toBe(false);
    expect(extractSubscriptionFacts({ ...base, billingType: "PIX", cycle: "DAILY", value: 10, nextDueDate: "2026-09-10" }, expected).ok).toBe(false);
    expect(extractSubscriptionFacts({ ...base, billingType: "PIX", cycle: "MONTHLY", value: 0, nextDueDate: "2026-09-10" }, expected).ok).toBe(false);
    expect(extractSubscriptionFacts({ ...base, billingType: "PIX", cycle: "MONTHLY", value: -5, nextDueDate: "2026-09-10" }, expected).ok).toBe(false);
    expect(extractSubscriptionFacts({ ...base, billingType: "PIX", cycle: "MONTHLY", value: 10, nextDueDate: "10/09/2026" }, expected).ok).toBe(false);
  });

  it("FAIL CLOSED quando id ausente/vazio", () => {
    const result = extractSubscriptionFacts(
      { customer: externalCustomerId, externalReference, billingType: "PIX", cycle: "MONTHLY", value: 10, nextDueDate: "2026-09-10" },
      expected,
    );
    expect(result).toEqual({ ok: false, reason: "invalid_success_shape" });
  });

  it("FAIL CLOSED quando value não representa um número exato de centavos (nunca arredonda dinheiro em silêncio)", () => {
    const result = extractSubscriptionFacts(
      { id: "sub_1", customer: externalCustomerId, externalReference, billingType: "PIX", cycle: "MONTHLY", value: 12.345, nextDueDate: "2026-09-10" },
      expected,
    );
    expect(result).toEqual({ ok: false, reason: "value_not_exact_cents" });
  });
});

describe("ensureSubscription", () => {
  it("H08: reconciliation encontra 1 -> persiste os fatos DO PROVIDER, nunca a fixture local, ZERO POST", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        data: [
          {
            id: "sub_real",
            customer: externalCustomerId,
            externalReference,
            billingType: "BOLETO", // fixture pede PIX
            cycle: "YEARLY", // fixture pede MONTHLY
            value: 25.5, // fixture pede 10.00
            nextDueDate: "2027-01-15", // nunca "hoje"
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "claimed_for_retry", operation_id: "op1", attempt_count: 2, last_error_category: "provider_5xx" },
          error: null,
        };
      }
      if (name === "complete_billing_subscription_operation") {
        return { data: { outcome: "completed", external_subscription_id: "sub_real" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalSubscriptionId: "sub_real" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET de reconciliação.
    const completeCall = calls.find((c) => c.name === "complete_billing_subscription_operation");
    expect(completeCall?.params).toMatchObject({
      p_billing_type: "BOLETO",
      p_billing_cycle: "YEARLY",
      p_value_cents: 2550,
      p_next_due_date: "2027-01-15",
    });
  });

  it("create-success: mesma regra — persiste o que a Asaas devolveu no POST, não a fixture enviada", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = readSentBody(init);
      return jsonResponse(200, {
        id: "sub_new",
        customer: body.customer,
        externalReference: body.externalReference,
        billingType: body.billingType,
        cycle: body.cycle,
        value: 33.33, // Asaas "normalizou" para um valor diferente do enviado (10.00)
        nextDueDate: "2026-10-01",
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1", attempt_count: 1 }, error: null };
      }
      if (name === "complete_billing_subscription_operation") {
        return { data: { outcome: "completed", external_subscription_id: "sub_new" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalSubscriptionId: "sub_new" });
    const completeCall = calls.find((c) => c.name === "complete_billing_subscription_operation");
    expect(completeCall?.params.p_value_cents).toBe(3333); // não 1000 (a fixture).
    expect(completeCall?.params.p_next_due_date).toBe("2026-10-01"); // não a data de hoje.
  });

  it("H09: outcome desconhecido, lookup encontra 0 -> FAIL CLOSED, ZERO segundo POST, ledger intocado", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "claimed_for_retry", operation_id: "op1", attempt_count: 2, last_error_category: "network_timeout" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada (não deveria chamar ${name})`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.name)).toEqual(["reserve_billing_outbound_operation"]);
  });

  it("H10: lookup encontra >1 -> FAIL CLOSED, nunca escolhe automaticamente", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        data: [
          { id: "sub_a", customer: externalCustomerId, externalReference, billingType: "PIX", cycle: "MONTHLY", value: 10, nextDueDate: "2026-09-10" },
          { id: "sub_b", customer: externalCustomerId, externalReference, billingType: "PIX", cycle: "MONTHLY", value: 10, nextDueDate: "2026-09-10" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "in_flight_retry", operation_id: "op1", attempt_count: 2, last_error_category: null },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "reconciliation_ambiguous_multiple" });
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("reconciliation_ambiguous_multiple");
  });

  it("H11: 2xx vazio no POST -> outcome desconhecido, nunca sucesso, nunca retry na mesma chamada", async () => {
    const fetchSpy = vi.fn(async () => emptyResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1", attempt_count: 1 }, error: null };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("empty_2xx_body");
  });

  it("H11b: 2xx válido mas sem id -> outcome desconhecido (invalid_success_shape)", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = readSentBody(init);
      return jsonResponse(200, { customer: body.customer, externalReference: body.externalReference });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1", attempt_count: 1 }, error: null };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("invalid_success_shape");
  });

  it("create POST rejeitado com 4xx -> provider_rejected (determinístico), failOperation com http_4xx", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(400, { errors: [{ description: "invalid subscription" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1", attempt_count: 1 }, error: null };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "provider_rejected" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o POST rejeitado — nunca reconcilia nem repete.
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("http_4xx");
  });

  it("reconciliation lookup inconclusivo (5xx) -> reconciliation_lookup_failed, ZERO POST", async () => {
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 502 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "claimed_for_retry", operation_id: "op1", attempt_count: 2, last_error_category: "network_timeout" },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "reconciliation_lookup_failed" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET inconclusivo — nunca um POST.
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("reconciliation_lookup_failed");
  });

  it("H15 (unidade): already_completed retorna direto, zero fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "already_completed", operation_id: "op1", external_object_id: "sub_existing" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureSubscription(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalSubscriptionId: "sub_existing" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
