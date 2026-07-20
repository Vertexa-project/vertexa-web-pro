import { describe, expect, it } from "vitest";

import { resolveClinicAdmin } from "./clinicAdmin";

describe("resolveClinicAdmin — FAIL-CLOSED (autoridade vem do banco, nunca de profiles.role)", () => {
  describe("modo REAL (usa a RPC am_i_clinic_admin)", () => {
    it("RPC true ⇒ admin", () => {
      expect(
        resolveClinicAdmin({ demoMode: false, demoIsAdmin: false, data: true, isError: false }),
      ).toBe(true);
    });

    it("RPC false ⇒ NÃO-admin", () => {
      expect(
        resolveClinicAdmin({ demoMode: false, demoIsAdmin: true, data: false, isError: false }),
      ).toBe(false);
    });

    it("carregando (data undefined) ⇒ NÃO-admin (fail-closed, não pisca a área aberta)", () => {
      expect(
        resolveClinicAdmin({ demoMode: false, demoIsAdmin: true, data: undefined, isError: false }),
      ).toBe(false);
    });

    it("erro na consulta ⇒ NÃO-admin (fail-closed)", () => {
      expect(
        resolveClinicAdmin({ demoMode: false, demoIsAdmin: true, data: undefined, isError: true }),
      ).toBe(false);
    });

    it("erro mesmo com data stale=true ⇒ NÃO-admin (erro tem precedência, fail-closed)", () => {
      expect(
        resolveClinicAdmin({ demoMode: false, demoIsAdmin: false, data: true, isError: true }),
      ).toBe(false);
    });

    it("profiles.role NÃO influencia: demoIsAdmin=true é ignorado fora do modo demo", () => {
      // Prova AUTH-ADMIN-1: no modo real a persona/role local não decide nada; só a RPC.
      expect(
        resolveClinicAdmin({ demoMode: false, demoIsAdmin: true, data: false, isError: false }),
      ).toBe(false);
    });
  });

  describe("modo DEMO (sem sessão real: espelha a persona do seletor)", () => {
    it("persona admin ⇒ admin", () => {
      expect(
        resolveClinicAdmin({ demoMode: true, demoIsAdmin: true, data: undefined, isError: false }),
      ).toBe(true);
    });

    it("persona não-admin ⇒ NÃO-admin", () => {
      expect(
        resolveClinicAdmin({ demoMode: true, demoIsAdmin: false, data: undefined, isError: false }),
      ).toBe(false);
    });

    it("em demo, a RPC é ignorada (mesmo que tivesse retornado true)", () => {
      expect(
        resolveClinicAdmin({ demoMode: true, demoIsAdmin: false, data: true, isError: false }),
      ).toBe(false);
    });
  });
});
