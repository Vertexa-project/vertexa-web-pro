import { describe, expect, it } from "vitest";

import { formatTaxId, isValidCnpj, isValidCpf, isValidTaxId, maskTaxId, onlyDigits } from "./taxId";

describe("CPF / CNPJ", () => {
  it("valida dígitos verificadores do CPF", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });
  it("valida dígitos verificadores do CNPJ", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
  it("decide pelo tamanho; formata e mascara", () => {
    expect(isValidTaxId("52998224725")).toBe(true);
    expect(isValidTaxId("11222333000181")).toBe(true);
    expect(isValidTaxId("123")).toBe(false);
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
    expect(formatTaxId("52998224725")).toBe("529.982.247-25");
    expect(formatTaxId("11222333000181")).toBe("11.222.333/0001-81");
    expect(maskTaxId("52998224725")).toBe("•••25");
  });
});
