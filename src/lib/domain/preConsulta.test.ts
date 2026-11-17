import { describe, expect, it } from "vitest";

import { buildSummary, currentOf, DEFAULT_QUESTIONS, dayMonthBR, statusText, validateQuestions, newQuestionId, type PreConsultaRow } from "./preConsulta";

const base = (o: Partial<PreConsultaRow> = {}): PreConsultaRow => ({
  id: "1", patient_id: "p", appointment_id: null, appointment_starts_at: null, status: "respondida", source: "auto",
  questions: DEFAULT_QUESTIONS, answers: {}, sent_at: "2026-11-20T12:00:00Z", answered_at: "2026-11-21T15:00:00Z", canceled_at: null, ...o,
});

describe("perguntas padrão", () => {
  it("são de 8 a 12, curtas e com id único", () => {
    expect(DEFAULT_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_QUESTIONS.length).toBeLessThanOrEqual(12);
    expect(new Set(DEFAULT_QUESTIONS.map((q) => q.id)).size).toBe(DEFAULT_QUESTIONS.length);
    expect(DEFAULT_QUESTIONS.every((q) => q.label.length <= 130)).toBe(true);
  });
});

describe("Resumo para a consulta (modo demonstração)", () => {
  it("usa só o que foi respondido, em até 5 linhas, e não inventa", () => {
    const r = base({ answers: { objetivo: "Emagrecer e ganhar músculo", saude: "Gastrite crônica", medicacoes: "Omeprazol 20 mg", peso_atual: "82 kg, 1,76 m", emocional: "Muito estresse no trabalho", atividade: "Nenhuma", duvidas: "Posso treinar em jejum?" } });
    const s = buildSummary(r, 2);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s[0]).toBe("Objetivo: Emagrecer e ganhar músculo");
    expect(s.some((l) => l.startsWith("Saúde e medicações: Gastrite crônica · Omeprazol 20 mg"))).toBe(true);
    expect(s[4]).toBe("Exames: 2 arquivos anexados");
    expect(s.join(" ")).not.toMatch(/diabetes|hipertens/i);
  });
  it("sem resposta nenhuma: vazio; só exame: uma linha", () => {
    expect(buildSummary(base(), 0)).toEqual([]);
    expect(buildSummary(base(), 1)).toEqual(["Exames: 1 arquivo anexado"]);
  });
  it("recorta resposta longa sem passar do limite e é determinístico", () => {
    const longa = "Frase um sobre rotina. ".repeat(30);
    const a = buildSummary(base({ answers: { objetivo: longa } }), 0);
    expect(a[0].length).toBeLessThanOrEqual(170);
    expect(a[0].endsWith("…") || a[0].endsWith(".")).toBe(true);
    expect(buildSummary(base({ answers: { objetivo: longa } }), 0)).toEqual(a);
  });
  it("pergunta criada pela clínica entra com o texto da própria pergunta", () => {
    const r = base({ questions: [{ id: "queixa", label: "Qual a sua queixa principal?", type: "long" }], answers: { queixa: "Dor no joelho" } });
    expect(buildSummary(r, 0)).toEqual(["Qual a sua queixa principal: Dor no joelho"]);
  });
});

describe("status e datas", () => {
  it("datas em Brasília (pt-BR) e textos de status", () => {
    expect(dayMonthBR("2026-11-25T02:30:00Z")).toBe("24/11"); // 23:30 em Brasília
    expect(statusText(base())).toBe("Respondida em 21/11");
    expect(statusText(base({ status: "enviada" }))).toBe("Enviada em 20/11");
  });
  it("o pedido atual ignora cancelados e pega o mais novo", () => {
    const a = base({ id: "a", status: "cancelada", sent_at: "2026-11-22T00:00:00Z" });
    const b = base({ id: "b", sent_at: "2026-11-19T00:00:00Z" });
    const c = base({ id: "c", sent_at: "2026-11-20T00:00:00Z" });
    expect(currentOf([a, b, c])?.id).toBe("c");
    expect(currentOf([a])).toBeNull();
  });
});

describe("edição das perguntas", () => {
  it("valida quantidade e texto; gera id novo único", () => {
    expect(validateQuestions([])).toMatch(/ao menos uma/);
    expect(validateQuestions([{ id: "a", label: "  ", type: "long" }])).toMatch(/Preencha/);
    expect(validateQuestions(DEFAULT_QUESTIONS)).toBeNull();
    expect(newQuestionId(["pergunta_2"])).toBe("pergunta_3");
  });
});
