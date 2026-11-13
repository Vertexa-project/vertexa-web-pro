import { describe, expect, it } from "vitest";

import {
  addIsoDays, allocateFreight, checkDose, checkExitQuantity, entryLineTotalCents, exitValueCents, expiryStatus, hasValidDecimals, openedUnitExpiry, pickLotsFefo,
  StockRuleException, stockMoveErrorMessage, validateExit, weightedAverageCost, type LotView,
} from "./stockMoves";

const code = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (e) { return e instanceof StockRuleException ? e.code : String(e); }
};
const lot = (id: string, expiry: string | null, qty: number, available = qty): LotView => ({ lotId: id, lotCode: id, expiryDate: expiry, qty, available });

describe("custo médio ponderado (escopo-v1 §8.4, E1)", () => {
  it("E1: saldo 10 a R$ 40,00 + entrada de 20 a R$ 46,00 → custo médio R$ 44,00; saída de 3 un valorada em R$ 132,00", () => {
    const avg = weightedAverageCost(10, 4000, 20, 20 * 4600);
    expect(avg).toBe(4400);
    expect(exitValueCents(3, avg)).toBe(13200);
  });

  it("saída não muda o custo médio; nova entrada recalcula a partir do saldo restante", () => {
    const avg1 = weightedAverageCost(10, 4000, 20, 92000); // 44,00
    // saem 3 (saldo 27, custo médio continua 44,00); entram 3 a R$ 50,00
    expect(weightedAverageCost(27, avg1, 3, 3 * 5000)).toBe(roundTo((27 * 4400 + 15000) / 30, 4));
  });

  it("saldo zero: o custo médio passa a ser o da entrada", () => {
    expect(weightedAverageCost(0, 123.45, 4, 4 * 2000)).toBe(2000);
  });

  it("quatro casas, meio-para-cima: 15 un com valor 9.007 → 600,4667; e a saída é arredondada na linha (3 × 600,4667 = 1.801,4 → 1.801)", () => {
    const avg = weightedAverageCost(6, 0, 9, 9007);
    expect(avg).toBe(600.4667);
    expect(exitValueCents(3, avg)).toBe(1801);
  });

  it("uso fracionado: 0,25 de um frasco a R$ 300,00 vale R$ 75,00", () => {
    expect(exitValueCents(0.25, 30000)).toBe(7500);
    expect(exitValueCents(0.333, 30000)).toBe(9990);
  });

  it("estorno de uma entrada é a mesma conta com sinais trocados (volta ao custo anterior)", () => {
    const after = weightedAverageCost(10, 4000, 20, 92000);
    const back = (30 * after - 92000) / 10;
    expect(back).toBe(4000);
  });
});

describe("frete e total da linha de entrada", () => {
  it("frete de R$ 4,00 rateado pelo valor: 1.000 e 3.000 viram 1.100 e 3.300", () => {
    expect(allocateFreight([1000, 3000], 400)).toEqual([1100, 3300]);
  });
  it("meio-para-cima por linha e diferença na última: frete 100 entre três linhas iguais → 33, 33, 34", () => {
    const out = allocateFreight([1000, 1000, 1000], 100);
    expect(out).toEqual([1033, 1033, 1034]);
    expect(out.reduce((a, v) => a + v, 0)).toBe(3100);
  });
  it("sem frete devolve as linhas; frete sem valor nas linhas é recusado", () => {
    expect(allocateFreight([500, 700], 0)).toEqual([500, 700]);
    expect(() => allocateFreight([0, 0], 100)).toThrow("INVALID_FREIGHT");
  });
  it("total da linha: o total informado vence; senão quantidade × custo unitário (meio-para-cima)", () => {
    expect(entryLineTotalCents(10, 4600)).toBe(46000);
    expect(entryLineTotalCents(3, 333.5)).toBe(1001);
    expect(entryLineTotalCents(3, 1, 777)).toBe(777);
    expect(entryLineTotalCents(3, null)).toBeNull();
  });
});

