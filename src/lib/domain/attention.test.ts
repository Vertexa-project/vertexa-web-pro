import { describe, expect, it } from "vitest";
import { attentionKpis, classifyPatient, focusAction, focusOrder } from "./attention";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const ago = (d: number) => new Date(NOW - d * 86400000).toISOString();
const base = { snapshot: null, lastActivityAt: null, lastWeightAt: null, lastPhotoAt: null, lastWorkoutAt: null };

describe("classifyPatient", () => {
  it("sem snapshot e sem nenhum registro => atenção, motivo claro (nunca 'Sem dados')", () => {
    const a = classifyPatient(base, NOW);
    expect(a.level).toBe("atencao");
    expect(a.primary?.label).toBe("Ainda não registrou no app");
    expect(a.primary?.label).not.toMatch(/sem dados/i);
  });
  it("sem snapshot, com registro antigo => 'Sem registro há N dias'", () => {
    const a = classifyPatient({ ...base, lastWeightAt: ago(10), lastActivityAt: ago(10) }, NOW);
    expect(a.level).toBe("atencao");
    expect(a.primary).toMatchObject({ kind: "no_record", label: "Sem registro há 10 dias" });
  });
  it("em_risco do VRI tem prioridade e motivo de adesão", () => {
    const a = classifyPatient({ ...base, lastWeightAt: ago(1), lastPhotoAt: ago(1), lastWorkoutAt: ago(1), lastActivityAt: ago(1), snapshot: { score: 20, level: "x", status: "em_risco", weekly_completion_rate: 30, calculated_at: ago(0) } }, NOW);
    expect(a.level).toBe("em_risco");
    expect(a.primary?.label).toBe("Adesão caiu (30% na semana)");
  });
  it("tudo em dia => ok", () => {
    expect(classifyPatient({ ...base, lastWeightAt: ago(1), lastPhotoAt: ago(2), lastWorkoutAt: ago(1), lastActivityAt: ago(1) }, NOW).level).toBe("ok");
  });
});

describe("KPIs e lista leem da mesma regra", () => {
  it("12 pacientes sem snapshot e com pendência => atenção 12, pendências 12 e Foco não vazio", () => {
    const list = Array.from({ length: 12 }, () => ({ ...base }));
    const k = attentionKpis(list, NOW);
    expect(k).toEqual({ emRisco: 0, atencao: 12, pendencias: 12 });
    expect(focusOrder(list, NOW)).toHaveLength(12);
  });
  it("Foco ordena risco antes de atenção", () => {
    const risk = { ...base, lastActivityAt: ago(1), lastWeightAt: ago(1), lastPhotoAt: ago(1), lastWorkoutAt: ago(1), snapshot: { score: 10, level: "x", status: "em_risco" as const, weekly_completion_rate: 10, calculated_at: ago(0) } };
    const f = focusOrder([{ ...base }, risk], NOW);
    expect(f[0].attention.level).toBe("em_risco");
  });
});

describe("focusAction", () => {
  it("ação por motivo", () => {
    expect(focusAction("p1", { kind: "no_record", label: "" })).toEqual({ label: "Enviar lembrete", to: "/mensagens?patient=p1" });
    expect(focusAction("p1", { kind: "adherence_drop", label: "" }).label).toBe("Preparar retorno");
    expect(focusAction("p1", { kind: "never_registered", label: "" }).label).toBe("Chamar no app");
  });
});
