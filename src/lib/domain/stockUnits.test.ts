import { describe, expect, it } from "vitest";

import { convertQty } from "./stockUnits";

describe("conversão de unidades do item (escopo-v1 §8.1)", () => {
  const ampola = { purchaseToStock: 10, stockToConsumption: 1 }; // caixa com 10 ampolas
  const frasco = { purchaseToStock: 1, stockToConsumption: 30 }; // frasco de 30 ml

  it("compra → estoque: 3 caixas = 30 ampolas", () => {
    expect(convertQty(3, "purchase", "stock", ampola)).toBe(30);
  });
  it("estoque → consumo: 1 frasco = 30 ml; 0,5 frasco = 15 ml", () => {
    expect(convertQty(1, "stock", "consumption", frasco)).toBe(30);
    expect(convertQty(0.5, "stock", "consumption", frasco)).toBe(15);
  });
  it("consumo → estoque com até 3 casas: 10 ml de frasco de 30 ml = 0,333", () => {
    expect(convertQty(10, "consumption", "stock", frasco)).toBe(0.333);
    expect(convertQty(20, "consumption", "stock", frasco)).toBe(0.667);
  });
  it("compra → consumo atravessa os dois fatores", () => {
    expect(convertQty(2, "purchase", "consumption", { purchaseToStock: 5, stockToConsumption: 30 })).toBe(300);
  });
  it("mesma unidade devolve a própria quantidade", () => {
    expect(convertQty(1.25, "stock", "stock", frasco)).toBe(1.25);
  });
  it("fator inválido é recusado", () => {
    expect(() => convertQty(1, "stock", "consumption", { purchaseToStock: 1, stockToConsumption: 0 })).toThrow();
  });
});
