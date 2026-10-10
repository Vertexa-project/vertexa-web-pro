import { describe, expect, it } from "vitest";

import {
  PATIENT_DELETE_GENERIC_ERROR,
  isPatientDeleteConfirmed,
  patientDeleteErrorMessage,
  resolvePatientDeleteUi,
} from "./patientDeletion";

const ok = { isLoading: false, isError: false };

describe("isPatientDeleteConfirmed", () => {
  it("exige a palavra EXCLUIR (espaços nas pontas tolerados)", () => {
    expect(isPatientDeleteConfirmed("EXCLUIR")).toBe(true);
    expect(isPatientDeleteConfirmed("  EXCLUIR ")).toBe(true);
    expect(isPatientDeleteConfirmed("excluir")).toBe(false);
    expect(isPatientDeleteConfirmed("")).toBe(false);
    expect(isPatientDeleteConfirmed("EXCLUI")).toBe(false);
  });
});

describe("resolvePatientDeleteUi — fail-closed", () => {
  it("carregando", () => {
    expect(resolvePatientDeleteUi({ data: undefined, isLoading: true, isError: false })).toEqual({ kind: "loading" });
  });

  it("erro ou sem dados => bloqueado", () => {
    expect(resolvePatientDeleteUi({ data: undefined, isLoading: false, isError: true }).kind).toBe("blocked");
    expect(resolvePatientDeleteUi({ data: undefined, ...ok }).kind).toBe("blocked");
  });

  it("elegível só com eligible=true E reason=PATIENT_DELETE_ELIGIBLE", () => {
    expect(resolvePatientDeleteUi({ data: { eligible: true, reason: "PATIENT_DELETE_ELIGIBLE" }, ...ok })).toEqual({
      kind: "eligible",
    });
    expect(resolvePatientDeleteUi({ data: { eligible: true, reason: "" }, ...ok }).kind).toBe("blocked");
  });

  it.each([
    ["PATIENT_DELETE_AUTH_LINKED", "Este paciente já possui uma conta de acesso vinculada."],
    ["PATIENT_DELETE_HAS_PLANS", "Este paciente já possui movimentações na plataforma e não pode ser excluído."],
    ["PATIENT_DELETE_HAS_ACTIVITY", "Este paciente já possui movimentações na plataforma e não pode ser excluído."],
    [
      "PATIENT_DELETE_HAS_CLINICAL_DATA",
      "Para preservar o histórico clínico, cadastros que já possuem dados não podem ser excluídos.",
    ],
  ])("%s => mensagem humana", (reason, message) => {
    expect(resolvePatientDeleteUi({ data: { eligible: false, reason }, ...ok })).toEqual({ kind: "blocked", message });
  });

  it("nenhuma mensagem expõe nome de tabela ou código técnico", () => {
    const reasons = [
      "PATIENT_DELETE_AUTH_LINKED",
      "PATIENT_DELETE_AUTH_EMAIL_CONFLICT",
      "PATIENT_DELETE_AMBIGUOUS_IDENTITY",
      "PATIENT_DELETE_HAS_CLINICAL_DATA",
      "PATIENT_DELETE_HAS_DOCUMENTS",
      "PATIENT_DELETE_HAS_PLANS",
      "PATIENT_DELETE_HAS_MESSAGES",
      "PATIENT_DELETE_HAS_ACTIVITY",
      "PATIENT_DELETE_NOT_ADMIN",
      "PATIENT_DELETE_FOREIGN_CLINIC",
      "UNKNOWN_CODE",
    ];
    for (const reason of reasons) {
      const ui = resolvePatientDeleteUi({ data: { eligible: false, reason }, ...ok });
      expect(ui.kind).toBe("blocked");
      if (ui.kind === "blocked") {
        expect(ui.message).not.toMatch(/_|patients|profiles|auth\.|chat_|PATIENT_/);
      }
    }
  });
});

describe("patientDeleteErrorMessage", () => {
  it("traduz a hint do servidor", () => {
    expect(patientDeleteErrorMessage({ hint: "PATIENT_DELETE_AUTH_LINKED" })).toBe(
      "Este paciente já possui uma conta de acesso vinculada.",
    );
    expect(patientDeleteErrorMessage({ hint: "PATIENT_NOT_FOUND" })).toBe("Este cadastro não existe mais.");
  });

  it("erro desconhecido => mensagem genérica", () => {
    expect(patientDeleteErrorMessage(new Error("boom"))).toBe(PATIENT_DELETE_GENERIC_ERROR);
  });
});
