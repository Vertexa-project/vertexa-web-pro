import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { PayoutLayout } from "./PayoutLayout";
import { PayoutLinesTab } from "./PayoutLinesTab";
import { PayoutRulesTab } from "./PayoutRulesTab";
import { PayoutSimulatorTab } from "./PayoutSimulatorTab";
import type { PayoutContext, PayoutLineRow, PayoutMonth, PayoutRuleRow, UnruledRow } from "@/lib/api/finPayout";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false, ctx: null as unknown, rules: [] as unknown[], lines: [] as unknown[], month: null as unknown, all: null as unknown, unruled: [] as unknown[], meds: [] as unknown[],
  saveMutate: vi.fn(), recalcMutate: vi.fn(), activeMutate: vi.fn(), linesArgs: [] as unknown[], monthArgs: [] as unknown[],
}));

vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }) }));
vi.mock("@/hooks/useFinPayout", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() });
  const m = (mutate: unknown) => ({ mutate, isPending: false });
  return {
    usePayoutContext: () => q(state.ctx), usePayoutRules: () => q(state.rules), usePayoutLines: (_c: unknown, f: unknown) => { state.linesArgs.push(f); return q(state.lines); },
    usePayoutMonth: (_c: unknown, p: unknown, period: unknown, enabled: unknown) => { state.monthArgs.push({ p, period, enabled }); return q(state.month); },
    usePayoutMonthAll: () => q(state.all), useUnruled: () => q(state.unruled), useMedCommissions: () => q(state.meds),
    useSavePayoutRule: () => m(state.saveMutate), useRecalcPayout: () => m(state.recalcMutate), useSetPayoutRuleActive: () => m(state.activeMutate),
  };
});

const wrap = (ui: React.ReactElement, path = "/financeiro/repasse") => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
const GESTOR = { share_rules_read: true, share_rules_write: true, share_lines_read: true, share_recalc_read: true, share_recalc_write: true };
const FIN = { share_rules_read: true, share_lines_read: true, share_recalc_read: true, share_recalc_write: true };
const PRO = { own_share: true };

const ctx = (over: Partial<PayoutContext> = {}): PayoutContext => ({
  can_write: true, is_owner: false, professionals: [{ id: "p1", name: "Dra. A" }, { id: "p2", name: "Enf. Camila" }],
  services: [{ id: "s1", name: "Consulta", category: "consulta" }, { id: "s2", name: "Aplicação", category: "aplicacao" }],
  items: [{ id: "i1", name: "Manipulado X", item_type: "compounded" }, { id: "i2", name: "Suplemento", item_type: "resale" }], units: [{ id: "u1", name: "Unidade principal" }],
  settings: { deduct_fee: true, deduct_tax: false, deduct_material: false, tier_base: "organization" }, tax_pct: 6, ...over,
});
const line = (over: Partial<PayoutLineRow> = {}): PayoutLineRow => ({
  id: "l1", professional_id: "p1", professional_name: "Dra. A", period: "2026-11", line_type: "pct", role: "responsavel", kind: "original", base_cents: 45500, gross_cents: 50000, pct: 60, amount_cents: 27300,
  source_date: "2026-11-09", origin_period: "2026-11", reason: null, created_at: "2026-11-09T10:00:00Z", appointment_id: "a1", unit_name: "Unidade principal", service_name: "Consulta", patient: "P. U.",
  memory: { origin: "avulso", gross_cents: 50000, fee_cents: 1500, tax_cents: 3000, tax_pct: 6, material_cents: 0, deductions: { fee: true, tax: true, material: false }, rule: { type: "pct", pct: 60, valid_from: "2026-01-01" }, formula: "base = 50000 − taxa 1500 − imposto 3000 − material 0 = 45500; repasse = base × 60%" }, ...over,
});
const month = (over: Partial<PayoutMonth> = {}): PayoutMonth => ({
  period: "2026-11", professional_id: "p1", locked: false, derived: [], persisted: { pct: 27300, fixed_exec: 0, commission: 0, adjustment: 0, liquidated_cents: 50000 }, tier_adjust_cents: 0, fixed_monthly_cents: 0,
  guarantee_cents: 0, usage_fee_cents: 0, carry_in_cents: 0, gross_total_cents: 27300, withholdings: [], withholding_total_cents: 0, net_total_cents: 27300, negative: false, ...over,
});
const rule = (over: Partial<PayoutRuleRow> = {}): PayoutRuleRow => ({
  id: "r1", professional_id: "p1", professional_name: "Dra. A", role: "responsavel", target_type: "default", service_id: null, service_name: null, category: null, stock_item_id: null, item_name: null, item_type: null,
  rule_type: "pct", pct: 60, amount_cents: null, tiers: null, tier_scope: null, compensation: false, usage_fee_mode: null, commission_base: "net_fee", deductions_override: { tax: true }, all_units: true, unit_ids: [],
  valid_from: "2026-01-01", valid_to: null, is_active: true, notes: null, created_at: "2026-01-01T00:00:00Z", in_use: false, ...over,
});

