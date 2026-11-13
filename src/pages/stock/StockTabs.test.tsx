import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { StockBalanceTab } from "./StockBalanceTab";
import { StockEntriesTab } from "./StockEntriesTab";
import { StockExitsTab } from "./StockExitsTab";
import { StockMovementsTab } from "./StockMovementsTab";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false, narrow: false,
  balances: [] as unknown[], movements: [] as unknown[], entries: [] as unknown[], lots: null as unknown, suppliers: [] as unknown[], maps: [] as unknown[],
  exitMutate: vi.fn(), entryMutate: vi.fn(), reverseMovementMutate: vi.fn(), reverseEntryMutate: vi.fn(),
}));

const ITEMS = [
  { id: "i-amp", name: "Ampola X", category: "amp", item_type: "medication", stock_unit: "ampola", purchase_unit: "cx", purchase_to_stock_factor: 10, fractional: false, lot_control: true, individual_use: false, ean: null, is_active: true },
  { id: "i-cn", name: "Caneta multidose", category: "caneta", item_type: "medication", stock_unit: "caneta", purchase_unit: "un", purchase_to_stock_factor: 1, fractional: true, lot_control: true, individual_use: true, ean: null, is_active: true },
  { id: "i-ser", name: "Seringa 5 ml", category: "mat", item_type: "consumable", stock_unit: "un", purchase_unit: "cx", purchase_to_stock_factor: 100, fractional: false, lot_control: false, individual_use: false, ean: null, is_active: true },
];

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal", is_active: true, is_primary: true }, { id: "u2", name: "Unidade 2", is_active: true, is_primary: false }] }),
  useStockItems: () => ({ data: ITEMS }),
}));
vi.mock("@/hooks/useStockMoves", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() });
  const m = (mutate: unknown) => ({ mutate, isPending: false });
  return {
    useBalances: () => q(state.balances), useMovements: () => q(state.movements), useEntries: () => q(state.entries), useSuppliers: () => q(state.suppliers),
    useSupplierMaps: () => q(state.maps), useStockLots: () => q(state.lots), useStockPatients: () => q([{ patient_id: "p1", full_name: "Paciente Um" }]), useEntryByKey: () => q(null),
    useRegisterExit: () => m(state.exitMutate), useCreateEntry: () => m(state.entryMutate),
    useReverseMovement: () => m(state.reverseMovementMutate), useReverseEntry: () => m(state.reverseEntryMutate),
  };
});

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const MOVE_RW = { stock_items_read: true, stock_move_read: true, stock_move_write: true };
const MOVE_RO = { stock_items_read: true, stock_move_read: true, stock_move_write: false };

const balance = (over: Record<string, unknown> = {}) => ({
  item_id: "i-amp", item_name: "Ampola X", category: "amp", item_type: "medication", stock_unit: "ampola", fractional: false, lot_control: true, unit_id: "u1", unit_name: "Unidade principal",
  qty_on_hand: 27, avg_cost_cents: 4400, value_cents: 118800, min_qty: 30, below_min: true, next_expiry: "2999-01-01", expired_qty: 0, open_qty: 0,
  lots: [{ lot_id: "l1", lot_code: "L2", expiry_date: "2999-01-01", qty: 27, open_qty: 0, expired: false }], ...over,
});
const movement = (over: Record<string, unknown> = {}) => ({
  id: "m1", occurred_on: "2026-11-13", created_at: "2026-11-13T10:00:00Z", unit_id: "u1", unit_name: "Unidade principal", item_id: "i-amp", item_name: "Ampola X", stock_unit: "ampola",
  movement_type: "sector", qty: -3, unit_cost_cents: 4400, total_cost_cents: -13200, balance_after: 27, avg_cost_after_cents: 4400, lot_code: "L1", expiry_date: "2999-01-01",
  reason: "Uso geral da sala", purpose: "Sala", loss_kind: null, patient_name: null, user_name: "Estoquista", supplier_name: null, invoice_number: null, entry_id: null, sale_id: null,
  reversed: false, reversal_of: null, ...over,
});

beforeEach(() => {
  state.can = MOVE_RW; state.isAdmin = false; state.balances = []; state.movements = []; state.entries = []; state.suppliers = []; state.maps = []; state.lots = null;
  [state.exitMutate, state.entryMutate, state.reverseMovementMutate, state.reverseEntryMutate].forEach((f) => f.mockReset());
});

