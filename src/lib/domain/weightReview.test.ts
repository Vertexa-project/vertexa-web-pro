import { describe, expect, it } from "vitest";
import { deltaLabel, isCountedWeight } from "./weightReview";

describe("revisão de peso suspeito", () => {
  it("só ok, approved e legado (sem status) entram na curva", () => {
    expect(isCountedWeight("ok")).toBe(true);
    expect(isCountedWeight("approved")).toBe(true);
    expect(isCountedWeight(undefined)).toBe(true);
    expect(isCountedWeight(null)).toBe(true);
    expect(isCountedWeight("pending")).toBe(false);
    expect(isCountedWeight("rejected")).toBe(false);
  });
  it("variação com sinal, vírgula e data", () => {
    expect(deltaLabel(70.3, "2026-10-16T12:00:00Z", 58)).toBe("−12,3 kg desde 16/10");
    expect(deltaLabel(58, "2026-10-16T12:00:00Z", 60.5)).toBe("+2,5 kg desde 16/10");
    expect(deltaLabel(null, null, 58)).toBe("sem registro anterior");
  });
});
