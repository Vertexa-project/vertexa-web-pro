// ASAAS-03C — testes de failure-path de ensureCustomer (H01-H07). Roda sob Vitest/Node:
// customer.ts só importa SupabaseClient como `import type` (apagado no transform), e o
// fetch/AbortController usados por asaasFetch existem no Node deste runner. Sem Docker/Deno.
import { describe, it, expect, afterEach, vi } from "vitest";
import { ensureCustomer, type CustomerFixture } from "./customer.ts";
import type { AsaasCredentials, AsaasEnvironment } from "./client.ts";
import { customerExternalReference } from "./keys.ts";
import { emptyResponse, jsonResponse, makeAdminClient, malformedResponse, readSentBody } from "./testHelpers.ts";

const creds: AsaasCredentials = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };
const environment: AsaasEnvironment = "sandbox";
const billingAccountId = "11111111-1111-1111-1111-111111111111";
const fixture: CustomerFixture = {
  name: "Vertexa Sandbox QA",
  cpfCnpj: "99991111140",
  email: "sandbox-qa@vertexa.test",
  notificationDisabled: true,
};
const externalReference = customerExternalReference(environment, billingAccountId);

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseParams(adminClient: unknown, existingExternalCustomerId: string | null = null) {
  return {
    adminClient: adminClient as never,
    environment,
    creds,
    billingAccountId,
    existingExternalCustomerId,
    fixture,
  };
}

describe("ensureCustomer", () => {
  it("H02: customer já persistido -> retorna direto, zero RPC, zero fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("não deveria chamar RPC nenhuma");
    });

    const result = await ensureCustomer(baseParams(adminClient, "cus_existing"));

    expect(result).toEqual({ ok: true, externalCustomerId: "cus_existing" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("H01: primeira tentativa (reserved) cria com sucesso, exatamente 1 POST", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = readSentBody(init);
      return jsonResponse(200, { id: "cus_1", externalReference: body.externalReference });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1", attempt_count: 1 }, error: null };
      }
      if (name === "complete_billing_customer_operation") {
        return { data: { outcome: "completed", external_customer_id: "cus_1" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalCustomerId: "cus_1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.name)).toEqual([
      "reserve_billing_outbound_operation",
      "complete_billing_customer_operation",
    ]);
  });

  it("H03: retry após outcome desconhecido, lookup encontra 1 -> reconcile, ZERO POST", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [{ id: "cus_1", externalReference }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "claimed_for_retry", operation_id: "op1", attempt_count: 2, last_error_category: "network_timeout" },
          error: null,
        };
      }
      if (name === "complete_billing_customer_operation") {
        return { data: { outcome: "completed", external_customer_id: "cus_1" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalCustomerId: "cus_1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET de reconciliação — nunca um POST.
    expect(fetchSpy.mock.calls[0][1]?.method ?? "GET").toBe("GET");
    expect(calls.map((c) => c.name)).toEqual([
      "reserve_billing_outbound_operation",
      "complete_billing_customer_operation",
    ]);
  });

  it("H04: retry após outcome desconhecido, lookup encontra 0 -> FAIL CLOSED, ZERO POST, ledger intocado", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "claimed_for_retry", operation_id: "op1", attempt_count: 2, last_error_category: "provider_5xx" },
          error: null,
        };
      }
      throw new Error(`RPC inesperada (não deveria chamar ${name} nesse cenário)`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET — zero POST.
    expect(calls.map((c) => c.name)).toEqual(["reserve_billing_outbound_operation"]); // fail_billing_outbound_operation NÃO chamado.
  });

  it("H04b: mesmo cenário, mas a categoria anterior é rejeição determinística -> seguro repetir POST", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const call = fetchSpy.mock.calls.length;
      if (call === 1) return jsonResponse(200, { data: [] }); // lookup: 0 resultados
      const body = readSentBody(init);
      return jsonResponse(200, { id: "cus_2", externalReference: body.externalReference });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "claimed_for_retry", operation_id: "op1", attempt_count: 2, last_error_category: "http_4xx" },
          error: null,
        };
      }
      if (name === "complete_billing_customer_operation") {
        return { data: { outcome: "completed", external_customer_id: "cus_2" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalCustomerId: "cus_2" });
    expect(fetchSpy).toHaveBeenCalledTimes(2); // GET (0 resultados) + POST (seguro, rejeição comprovada antes).
  });

  it("H05: lookup encontra >1 -> FAIL CLOSED, nunca escolhe automaticamente", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { data: [{ id: "cus_a", externalReference }, { id: "cus_b", externalReference }] }),
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

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "reconciliation_ambiguous_multiple" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("reconciliation_ambiguous_multiple");
  });

  it("H06: 2xx com corpo vazio no POST -> outcome desconhecido, nunca sucesso, zero retry na mesma chamada", async () => {
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

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("empty_2xx_body");
  });

  it("H07a: 2xx com JSON malformado no POST -> outcome desconhecido", async () => {
    const fetchSpy = vi.fn(async () => malformedResponse(200));
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

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("malformed_2xx_body");
  });

  it("H07b: 2xx com JSON válido mas SEM id -> outcome desconhecido (invalid_success_shape), não sucesso", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = readSentBody(init);
      return jsonResponse(200, { externalReference: body.externalReference }); // sem `id`
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

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "outcome_unknown_requires_reconciliation" });
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("invalid_success_shape");
  });

  it("H07c: 2xx com id válido mas externalReference divergente -> FAIL CLOSED, nunca persiste", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { id: "cus_x", externalReference: "algum:outro:valor" }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "reserved", operation_id: "op1", attempt_count: 1 }, error: null };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      if (name === "complete_billing_customer_operation") {
        throw new Error("NUNCA deveria completar com externalReference divergente");
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result.ok).toBe(false);
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("reconciliation_external_reference_mismatch");
  });

  it("H15 (customer): já persistido no ledger (already_completed) -> retorna direto, zero fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return { data: { outcome: "already_completed", operation_id: "op1", external_object_id: "cus_existing" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: true, externalCustomerId: "cus_existing" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("create POST rejeitado com 4xx -> provider_rejected (determinístico), failOperation com http_4xx", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(400, { errors: [{ description: "invalid cpfCnpj" }] }));
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

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "provider_rejected" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("http_4xx");
  });

  it("reconciliation lookup inconclusivo (5xx) -> reconciliation_lookup_failed, ZERO POST", async () => {
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 502 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async (name) => {
      if (name === "reserve_billing_outbound_operation") {
        return {
          data: { outcome: "in_flight_retry", operation_id: "op1", attempt_count: 2, last_error_category: "network_timeout" },
          error: null,
        };
      }
      if (name === "fail_billing_outbound_operation") {
        return { data: { outcome: "failed" }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const result = await ensureCustomer(baseParams(adminClient));

    expect(result).toEqual({ ok: false, errorCode: "reconciliation_lookup_failed" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // só o GET inconclusivo — nunca um POST.
    const failCall = calls.find((c) => c.name === "fail_billing_outbound_operation");
    expect(failCall?.params.p_error_category).toBe("reconciliation_lookup_failed");
  });
});
