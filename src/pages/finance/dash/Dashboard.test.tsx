import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { DashboardTab } from "./DashboardTab";
import type { DashDetail, DashRow, DashSummary, DashTarget } from "@/lib/domain/finDash";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false, roles: [] as { role: string; allUnits: boolean; unitIds: string[] }[], summary: null as unknown, summaryError: false, summaryArgs: [] as unknown[],
  detail: ((t: unknown) => t) as (t: unknown) => unknown, detailArgs: [] as unknown[], more: vi.fn(),
}));

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: state.roles, can: state.can } }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal" }, { id: "u2", name: "Unidade 2" }] }),
}));
vi.mock("@/hooks/useFinDash", () => ({
  useDashboard: (_c: unknown, period: string, unit: unknown) => {
    state.summaryArgs.push({ period, unit });
    return { data: state.summaryError ? undefined : state.summary, isLoading: false, isError: state.summaryError, error: state.summaryError ? { code: "42501" } : null, refetch: vi.fn() };
  },
  useDashDetail: (_c: unknown, target: DashTarget | null) => {
    if (target) state.detailArgs.push(target);
    return { data: target ? state.detail(target) : undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock("@/lib/api/finDash", () => ({ getDashboardDetail: (...a: unknown[]) => state.more(...a) }));
vi.mock("@/pages/finance/payout/closing/StatementDialog", () => ({ StatementDialog: ({ statementId }: { statementId: string }) => <div role="dialog" aria-label="Extrato">extrato {statementId}</div> }));

const wrap = () => render(<MemoryRouter initialEntries={["/financeiro/painel"]}><DashboardTab /></MemoryRouter>);
const GESTOR = { dash_read: true, sales_read: true, receivables_read: true, share_lines_read: true, appt_read: true, share_rules_read: true, cash_read: true, stock_move_read: true, patient_pkg_read: true };
const nm = (s: string) => new RegExp("^" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s") + "$");
const closeBtn = (dlg: HTMLElement) => within(dlg).getAllByRole("button", { name: "Fechar" }).at(-1) as HTMLElement;
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

const summary = (over: Partial<DashSummary> = {}): DashSummary => ({
  period: "2026-11", unit_id: null, today: "2026-11-14", overdue_days: 7, all_units: true, closing_status: null,
  cards: {
    sold_cents: 30000, sold_count: 3, ticket_cents: 10000, received_cents: 20000, fees_cents: 1000, tax_cents: 600, material_cents: 1500, repasse_cents: 9000, products_cost_cents: 0, margin_cents: 7900,
    products_revenue_cents: 4000, products_commission_cents: 400, products_margin_cents: 3600, to_receive_cents: 9000, to_receive_count: 2, overdue_cents: 7000, overdue_count: 2,
    overdue_titles_cents: 5000, overdue_titles_count: 1, overdue_sales_cents: 2000, overdue_sales_count: 1,
  },
  evolution: Array.from({ length: 12 }, (_, i) => ({ period: `2025-12`.replace("2025-12", i === 0 ? "2025-12" : `2026-${String(i).padStart(2, "0")}`), sold_cents: 1000 * i, received_cents: 500 * i, margin_cents: 100 * i })),
  by_method: [{ key: "pix", label: "Pix", cents: 12000, count: 2 }, { key: "machine:x:visa", label: "Maq1 · Visa", cents: 8000, count: 1 }],
  by_professional: [
    { professional_id: "p1", name: "Dra. Ana", appointments: 2, revenue_cents: 15000, material_cents: 1000, repasse_cents: 6000, repasse_source: "lines", closing_pro_id: null, pct_repassed: 40, margin_cents: 8000 },
    { professional_id: "p2", name: "Enf. Bia", appointments: 1, revenue_cents: 5000, material_cents: 500, repasse_cents: 3000, repasse_source: "closing", closing_pro_id: "cp9", pct_repassed: 60, margin_cents: 1500 },
  ],
  by_service: [{ service_id: "sv1", name: "Consulta", quantity: 3, revenue_cents: 20000, material_cents: 1500, avg_material_cents: 500, unit_margin_cents: 6167 }],
  agenda: Array.from({ length: 14 }, (_, i) => ({ from: `2026-11-${String(14 + i).padStart(2, "0")}`, to: i === 13 ? null : `2026-11-${String(20 + i).padStart(2, "0")}`, cents: i === 0 ? 6000 : i === 5 ? 3000 : 0, count: i === 0 ? 1 : i === 5 ? 1 : 0 })),
  pendencies: { appt_no_sale: { count: 2, cents: 0 }, unruled: { count: 1, cents: 0 }, overdue_titles: { count: 1, cents: 5000 }, packages: { count: 0, cents: 0 }, cash: { count: 2, cents: 2500 }, stock: { count: 1, cents: 0 } },
  ...over,
});

const row = (id: string, value: number, extra: Record<string, unknown> = {}): DashRow => ({ id, value_cents: value, patient_name: `Paciente ${id}`, unit_name: "Unidade principal", ...extra });
const detail = (t: DashTarget, rows: DashRow[], over: Partial<DashDetail> = {}): DashDetail => ({
  metric: t.metric, period: t.period, count: rows.length, total_cents: rows.reduce((a, r) => a + r.value_cents, 0), offset: 0, limit: 300, truncated: false, rows, ...over,
});
const FIXTURE: Record<string, (t: DashTarget) => DashDetail> = {
  sold: (t) => detail(t, [row("v1", 10000, { at: "2026-11-02T13:00:00Z", status: "paid" }), row("v2", 10000, { at: "2026-11-03T13:00:00Z", status: "open" }), row("v3", 10000, { at: "2026-11-04T13:00:00Z", status: "paid" })]),
  ticket: (t) => FIXTURE.sold(t),
  received: (t) => detail(t, [row("t1", 12000, { date: "2026-11-02", installment: "1/1", method_label: "Pix", gross_cents: 12000, fee_cents: 600, net_cents: 11400 }), row("t2", 8000, { date: "2026-11-03", installment: "1/3", method_label: "Maq1 · Visa", gross_cents: 8000, fee_cents: 400, net_cents: 7600 })]),
  fees: (t) => detail(t, [row("t1", 600, { date: "2026-11-02", installment: "1/1", method_label: "Pix", gross_cents: 12000, fee_cents: 600, net_cents: 11400 }), row("t2", 400, { date: "2026-11-03", installment: "1/3", method_label: "Maq1 · Visa", gross_cents: 8000, fee_cents: 400, net_cents: 7600 })]),
  to_receive: (t) => detail(t, [row("t3", 6000, { kind: "titulo", date: "2026-11-14", method_label: "Pix", installment: "1/1" }), row("t4", 3000, { kind: "titulo", date: "2026-12-19", method_label: "Maq1 · Visa", installment: "2/3" })]),
  overdue: (t) => detail(t, [row("t5", 5000, { kind: "titulo", date: "2026-11-11", days_late: 3, method_label: "Maq1 · Visa", installment: "2/3" }), row("v9", 2000, { kind: "venda", date: "2026-10-31", days_late: 14, method_label: "Sem recebimento", installment: null })]),
  overdue_titles: (t) => detail(t, [row("t5", 5000, { kind: "titulo", date: "2026-11-11", days_late: 3, method_label: "Maq1 · Visa", installment: "2/3" })]),
  repasse: (t) => detail(t, [
    { id: "p2", value_cents: 3000, name: "Enf. Bia", source: "closing", closing_pro_id: "cp9", closing_status: "open", gross_cents: 3000 },
    { id: "p1", value_cents: 6000, name: "Dra. Ana", source: "lines", closing_pro_id: null, closing_status: null, gross_cents: 6000 },
  ]),
  pro_lines: (t) => detail(t, [row("l1", 6000, { date: "2026-11-05", line_type: "pct", role: "responsavel", service_name: "Consulta" })]),
  material: (t) => detail(t, [row("a1", 1000, { date: "2026-11-05", service_name: "Aplicação", estimated_cents: 0 }), row("a2", 500, { date: "2026-11-06", service_name: "Consulta", estimated_cents: 0 })]),
  tax: (t) => detail(t, [{ id: "u1", value_cents: 600, unit_name: "Unidade principal", base_cents: 10000, rate_pct: 6 }]),
  margin: (t) => detail(t, [
    { id: "received_cents", value_cents: 20000, label: "Recebido", metric: "received", sign: "+", amount_cents: 20000 },
    { id: "fees_cents", value_cents: -1000, label: "Taxas de pagamento", metric: "fees", sign: "−", amount_cents: 1000 },
    { id: "tax_cents", value_cents: -600, label: "Imposto", metric: "tax", sign: "−", amount_cents: 600 },
    { id: "material_cents", value_cents: -1500, label: "Custo de material", metric: "material", sign: "−", amount_cents: 1500 },
    { id: "repasse_cents", value_cents: -9000, label: "Repasses do mês", metric: "repasse", sign: "−", amount_cents: 9000 },
    { id: "products_cost_cents", value_cents: 0, label: "Custo dos produtos vendidos", metric: "products_cost", sign: "−", amount_cents: 0 },
  ]),
  appt_no_sale: (t) => detail(t, [row("n1", 0, { date: "2026-11-05", service_name: "Consulta", professionals: "Dra. Ana" }), row("n2", 0, { date: "2026-11-06", service_name: "Consulta", professionals: "Enf. Bia" })]),
  stock: (t) => detail(t, [{ id: "i1:u1", value_cents: 0, item_name: "Suplemento C", unit_name: "Unidade principal", qty_on_hand: 8, min_qty: 20, stock_unit: "un" }]),
  products_cost: (t) => detail(t, []),
  pro_appointments: (t) => detail(t, [row("a1", 15000, { date: "2026-11-05", service_name: "Consulta", role: "responsavel", material_cents: 1000 })]),
  pro_margin: (t) => detail(t, [
    { id: "revenue", value_cents: 15000, label: "Receita gerada", metric: "pro_appointments", sign: "+", amount_cents: 15000 },
    { id: "repasse", value_cents: -6000, label: "Repasse", metric: "pro_repasse", sign: "−", amount_cents: 6000 },
    { id: "material", value_cents: -1000, label: "Custo de material", metric: "pro_appointments", sign: "−", amount_cents: 1000 },
  ]),
  service_appointments: (t) => detail(t, [row("a1", 20000, { date: "2026-11-05", service_name: "Consulta", material_cents: 1500 })]),
};

/** Soma, em centavos, dos valores da coluna `header` nas linhas exibidas do diálogo aberto. */
function columnSum(dlg: HTMLElement, header: string): number {
  const table = within(dlg).getByRole("table");
  const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
  const idx = heads.findIndex((h) => h === header);
  expect(idx, `coluna «${header}» em ${heads.join(" | ")}`).toBeGreaterThanOrEqual(0);
  const body = within(table).getAllByRole("row").slice(1);
  return body.reduce((acc, r) => {
    const cell = within(r).getAllByRole("cell")[idx].textContent ?? "";
    const neg = /^-|−/.test(cell.trim());
    const n = Number(cell.replace(/[^\d,]/g, "").replace(",", ".")) * 100;
    return acc + Math.round(neg ? -n : n);
  }, 0);
}

beforeEach(() => {
  state.can = GESTOR; state.isAdmin = false; state.roles = [{ role: "gestor", allUnits: true, unitIds: [] }]; state.summary = summary(); state.summaryError = false; state.summaryArgs = []; state.detailArgs = [];
  state.detail = (t) => { const f = FIXTURE[(t as DashTarget).metric]; return f ? f(t as DashTarget) : detail(t as DashTarget, []); };
  state.more.mockReset();
});

describe("Financeiro › Painel", () => {
  it("mostra os 9 indicadores do topo com os nomes do escopo, o mês atual e as pendências", () => {
    wrap();
    const names = ["Vendido", "Recebido", "A receber", "Em atraso", "Taxas de pagamento", "Repasses do mês", "Custo de material", "Margem da clínica", "Ticket médio"];
    for (const n of names) expect(screen.getByRole("button", { name: new RegExp(`^${n}: `) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Vendido: R\$\s300,00/ })).toHaveTextContent("3 vendas");
    expect(screen.getByRole("button", { name: /^Em atraso: R\$\s70,00/ })).toHaveTextContent("1 título e 1 venda");
    expect(screen.getByRole("button", { name: /^Repasses do mês/ })).toHaveTextContent("Prévia dos lançamentos do mês");
    expect(screen.getByRole("button", { name: /^Ticket médio: R\$\s100,00/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Mês da competência")).toBeInTheDocument();
    expect(state.summaryArgs[0]).toMatchObject({ unit: null });
    expect(String((state.summaryArgs[0] as { period: string }).period)).toMatch(/^\d{4}-\d{2}$/);
    for (const p of ["Atendidos sem venda", "Atendimentos sem regra de repasse", "Títulos em atraso", "Pacotes vencendo em 30 dias", "Caixas não fechados ou com diferença", "Itens abaixo do mínimo"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${p}: `) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^Atendidos sem venda: 2/ })).toBeInTheDocument();
  });

  it("F12: cada número do topo abre uma lista cujo total e cuja soma das linhas exibidas são iguais ao número", async () => {
    const user = userEvent.setup();
    wrap();
    const cases: { card: RegExp; number: number; header: string }[] = [
      { card: /^Vendido: /, number: 30000, header: "Valor líquido" },
      { card: /^Recebido: /, number: 20000, header: "Bruto" },
      { card: /^Taxas de pagamento: /, number: 1000, header: "Taxa" },
      { card: /^A receber: /, number: 9000, header: "Valor" },
      { card: /^Em atraso: /, number: 7000, header: "Valor" },
      { card: /^Custo de material: /, number: 1500, header: "Custo de material" },
      { card: /^Repasses do mês: /, number: 9000, header: "Repasse" },
      { card: /^Margem da clínica: /, number: 7900, header: "Valor" },
    ];
    for (const c of cases) {
      await user.click(screen.getByRole("button", { name: c.card }));
      const dlg = await screen.findByRole("dialog");
      expect(within(dlg).getByTestId("dash-total")).toHaveTextContent(brl(c.number));
      expect(columnSum(dlg, c.header)).toBe(c.number);
      await user.click(closeBtn(dlg));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("ticket médio abre as vendas do cálculo e mostra total ÷ linhas", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole("button", { name: /^Ticket médio: / }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByTestId("dash-total")).toHaveTextContent(/3 linhas/);
    expect(within(dlg).getByTestId("dash-total")).toHaveTextContent(/Ticket médio: R\$\s100,00/);
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "ticket", unitId: null });
  });

  it("margem: a composição soma a margem e cada componente abre a própria lista; «Voltar» retorna", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole("button", { name: /^Margem da clínica: / }));
    let dlg = await screen.findByRole("dialog");
    expect(columnSum(dlg, "Valor")).toBe(7900);
    await user.click(within(dlg).getByRole("button", { name: "Ver a lista de Recebido" }));
    dlg = await screen.findByRole("dialog");
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "received" });
    expect(within(dlg).getByRole("heading", { name: "Recebido" })).toBeInTheDocument();
    expect(columnSum(dlg, "Bruto")).toBe(20000);
    await user.click(within(dlg).getByRole("button", { name: "Voltar" }));
    expect(await within(screen.getByRole("dialog")).findByRole("heading", { name: "Margem da clínica" })).toBeInTheDocument();
  });

  it("repasse: linha do fechamento abre o extrato; linha de lançamentos abre os lançamentos do profissional", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole("button", { name: /^Repasses do mês: / }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Ver extrato" }));
    expect(await screen.findByText("extrato cp9")).toBeInTheDocument();
    // fecha o extrato mockado e abre os lançamentos de Dra. Ana
    await user.click(within(dlg).getByRole("button", { name: "Ver lançamentos" }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "pro_lines", params: { professional: "p1" } });
  });

  it("números por profissional, serviço, forma de pagamento, agenda e evolução abrem a lista certa", async () => {
    const user = userEvent.setup();
    wrap();
    const close = async () => { await user.click(closeBtn(screen.getByRole("dialog"))); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); };

    await user.click(screen.getByRole("button", { name: nm("Ver a receita gerada por Dra. Ana: R$ 150,00") }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "pro_appointments", params: { professional: "p1" } }); await close();
    await user.click(screen.getByRole("button", { name: nm("Ver os atendimentos de Enf. Bia: 1") }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "pro_appointments", params: { professional: "p2" } }); await close();
    await user.click(screen.getByRole("button", { name: nm("Ver a margem gerada por Dra. Ana: R$ 80,00") }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "pro_margin", params: { professional: "p1" } }); await close();
    await user.click(screen.getByRole("button", { name: nm("Ver o repasse de Enf. Bia: R$ 30,00") }));
    expect(await screen.findByText("extrato cp9")).toBeInTheDocument();
  });

  it("serviço, forma de pagamento, agenda e evolução", async () => {
    const user = userEvent.setup();
    wrap();
    const close = async () => { await user.click(closeBtn(screen.getByRole("dialog"))); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); };
    await user.click(screen.getByRole("button", { name: nm("Ver a receita de Consulta: R$ 200,00") }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "service_appointments", params: { service: "sv1" } });
    expect(columnSum(await screen.findByRole("dialog"), "Receita")).toBe(20000); await close();
    await user.click(screen.getByRole("button", { name: nm("Ver os títulos recebidos em Maq1 · Visa: R$ 80,00") }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "received", params: { method: "machine:x:visa" } }); await close();
    await user.click(screen.getByRole("button", { name: /^Ver os títulos de 14\/11 a 20\/11: R\$\s60,00/ }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "to_receive", params: { from: "2026-11-14", to: "2026-11-20" } }); await close();
    const evoTable = screen.getByRole("table", { name: "Evolução mensal" });
    await user.click(within(evoTable).getAllByRole("button", { name: /^Ver as vendas de / })[0]);
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "sold", period: "2026-11" }); await close();
    expect(screen.getByRole("img", { name: /Evolução dos últimos 12 meses/ })).toBeInTheDocument();
    expect(within(evoTable).getAllByRole("row")).toHaveLength(13);
  });

  it("pendências: abre a fila, mostra a contagem e leva à tela onde se resolve", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole("button", { name: /^Atendidos sem venda: 2/ }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByTestId("dash-total")).toHaveTextContent("2 linhas");
    expect(within(dlg).getByRole("link", { name: "Ir para Atendimentos" })).toHaveAttribute("href", "/financeiro/atendimentos?semVenda=1");
    await user.click(closeBtn(dlg));
    await user.click(screen.getByRole("button", { name: /^Itens abaixo do mínimo: 1/ }));
    const d2 = await screen.findByRole("dialog");
    expect(within(d2).getByText("Suplemento C")).toBeInTheDocument();
    expect(within(d2).getByText(/8 un/)).toBeInTheDocument();
    expect(within(d2).getByText(/20 un/)).toBeInTheDocument();
    expect(within(d2).queryByText(/Total:/)).toBeNull(); // fila sem valor: só conta linhas
  });

  it("trocar o mês ou a unidade pede de novo ao servidor; gestor restrito só vê as unidades dele", async () => {
    const user = userEvent.setup();
    state.roles = [{ role: "gestor", allUnits: false, unitIds: ["u1"] }];
    wrap();
    const unit = screen.getByLabelText("Unidade") as HTMLSelectElement;
    expect([...unit.options].map((o) => o.textContent)).toEqual(["Todas as minhas unidades", "Unidade principal"]);
    await user.selectOptions(unit, "u1");
    expect(state.summaryArgs.at(-1)).toMatchObject({ unit: "u1" });
    await user.selectOptions(screen.getByLabelText("Mês da competência"), "3");
    expect((state.summaryArgs.at(-1) as { period: string }).period).toMatch(/-03$/);
    await user.click(screen.getByRole("button", { name: /^Vendido: / }));
    expect(state.detailArgs.at(-1)).toMatchObject({ metric: "sold", unitId: "u1" });
  });

  it("Admin vê todas as unidades; sem acesso (Recepção, profissional) mostra o aviso e não chama o servidor", () => {
    state.isAdmin = true; state.roles = [];
    const a = wrap();
    expect(within(screen.getByLabelText("Unidade")).getAllByRole("option")).toHaveLength(3);
    a.unmount();
    state.isAdmin = false; state.can = { sales_read: true, cash_read: true, own_sales_read: true };
    state.summaryArgs = [];
    wrap();
    expect(screen.getByRole("note")).toHaveTextContent(/administrador, do gestor e do financeiro/);
    expect(screen.queryByRole("button", { name: /^Vendido: / })).toBeNull();
  });

  it("zero e valores negativos: sem «-R$ 0,00»; margem negativa aparece com sinal e em destaque", () => {
    const s = summary(); s.cards.fees_cents = -0; s.cards.margin_cents = -12000; s.cards.ticket_cents = null;
    state.summary = s;
    wrap();
    expect(screen.getByRole("button", { name: /^Taxas de pagamento: R\$\s0,00/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Margem da clínica: -R\$\s120,00/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ticket médio: —/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/-R\$\s0,00/);
  });

  it("origem do repasse: com fechamento mostra o status; com unidade escolhida, que são os lançamentos", () => {
    state.summary = summary({ closing_status: "conferencia" });
    const a = wrap();
    expect(screen.getByRole("button", { name: /^Repasses do mês/ })).toHaveTextContent("Fechamento: Em conferência");
    a.unmount();
    state.summary = summary({ all_units: false });
    wrap();
    expect(screen.getByRole("button", { name: /^Repasses do mês/ })).toHaveTextContent("Lançamentos da unidade");
  });

  it("lista longa: mostra quantas linhas há, mantém o total do número inteiro e «Carregar mais» pede a próxima página", async () => {
    const user = userEvent.setup();
    state.detail = (t) => detail(t as DashTarget, [row("v1", 10000, { at: "2026-11-02T13:00:00Z", status: "paid" }), row("v2", 10000, { at: "2026-11-03T13:00:00Z", status: "paid" })], { count: 3, total_cents: 30000, truncated: true });
    state.more.mockResolvedValue(detail({ metric: "sold", period: "2026-11", unitId: null, title: "Vendido" }, [row("v3", 10000, { at: "2026-11-04T13:00:00Z", status: "paid" })], { count: 3, total_cents: 30000, offset: 2, truncated: false }));
    wrap();
    await user.click(screen.getByRole("button", { name: /^Vendido: / }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/Mostrando 2 de 3 linhas/)).toBeInTheDocument();
    expect(within(dlg).getByTestId("dash-total")).toHaveTextContent(brl(30000));
    await user.click(within(dlg).getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(within(dlg).queryByText(/Mostrando/)).toBeNull());
    expect(state.more).toHaveBeenCalledWith("c1", "sold", expect.stringMatching(/^\d{4}-\d{2}$/), null, {}, 2);
    expect(columnSum(dlg, "Valor líquido")).toBe(30000);
  });

  it("erro do servidor mostra a mensagem e o botão de tentar de novo", () => {
    state.summaryError = true;
    wrap();
    expect(screen.getByRole("alert")).toHaveTextContent(/permissão/);
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("no celular as listas e tabelas viram cartões (sem tabela, sem rolagem lateral)", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    try {
      const user = userEvent.setup();
      wrap();
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("list", { name: "Por profissional" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Agenda de recebimentos" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^Vendido: / }));
      const dlg = await screen.findByRole("dialog");
      expect(within(dlg).queryByRole("table")).toBeNull();
      expect(within(dlg).getByRole("list", { name: "Vendido" })).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });

  it("os cartões de indicadores quebram em grade (1, 2 e 3 colunas) e nada força largura fixa", () => {
    wrap();
    const grid = screen.getByLabelText("Indicadores do mês");
    expect(grid.className).toMatch(/grid-cols-1/); expect(grid.className).toMatch(/min-\[480px\]:grid-cols-2/); expect(grid.className).toMatch(/lg:grid-cols-3/);
    expect(grid.className).not.toMatch(/w-\[|min-w-\[/);
  });
});
