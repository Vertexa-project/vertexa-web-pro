import { describe, expect, it } from "vitest";
import { activityEventDescription, activityEventMeta } from "./activityEvents";

describe("esforço percebido do treino (PDF do Ernâni, tela 23)", () => {
  it("tem rótulo próprio, não o genérico 'workout effort'", () => {
    expect(activityEventMeta("workout_effort").label).toBe("Esforço do treino");
  });
  it("descreve '7 de 10' e ignora valor fora de 1–10 ou não inteiro", () => {
    expect(activityEventDescription("workout_effort", { effort: 7 })).toBe("7 de 10");
    expect(activityEventDescription("workout_effort", { effort: "9" })).toBe("9 de 10");
    for (const bad of [0, 11, 5.5, null, "x"]) expect(activityEventDescription("workout_effort", { effort: bad })).toBeNull();
  });
  it("não muda os tipos que já existiam", () => {
    expect(activityEventMeta("workout_checked").label).toBe("Treino concluído");
    expect(activityEventDescription("hydration_logged", { liters: 0.25 })).toBe("0.25 L");
  });
});
