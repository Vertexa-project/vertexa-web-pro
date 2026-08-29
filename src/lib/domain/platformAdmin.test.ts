import { describe, expect, it } from "vitest";

import {
  aggregatePlatformClinicStats,
  PLATFORM_CLINIC_VISIBLE_COLUMNS,
  resolvePendingOnboardingGate,
  resolvePlatformAdminAccess,
  resolvePostAuthDestination,
} from "./platformAdmin";

describe("resolvePlatformAdminAccess — FAIL-CLOSED, erro ≠ false", () => {
  it("RPC true ⇒ granted", () => {
    expect(resolvePlatformAdminAccess({ data: true, isLoading: false, isError: false })).toBe(
      "granted",
    );
  });

  it("RPC false ⇒ denied (não é erro)", () => {
    expect(resolvePlatformAdminAccess({ data: false, isLoading: false, isError: false })).toBe(
      "denied",
    );
  });

  it("carregando ⇒ loading (não deny, não grant)", () => {
    expect(resolvePlatformAdminAccess({ data: undefined, isLoading: true, isError: false })).toBe(
      "loading",
    );
  });

  it("sem dado ainda, sem loading explícito ⇒ loading (não assume false)", () => {
    expect(resolvePlatformAdminAccess({ data: undefined, isLoading: false, isError: false })).toBe(
      "loading",
    );
  });

  it("erro ⇒ error, mesmo com data stale=true", () => {
    expect(resolvePlatformAdminAccess({ data: true, isLoading: false, isError: true })).toBe("error");
  });

  it("erro ⇒ error, mesmo com data stale=false (não vira denied)", () => {
    expect(resolvePlatformAdminAccess({ data: false, isLoading: false, isError: true })).toBe("error");
  });
});

describe("resolvePostAuthDestination — AccessResolver único", () => {
  it("T16 — PA true → /platform", () => {
    expect(resolvePostAuthDestination("granted")).toEqual({ kind: "navigate", to: "/platform" });
  });

  it("T17 — PA false → /", () => {
    expect(resolvePostAuthDestination("denied")).toEqual({ kind: "navigate", to: "/" });
  });

  it("T18 — RPC error → fail closed (não navega)", () => {
    expect(resolvePostAuthDestination("error")).toEqual({ kind: "error" });
  });

  it("loading não navega", () => {
    expect(resolvePostAuthDestination("loading")).toEqual({ kind: "loading" });
  });
});

describe("resolvePendingOnboardingGate — PA não cai no CreateClinicForm", () => {
  it("T5 — PA true + pending → platform, não onboarding", () => {
    expect(resolvePendingOnboardingGate("granted")).toBe("platform");
  });

  it("T7 — erro na RPC → error, não onboarding", () => {
    expect(resolvePendingOnboardingGate("error")).toBe("error");
  });

  it("T10 — PA false → onboarding clínico atual", () => {
    expect(resolvePendingOnboardingGate("denied")).toBe("onboarding");
  });

  it("loading não libera onboarding", () => {
    expect(resolvePendingOnboardingGate("loading")).toBe("loading");
  });
});

describe("aggregatePlatformClinicStats — T12 cards só com counts da RPC", () => {
  it("soma clínicas, profissionais e pacientes no client", () => {
    expect(
      aggregatePlatformClinicStats([
        { professionalCount: 1, patientCount: 2 },
        { professionalCount: 2, patientCount: 3 },
      ]),
    ).toEqual({ clinicCount: 2, professionalCount: 3, patientCount: 5 });
  });

  it("lista vazia zera os totais (não hardcoda o baseline de produção)", () => {
    expect(aggregatePlatformClinicStats([])).toEqual({
      clinicCount: 0,
      professionalCount: 0,
      patientCount: 0,
    });
  });
});

describe("colunas visíveis da V1", () => {
  it("T13 — clinicId e ownerProfileId não entram nas colunas visíveis", () => {
    expect(PLATFORM_CLINIC_VISIBLE_COLUMNS).not.toContain("clinicId");
    expect(PLATFORM_CLINIC_VISIBLE_COLUMNS).not.toContain("ownerProfileId");
    expect(PLATFORM_CLINIC_VISIBLE_COLUMNS).toEqual([
      "clinicName",
      "createdAt",
      "professionalCount",
      "patientCount",
    ]);
  });
});
