// ASAAS-03C — testes de failure-path de ensureCustomer (H01-H07). Roda sob Vitest/Node:
// customer.ts só importa SupabaseClient como `import type` (apagado no transform), e o
// fetch/AbortController usados por asaasFetch existem no Node deste runner. Sem Docker/Deno.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  checkoutReadinessError,
  customerBodyFromIdentity,
  customerUpdatePayload,
  ensureCustomer,
  getAuthoritativeCustomerIdentity,
  isCustomerCheckoutReady,
  normalizeCustomerTaxId,
  type CustomerFixture,
} from "./customer.ts";
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

describe("customerBodyFromIdentity", () => {
  it("derives the Asaas body from Vertexa identity and never accepts a fixture name", () => {
    const body = customerBodyFromIdentity({
      legalName: "Clínica Sintética LTDA",
      taxId: "999.911.111-40",
      email: "bill@t.test",
      mobilePhone: "11988887777",
      billingAddress: "  Rua das Flores  ",
      billingAddressNumber: " S/N ",
    });
    expect(body).toEqual({
      name: "Clínica Sintética LTDA",
      cpfCnpj: "99991111140",
      email: "bill@t.test",
      notificationDisabled: true,
      phone: "11988887777",
      mobilePhone: "11988887777",
      address: "Rua das Flores",
      addressNumber: "S/N",
    });
  });

  it("preserves a validated alphanumeric CNPJ instead of reducing it to digits", () => {
    const body = customerBodyFromIdentity({
      legalName: "Clínica Sintética LTDA",
      taxId: "12.abc.345/01de-35",
      email: "bill@t.test",
    });
    expect(body.cpfCnpj).toBe("12ABC34501DE35");
  });

  it("normalizes provider and canonical tax IDs with the same punctuation-safe rule", () => {
    expect(normalizeCustomerTaxId(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
    expect(normalizeCustomerTaxId("  ")).toBeNull();
  });
});

describe("getAuthoritativeCustomerIdentity", () => {
  it("accepts only the exact provider customer and returns normalized identity facts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {
      id: "cus_exact",
      cpfCnpj: "123.456.789-09",
      name: "Synthetic",
      email: "SYNTHETIC@INVALID",
      mobilePhone: "(11) 98888-7777",
    })));
    await expect(getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: "cus_exact" }))
      .resolves.toEqual({
        ok: true,
        customer: {
          externalCustomerId: "cus_exact",
          normalizedTaxId: "12345678909",
          name: "Synthetic",
          email: "synthetic@invalid",
          mobilePhone: "11988887777",
          phone: null,
          address: null,
          addressNumber: null,
        },
      });
  });

  it("classifies a missing provider customer as a deterministic no-write failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { errors: [{ code: "not_found" }] })));
    await expect(getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: "cus_missing" }))
      .resolves.toEqual({ ok: false, errorCode: "provider_customer_not_found", retryable: false });
  });

  it("rejects a response for a different customer as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "cus_other", cpfCnpj: "12345678909" })));
    await expect(getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: "cus_expected" }))
      .resolves.toEqual({ ok: false, errorCode: "provider_customer_ambiguous", retryable: false });
  });

  it("rejects an exact customer without an authoritative tax identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "cus_exact" })));
    await expect(getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: "cus_exact" }))
      .resolves.toEqual({ ok: false, errorCode: "provider_customer_ambiguous", retryable: false });
  });

  it("keeps an inconclusive provider lookup retryable without creating anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("temporary", { status: 503 })));
    await expect(getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: "cus_exact" }))
      .resolves.toEqual({ ok: false, errorCode: "provider_customer_lookup_inconclusive", retryable: true });
  });
});

