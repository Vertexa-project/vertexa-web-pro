import { describe, expect, it } from "vitest";

import { applyTypeDefaults, stockServerErrorMessage, typeLocks, validateStockItem, type StockItemDraft } from "./stockItemRules";

const base: StockItemDraft = {
  name: "Item", category: "Cat", itemType: "consumable", fractional: false, openedValidityDays: null, individualUse: false,
  lotControl: false, sellable: false, salePriceCents: null, controlled: false, purchaseToStock: 1, stockToConsumption: 1, ean: "",
};

describe("regras do item de estoque (escopo-v1 §8.1)", () => {
  it("trava lote e validade em medicação e manipulado; liberado nos demais", () => {
    expect(typeLocks("medication").lotControl).toEqual({ value: true, locked: true });
    expect(typeLocks("compounded").lotControl).toEqual({ value: true, locked: true });
    expect(typeLocks("resale").lotControl.locked).toBe(false);
    expect(typeLocks("consumable").lotControl.locked).toBe(false);
  });
  it("venda ao paciente: bloqueada em medicação (D20) e consumo; fixa em revenda; livre em manipulado", () => {
    expect(typeLocks("medication").sellable).toEqual({ value: false, locked: true });
    expect(typeLocks("consumable").sellable).toEqual({ value: false, locked: true });
    expect(typeLocks("resale").sellable).toEqual({ value: true, locked: true });
    expect(typeLocks("compounded").sellable.locked).toBe(false);
  });
  it("uso individual por paciente: padrão 'sim' só para medicação aplicada", () => {
    expect(typeLocks("medication").individualUseDefault).toBe(true);
    expect(typeLocks("resale").individualUseDefault).toBe(false);
    expect(applyTypeDefaults(base, "medication", true).individualUse).toBe(true);
    expect(applyTypeDefaults({ ...base, individualUse: false }, "medication", false).individualUse).toBe(false);
  });
  it("trocar o tipo aplica as travas (medicação → lote ligado, venda desligada)", () => {
    const d = applyTypeDefaults({ ...base, sellable: true }, "medication", true);
    expect(d).toMatchObject({ itemType: "medication", lotControl: true, sellable: false });
  });
  it("E8: item controlado (Portaria 344) é recusado com aviso", () => {
    expect(validateStockItem({ ...base, controlled: true }).controlled).toMatch(/Portaria 344/);
  });
  it("E13: medicação não pode ser vendida", () => {
    expect(validateStockItem({ ...base, itemType: "medication", lotControl: true, sellable: true }).sellable).toBeTruthy();
    expect(validateStockItem({ ...base, itemType: "medication", lotControl: true, sellable: false })).toEqual({});
  });
  it("medicação e manipulado exigem lote", () => {
    expect(validateStockItem({ ...base, itemType: "compounded", lotControl: false }).lotControl).toBeTruthy();
    expect(validateStockItem({ ...base, itemType: "compounded", lotControl: true })).toEqual({});
  });
  it("revenda e manipulado vendido exigem preço de venda", () => {
    expect(validateStockItem({ ...base, itemType: "resale", sellable: true }).salePrice).toBeTruthy();
    expect(validateStockItem({ ...base, itemType: "resale", sellable: true, salePriceCents: 8990 })).toEqual({});
    expect(validateStockItem({ ...base, itemType: "compounded", lotControl: true, sellable: true }).salePrice).toBeTruthy();
    expect(validateStockItem({ ...base, itemType: "compounded", lotControl: true, sellable: false })).toEqual({});
  });
  it("uso fracionado exige validade após aberto", () => {
    expect(validateStockItem({ ...base, fractional: true }).openedValidity).toBeTruthy();
    expect(validateStockItem({ ...base, fractional: true, openedValidityDays: 28 })).toEqual({});
  });
  it("nome, categoria, fator e EAN", () => {
    expect(validateStockItem({ ...base, name: " ", category: "" })).toMatchObject({ name: expect.any(String), category: expect.any(String) });
    expect(validateStockItem({ ...base, purchaseToStock: 0 }).factors).toBeTruthy();
    expect(validateStockItem({ ...base, ean: "123" }).ean).toBeTruthy();
    expect(validateStockItem({ ...base, ean: "7891234567895" })).toEqual({});
  });
  it("mensagem do servidor vira texto em português", () => {
    expect(stockServerErrorMessage({ message: "STOCK_CONTROLLED_BLOCKED" })).toMatch(/Portaria 344/);
    expect(stockServerErrorMessage({ message: "MEDICATION_NOT_SELLABLE" })).toMatch(/não é vendida/);
    expect(stockServerErrorMessage({ code: "42501", message: "forbidden" })).toMatch(/permissão/);
    expect(stockServerErrorMessage(new Error("boom"))).toMatch(/Não foi possível/);
  });
});
