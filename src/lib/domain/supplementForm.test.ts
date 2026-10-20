import { describe, expect, it } from "vitest";
import { emptySupplementForm, normalizeReminderTime, reminderToInput, validateSupplement } from "./supplementForm";
import { findCatalogItem, SUPPLEMENT_CATALOG } from "./supplementCatalog";

const f = (o: Partial<ReturnType<typeof emptySupplementForm>>) => ({ ...emptySupplementForm(), ...o });

describe("supplementForm", () => {
  it("nome é obrigatório e a mensagem cita o tipo", () => {
    const a = validateSupplement(f({}), "supplement");
    const b = validateSupplement(f({}), "medication");
    expect(a.ok ? "" : a.error).toMatch(/nome do suplemento/);
    expect(b.ok ? "" : b.error).toMatch(/nome do medicamento/);
  });
  it("campos vazios viram null e valores são aparados", () => {
    const r = validateSupplement(f({ name: "  Creatina ", dose: " 5 g ", brand: "", notes: "  " }), "supplement");
    expect(r.ok && r.value).toEqual({ name: "Creatina", dose: "5 g", timeLabel: null, brand: null, notes: null, reminderTime: null });
  });
  it("limites de marca (80), observação (300) e dose (80)", () => {
    expect(validateSupplement(f({ name: "x", brand: "a".repeat(81) }), "supplement").ok).toBe(false);
    expect(validateSupplement(f({ name: "x", brand: "a".repeat(80) }), "supplement").ok).toBe(true);
    expect(validateSupplement(f({ name: "x", notes: "a".repeat(301) }), "supplement").ok).toBe(false);
    expect(validateSupplement(f({ name: "x", dose: "a".repeat(81) }), "supplement").ok).toBe(false);
  });
  it("horário do lembrete: normaliza ou recusa", () => {
    expect(normalizeReminderTime("8:30")).toBe("08:30:00");
    expect(normalizeReminderTime("18:05:00")).toBe("18:05:00");
    expect(normalizeReminderTime("")).toBeNull();
    for (const bad of ["24:00", "12:60", "abc", "7"]) expect(normalizeReminderTime(bad)).toBeUndefined();
    const r = validateSupplement(f({ name: "x", reminderTime: "25:00" }), "supplement");
    expect(r.ok ? "" : r.error).toMatch(/Horário do lembrete/);
    expect(reminderToInput("08:30:00")).toBe("08:30");
    expect(reminderToInput(null)).toBe("");
  });
  it("catálogo: ids únicos e sem dose numérica inventada onde varia por exame", () => {
    const ids = SUPPLEMENT_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findCatalogItem("vitamina-d")?.dose).toMatch(/A definir/);
    expect(findCatalogItem("ferro")?.dose).toMatch(/A definir/);
    expect(findCatalogItem("inexistente")).toBeNull();
    expect(findCatalogItem("creatina")?.dose).toBe("3 a 5 g");
  });
});
