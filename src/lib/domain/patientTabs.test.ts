import { describe, expect, it } from "vitest";

import { LEGACY_PATIENT_TABS, PATIENT_TABS, resolvePatientTab } from "./patientTabs";

describe("ficha do paciente: 6 abas", () => {
  it("na ordem do guia", () => {
    expect(PATIENT_TABS.map((t) => t.label)).toEqual(["Resumo", "Timeline", "Prontuário", "Planos", "Evolução", "Documentos"]);
  });
  it("Planos e Evolução trazem as sub-abas", () => {
    expect(PATIENT_TABS.find((t) => t.id === "planos")?.subs?.map((s) => s.label)).toEqual(["Plano alimentar", "Suplementos", "Treino"]);
    expect(PATIENT_TABS.find((t) => t.id === "evolucao")?.subs?.map((s) => s.label)).toEqual(["Antropometria", "Evolução/Fotos", "Recuperação"]);
  });
  it("as 10 abas antigas existem como aba ou sub-aba (nada sumiu)", () => {
    const old = ["overview", "timeline", "anthropometry", "evolution", "documents", "prontuario", "nutrition", "supplements", "workout", "recovery"];
    expect(Object.keys(LEGACY_PATIENT_TABS).sort()).toEqual([...old].sort());
    const reachable = new Set(PATIENT_TABS.flatMap((t) => (t.subs ? t.subs.map((s) => `${t.id}/${s.id}`) : [`${t.id}/`])));
    for (const k of old) {
      const { tab, sub } = LEGACY_PATIENT_TABS[k];
      expect(reachable.has(`${tab}/${sub ?? ""}`)).toBe(true);
    }
  });
});

describe("?tab= antigo ou novo → aba + sub-aba", () => {
  it.each([
    ["overview", "resumo", null],
    ["timeline", "timeline", null],
    ["prontuario", "prontuario", null],
    ["nutrition", "planos", "alimentar"],
    ["supplements", "planos", "suplementos"],
    ["workout", "planos", "treino"],
    ["anthropometry", "evolucao", "antropometria"],
    ["evolution", "evolucao", "fotos"],
    ["recovery", "evolucao", "recuperacao"],
    ["documents", "documentos", null],
  ])("%s → %s/%s", (old, tab, sub) => {
    expect(resolvePatientTab(old)).toEqual({ tab, sub });
  });
  it("valores novos: aba com sub-abas usa ?sub= (novo ou antigo) ou cai na primeira", () => {
    expect(resolvePatientTab("planos")).toEqual({ tab: "planos", sub: "alimentar" });
    expect(resolvePatientTab("planos", "treino")).toEqual({ tab: "planos", sub: "treino" });
    expect(resolvePatientTab("planos", "workout")).toEqual({ tab: "planos", sub: "treino" });
    expect(resolvePatientTab("evolucao", "recuperacao")).toEqual({ tab: "evolucao", sub: "recuperacao" });
    expect(resolvePatientTab("evolucao", "lixo")).toEqual({ tab: "evolucao", sub: "antropometria" });
    expect(resolvePatientTab("resumo", "treino")).toEqual({ tab: "resumo", sub: null });
  });
  it("ausente ou desconhecido → Resumo", () => {
    expect(resolvePatientTab(null)).toEqual({ tab: "resumo", sub: null });
    expect(resolvePatientTab("zzz")).toEqual({ tab: "resumo", sub: null });
  });
});
