// ASAAS-03C — testes de classificação de outcome do client HTTP (H06, H07, H12 parcial).
// Roda sob Vitest/Node: asaasFetch só usa fetch/AbortController/setTimeout (disponíveis no
// Node deste runner) e não importa nada Deno-específico.
import { describe, it, expect, afterEach, vi } from "vitest";
import { asaasFetch, hasStringId, isOutcomeUnknownCategory, type AsaasCredentials } from "./client.ts";
import { emptyResponse, jsonResponse, malformedResponse } from "./testHelpers.ts";

const creds: AsaasCredentials = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asaasFetch — outcome classification", () => {
  it("200 com JSON válido -> success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { id: "cus_1" })));
    const res = await asaasFetch<{ id: string }>(creds, "sandbox", "POST", "/customers", { name: "x" });
    expect(res.outcome).toBe("success");
    expect(res.category).toBe("ok");
    expect(res.data).toEqual({ id: "cus_1" });
  });

  it("H06: 2xx com corpo vazio -> unknown/empty_2xx_body, nunca success nem rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyResponse(200)));
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {});
    expect(res.outcome).toBe("unknown");
    expect(res.category).toBe("empty_2xx_body");
    expect(res.data).toBeNull();
  });

  it("H07: 2xx com JSON malformado -> unknown/malformed_2xx_body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(malformedResponse(200)));
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {});
    expect(res.outcome).toBe("unknown");
    expect(res.category).toBe("malformed_2xx_body");
  });

  it("timeout/AbortError antes de qualquer resposta -> unknown/network_timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {}, 10);
    expect(res.outcome).toBe("unknown");
    expect(res.category).toBe("network_timeout");
  });

  it("conexão interrompida ao ler o corpo (res.text() rejeita) -> unknown/network_timeout", async () => {
    const fakeRes = { status: 200, text: () => Promise.reject(new Error("stream closed")) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeRes as unknown as Response));
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {});
    expect(res.outcome).toBe("unknown");
    expect(res.category).toBe("network_timeout");
  });

  it("5xx -> unknown/provider_5xx (request pode ter sido processada antes do erro)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("internal error", { status: 502 })));
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {});
    expect(res.outcome).toBe("unknown");
    expect(res.category).toBe("provider_5xx");
  });

  it("429 -> deterministic_rejection/rate_limited (recusado antes de processar)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })));
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {});
    expect(res.outcome).toBe("deterministic_rejection");
    expect(res.category).toBe("rate_limited");
  });

  it("400 -> deterministic_rejection/http_4xx (validação, nunca criou o recurso)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { errors: [{ description: "invalid cpfCnpj" }] })));
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {});
    expect(res.outcome).toBe("deterministic_rejection");
    expect(res.category).toBe("http_4xx");
  });

  it("H12: categoria nunca carrega texto bruto, mesmo quando a Asaas ecoa PII na resposta", async () => {
    const sensitiveCpf = "12345678900";
    const sensitiveEmail = "joao.silva@example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          errors: [{ description: `cpfCnpj ${sensitiveCpf} invalido para joao.silva@example.com` }],
        }),
      ),
    );
    const res = await asaasFetch(creds, "sandbox", "POST", "/customers", {
      cpfCnpj: sensitiveCpf,
      email: sensitiveEmail,
    });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(sensitiveCpf);
    expect(serialized).not.toContain(sensitiveEmail);
    expect(serialized).not.toContain(creds.apiKey);
    // A categoria é sempre uma das poucas strings fixas — nunca o texto da resposta.
    expect(res.category).toBe("http_4xx");
  });
});

describe("isOutcomeUnknownCategory", () => {
  it("só as duas categorias de rejeição determinística NÃO são unknown", () => {
    expect(isOutcomeUnknownCategory("http_4xx")).toBe(false);
    expect(isOutcomeUnknownCategory("rate_limited")).toBe(false);
  });

  it("qualquer outra categoria, incluindo ausência, é unknown por padrão conservador", () => {
    for (const category of [
      "network_timeout",
      "provider_5xx",
      "empty_2xx_body",
      "malformed_2xx_body",
      "invalid_success_shape",
      "reconciliation_lookup_failed",
      "reconciliation_ambiguous_multiple",
      "some_future_category_never_seen_before",
    ]) {
      expect(isOutcomeUnknownCategory(category)).toBe(true);
    }
    expect(isOutcomeUnknownCategory(null)).toBe(true);
    expect(isOutcomeUnknownCategory(undefined)).toBe(true);
    expect(isOutcomeUnknownCategory("")).toBe(true);
  });
});

describe("hasStringId", () => {
  it("aceita objeto com id string não vazia", () => {
    expect(hasStringId({ id: "cus_1" })).toBe(true);
  });

  it("rejeita ausência de id, id vazio, id não-string, null, e não-objeto", () => {
    expect(hasStringId({})).toBe(false);
    expect(hasStringId({ id: "" })).toBe(false);
    expect(hasStringId({ id: 123 })).toBe(false);
    expect(hasStringId(null)).toBe(false);
    expect(hasStringId(undefined)).toBe(false);
    expect(hasStringId("cus_1")).toBe(false);
  });
});