describe("Estoque › Saldo", () => {
  it("lista item × unidade com saldo, custo médio R$ 44,00, valor, alerta de mínimo e lotes; exportação disponível", () => {
    state.balances = [balance(), balance({ item_id: "i-cn", item_name: "Caneta multidose", expired_qty: 2, below_min: false, next_expiry: "2020-01-01", lots: [{ lot_id: "l9", lot_code: "VELHO", expiry_date: "2020-01-01", qty: 2, open_qty: 0, expired: true }], qty_on_hand: 2, value_cents: 2000, avg_cost_cents: 1000 })];
    wrap(<StockBalanceTab />);
    const table = screen.getByRole("table", { name: "Saldo por item e unidade" });
    expect(within(table).getByText("Ampola X")).toBeInTheDocument();
    expect(within(table).getAllByText(/R\$\s*44,00/)[0]).toBeInTheDocument();
    expect(within(table).getByText("Abaixo do mínimo")).toBeInTheDocument();
    expect(within(table).getByText("Tem lote vencido")).toBeInTheDocument();
    expect(within(table).getByText("L2")).toBeInTheDocument();
    expect(screen.getByText(/Valor em estoque/)).toHaveTextContent(/1\.208,00/);
    expect(screen.getByRole("button", { name: /CSV/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Excel/ })).toBeEnabled();
  });

  it("sem saldo lançado: estado vazio orientando a lançar a entrada", () => {
    wrap(<StockBalanceTab />);
    expect(screen.getByText("Nenhum saldo lançado")).toBeInTheDocument();
  });

  it("Recepção (sem papel de estoque): só o aviso de acesso, sem tabela e sem custo", () => {
    state.can = { units_read: true, sales_read: true, sales_write: true };
    state.balances = [balance()];
    wrap(<StockBalanceTab />);
    expect(screen.getByText(/O saldo do estoque é do administrador/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/44,00/)).toBeNull();
  });

  it("no celular a lista vira cartões (sem tabela)", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      state.balances = [balance()];
      wrap(<StockBalanceTab />);
      expect(screen.queryByRole("table")).toBeNull();
      const list = screen.getByRole("list", { name: "Saldo por item e unidade" });
      expect(within(list).getByText("Ampola X")).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });
});

