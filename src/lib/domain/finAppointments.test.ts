import { describe, expect, it } from "vitest";

import {
  apptErrorMessage, kitLineCostCents, kitStockQty, packageNetShares, packageRemaining, packageUseValueCents, planKitLine, validateKit, validateParticipants, type KitLineInfo,
} from "./finAppointments";

describe("kit: unidade de consumo → unidade de estoque (escopo-v1 §8.5)", () => {
  it("5 ml de um frasco de 30 ml = 0,167 do frasco (3 casas) e custa 0,167 × R$ 300,00 = R$ 50,10", () => {
    expect(kitStockQty(5, 30)).toBe(0.167);
    expect(kitLineCostCents(5, 30, 30000)).toBe(5010);
  });
  it("1 dose de uma caneta de 4 doses = 0,25; 2 ampolas (fator 1) = 2", () => {
    expect(kitStockQty(1, 4)).toBe(0.25);
    expect(kitStockQty(2, 1)).toBe(2);
  });
  it("E2: kit «2 ampolas a R$ 40,00 + 1 seringa a R$ 1,00» → custo do material R$ 81,00", () => {
    expect(kitLineCostCents(2, 1, 4000) + kitLineCostCents(1, 1, 100)).toBe(8100);
  });
  it("fator inválido é recusado", () => { expect(() => kitStockQty(1, 0)).toThrow(); });
});

describe("kit: validação e pré-visualização do consumo sem saldo (E3)", () => {
  const items: Record<string, KitLineInfo> = {
    amp: { itemId: "amp", fractional: false, factor: 1, balance: 1, avgCostCents: 4000 },
    cn: { itemId: "cn", fractional: true, factor: 4, balance: 2, avgCostCents: 80000 },
  };
  const info = (id: string) => items[id];
  it("linha sem item, sem quantidade, repetida ou com 4 casas é recusada", () => {
    const errs = validateKit([{ itemId: "", quantity: 1, lotId: "" }, { itemId: "amp", quantity: null, lotId: "" }, { itemId: "amp", quantity: 1, lotId: "" }, { itemId: "cn", quantity: 0.0001, lotId: "" }], info);
    expect(errs[0]).toMatch(/item/i); expect(errs[1]).toMatch(/quantidade/i); expect(errs[2]).toMatch(/duas vezes/); expect(errs[3]).toMatch(/3 casas/);
  });
  it("item não fracionado precisa dar unidades inteiras de estoque; fracionado aceita 1 dose = 0,25", () => {
    expect(validateKit([{ itemId: "amp", quantity: 1.5, lotId: "" }], info)[0]).toMatch(/não é fracionado/);
    expect(validateKit([{ itemId: "cn", quantity: 1, lotId: "" }], info)).toEqual({});
  });
  it("E3: kit pede 2 ampolas com 1 em estoque → falta 1 (consumo sem saldo), custo estimado R$ 80,00; o atendimento seria salvo mesmo assim", () => {
    const p = planKitLine(2, items.amp);
    expect(p).toEqual({ stockQty: 2, shortQty: 1, enough: false, estimatedCostCents: 8000 });
    expect(planKitLine(1, items.amp).enough).toBe(true);
  });
  it("sem custo médio conhecido (papel que não vê custo) a estimativa fica vazia", () => {
    expect(planKitLine(1, { ...items.amp, avgCostCents: null }).estimatedCostCents).toBeNull();
  });
});

describe("participantes (D3/D4, base do repasse da E5)", () => {
  const all = ["responsavel", "executor", "auxiliar"] as const;
  const A = { professionalId: "a", role: "responsavel" as const }, B = { professionalId: "b", role: "executor" as const }, C = { professionalId: "c", role: "auxiliar" as const };
  it("responsável + executor + auxiliar é válido", () => { expect(validateParticipants([A, B, C], [...all])).toBeNull(); });
  it("sem responsável, com dois responsáveis ou dois executores é recusado", () => {
    expect(validateParticipants([B], [...all])).toMatch(/responsável/);
    expect(validateParticipants([A, { professionalId: "z", role: "responsavel" }], [...all])).toMatch(/exatamente um/);
    expect(validateParticipants([A, B, { professionalId: "y", role: "executor" }], [...all])).toMatch(/um executor/);
  });
  it("papel que o serviço não prevê e pessoa repetida no mesmo papel são recusados", () => {
    expect(validateParticipants([A, B], ["responsavel"])).toMatch(/não prevê/);
    expect(validateParticipants([A, C, { ...C }], [...all])).toMatch(/duas vezes/);
  });
});

describe("pacote: rateio e valor por sessão/entrega (§5.4, D23)", () => {
  it("R$ 1.800,00 em 3 consultas (ref. 500) + 3 suplementos (ref. 180): linhas 132.354 + 47.646 = 180.000", () => {
    const [p] = packageNetShares(180000, 1, [132354, 47646]);
    expect(p.lines).toEqual([132354, 47646]);
    expect(p.lines.reduce((a, b) => a + b, 0)).toBe(180000);
  });
  it("com 10% de desconto o rateio usa o líquido: R$ 1.620,00 → 119.119 + 42.881", () => {
    expect(packageNetShares(162000, 1, [132354, 47646])[0].lines).toEqual([119119, 42881]);
  });
  it("duas unidades vendidas dividem o líquido da venda (360.000 → 180.000 + 180.000)", () => {
    expect(packageNetShares(360000, 2, [132354, 47646]).map((x) => x.packageCents)).toEqual([180000, 180000]);
  });
  it("sessões de R$ 441,18; com desconto (119.119 em 3) a última leva a sobra: 39.706 + 39.706 + 39.707", () => {
    expect([0, 1, 2].map((used) => packageUseValueCents(132354, 3, used, used * 44118))).toEqual([44118, 44118, 44118]);
    const v1 = packageUseValueCents(119119, 3, 0, 0), v2 = packageUseValueCents(119119, 3, 1, v1), v3 = packageUseValueCents(119119, 3, 2, v1 + v2);
    expect([v1, v2, v3]).toEqual([39706, 39706, 39707]);
    expect(v1 + v2 + v3).toBe(119119);
  });
  it("saldo do pacote e vencimento", () => {
    expect(packageRemaining({ qtyTotal: 3, qtyUsed: 2 })).toBe(1);
    expect(packageRemaining({ qtyTotal: 3, qtyUsed: 3 })).toBe(0);
  });
});

describe("mensagens de erro em português", () => {
  it("traduz códigos do servidor e protege permissão", () => {
    expect(apptErrorMessage({ message: "NO_SESSIONS_LEFT" })).toMatch(/não tem mais sessões/);
    expect(apptErrorMessage({ message: "INSUFFICIENT_STOCK" })).toMatch(/Saldo em estoque insuficiente/);
    expect(apptErrorMessage({ code: "42501", message: "forbidden" })).toMatch(/permissão/);
    expect(apptErrorMessage(new Error("boom"))).toMatch(/Tente novamente/);
  });
});
