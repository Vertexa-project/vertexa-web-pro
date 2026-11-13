import { describe, expect, it } from "vitest";

import { allocatePackage } from "./packageAllocation";

describe("rateio do pacote (escopo-v1 §5.4)", () => {
  it("exemplo da especificação: R$ 3.600 com 3×500 + 5×300 + 10×100 → fator 0,9 → 450 / 270 / 90", () => {
    const r = allocatePackage(360000, [
      { quantity: 3, referenceCents: 50000 },
      { quantity: 5, referenceCents: 30000 },
      { quantity: 10, referenceCents: 10000 },
    ]);
    expect(r).not.toBeNull();
    expect(r!.factor).toBeCloseTo(0.9, 10);
    expect(r!.referenceSumCents).toBe(400000);
    expect(r!.lines.map((l) => l.unitCents)).toEqual([45000, 27000, 9000]);
    expect(r!.lines.map((l) => l.totalCents)).toEqual([135000, 135000, 90000]);
    expect(r!.lines.every((l) => l.adjustCents === 0)).toBe(true);
  });

  it("diferença de arredondamento vai para a ÚLTIMA linha e o total fecha no valor do pacote", () => {
    // R$ 100,00 sobre três referências de 33,33 / 33,33 / 33,34 (1 un. cada): 3333 + 3333 + 3334 = 10000
    const r = allocatePackage(10000, [
      { quantity: 1, referenceCents: 3333 },
      { quantity: 1, referenceCents: 3333 },
      { quantity: 1, referenceCents: 3334 },
    ])!;
    expect(r.lines.reduce((s, l) => s + l.totalCents, 0)).toBe(10000);

    // R$ 100,00 sobre 3 sessões iguais: 33,33 + 33,33 + 33,33 = 99,99 → a última leva 0,01
    const eq = allocatePackage(10000, [{ quantity: 1, referenceCents: 1000 }, { quantity: 1, referenceCents: 1000 }, { quantity: 1, referenceCents: 1000 }])!;
    expect(eq.lines.map((l) => l.totalCents)).toEqual([3333, 3333, 3334]);
    expect(eq.lines[2].adjustCents).toBe(1);
    expect(eq.lines[0].adjustCents).toBe(0);
    expect(eq.lines.reduce((s, l) => s + l.totalCents, 0)).toBe(10000);
  });

  it("desconto de valor redondo não deixa resto; quantidade fracionada (3 casas) entra no rateio", () => {
    const r = allocatePackage(5000, [{ quantity: 0.5, referenceCents: 4000 }, { quantity: 2, referenceCents: 4000 }])!;
    expect(r.lines.reduce((s, l) => s + l.totalCents, 0)).toBe(5000);
  });

  it("sem linhas, sem preço ou referência zero: não rateia", () => {
    expect(allocatePackage(1000, [])).toBeNull();
    expect(allocatePackage(0, [{ quantity: 1, referenceCents: 100 }])).toBeNull();
    expect(allocatePackage(1000, [{ quantity: 1, referenceCents: 0 }])).toBeNull();
  });
});
