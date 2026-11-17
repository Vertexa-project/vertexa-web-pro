import { describe, expect, it } from "vitest";

import { addDays, dateBR, formatMg, medErrorMessage, parseMg, stateText, validateApplication, validateDelivery, validateTreatment, weekdayLabel } from "./medication";

describe("medicação (A3): regras puras", () => {
  it("dose em mg com vírgula, sem zeros sobrando", () => {
    expect(formatMg(2.5)).toBe("2,5 mg");
    expect(formatMg(10)).toBe("10 mg");
    expect(formatMg(0.25)).toBe("0,25 mg");
  });
  it("aceita 2,5 e 2.5; recusa vazio, zero, negativo, texto e acima de 100", () => {
    expect(parseMg("2,5")).toBe(2.5);
    expect(parseMg("2.5")).toBe(2.5);
    for (const bad of ["", " ", "0", "-1", "abc", "101"]) expect(parseMg(bad)).toBeNull();
  });
  it("dia da semana e data em pt-BR", () => {
    expect(weekdayLabel(5)).toBe("Sexta");
    expect(weekdayLabel(0)).toBe("Domingo");
    expect(dateBR("2026-11-27")).toBe("27/11/2026");
    expect(dateBR(null)).toBe("—");
  });
  it("texto do estado: hoje, atrasada (1 dia/N dias), em dia não mostra nada", () => {
    expect(stateText({ state: "today", due_on: "2026-11-27", days_late: 0 })?.label).toBe("Hoje é o dia da aplicação");
    expect(stateText({ state: "overdue", due_on: "2026-11-26", days_late: 1 })).toEqual({ label: "Aplicação atrasada · 1 dia", tone: "destructive" });
    expect(stateText({ state: "overdue", due_on: "2026-11-24", days_late: 3 })?.label).toBe("Aplicação atrasada · 3 dias");
    expect(stateText({ state: "ok", due_on: "2026-11-27", days_late: 0 })).toBeNull();
  });
  it("tratamento novo exige data, dose e dia; edição não exige a dose", () => {
    const f = { medication: "Tirzepatida", startedOn: "2026-11-17", doseMg: "2,5", weekday: 5, where: "home" as const, notes: "", isNew: true };
    expect(validateTreatment(f, "2026-11-17")).toBeNull();
    expect(validateTreatment({ ...f, doseMg: "" }, "2026-11-17")).toMatch(/dose/);
    expect(validateTreatment({ ...f, doseMg: "", isNew: false }, "2026-11-17")).toBeNull();
    expect(validateTreatment({ ...f, weekday: null }, "2026-11-17")).toMatch(/dia da semana/);
    expect(validateTreatment({ ...f, startedOn: "" }, "2026-11-17")).toMatch(/início/);
    expect(validateTreatment({ ...f, medication: "x".repeat(81) }, "2026-11-17")).toMatch(/80/);
  });
  it("aplicação: sem data futura; baixa só na clínica", () => {
    const i = { appliedOn: "2026-11-17", doseMg: "5", place: "clinic" as const, stockItem: "item" };
    expect(validateApplication(i, "2026-11-17")).toBeNull();
    expect(validateApplication({ ...i, appliedOn: "2026-11-18" }, "2026-11-17")).toMatch(/futuro/);
    expect(validateApplication({ ...i, place: "home" }, "2026-11-17")).toMatch(/clínica/);
    expect(validateApplication({ ...i, doseMg: "0" }, "2026-11-17")).toMatch(/dose/);
  });
  it("entrega: quantidade inteira de 1 a 99", () => {
    expect(validateDelivery({ deliveredOn: "2026-11-17", quantity: "2" }, "2026-11-17")).toBeNull();
    for (const q of ["0", "100", "1.5", ""]) expect(validateDelivery({ deliveredOn: "2026-11-17", quantity: q }, "2026-11-17")).toMatch(/quantidade/);
  });
  it("addDays cruza o mês", () => expect(addDays("2026-11-30", 1)).toBe("2026-12-01"));
  it("mensagens de erro do banco em português", () => {
    expect(medErrorMessage({ message: "INSUFFICIENT_STOCK" })).toMatch(/Saldo insuficiente/);
    expect(medErrorMessage({ message: "APPLICATION_EXISTS" })).toMatch(/Já existe/);
    expect(medErrorMessage({ code: "42501", message: "forbidden" })).toMatch(/médico ou nutricionista/);
    expect(medErrorMessage(new Error("x"))).toMatch(/Tente novamente/);
  });
});
