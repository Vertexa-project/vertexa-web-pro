import { describe, expect, it } from "vitest";
import { formatBmi, formatLiters, formatNumber, formatWeight, formatWeightDelta } from "./format";
import { deltaLabel } from "./weightReview";

describe("padrão numérico pt-BR (vírgula decimal)", () => {
  it("formatNumber", () => {
    expect(formatNumber(0.25, 2)).toBe("0,25");
    expect(formatNumber(1234.5, 1)).toBe("1.234,5");
    expect(formatNumber(2, 1, true)).toBe("2,0");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
  });
  it("hidratação, peso, IMC e variação", () => {
    expect(formatLiters(0.25)).toBe("0,25 L");
    expect(formatWeight(68.4)).toBe("68,4 kg");
    expect(formatBmi(24.74)).toBe("24,7");
    expect(formatWeightDelta(-1.26)).toBe("−1,3 kg");
  });
  it("variação desde o registro anterior usa vírgula", () => {
    expect(deltaLabel(70.3, null, 58)).toBe("−12,3 kg");
  });
});
