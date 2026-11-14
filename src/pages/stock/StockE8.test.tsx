import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { StockAlertsTab } from "./StockAlertsTab";
import { StockInventoryTab } from "./StockInventoryTab";
import { StockReportsTab } from "./StockReportsTab";
import { StockTransfersTab } from "./StockTransfersTab";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false,
  inventories: [] as unknown[], lines: [] as unknown[], transfers: [] as unknown[], alerts: null as unknown, report: null as unknown,
  countMutate: vi.fn(), finishMutate: vi.fn(), approveMutate: vi.fn(), receiveMutate: vi.fn(), cancelTransferMutate: vi.fn(),
}));

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal", is_active: true, is_primary: true }, { id: "u2", name: "Unidade 2", is_active: true, is_primary: false }] }),
  useStockItems: () => ({ data: [], isSuccess: true }),
}));
vi.mock("@/hooks/useStockMoves", () => ({ useBalances: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useStockE8", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() });
  const m = (mutate: unknown) => ({ mutate, isPending: false });
  return {
    useInventories: () => q(state.inventories), useInventoryLines: () => q(state.lines), useTransfers: () => q(state.transfers), useStockAlerts: () => q(state.alerts), useStockReport: () => q(state.report),
    useCountInventory: () => m(state.countMutate), useFinishInventory: () => m(state.finishMutate), useApproveInventory: () => m(state.approveMutate), useReopenInventory: () => m(vi.fn()), useCancelInventory: () => m(vi.fn()),
    useOpenInventory: () => m(vi.fn()), useSendTransfer: () => m(vi.fn()), useReceiveTransfer: () => m(state.receiveMutate), useCancelTransfer: () => m(state.cancelTransferMutate), useSaveAlertSettings: () => m(vi.fn()),
  };
});

const wrap = (ui: React.ReactElement, url = "/") => render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);
const ESTOQUISTA = { stock_items_read: true, stock_move_read: true, stock_move_write: true, inv_manage_read: false, inv_manage_write: false };
const GESTOR = { stock_items_read: true, stock_move_read: true, stock_move_write: true, inv_manage_read: true, inv_manage_write: true, settings_read: true, settings_write: true };

const inv = (over: Record<string, unknown> = {}) => ({
  id: "inv1", number: 3, name: "Inventário de novembro", unit_id: "u1", unit_name: "Unidade principal", scope: "all", scope_value: null, blind: true, status: "counting", notes: null,
  frozen_at: "2026-11-14T10:00:00Z", finished_at: null, approved_at: null, approve_note: null, canceled_at: null, cancel_reason: null, created_by_name: "Gestora", approved_by_name: null,
  lines_total: 2, lines_counted: 0, can_review: false, can_count: true, lines_with_difference: null, increase_cents: null, decrease_cents: null, ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: "ln1", item_id: "i1", item_name: "Ampola X", category: "amp", stock_unit: "ampola", fractional: false, ean: null, lot_id: "lot1", lot_code: "L1", expiry_date: "2999-01-01", is_extra: false,
  counted_qty: null, counted_at: null, counted_by_name: null, expected_qty: null, moved_qty: null, diff_qty: null, avg_cost_cents: null, diff_value_cents: null, adjust_movement_id: null, ...over,
});

beforeEach(() => {
  state.can = ESTOQUISTA; state.isAdmin = false; state.inventories = []; state.lines = []; state.transfers = []; state.alerts = null; state.report = null;
  [state.countMutate, state.finishMutate, state.approveMutate, state.receiveMutate, state.cancelTransferMutate].forEach((f) => f.mockReset());
});

