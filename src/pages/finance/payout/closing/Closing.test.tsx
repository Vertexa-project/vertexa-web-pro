import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { ClosingTab } from "./ClosingTab";
import { MyStatementTab } from "./MyStatementTab";
import { PayoutLayout } from "@/pages/finance/payout/PayoutLayout";
import type { ClosingView, MyStatementRow, StatementView } from "@/lib/api/finClosing";
import type { ClosingRow } from "@/lib/domain/finClosing";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false, closing: null as unknown, statement: null as unknown, mine: [] as unknown[], closingArgs: [] as unknown[],
  start: vi.fn(), refresh: vi.fn(), notify: vi.fn(), approve: vi.fn(), lock: vi.fn(), unlock: vi.fn(), accept: vi.fn(), contest: vi.fn(), answer: vi.fn(), adjust: vi.fn(), invoice: vi.fn(), pay: vi.fn(),
  paymentFile: vi.fn(),
}));

vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }) }));
vi.mock("@/hooks/useFinPayout", () => ({ usePayoutContext: () => ({ data: { units: [{ id: "u1", name: "Unidade principal" }], professionals: [] } }) }));
vi.mock("@/lib/api/finClosing", async (orig) => ({ ...(await orig<typeof import("@/lib/api/finClosing")>()), getPaymentFile: (id: string) => state.paymentFile(id), closingFileUrl: vi.fn() }));
vi.mock("@/hooks/useFinClosing", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const m = (mutate: unknown) => ({ mutate, mutateAsync: mutate, isPending: false });
  return {
    useClosing: (_c: unknown, period: string, unit: unknown) => { state.closingArgs.push({ period, unit }); return q(state.closing); },
    useStatement: () => q(state.statement), useMyStatements: () => q(state.mine),
    useStartClosing: () => m(state.start), useRefreshClosing: () => m(state.refresh), useNotifyClosing: () => m(state.notify), useApproveClosing: () => m(state.approve), useLockClosing: () => m(state.lock),
    useUnlockClosing: () => m(state.unlock), useAcceptStatement: () => m(state.accept), useContestStatement: () => m(state.contest), useAnswerDispute: () => m(state.answer), useAdjustStatement: () => m(state.adjust),
    useSaveInvoice: () => m(state.invoice), usePayStatement: () => m(state.pay),
  };
});

const wrap = (ui: React.ReactElement, path = "/financeiro/repasse/fechamento") => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
const GESTOR = { share_lines_read: true, close_prepare_write: true, close_decide_write: true, close_pay_write: true };
const FIN = { share_lines_read: true, close_prepare_write: true, close_pay_write: true };
const PRO = { own_share: true };

