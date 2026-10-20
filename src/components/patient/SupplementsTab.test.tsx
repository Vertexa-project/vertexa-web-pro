import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: [] as unknown[], perms: { canEditSupplements: true, canEditMedications: false } }));
vi.mock("@/hooks/useSupplements", () => ({
  usePatientSupplements: () => ({ data: h.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useDeleteSupplement: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSupplement: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSupplement: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: h.perms }) }));
const { SupplementsTab } = await import("./SupplementsTab");

const S = (id: string, name: string, o: Record<string, unknown> = {}) => ({ id, patient_id: "p1", name, dose: null, time_label: null, order_index: 0, created_at: "", kind: "supplement", brand: null, notes: null, reminder_time: null, ...o });
const patient = { id: "p1" } as never;
beforeEach(() => { h.data = []; h.perms.canEditSupplements = true; h.perms.canEditMedications = false; });

describe("SupplementsTab", () => {
  it("separa suplementos e medicamentos e mostra marca e lembrete", () => {
    h.data = [S("a", "Creatina", { brand: "Marca X", reminder_time: "18:30:00", dose: "5 g" }), S("b", "Losartana", { kind: "medication", reminder_time: "08:00:00" })];
    render(<SupplementsTab patient={patient} />);
    const supp = screen.getByRole("region", { name: "Suplementos" });
    const med = screen.getByRole("region", { name: "Medicamentos" });
    expect(within(supp).getByText("Creatina")).toBeTruthy();
    expect(within(supp).getByText(/Marca: Marca X/)).toBeTruthy();
    expect(within(supp).getByText(/Lembrete 18:30/)).toBeTruthy();
    expect(within(med).getByText("Losartana")).toBeTruthy();
    expect(within(med).getByText(/Lembrete 08:00/)).toBeTruthy();
  });
  it("itens antigos (sem kind) aparecem como suplemento", () => {
    h.data = [{ ...S("a", "Whey"), kind: undefined }];
    render(<SupplementsTab patient={patient} />);
    expect(within(screen.getByRole("region", { name: "Suplementos" })).getByText("Whey")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Medicamentos" })).toBeNull();
  });
  it("nutricionista edita suplemento mas NÃO medicamento (sem botões de editar/excluir)", () => {
    h.data = [S("a", "Creatina"), S("b", "Losartana", { kind: "medication" })];
    render(<SupplementsTab patient={patient} />);
    expect(screen.getByRole("button", { name: "Editar Creatina" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar Losartana" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir Losartana" })).toBeNull();
    expect(screen.getByText(/só podem ser prescritos por quem tem a disciplina Médico/)).toBeTruthy();
  });
  it("médico edita medicamento mas não suplemento", () => {
    h.perms.canEditSupplements = false;
    h.perms.canEditMedications = true;
    h.data = [S("a", "Creatina"), S("b", "Losartana", { kind: "medication" })];
    render(<SupplementsTab patient={patient} />);
    expect(screen.getByRole("button", { name: "Editar Losartana" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar Creatina" })).toBeNull();
  });
});
