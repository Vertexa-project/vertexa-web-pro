import { describe, expect, it } from "vitest";

import { licenseState } from "./licenseState";

const now = new Date("2026-11-13T12:00:00");
describe("licença sanitária da unidade", () => {
  it("sem número e sem validade: sem licença", () => expect(licenseState({ license_number: null, license_valid_until: null }, now)).toBe("none"));
  it("número sem validade: válida", () => expect(licenseState({ license_number: "LS-1", license_valid_until: null }, now)).toBe("valid"));
  it("vencida", () => expect(licenseState({ license_number: "LS-1", license_valid_until: "2026-11-12" }, now)).toBe("expired"));
  it("vence no próprio dia: ainda vale; em 30 dias: a vencer; em 1 ano: válida", () => {
    expect(licenseState({ license_number: "x", license_valid_until: "2026-11-13" }, now)).toBe("expiring");
    expect(licenseState({ license_number: "x", license_valid_until: "2026-12-13" }, now)).toBe("expiring");
    expect(licenseState({ license_number: "x", license_valid_until: "2027-11-13" }, now)).toBe("valid");
  });
});