const row = (over: Partial<ClosingRow> = {}): ClosingRow => ({
  id: "cp1", professional_id: "p1", name: "Dra. A", bond_type: "pj", appointments: 2, pct_cents: 660000, fixed_exec_cents: 0, fixed_monthly_cents: 100000, guarantee_cents: 0, commission_cents: 0, usage_fee_cents: 0, adjustment_cents: 0,
  gross_cents: 760000, withholding_cents: 46740, net_cents: 713260,
  withholdings: [{ rule_type: "irrf", label: null, rate_pct: 1.5, amount_cents: 11400, waived: null }, { rule_type: "pis_cofins_csll", label: null, rate_pct: 4.65, amount_cents: 35340, waived: null }],
  negative: false, status: "open", acceptance: "accepted", accept_deadline: "2026-11-18", deadline_passed: false, notified_at: "2026-11-13T12:00:00Z", stmt_version: 1, requires_invoice: true, nf_status: "pending",
  invoice_number: null, invoice_date: null, invoice_path: null, paid_on: null, pay_method: null, pay_note: null, proof_path: null, payment_status: "pending", open_disputes: 0, answered_disputes: 0, ...over,
});
const totals = { appointments: 3, pct_cents: 760000, fixed_exec_cents: 0, fixed_monthly_cents: 100000, guarantee_cents: 0, commission_cents: 0, usage_fee_cents: -10000, adjustment_cents: 0, gross_cents: 850000, withholding_cents: 46740, net_cents: 803260 };
const view = (over: Partial<ClosingView> = {}): ClosingView => ({
  period: "2026-10", period_ended: true,
  closing: { id: "k1", status: "conferencia", accept_days: 5, started_at: "2026-11-01T12:00:00Z", approved_at: null, locked_at: null, lock_no: 0, unlocked_at: null, unlock_reason: null },
  rows: [row(), row({ id: "cp2", professional_id: "p2", name: "Enf. B", acceptance: "pending", requires_invoice: false, nf_status: "not_required", pct_cents: 100000, fixed_monthly_cents: 0, usage_fee_cents: -10000, gross_cents: 90000, withholding_cents: 0, net_cents: 90000, withholdings: [] })],
  totals, pendencies: { unruled: [], unruled_count: 0, appointments_without_sale: 0, overdue_receivables: 0, negative_count: 0 }, can: { prepare: true, decide: true, pay: true, unlock: false }, ...over,
});
const stmt = (over: Partial<StatementView> = {}): StatementView => ({
  closing: { id: "k1", period: "2026-10", status: "conferencia", locked: false }, row: row(), professional: { id: "p1", name: "Dra. A", bond_type: "pj", simples_optant: false },
  derived: [{ line_type: "fixed_monthly", amount_cents: 100000, memory: {} }], withholdings: row().withholdings,
  lines: [{ id: "l1", period: "2026-10", line_type: "pct", role: "responsavel", kind: "original", base_cents: 1000000, gross_cents: 1000000, pct: 60, amount_cents: 600000, source_date: "2026-10-05", origin_period: "2026-10", reason: null,
    created_at: "2026-10-05T12:00:00Z", appointment_id: "a1", unit_name: "Unidade principal", service_name: "Consulta", patient: "P. U.", memory: { origin: "avulso", formula: "base = 1000000" } }],
  disputes: [], check: { items_total_cents: 700000, gross_cents: 760000, matches: true }, is_self: false, can: { decide: true, pay: true, prepare: true }, ...over,
});

beforeEach(() => {
  state.can = GESTOR; state.isAdmin = false; state.closing = view(); state.statement = stmt(); state.mine = []; state.closingArgs = [];
  [state.start, state.refresh, state.notify, state.approve, state.lock, state.unlock, state.accept, state.contest, state.answer, state.adjust, state.invoice, state.pay, state.paymentFile].forEach((f) => f.mockReset());
});

