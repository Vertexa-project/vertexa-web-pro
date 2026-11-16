import { describe, expect, it } from "vitest";

import {
  daysUntil, DEFAULT_TEMPLATES, firstName, patientSees, proReminderLines, proSees, reminderPhase, renderReminderMessage, validateReminderInput, whenText,
  type ReminderRow,
} from "./patientReminders";
import { todayIsoBR } from "./stockMoves";

const row = (o: Partial<ReminderRow> = {}): ReminderRow => ({
  id: "r1", patient_id: "p1", kind: "return", title: null, due_on: "2026-11-30", notify_patient: true,
  notify_days_before: 7, pro_notify_days_before: 7, message_template: null, done_at: null, ...o,
});

describe("lembrete: hoje em Brasília (nunca toISOString)", () => {
  it("00:30 do dia 1º em Brasília ainda é 03:30 UTC do dia 1º; 23:30 de Brasília já é dia seguinte em UTC", () => {
    expect(todayIsoBR(new Date("2026-12-01T02:30:00Z"))).toBe("2026-11-30"); // 23:30 de 30/11 em Brasília
    expect(todayIsoBR(new Date("2026-12-01T03:30:00Z"))).toBe("2026-12-01"); // 00:30 de 01/12
  });
  it("a janela de aviso muda na virada do dia de Brasília, não na do UTC", () => {
    const r = row({ due_on: "2026-12-08", notify_days_before: 7 });
    const antes = todayIsoBR(new Date("2026-12-01T02:59:00Z")); // 23:59 de 30/11 → faltam 8 dias
    const depois = todayIsoBR(new Date("2026-12-01T03:00:00Z")); // 00:00 de 01/12 → faltam 7 dias
    expect(patientSees(r, antes)).toBe(false);
    expect(patientSees(r, depois)).toBe(true);
  });
});

describe("lembrete: dias e fases", () => {
  it("conta só calendário, inclusive virada de mês e ano bissexto", () => {
    expect(daysUntil("2026-12-01", "2026-11-30")).toBe(1);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysUntil("2026-11-10", "2026-11-16")).toBe(-6);
  });
  it("textos de quando", () => {
    expect([0, 1, -1, 5, -3].map(whenText)).toEqual(["hoje", "amanhã", "ontem", "em 5 dias", "há 3 dias"]);
  });
  it("fases: futuro → aviso → hoje → atrasado → encerrado (paciente) e feito", () => {
    const r = row({ due_on: "2026-11-30" });
    const f = (today: string) => reminderPhase(r, today, 7, 7);
    expect(f("2026-11-22")).toBe("futuro"); // 8 dias
    expect(f("2026-11-23")).toBe("aviso"); // 7 dias
    expect(f("2026-11-30")).toBe("hoje");
    expect(f("2026-12-07")).toBe("atrasado"); // 7 dias depois
    expect(f("2026-12-08")).toBe("encerrado");
    expect(reminderPhase({ ...r, done_at: "2026-11-25T10:00:00Z" }, "2026-11-25", 7, 7)).toBe("feito");
  });
  it("paciente: janela própria, opt-in e some depois da tolerância; feito nunca aparece", () => {
    const r = row({ due_on: "2026-11-30", notify_days_before: 3 });
    expect(patientSees(r, "2026-11-26")).toBe(false);
    expect(patientSees(r, "2026-11-27")).toBe(true);
    expect(patientSees(r, "2026-12-08")).toBe(false);
    expect(patientSees({ ...r, notify_patient: false }, "2026-11-30")).toBe(false);
    expect(patientSees({ ...r, done_at: "2026-11-28T00:00:00Z" }, "2026-11-30")).toBe(false);
  });
  it("profissional: janela própria e atrasado fica até marcar como feito", () => {
    const r = row({ due_on: "2026-11-30", pro_notify_days_before: 14, notify_days_before: 1 });
    expect(proSees(r, "2026-11-15")).toBe(false);
    expect(proSees(r, "2026-11-16")).toBe(true);
    expect(proSees(r, "2027-03-01")).toBe(true);
    expect(proSees({ ...r, done_at: "2026-12-01T00:00:00Z" }, "2026-12-02")).toBe(false);
  });
});