describe("Estoque › Inventário (contagem cega)", () => {
  it("quem conta não vê esperado nem diferença: só item, lote e o campo de contagem; salva só o que digitou", async () => {
    state.inventories = [inv()];
    state.lines = [line(), line({ id: "ln2", item_id: "i2", item_name: "Seringa 5 ml", lot_code: "S1", stock_unit: "un" })];
    wrap(<StockInventoryTab />, "/?id=inv1");
    expect(await screen.findByText(/Contagem cega: o saldo esperado não aparece/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Itens do inventário" });
    expect(within(table).queryByText("Esperado")).toBeNull();
    expect(within(table).queryByText("Diferença")).toBeNull();
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Abrir inventário/ })).toBeNull();
    await userEvent.type(screen.getByLabelText(/Quantidade contada de Ampola X lote L1/), "7");
    await userEvent.click(screen.getByRole("button", { name: /Salvar contagem \(1\)/ }));
    expect(state.countMutate).toHaveBeenCalledWith({ inventoryId: "inv1", lines: [{ lineId: "ln1", countedQty: 7 }] }, expect.anything());
  });

  it("quantidade inválida bloqueia o salvamento com aviso (item inteiro não aceita fração)", async () => {
    state.inventories = [inv()];
    state.lines = [line()];
    wrap(<StockInventoryTab />, "/?id=inv1");
    await userEvent.type(await screen.findByLabelText(/Quantidade contada de Ampola X/), "2,5");
    await userEvent.click(screen.getByRole("button", { name: /Salvar contagem/ }));
    expect(await screen.findByText(/Corrija as quantidades marcadas/)).toBeInTheDocument();
    expect(state.countMutate).not.toHaveBeenCalled();
  });

  it("revisão do gestor: esperado × contado × diferença × valor, resumo e aprovar exige motivo", async () => {
    state.can = GESTOR;
    state.inventories = [inv({ status: "review", can_review: true, can_count: false, lines_counted: 2, lines_with_difference: 1 })];
    state.lines = [
      line({ counted_qty: 8, expected_qty: 10, moved_qty: 0, diff_qty: -2, avg_cost_cents: 4400, diff_value_cents: -8800 }),
      line({ id: "ln2", item_id: "i2", item_name: "Seringa 5 ml", lot_code: "S1", stock_unit: "un", counted_qty: 5, expected_qty: 5, moved_qty: 0, diff_qty: 0, avg_cost_cents: 100, diff_value_cents: 0 }),
    ];
    wrap(<StockInventoryTab />, "/?id=inv1");
    const table = await screen.findByRole("table", { name: "Itens do inventário" });
    expect(within(table).getByText("Esperado")).toBeInTheDocument();
    expect(within(table).getByText("Diferença")).toBeInTheDocument();
    expect(within(table).getByText(/−2 ampola/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Resumo das diferenças")).getByText(/1 de 2/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Resumo das diferenças")).getAllByText(/88,00/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /Aprovar e ajustar estoque/ }));
    await userEvent.click(screen.getByRole("button", { name: "Aprovar e lançar ajustes" }));
    expect(await screen.findByText(/Informe o motivo dos ajustes/)).toBeInTheDocument();
    expect(state.approveMutate).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Motivo dos ajustes/), "Contagem física de novembro");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar e lançar ajustes" }));
    expect(state.approveMutate).toHaveBeenCalledWith({ inventoryId: "inv1", note: "Contagem física de novembro" }, expect.anything());
  });

  it("estoquista na revisão: sem valores e sem aprovar; Financeiro consulta sem botões de ação", async () => {
    state.inventories = [inv({ status: "review", can_count: false, lines_counted: 2 })];
    state.lines = [line({ counted_qty: 8 })];
    wrap(<StockInventoryTab />, "/?id=inv1");
    expect(await screen.findByText(/A revisão das diferenças é do gestor/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
    expect(screen.queryByText("Esperado")).toBeNull();
  });

  it("lista: gestor vê «Abrir inventário»; Recepção só vê o aviso de acesso", () => {
    state.can = GESTOR;
    state.inventories = [inv({ status: "approved", can_review: true, can_count: false, lines_with_difference: 0, increase_cents: 0, decrease_cents: 0 })];
    const { unmount } = wrap(<StockInventoryTab />);
    expect(screen.getByRole("button", { name: /Abrir inventário/ })).toBeInTheDocument();
    expect(screen.getByText("Aprovado")).toBeInTheDocument();
    unmount();
    state.can = { units_read: true, sales_read: true, sales_write: true };
    wrap(<StockInventoryTab />);
    expect(screen.getByText(/O inventário é do administrador/)).toBeInTheDocument();
  });
});

const transfer = (over: Record<string, unknown> = {}) => ({
  id: "t1", number: 5, status: "in_transit", from_unit_id: "u1", from_unit_name: "Unidade principal", to_unit_id: "u2", to_unit_name: "Unidade 2", sent_at: "2026-11-13T12:00:00Z", sent_by_name: "Estoquista",
  received_at: null, received_by_name: null, canceled_at: null, cancel_reason: null, notes: null, receive_note: null, age_days: 1, stale: false, can_receive: true, can_cancel: true, lines_count: 1,
  sent_cents: 44000, received_cents: 0, loss_cents: 0,
  lines: [{ line_id: "tl1", item_id: "i1", item_name: "Ampola X", stock_unit: "ampola", lot_code: "L1", expiry_date: "2999-01-01", qty_sent: 10, qty_received: null, unit_cost_cents: 4400, total_cost_cents: 44000, received_cost_cents: null, loss_qty: null, loss_cents: null, receive_reason: null, dest_lot_code: null, dest_expiry_date: null }],
  ...over,
});

