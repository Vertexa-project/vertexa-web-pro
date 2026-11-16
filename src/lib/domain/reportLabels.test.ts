import { describe, expect, it } from "vitest";

import { vriLevelShortLabel } from "./vri";
import { isRemovedPatientProfile } from "./patientDeletion";
import { muscleGroupLabelSafe, muscleStatusLabelSafe, weightSourceLabel } from "./reportLabels";

describe("rótulos pt-BR de enums crus", () => {
  it("grupo e estado muscular; desconhecido nunca vaza em inglês", () => {
    expect(muscleGroupLabelSafe("abs")).toBe("Abdômen");
    expect(muscleGroupLabelSafe("biceps")).toBe("Bíceps");
    expect(muscleGroupLabelSafe("unknown_group")).toBe("—");
    // grupo principal digitado em português pelo profissional (achado D59)
    expect(muscleGroupLabelSafe("peito")).toBe("Peito");
    expect(muscleGroupLabelSafe("braços")).toBe("Braços");
    expect(muscleStatusLabelSafe("weakened")).toBe("Enfraquecido");
    expect(muscleStatusLabelSafe("zzz")).toBe("—");
    expect(weightSourceLabel("app")).toBe("App do paciente");
    expect(vriLevelShortLabel("risco")).toBe("Em risco");
    expect(vriLevelShortLabel("high")).toBe("—");
  });
});

describe("paciente removido (exclusão de conta)", () => {
  it("reconhece o perfil anonimizado pela migration", () => {
    expect(isRemovedPatientProfile({ full_name: "Paciente removido", status: "inactive" })).toBe(true);
    expect(isRemovedPatientProfile({ full_name: "Ana", status: "inactive" })).toBe(true);
    expect(isRemovedPatientProfile({ full_name: "Ana", status: "active" })).toBe(false);
    expect(isRemovedPatientProfile(null)).toBe(false);
  });
});
