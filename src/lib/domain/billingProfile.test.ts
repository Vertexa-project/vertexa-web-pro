import { describe, expect, it } from "vitest";

import {
  billingProfileErrorMessage,
  formatBillingPhone,
  formatTaxId,
  isExpectedBillingProfileError,
  maskTaxId,
  normalizeBillingEmail,
  normalizeBillingAddress,
  normalizeBillingAddressNumber,
  normalizeBillingPostalCode,
  normalizeBillingProvince,
  normalizeTaxId,
  taxIdLooksValid,
  validateBillingEmail,
  validateLegalName,
  validateTaxId,
  validateBillingPhone,
  validateRequiredBillingPhone,
  validateBillingAddress,
  validateBillingAddressNumber,
  validateRequiredBillingPostalCode,
  validateRequiredBillingProvince,
  formatBillingPostalCode,
} from "./billingProfile";

describe("normalizeTaxId", () => {
  it("remove pontuação de CPF e CNPJ", () => {
    expect(normalizeTaxId("123.456.789-00")).toBe("12345678900");
    expect(normalizeTaxId("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizeTaxId("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });
});

describe("taxIdLooksValid — UX only", () => {
  it("aceita CPF e CNPJ com checksum", () => {
    expect(taxIdLooksValid("99991111140")).toBe(true);
    expect(taxIdLooksValid("999.911.111-40")).toBe(true);
    expect(taxIdLooksValid("11222333000181")).toBe(true);
    expect(taxIdLooksValid("11.222.333/0001-81")).toBe(true);
    expect(taxIdLooksValid("12.ABC.345/01DE-35")).toBe(true);
  });

  it("rejeita checksum, repetidos, comprimento e vazio", () => {
    expect(taxIdLooksValid("123.456.789-00")).toBe(false);
    expect(taxIdLooksValid("11111111111")).toBe(false);
    expect(taxIdLooksValid("00000000000000")).toBe(false);
    expect(taxIdLooksValid("11222333000180")).toBe(false);
    expect(taxIdLooksValid("12.ABC.345/01DE-34")).toBe(false);
    expect(taxIdLooksValid("12.ABC.345/01D!-35")).toBe(false);
    expect(taxIdLooksValid("123")).toBe(false);
    expect(taxIdLooksValid("")).toBe(false);
  });
});

describe("billing document and phone formatting", () => {
  it("formats alphanumeric CNPJ visually while preserving its canonical letters", () => {
    expect(formatTaxId("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(validateTaxId("12.ABC.345/01DE-35")).toEqual({ ok: true, value: "12ABC34501DE35" });
  });

  it("normalizes an authorized country prefix and rejects invalid mobile input", () => {
    expect(formatBillingPhone("+55 (98) 99999-9999")).toBe("(98) 99999-9999");
    expect(validateBillingPhone("+55 (98) 99999-9999")).toEqual({ ok: true, value: "98999999999" });
    expect(validateBillingPhone("(10) 89999-9999").ok).toBe(false);
    expect(validateBillingPhone("(98) 89999-9999").ok).toBe(false);
    expect(validateBillingPhone("telefone").ok).toBe(false);
  });

  it("requires the billing phone only for checkout-ready collection", () => {
    expect(validateBillingPhone("")).toEqual({ ok: true, value: null });
    expect(validateRequiredBillingPhone("")).toEqual({ ok: false, message: "Informe o telefone de cobrança." });
    expect(validateRequiredBillingPhone("(98) 99999-9999")).toEqual({ ok: true, value: "98999999999" });
  });
});

describe("billing address", () => {
  it("trims address fields and accepts a Brazilian S/N representation", () => {
    expect(normalizeBillingAddress("  Rua das Flores  ")).toBe("Rua das Flores");
    expect(normalizeBillingAddressNumber(" S/N ")).toBe("S/N");
    expect(validateBillingAddress(" Rua das Flores ")).toEqual({ ok: true, value: "Rua das Flores" });
    expect(validateBillingAddressNumber(" S/N ")).toEqual({ ok: true, value: "S/N" });
  });

  it("rejects whitespace-only address fields with actionable copy", () => {
    expect(validateBillingAddress("  ")).toEqual({ ok: false, message: "Informe o endereço de cobrança." });
    expect(validateBillingAddressNumber("  ")).toEqual({ ok: false, message: "Informe o número do endereço." });
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

describe("billing postal code and province", () => {
  it("normalizes and formats CEP", () => {
    expect(normalizeBillingPostalCode(" 65000-000 ")).toBe("65000000");
    expect(formatBillingPostalCode("65000000")).toBe("65000-000");
    expect(validateRequiredBillingPostalCode("65000-000")).toEqual({ ok: true, value: "65000000" });
  });

  it("rejects invalid CEP without silently removing letters", () => {
    expect(validateRequiredBillingPostalCode("65000-00").ok).toBe(false);
    expect(validateRequiredBillingPostalCode("65000A000").ok).toBe(false);
    expect(validateRequiredBillingPostalCode(" ").ok).toBe(false);
  });

  it("trims bairro and requires a nonblank value", () => {
    expect(normalizeBillingProvince("  Centro ")).toBe("Centro");
    expect(validateRequiredBillingProvince("  Centro ")).toEqual({ ok: true, value: "Centro" });
    expect(validateRequiredBillingProvince("  ").ok).toBe(false);
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
