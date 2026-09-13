import { describe, expect, it } from "vitest";

import {
  billingProfileErrorMessage,
  isExpectedBillingProfileError,
  maskTaxId,
  normalizeBillingEmail,
  normalizeTaxId,
  taxIdLooksValid,
  validateBillingEmail,
  validateLegalName,
  validateTaxId,
} from "./billingProfile";

describe("normalizeTaxId", () => {
  it("remove pontuação de CPF e CNPJ", () => {
    expect(normalizeTaxId("123.456.789-00")).toBe("12345678900");
    expect(normalizeTaxId("12.345.678/0001-90")).toBe("12345678000190");
  });
});

describe("taxIdLooksValid — UX only", () => {
  it("aceita CPF e CNPJ com checksum", () => {
    expect(taxIdLooksValid("99991111140")).toBe(true);
    expect(taxIdLooksValid("999.911.111-40")).toBe(true);
    expect(taxIdLooksValid("11222333000181")).toBe(true);
    expect(taxIdLooksValid("11.222.333/0001-81")).toBe(true);
  });

  it("rejeita checksum, repetidos, comprimento e vazio", () => {
    expect(taxIdLooksValid("123.456.789-00")).toBe(false);
    expect(taxIdLooksValid("11111111111")).toBe(false);
    expect(taxIdLooksValid("00000000000000")).toBe(false);
    expect(taxIdLooksValid("11222333000180")).toBe(false);
    expect(taxIdLooksValid("123")).toBe(false);
    expect(taxIdLooksValid("")).toBe(false);
  });
});

describe("validateTaxId", () => {
  it("normaliza entrada formatada válida", () => {
    expect(validateTaxId("999.911.111-40")).toEqual({ ok: true, value: "99991111140" });
  });

  it("rejeita em branco", () => {
    expect(validateTaxId("   ")).toEqual({ ok: false, message: "Informe o CPF ou CNPJ." });
  });
});

describe("maskTaxId", () => {
  it("mascara CPF e CNPJ sem exibir o documento", () => {
    expect(maskTaxId("99991111140")).toBe("***.***.***-40");
    expect(maskTaxId("11222333000181")).toBe("**.***.***/****-81");
  });
});

describe("validateLegalName / email", () => {
  it("trim e e-mail em minúsculas", () => {
    expect(validateLegalName("  Clínica Alfa  ")).toEqual({ ok: true, value: "Clínica Alfa" });
    expect(normalizeBillingEmail("  BILL@T.TEST  ")).toBe("bill@t.test");
    expect(validateBillingEmail("bill@t.test").ok).toBe(true);
    expect(validateBillingEmail("nao-email").ok).toBe(false);
  });
});

describe("erros de RPC", () => {
  it("não ecoa documento fiscal na mensagem", () => {
    const err = { hint: "BILLING_INVALID_TAX_ID", message: "BILLING_INVALID_TAX_ID" };
    expect(isExpectedBillingProfileError(err)).toBe(true);
    expect(billingProfileErrorMessage(err)).not.toMatch(/\d{11}/);
    expect(billingProfileErrorMessage(err)).toContain("CPF ou CNPJ");
  });
});
