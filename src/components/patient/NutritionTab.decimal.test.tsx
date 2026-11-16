import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const plan = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("./docimport/DocImportSection", () => ({ DocImportSection: () => null })); // importação com Conferência tem teste próprio
vi.mock("@/hooks/usePlans", () => ({ useNutritionPlan: () => ({ data: plan.data, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditNutrition: true } }) }));
vi.mock("./NutritionPlanEditor", () => ({ NutritionPlanEditor: () => null }));

import { NutritionTab } from "./NutritionTab";

describe("NutritionTab — vírgula decimal (D57)", () => {
  it("kcal decimal sai com vírgula", () => {
    plan.data = { id: "n", title: "Plano", status: "active", meals: [{ id: "m", time: "08:00", name: "Café", calories: 350.5, options: null, foods: null, order_index: 1 }] };
    render(<NutritionTab patient={{ id: "p" } as never} />);
    expect(screen.getAllByText(/350,5 kcal/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\d\.\d+ kcal/);
  });
});
