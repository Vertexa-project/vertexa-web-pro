import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const plan = vi.hoisted(() => ({ data: null as unknown, canNutri: true }));
vi.mock("./docimport/DocImportSection", () => ({ DocImportSection: () => null })); // importação com Conferência tem teste próprio
vi.mock("@/hooks/usePlans", () => ({ useNutritionPlan: () => ({ data: plan.data, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditNutrition: plan.canNutri, canEditWorkout: false } }) }));
vi.mock("./NutritionPlanEditor", () => ({ NutritionPlanEditor: () => null }));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pr1" } }), useCurrentProfessionalName: () => ({ data: "Ana Nutri" }) }));
vi.mock("./SendToPatientDialog", () => ({ SendToPatientDialog: (p: { open: boolean; kind: string; planTitle: string }) => (p.open ? <p>dialogo enviar {p.kind} {p.planTitle}</p> : null) }));

import { NutritionTab } from "./NutritionTab";

describe("NutritionTab — vírgula decimal (D57)", () => {
  it("kcal decimal sai com vírgula", () => {
    plan.data = { id: "n", title: "Plano", status: "active", meals: [{ id: "m", time: "08:00", name: "Café", calories: 350.5, options: null, foods: null, order_index: 1 }] };
    render(<NutritionTab patient={{ id: "p" } as never} />);
    expect(screen.getAllByText(/350,5 kcal/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\d\.\d+ kcal/);
  });

  it("Enviar ao paciente: nutricionista abre o envio do plano alimentar; sem a disciplina fica bloqueado com o motivo", () => {
    plan.data = { id: "n", title: "Plano de teste (QA)", status: "active", meals: [] };
    plan.canNutri = true;
    const { unmount } = render(<NutritionTab patient={{ id: "p" } as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao paciente/ }));
    expect(screen.getByText("dialogo enviar plano_alimentar Plano de teste (QA)")).toBeInTheDocument();
    unmount();
    plan.canNutri = false;
    render(<NutritionTab patient={{ id: "p" } as never} />);
    const b = screen.getByRole("button", { name: /Enviar ao paciente/ });
    expect(b).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(b);
    expect(screen.queryByText(/dialogo enviar/)).toBeNull();
    expect(screen.getAllByText("Requer a disciplina Nutricionista.").length).toBeGreaterThan(0);
    plan.canNutri = true;
  });
});
