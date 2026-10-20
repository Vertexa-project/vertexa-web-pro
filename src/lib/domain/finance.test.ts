import { describe, expect, it } from "vitest";
import { centsToInput, tenureText, formatBRL, fmtDay, monthInRange, monthShort, monthStart, monthTitle, parseBRL, shiftMonth, statusText, validateBilling } from "./finance";

describe("finance domain", () => {
  it("parseBRL aceita formatos brasileiros", () => {
    expect(parseBRL("250")).toBe(25000);
    expect(parseBRL("250,5")).toBe(25050);
    expect(parseBRL("250,50")).toBe(25050);
    expect(parseBRL("1.250,50")).toBe(125050);
    expect(parseBRL("R$ 1.250,50")).toBe(125050);
    expect(parseBRL("1.250")).toBe(125000);
    expect(parseBRL("0")).toBe(0);
  });
  it("parseBRL recusa lixo, negativo, casas demais e valor absurdo", () => {
    for (const bad of ["", "abc", "-10", "10,505", "1,2,3", "12.34.5", "10.5", "99999999"]) expect(parseBRL(bad)).toBeNull();
    expect(parseBRL("10.000.000,00")).toBeNull();
  });
  it("formata em reais e volta para o campo", () => {
    expect(formatBRL(125050).replace(/\s/g, " ")).toBe("R$ 1.250,50");
    expect(formatBRL(null).replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(centsToInput(25000)).toBe("250,00");
    expect(centsToInput(null)).toBe("");
    expect(parseBRL(centsToInput(125050))).toBe(125050);
  });
  it("valida valor e dia (1 a 28)", () => {
    expect(validateBilling("", "10").ok).toBe(false);
    for (const d of ["0", "29", "1.5", "x", ""]) expect(validateBilling("100", d).ok).toBe(false);
    const ok = validateBilling("250,00", "28");
    expect(ok.ok && ok.value).toEqual({ amountCents: 25000, dueDay: 28 });
  });
  it("meses: título, atalho, deslocamento e limites do servidor", () => {
    expect(monthTitle("2026-10")).toBe("outubro de 2026");
    expect(monthShort("2026-01")).toBe("jan/26");
    expect(monthStart(new Date(2026, 9, 21))).toBe("2026-10-01");
    expect(shiftMonth("2026-10-01", 1)).toBe("2026-11-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(monthInRange("2026-11-01", "2026-10-01")).toBe(true);
    expect(monthInRange("2026-12-01", "2026-10-01")).toBe(false);
    expect(monthInRange("2025-10-01", "2026-10-01")).toBe(true);
    expect(monthInRange("2025-09-01", "2026-10-01")).toBe(false);
  });
  it("permanência no singular e com vírgula", () => {
    expect(tenureText(1)).toBe("1 mês");
    expect(tenureText(4)).toBe("4 meses");
    expect(tenureText(2.5)).toBe("2,5 meses");
  });
  it("situação da cobrança", () => {
    expect(fmtDay("2026-10-05")).toBe("05/10");
    expect(statusText({ status: "paid", overdue: false, paid_on: "2026-10-03" })).toBe("Pago em 03/10");
    expect(statusText({ status: "canceled", overdue: false, paid_on: null })).toBe("Cancelada");
    expect(statusText({ status: "pending", overdue: true, paid_on: null })).toBe("Em atraso");
    expect(statusText({ status: "pending", overdue: false, paid_on: null })).toBe("A vencer");
  });
});