describe("Estoque › Transferências", () => {
  it("receber com quantidade a menos exige o motivo; igual ao enviado confirma direto", async () => {
    state.transfers = [transfer()];
    wrap(<StockTransfersTab />);
    await userEvent.click(screen.getByRole("button", { name: "Receber transferência 5" }));
    const qty = screen.getByLabelText("Quantidade recebida");
    await userEvent.clear(qty); await userEvent.type(qty, "8");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect(await screen.findByText("Divergência: informe o motivo.")).toBeInTheDocument();
    expect(state.receiveMutate).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Motivo da divergência"), "caixa avariada");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    await waitFor(() => expect(state.receiveMutate).toHaveBeenCalled());
    expect(state.receiveMutate.mock.calls[0][0]).toMatchObject({ transferId: "t1", lines: [{ lineId: "tl1", quantity: 8, reason: "caixa avariada" }] });
  });

  it("parada em trânsito é destacada; recebida mostra a diferença; Financeiro (consulta) não vê botões", () => {
    state.transfers = [transfer({ stale: true, age_days: 6 }), transfer({ id: "t2", number: 6, status: "received", can_receive: false, can_cancel: false, received_at: "2026-11-14T10:00:00Z", received_by_name: "Gestora", received_cents: 35200, loss_cents: 8800,
      lines: [{ ...transfer().lines[0], line_id: "tl2", qty_received: 8, loss_qty: 2, loss_cents: 8800, receive_reason: "avaria" }] })];
    state.can = { stock_items_read: true, stock_move_read: true, stock_move_write: false };
    wrap(<StockTransfersTab />);
    expect(screen.getByText("Parada há 6 dias")).toBeInTheDocument();
    expect(screen.getByText(/1 transferência está parada/)).toBeInTheDocument();
    expect(screen.getByText(/diferença 2.*avaria/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Receber transferência/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nova transferência/ })).toBeNull();
  });
});

describe("Estoque › Alertas", () => {
  it("lista cada tipo de alerta com ação que leva à tela que resolve; sem alerta mostra estado vazio", () => {
    state.alerts = {
      settings: { expiry_days: [90, 60, 30], idle_days: 90, transfer_days: 3 },
      counts: { below_min: 1, expiring: 1, expired: 1, shortfalls: 0, shortfalls_cents: 0, stale_transfers: 0, total: 3 },
      below_min: [{ item_id: "i1", item_name: "Ampola X", unit_id: "u1", unit_name: "Unidade principal", stock_unit: "ampola", qty_on_hand: 5, min_qty: 30, missing_qty: 25 }],
      expiring: [{ lot_id: "l1", item_id: "i1", item_name: "Toxina", unit_id: "u1", unit_name: "Unidade principal", stock_unit: "fr", lot_code: "T1", expiry_date: "2026-12-01", days_left: 17, window_days: 30, qty: 4, value_cents: 40000 }],
      expired: [{ lot_id: "l2", item_id: "i3", item_name: "Soro", unit_id: "u1", unit_name: "Unidade principal", stock_unit: "fr", lot_code: "S9", expiry_date: "2026-11-01", days_late: 13, qty: 2, value_cents: 1000 }],
      shortfalls: [], stale_transfers: [],
    };
    state.can = GESTOR;
    const { unmount } = wrap(<StockAlertsTab />);
    expect(screen.getByRole("region", { name: "Lotes vencidos" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Lotes vencendo" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Abaixo do mínimo" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Consumo sem saldo" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lançar entrada" })).toHaveAttribute("href", "/estoque/entradas");
    expect(screen.getByText("17 dias")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Janelas dos alertas/ })).toBeInTheDocument();
    unmount();
    state.alerts = { settings: { expiry_days: [90], idle_days: 90, transfer_days: 3 }, counts: { below_min: 0, expiring: 0, expired: 0, shortfalls: 0, shortfalls_cents: 0, stale_transfers: 0, total: 0 }, below_min: [], expiring: [], expired: [], shortfalls: [], stale_transfers: [] };
    state.can = ESTOQUISTA;
    wrap(<StockAlertsTab />);
    expect(screen.getByText("Nenhum alerta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Janelas dos alertas/ })).toBeNull();
  });
});

describe("Estoque › Relatórios", () => {
  it("mostra linhas, total do servidor e exportação; a soma das linhas bate com o total", () => {
    state.can = GESTOR;
    state.report = { report: "position", from: "2026-11-01", to: "2026-11-14", count: 2, truncated: false, totals: { value_cents: 150000 },
      rows: [{ ord: 1, item_name: "Ampola X", category: "amp", item_type: "medication", unit_name: "Unidade principal", stock_unit: "ampola", qty: 10, avg_cost_cents: 10000, value_cents: 100000 },
             { ord: 2, item_name: "Seringa", category: "mat", item_type: "consumable", unit_name: "Unidade principal", stock_unit: "un", qty: 500, avg_cost_cents: 100, value_cents: 50000 }] };
    wrap(<StockReportsTab />);
    const totals = screen.getByLabelText("Totais");
    expect(within(totals).getByText(/1\.500,00/)).toBeInTheDocument();
    expect(within(totals).getByText("2")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Posição e valor do estoque" });
    expect(within(table).getByText("Ampola X")).toBeInTheDocument();
    expect(within(table).getByText(/1\.000,00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CSV/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Excel/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeEnabled();
  });

  it("aviso quando o relatório passa do limite da tela; Recepção sem acesso", () => {
    state.can = GESTOR;
    state.report = { report: "position", from: "2026-11-01", to: "2026-11-14", count: 2500, truncated: true, totals: { value_cents: 1 }, rows: [] };
    const { unmount } = wrap(<StockReportsTab />);
    expect(screen.getByText(/O relatório tem 2500 linhas/)).toBeInTheDocument();
    unmount();
    state.can = { units_read: true };
    wrap(<StockReportsTab />);
    expect(screen.getByText(/Os relatórios de estoque são do administrador/)).toBeInTheDocument();
  });
});
