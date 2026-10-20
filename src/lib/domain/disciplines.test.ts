import { describe, expect, it } from "vitest";

import {
  canWriteSurface,
  derivePermissions,
  DISCIPLINE_WRITE_MAP,
  isDisciplineDenied,
  WriteForbiddenError,
} from "./disciplines";

describe("derivePermissions — UNIÃO das disciplinas (nunca interseção; nunca de type)", () => {
  it("1 disciplina — nutricionista: dieta/suplementos/avaliação SIM, treino NÃO", () => {
    expect(derivePermissions(["nutricionista"])).toEqual({
      canEditNutrition: true,
      canEditSupplements: true,
      canEditMedications: false,
      canEditWorkout: false,
      canEditBodyAssessment: true,
    });
  });

  it("1 disciplina — educador_fisico: treino SIM, dieta NÃO", () => {
    const p = derivePermissions(["educador_fisico"]);
    expect(p.canEditWorkout).toBe(true);
    expect(p.canEditNutrition).toBe(false);
    expect(p.canEditSupplements).toBe(false);
    expect(p.canEditBodyAssessment).toBe(true);
  });

  it("1 disciplina — fisioterapeuta: treino SIM, dieta NÃO", () => {
    const p = derivePermissions(["fisioterapeuta"]);
    expect(p.canEditWorkout).toBe(true);
    expect(p.canEditNutrition).toBe(false);
    expect(p.canEditBodyAssessment).toBe(true);
  });

  it("1 disciplina — medico: avaliação corporal e medicamentos (não suplementos)", () => {
    expect(derivePermissions(["medico"])).toEqual({
      canEditNutrition: false,
      canEditSupplements: false,
      canEditMedications: true,
      canEditWorkout: false,
      canEditBodyAssessment: true,
    });
  });

  it("2 disciplinas — medico+nutricionista: dieta/suplementos/avaliação SIM, treino NÃO", () => {
    expect(derivePermissions(["medico", "nutricionista"])).toEqual({
      canEditNutrition: true,
      canEditSupplements: true,
      canEditMedications: true,
      canEditWorkout: false,
      canEditBodyAssessment: true,
    });
  });

  it("2 disciplinas — fisioterapeuta+nutricionista: treino E dieta", () => {
    const p = derivePermissions(["fisioterapeuta", "nutricionista"]);
    expect(p.canEditWorkout).toBe(true);
    expect(p.canEditNutrition).toBe(true);
  });

  it("3 disciplinas — medico+nutricionista+educador_fisico: TODAS as superfícies", () => {
    expect(derivePermissions(["medico", "nutricionista", "educador_fisico"])).toEqual({
      canEditNutrition: true,
      canEditSupplements: true,
      canEditMedications: true,
      canEditWorkout: true,
      canEditBodyAssessment: true,
    });
  });

  it("nenhuma disciplina: nada escopado (lê tudo, mas não escreve)", () => {
    expect(derivePermissions([])).toEqual({
      canEditNutrition: false,
      canEditSupplements: false,
      canEditMedications: false,
      canEditWorkout: false,
      canEditBodyAssessment: false,
    });
  });

  it("admin SEM disciplina clínica = igual a nenhuma (perde body_assessments)", () => {
    // O admin é administrativo; sem disciplina não escreve nada clínico — inclusive avaliação corporal.
    expect(derivePermissions([])).toEqual({
      canEditNutrition: false,
      canEditSupplements: false,
      canEditMedications: false,
      canEditWorkout: false,
      canEditBodyAssessment: false,
    });
  });

  it("UNIÃO só AMPLIA, nunca restringe: superset de disciplinas ⇒ superset de permissões", () => {
    const base = derivePermissions(["nutricionista"]);
    const more = derivePermissions(["nutricionista", "educador_fisico"]);
    (["canEditNutrition", "canEditSupplements", "canEditMedications", "canEditWorkout", "canEditBodyAssessment"] as const).forEach(
      (k) => {
        if (base[k]) expect(more[k]).toBe(true); // nada que era permitido vira negado
      },
    );
    expect(more.canEditWorkout).toBe(true); // acumular educador_fisico ganhou treino
  });

  it("disciplina desconhecida não concede nada", () => {
    expect(derivePermissions(["psicologo", "outro"])).toEqual({
      canEditNutrition: false,
      canEditSupplements: false,
      canEditMedications: false,
      canEditWorkout: false,
      canEditBodyAssessment: false,
    });
  });
});

describe("mapa da UI == mapa do BANCO (espelho travado — migration 20260725090000)", () => {
  it("DISCIPLINE_WRITE_MAP é idêntico ao mapa das policies do banco", () => {
    expect(DISCIPLINE_WRITE_MAP).toEqual({
      nutrition: ["nutricionista"],
      supplements: ["nutricionista"],
      medications: ["medico"],
      workout: ["educador_fisico", "fisioterapeuta"],
      bodyAssessment: ["nutricionista", "educador_fisico", "fisioterapeuta", "medico"],
    });
  });
});

describe("helpers (guard, detecção de negação)", () => {
  it("canWriteSurface reflete as permissões derivadas", () => {
    const p = derivePermissions(["educador_fisico"]);
    expect(canWriteSurface(p, "workout")).toBe(true);
    expect(canWriteSurface(p, "nutrition")).toBe(false);
    expect(canWriteSurface(p, "medications")).toBe(false);
    expect(canWriteSurface(derivePermissions(["medico"]), "medications")).toBe(true);
    expect(canWriteSurface(derivePermissions(["nutricionista"]), "medications")).toBe(false);
  });

  it("isDisciplineDenied detecta o erro do cliente e do banco (sem falso positivo)", () => {
    expect(isDisciplineDenied(new WriteForbiddenError("workout"))).toBe(true);
    expect(isDisciplineDenied({ message: "forbidden: requires nutricionista discipline" })).toBe(true);
    expect(isDisciplineDenied({ message: "new row violates row-level security policy for table" })).toBe(true);
    expect(isDisciplineDenied({ code: "42501" })).toBe(true);
    expect(isDisciplineDenied({ message: "network error" })).toBe(false);
    expect(isDisciplineDenied(null)).toBe(false);
  });
});
