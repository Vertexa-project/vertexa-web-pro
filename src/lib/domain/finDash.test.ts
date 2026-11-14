import { describe, expect, it } from "vitest";

import { NO_FIN_ACCESS, canSeeDashboard, financeTabs, type FinAccess } from "@/lib/domain/finAccess";
import {
  METRIC_INFO, PENDENCIES, marginNote, marginSign, agendaLabel, closingNote, countText, currentPeriod, dashErrorMessage, dashUnits, detailExportColumns, evolutionLines, moneyText, pctText, periodLabel, signedMoneyText,
  type DashEvolution, type DashMetric, type DashRow,
} from "@/lib/domain/finDash";
import { toCsv } from "@/lib/domain/tableExport";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { METRIC_HAS_VALUE } from "@/pages/finance/dash/dashColumns";

const ALL: DashMetric[] = [
  "sold", "ticket", "received", "fees", "to_receive", "overdue", "overdue_titles", "repasse", "pro_lines", "material", "tax", "products_revenue", "products_cost", "products_commission", "margin",
  "pro_appointments", "pro_margin", "service_appointments", "appt_no_sale", "unruled", "packages", "cash", "stock",
];
const acc = (over: Partial<FinAccess>): FinAccess => ({ ...NO_FIN_ACCESS, ...over });

describe("dinheiro e textos do painel", () => {
  it("zero e -0 aparecem como R$ 0,00, nunca «-R$ 0,00»", () => {
    expect(moneyText(0)).toMatch(/^R\$\s0,00$/);
    expect(moneyText(-0)).toMatch(/^R\$\s0,00$/);
    expect(moneyText(null)).toMatch(/^R\$\s0,00$/);
    expect(moneyText(-12000)).toMatch(/^-R\$\s120,00$/);
    expect(signedMoneyText(0)).toMatch(/^R\$\s0,00$/);
    expect(signedMoneyText(-5000)).toMatch(/^− R\$\s50,00$/);
    expect(signedMoneyText(5000)).toMatch(/^\+ R\$\s50,00$/);
  });
  it("percentual vazio é traço; com casas usa vírgula", () => {
    expect(pctText(null)).toBe("—");
    expect(pctText(50)).toBe("50%");
    expect(pctText(33.3)).toBe("33,3%");
  });
  it("plural da contagem", () => {
    expect(countText(1, "venda", "vendas")).toBe("1 venda");
    expect(countText(0, "venda", "vendas")).toBe("0 vendas");
  });
  it("o mês padrão é o de Brasília (23h30 de 30/11 em Brasília já é dezembro em UTC)", () => {
    expect(currentPeriod(todayIsoBR(new Date("2026-12-01T02:30:00Z")))).toBe("2026-11");
    expect(currentPeriod(todayIsoBR(new Date("2026-12-01T03:30:00Z")))).toBe("2026-12");
    expect(periodLabel("2026-11")).toBe("novembro de 2026");
  });
  it("rótulo da faixa da agenda", () => {
    expect(agendaLabel({ from: "2026-11-14", to: "2026-11-20" })).toBe("14/11 a 20/11");
    expect(agendaLabel({ from: "2027-02-12", to: null })).toBe("Depois de 90 dias");
    expect(agendaLabel({ from: "2026-11-14", to: "2026-11-14" })).toBe("14/11");
  });
  it("origem do repasse", () => {
    expect(closingNote(null, true)).toBe("Prévia dos lançamentos do mês");
    expect(closingNote("conferencia", true)).toBe("Fechamento: Em conferência");
    expect(closingNote("travado", false)).toBe("Lançamentos da unidade");
  });
  it("erros em português", () => {
    expect(dashErrorMessage({ message: "INVALID_PERIOD" })).toMatch(/mês válido/);
    expect(dashErrorMessage({ code: "42501", message: "forbidden" })).toMatch(/permissão/);
    expect(dashErrorMessage(new Error("x"))).toMatch(/Tente novamente/);
  });
  it("toda lista tem título e dica, e toda fila aponta para uma lista", () => {
    for (const m of ALL) { expect(METRIC_INFO[m].title.length).toBeGreaterThan(2); expect(METRIC_INFO[m].hint.length).toBeGreaterThan(10); }
    expect(PENDENCIES.map((p) => p.metric)).toEqual(["appt_no_sale", "unruled", "overdue_titles", "packages", "cash", "stock"]);
  });
});

