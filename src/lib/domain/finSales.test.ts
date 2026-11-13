import { describe, expect, it } from "vitest";

import {
  addDays, buildTitles, canOpenCash, cashKey, computeSale, distribute, expectedCash, financeSalesErrorMessage, isStaleRegister, modalityFor, previewCashClose,
} from "./finSales";

describe("títulos do recebimento (escopo-v1 §4.3, exemplo C)", () => {
  const visa = { kind: "machine" as const, feePct: 5, settleDays: 30 };

  it("exemplo C: R$ 2.000, 4×, taxa 5%, 30 dias → 4 títulos de 500 bruto, 25 de taxa, 475 líquido, +30/60/90/120 dias", () => {
    const t = buildTitles(200000, 4, "2026-10-05", visa);
    expect(t).toHaveLength(4);
    expect(t.map((x) => [x.grossCents, x.feeCents, x.netCents])).toEqual(Array(4).fill([50000, 2500, 47500]));
    expect(t.map((x) => x.expectedDate)).toEqual(["2026-11-04", "2026-12-04", "2027-01-03", "2027-02-02"]);
    expect(t.map((x) => x.expectedDate)).toEqual([30, 60, 90, 120].map((d) => addDays("2026-10-05", d)));
  });

  it("antecipação: todas as parcelas no prazo de antecipação e taxa somada (3% + 2% = 5%)", () => {
    const t = buildTitles(90000, 3, "2026-10-05", { kind: "machine", feePct: 3, settleDays: 30, anticipation: true, anticipationFeePct: 2, anticipationDays: 2 });
    expect(t.map((x) => x.expectedDate)).toEqual(Array(3).fill("2026-10-07"));
    expect(t.map((x) => [x.grossCents, x.feeCents, x.netCents])).toEqual(Array(3).fill([30000, 1500, 28500]));
  });

  it("Pix D+0 com taxa 0: um título, líquido = bruto, data = a do recebimento", () => {
    const t = buildTitles(50000, 1, "2026-10-05", { kind: "pix", feePct: 0, settleDays: 0 });
    expect(t).toEqual([{ installmentNo: 1, grossCents: 50000, feeCents: 0, netCents: 50000, expectedDate: "2026-10-05" }]);
  });

  it("arredondamento meio-para-cima por linha, resto na última parcela (1.000,00 em 3×)", () => {
    const t = buildTitles(100000, 3, "2026-10-05", visa);
    expect(t.map((x) => x.grossCents)).toEqual([33333, 33333, 33334]);
    expect(t.map((x) => x.feeCents)).toEqual([1667, 1667, 1667]); // 1666,65 → 1667; 1666,70 → 1667
    expect(t.reduce((s, x) => s + x.grossCents, 0)).toBe(100000);
  });

  it("boleto: taxa fixa na primeira linha; meios sem parcelamento recusam mais de 1 parcela", () => {
    const t = buildTitles(10000, 1, "2026-10-05", { kind: "boleto", feePct: 0, flatFeeCents: 350, settleDays: 2 });
    expect(t[0]).toMatchObject({ feeCents: 350, netCents: 9650, expectedDate: "2026-10-07" });
    expect(() => buildTitles(10000, 2, "2026-10-05", { kind: "pix", feePct: 0, settleDays: 0 })).toThrow("INSTALLMENTS_MODALITY_MISMATCH");
  });

  it("modalidade pela forma e parcelas", () => {
    expect(modalityFor("debit", 1)).toBe("debit");
    expect(modalityFor("credit", 1)).toBe("credit_1");
    expect(modalityFor("credit", 4)).toBe("credit_2_6");
    expect(modalityFor("credit", 12)).toBe("credit_7_12");
  });
});