describe("Financeiro › Repasse › Fechamento (tabela do gestor)", () => {
  it("abre no mês anterior e mostra uma linha por profissional com bruto, retenções e líquido; total geral no fim", () => {
    wrap(<ClosingTab />);
    expect(state.closingArgs.at(-1)).toMatchObject({ unit: null });
    expect(state.closingArgs.at(-1)).toHaveProperty("period");
    const table = screen.getByRole("table", { name: "Fechamento do mês por profissional" });
    expect(within(table).getByText("Dra. A")).toBeInTheDocument();
    expect(within(table).getByText(/R\$\s*7\.600,00/)).toBeInTheDocument();
    expect(within(table).getByText(/−R\$\s*467,40/)).toBeInTheDocument();
    expect(within(table).getByText(/R\$\s*7\.132,60/)).toBeInTheDocument();
    expect(within(table).getByText("Aceito")).toBeInTheDocument();
    expect(within(table).getByText(/Pendente · até 18\/11\/2026/)).toBeInTheDocument();
    const total = screen.getByLabelText("Total geral");
    expect(within(total).getByText(/R\$\s*8\.500,00/)).toBeInTheDocument();
    expect(within(total).getByText(/R\$\s*8\.032,60/)).toBeInTheDocument();
    expect(screen.getByText("Em conferência")).toBeInTheDocument();
  });

  it("F2: produção «sem regra» é um alerta que bloqueia a aprovação, com atalho para criar a regra", () => {
    state.can = { ...GESTOR, share_rules_read: true };
    state.closing = view({ pendencies: { unruled: [{ appointment_id: "a9", performed_on: "2026-10-15", service_name: "Consulta", professional_id: "p3", professional_name: "Prof pc", role: "responsavel" }], unruled_count: 1, appointments_without_sale: 2, overdue_receivables: 1, negative_count: 1 } });
    wrap(<ClosingTab />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Bloqueia a aprovação.*1 participante\(s\).*sem regra/);
    expect(screen.getByRole("link", { name: /Criar a regra/ })).toHaveAttribute("href", "/financeiro/repasse/regras");
    expect(screen.getByText(/Prof pc · Consulta · 15\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/2 atendimento\(s\) realizado\(s\) no mês sem venda/)).toBeInTheDocument();
    expect(screen.getByText(/1 título\(s\).*ainda não liquidado/)).toBeInTheDocument();
    expect(screen.getByText(/1 profissional\(is\) com total do mês negativo/)).toBeInTheDocument();
  });

  it("aprova os selecionados e conta o que ficou de fora (aceite pendente dentro do prazo)", async () => {
    const user = userEvent.setup();
    state.approve.mockImplementation((_v: unknown, o: { onSuccess: (r: unknown) => void }) => o.onSuccess({ approved: 1, skipped: [{ closing_pro_id: "cp2", professional_id: "p2", name: "Enf. B", reason: "ACCEPTANCE_PENDING" }] }));
    wrap(<ClosingTab />);
    expect(screen.getByRole("button", { name: /Aprovar selecionados \(0\)/ })).toBeDisabled();
    await user.click(screen.getByLabelText("Selecionar Dra. A"));
    await user.click(screen.getByLabelText("Selecionar Enf. B"));
    await user.click(screen.getByRole("button", { name: /Aprovar selecionados \(2\)/ }));
    expect(state.approve).toHaveBeenCalledWith({ closingId: "k1", professionalIds: ["p1", "p2"] }, expect.anything());
    expect(screen.getByRole("status")).toHaveTextContent(/1 aprovado\(s\).*Enf\. B: ainda no prazo de aceite/);
  });

  it("«Aprovar todos prontos» manda só quem aceitou ou tem prazo vencido (F8)", async () => {
    state.closing = view({ rows: [row(), row({ id: "cp2", professional_id: "p2", name: "Enf. B", acceptance: "pending", deadline_passed: true }), row({ id: "cp3", professional_id: "p3", name: "Dr. C", acceptance: "contested", open_disputes: 1 })] });
    wrap(<ClosingTab />);
    expect(screen.getByRole("button", { name: /Aprovar todos prontos \(2\)/ })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole("button", { name: /Aprovar todos prontos \(2\)/ }));
    expect(state.approve).toHaveBeenCalledWith({ closingId: "k1", professionalIds: ["p1", "p2"] }, expect.anything());
    expect(screen.getByText(/1 contest\./)).toBeInTheDocument();
  });

  it("sem fechamento: botão «Iniciar fechamento» (só no mês encerrado) e mensagem com o número de extratos", async () => {
    state.closing = view({ closing: null, rows: [] });
    state.start.mockImplementation((_p: string, o: { onSuccess: (r: unknown) => void }) => o.onSuccess({ id: "k1", created: true, professionals: 4 }));
    wrap(<ClosingTab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Iniciar fechamento" }));
    expect(state.start).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), expect.anything());
    expect(screen.getByRole("status")).toHaveTextContent("Fechamento iniciado com 4 extrato(s).");
  });

  it("mês corrente (ainda não encerrado): explica que começa no dia 1 do mês seguinte e não oferece iniciar", () => {
    state.closing = view({ closing: null, rows: [], period_ended: false });
    wrap(<ClosingTab />);
    expect(screen.getByText(/começa no dia 1 do mês seguinte/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar fechamento" })).toBeNull();
  });

  it("Financeiro prepara (atualizar, notificar) e baixa o arquivo de pagamento, mas não aprova nem trava", async () => {
    state.can = FIN; state.closing = view({ closing: { ...view().closing!, status: "aprovado" } });
    wrap(<ClosingTab />);
    expect(screen.getByRole("button", { name: /Atualizar extratos/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notificar profissionais/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Arquivo de pagamento/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Travar o mês/ })).toBeNull();
    expect(screen.queryByLabelText("Selecionar Dra. A")).toBeNull();
  });

  it("travar o mês só quando todos estão aprovados; confirmação explica o efeito", async () => {
    const user = userEvent.setup();
    state.closing = view();
    const { unmount } = wrap(<ClosingTab />);
    expect(screen.getByRole("button", { name: /Travar o mês/ })).toBeDisabled();
    unmount();
    state.closing = view({ closing: { ...view().closing!, status: "aprovado" } });
    state.lock.mockImplementation((_v: unknown, o: { onSuccess: () => void }) => o.onSuccess());
    wrap(<ClosingTab />);
    await user.click(screen.getByRole("button", { name: /Travar o mês/ }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/não muda: estorno ou correção posterior vira linha no próximo mês aberto/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Travar o mês" }));
    expect(state.lock).toHaveBeenCalledWith({ closingId: "k1", reason: undefined }, expect.anything());
    expect(await screen.findByText("Mês travado.")).toBeInTheDocument();
  });

  it("mês travado: sem seleção nem aprovação; Gestor não destrava; só o Owner/Admin destrava, com motivo obrigatório", async () => {
    const user = userEvent.setup();
    state.closing = view({ closing: { ...view().closing!, status: "travado", lock_no: 1, locked_at: "2026-11-10T12:00:00Z" } });
    const { unmount } = wrap(<ClosingTab />);
    expect(screen.queryByRole("button", { name: /Destravar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
    expect(screen.getByText(/Mês travado: nada muda/)).toBeInTheDocument();
    unmount();
    state.isAdmin = true;
    state.unlock.mockImplementation((_v: unknown, o: { onSuccess: () => void }) => o.onSuccess());
    wrap(<ClosingTab />);
    await user.click(screen.getByRole("button", { name: /Destravar/ }));
    const dlg = screen.getByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Destravar" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent(/Informe o motivo/);
    expect(state.unlock).not.toHaveBeenCalled();
    await user.type(within(dlg).getByLabelText("Motivo"), "Corrigir um valor aprovado");
    await user.click(within(dlg).getByRole("button", { name: "Destravar" }));
    expect(state.unlock).toHaveBeenCalledWith({ closingId: "k1", reason: "Corrigir um valor aprovado" }, expect.anything());
  });

  it("arquivo de pagamento: gera o CSV; sem aprovados avisa", async () => {
    const user = userEvent.setup();
    state.paymentFile.mockResolvedValue({ period: "2026-10", rows: [] });
    wrap(<ClosingTab />);
    await user.click(screen.getByRole("button", { name: /Arquivo de pagamento/ }));
    expect(await screen.findByText(/Nenhum profissional aprovado com valor a pagar/)).toBeInTheDocument();
    expect(state.paymentFile).toHaveBeenCalledWith("k1");
  });

  it("Recepção e profissional não veem a tabela do gestor", () => {
    state.can = { sales_read: true };
    wrap(<ClosingTab />);
    expect(screen.getByRole("note")).toHaveTextContent(/Você não tem acesso/);
  });

  it("no celular a tabela vira cartões (sem rolagem lateral)", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    try {
      wrap(<ClosingTab />);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("list", { name: "Fechamento do mês por profissional" })).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });

  it("abre o extrato do profissional com a memória de cálculo da linha", async () => {
    const user = userEvent.setup();
    wrap(<ClosingTab />);
    await user.click(screen.getAllByRole("button", { name: "Ver extrato de Dra. A" })[0]);
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/Extrato de Dra\. A · outubro de 2026/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Retenção IRRF \(1,5%\)/)).toBeInTheDocument();
    expect(within(dlg).getByText(/−R\$\s*114,00/)).toBeInTheDocument();
    expect(within(dlg).getAllByText(/R\$\s*7\.132,60/).length).toBeGreaterThan(0);
    await user.click(within(dlg).getByRole("button", { name: /Ver como foi calculado: Consulta/ }));
    expect(screen.getByRole("dialog", { name: "Como foi calculado" })).toBeInTheDocument();
  });
});

describe("Extrato do profissional: aceite, contestação, NF e pagamento", () => {
  const openStatement = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getAllByRole("button", { name: "Ver extrato de Dra. A" })[0]); return screen.getByRole("dialog"); };

  it("Gestor: ajuste manual, aprovar e atualizar; sem aceitar/contestar (isso é do profissional)", async () => {
    const user = userEvent.setup();
    wrap(<ClosingTab />);
    const dlg = await openStatement(user);
    expect(within(dlg).getByRole("button", { name: "Lançar ajuste manual" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Aprovar extrato" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: /Atualizar extrato/ })).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: "Aceitar extrato" })).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "Contestar" })).toBeNull();
    expect(within(dlg).getByRole("button", { name: /Enviar NF/ })).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Lançar ajuste manual" }));
    const aj = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(aj).getByRole("button", { name: "Lançar ajuste" }));
    expect(await within(aj).findByRole("alert")).toHaveTextContent(/valor maior que zero/);
    expect(state.adjust).not.toHaveBeenCalled();
  });

  it("extrato desatualizado (F13): avisa o gestor para atualizar", async () => {
    state.statement = stmt({ check: { items_total_cents: 700000, gross_cents: 760000, matches: false } });
    wrap(<ClosingTab />);
    const dlg = await openStatement(userEvent.setup());
    expect(within(dlg).getByRole("alert")).toHaveTextContent(/mudaram depois da última conferência.*Atualizar extrato/);
  });

  it("Profissional (próprio extrato): aceita; contesta uma linha com motivo obrigatório", async () => {
    const user = userEvent.setup();
    state.can = PRO;
    state.statement = stmt({ is_self: true, can: { decide: false, pay: false, prepare: false }, row: row({ acceptance: "pending" }) });
    state.mine = [{ id: "cp1", period: "2026-10", closing_status: "conferencia", status: "open", acceptance: "pending", accept_deadline: "2026-11-18", deadline_passed: false, gross_cents: 760000, withholding_cents: 46740, net_cents: 713260, requires_invoice: true, nf_status: "pending", paid_on: null, open_disputes: 0 } satisfies MyStatementRow];
    state.accept.mockImplementation(() => Promise.resolve());
    state.contest.mockImplementation((_v: unknown, o: { onSuccess: () => void }) => o.onSuccess());
    wrap(<MyStatementTab />, "/financeiro/repasse/meu-extrato");
    await user.click(screen.getByRole("button", { name: /Abrir extrato de outubro de 2026/ }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).queryByRole("button", { name: "Aprovar extrato" })).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "Lançar ajuste manual" })).toBeNull();
    expect(within(dlg).getByText(/Depois do prazo o gestor pode aprovar sem o seu aceite/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Aceitar extrato" }));
    expect(state.accept).toHaveBeenCalledWith("cp1");
    await user.click(within(dlg).getByRole("button", { name: /Contestar a linha Consulta/ }));
    const ct = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(ct).getByRole("button", { name: "Enviar contestação" }));
    expect(await within(ct).findByRole("alert")).toHaveTextContent(/motivo da contestação/);
    expect(state.contest).not.toHaveBeenCalled();
    await user.type(within(ct).getByLabelText("O que está errado"), "O valor do atendimento está errado");
    await user.click(within(ct).getByRole("button", { name: "Enviar contestação" }));
    expect(state.contest).toHaveBeenCalledWith({ statementId: "cp1", comment: "O valor do atendimento está errado", lineId: "l1", lineLabel: expect.stringContaining("Consulta") }, expect.anything());
  });

  it("contestação aberta aparece para o gestor com «Responder»; respondida mostra a resposta", async () => {
    const user = userEvent.setup();
    state.statement = stmt({ disputes: [
      { id: "d1", share_line_id: "l1", line_label: "05/10 · Consulta", comment: "valor errado", status: "open", response: null, created_at: "2026-11-02T13:00:00Z", answered_at: null, stmt_version: 1 },
      { id: "d2", share_line_id: null, line_label: null, comment: "faltou bônus", status: "answered", response: "Lançado o bônus", created_at: "2026-11-01T13:00:00Z", answered_at: "2026-11-02T13:00:00Z", stmt_version: 1 }] });
    state.answer.mockImplementation((_v: unknown, o: { onSuccess: () => void }) => o.onSuccess());
    wrap(<ClosingTab />);
    const dlg = await openStatement(user);
    expect(within(dlg).getByText("Aguardando resposta")).toBeInTheDocument();
    expect(within(dlg).getByText(/Lançado o bônus/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Extrato inteiro · 01\/11\/2026/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Responder" }));
    const an = screen.getAllByRole("dialog").at(-1)!;
    await user.type(within(an).getByLabelText("Resposta"), "Conferido");
    await user.click(within(an).getByRole("button", { name: "Enviar resposta" }));
    expect(state.answer).toHaveBeenCalledWith({ disputeId: "d1", response: "Conferido" }, expect.anything());
  });

  it("pagamento: só extrato aprovado com líquido; exige comprovante; mês travado não mostra ações", async () => {
    const user = userEvent.setup();
    state.statement = stmt({ row: row({ status: "approved", acceptance: "accepted", nf_status: "received", invoice_number: "1234", invoice_date: "2026-11-02", invoice_path: "c1/cp1/nf.pdf" }) });
    const { unmount } = wrap(<ClosingTab />);
    let dlg = await openStatement(user);
    expect(within(dlg).getByText(/nº 1234 · emitida em 02\/11\/2026/)).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: "Aprovar extrato" })).toBeNull();
    await user.click(within(dlg).getByRole("button", { name: "Registrar pagamento" }));
    const pg = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(pg).getByRole("button", { name: "Registrar pagamento" }));
    expect(await within(pg).findByRole("alert")).toHaveTextContent(/Anexe o comprovante/);
    expect(state.pay).not.toHaveBeenCalled();
    unmount();
    state.statement = stmt({ closing: { id: "k1", period: "2026-10", status: "travado", locked: true }, row: row({ status: "paid", payment_status: "paid", paid_on: "2026-11-05", pay_method: "pix", proof_path: "c1/cp1/c.pdf" }) });
    wrap(<ClosingTab />);
    dlg = await openStatement(user);
    expect(within(dlg).getByText(/Pago em 05\/11\/2026/)).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: "Registrar pagamento" })).toBeNull();
    expect(within(dlg).queryByRole("button", { name: /NF/ })).toBeNull();
    expect(within(dlg).getByRole("button", { name: /Abrir comprovante/ })).toBeInTheDocument();
  });

  it("NF: número e arquivo obrigatórios", async () => {
    const user = userEvent.setup();
    wrap(<ClosingTab />);
    const dlg = await openStatement(user);
    await user.click(within(dlg).getByRole("button", { name: "Enviar NF" }));
    const nf = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(nf).getByRole("button", { name: "Salvar NF" }));
    await waitFor(() => expect(within(nf).getByRole("alert")).toHaveTextContent(/número da NF/));
    await user.type(within(nf).getByLabelText("Número da NF"), "99");
    await user.click(within(nf).getByRole("button", { name: "Salvar NF" }));
    await waitFor(() => expect(within(nf).getByRole("alert")).toHaveTextContent(/Anexe o arquivo da NF/));
    expect(state.invoice).not.toHaveBeenCalled();
  });
});