describe("evolução de 12 meses", () => {
  const evo: DashEvolution[] = Array.from({ length: 12 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, "0")}`, sold_cents: 1000 * (i + 1), received_cents: 800 * (i + 1), margin_cents: i === 3 ? -500 : 200 * (i + 1) }));
  it("três linhas com 12 pontos dentro do quadro, margem negativa incluída", () => {
    const lines = evolutionLines(evo, 300, 100, 6);
    expect(lines.map((l) => l.key)).toEqual(["sold", "received", "margin"]);
    for (const l of lines) {
      const pts = l.points.split(" ").map((p) => p.split(",").map(Number));
      expect(pts).toHaveLength(12);
      for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(6); expect(x).toBeLessThanOrEqual(294); expect(y).toBeGreaterThanOrEqual(6); expect(y).toBeLessThanOrEqual(94); }
    }
  });
  it("sem dados não quebra", () => {
    expect(evolutionLines([]).every((l) => l.points === "")).toBe(true);
  });
});

describe("acesso ao painel", () => {
  it("Admin, Gestor e Financeiro veem; Recepção, Estoquista e profissional não", () => {
    expect(canSeeDashboard(acc({ isAdmin: true }))).toBe(true);
    expect(canSeeDashboard(acc({ can: { dash_read: true } }))).toBe(true);
    expect(canSeeDashboard(acc({ can: { sales_read: true, cash_read: true } }))).toBe(false);
    expect(canSeeDashboard(acc({ can: { stock_move_read: true } }))).toBe(false);
    expect(canSeeDashboard(acc({ can: { own_sales_read: true, own_share: true, own_appt: true } }))).toBe(false);
  });
  it("aba «Painel»: para o Admin vem depois de Mensalidades; para os demais é a primeira", () => {
    expect(financeTabs(acc({ isAdmin: true })).slice(0, 2).map((t) => t.label)).toEqual(["Mensalidades", "Painel"]);
    expect(financeTabs(acc({ can: { dash_read: true, sales_read: true } }))[0]).toEqual({ to: "/financeiro/painel", label: "Painel" });
    expect(financeTabs(acc({ can: { sales_read: true } })).some((t) => t.label === "Painel")).toBe(false);
  });
  it("unidades do painel: Admin e papel de todas as unidades veem todas; gestor restrito só as suas", () => {
    const units = [{ id: "u1" }, { id: "u2" }];
    expect(dashUnits(acc({ isAdmin: true }), units)).toHaveLength(2);
    expect(dashUnits(acc({ roles: [{ role: "financeiro", allUnits: true, unitIds: [] }] }), units)).toHaveLength(2);
    expect(dashUnits(acc({ roles: [{ role: "gestor", allUnits: false, unitIds: ["u1"] }] }), units)).toEqual([{ id: "u1" }]);
    expect(dashUnits(acc({ roles: [{ role: "recepcao", allUnits: true, unitIds: [] }] }), units)).toEqual([]);
  });
});

describe("exportação da lista aberta", () => {
  const row = (over: Record<string, unknown> = {}): DashRow => ({ id: "r1", value_cents: 12345, ...over });
  it("toda lista tem colunas de exportação e, quando soma no número, uma coluna com o valor da linha", () => {
    for (const m of ALL) {
      const cols = detailExportColumns(m);
      expect(cols.length).toBeGreaterThan(1);
      const csv = toCsv(cols, [row({ patient_name: "Maria", unit_name: "Unidade 1", at: "2026-11-05T13:00:00Z", date: "2026-11-05", quantity: 2, qty_on_hand: 3, min_qty: 5, remaining: 2, rate_pct: 6, base_cents: 100000 })]);
      expect(csv.split("\n").length).toBeGreaterThanOrEqual(2);
      if (METRIC_HAS_VALUE[m] && !["received", "fees", "tax"].includes(m)) expect(csv).toContain("123,45");
    }
  });
  it("recebido exporta bruto, taxa e líquido; taxas exporta o mesmo conjunto", () => {
    const r = row({ gross_cents: 50000, fee_cents: 2600, net_cents: 47400, date: "2026-11-02", installment: "1/3", method_label: "Maq1 · Visa" });
    const csv = toCsv(detailExportColumns("received"), [r]);
    expect(csv).toContain("500,00"); expect(csv).toContain("26,00"); expect(csv).toContain("474,00"); expect(csv).toContain("02/11/2026");
  });
});

describe("atalho do painel leva o filtro (D42)", () => {
  it("monta mês e unidade no endereço", async () => {
    const { monthBounds, withFilter } = await import("@/lib/domain/finDash");
    expect(monthBounds("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(withFilter("/financeiro/vendas", { de: "2026-11-01", ate: "2026-11-30", unidade: null, situacao: "ativas" })).toBe("/financeiro/vendas?de=2026-11-01&ate=2026-11-30&situacao=ativas");
    expect(withFilter("/x", {})).toBe("/x");
  });
});

describe("margem: sinal real do componente (D42)", () => {
  it("o sinal vem do valor; custo líquido negativo entra somando e ganha aviso", () => {
    expect(marginSign(-4464)).toBe("−");
    expect(marginSign(4464)).toBe("+");
    expect(marginNote("−", 4464)).toMatch(/Entra somando/);
    expect(marginNote("−", -4464)).toBeNull();
    expect(marginNote("+", 100)).toBeNull();
  });
});