describe("venda e desconto (escopo-v1 §4.2, §5.2, F15)", () => {
  it("F15: consulta R$ 500 com 10% de desconto → líquido do item 450,00", () => {
    const s = computeSale([{ unitPriceCents: 50000, quantity: 1, discountPct: 10 }]);
    expect(s.lines[0]).toMatchObject({ grossCents: 50000, discountItemCents: 5000, netCents: 45000 });
    expect(s.netCents).toBe(45000);
    expect(s.discountCents).toBe(5000);
  });

  it("desconto no total é rateado proporcionalmente ao líquido de cada item, resto no último", () => {
    const s = computeSale([{ unitPriceCents: 30000, quantity: 1 }, { unitPriceCents: 10000, quantity: 1 }], { cents: 4000 });
    expect(s.lines.map((l) => l.discountShareCents)).toEqual([3000, 1000]);
    expect(s.lines.map((l) => l.netCents)).toEqual([27000, 9000]);
    expect(s.netCents).toBe(36000);
    const odd = computeSale([{ unitPriceCents: 10000, quantity: 1 }, { unitPriceCents: 10000, quantity: 1 }, { unitPriceCents: 10000, quantity: 1 }], { cents: 100 });
    expect(odd.lines.map((l) => l.discountShareCents)).toEqual([33, 33, 34]);
    expect(odd.discountCents).toBe(100);
  });

  it("combina desconto por item e no total; total em % também", () => {
    const s = computeSale([{ unitPriceCents: 50000, quantity: 1, discountPct: 10 }, { unitPriceCents: 10000, quantity: 2 }], { pct: 10 });
    expect(s.lines.map((l) => l.netCents)).toEqual([40500, 18000]);
    expect(s.netCents).toBe(58500);
  });

  it("quantidade fracionada arredonda meio-para-cima por linha; desconto maior que o valor é recusado", () => {
    expect(computeSale([{ unitPriceCents: 1001, quantity: 1.5 }]).grossCents).toBe(1502);
    expect(() => computeSale([{ unitPriceCents: 1000, quantity: 1, discountCents: 1001 }])).toThrow("INVALID_DISCOUNT");
    expect(() => computeSale([{ unitPriceCents: 1000, quantity: 1 }], { cents: 1001 })).toThrow("INVALID_DISCOUNT");
  });

  it("recebimento distribuído entre itens proporcional ao líquido (180,00 sobre 270,00/90,00 → 135,00/45,00)", () => {
    expect(distribute(18000, [27000, 9000])).toEqual([13500, 4500]);
  });
});

describe("caixa diário (escopo-v1 §4.5, F19, F20)", () => {
  const exp = [
    { key: "cash", label: "Dinheiro", expectedCents: expectedCash(5000, 10000, [{ type: "sangria", amountCents: 2000 }, { type: "suprimento", amountCents: 500 }]) },
    { key: "pix", label: "Pix", expectedCents: 20000 },
    { key: "machine:m1:visa", label: "Maq1 · Visa", expectedCents: 5000 },
  ];

  it("esperado em espécie = troco + dinheiro − sangria + suprimento", () => {
    expect(exp[0].expectedCents).toBe(13500);
  });

  it("F19: diferença de R$ 10,00 em espécie com limite R$ 0,00 exige justificativa e aprovação do gestor", () => {
    const p = previewCashClose(exp, { cash: 12500 }, 0);
    expect(p.cashDifferenceCents).toBe(-1000);
    expect(p.totalAbsDifferenceCents).toBe(1000);
    expect(p.needsApproval).toBe(true);
    expect(p.lines.find((l) => l.key === "pix")?.countedCents).toBe(20000); // não contada = esperado
  });

  it("sem diferença, ou dentro do limite configurado, fecha sem aprovação", () => {
    expect(previewCashClose(exp, { cash: 13500 }, 0).needsApproval).toBe(false);
    expect(previewCashClose(exp, { cash: 12500 }, 1000).needsApproval).toBe(false);
    expect(previewCashClose(exp, { cash: 12500, pix: 20100 }, 1000).needsApproval).toBe(true); // soma 11,00 > 10,00
  });

  it("F20: segundo caixa com outro aberto do mesmo operador é bloqueado; outro operador ou caixa já fechado não", () => {
    const regs = [{ operatorId: "ana", status: "open" as const }, { operatorId: "bia", status: "closed" as const }];
    expect(canOpenCash(regs, "ana")).toBe(false);
    expect(canOpenCash(regs, "bia")).toBe(true);
    expect(canOpenCash(regs, "caio")).toBe(true);
    expect(canOpenCash([{ operatorId: "ana", status: "pending_approval" }], "ana")).toBe(true);
  });

  it("caixa de ontem não fechado é pendência", () => {
    expect(isStaleRegister({ status: "open", businessDate: "2026-11-12" }, "2026-11-13")).toBe(true);
    expect(isStaleRegister({ status: "open", businessDate: "2026-11-13" }, "2026-11-13")).toBe(false);
    expect(isStaleRegister({ status: "closed", businessDate: "2026-11-12" }, "2026-11-13")).toBe(false);
  });

  it("chave de conferência do cartão é por maquininha e bandeira", () => {
    expect(cashKey("machine", "m1", " Visa ")).toBe("machine:m1:visa");
    expect(cashKey("pix", "x", null)).toBe("pix");
  });
});

describe("mensagens do servidor", () => {
  it("traduz códigos conhecidos e cai no genérico", () => {
    expect(financeSalesErrorMessage({ message: "MEDICATION_NOT_SELLABLE" })).toMatch(/não pode ser vendida/);
    expect(financeSalesErrorMessage({ code: "42501", message: "forbidden" })).toMatch(/permissão/);
    expect(financeSalesErrorMessage({ message: "xyz" })).toMatch(/Tente novamente/);
  });
});
