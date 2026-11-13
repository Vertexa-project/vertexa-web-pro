import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { MovementTable } from "./MovementTable";
import { PatientReturnDialog } from "./PatientReturnDialog";
import { StockShortfallsTab } from "./StockShortfallsTab";
import type { MovementRow } from "@/lib/api/stockMoves";
import type { ShortfallRow } from "@/lib/api/finAppointments";

const state = vi.hoisted(() => ({ can: {} as Record<string, boolean>, rows: [] as unknown[], resolveMutate: vi.fn(), returnMutate: vi.fn(), listArgs: [] as unknown[] }));

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: false, roles: [], can: state.can } }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal", is_active: true, is_primary: true }] }),
}));
vi.mock("@/hooks/useFinAppointments", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() });
  return {
    useShortfalls: (_c: unknown, f: unknown) => { state.listArgs.push(f); return q(state.rows); },
    useResolveShortfall: () => ({ mutate: state.resolveMutate, isPending: false }),
    useReturnFromPatient: () => ({ mutate: state.returnMutate, isPending: false }),
  };
});

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const RW = { stock_items_read: true, stock_move_read: true, stock_move_write: true };
const RO = { stock_items_read: true, stock_move_read: true, stock_move_write: false };
const sf = (over: Partial<ShortfallRow> = {}): ShortfallRow => ({
  id: "s1", created_at: "2026-11-13T10:00:00Z", occurred_on: "2026-11-10", unit_id: "u1", unit_name: "Unidade principal", item_id: "i1", item_name: "Seringa D", stock_unit: "un", qty: 6, est_cost_cents: 600,
  appointment_id: "a1", service_name: "Aplicação GLP-1", patient_name: "Mariana Teste", status: "open", resolution: null, resolve_reason: null, resolved_at: null, ...over,
});

beforeEach(() => { state.can = RW; state.rows = []; state.listArgs = []; state.resolveMutate.mockReset(); state.returnMutate.mockReset(); });