describe("lote e validade: FEFO e lote vencido (escopo-v1 §8.3, E4)", () => {
  const today = "2026-11-13";
  const lots = [lot("L-longe", "2027-05-01", 10), lot("L-perto", "2026-12-01", 4), lot("L-sem", null, 5), lot("L-vencido", "2026-11-01", 3)];

  it("FEFO: vence primeiro sai primeiro, sem validade por último, e o vencido fica de fora", () => {
    expect(pickLotsFefo(lots, 3, today)).toEqual([{ lotId: "L-perto", lotCode: "L-perto", qty: 3 }]);
    expect(pickLotsFefo(lots, 6, today).map((a) => [a.lotId, a.qty])).toEqual([["L-perto", 4], ["L-longe", 2]]);
    expect(pickLotsFefo(lots, 19, today).map((a) => a.lotId)).toEqual(["L-perto", "L-longe", "L-sem"]);
  });

  it("o usuário pode trocar o lote: a saída vem só do lote escolhido", () => {
    expect(pickLotsFefo(lots, 2, today, { chosenLotId: "L-longe" })).toEqual([{ lotId: "L-longe", lotCode: "L-longe", qty: 2 }]);
    expect(code(() => pickLotsFefo(lots, 5, today, { chosenLotId: "L-perto" }))).toBe("INSUFFICIENT_STOCK");
  });

  it("E4: lote vencido escolhido para consumo é bloqueado", () => {
    expect(code(() => pickLotsFefo(lots, 1, today, { chosenLotId: "L-vencido" }))).toBe("LOT_EXPIRED");
  });

  it("E4: só sobrou lote vencido → o consumo é bloqueado (não cai no vencido por engano)", () => {
    expect(code(() => pickLotsFefo([lot("L-vencido", "2026-11-01", 3)], 1, today))).toBe("LOT_EXPIRED");
  });

  it("E4: perda por vencimento usa SÓ lote vencido; lote vigente é recusado", () => {
    expect(pickLotsFefo(lots, 3, today, { expiryLoss: true })).toEqual([{ lotId: "L-vencido", lotCode: "L-vencido", qty: 3 }]);
    expect(code(() => pickLotsFefo(lots, 1, today, { expiryLoss: true, chosenLotId: "L-longe" }))).toBe("LOT_NOT_EXPIRED");
    expect(code(() => pickLotsFefo(lots, 4, today, { expiryLoss: true }))).toBe("LOT_NOT_EXPIRED");
  });

  it("saldo insuficiente e quantidade inválida", () => {
    expect(code(() => pickLotsFefo(lots, 50, today))).toBe("INSUFFICIENT_STOCK");
    expect(code(() => pickLotsFefo(lots, 0, today))).toBe("INVALID_QUANTITY");
    expect(code(() => pickLotsFefo(lots, 1.2345, today))).toBe("INVALID_QUANTITY");
  });

  it("a fração reservada por unidade aberta não está disponível para saída inteira", () => {
    const withOpen = [lot("L1", "2027-01-01", 2, 1.5)];
    expect(code(() => pickLotsFefo(withOpen, 2, today))).toBe("INSUFFICIENT_STOCK");
    expect(pickLotsFefo(withOpen, 1.5, today)[0].qty).toBe(1.5);
  });

  it("alertas de vencimento padrão: vencido, 30, 60 e 90 dias", () => {
    expect(expiryStatus(null, today)).toBe("none");
    expect(expiryStatus("2026-11-12", today)).toBe("expired");
    expect(expiryStatus("2026-11-13", today)).toBe("d30");
    expect(expiryStatus("2026-12-13", today)).toBe("d30");
    expect(expiryStatus("2027-01-12", today)).toBe("d60");
    expect(expiryStatus("2027-02-11", today)).toBe("d90");
    expect(expiryStatus("2027-02-12", today)).toBe("ok");
  });
});