beforeEach(() => {
  state.can = GESTOR; state.isAdmin = false; state.ctx = ctx(); state.rules = []; state.lines = []; state.month = null; state.all = null; state.unruled = []; state.meds = []; state.linesArgs = []; state.monthArgs = [];
  [state.saveMutate, state.recalcMutate, state.activeMutate].forEach((f) => f.mockReset());
});

describe("Financeiro › Repasse › Lançamentos", () => {
  it("profissional vê só o próprio repasse, sem seletor de profissional, e abre «Como foi calculado» com a memória da linha", async () => {
    state.can = PRO; state.lines = [line()]; state.month = month();
    wrap(<PayoutLinesTab />);
    expect(screen.getByRole("note")).toHaveTextContent(/só o seu repasse/);
    expect(screen.queryByLabelText("Profissional")).toBeNull();
    expect(screen.queryByRole("button", { name: /Recalcular/ })).toBeNull();
    const table = screen.getByRole("table", { name: "Lançamentos de repasse" });
    expect(within(table).getByText("Consulta")).toBeInTheDocument();
    expect(within(table).getByText(/R\$\s*273,00/)).toBeInTheDocument();
    expect(within(table).getByText("P. U.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Ver como foi calculado/ }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/Percentual sobre a base — 60%/)).toBeInTheDocument();
    expect(within(dlg).getByText(/base = R\$\s500,00 − taxa R\$\s15,00/)).toBeInTheDocument();
    expect(within(dlg).getByText("Imposto (6%)")).toBeInTheDocument();
  });

  it("o profissional pede o próprio mês sem informar profissional (o servidor decide quem é)", () => {
    state.can = PRO; state.lines = [line()]; state.month = month();
    wrap(<PayoutLinesTab />);
    expect(state.monthArgs.at(-1)).toMatchObject({ p: null, enabled: true });
    expect(state.linesArgs.at(-1)).toMatchObject({ professionalId: null });
  });

  it("gestor: totais por profissional (prévia), alerta de «sem regra» com atalho, saldo negativo e Recalcular", async () => {
    state.all = { period: "2026-11", locked: false, unruled_count: 2, professionals: [
      { professional_id: "p1", name: "Dra. A", gross_total_cents: 27300, withholding_total_cents: 0, net_total_cents: 27300, negative: false, carry_in_cents: 0 },
      { professional_id: "p2", name: "Enf. Camila", gross_total_cents: -5000, withholding_total_cents: 0, net_total_cents: 0, negative: true, carry_in_cents: 0 }] };
    wrap(<PayoutLinesTab />);
    expect(screen.getByRole("alert")).toHaveTextContent(/2 participante\(s\).*sem regra de repasse/);
    expect(screen.getByRole("link", { name: /Criar a regra/ })).toHaveAttribute("href", "/financeiro/repasse/regras");
    const table = screen.getByRole("table", { name: "Repasse do mês por profissional" });
    expect(within(table).getByText("Saldo negativo")).toBeInTheDocument();
    expect(within(table).getAllByText(/R\$\s*273,00/)).toHaveLength(2);   // bruto e líquido
    expect(screen.getByText(/Escolha um profissional para ver os lançamentos/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Recalcular repasse/ }));
    expect(state.recalcMutate).toHaveBeenCalledTimes(1);
  });

  it("gestor escolhe o profissional → carrega lançamentos e a prévia do mês com retenções", async () => {
    state.all = { period: "2026-11", locked: false, unruled_count: 0, professionals: [{ professional_id: "p1", name: "Dra. A", gross_total_cents: 1000000, withholding_total_cents: 61500, net_total_cents: 938500, negative: false, carry_in_cents: 0 }] };
    state.lines = [line()];
    state.month = month({ gross_total_cents: 1000000, net_total_cents: 938500, withholding_total_cents: 61500, withholdings: [{ rule_type: "irrf", label: null, rate_pct: 1.5, amount_cents: 15000, waived: null }, { rule_type: "pis_cofins_csll", label: null, rate_pct: 4.65, amount_cents: 46500, waived: "simples" }],
      derived: [{ line_type: "fixed_monthly", amount_cents: 125000, memory: {} }] });
    wrap(<PayoutLinesTab />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Profissional"), "p1");
    expect(state.monthArgs.at(-1)).toMatchObject({ p: "p1", enabled: true });
    expect(screen.getAllByText("Líquido a pagar").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/R\$\s*9\.385,00/).length).toBeGreaterThan(0);
    expect(screen.getByText("Fixo mensal")).toBeInTheDocument();
    expect(screen.getByText("dispensada")).toBeInTheDocument();
    expect(screen.getByText(/−R\$\s*150,00/)).toBeInTheDocument();
  });

  it("estorno aparece como «Estorno / ajuste» com o valor negativo", () => {
    state.can = PRO; state.month = month();
    state.lines = [line({ id: "l2", kind: "correction", line_type: "adjustment", amount_cents: -27300, base_cents: -45500, period: "2026-12" })];
    wrap(<PayoutLinesTab />);
    expect(screen.getByText("Estorno / ajuste")).toBeInTheDocument();
    expect(screen.getByText(/-R\$\s*273,00/)).toBeInTheDocument();
  });

  it("estado vazio explica quando o repasse entra", () => {
    state.can = PRO; state.month = month({ gross_total_cents: 0, net_total_cents: 0 });
    wrap(<PayoutLinesTab />);
    expect(screen.getByText("Nenhum lançamento neste mês")).toBeInTheDocument();
  });

  it("sem papel de repasse (Recepção): só o aviso de acesso", () => {
    state.can = { sales_read: true, sales_write: true };
    wrap(<PayoutLayout />);
    expect(screen.getByRole("note")).toHaveTextContent(/Você não tem acesso/);
  });
});

describe("Financeiro › Repasse › Regras", () => {
  it("Gestor: lista as regras com valor/vigência, vê «Nova regra», Editar e Encerrar", () => {
    state.rules = [rule(), rule({ id: "r2", rule_type: "pct", pct: null, tiers: [{ up_to_cents: 2000000, pct: 50 }, { up_to_cents: null, pct: 60 }], professional_name: "Dr. G" })];
    wrap(<PayoutRulesTab />);
    const table = screen.getByRole("table", { name: "Regras de repasse" });
    expect(within(table).getByText("60%")).toBeInTheDocument();
    expect(within(table).getByText(/50% até R\$\s*20\.000,00 · 60% acima/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova regra" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Encerrar regra/ })).toHaveLength(2);
  });

  it("Financeiro só consulta: sem Nova regra, sem Encerrar; botão vira «Ver»", () => {
    state.can = FIN; state.rules = [rule()];
    wrap(<PayoutRulesTab />);
    expect(screen.getByRole("note")).toHaveTextContent(/Quem configura é o gestor/);
    expect(screen.queryByRole("button", { name: /Nova regra/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Encerrar/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Ver regra de Dra\. A/ })).toBeInTheDocument();
  });

  it("fila «sem regra»: aviso e «Criar regra» abre o formulário já com o profissional e o papel", async () => {
    state.unruled = [{ appointment_id: "a9", performed_on: "2026-11-10", service_name: "Aplicação", professional_id: "p2", professional_name: "Enf. Camila", role: "executor", unit_name: "Unidade principal" } satisfies UnruledRow];
    wrap(<PayoutRulesTab />);
    expect(screen.getByRole("alert")).toHaveTextContent(/1 participante\(s\) sem regra de repasse/);
    await userEvent.setup().click(screen.getByRole("button", { name: "Criar regra para Enf. Camila" }));
    const dlg = screen.getByRole("dialog", { name: "Nova regra de repasse" });
    expect(within(dlg).getByLabelText("Profissional")).toHaveValue("p2");
    expect(within(dlg).getByLabelText("Papel no atendimento")).toHaveValue("executor");
  });

  it("salva percentual 60% com início da vigência e chama o servidor com os dados certos", async () => {
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    const dlg = screen.getByRole("dialog", { name: "Nova regra de repasse" });
    await user.selectOptions(within(dlg).getByLabelText("Profissional"), "p1");
    await user.type(within(dlg).getByLabelText("Percentual (%)"), "60");
    await user.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(state.saveMutate).toHaveBeenCalledTimes(1);
    expect(state.saveMutate.mock.calls[0][0]).toMatchObject({ id: null, professionalId: "p1", ruleType: "pct", role: "responsavel", targetType: "default", pct: 60, tiers: null, allUnits: true });
  });

  it("valida antes de enviar: profissional e percentual são obrigatórios", async () => {
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Salvar" }));
    expect(screen.getByText("Escolha o profissional.")).toBeInTheDocument();
    expect(screen.getByText(/percentual entre 0 e 100/)).toBeInTheDocument();
    expect(state.saveMutate).not.toHaveBeenCalled();
  });

  it("faixas por meta: tetos fora de ordem são barrados no formulário", async () => {
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    const dlg = screen.getByRole("dialog");
    await user.selectOptions(within(dlg).getByLabelText("Profissional"), "p1");
    await user.click(within(dlg).getByLabelText(/Usar faixas por meta/));
    await user.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(screen.getByText(/tetos das faixas precisam crescer/)).toBeInTheDocument();
    expect(state.saveMutate).not.toHaveBeenCalled();
  });

  it("faixas por meta no celular: a última faixa mostra «Acima da faixa anterior» inteira (texto que quebra, não um campo que corta)", async () => {
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    const dlg = screen.getByRole("dialog");
    await user.click(within(dlg).getByLabelText(/Usar faixas por meta/));
    const tail = within(dlg).getByText("Acima da faixa anterior");
    expect(tail.tagName).toBe("DIV");
    expect(tail).not.toHaveAttribute("readonly");
    expect(tail.className).toMatch(/break-words/);
    expect(tail.className).not.toMatch(/truncate|overflow-hidden|whitespace-nowrap/);
    expect(within(dlg).queryByDisplayValue("Acima da faixa anterior")).toBeNull();
  });

  it("F17: comissão sobre manipulado mostra o alerta do art. 69 e só salva com o aceite do Owner", async () => {
    state.ctx = ctx({ is_owner: true });
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    const dlg = screen.getByRole("dialog");
    await user.selectOptions(within(dlg).getByLabelText("Profissional"), "p1");
    await user.selectOptions(within(dlg).getByLabelText("Tipo de remuneração"), "product_commission");
    await user.selectOptions(within(dlg).getByLabelText("Vale para"), "item");
    await user.selectOptions(within(dlg).getByLabelText("Item"), "i1");
    await user.type(within(dlg).getByLabelText("Percentual (%)"), "10");
    expect(within(dlg).getByText(/art\. 69/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(screen.getByText(/Marque o aceite/)).toBeInTheDocument();
    expect(state.saveMutate).not.toHaveBeenCalled();
    await user.click(within(dlg).getByLabelText(/Estou ciente e aceito/));
    await user.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(state.saveMutate.mock.calls[0][0]).toMatchObject({ ruleType: "product_commission", role: "vendedor", targetType: "item", stockItemId: "i1", pct: 10, acceptMedication: true });
  });

  it("quem não é o Owner não consegue dar o aceite (campo desabilitado)", async () => {
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    const dlg = screen.getByRole("dialog");
    await user.selectOptions(within(dlg).getByLabelText("Tipo de remuneração"), "product_commission");
    await user.selectOptions(within(dlg).getByLabelText("Vale para"), "item");
    await user.selectOptions(within(dlg).getByLabelText("Item"), "i1");
    expect(within(dlg).getByLabelText(/Estou ciente e aceito/)).toBeDisabled();
    expect(within(dlg).getByText(/Só o administrador da clínica/)).toBeInTheDocument();
  });

  it("regra que já gerou repasse: valor e papel travados; só o fim da vigência muda (e pede motivo)", async () => {
    state.rules = [rule({ in_use: true })];
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getByRole("button", { name: /Editar regra de Dra\. A/ }));
    const dlg = screen.getByRole("dialog", { name: "Editar regra de repasse" });
    expect(within(dlg).getByLabelText("Percentual (%)")).toBeDisabled();
    expect(within(dlg).getByLabelText("Profissional")).toBeDisabled();
    expect(within(dlg).getByLabelText("Fim da vigência (opcional)")).toBeEnabled();
    expect(within(dlg).getByText(/Esta regra já gerou repasse/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(screen.getByText("Informe o motivo da alteração.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desativar regra/ })).toBeNull();
  });

  it("mostra a mensagem em português quando o servidor recusa a sobreposição", async () => {
    state.saveMutate.mockImplementation((_v, opts) => opts.onError({ message: "RULE_OVERLAP" }));
    const user = userEvent.setup();
    wrap(<PayoutRulesTab />);
    await user.click(screen.getAllByRole("button", { name: "Nova regra" })[0]);
    const dlg = screen.getByRole("dialog");
    await user.selectOptions(within(dlg).getByLabelText("Profissional"), "p1");
    await user.type(within(dlg).getByLabelText("Percentual (%)"), "60");
    await user.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Já existe regra para esta pessoa, papel e serviço/)).toBeInTheDocument();
  });

  it("no celular a lista de regras vira cartões", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    try {
      state.rules = [rule()];
      wrap(<PayoutRulesTab />);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("list", { name: "Regras de repasse" })).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });
});

describe("Financeiro › Repasse › Simulador", () => {
  it("Exemplo A pelo simulador: 500 − 15 de taxa − 30 de imposto = base 455,00 → R$ 273,00 (60%)", async () => {
    state.rules = [rule({ deductions_override: { tax: true } })];
    const user = userEvent.setup();
    wrap(<PayoutSimulatorTab />);
    expect(screen.getByText(/Escolha o serviço, informe o valor/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Serviço"), "s1");
    await user.type(screen.getByLabelText("Valor liquidado (R$)"), "500");
    await user.type(screen.getByLabelText("Taxa do meio de pagamento (R$)"), "15");
    await user.selectOptions(screen.getByLabelText("Responsável"), "p1");
    const table = screen.getByRole("table", { name: "Resultado da simulação" });
    expect(within(table).getByText("Dra. A")).toBeInTheDocument();
    expect(within(table).getAllByText(/R\$\s*455,00/).length).toBeGreaterThanOrEqual(1);
    expect(within(table).getByText(/base = R\$\s500,00 − taxa R\$\s15,00 − imposto R\$\s30,00/)).toBeInTheDocument();
    expect(within(table).getAllByText(/R\$\s*273,00/).length).toBeGreaterThan(0);
    expect(screen.getByText("Margem da clínica").nextSibling).toHaveTextContent(/R\$\s*182,00/);   // 500 − 15 − 30 − 273
  });

  it("participante sem regra: avisa que entraria na fila «sem regra»", async () => {
    state.rules = [];
    const user = userEvent.setup();
    wrap(<PayoutSimulatorTab />);
    await user.selectOptions(screen.getByLabelText("Serviço"), "s1");
    await user.type(screen.getByLabelText("Valor liquidado (R$)"), "500");
    await user.selectOptions(screen.getByLabelText("Responsável"), "p2");
    expect(screen.getByRole("alert")).toHaveTextContent(/Sem regra para Enf\. Camila \(responsável\).*fila «sem regra»/);
  });

  it("Recepção/profissional não entram no simulador", () => {
    state.can = PRO;
    wrap(<PayoutSimulatorTab />);
    expect(screen.getByRole("note")).toHaveTextContent(/Você não tem acesso/);
  });
});
