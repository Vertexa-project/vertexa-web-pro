import { describe, expect, it } from "vitest";
import { formatReps, validateRepsInput, visibleColumns } from "./workoutDisplay";

describe("formatReps", () => {
  it("inteiro válido e faixa com hífen", () => {
    expect(formatReps(12)).toBe("12");
    expect(formatReps("8-12")).toBe("8-12");
    expect(formatReps("8 – 12")).toBe("8-12");
  });
  it("negativo, zero, faixa invertida e lixo => null (antes: '4 × -35')", () => {
    for (const bad of [-35, 0, 1.5, "-35", "12-8", "abc", null, undefined, ""]) expect(formatReps(bad as never)).toBeNull();
  });
});
describe("validateRepsInput", () => {
  it("bloqueia negativo", () => {
    expect(validateRepsInput("-35")).not.toBeNull();
    expect(validateRepsInput("")).toBeNull();
    expect(validateRepsInput("10")).toBeNull();
  });
});
describe("visibleColumns", () => {
  it("esconde Carga/Grupos quando nenhuma linha tem dado", () => {
    expect(visibleColumns([{ load_kg: null, muscle_groups: null }, { load_kg: 0, muscle_groups: [] }])).toEqual({ load: false, groups: false });
    expect(visibleColumns([{ load_kg: 20, muscle_groups: ["chest"] }, { load_kg: null, muscle_groups: null }])).toEqual({ load: true, groups: true });
  });
});
