import { describe, expect, it } from "vitest";
import { DEFAULT_MISSION_STEPS, DEFAULT_ROUTINE_SETTINGS, dayMonth, doneOfTotal, periodText, type RoutineItemView } from "./routine";

describe("rotina e missão (textos e padrões)", () => {
  it("nasce desligado, com o padrão da Juliana: foto e peso mensais, feedback semanal na sexta", () => {
    expect(DEFAULT_ROUTINE_SETTINGS).toMatchObject({ routine_enabled: false, mission_enabled: false, photo_period: "monthly", weight_period: "monthly", feedback_period: "weekly", feedback_weekday: 5 });
  });
  it("missão padrão: frente, lado, costas, balança, suplementos e bio (bio e suplementos aceitam 'não tenho')", () => {
    expect(DEFAULT_MISSION_STEPS.map((s) => s.key)).toEqual(["photo_front", "photo_side", "photo_back", "weight", "supplements_photo", "bio"]);
    expect(DEFAULT_MISSION_STEPS.find((s) => s.key === "bio")?.allow_skip).toBe(true);
    expect(DEFAULT_MISSION_STEPS.find((s) => s.key === "photo_front")?.allow_skip).toBe(false);
  });
  it("descreve o período em português", () => {
    expect(periodText("weekly", 5)).toBe("toda sexta");
    expect(periodText("monthly", 5)).toBe("1ª sexta do mês");
    expect(periodText("off", 5)).toBe("não pedido");
  });
  it("dd/mm sem mudar de dia por fuso", () => {
    expect(dayMonth("2026-11-17")).toBe("17/11");
    expect(dayMonth(null)).toBe("—");
  });
  it("conta cumpridas / total", () => {
    const item: RoutineItemView = { key: "photo", label: "Foto", period: "weekly", weekday: 5, occurrences: [
      { date: "2026-11-06", state: "done", done_on: "2026-11-06" }, { date: "2026-11-13", state: "missed", done_on: null }, { date: "2026-11-20", state: "overdue", done_on: null }] };
    expect(doneOfTotal(item)).toEqual({ done: 1, total: 3 });
  });
});
