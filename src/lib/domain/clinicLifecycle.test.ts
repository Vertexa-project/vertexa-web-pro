import { describe, expect, it } from "vitest";

import {
  canReactivateClinic,
  canSuspendClinic,
  clinicLifecycleErrorMessage,
  clinicLifecycleLabel,
  isExpectedClinicLifecycleError,
  isOperationalClinicStatus,
  normalizeSuspendReason,
} from "./clinicLifecycle";

describe("isOperationalClinicStatus", () => {
  it("active e ausente contam como operacional (default do banco)", () => {
    expect(isOperationalClinicStatus("active")).toBe(true);
    expect(isOperationalClinicStatus(null)).toBe(true);
    expect(isOperationalClinicStatus(undefined)).toBe(true);
  });

  it("suspended é fail-closed", () => {
    expect(isOperationalClinicStatus("suspended")).toBe(false);
    expect(isOperationalClinicStatus("unknown")).toBe(false);
  });
});

describe("clinicLifecycleLabel — badge do catálogo PA", () => {
  it("S27 — Ativa / Suspensa", () => {
    expect(clinicLifecycleLabel("active")).toBe("Ativa");
    expect(clinicLifecycleLabel("suspended")).toBe("Suspensa");
  });
});

describe("canSuspendClinic / canReactivateClinic", () => {
  it("só oferece Suspender quando active", () => {
    expect(canSuspendClinic("active")).toBe(true);
    expect(canSuspendClinic("suspended")).toBe(false);
  });

  it("só oferece Reativar quando suspended", () => {
    expect(canReactivateClinic("suspended")).toBe(true);
    expect(canReactivateClinic("active")).toBe(false);
  });
});

describe("normalizeSuspendReason — motivo obrigatório", () => {
  it("S28 — vazio / curto / só espaço recusa", () => {
    expect(normalizeSuspendReason("")).toBeNull();
    expect(normalizeSuspendReason("  ")).toBeNull();
    expect(normalizeSuspendReason("ab")).toBeNull();
  });

  it("S28 — motivo com 3+ caracteres passa trimmed", () => {
    expect(normalizeSuspendReason("  atraso  ")).toBe("atraso");
  });
});

describe("clinicLifecycleErrorMessage", () => {
  it("não-PA e já-suspensa têm hint explícito", () => {
    expect(clinicLifecycleErrorMessage({ code: "42501", hint: "NOT_PLATFORM_ADMIN" })).toContain(
      "plataforma",
    );
    expect(
      clinicLifecycleErrorMessage({ code: "22023", hint: "CLINIC_ALREADY_SUSPENDED" }),
    ).toContain("já está suspensa");
    expect(clinicLifecycleErrorMessage({ code: "22023", hint: "CLINIC_ALREADY_ACTIVE" })).toContain(
      "já está ativa",
    );
    expect(clinicLifecycleErrorMessage({ code: "22023", hint: "REASON_REQUIRED" })).toContain(
      "motivo",
    );
  });

  it("erros esperados não vão ao Sentry", () => {
    expect(isExpectedClinicLifecycleError({ code: "42501", hint: "NOT_PLATFORM_ADMIN" })).toBe(
      true,
    );
    expect(isExpectedClinicLifecycleError({ code: "P0002", hint: "CLINIC_NOT_FOUND" })).toBe(true);
    expect(isExpectedClinicLifecycleError(new Error("boom"))).toBe(false);
  });
});