describe("lembrete: mudou a data, muda o lembrete (sem duplicar)", () => {
  it("o mesmo registro com data nova muda de fase na hora; nunca vira dois avisos", () => {
    const hoje = "2026-11-16";
    const antes = row({ due_on: "2026-11-20" });
    const depois = { ...antes, due_on: "2027-01-20" };
    expect(proSees(antes, hoje)).toBe(true);
    expect(proSees(depois, hoje)).toBe(false);
    const linhas = proReminderLines([{ ...antes, patientName: "Ana" }, { ...depois, id: "r2", patientName: "Bia" }], hoje);
    expect(linhas.map((l) => l.id)).toEqual(["r1"]);
  });
  it("Hoje do profissional: atrasados primeiro, depois os mais próximos; texto de exame e retorno", () => {
    const l = proReminderLines([
      { ...row({ id: "a", due_on: "2026-11-19" }), patientName: "Zilda" },
      { ...row({ id: "b", kind: "exam", title: "Hemograma", due_on: "2026-11-14" }), patientName: "Ana" },
      { ...row({ id: "c", due_on: "2026-11-16" }), patientName: "Caio" },
    ], "2026-11-16");
    expect(l.map((x) => [x.id, x.headline, x.when, x.overdue])).toEqual([
      ["b", "Exame: Hemograma", "há 2 dias", true], ["c", "Retorno", "hoje", false], ["a", "Retorno", "em 3 dias", false],
    ]);
  });
});

describe("lembrete: mensagem editável", () => {
  const ctx = { name: "Mariana Teste", dueOn: "2026-11-30", title: "Hemograma", kind: "exam" as const, todayIso: "2026-11-27" };
  it("usa o padrão quando não há texto da clínica e preenche nome, data, quando e exame", () => {
    expect(renderReminderMessage(null, ctx)).toBe("Olá, Mariana! Lembrete: o exame Hemograma deve ser feito até 30/11/2026 (em 3 dias). Quando tiver o resultado, avise a sua equipe pelo app.");
    expect(renderReminderMessage("  ", { ...ctx, kind: "return" })).toContain("Seu retorno com a clínica é em 3 dias, em 30/11/2026");
  });
  it("texto da clínica vale; a data muda junto com o lembrete", () => {
    const t = "{nome}, {exame} em {data} ({quando})";
    expect(renderReminderMessage(t, ctx)).toBe("Mariana, Hemograma em 30/11/2026 (em 3 dias)");
    expect(renderReminderMessage(t, { ...ctx, dueOn: "2026-12-05" })).toBe("Mariana, Hemograma em 05/12/2026 (em 8 dias)");
  });
  it("modelos padrão só usam marcas conhecidas e nome sem sobrenome", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) expect(t.match(/\{[a-z]+\}/g)!.every((m) => ["{nome}", "{data}", "{quando}", "{exame}"].includes(m))).toBe(true);
    expect(firstName("  Ana Paula Souza ")).toBe("Ana");
  });
});

describe("lembrete: validação do cadastro", () => {
  const ok = { kind: "return" as const, title: "", dueOn: "2026-12-10", noticeDays: 7, proNoticeDays: 7, message: "" };
  const today = "2026-11-16";
  it("aceita o retorno completo e recusa os erros em PT", () => {
    expect(validateReminderInput(ok, today)).toBeNull();
    expect(validateReminderInput({ ...ok, kind: "exam", title: "  " }, today)).toBe("Informe o nome do exame.");
    expect(validateReminderInput({ ...ok, dueOn: "" }, today)).toBe("Informe a data.");
    expect(validateReminderInput({ ...ok, dueOn: "2025-01-01" }, today)).toBe("A data não pode ser de mais de um ano atrás.");
    expect(validateReminderInput({ ...ok, noticeDays: 91 }, today)).toBe("Avisar de 0 a 90 dias antes.");
    expect(validateReminderInput({ ...ok, proNoticeDays: -1 }, today)).toBe("Avisar de 0 a 90 dias antes.");
    expect(validateReminderInput({ ...ok, message: "x".repeat(501) }, today)).toBe("A mensagem pode ter até 500 letras.");
  });
});