describe("checkout-ready customer", () => {
  const source = {
    legalName: "Clínica Sintética LTDA",
    taxId: "99991111140",
    email: "bill@t.test",
    mobilePhone: "11988887777",
    billingAddress: "Rua das Flores",
    billingAddressNumber: "123",
  };

  it("distinguishes bound identity from local checkout readiness", () => {
    expect(checkoutReadinessError({ ...source, mobilePhone: null })).toBe("billing_phone_required");
    expect(checkoutReadinessError({ ...source, billingAddress: " " })).toBe("billing_address_required");
    expect(checkoutReadinessError({ ...source, billingAddressNumber: " " })).toBe("billing_address_number_required");
    expect(checkoutReadinessError(source)).toBeNull();
  });

  it("requires provider phone, address, and address number", () => {
    expect(isCustomerCheckoutReady({ phone: null, address: "Rua A", addressNumber: "1" })).toBe(false);
    expect(isCustomerCheckoutReady({ phone: "11988887777", address: null, addressNumber: "1" })).toBe(false);
    expect(isCustomerCheckoutReady({ phone: "11988887777", address: "Rua A", addressNumber: null })).toBe(false);
    expect(isCustomerCheckoutReady({ phone: "11988887777", address: "Rua A", addressNumber: "S/N" })).toBe(true);
  });

  it("maps only authoritative changed fields and never maps tax/provider identity", () => {
    const payload = customerUpdatePayload(customerBodyFromIdentity(source), {
      externalCustomerId: "cus_existing",
      normalizedTaxId: "99991111140",
      name: "Clínica Sintética LTDA",
      email: "bill@t.test",
      mobilePhone: null,
      phone: null,
      address: null,
      addressNumber: null,
    });
    expect(payload).toEqual({
      phone: "11988887777",
      mobilePhone: "11988887777",
      address: "Rua das Flores",
      addressNumber: "123",
    });
    expect(payload).not.toHaveProperty("cpfCnpj");
    expect(payload).not.toHaveProperty("externalCustomerId");
  });
});

describe("ensureCustomer", () => {
  it("H02: customer já persistido -> exact-ID readback, zero RPC, zero provider write", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, {
      id: "cus_existing",
      cpfCnpj: fixture.cpfCnpj,
      name: fixture.name,
      email: fixture.email,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("não deveria chamar RPC nenhuma");
    });

    const result = await ensureCustomer(baseParams(adminClient, "cus_existing"));

    expect(result).toEqual({ ok: true, externalCustomerId: "cus_existing" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
    expect(calls).toHaveLength(0);
  });

  it("updates an incomplete bound customer once, reads it back, and proves checkout readiness", async () => {
    const readyFixture: CustomerFixture = {
      ...fixture,
      phone: "11988887777",
      mobilePhone: "11988887777",
      address: "Rua das Flores",
      addressNumber: "S/N",
    };
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const call = fetchSpy.mock.calls.length;
      if (call === 1) {
        return jsonResponse(200, {
          id: "cus_existing",
          cpfCnpj: fixture.cpfCnpj,
          name: fixture.name,
          email: fixture.email,
        });
      }
      if (call === 2) {
        expect(init?.method).toBe("PUT");
        expect(readSentBody(init)).toEqual({
          phone: "11988887777",
          mobilePhone: "11988887777",
          address: "Rua das Flores",
          addressNumber: "S/N",
        });
        return jsonResponse(200, { id: "cus_existing" });
      }
      return jsonResponse(200, {
        id: "cus_existing",
        cpfCnpj: fixture.cpfCnpj,
        name: fixture.name,
        email: fixture.email,
        phone: "11988887777",
        mobilePhone: "11988887777",
        address: "Rua das Flores",
        addressNumber: "S/N",
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient, calls } = makeAdminClient(async () => {
      throw new Error("bound customer update must not touch the local outbound-create ledger");
    });

    await expect(ensureCustomer({
      ...baseParams(adminClient, "cus_existing"),
      fixture: readyFixture,
      requireCheckoutReady: true,
    })).resolves.toEqual({ ok: true, externalCustomerId: "cus_existing" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(0);
  });

  it("is idempotent when the bound customer is already checkout-ready", async () => {
    const readyFixture: CustomerFixture = {
      ...fixture,
      phone: "11988887777",
      mobilePhone: "11988887777",
      address: "Rua das Flores",
      addressNumber: "123",
    };
    const fetchSpy = vi.fn(async () => jsonResponse(200, {
      id: "cus_existing",
      cpfCnpj: fixture.cpfCnpj,
      name: fixture.name,
      email: fixture.email,
      phone: "11988887777",
      mobilePhone: "11988887777",
      address: "Rua das Flores",
      addressNumber: "123",
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async () => {
      throw new Error("no RPC expected");
    });

    await expect(ensureCustomer({
      ...baseParams(adminClient, "cus_existing"),
      fixture: readyFixture,
      requireCheckoutReady: true,
    })).resolves.toEqual({ ok: true, externalCustomerId: "cus_existing" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("fails closed on a bound provider tax identity conflict", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, {
      id: "cus_existing",
      cpfCnpj: "11222333000181",
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const { adminClient } = makeAdminClient(async () => {
      throw new Error("no RPC expected");
    });

    await expect(ensureCustomer(baseParams(adminClient, "cus_existing")))
      .resolves.toEqual({ ok: false, errorCode: "provider_customer_identity_conflict" });
    expect(fetchSpy).toHaveBeenCalledOnce();
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
