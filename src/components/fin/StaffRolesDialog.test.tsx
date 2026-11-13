import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StaffRolesCell } from "./StaffRolesDialog";

const state = vi.hoisted(() => ({
  roles: [] as { id: string; professional_id: string; role: string; all_units: boolean; unit_ids: string[] }[],
  units: [{ id: "u1", name: "Unidade principal", is_active: true }, { id: "u2", name: "Filial", is_active: true }],
}));
const mutate = vi.hoisted(() => vi.fn((_v: unknown, o?: { onSuccess?: () => void }) => o?.onSuccess?.()));

vi.mock("@/hooks/useFin", () => ({
  useStaffRoles: () => ({ data: state.roles }),
  useUnits: () => ({ data: state.units }),
  useSetStaffRoles: () => ({ mutate, isPending: false }),
}));

describe("papéis do Financeiro/Estoque na Equipe", () => {
  beforeEach(() => { state.roles = []; mutate.mockClear(); });

  it("sem papel adicional: mostra o aviso e o botão só para o admin", () => {
    const { rerender } = render(<StaffRolesCell clinicId="c" professionalId="p1" name="Bia" canEdit />);
    expect(screen.getByText("Sem papel adicional")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Papéis financeiros de Bia/ })).toBeInTheDocument();
    rerender(<StaffRolesCell clinicId="c" professionalId="p1" name="Bia" canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Papéis financeiros/ })).toBeNull();
  });

  it("mostra só os papéis do próprio membro, com a quantidade de unidades quando limitado", () => {
    state.roles = [
      { id: "r1", professional_id: "p1", role: "financeiro", all_units: true, unit_ids: [] },
      { id: "r2", professional_id: "p1", role: "estoquista", all_units: false, unit_ids: ["u2"] },
      { id: "r3", professional_id: "outro", role: "gestor", all_units: true, unit_ids: [] },
    ];
    render(<StaffRolesCell clinicId="c" professionalId="p1" name="Bia" canEdit />);
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    expect(screen.getByText(/Estoquista · 1 un\./)).toBeInTheDocument();
    expect(screen.queryByText("Gestor")).toBeNull();
  });

  it("o admin atribui Recepção para todas as unidades e salva", async () => {
    const user = userEvent.setup();
    render(<StaffRolesCell clinicId="c" professionalId="p1" name="Bia" canEdit />);
    await user.click(screen.getByRole("button", { name: /Papéis financeiros de Bia/ }));
    await user.click(screen.getByLabelText("Recepção"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ professionalId: "p1", reason: undefined, roles: [{ role: "recepcao", allUnits: true, unitIds: [] }] });
  });

  it("papel limitado a unidades exige ao menos uma unidade", async () => {
    const user = userEvent.setup();
    render(<StaffRolesCell clinicId="c" professionalId="p1" name="Bia" canEdit />);
    await user.click(screen.getByRole("button", { name: /Papéis financeiros de Bia/ }));
    await user.click(screen.getByLabelText("Gestor"));
    await user.click(screen.getByLabelText("Todas as unidades"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/ao menos uma unidade/);
    await user.click(screen.getByLabelText("Filial"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutate.mock.calls[0][0]).toMatchObject({ roles: [{ role: "gestor", allUnits: false, unitIds: ["u2"] }] });
  });
});
