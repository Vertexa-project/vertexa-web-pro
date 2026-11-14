import { describe, expect, it } from "vitest";

import type { InventoryLine, TransferLine } from "@/lib/api/stockE8";
import { changedCounts, countProgress, e8ErrorMessage, linesShowExpected, moneyOrZero, parseCountText, receiveDraftFor, signedQty, sumField, validateReceive } from "./stockE8";
import { exportColumns, REPORT_COLUMNS, totalsMatch } from "./stockReports";

const line = (over: Partial<InventoryLine> = {}): InventoryLine => ({
  id: "l1", item_id: "i1", item_name: "Ampola X", category: "amp", stock_unit: "ampola", fractional: false, ean: null, lot_id: "lot1", lot_code: "L1", expiry_date: "2999-01-01", is_extra: false,
  counted_qty: null, counted_at: null, counted_by_name: null, expected_qty: null, moved_qty: null, diff_qty: null, avg_cost_cents: null, diff_value_cents: null, adjust_movement_id: null, ...over,
});
const tline = (over: Partial<TransferLine> = {}): TransferLine => ({
  line_id: "t1", item_id: "i1", item_name: "Ampola X", stock_unit: "ampola", lot_code: "L1", expiry_date: "2999-01-01", qty_sent: 10, qty_received: null, unit_cost_cents: 4400, total_cost_cents: 44000,
  received_cost_cents: null, loss_qty: null, loss_cents: null, receive_reason: null, dest_lot_code: null, dest_expiry_date: null, ...over,
});

describe("contagem do inventário", () => {
  it("lê vírgula decimal, vazio = ainda não contada e recusa fração em item inteiro", () => {
    expect(parseCountText("12", false)).toEqual({ ok: true, qty: 12 });
    expect(parseCountText("2,5", true)).toEqual({ ok: true, qty: 2.5 });
    expect(parseCountText("  ", false)).toEqual({ ok: true, qty: null });
    expect(parseCountText("2,5", false).ok).toBe(false);
    expect(parseCountText("1,2345", true).ok).toBe(false);
    expect(parseCountText("-1", false).ok).toBe(false);
    expect(parseCountText("abc", false).ok).toBe(false);
  });
  it("só manda ao servidor o que mudou e conta o progresso com o rascunho", () => {
    const ls = [line({ id: "a", counted_qty: 3 }), line({ id: "b" }), line({ id: "c" })];
    expect(changedCounts(ls, { a: "3", b: "5", c: "x" })).toEqual([{ lineId: "b", countedQty: 5 }]);
    expect(changedCounts(ls, { a: "" })).toEqual([{ lineId: "a", countedQty: null }]);
    expect(countProgress(ls, { b: "5" })).toEqual({ counted: 2, total: 3 });
  });
  it("contagem cega: sem esperado em nenhuma linha, a tela não mostra coluna de esperado", () => {
    expect(linesShowExpected([line(), line({ id: "z" })])).toBe(false);
    expect(linesShowExpected([line({ expected_qty: 0 })])).toBe(true);
  });
});

describe("recebimento de transferência", () => {
  it("recebimento igual ao enviado não pede motivo", () => {
    const l = tline();
    expect(validateReceive(l, receiveDraftFor(l))).toEqual({ diverges: false, qty: 10 });
  });
  it("quantidade a menos ou lote diferente exige motivo; a mais é recusada", () => {
    const l = tline();
    const d = receiveDraftFor(l);
    expect(validateReceive(l, { ...d, qty: "8" })).toMatchObject({ diverges: true, error: "Divergência: informe o motivo." });
    const ok = validateReceive(l, { ...d, qty: "8", reason: "caixa avariada" });
    expect(ok).toMatchObject({ diverges: true, qty: 8 });
    expect(ok.error).toBeUndefined();
    expect(validateReceive(l, { ...d, lotCode: "L9" })).toMatchObject({ diverges: true, error: "Divergência: informe o motivo." });
    expect(validateReceive(l, { ...d, qty: "11" }).error).toMatch(/Não pode passar/);
    expect(validateReceive(l, { ...d, qty: "" }).error).toMatch(/Informe a quantidade/);
    expect(validateReceive(l, { ...d, qty: "0", reason: "não chegou" })).toMatchObject({ diverges: true, qty: 0 });
  });
});

describe("formatação e mensagens", () => {
  it("nunca mostra -R$ 0,00 e usa sinal tipográfico na diferença", () => {
    expect(moneyOrZero(-0.4)).not.toContain("-");
    expect(moneyOrZero(0)).toBe(moneyOrZero(-0));
    expect(moneyOrZero(-1500)).toContain("15,00");
    expect(signedQty(2)).toBe("+2"); expect(signedQty(-3)).toBe("−3"); expect(signedQty(0)).toBe("0");
  });
  it("traduz os erros do servidor e cai numa mensagem padrão", () => {
    expect(e8ErrorMessage({ message: "INVENTORY_ALREADY_OPEN" })).toMatch(/já existe um inventário aberto/i);
    expect(e8ErrorMessage({ message: "DIVERGENCE_REASON_REQUIRED" })).toMatch(/motivo/i);
    expect(e8ErrorMessage({ code: "42501", message: "forbidden" })).toMatch(/permissão/);
    expect(e8ErrorMessage({ message: "boom" })).toMatch(/Não foi possível/);
  });
});

describe("relatórios: soma da lista = total", () => {
  it("confere o total do servidor com a soma das linhas e exporta o valor em centavos", () => {
    const rows = [{ ord: 1, value_cents: 1000, count: 2 }, { ord: 2, value_cents: 550, count: 1 }];
    expect(sumField(rows, "value_cents")).toBe(1550);
    expect(totalsMatch("losses", rows, { count: 3, value_cents: 1550 })).toBe(true);
    expect(totalsMatch("losses", rows, { count: 3, value_cents: 1551 })).toBe(false);
    const cols = exportColumns("position");
    const valor = cols.find((c) => c.header === "Valor");
    expect(valor?.kind).toBe("money");
    expect(valor?.value({ value_cents: 1234 })).toBe(1234);
    expect(Object.keys(REPORT_COLUMNS).sort()).toEqual(["consumption", "idle", "losses", "movements", "position", "purchases", "validity"]);
  });
});
