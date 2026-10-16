import { describe, expect, it } from "vitest";

import { validateCustomPeriod } from "./reportPeriod";

const TODAY = "2026-10-16";

describe("validateCustomPeriod", () => {
  it("aceita período válido (inclusive o limite de 366 dias e um único dia)", () => {
    expect(validateCustomPeriod("2026-09-01", "2026-10-16", TODAY)).toBeNull();
    expect(validateCustomPeriod("2026-10-16", "2026-10-16", TODAY)).toBeNull();
    expect(validateCustomPeriod("2025-10-15", "2026-10-16", TODAY)).toBeNull(); // 366 dias
  });
  it("exige as duas datas", () => {
    expect(validateCustomPeriod("", "2026-10-16", TODAY)).toMatch(/Informe/);
    expect(validateCustomPeriod("2026-10-01", "", TODAY)).toMatch(/Informe/);
  });
  it("recusa início depois do fim e fim no futuro", () => {
    expect(validateCustomPeriod("2026-10-10", "2026-10-01", TODAY)).toMatch(/depois da final/);
    expect(validateCustomPeriod("2026-10-01", "2026-10-17", TODAY)).toMatch(/futuro/);
  });
  it("recusa janela acima de 366 dias (limite da RPC)", () => {
    expect(validateCustomPeriod("2025-10-14", "2026-10-16", TODAY)).toMatch(/12 meses/);
  });
});
