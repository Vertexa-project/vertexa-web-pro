import { describe, expect, it } from "vitest";

import {
  isExpectedOnboardingError,
  onboardingErrorHint,
  onboardingErrorMessage,
  validateClinicName,
} from "./clinicOnboarding";

describe("validateClinicName — MESMAS regras do banco (obrigatório; 2..120, após trim)", () => {
  it("vazio ⇒ inválido", () => {
    expect(validateClinicName("").ok).toBe(false);
  });
  it("só espaços ⇒ inválido (trim)", () => {
    expect(validateClinicName("   ").ok).toBe(false);
  });
  it("1 caractere ⇒ inválido (curto)", () => {
    expect(validateClinicName("a").ok).toBe(false);
  });
  it("121 caracteres ⇒ inválido (longo)", () => {
    expect(validateClinicName("x".repeat(121)).ok).toBe(false);
  });
  it("nome válido ⇒ ok e normaliza (trim)", () => {
    const r = validateClinicName("  Clínica Alfa  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("Clínica Alfa");
  });
  it("limites exatos 2 e 120 ⇒ válidos", () => {
    expect(validateClinicName("ab").ok).toBe(true);
    expect(validateClinicName("x".repeat(120)).ok).toBe(true);
  });
});

describe("onboardingErrorMessage — traduz o hint da RPC (nunca erro cru, sem PII)", () => {
  it("ALREADY_OWNS_CLINIC ⇒ mensagem do guarda-corpo", () => {
    expect(onboardingErrorMessage({ hint: "ALREADY_OWNS_CLINIC" })).toMatch(/uma clínica/i);
  });
  it("NAME_TOO_LONG ⇒ mensagem de tamanho", () => {
    expect(onboardingErrorMessage({ hint: "NAME_TOO_LONG" })).toMatch(/máximo/i);
  });
  it("ONBOARDING_NOT_ALLOWED (portão comercial futuro) ⇒ já mapeado", () => {
    expect(onboardingErrorMessage({ hint: "ONBOARDING_NOT_ALLOWED" })).toMatch(/liberada/i);
  });
  it("erro desconhecido/sem hint ⇒ mensagem genérica (não vaza detalhe)", () => {
    expect(onboardingErrorMessage(new Error("pg boom xyz"))).toMatch(/tente novamente/i);
    expect(onboardingErrorMessage(null)).toMatch(/tente novamente/i);
    expect(onboardingErrorMessage({ hint: "SOMETHING_ELSE" })).toMatch(/tente novamente/i);
  });
});

describe("classificação para o Sentry (só o inesperado é reportado)", () => {
  it("hint conhecido ⇒ esperado (NÃO vai ao Sentry)", () => {
    expect(isExpectedOnboardingError({ hint: "ALREADY_OWNS_CLINIC" })).toBe(true);
    expect(onboardingErrorHint({ hint: "NAME_REQUIRED" })).toBe("NAME_REQUIRED");
  });
  it("erro sem hint conhecido ⇒ inesperado (vai ao Sentry)", () => {
    expect(isExpectedOnboardingError(new Error("boom"))).toBe(false);
    expect(onboardingErrorHint({ hint: "SOMETHING_ELSE" })).toBeNull();
    expect(onboardingErrorHint(null)).toBeNull();
  });
});
