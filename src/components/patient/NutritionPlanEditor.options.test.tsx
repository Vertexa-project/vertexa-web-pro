import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/hooks/usePlanMutations", () => ({ useSaveNutritionPlan: () => ({ mutate: m.mutate, isPending: false }) }));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditNutrition: true } }) }));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

import { NutritionPlanEditor } from "./NutritionPlanEditor";
import type { NutritionPlanFull, PatientDetail } from "@/types/db";

const patient = { id: "p1", professionals: [{ id: "pr1" }] } as unknown as PatientDetail;
const existing = {
  id: "np1", patient_id: "p1", title: "Plano", status: "active",
  meals: [{ id: "m1", nutrition_plan_id: "np1", time: "09:00", name: "Café", items: ["Leite 200 mL"], calories: 325, order_index: 1,
    options: [{ items: ["Pão 2 fatias", "Ovos 2"], calories: 330 }] }],
} as unknown as NutritionPlanFull;

beforeEach(() => m.mutate.mockClear());
const open = () => render(<NutritionPlanEditor patient={patient} existing={existing} open onOpenChange={() => {}} />);

describe("editor do plano alimentar — opções de troca (PDF do Ernâni, tela 19)", () => {
  it("mostra as opções existentes como 'Opção 2…' e envia no salvar, com itens aparados", async () => {
    open();
    expect(screen.getByLabelText("Itens da opção 2")).toHaveValue("Pão 2 fatias\nOvos 2");
    fireEvent.click(screen.getByText("Salvar plano"));
    await waitFor(() => expect(m.mutate).toHaveBeenCalled());
    expect(m.mutate.mock.calls[0][0].meals[0].options).toEqual([{ items: ["Pão 2 fatias", "Ovos 2"], calories: 330 }]);
  });
  it("adiciona uma opção, e a opção sem itens não é enviada", async () => {
    open();
    fireEvent.click(screen.getByText("Adicionar opção de troca"));
    expect(screen.getAllByTestId("meal-option")).toHaveLength(2);
    fireEvent.click(screen.getByText("Salvar plano"));
    await waitFor(() => expect(m.mutate).toHaveBeenCalled());
    expect(m.mutate.mock.calls[0][0].meals[0].options).toHaveLength(1);
  });
  it("remove uma opção", async () => {
    open();
    fireEvent.click(screen.getByLabelText("Remover opção 2"));
    fireEvent.click(screen.getByText("Salvar plano"));
    await waitFor(() => expect(m.mutate).toHaveBeenCalled());
    expect(m.mutate.mock.calls[0][0].meals[0].options).toEqual([]);
  });
  it("para de oferecer 'Adicionar' ao chegar em 5 alternativas", () => {
    open();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText("Adicionar opção de troca"));
    expect(screen.getAllByTestId("meal-option")).toHaveLength(5);
    expect(screen.queryByText("Adicionar opção de troca")).toBeNull();
  });
  it("avisa quando a kcal da opção foge mais de 15% da refeição", () => {
    open();
    fireEvent.change(screen.getByLabelText("Calorias da opção 2"), { target: { value: "500" } });
    expect(screen.getByRole("note")).toHaveTextContent("54% de diferença");
  });
});
