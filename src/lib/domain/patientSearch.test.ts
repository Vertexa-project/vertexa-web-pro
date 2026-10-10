import { describe, expect, it } from "vitest";

import { matchesPatientSearch, normalizePatientSearchTerm } from "./patientSearch";

const maria = { full_name: "Maria Souza", email: "maria.souza@clinica.test" };

describe("busca de pacientes (nome ou e-mail)", () => {
  it("termo vazio não filtra", () => {
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("   "))).toBe(true);
  });

  it("nome continua funcionando (trecho, sem diferenciar maiúsculas)", () => {
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("souza"))).toBe(true);
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("MARIA"))).toBe(true);
  });

  it("e-mail completo, parcial, maiúsculas e espaços nas pontas", () => {
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("maria.souza@clinica.test"))).toBe(true);
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("@clinica"))).toBe(true);
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("  MARIA.SOUZA@CLINICA.TEST  "))).toBe(true);
  });

  it("sem resultado", () => {
    expect(matchesPatientSearch(maria, normalizePatientSearchTerm("joao@"))).toBe(false);
  });

  it("sem heurística de Gmail: ponto no local-part não é ignorado", () => {
    const p = { full_name: "Paciente", email: "al.example@gmail.com" };
    expect(matchesPatientSearch(p, normalizePatientSearchTerm("alexample@gmail.com"))).toBe(false);
    expect(matchesPatientSearch(p, normalizePatientSearchTerm("al.example@gmail.com"))).toBe(true);
  });

  it("perfil sem e-mail ou nulo não quebra", () => {
    expect(matchesPatientSearch({ full_name: "Sem Email", email: null }, "sem")).toBe(true);
    expect(matchesPatientSearch(null, "x")).toBe(false);
  });
});
