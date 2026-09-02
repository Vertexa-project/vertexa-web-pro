import { describe, expect, it } from "vitest";

import {
  isExpectedOnboardingError,
  onboardingErrorHint,
  onboardingErrorMessage,
  resolveCreateClinicSurface,
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
  it("ONBOARDING_NOT_ALLOWED (sem grant em manual_review) ⇒ já mapeado", () => {
    expect(onboardingErrorMessage({ hint: "ONBOARDING_NOT_ALLOWED" })).toMatch(/liberada/i);
  });
  it("ONBOARDING_CLOSED ⇒ indisponível, sem parecer empty de equipe", () => {
    expect(onboardingErrorMessage({ hint: "ONBOARDING_CLOSED" })).toMatch(/indisponíveis/i);
  });
  it("APPROVED_CLINIC_NAME_MISMATCH ⇒ exige o nome aprovado", () => {
    expect(onboardingErrorMessage({ hint: "APPROVED_CLINIC_NAME_MISMATCH" })).toMatch(/nome aprovado/i);
    expect(isExpectedOnboardingError({ hint: "APPROVED_CLINIC_NAME_MISMATCH" })).toBe(true);
  });
  it("PROFILE_NOT_FOUND ⇒ sessão ok, perfil ausente", () => {
    expect(onboardingErrorMessage({ hint: "PROFILE_NOT_FOUND" })).toMatch(/perfil Vertexa não foi encontrado/i);
    expect(isExpectedOnboardingError({ hint: "PROFILE_NOT_FOUND" })).toBe(true);
  });
  it("REQUEST_ALREADY_APPROVED ⇒ pede para concluir a criação", () => {
    expect(onboardingErrorMessage({ hint: "REQUEST_ALREADY_APPROVED" })).toMatch(/aprovada/i);
    expect(isExpectedOnboardingError({ hint: "REQUEST_ALREADY_APPROVED" })).toBe(true);
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

describe("resolveCreateClinicSurface — 0/1/N e política", () => {
  const req = (
    status: "pending" | "approved" | "rejected",
    extra?: Partial<import("./clinicOnboarding").MyClinicCreationRequest>,
  ): import("./clinicOnboarding").MyClinicCreationRequest => ({
    id: "r1",
    requestedClinicName: "Alfa",
    status,
    requestedAt: "2026-09-01T00:00:00Z",
    decidedAt: null,
    rejectionReason: null,
    grantIsActive: status === "approved" ? true : null,
    ...extra,
  });

  it("closed ignora pedido existente", () => {
    expect(resolveCreateClinicSurface("closed", req("pending"))).toBe("closed");
  });
  it("automatic mostra criação direta", () => {
    expect(resolveCreateClinicSurface("automatic", null)).toBe("automatic");
  });
  it("manual sem pedido ⇒ solicitar", () => {
    expect(resolveCreateClinicSurface("manual_review", null)).toBe("request");
  });
  it("manual pending ⇒ aguardando", () => {
    expect(resolveCreateClinicSurface("manual_review", req("pending"))).toBe("pending");
  });
  it("manual approved ⇒ criar", () => {
    expect(resolveCreateClinicSurface("manual_review", req("approved"))).toBe("approved");
  });
  it("manual approved com grant expirado ⇒ solicitar de novo (S15)", () => {
    expect(
      resolveCreateClinicSurface("manual_review", req("approved", { grantIsActive: false })),
    ).toBe("expired");
  });
  it("manual rejected ⇒ recusado (pode pedir de novo)", () => {
    expect(resolveCreateClinicSurface("manual_review", req("rejected"))).toBe("rejected");
  });
});
