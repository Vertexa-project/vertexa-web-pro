import { describe, expect, it } from "vitest";

import { canSeeFinanceCadastros, canSeeFinanceMenu, canSeeStockMenu, finCan, NO_FIN_ACCESS, rowToAccess } from "./finAccess";

const acc = (can: Record<string, boolean>, isAdmin = false) => ({ ...NO_FIN_ACCESS, isAdmin, can });

describe("visibilidade do menu pela matriz de papéis", () => {
  it("sem papel: nada de Financeiro nem Estoque", () => {
    expect(canSeeFinanceMenu(NO_FIN_ACCESS)).toBe(false);
    expect(canSeeStockMenu(NO_FIN_ACCESS)).toBe(false);
  });
  it("recepção (só lê unidades): sem cadastros financeiros nem estoque", () => {
    const a = acc({ units_read: true });
    expect(canSeeFinanceCadastros(a)).toBe(false);
    expect(canSeeFinanceMenu(a)).toBe(false);
    expect(canSeeStockMenu(a)).toBe(false);
  });
  it("financeiro: Cadastros e Estoque (consulta)", () => {
    const a = acc({ services_read: true, services_write: true, stock_items_read: true, stock_items_write: false });
    expect(canSeeFinanceMenu(a)).toBe(true);
    expect(canSeeStockMenu(a)).toBe(true);
    expect(finCan(a, "stock_items", "write")).toBe(false);
  });
  it("estoquista: só Estoque", () => {
    const a = acc({ stock_items_read: true, stock_items_write: true });
    expect(canSeeFinanceMenu(a)).toBe(false);
    expect(canSeeStockMenu(a)).toBe(true);
  });
  it("admin vê tudo", () => {
    expect(canSeeFinanceMenu(acc({}, true))).toBe(true);
    expect(canSeeStockMenu(acc({}, true))).toBe(true);
  });
  it("converte a resposta da RPC fin_my_access", () => {
    const a = rowToAccess({ is_admin: false, roles: [{ role: "gestor", all_units: false, unit_ids: ["u1"] }], can: { audit_read: true } });
    expect(a.roles).toEqual([{ role: "gestor", allUnits: false, unitIds: ["u1"] }]);
    expect(finCan(a, "audit")).toBe(true);
    expect(rowToAccess(null)).toEqual(NO_FIN_ACCESS);
  });
});