describe("Estoque › Consumo sem saldo (E3)", () => {
  it("alerta ao gestor com o total em aberto e a lista com o atendimento, a falta (6 un) e o custo estimado R$ 6,00", () => {
    state.rows = [sf()];
    wrap(<StockShortfallsTab />);
    expect(screen.getByRole("alert")).toHaveTextContent(/1 baixa de atendimento sem saldo para regularizar/);
    const table = screen.getByRole("table", { name: "Consumo sem saldo" });
    expect(within(table).getByText("Seringa D")).toBeInTheDocument();
    expect(within(table).getByText("6 un")).toBeInTheDocument();
    expect(within(table).getByText(/R\$\s*6,00/)).toBeInTheDocument();
    expect(within(table).getByText(/Aplicação GLP-1 · Mariana Teste · 10\/11\/2026/)).toBeInTheDocument();
  });

  it("baixa retroativa exige a referência da entrada e então resolve; vale a data do atendimento", async () => {
    const user = userEvent.setup();
    state.rows = [sf()];
    wrap(<StockShortfallsTab />);
    await user.click(screen.getByRole("button", { name: "Dar baixa retroativa de Seringa D" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/leva a data do atendimento \(10\/11\/2026\)/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Dar baixa" }));
    expect(within(dialog).getByText(/Informe o motivo/)).toBeInTheDocument();
    expect(state.resolveMutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Referência da entrada/), "NF-D2 lançada");
    await user.click(within(dialog).getByRole("button", { name: "Dar baixa" }));
    expect(state.resolveMutate.mock.calls[0][0]).toEqual({ id: "s1", mode: "retro", reason: "NF-D2 lançada" });
  });

  it("resolver por ajuste manda o modo «adjust»", async () => {
    const user = userEvent.setup();
    state.rows = [sf()];
    wrap(<StockShortfallsTab />);
    await user.click(screen.getByRole("button", { name: "Resolver por ajuste Seringa D" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Como foi regularizado/), "Inventário de novembro");
    await user.click(within(dialog).getByRole("button", { name: "Resolver" }));
    expect(state.resolveMutate.mock.calls[0][0]).toEqual({ id: "s1", mode: "adjust", reason: "Inventário de novembro" });
  });

  it("Financeiro (consulta) vê a lista mas não resolve; resolvidos mostram como foram resolvidos", () => {
    state.can = RO;
    state.rows = [sf(), sf({ id: "s2", status: "resolved", resolution: "retro_entry", resolve_reason: "NF-D2" })];
    wrap(<StockShortfallsTab />);
    expect(screen.queryByRole("button", { name: /Dar baixa/ })).toBeNull();
    expect(screen.getByText(/Baixa retroativa — NF-D2/)).toBeInTheDocument();
  });

  it("Recepção/profissional (sem papel de estoque): só o aviso de acesso", () => {
    state.can = { sales_read: true };
    wrap(<StockShortfallsTab />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/administrador, do gestor, do estoquista e do financeiro/);
  });

  it("nada em aberto: estado vazio", () => {
    wrap(<StockShortfallsTab />);
    expect(screen.getByText("Nada em aberto")).toBeInTheDocument();
  });
});

const mv = (over: Partial<MovementRow> = {}): MovementRow => ({
  id: "m1", occurred_on: "2026-11-13", created_at: "2026-11-13T10:00:00Z", unit_id: "u1", unit_name: "Unidade principal", item_id: "i1", item_name: "Suplemento C", stock_unit: "un", movement_type: "sale", qty: -2,
  unit_cost_cents: 6000, total_cost_cents: -12000, balance_after: 8, avg_cost_after_cents: 6000, lot_code: "SEM LOTE", expiry_date: null, reason: null, purpose: null, loss_kind: null, patient_name: "Mariana Teste",
  user_name: null, supplier_name: null, invoice_number: null, entry_id: null, sale_id: "v1", reversed: false, reversal_of: null, ...over,
});

describe("Kardex: devolução de paciente e estorno", () => {
  it("venda e entrega de pacote oferecem «Devolução de paciente»; entrega, devolução e venda NÃO oferecem «Estornar»", () => {
    const onReverse = vi.fn(), onReturn = vi.fn();
    wrap(<MovementTable label="Kardex" rows={[mv(), mv({ id: "m2", movement_type: "package_delivery", qty: -1 }), mv({ id: "m3", movement_type: "patient_return", qty: 1 }), mv({ id: "m4", movement_type: "sector", qty: -1 })]} onReverse={onReverse} onReturn={onReturn} />);
    expect(screen.getAllByRole("button", { name: /Devolução de paciente/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Estornar/ })).toHaveLength(1);   // só o consumo de setor
  });

  it("movimentação já estornada não oferece nenhuma ação", () => {
    wrap(<MovementTable label="Kardex" rows={[mv({ reversed: true })]} onReverse={vi.fn()} onReturn={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Financeiro (consulta) não recebe os botões (as ações nem são passadas)", () => {
    wrap(<MovementTable label="Kardex" rows={[mv()]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Devolução de paciente", () => {
  const target = { movementId: "m1", itemName: "Suplemento C", qtyOut: 2, stockUnit: "un", origin: "Venda" as const };
  it("exige motivo, não deixa devolver mais do que saiu e manda a devolução parcial (1 de 2)", async () => {
    const user = userEvent.setup();
    wrap(<PatientReturnDialog target={target} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const qty = within(dialog).getByLabelText(/Quantidade devolvida/);
    await user.clear(qty); await user.type(qty, "3");
    await user.type(within(dialog).getByLabelText("Motivo"), "Não gostou");
    await user.click(within(dialog).getByRole("button", { name: "Registrar devolução" }));
    expect(within(dialog).getByText(/mais do que saiu \(2\)/)).toBeInTheDocument();
    await user.clear(qty); await user.type(qty, "1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar devolução" }));
    expect(state.returnMutate.mock.calls[0][0]).toEqual({ movementId: "m1", qty: 1, reason: "Não gostou" });
  });
  it("sem motivo não envia", async () => {
    const user = userEvent.setup();
    wrap(<PatientReturnDialog target={target} onClose={() => {}} />);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar devolução" }));
    expect(screen.getByText("Informe o motivo da devolução.")).toBeInTheDocument();
    expect(state.returnMutate).not.toHaveBeenCalled();
  });
});
