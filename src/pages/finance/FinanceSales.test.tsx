import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { SalesTab } from "./SalesTab";
import { TitlesTab } from "./TitlesTab";
import { CashTab } from "./CashTab";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false,
  sales: [] as unknown[], catalog: null as unknown, compliance: { license_ok: false, accepted: false, blocked: true },
  openCash: null as unknown, saveMutate: vi.fn(), openMutate: vi.fn(), closeMutate: vi.fn(), acceptMutate: vi.fn(),
}));

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal", is_active: true, is_primary: true }] }),
}));
vi.mock("@/hooks/useFinSales", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const m = (mutate: unknown) => ({ mutate, isPending: false });
  return {
    useSales: () => q(state.sales), useSale: () => q(null), useTitles: () => q([]), useCashReport: () => q([]),
    useSaleCatalog: () => q(state.catalog), useSalePatients: () => q([{ patient_id: "p1", full_name: "Mariana Teste" }]), useComplianceStatus: () => q(state.compliance),
    usePaymentOptions: () => q([]), useMyOpenCash: () => q(state.openCash),
    useSaveSale: () => m(state.saveMutate), useAcceptCompliance: () => m(state.acceptMutate), useCancelSale: () => m(vi.fn()), useAddPayment: () => m(vi.fn()),
    useSettleTitle: () => m(vi.fn()), useCorrectTitle: () => m(vi.fn()), useReverseTitle: () => m(vi.fn()), useOpenCash: () => m(state.openMutate),
    useCashMovement: () => m(vi.fn()), useCloseCash: () => m(state.closeMutate), useApproveCash: () => m(vi.fn()),
  };
});

const catalog = (canEdit: boolean) => ({
  services: [{ id: "s1", name: "Consulta médica", category: "consulta", price_cents: 50000 }], packages: [],
  products: [{ id: "i1", name: "Manipulado Y", item_type: "compounded", price_cents: 25000 }], professionals: [{ id: "pr1", name: "Dra. Ana" }], can_edit_price: canEdit,
});
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Financeiro › Vendas", () => {
  beforeEach(() => { state.can = { sales_read: true, sales_write: true }; state.isAdmin = false; state.sales = []; state.catalog = catalog(false); state.saveMutate.mockClear(); state.acceptMutate.mockClear(); });

  it("sem venda: estado vazio com botão Nova venda para quem lança", () => {
    wrap(<SalesTab />);
    expect(screen.getByText("Nenhuma venda no período")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Nova venda/ }).length).toBeGreaterThan(0);
  });

  it("Profissional (só produção própria): vê aviso, lista e sem botão de nova venda", () => {
    state.can = { own_sales_read: true };
    wrap(<SalesTab />);
    expect(screen.getByText(/Você vê só a sua produção/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova venda/ })).toBeNull();
  });

  it("sem papel: aviso de acesso", () => {
    state.can = {};
    wrap(<SalesTab />);
    expect(screen.getByText(/Você não tem acesso/)).toBeInTheDocument();
  });

  it("Recepção: preço de tabela bloqueado na venda; escolhe paciente e item e vê o total com desconto", async () => {
    const user = userEvent.setup();
    wrap(<SalesTab />);
    await user.click(screen.getAllByRole("button", { name: /Nova venda/ })[0]);
    const dlg = within(screen.getByRole("dialog"));
    await user.click(dlg.getByRole("button", { name: "Mariana Teste" }));
    await user.selectOptions(dlg.getByLabelText("Item"), "s1");
    expect((dlg.getByLabelText("Preço (R$)") as HTMLInputElement).disabled).toBe(true);
    await user.type(dlg.getByLabelText("Desc. %"), "10");
    expect(dlg.getByText(/Valor líquido do item/).textContent).toMatch(/450,00/);
    await user.click(dlg.getByRole("button", { name: "Registrar venda" }));
    expect(state.saveMutate).toHaveBeenCalledTimes(1);
    expect(state.saveMutate.mock.calls[0][0]).toMatchObject({ patientId: "p1", unitId: "u1", items: [{ itemType: "service", refId: "s1", quantity: 1, discountPct: 10 }] });
    expect(state.saveMutate.mock.calls[0][0].items[0].unitPriceCents).toBeUndefined();
  });

  it("Financeiro/Gestor: preço editável", async () => {
    state.catalog = catalog(true);
    const user = userEvent.setup();
    wrap(<SalesTab />);
    await user.click(screen.getAllByRole("button", { name: /Nova venda/ })[0]);
    const dlg = within(screen.getByRole("dialog"));
    await user.selectOptions(dlg.getByLabelText("Item"), "s1");
    expect((dlg.getByLabelText("Preço (R$)") as HTMLInputElement).disabled).toBe(false);
  });

  it("F18: manipulado sem licença bloqueia a venda; Recepção é orientada a chamar o Owner; Owner vê o botão de aceite", async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<SalesTab />);
    await user.click(screen.getAllByRole("button", { name: /Nova venda/ })[0]);
    let dlg = within(screen.getByRole("dialog"));
    await user.click(dlg.getByRole("button", { name: "Mariana Teste" }));
    await user.selectOptions(dlg.getByLabelText("Tipo"), "product");
    await user.selectOptions(dlg.getByLabelText("Item"), "i1");
    expect(dlg.getByRole("alert").textContent).toMatch(/licença sanitária/);
    expect(dlg.getByText(/Peça ao Owner/)).toBeInTheDocument();
    await user.click(dlg.getByRole("button", { name: "Registrar venda" }));
    expect(state.saveMutate).not.toHaveBeenCalled();
    unmount();

    state.isAdmin = true;
    wrap(<SalesTab />);
    await user.click(screen.getAllByRole("button", { name: /Nova venda/ })[0]);
    dlg = within(screen.getByRole("dialog"));
    await user.click(dlg.getByRole("button", { name: "Mariana Teste" }));
    await user.selectOptions(dlg.getByLabelText("Tipo"), "product");
    await user.selectOptions(dlg.getByLabelText("Item"), "i1");
    await user.click(dlg.getByRole("button", { name: /Dar o aceite como Owner/ }));
    expect(state.acceptMutate).toHaveBeenCalledWith({ unitId: "u1" });
  });
});

