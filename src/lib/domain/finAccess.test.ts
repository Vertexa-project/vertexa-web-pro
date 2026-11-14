import { describe, expect, it } from "vitest";

import { canDeliverPackageItem, canManageAppointments, canManagePayoutRules, canRecalcPayout, canSeeAllPayouts, canSeePayout, canSeePayoutRules, canMoveStock, canSeeAppointments, canSeePatientPackages, canStartAppointment, canSeeFinanceCadastros, canSeeFinanceMenu, canSeeStockMenu, canSeeStockMoves, finCan, financeTabs, NO_FIN_ACCESS, rowToAccess, stockTabs, canPayClosing, canPrepareClosing, canDecideClosing, canSeeClosing, canSeeMyStatement, canUnlockClosing } from "./finAccess";

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
    expect(tabsOf({}, true)).toEqual(["Mensalidades", "Vendas", "Atendimentos", "Pacotes dos pacientes", "Repasse", "Títulos", "Caixa", "Cadastros"]);
  });
  it("sem papel: nenhuma aba", () => {
    expect(tabsOf({})).toEqual([]);
  });
});

describe("abas do Estoque pela matriz de papéis (Entrega 3)", () => {
  const labels = (a: ReturnType<typeof acc>) => stockTabs(a).map((t) => t.label);
  it("Estoquista e Gestor movimentam: Saldo, Entradas, Saídas, Movimentações e Itens", () => {
    const a = acc({ stock_items_read: true, stock_items_write: true, stock_move_read: true, stock_move_write: true });
    expect(labels(a)).toEqual(["Saldo", "Entradas", "Saídas", "Movimentações", "Consumo sem saldo", "Itens"]);
    expect(canMoveStock(a)).toBe(true);
  });
  it("Financeiro só consulta: vê as abas (com custo), mas não movimenta", () => {
    const a = acc({ stock_items_read: true, stock_move_read: true, stock_move_write: false });
    expect(labels(a)).toEqual(["Saldo", "Entradas", "Saídas", "Movimentações", "Consumo sem saldo", "Itens"]);
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
    expect(labels(acc({}, true))).toHaveLength(6);
    expect(canMoveStock(acc({}, true))).toBe(true);
  });
});

describe("abas e botões da Entrega 4 (atendimento, kit e pacotes)", () => {
  const tabsOf = (can: Record<string, boolean>, isAdmin = false) => financeTabs(acc(can, isAdmin)).map((t) => t.label);
  it("Gestor/Financeiro: Atendimentos (todos); só o Gestor gerencia", () => {
    const g = acc({ appt_read: true, appt_write: true, patient_pkg_read: true, sales_read: true });
    expect(tabsOf(g.can)).toEqual(["Vendas", "Atendimentos", "Pacotes dos pacientes"]);
    expect(canManageAppointments(g)).toBe(true);
    const f = acc({ appt_read: true, patient_pkg_read: true });
    expect(canSeeAppointments(f)).toBe(true);
    expect(canManageAppointments(f)).toBe(false);
  });
  it("Profissional participante: vê Atendimentos (os próprios) e pode registrar o próprio; não vê pacotes de todos", () => {
    const p = acc({ own_sales_read: true, own_appt: true });
    expect(tabsOf(p.can)).toEqual(["Vendas", "Atendimentos"]);
    expect(canStartAppointment(p)).toBe(true);
    expect(canManageAppointments(p)).toBe(false);
    expect(canSeePatientPackages(p)).toBe(false);
  });
  it("Recepção: pacotes dos pacientes e entrega do item; sem Atendimentos", () => {
    const r = acc({ sales_read: true, sales_write: true, patient_pkg_read: true, package_deliver_read: true, package_deliver_write: true });
    expect(tabsOf(r.can)).toEqual(["Vendas", "Pacotes dos pacientes"]);
    expect(canDeliverPackageItem(r)).toBe(true);
    expect(canSeeAppointments(r)).toBe(false);
  });
  it("Estoquista entrega item de pacote; Financeiro não", () => {
    expect(canDeliverPackageItem(acc({ package_deliver_write: true }))).toBe(true);
    expect(canDeliverPackageItem(acc({ patient_pkg_read: true, appt_read: true }))).toBe(false);
  });
});

