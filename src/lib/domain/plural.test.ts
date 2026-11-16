import { describe, expect, it } from "vitest";
import { patientTeamTitle, plural, streakLabel } from "./plural";

describe("streakLabel", () => {
  it("0 => 'Sem sequência'; 1 => '1 dia'; N => 'N dias'", () => {
    expect(streakLabel(0)).toBe("Sem sequência");
    expect(streakLabel(1)).toBe("1 dia");
    expect(streakLabel(5)).toBe("5 dias");
    expect(streakLabel(null)).toBe("—");
  });
});
describe("plural / patientTeamTitle", () => {
  it("concorda no singular", () => {
    expect(plural(1, "ativo")).toBe("1 ativo");
    expect(plural(2, "ativo")).toBe("2 ativos");
    expect(plural(2, "avaliação", "avaliações")).toBe("2 avaliações");
  });
  it("título neutro para paciente homem; 'da paciente' só no feminino", () => {
    expect(patientTeamTitle("masculino")).toBe("Equipe do paciente");
    expect(patientTeamTitle(null)).toBe("Equipe do paciente");
    expect(patientTeamTitle("feminino")).toBe("Equipe da paciente");
  });
});