describe("Estoque › Entradas", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: "e1", created_at: "2026-11-13T10:00:00Z", received_on: "2026-11-13", unit_id: "u1", unit_name: "Unidade principal", entry_type: "xml_purchase", supplier_name: "Distribuidora Exemplo", invoice_number: "1234",
    invoice_key: "x", lines_count: 3, items_total_cents: 70000, freight_cents: 2000, total_cents: 72000, status: "active", reverse_reason: null, user_name: "Estoquista", notes: null, ...over,
  });

  it("estoquista: botões Nova entrada e Importar XML; Financeiro (consulta): nenhum dos dois", () => {
    wrap(<StockEntriesTab />);
    expect(screen.getAllByRole("button", { name: /Nova entrada/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Importar XML da NF-e/ })).toBeInTheDocument();
  });

  it("Financeiro só consulta: sem botões de lançar nem de estornar", () => {
    state.can = MOVE_RO;
    state.entries = [entry()];
    wrap(<StockEntriesTab />);
    expect(screen.getByText(/Consulta: você vê as entradas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova entrada/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Importar XML/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Estornar/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Ver itens/ })).toBeInTheDocument();
  });

  it("estorno da entrada exige o motivo e então chama o estorno do documento inteiro", async () => {
    const user = userEvent.setup();
    state.entries = [entry()];
    wrap(<StockEntriesTab />);
    await user.click(screen.getByRole("button", { name: /Estornar entrada/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Estornar" }));
    expect(within(dialog).getByText("Informe o motivo do estorno.")).toBeInTheDocument();
    expect(state.reverseEntryMutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Motivo do estorno"), "Nota em duplicidade");
    await user.click(within(dialog).getByRole("button", { name: "Estornar" }));
    expect(state.reverseEntryMutate).toHaveBeenCalledWith({ entryId: "e1", reason: "Nota em duplicidade" }, expect.anything());
  });

  it("entrada estornada não oferece novo estorno", () => {
    state.entries = [entry({ status: "reversed", reverse_reason: "Duplicada" })];
    wrap(<StockEntriesTab />);
    expect(screen.queryByRole("button", { name: /Estornar entrada/ })).toBeNull();
    expect(screen.getByText("Estornada")).toBeInTheDocument();
  });

  it("entrada manual: item com lote exige lote e validade; compra exige fornecedor e nota", async () => {
    const user = userEvent.setup();
    wrap(<StockEntriesTab />);
    await user.click(screen.getAllByRole("button", { name: /Nova entrada/ })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Lançar entrada" }));
    expect(within(dialog).getByText("Informe o número da nota.")).toBeInTheDocument();
    expect(within(dialog).getByText("Escolha ou cadastre o fornecedor.")).toBeInTheDocument();
    expect(within(dialog).getByText("Escolha o item.")).toBeInTheDocument();
    expect(state.entryMutate).not.toHaveBeenCalled();
    // saldo inicial: sem fornecedor/nota; lote e validade do item de lote são exigidos
    await user.selectOptions(within(dialog).getByLabelText("Tipo de entrada"), "initial_balance");
    await user.selectOptions(within(dialog).getByLabelText("Item"), "i-amp");
    await user.type(within(dialog).getByLabelText(/Qtd\./), "10");
    await user.type(within(dialog).getByLabelText("Custo unitário (R$)"), "40,00");
    await user.click(within(dialog).getByRole("button", { name: "Lançar entrada" }));
    expect(within(dialog).getByText("Informe o lote e a validade.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Lote/), "L1");
    fireEvent.change(within(dialog).getByLabelText(/Validade/), { target: { value: "2999-12-31" } });
    await user.click(within(dialog).getByRole("button", { name: "Lançar entrada" }));
    expect(state.entryMutate).toHaveBeenCalledTimes(1);
    const payload = state.entryMutate.mock.calls[0][0];
    expect(payload.unitId).toBe("u1");
    expect(payload.header).toMatchObject({ entryType: "initial_balance", freightCents: 0 });
    expect(payload.lines).toEqual([{ itemId: "i-amp", quantity: 10, lineTotalCents: 40000, lotCode: "L1", expiryDate: "2999-12-31", supplierCode: null, conversionFactor: 1 }]);
  });
});

describe("Estoque › Importar XML da NF-e", () => {
  const KEY = "35261111222333000181550010000012341000012349";
  const XML = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${KEY}">
    <ide><serie>1</serie><nNF>1234</nNF><dhEmi>2026-11-10T09:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>11222333000181</CNPJ><xNome>Distribuidora Exemplo Ltda</xNome></emit>
    <det nItem="1"><prod><cProd>AMP-001</cProd><cEAN>SEM GTIN</cEAN><xProd>Ampola X</xProd><uCom>CX</uCom><qCom>2.0000</qCom><vProd>460.00</vProd>
      <rastro><nLote>LOTE-A1</nLote><qLote>2.000</qLote><dVal>2999-09-01</dVal></rastro></prod></det>
    <det nItem="2"><prod><cProd>NOVO-9</cProd><cEAN>SEM GTIN</cEAN><xProd>Item que o cadastro não conhece</xProd><uCom>UN</uCom><qCom>5.0000</qCom><vProd>50.00</vProd></prod></det>
    <total><ICMSTot><vFrete>20.00</vFrete></ICMSTot></total></infNFe></NFe></nfeProc>`;

  async function upload(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /Importar XML da NF-e/ }));
    const dialog = await screen.findByRole("dialog");
    const file = new File([XML], "nota.xml", { type: "text/xml" });
    (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(XML);
    await user.upload(within(dialog).getByLabelText("Arquivo XML da NF-e"), file);
    return dialog;
  }

  it("lê o XML no navegador: mostra fornecedor, nota, chave, frete, itens; vincula por nome e pede vínculo ao item novo (E14)", async () => {
    const user = userEvent.setup();
    wrap(<StockEntriesTab />);
    const dialog = await upload(user);
    await within(dialog).findByText("Distribuidora Exemplo Ltda");
    expect(within(dialog).getByText(KEY)).toBeInTheDocument();
    expect(within(dialog).getByText(/1234 · série 1/)).toBeInTheDocument();
    const itemsBox = within(dialog).getByLabelText("Itens da nota");
    expect(within(itemsBox).getByText("mesmo nome")).toBeInTheDocument();      // Ampola X vinculada sozinha
    expect(within(itemsBox).getByText("sem vínculo")).toBeInTheDocument();     // item novo do fornecedor
    expect(within(itemsBox).getByDisplayValue("LOTE-A1")).toBeInTheDocument();   // lote do rastro da nota já preenchido
    expect(state.entryMutate).not.toHaveBeenCalled();                         // nada é gravado antes de confirmar
  });

  it("confirmar sem vincular o item novo é recusado; marcando «não entra», confirma com a chave, o fornecedor novo, o frete e o de/para", async () => {
    const user = userEvent.setup();
    wrap(<StockEntriesTab />);
    const dialog = await upload(user);
    await within(dialog).findByText("Distribuidora Exemplo Ltda");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar entrada" }));
    expect(within(dialog).getByText(/Escolha o item do cadastro/)).toBeInTheDocument();
    expect(state.entryMutate).not.toHaveBeenCalled();
    await user.selectOptions(within(dialog).getByLabelText("Item do cadastro", { selector: "#xml-i-1" }), "__skip");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar entrada" }));
    expect(state.entryMutate).toHaveBeenCalledTimes(1);
    const { unitId, header, lines } = state.entryMutate.mock.calls[0][0];
    expect(unitId).toBe("u1");
    expect(header).toMatchObject({ entryType: "xml_purchase", invoiceNumber: "1234", invoiceKey: KEY, freightCents: 2000, supplierId: null, supplierNew: { name: "Distribuidora Exemplo Ltda", taxId: "11222333000181" } });
    expect(lines).toEqual([{ itemId: "i-amp", quantity: 20, lineTotalCents: 46000, lotCode: "LOTE-A1", expiryDate: "2999-09-01", supplierCode: "AMP-001", conversionFactor: 10 }]);
  });

  it("arquivo que não é NF-e: mensagem clara e nada para confirmar", async () => {
    const user = userEvent.setup();
    wrap(<StockEntriesTab />);
    await user.click(screen.getByRole("button", { name: /Importar XML da NF-e/ }));
    const dialog = await screen.findByRole("dialog");
    const file = new File(["<html><body>oi</body></html>"], "x.xml", { type: "text/xml" });
    (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve("<html><body>oi</body></html>");
    await user.upload(within(dialog).getByLabelText("Arquivo XML da NF-e"), file);
    await waitFor(() => expect(within(dialog).getByText(/não é uma NF-e/)).toBeInTheDocument());
    await user.click(within(dialog).getByRole("button", { name: "Confirmar entrada" }));
    expect(state.entryMutate).not.toHaveBeenCalled();
  });
});

describe("Estoque › Saídas", () => {
  const lots = (over: Record<string, unknown> = {}) => ({
    avg_cost_cents: 4400,
    lots: [
      { lot_id: "l1", lot_code: "L1", expiry_date: "2999-01-01", qty: 7, available: 7, expired: false },
      { lot_id: "lv", lot_code: "VELHO", expiry_date: "2020-01-01", qty: 3, available: 3, expired: true },
    ],
    open_units: [], ...over,
  });
  async function openExit(user: ReturnType<typeof userEvent.setup>, itemId = "i-amp") {
    state.balances = [balance({ item_id: itemId, item_name: ITEMS.find((i) => i.id === itemId)?.name })];
    await user.click(screen.getAllByRole("button", { name: /Nova saída/ })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Item"), itemId);
    return dialog;
  }

  it("Financeiro só consulta: sem botão de Nova saída nem de estornar", () => {
    state.can = MOVE_RO;
    state.movements = [movement()];
    wrap(<StockExitsTab />);
    expect(screen.queryByRole("button", { name: /Nova saída/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Estornar/ })).toBeNull();
    expect(screen.getByText(/Consulta: você vê as saídas/)).toBeInTheDocument();
  });

  it("baixa de venda e estorno aparecem na lista, mas não oferecem Estornar (a venda cancelada devolve sozinha)", () => {
    state.movements = [movement({ id: "m-sale", movement_type: "sale" }), movement({ id: "m-rev", movement_type: "reversal", qty: 2 }), movement({ id: "m-ok" }), movement({ id: "m-done", reversed: true })];
    wrap(<StockExitsTab />);
    expect(screen.getAllByRole("button", { name: /Estornar Ampola X/ })).toHaveLength(1);
  });

  it("perda sem motivo nem tipo: mostra os erros e não envia", async () => {
    const user = userEvent.setup();
    state.lots = lots();
    wrap(<StockExitsTab />);
    const dialog = await openExit(user);
    await user.selectOptions(within(dialog).getByLabelText("Tipo de saída"), "loss");
    await user.type(within(dialog).getByLabelText(/Quantidade/), "1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(within(dialog).getByText("Escolha perda, quebra ou vencimento.")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe o motivo.")).toBeInTheDocument();
    expect(state.exitMutate).not.toHaveBeenCalled();
  });

  it("padrão FEFO: mostra de qual lote sai e o custo pelo custo médio; consumo de setor exige finalidade e motivo e envia o pedido certo", async () => {
    const user = userEvent.setup();
    state.lots = lots();
    wrap(<StockExitsTab />);
    const dialog = await openExit(user);
    await user.type(within(dialog).getByLabelText(/Quantidade/), "3");
    expect(within(dialog).getByText(/Sai de: L1 \(3\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/R\$\s*132,00/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(within(dialog).getByText("Informe o setor ou a finalidade.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Setor ou finalidade"), "Sala de procedimentos");
    await user.type(within(dialog).getByLabelText("Motivo"), "Uso geral da sala");
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(state.exitMutate).toHaveBeenCalledTimes(1);
    expect(state.exitMutate.mock.calls[0][0]).toMatchObject({ unitId: "u1", itemId: "i-amp", type: "sector", quantity: 3, purpose: "Sala de procedimentos", reason: "Uso geral da sala", lotId: undefined });
  });

  it("E4: só sobrou lote vencido → a tela avisa que não sai para consumo; perda por vencimento exige a confirmação", async () => {
    const user = userEvent.setup();
    state.lots = lots({ lots: [{ lot_id: "lv", lot_code: "VELHO", expiry_date: "2020-01-01", qty: 3, available: 3, expired: true }] });
    wrap(<StockExitsTab />);
    const dialog = await openExit(user);
    await user.type(within(dialog).getByLabelText(/Quantidade/), "1");
    expect(within(dialog).getByText(/Lote vencido não sai para consumo/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Tipo de saída"), "loss");
    await user.selectOptions(within(dialog).getByLabelText("O que aconteceu"), "expiry");
    expect(within(dialog).getByText(/Sai de: VELHO \(1\)/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Motivo"), "Lote venceu");
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(within(dialog).getByText("Confirme que o lote venceu.")).toBeInTheDocument();
    expect(state.exitMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByLabelText("Confirmo que o lote está vencido"));
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(state.exitMutate.mock.calls[0][0]).toMatchObject({ type: "loss", lossKind: "expiry", confirmExpired: true, quantity: 1 });
  });

  it("uso fracionado individual: pede o paciente, aceita fração de 3 casas e recusa fração em item que não é fracionado", async () => {
    const user = userEvent.setup();
    state.lots = lots({ lots: [{ lot_id: "l1", lot_code: "C1", expiry_date: "2999-01-01", qty: 2, available: 2, expired: false }] });
    wrap(<StockExitsTab />);
    let dialog = await openExit(user, "i-cn");
    await user.type(within(dialog).getByLabelText(/Quantidade/), "0,25");
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(within(dialog).getByText("Motivo", { selector: "label" })).toBeInTheDocument();
    expect(within(dialog).getByText("Escolha o paciente.")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Tipo de saída"), "appointment");
    await user.click(within(dialog).getByRole("button", { name: "Paciente Um" }));
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(state.exitMutate.mock.calls[0][0]).toMatchObject({ itemId: "i-cn", type: "appointment", quantity: 0.25, patientId: "p1" });
    // item que não é fracionado
    state.exitMutate.mockReset();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    dialog = await openExit(user, "i-amp");
    await user.selectOptions(within(dialog).getByLabelText("Tipo de saída"), "appointment");
    await user.type(within(dialog).getByLabelText(/Quantidade/), "0,5");
    await user.click(within(dialog).getByRole("button", { name: "Registrar saída" }));
    expect(within(dialog).getByText("Este item só sai em unidades inteiras.")).toBeInTheDocument();
    expect(state.exitMutate).not.toHaveBeenCalled();
  });
});

describe("Estoque › Movimentações", () => {
  it("kardex com custo unitário, total e saldo depois; estorno pede motivo e chama o estorno do movimento", async () => {
    const user = userEvent.setup();
    state.movements = [movement()];
    wrap(<StockMovementsTab />);
    const table = screen.getByRole("table", { name: "Movimentações de estoque" });
    expect(within(table).getByText("Ampola X")).toBeInTheDocument();
    expect(within(table).getAllByText(/R\$\s*44,00/).length).toBeGreaterThan(0);
    expect(within(table).getByText(/R\$\s*132,00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Estornar Ampola X" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Motivo do estorno"), "Saída lançada no item errado");
    await user.click(within(dialog).getByRole("button", { name: "Estornar" }));
    expect(state.reverseMovementMutate).toHaveBeenCalledWith({ movementId: "m1", reason: "Saída lançada no item errado" }, expect.anything());
  });

  it("sem movimentação: estado vazio; filtros por item, movimento e sentido presentes", () => {
    wrap(<StockMovementsTab />);
    expect(screen.getByText("Nenhuma movimentação")).toBeInTheDocument();
    expect(screen.getByLabelText("Item")).toBeInTheDocument();
    expect(screen.getByLabelText("Movimento")).toBeInTheDocument();
    expect(screen.getByLabelText("Sentido")).toBeInTheDocument();
  });
});