describe("aba e botões da Entrega 5 (repasse)", () => {
  const tabsOf = (can: Record<string, boolean>, isAdmin = false) => financeTabs(acc(can, isAdmin)).map((t) => t.label);
  it("Gestor: vê todos os lançamentos, configura as regras e recalcula", () => {
    const g = acc({ share_rules_read: true, share_rules_write: true, share_lines_read: true, share_recalc_read: true, share_recalc_write: true });
    expect(tabsOf(g.can)).toEqual(["Repasse"]);
    expect(canSeePayout(g) && canSeeAllPayouts(g) && canSeePayoutRules(g) && canManagePayoutRules(g) && canRecalcPayout(g)).toBe(true);
  });
  it("Financeiro: consulta regras e lançamentos e recalcula; não configura", () => {
    const f = acc({ share_rules_read: true, share_lines_read: true, share_recalc_read: true, share_recalc_write: true });
    expect(canSeePayoutRules(f)).toBe(true);
    expect(canManagePayoutRules(f)).toBe(false);
    expect(canRecalcPayout(f)).toBe(true);
  });
  it("Profissional: vê a aba só com os próprios lançamentos; sem regras, sem recálculo, sem os dos outros", () => {
    const p = acc({ own_sales_read: true, own_appt: true, own_share: true });
    expect(tabsOf(p.can)).toEqual(["Vendas", "Atendimentos", "Repasse"]);
    expect(canSeePayout(p)).toBe(true);
    expect(canSeeAllPayouts(p)).toBe(false);
    expect(canSeePayoutRules(p)).toBe(false);
    expect(canRecalcPayout(p)).toBe(false);
  });
  it("Recepção e Estoquista: sem aba de repasse", () => {
    const r = acc({ sales_read: true, sales_write: true, patient_pkg_read: true });
    expect(tabsOf(r.can)).not.toContain("Repasse");
    expect(canSeePayout(acc({ stock_move_read: true, stock_move_write: true }))).toBe(false);
  });
  it("Admin vê tudo", () => {
    const a = acc({}, true);
    expect(canSeePayout(a) && canSeeAllPayouts(a) && canManagePayoutRules(a) && canRecalcPayout(a)).toBe(true);
  });
});

describe("fechamento mensal (Entrega 6): quem vê, prepara, decide, paga e destrava", () => {
  const gestor = acc({ share_lines_read: true, close_prepare_write: true, close_decide_write: true, close_pay_write: true });
  const financeiro = acc({ share_lines_read: true, close_prepare_write: true, close_pay_write: true });
  const pro = acc({ own_share: true });
  const recepcao = acc({ sales_read: true });
  it("Gestor: vê a tabela, prepara, aprova/trava e paga; destravar é só do Owner/Admin", () => {
    expect(canSeeClosing(gestor) && canPrepareClosing(gestor) && canDecideClosing(gestor) && canPayClosing(gestor)).toBe(true);
    expect(canUnlockClosing(gestor)).toBe(false);
    expect(canUnlockClosing(acc({}, true))).toBe(true);
  });
  it("Financeiro prepara e registra NF/pagamento, mas não aprova nem trava", () => {
    expect(canSeeClosing(financeiro) && canPrepareClosing(financeiro) && canPayClosing(financeiro)).toBe(true);
    expect(canDecideClosing(financeiro)).toBe(false);
    expect(canUnlockClosing(financeiro)).toBe(false);
  });
  it("profissional: só «Meu extrato»", () => {
    expect(canSeeMyStatement(pro)).toBe(true);
    expect(canSeeClosing(pro) || canPrepareClosing(pro) || canDecideClosing(pro) || canPayClosing(pro)).toBe(false);
  });
  it("Recepção e sem papel: nada do fechamento", () => {
    for (const a of [recepcao, NO_FIN_ACCESS]) expect(canSeeClosing(a) || canSeeMyStatement(a) || canPayClosing(a) || canDecideClosing(a) || canPrepareClosing(a)).toBe(false);
  });
  it("Admin vê e faz tudo", () => {
    const a = acc({}, true);
    expect(canSeeClosing(a) && canPrepareClosing(a) && canDecideClosing(a) && canPayClosing(a)).toBe(true);
  });
});
