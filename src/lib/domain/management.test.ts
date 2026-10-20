import { describe, expect, it } from "vitest";
import { filterNav } from "@/hooks/useVisibleNav";
import { mainNav } from "@/app/routes";
import { idleLabel, loadShare, maxLoad, monthLabel, transferSummary, validateTransfer, type ProfessionalLoad } from "./management";

const P = (patients: number): ProfessionalLoad => ({ professional_id: String(patients), name: "x", clinic_role: null, patients, em_risco: 0, atencao: 0, avg_adherence: null, idle: 0 });

describe("management domain", () => {
  it("rótulo de mês", () => {
    expect(monthLabel("2026-10")).toBe("out/26");
    expect(monthLabel("2027-01")).toBe("jan/27");
  });
  it("barra de carga relativa ao maior", () => {
    expect(maxLoad([P(3), P(12), P(6)])).toBe(12);
    expect(loadShare(6, 12)).toBe(50);
    expect(loadShare(0, 0)).toBe(0);
  });
  it("idle e resumo da transferência", () => {
    expect(idleLabel(1)).toBe("1 dia");
    expect(idleLabel(9)).toBe("9 dias");
    expect(transferSummary(1, 0)).toBe("1 paciente transferido.");
    expect(transferSummary(3, 0)).toBe("3 pacientes transferidos.");
    expect(transferSummary(2, 1)).toMatch(/2 pacientes transferidos\. 1 ignorado \(/);
    expect(transferSummary(2, 2)).toMatch(/2 ignorados/);
  });
  it("valida a transferência", () => {
    expect(validateTransfer(null, "b", 1).ok).toBe(false);
    expect(validateTransfer("a", null, 1).ok).toBe(false);
    expect(validateTransfer("a", "a", 1).ok).toBe(false);
    expect(validateTransfer("a", "b", 0).ok).toBe(false);
    expect(validateTransfer("a", "b", 2).ok).toBe(true);
  });
  it("menu: Gestão só para administrador", () => {
    expect(filterNav(mainNav, false).map((i) => i.path)).not.toContain("/gestao");
    expect(filterNav(mainNav, true).map((i) => i.path)).toContain("/gestao");
    expect(filterNav(mainNav, true).map((i) => i.path)).toContain("/financeiro");
    expect(filterNav(mainNav, false).map((i) => i.path)).not.toContain("/financeiro");
    expect(filterNav(mainNav, false).length).toBe(mainNav.length - 2);
  });
});
