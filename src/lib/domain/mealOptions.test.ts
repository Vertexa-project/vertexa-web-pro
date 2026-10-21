import { describe, expect, it } from "vitest";
import { kcalWarning, parseOptions } from "./mealOptions";

describe("opções de refeição", () => {
  it("lê opções válidas e descarta as sem itens", () => {
    expect(parseOptions([{ items: ["Pão", " "], calories: 330 }, { items: [], calories: 5 }, { items: ["Tapioca"] }])).toEqual([
      { items: ["Pão"], calories: 330 }, { items: ["Tapioca"], calories: null },
    ]);
  });
  it("valor inesperado vira lista vazia", () => {
    expect(parseOptions(null)).toEqual([]);
    expect(parseOptions({})).toEqual([]);
    expect(parseOptions([null, 3, "x"])).toEqual([]);
  });
  it("avisa acima de 15% de diferença, não em 15%, e não sem número", () => {
    expect(kcalWarning(325, 330)).toBeNull();
    expect(kcalWarning(100, 115)).toBeNull();
    expect(kcalWarning(100, 116)).toContain("16% de diferença");
    expect(kcalWarning(100, 70)).toContain("30%");
    expect(kcalWarning(null, 300)).toBeNull();
    expect(kcalWarning(300, null)).toBeNull();
  });
});