describe("Abas do Repasse", () => {
  it("Gestor vê Fechamento; profissional vê Meu extrato; ninguém vê as duas sem o papel", () => {
    state.can = GESTOR;
    const a = wrap(<PayoutLayout />, "/financeiro/repasse");
    expect(screen.getByRole("link", { name: "Fechamento" })).toHaveAttribute("href", "/financeiro/repasse/fechamento");
    expect(screen.queryByRole("link", { name: "Meu extrato" })).toBeNull();
    a.unmount();
    state.can = PRO;
    wrap(<PayoutLayout />, "/financeiro/repasse");
    expect(screen.getByRole("link", { name: "Meu extrato" })).toHaveAttribute("href", "/financeiro/repasse/meu-extrato");
    expect(screen.queryByRole("link", { name: "Fechamento" })).toBeNull();
  });
  it("Meu extrato sem extrato fechado: estado vazio explica", () => {
    state.can = PRO; state.mine = [];
    wrap(<MyStatementTab />, "/financeiro/repasse/meu-extrato");
    expect(screen.getByText("Nenhum extrato fechado ainda")).toBeInTheDocument();
  });
  it("quem não é profissional não vê «Meu extrato»", () => {
    state.can = { sales_read: true };
    wrap(<MyStatementTab />, "/financeiro/repasse/meu-extrato");
    expect(screen.getByRole("note")).toHaveTextContent(/Você não tem acesso/);
  });
});
