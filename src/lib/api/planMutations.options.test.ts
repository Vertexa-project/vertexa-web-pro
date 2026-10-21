import { describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
import { saveNutritionPlan } from "./planMutations";

describe("saveNutritionPlan envia as opções de troca", () => {
  it("inclui options em cada refeição (vazio quando não há)", async () => {
    await saveNutritionPlan({ patientId: "p", professionalId: null, title: "T", meals: [
      { time: "09:00", name: "Café", items: ["a"], calories: 300, options: [{ items: ["b"], calories: 310 }] },
      { time: "12:00", name: "Almoço", items: ["c"], calories: 500 },
    ] });
    const meals = (rpc.mock.calls[0] as unknown as [string, { p_meals: { options: unknown[] }[] }])[1].p_meals;
    expect(meals[0].options).toEqual([{ items: ["b"], calories: 310 }]);
    expect(meals[1].options).toEqual([]);
  });
});
