import { describe, expect, it } from "vitest";

import {
  PATIENT_REGISTRATION_GENERIC_ERROR,
  normalizePatientEmail,
  parseDecimalField,
  patientRegistrationErrorHint,
  patientRegistrationErrorMessage,
  resolvePatientAccessUi,
  validatePatientEmail,
} from "./patientRegistration";

describe("normalizePatientEmail — trim + lowercase, sem heurística de Gmail", () => {
  it("compara case/trim como o mesmo e-mail", () => {
    expect(normalizePatientEmail("  John@Example.com ")).toBe(normalizePatientEmail("john@example.com"));
  });
  it("NÃO trata pontos de Gmail como iguais", () => {
    expect(normalizePatientEmail("john.smith@gmail.com")).not.toBe(normalizePatientEmail("johnsmith@gmail.com"));
  });
  it("NÃO remove +alias", () => {
    expect(normalizePatientEmail("a+x@gmail.com")).not.toBe(normalizePatientEmail("a@gmail.com"));
  });
  it("null/undefined viram string vazia", () => {
    expect(normalizePatientEmail(null)).toBe("");
    expect(normalizePatientEmail(undefined)).toBe("");
  });
});

describe("validatePatientEmail", () => {
  it("vazio sem e-mail prévio é ok (null)", () => {
    expect(validatePatientEmail("  ", false)).toEqual({ ok: true, value: null });
  });
  it("vazio com e-mail prévio é erro (não pode remover)", () => {
    expect(validatePatientEmail("", true)).toMatchObject({ ok: false });
  });
  it("sintaxe inválida", () => {
    expect(validatePatientEmail("sem-arroba", false)).toMatchObject({ ok: false });
    expect(validatePatientEmail("a@b", false)).toMatchObject({ ok: false });
    expect(validatePatientEmail("a b@c.com", false)).toMatchObject({ ok: false });
  });
  it("válido devolve o valor com trim (case preservado)", () => {
    expect(validatePatientEmail("  Nome@Gmail.com ", true)).toEqual({ ok: true, value: "Nome@Gmail.com" });
  });
});

describe("parseDecimalField", () => {
  it("vírgula decimal", () => expect(parseDecimalField("72,5")).toEqual({ ok: true, value: 72.5 }));
  it("vazio → null", () => expect(parseDecimalField("  ")).toEqual({ ok: true, value: null }));
  it("texto não numérico NÃO vira null em silêncio", () => {
    expect(parseDecimalField("abc")).toEqual({ ok: false });
  });
});

describe("patientRegistrationErrorMessage", () => {
  it("lê a hint do erro", () => {
    expect(patientRegistrationErrorHint({ hint: "PATIENT_EMAIL_IN_USE" })).toBe("PATIENT_EMAIL_IN_USE");
    expect(patientRegistrationErrorHint(new Error("x"))).toBe("");
  });
  it("e-mail duplicado → mensagem humana pedida", () => {
    expect(patientRegistrationErrorMessage({ hint: "PATIENT_EMAIL_IN_USE" })).toBe(
      "Este e-mail já está associado a outro cadastro.",
    );
  });
  it("conta já vinculada", () => {
    expect(patientRegistrationErrorMessage({ hint: "PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED" })).toMatch(
      /conta de acesso vinculada/i,
    );
  });
  it("não-admin", () => {
    expect(patientRegistrationErrorMessage({ hint: "PATIENT_EDIT_ADMIN_REQUIRED" })).toMatch(/administradores/i);
  });
  it("corrida do double submit", () => {
    expect(patientRegistrationErrorMessage({ hint: "PATIENT_CHANGED_CONCURRENTLY" })).toMatch(/alterado/i);
  });
  it("hint desconhecida e erro cru caem no genérico, sem vazar detalhe técnico", () => {
    expect(patientRegistrationErrorMessage({ hint: "ALGO_NOVO", message: "secret detail" })).toBe(
      PATIENT_REGISTRATION_GENERIC_ERROR,
    );
    expect(patientRegistrationErrorMessage(new Error("boom"))).toBe(PATIENT_REGISTRATION_GENERIC_ERROR);
  });
  it("mensagens não citam termos técnicos", () => {
    const all = [
      "PATIENT_EMAIL_IN_USE",
      "PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED",
      "PATIENT_EDIT_ADMIN_REQUIRED",
      "PATIENT_CHANGED_CONCURRENTLY",
    ].map((hint) => patientRegistrationErrorMessage({ hint }));
    for (const m of all) expect(m).not.toMatch(/supabase|pending|auth_user|rpc/i);
  });
});

describe("resolvePatientAccessUi — fail-closed", () => {
  it("carregando", () => {
    expect(resolvePatientAccessUi({ data: undefined, isLoading: true, isError: false })).toEqual({ kind: "loading" });
  });
  it("erro ⇒ e-mail NÃO editável e não exibido como autoridade", () => {
    expect(resolvePatientAccessUi({ data: undefined, isLoading: false, isError: true })).toEqual({
      kind: "linked",
      emailTrusted: false,
    });
  });
  it("sem conta ⇒ editável", () => {
    expect(
      resolvePatientAccessUi({
        data: { hasLoginAccount: false, loginEmailMatchesRegistration: null },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "no-account" });
  });
  it("com conta e e-mail coerente ⇒ somente leitura, confiável", () => {
    expect(
      resolvePatientAccessUi({
        data: { hasLoginAccount: true, loginEmailMatchesRegistration: true },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "linked", emailTrusted: true });
  });
  it("LEGACY_AUTH_EMAIL_DRIFT ⇒ somente leitura, NÃO confiável", () => {
    expect(
      resolvePatientAccessUi({
        data: { hasLoginAccount: true, loginEmailMatchesRegistration: false },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "linked", emailTrusted: false });
  });
});