describe("uso fracionado e individual por paciente (escopo-v1 §8.1/8.3, E5, E12)", () => {
  it("E5: aberto em 01/11, validade após aberto 28 dias, lote vence 30/12 → vence em 29/11", () => {
    expect(openedUnitExpiry("2026-11-01", 28, "2026-12-30")).toBe("2026-11-29");
  });
  it("a validade nunca passa a do lote", () => {
    expect(openedUnitExpiry("2026-11-01", 28, "2026-11-10")).toBe("2026-11-10");
    expect(openedUnitExpiry("2026-11-01", 28, null)).toBe("2026-11-29");
    expect(openedUnitExpiry("2026-11-01", null, "2026-12-30")).toBe("2026-12-30");
    expect(addIsoDays("2026-12-20", 15)).toBe("2027-01-04");
  });

  const unit = { openUnitId: "o1", patientId: "X", qtyRemaining: 0.75, expiresOn: "2026-11-29" };
  it("E12: caneta aberta para o paciente X; dose para o paciente Y é bloqueada (a tela oferece abrir nova unidade)", () => {
    expect(code(() => checkDose(unit, 0.25, "Y", "2026-11-13", { individualUse: true }))).toBe("OPEN_UNIT_OTHER_PATIENT");
    expect(code(() => checkDose(unit, 0.25, "X", "2026-11-13", { individualUse: true }))).toBeNull();
  });
  it("item que não é de uso individual não prende a unidade ao paciente", () => {
    expect(code(() => checkDose(unit, 0.25, "Y", "2026-11-13", { individualUse: false }))).toBeNull();
  });
  it("dose maior que o restante, unidade vencida e descarte da sobra", () => {
    expect(code(() => checkDose(unit, 0.8, "X", "2026-11-13", { individualUse: true }))).toBe("INSUFFICIENT_OPEN_UNIT");
    expect(code(() => checkDose(unit, 0.1, "X", "2026-11-30", { individualUse: true }))).toBe("OPEN_UNIT_EXPIRED");
    expect(code(() => checkDose(unit, 0.75, "X", "2026-11-30", { individualUse: true, isLoss: true, expiryLoss: true }))).toBeNull();
    expect(code(() => checkDose(unit, 0.75, null, "2026-11-13", { individualUse: true, isLoss: true }))).toBeNull(); // descarte da sobra não depende do paciente
  });
  it("quantidade: até 3 casas; não fracionado só inteiro; fracionado acima de 1 só inteiro", () => {
    expect(code(() => checkExitQuantity(0.25, true))).toBeNull();
    expect(code(() => checkExitQuantity(0.1234, true))).toBe("INVALID_QUANTITY");
    expect(code(() => checkExitQuantity(0.5, false))).toBe("NOT_FRACTIONAL");
    expect(code(() => checkExitQuantity(1.5, true))).toBe("FRACTION_EXCEEDS_UNIT");
    expect(code(() => checkExitQuantity(3, true))).toBeNull();
    expect(hasValidDecimals(0.333)).toBe(true);
    expect(hasValidDecimals(0.3333)).toBe(false);
  });
});

describe("formulário de saída: motivo obrigatório e confirmações", () => {
  const base = { type: "loss" as const, qty: 1, reason: "", purpose: "", lossKind: "" as const, patientId: "", confirmExpired: false };
  const ctx = { fractional: false, individualUse: false, selectedLotExpired: false };
  it("perda exige o tipo e o motivo", () => {
    const e = validateExit(base, ctx);
    expect(e.lossKind).toBeTruthy();
    expect(e.reason).toBeTruthy();
    expect(validateExit({ ...base, lossKind: "breakage", reason: "Caiu no chão" }, ctx)).toEqual({});
  });
  it("perda por vencimento de lote vencido exige a confirmação", () => {
    const d = { ...base, lossKind: "expiry" as const, reason: "Lote venceu" };
    expect(validateExit(d, { ...ctx, selectedLotExpired: true }).confirm).toBeTruthy();
    expect(validateExit({ ...d, confirmExpired: true }, { ...ctx, selectedLotExpired: true })).toEqual({});
  });
  it("consumo interno exige setor e motivo; uso por paciente exige o paciente; quantidade válida", () => {
    expect(validateExit({ ...base, type: "sector" }, ctx)).toMatchObject({ purpose: expect.any(String), reason: expect.any(String) });
    expect(validateExit({ ...base, type: "appointment" }, ctx).patient).toBeTruthy();
    expect(validateExit({ ...base, type: "appointment", patientId: "p" }, ctx)).toEqual({});
    expect(validateExit({ ...base, type: "appointment", patientId: "p", qty: 0.5 }, ctx).qty).toMatch(/inteiras/);
    expect(validateExit({ ...base, type: "appointment", patientId: "p", qty: null }, ctx).qty).toBeTruthy();
  });
});

describe("mensagens do servidor em português", () => {
  it("traduz os códigos do estoque; permissão; desconhecido", () => {
    expect(stockMoveErrorMessage({ message: "LOT_EXPIRED" })).toMatch(/perda por vencimento/);
    expect(stockMoveErrorMessage({ message: "INITIAL_BALANCE_EXISTS" })).toMatch(/saldo inicial/);
    expect(stockMoveErrorMessage({ message: "INSUFFICIENT_STOCK" })).toMatch(/Saldo insuficiente/);
    expect(stockMoveErrorMessage({ message: "forbidden", code: "42501" })).toMatch(/permissão/);
    expect(stockMoveErrorMessage({ message: "xyz" })).toMatch(/Tente novamente/);
  });
});

function roundTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