describe("Financeiro › Títulos", () => {
  it("Recepção não vê títulos (taxa): aviso de acesso", () => {
    state.can = { sales_read: true, sales_write: true };
    wrap(<TitlesTab />);
    expect(screen.getByText(/Os títulos/)).toBeInTheDocument();
  });
  it("Financeiro: tabela vazia com estado vazio e filtros de período e situação", () => {
    state.can = { receivables_read: true, receivables_write: true };
    wrap(<TitlesTab />);
    expect(screen.getByText("Nenhum título neste filtro")).toBeInTheDocument();
    expect(screen.getByLabelText("Situação")).toBeInTheDocument();
    expect(screen.getByLabelText("De")).toBeInTheDocument();
  });
});

describe("Financeiro › Caixa", () => {
  beforeEach(() => { state.isAdmin = false; state.can = { cash_read: true, cash_write: true }; state.openCash = null; state.openMutate.mockClear(); state.closeMutate.mockClear(); });

  it("sem caixa aberto: formulário de abertura com troco", async () => {
    const user = userEvent.setup();
    wrap(<CashTab />);
    expect(screen.getByText(/Você não tem caixa aberto/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Troco inicial em espécie (R$)"));
    await user.type(screen.getByLabelText("Troco inicial em espécie (R$)"), "50");
    await user.click(screen.getByRole("button", { name: "Abrir caixa" }));
    expect(state.openMutate.mock.calls[0][0]).toEqual({ unitId: "u1", openingCents: 5000 });
  });

  it("F19: fechamento com diferença de R$ 10,00 exige justificativa antes de enviar", async () => {
    state.openCash = {
      id: "r1", unit_name: "Unidade principal", business_date: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), opening_cash_cents: 5000, status: "open",
      live_lines: [{ key: "cash", label: "Dinheiro (espécie)", expected_cents: 13500 }, { key: "pix", label: "Pix", expected_cents: 20000 }], movements: [],
    };
    const user = userEvent.setup();
    wrap(<CashTab />);
    await user.click(screen.getByRole("button", { name: "Fechar caixa" }));
    const dlg = within(screen.getByRole("dialog"));
    await user.type(dlg.getByLabelText("Contado em Dinheiro (espécie)"), "125");
    expect(dlg.getByText(/Diferença de R\$\s?10,00/)).toBeInTheDocument();
    await user.click(dlg.getByRole("button", { name: "Fechar caixa" }));
    expect(state.closeMutate).not.toHaveBeenCalled();
    expect(dlg.getByRole("alert").textContent).toMatch(/justificativa/);
    await user.type(dlg.getByLabelText("Justificativa"), "Troco a menos");
    await user.click(dlg.getByRole("button", { name: "Fechar caixa" }));
    expect(state.closeMutate.mock.calls[0][0]).toEqual({ registerId: "r1", counted: { cash: 12500 }, justification: "Troco a menos" });
  });

  it("sem papel de caixa: aviso de acesso", () => {
    state.can = {};
    wrap(<CashTab />);
    expect(screen.getByText(/Você não tem acesso/)).toBeInTheDocument();
  });
});
