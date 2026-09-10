// WP-ASAAS-04 — A04-01..A04-10: conversão decimal->centavos segura (money.ts).
import { describe, it, expect } from "vitest";
import { parseAsaasAmountToCents } from "./money.ts";

describe("parseAsaasAmountToCents", () => {
  it("A04-01: 10 -> 1000", () => {
    expect(parseAsaasAmountToCents(10)).toBe(1000);
  });

  it("A04-02: 10.00 -> 1000", () => {
    expect(parseAsaasAmountToCents(10.0)).toBe(1000);
  });

  it("A04-03: 10.01 -> 1001 (sem erro de float)", () => {
    expect(parseAsaasAmountToCents(10.01)).toBe(1001);
  });

  it("A04-04: 0.1 -> 10", () => {
    expect(parseAsaasAmountToCents(0.1)).toBe(10);
  });

  it("A04-05: 99.99 -> 9999", () => {
    expect(parseAsaasAmountToCents(99.99)).toBe(9999);
  });

  it("A04-06: 1000.05 -> 100005", () => {
    expect(parseAsaasAmountToCents(1000.05)).toBe(100005);
  });

  it("A04-07: 0 -> 0 (não-negativo é permitido; o caller decide se 0 é aceitável)", () => {
    expect(parseAsaasAmountToCents(0)).toBe(0);
  });

  it("A04-08: 10.005 (mais de 2 casas) -> null (nunca arredonda silenciosamente)", () => {
    expect(parseAsaasAmountToCents(10.005)).toBeNull();
    expect(parseAsaasAmountToCents(0.001)).toBeNull();
    expect(parseAsaasAmountToCents(1.239)).toBeNull();
  });

  it("A04-09: negativo/NaN/Infinity/não-number -> null", () => {
    expect(parseAsaasAmountToCents(-1)).toBeNull();
    expect(parseAsaasAmountToCents(-0.01)).toBeNull();
    expect(parseAsaasAmountToCents(Number.NaN)).toBeNull();
    expect(parseAsaasAmountToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseAsaasAmountToCents(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(parseAsaasAmountToCents("10" as unknown)).toBeNull();
    expect(parseAsaasAmountToCents(null as unknown)).toBeNull();
    expect(parseAsaasAmountToCents(undefined as unknown)).toBeNull();
    expect(parseAsaasAmountToCents({} as unknown)).toBeNull();
  });

  it("A04-10: valor absurdo fora de inteiro seguro -> null", () => {
    expect(parseAsaasAmountToCents(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
