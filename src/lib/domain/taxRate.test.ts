import { describe, expect, it } from "vitest";

import { currentPeriod, effectiveTaxRate, isPeriod, taxRateNotice, type TaxRateRow } from "./taxRate";

const rates: TaxRateRow[] = [
  { period: "2026-08", rate_pct: 6, unit_id: null },
  { period: "2026-09", rate_pct: 6.5, unit_id: null },
  { period: "2026-09", rate_pct: 8, unit_id: "u2" },
];

describe("alíquota mensal herdada (critério F21)", () => {
  it("mês com alíquota própria: usa a dele, não herdada", () => {
    expect(effectiveTaxRate(rates, "2026-09")).toEqual({ found: true, ratePct: 6.5, inherited: false, sourcePeriod: "2026-09" });
  });
  it("mês novo sem alíquota usa a do mês anterior e sinaliza herança", () => {
    expect(effectiveTaxRate(rates, "2026-11")).toEqual({ found: true, ratePct: 6.5, inherited: true, sourcePeriod: "2026-09" });
  });
  it("a alíquota da unidade vence a da organização no mesmo mês", () => {
    expect(effectiveTaxRate(rates, "2026-09", "u2").ratePct).toBe(8);
    expect(effectiveTaxRate(rates, "2026-10", "u2")).toMatchObject({ ratePct: 8, inherited: true });
    expect(effectiveTaxRate(rates, "2026-09", "outra").ratePct).toBe(6.5);
  });
  it("antes da primeira alíquota: não encontrada", () => {
    expect(effectiveTaxRate(rates, "2026-01")).toEqual({ found: false, ratePct: null, inherited: false, sourcePeriod: null });
  });
  it("avisa o gestor quando herdada ou ausente; cala quando o mês tem a sua", () => {
    expect(taxRateNotice(effectiveTaxRate(rates, "2026-11"), "2026-11")).toMatch(/11\/2026 ainda não tem alíquota.*09\/2026.*6,5%/);
    expect(taxRateNotice(effectiveTaxRate(rates, "2026-01"), "2026-01")).toMatch(/Nenhuma alíquota/);
    expect(taxRateNotice(effectiveTaxRate(rates, "2026-09"), "2026-09")).toBeNull();
  });
  it("período AAAA-MM", () => {
    expect(isPeriod("2026-11")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("26-11")).toBe(false);
    expect(currentPeriod(new Date(2026, 10, 13))).toBe("2026-11");
  });
});
