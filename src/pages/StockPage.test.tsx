import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { StockPage } from "./StockPage";

const state = vi.hoisted(() => ({ canWrite: true, canRead: true, items: [] as unknown[] }));
const mutate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({
    clinicId: "c1", isLoading: false,
    access: { isAdmin: false, roles: [], can: { stock_items_read: state.canRead, stock_items_write: state.canWrite } },
  }),
  useStockItems: () => ({ data: state.items, isLoading: false, isError: false, refetch: vi.fn() }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal", is_active: true }] }),
  useSaveStockItem: () => ({ mutate, isPending: false }),
}));

const open = async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><StockPage /></MemoryRouter>);
  await user.click(screen.getAllByRole("button", { name: /Novo item/ })[0]);
  return user;
};

describe("Estoque › Itens", () => {
  beforeEach(() => { state.canWrite = true; state.canRead = true; state.items = []; mutate.mockClear(); });

  it("sem itens: estado vazio com chamada para cadastrar", () => {
    render(<MemoryRouter><StockPage /></MemoryRouter>);
    expect(screen.getByText("Nenhum item cadastrado")).toBeInTheDocument();
  });

  it("sem papel de estoque: aviso de acesso, sem botão de novo item", () => {
    state.canRead = false;
    state.canWrite = false;
    render(<MemoryRouter><StockPage /></MemoryRouter>);
    expect(screen.getByText(/O estoque é do administrador/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo item/ })).toBeNull();
  });

  it("financeiro (consulta): vê a lista, mas não o botão de novo item", () => {
    state.canWrite = false;
    render(<MemoryRouter><StockPage /></MemoryRouter>);
    expect(screen.getByText(/Consulta: você vê os itens/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo item/ })).toBeNull();
  });

  it("medicação aplicada: lote travado ligado, venda travada desligada, uso individual marcado", async () => {
    const user = await open();
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Tipo"), "medication");
    const lot = screen.getByLabelText("Controla lote e validade") as HTMLInputElement;
    const sell = screen.getByLabelText("Venda ao paciente") as HTMLInputElement;
    expect(lot.checked).toBe(true);
    expect(lot.disabled).toBe(true);
    expect(sell.checked).toBe(false);
    expect(sell.disabled).toBe(true);
    expect((screen.getByLabelText("Uso individual por paciente") as HTMLInputElement).checked).toBe(true);
  });

  it("produto de revenda: venda fixa ligada e preço de venda obrigatório", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Nome"), "Creme");
    await user.type(screen.getByLabelText("Categoria"), "Revenda");
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Tipo"), "resale");
    expect((screen.getByLabelText("Venda ao paciente") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Informe o preço de venda.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Preço de venda/), "89,90");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ itemType: "resale", sellable: true, salePriceCents: 8990, controlled: false });
  });

  it("E8: tentar marcar «Controlado (Portaria 344)» mostra o aviso e não marca", async () => {
    const user = await open();
    const box = screen.getByLabelText("Controlado (Portaria 344)") as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(/Portaria 344/);
  });

  it("uso fracionado pede a validade após aberto", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Nome"), "Frasco");
    await user.type(screen.getByLabelText("Categoria"), "Consumo");
    await user.click(screen.getByLabelText("Uso fracionado"));
    const open_ = screen.getByLabelText("Validade após aberto (dias)");
    await user.clear(open_);
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Uso fracionado precisa da validade após aberto, em dias.")).toBeInTheDocument();
  });
});
