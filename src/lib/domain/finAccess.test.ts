import { describe, expect, it } from "vitest";

import { canMoveStock, canSeeFinanceCadastros, canSeeFinanceMenu, canSeeStockMenu, canSeeStockMoves, finCan, financeTabs, NO_FIN_ACCESS, rowToAccess, stockTabs } from "./finAccess";

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

import { mainNav } from "@/app/routes";
import { filterNav } from "@/hooks/useVisibleNav";

describe("menu lateral pela matriz de papéis", () => {
  const paths = (a: ReturnType<typeof acc>, admin = false) => filterNav(mainNav, admin, a).map((i) => i.path);
  it("financeiro vê Financeiro e Estoque, mas não Gestão", () => {
    const p = paths(acc({ services_read: true, stock_items_read: true }));
    expect(p).toContain("/financeiro");
    expect(p).toContain("/estoque");
    expect(p).not.toContain("/gestao");
  });
  it("estoquista vê só Estoque; recepção não vê nenhum dos dois", () => {
    const e = paths(acc({ stock_items_read: true, stock_items_write: true }));
    expect(e).toContain("/estoque");
    expect(e).not.toContain("/financeiro");
    const r = paths(acc({ units_read: true }));
    expect(r).not.toContain("/estoque");
    expect(r).not.toContain("/financeiro");
  });
  it("admin vê todos", () => {
    const p = paths(NO_FIN_ACCESS, true);
    expect(p).toEqual(expect.arrayContaining(["/financeiro", "/estoque", "/gestao"]));
  });
});

describe("abas do Financeiro na Entrega 2 (Vendas, Títulos, Caixa)", () => {
  const tabsOf = (can: Record<string, boolean>, isAdmin = false) => financeTabs(acc(can, isAdmin)).map((t) => t.label);
  it("Recepção: Vendas e Caixa; sem Títulos (taxa) nem Cadastros; menu Financeiro aparece", () => {
    const a = acc({ units_read: true, sales_read: true, sales_write: true, cash_read: true, cash_write: true });
    expect(tabsOf(a.can)).toEqual(["Vendas", "Caixa"]);
    expect(canSeeFinanceMenu(a)).toBe(true);
    expect(canSeeStockMenu(a)).toBe(false);
  });
  it("Financeiro: Vendas, Títulos, Caixa e Cadastros", () => {
    expect(tabsOf({ sales_read: true, receivables_read: true, cash_read: true, services_read: true })).toEqual(["Vendas", "Títulos", "Caixa", "Cadastros"]);
  });
  it("Profissional sem papel: só Vendas (a própria produção); sem Caixa nem Títulos", () => {
    const a = acc({ own_sales_read: true });
    expect(tabsOf(a.can)).toEqual(["Vendas"]);
    expect(canSeeFinanceMenu(a)).toBe(true);
  });
  it("Admin: todas as abas, Mensalidades primeiro", () => {
    expect(tabsOf({}, true)).toEqual(["Mensalidades", "Vendas", "Títulos", "Caixa", "Cadastros"]);
  });
  it("sem papel: nenhuma aba", () => {
    expect(tabsOf({})).toEqual([]);
  });
});

describe("abas do Estoque pela matriz de papéis (Entrega 3)", () => {
  const labels = (a: ReturnType<typeof acc>) => stockTabs(a).map((t) => t.label);
  it("Estoquista e Gestor movimentam: Saldo, Entradas, Saídas, Movimentações e Itens", () => {
    const a = acc({ stock_items_read: true, stock_items_write: true, stock_move_read: true, stock_move_write: true });
    expect(labels(a)).toEqual(["Saldo", "Entradas", "Saídas", "Movimentações", "Itens"]);
    expect(canMoveStock(a)).toBe(true);
  });
  it("Financeiro só consulta: vê as abas (com custo), mas não movimenta", () => {
    const a = acc({ stock_items_read: true, stock_move_read: true, stock_move_write: false });
    expect(labels(a)).toEqual(["Saldo", "Entradas", "Saídas", "Movimentações", "Itens"]);
    expect(canSeeStockMoves(a)).toBe(true);
    expect(canMoveStock(a)).toBe(false);
  });
  it("Recepção e profissional: nenhuma aba de estoque", () => {
    const a = acc({ units_read: true, sales_read: true, sales_write: true });
    expect(labels(a)).toEqual([]);
    expect(canSeeStockMenu(a)).toBe(false);
    expect(canSeeStockMoves(a)).toBe(false);
    expect(canMoveStock(a)).toBe(false);
  });
  it("Admin vê e movimenta tudo", () => {
    expect(labels(acc({}, true))).toHaveLength(5);
    expect(canMoveStock(acc({}, true))).toBe(true);
  });
});
