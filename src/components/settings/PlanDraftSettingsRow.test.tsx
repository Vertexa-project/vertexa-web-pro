import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ save: vi.fn(), config: null as unknown }));
vi.mock("@/hooks/usePlanDrafts", () => ({
  usePlanDraftConfig: () => ({ data: h.config }),
  useSavePlanDraftConfig: () => ({ mutate: (v: unknown, o: { onSuccess?: () => void }) => { h.save(v); o.onSuccess?.(); }, isPending: false }),
}));
import { PlanDraftSettingsRow } from "./PlanDraftSettingsRow";

beforeEach(() => { h.save.mockClear(); h.config = null; });

describe("Configurações > Tipos de paciente (Vertexa IA)", () => {
  it("sem configuração mostra a lista padrão; salvar grava lista e métodos", () => {
    render(<PlanDraftSettingsRow clinicId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar tipos e método" }));
    expect(screen.getAllByTestId("patient-type-row").length).toBe(8);
    fireEvent.change(screen.getByLabelText("Nome do tipo 1"), { target: { value: "Emagrecimento (método Juliana)" } });
    fireEvent.change(screen.getByLabelText(/Método da clínica — dieta/), { target: { value: "5 refeições" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const arg = h.save.mock.calls[0][0];
    expect(arg.patient_types[0]).toMatchObject({ key: "emagrecimento", label: "Emagrecimento (método Juliana)", base: "emagrecimento" });
    expect(arg.patient_types.length).toBe(8);
    expect(arg.method_dieta).toBe("5 refeições"); expect(arg.method_treino).toBeNull();
  });
  it("adicionar tipo novo com nome vazio não salva; com nome salva com chave válida", () => {
    h.config = { patient_types: [{ key: "a1", label: "Tipo A", base: "retomada" }], method_dieta: null, method_treino: null };
    render(<PlanDraftSettingsRow clinicId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar tipos e método" }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar tipo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("pelo menos 2 letras"); expect(h.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nome do tipo 2"), { target: { value: "Gestante" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(h.save.mock.calls[0][0].patient_types.map((t: { key: string }) => t.key)).toEqual(["a1", "novo_tipo_2"]);
  });
  it("restaurar lista padrão", () => {
    h.config = { patient_types: [{ key: "a1", label: "Tipo A", base: "retomada" }], method_dieta: null, method_treino: null };
    render(<PlanDraftSettingsRow clinicId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar tipos e método" }));
    expect(screen.getAllByTestId("patient-type-row").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Restaurar lista padrão" }));
    expect(screen.getAllByTestId("patient-type-row").length).toBe(8);
  });
});
