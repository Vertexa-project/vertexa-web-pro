import { describe, expect, it } from "vitest";

import { formatDecimalBR, parseDecimalBR, percentOfCents, roundHalfUp, roundQty, sumCents, toCents, toMilli } from "./money";

describe("arredondamento meio-para-cima (escopo-v1 §3)", () => {
  it("arredonda o meio para cima, sem erro de ponto flutuante", () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(0.125, 2)).toBe(0.13);
    expect(roundHalfUp(1.004, 2)).toBe(1);
    expect(roundHalfUp(10, 2)).toBe(10);
  });
  it("estorno é o espelho do lançamento (meio para longe do zero)", () => {
    expect(roundHalfUp(-1.005, 2)).toBe(-1.01);
    expect(roundHalfUp(-0.5, 0)).toBe(-1);
  });
  it("reais → centavos inteiros", () => {
    expect(toCents(19.9)).toBe(1990);
    expect(toCents(0.285)).toBe(29);
    expect(toCents(3600)).toBe(360000);
  });
  it("quantidade: até 3 casas", () => {
    expect(roundQty(0.12345)).toBe(0.123);
    expect(roundQty(0.1235)).toBe(0.124);
    expect(toMilli(2.5)).toBe(2500);
    expect(toMilli(0.001)).toBe(1);
  });
  it("percentual por linha em centavos; total soma as linhas já arredondadas", () => {
    // 3 linhas de R$ 0,33 com 15%: cada linha 4,95c → 5c; total = 15c (e não 14,85 → 15 por coincidência: conferir linha a linha)
    const lines = [33, 33, 33].map((c) => percentOfCents(c, 15));
    expect(lines).toEqual([5, 5, 5]);
    expect(sumCents(lines)).toBe(15);
    expect(percentOfCents(10000, 1.5)).toBe(150);
    expect(percentOfCents(10000, 4.65)).toBe(465);
  });
  it("formata e interpreta números pt-BR", () => {
    expect(formatDecimalBR(1234.5)).toBe("1.234,50");
    expect(parseDecimalBR("1.234,50")).toBe(1234.5);
    expect(parseDecimalBR("12,5")).toBe(12.5);
    expect(parseDecimalBR("12.5")).toBe(12.5);
    expect(parseDecimalBR("abc")).toBeNull();
    expect(parseDecimalBR("1,23456", 3)).toBeNull();
    expect(parseDecimalBR("")).toBeNull();
  });
});
