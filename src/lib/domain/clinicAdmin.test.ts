import { describe, expect, it } from "vitest";

import { resolveClinicAdmin } from "./clinicAdmin";

describe("resolveClinicAdmin — FAIL-CLOSED (autoridade vem do banco, nunca de profiles.role)", () => {
  it("RPC true ⇒ admin", () => {
    expect(resolveClinicAdmin({ data: true, isError: false })).toBe(true);
  });

  it("RPC false ⇒ NÃO-admin", () => {
    expect(resolveClinicAdmin({ data: false, isError: false })).toBe(false);
  });

  it("carregando (data undefined) ⇒ NÃO-admin (fail-closed, não pisca a área aberta)", () => {
    expect(resolveClinicAdmin({ data: undefined, isError: false })).toBe(false);
  });

  it("erro na consulta ⇒ NÃO-admin (fail-closed)", () => {
    expect(resolveClinicAdmin({ data: undefined, isError: true })).toBe(false);
  });

  it("erro mesmo com data stale=true ⇒ NÃO-admin (erro tem precedência, fail-closed)", () => {
    expect(resolveClinicAdmin({ data: true, isError: true })).toBe(false);
  });
});
