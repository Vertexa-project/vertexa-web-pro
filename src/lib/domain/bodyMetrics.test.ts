import { describe, expect, it } from "vitest";
import { computeBmi, normalizeHeightCm, summarizeWeight } from "./bodyMetrics";
import { formatBmi, formatLiters, formatWeightDelta } from "./format";
import type { WeightPoint } from "@/types/db";

const pt = (date: string, weight: number, source: "app" | "assessment" = "app"): WeightPoint => ({ date, weight, source, method: null });

describe("normalizeHeightCm", () => {
  it("metros viram cm; cm ficam; lixo vira null", () => {
    expect(normalizeHeightCm(1.81)).toBeCloseTo(181);
    expect(normalizeHeightCm(181)).toBe(181);
    expect(normalizeHeightCm("1,75")).toBeCloseTo(175);
    expect(normalizeHeightCm(0)).toBeNull();
    expect(normalizeHeightCm(null)).toBeNull();
    expect(normalizeHeightCm(900)).toBeNull();
  });
});

describe("computeBmi", () => {
  it("altura gravada em metros NÃO gera IMC absurdo (antes: 329660,3)", () => {
    const bmi = computeBmi(108, 1.81);
    expect(bmi).toBeCloseTo(32.97, 1);
    expect(formatBmi(bmi)).toBe("33,0");
  });
  it("altura em cm dá o mesmo valor", () => {
    expect(computeBmi(108, 181)).toBeCloseTo(computeBmi(108, 1.81) as number, 5);
  });
  it("sem dado => null", () => {
    expect(computeBmi(null, 180)).toBeNull();
    expect(computeBmi(80, null)).toBeNull();
  });
});

describe("summarizeWeight (fonte única)", () => {
  it("usa a medida mais recente por data, independente da ordem e da origem", () => {
    const s = summarizeWeight(
      [pt("2026-10-20T12:00:00Z", 108, "assessment"), pt("2026-09-01T12:00:00Z", 117), pt("2026-10-01T12:00:00Z", 110)],
      { start_weight: 120, current_weight: 117 },
    );
    expect(s.current).toBe(108);
    expect(s.start).toBe(117);
    expect(s.delta).toBe(-9);
    expect(s.source).toBe("series");
  });
  it("ignora medidas inválidas (fora de 20–400 kg)", () => {
    const s = summarizeWeight([pt("2026-09-01T12:00:00Z", 100), pt("2026-10-01T12:00:00Z", 1008)], null);
    expect(s.current).toBe(100);
    expect(s.delta).toBe(0);
  });
  it("sem série: peso inicial do cadastro, variação 0", () => {
    const s = summarizeWeight([], { start_weight: 117, current_weight: 100 });
    expect(s).toMatchObject({ current: 117, start: 117, delta: 0, source: "registration" });
  });
  it("sem nada => none", () => {
    expect(summarizeWeight(undefined, {})).toMatchObject({ current: null, delta: null, source: "none" });
  });
});

describe("formatação pt-BR", () => {
  it("litros com vírgula e 2 casas", () => {
    expect(formatLiters(0.25)).toBe("0,25 L");
    expect(formatLiters(1.5)).toBe("1,5 L");
  });
  it("variação de peso", () => {
    expect(formatWeightDelta(-9)).toBe("−9 kg");
    expect(formatWeightDelta(2.54)).toBe("+2,5 kg");
    expect(formatWeightDelta(0)).toBe("0 kg");
  });
});
