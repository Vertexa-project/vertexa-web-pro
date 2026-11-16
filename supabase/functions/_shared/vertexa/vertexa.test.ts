import { describe, expect, it } from "vitest";

import { classify } from "./attention";
import { hasClinicalAccess, cleanMessage } from "./access";
import { buildHojeFacts, buildPatientFacts, dayBoundsBR, findPatientByName, sanitizeScreen, type RawAppointment, type RawPatient } from "./context";
import { buildDemoReply, messageFor } from "./demo";
import { detectIntent } from "./intent";
import { allowedNumbers, numbersIn, SAFE_FALLBACK, validateReply } from "./validate";
import { toAiReply } from "./openai";
import { classifyPatient, focusAction } from "../../../../src/lib/domain/attention";
import type { AiReply, ScreenContext } from "./types";

const NOW = new Date("2026-11-16T15:00:00Z").getTime();
const d = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const P = (over: Partial<RawPatient>): RawPatient => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Mariana Teste", goal: "Emagrecimento", heightCm: 165, currentWeight: 70,
  targetWeight: 62, status: "ok", rate: 80, lastWeightAt: d(1), lastPhotoAt: d(3), lastWorkoutAt: d(1), lastActivityAt: d(1), weights: [],
  ...over,
});
const camila = P({ id: "22222222-2222-4222-8222-222222222222", name: "Camila Teste", status: "atencao", rate: 41, lastWeightAt: d(12), lastPhotoAt: d(40), lastWorkoutAt: d(12), lastActivityAt: d(12) });
const novo = P({ id: "33333333-3333-4333-8333-333333333333", name: "Paulo Novo", status: null, rate: null, currentWeight: null, lastWeightAt: null, lastPhotoAt: null, lastWorkoutAt: null, lastActivityAt: null });
const appt: RawAppointment = { id: "a1", title: "Retorno", startsAt: "2026-11-16T12:30:00Z", patientId: camila.id, patientName: "Camila Teste", type: "retorno" };

const hojeScreen: ScreenContext = { screen: "hoje", label: "Hoje", patientId: null, tab: null };
const facts = buildHojeFacts([P({}), camila, novo], [appt], NOW, true);

describe("paridade da regra de atenção (servidor × painel)", () => {
  it("classifica igual ao attention.ts do painel", () => {
    for (const p of [P({}), camila, novo]) {
      const panel = classifyPatient(
        { snapshot: p.status ? ({ status: p.status, weekly_completion_rate: p.rate } as never) : null, lastActivityAt: p.lastActivityAt, lastWeightAt: p.lastWeightAt, lastPhotoAt: p.lastPhotoAt, lastWorkoutAt: p.lastWorkoutAt },
        NOW,
      );
      const srv = classify({ status: p.status, rate: p.rate, lastWeightAt: p.lastWeightAt, lastPhotoAt: p.lastPhotoAt, lastWorkoutAt: p.lastWorkoutAt, lastActivityAt: p.lastActivityAt }, NOW);
      expect(srv.level).toBe(panel.level);
      expect(srv.reasons).toEqual(panel.reasons);
      expect(srv.hasPendency).toBe(panel.hasPendency);
    }
  });
  it("ação por motivo é a do painel (Preparar retorno / Enviar lembrete / Chamar no app)", () => {
    const demo = buildDemoReply({ intent: "quem_hoje", screen: hojeScreen, facts, patientFacts: null, patientDenied: false, clinical: true });
    const labels = demo.actions.map((a) => a.label.split(" · ")[0]);
    expect(labels).toContain(focusAction("x", { kind: "adherence_drop", label: "" }).label);
    expect(labels).toContain(focusAction("x", { kind: "never_registered", label: "" }).label);
    expect(demo.actions.some((a) => a.to === `/pacientes/${camila.id}`)).toBe(true);
    expect(demo.actions.some((a) => a.to === `/mensagens?patient=${novo.id}`)).toBe(true);
    expect(JSON.stringify(demo)).not.toMatch(/Tratar/);
  });
});

describe("contexto", () => {
  it("fatos do dia vêm dos dados e carregam fonte", () => {
    expect(facts.find((f) => f.key === "total")?.value).toBe(3);
    expect(facts.find((f) => f.key === "em_risco")?.value).toBe(0);
    expect(facts.every((f) => f.source.length > 0)).toBe(true);
    expect(facts.find((f) => f.key === "agenda:a1")?.label).toBe("09:30 · Retorno");
  });
  it("sem acesso clínico: só agenda, nenhum dado de paciente", () => {
    const f = buildHojeFacts([P({}), camila], [appt], NOW, false);
    expect(f.map((x) => x.key.split(":")[0])).toEqual(["agenda_total", "agenda"]);
  });
  it("papéis: Recepção/Financeiro/Estoquista não são clínicos; admin e profissional são", () => {
    expect(hasClinicalAccess(false, ["recepcao"])).toBe(false);
    expect(hasClinicalAccess(false, ["financeiro", "recepcao"])).toBe(false);
    expect(hasClinicalAccess(false, ["gestor"])).toBe(true);
    expect(hasClinicalAccess(true, ["financeiro"])).toBe(true);
    expect(hasClinicalAccess(false, [])).toBe(true);
  });
  it("dia de Brasília: 16/11 02:30Z ainda é 15/11", () => {
    expect(dayBoundsBR(new Date("2026-11-16T02:30:00Z")).from).toBe("2026-11-15T03:00:00.000Z");
    expect(dayBoundsBR(new Date("2026-11-16T03:30:00Z")).from).toBe("2026-11-16T03:00:00.000Z");
  });
  it("tela só aceita valores conhecidos; paciente sem id vira outra", () => {
    expect(sanitizeScreen({ screen: "paciente", patientId: "x" }).screen).toBe("outra");
    expect(sanitizeScreen({ screen: "hack", label: "<script>" }).label).toBe("Vertexa");
    expect(sanitizeScreen({ screen: "paciente", patientId: camila.id, tab: "resumo" }).patientId).toBe(camila.id);
  });
  it("acha paciente pelo primeiro nome só se for único", () => {
    const names = [{ id: "1", name: "Camila Teste" }, { id: "2", name: "Mariana Teste" }, { id: "3", name: "Camila Souza" }];
    expect(findPatientByName("prepara o retorno da Mariana", names)).toBe("2");
    expect(findPatientByName("fala da Camila", names)).toBeNull();
  });
  it("peso: última medida válida; pendente/rejeitada e fora de faixa ficam de fora", () => {
    const p = P({ weights: [{ kg: 71, at: d(5), review: "ok" }, { kg: 9, at: d(1), review: "ok" }, { kg: 80, at: d(0), review: "pending" }] });
    const f = buildPatientFacts(p, null, NOW);
    expect(f.find((x) => x.key === "peso")?.value).toBe("71 kg");
  });
  it("sem dado: marca incerto (laranja) em vez de inventar", () => {
    const f = buildPatientFacts(novo, null, NOW);
    expect(f.find((x) => x.key === "peso")?.uncertain).toBe(true);
    expect(f.find((x) => x.key === "adesao")?.uncertain).toBe(true);
    expect(f.find((x) => x.key === "proximo")?.uncertain).toBe(true);
  });
});

describe("modo demonstração é determinístico e passa na validação", () => {
  const pf = buildPatientFacts(camila, appt, NOW);
  const all = [...facts, ...pf];
  const run = (message: string, screen: ScreenContext = hojeScreen, over: Partial<Parameters<typeof buildDemoReply>[0]> = {}) =>
    buildDemoReply({ intent: detectIntent(message), screen, facts: all, patientFacts: pf, patientDenied: false, clinical: true, ...over });

  it("mesma entrada, mesma saída", () => {
    expect(JSON.stringify(run("Quem precisa de mim hoje?"))).toBe(JSON.stringify(run("Quem precisa de mim hoje?")));
  });
  it("todas as intenções produzem saída válida (número do sistema, sem diagnóstico, com fonte)", () => {
    for (const m of ["Quem precisa de mim hoje?", "Minha agenda de hoje", "Quem está sem registrar?", "Prepara o retorno", "Escreve uma mensagem", "Como está meu mês?", "Marca como pago", "Qual o diagnóstico?", "Monta um treino", "oi"]) {
      const r = run(m, { screen: "paciente", label: "x", patientId: camila.id, tab: "resumo" });
      expect(validateReply(r, all), m).toEqual({ ok: true });
    }
  });
  it("resultado nasce rascunho: nada de 'salvo/enviado' e rascunho de mensagem diz que nada foi enviado", () => {
    const r = run("Escreve uma mensagem para a Camila");
    expect(r.draft?.kind).toBe("mensagem");
    expect(r.text).toMatch(/Nada foi enviado/);
    expect(r.draft?.body).toMatch(/^Oi, Camila!/);
    const resumo = run("Prepara o retorno");
    expect(resumo.text).toMatch(/nada foi salvo/i);
    expect(resumo.draft?.kind).toBe("resumo_retorno");
    expect(resumo.draft?.fields.every((f) => f.source.length > 0)).toBe(true);
  });
  it("incerto vai marcado no resumo", () => {
    const r = buildDemoReply({ intent: "resumo_retorno", screen: hojeScreen, facts: [...facts, ...buildPatientFacts(novo, null, NOW)], patientFacts: buildPatientFacts(novo, null, NOW), patientDenied: false, clinical: true });
    expect(r.draft?.fields.filter((f) => f.uncertain).map((f) => f.label)).toEqual(expect.arrayContaining(["Peso atual", "Adesão na semana", "Último registro", "Próximo compromisso"]));
  });
  it("pagamento: recusa e diz que não marca pagamento nem movimenta caixa", () => {
    const r = run("marca a Camila como paga");
    expect(r.text).toMatch(/não marca pagamento nem movimenta caixa/);
    expect(r.draft).toBeNull();
  });
  it("sem acesso clínico: não fala de paciente", () => {
    const r = run("quem precisa de mim hoje", hojeScreen, { clinical: false, facts: buildHojeFacts([], [appt], NOW, false), patientFacts: null });
    expect(r.blocked).toBe("sem_acesso");
    expect(JSON.stringify(r)).not.toMatch(/Camila|Mariana/);
  });
  it("paciente negado pela RLS/can_access_patient: nada preparado", () => {
    const r = run("prepara o retorno da Camila", hojeScreen, { patientFacts: null, patientDenied: true });
    expect(r.blocked).toBe("sem_acesso");
    expect(r.draft).toBeNull();
  });
  it("mensagem por motivo, sem número", () => {
    expect(numbersIn(messageFor("Camila Teste", "no_record"))).toEqual([]);
    expect(messageFor("Paulo Novo", "never_registered")).toMatch(/ainda não registrou/);
  });
});

describe("validação de saída", () => {
  const base: AiReply = { text: "ok", items: [], draft: null, actions: [], blocked: null };
  it("número fora do sistema é barrado; número do contexto passa", () => {
    expect(validateReply({ ...base, text: "A adesão é 99%" }, facts)).toMatchObject({ ok: false, reason: "numero_fora_do_sistema" });
    expect(validateReply({ ...base, text: "Adesão média de 61%" }, [{ key: "a", label: "Adesão média", value: 61, source: "Adesão" }])).toEqual({ ok: true });
  });
  it("formatação pt-BR de número é equivalente", () => {
    expect(numbersIn("1.748,5 kg e 12,5")).toEqual(["1748.5", "12.5"]);
    expect(allowedNumbers([{ key: "k", label: "Peso", value: "78,4 kg", source: "x" }]).has("78.4")).toBe(true);
  });
  it("diagnóstico e prescrição são barrados", () => {
    for (const t of ["O diagnóstico é anemia", "Recomendo tomar creatina", "Receito vitamina D", "A dose ideal é maior", "Tome de manhã"]) {
      expect(validateReply({ ...base, text: t }, facts), t).toMatchObject({ ok: false, reason: "diagnostico_ou_prescricao" });
    }
    expect(validateReply({ ...base, text: "Não diagnostico nem prescrevo." }, facts)).toEqual({ ok: true });
  });
  it("frase sem fonte é barrada", () => {
    expect(validateReply({ ...base, items: [{ text: "algo", source: " " }] }, facts)).toMatchObject({ ok: false, reason: "sem_fonte" });
  });
  it("saída crua do modelo fora do formato é descartada e o fallback não cria nada", () => {
    expect(toAiReply({ text: 1 })).toBeNull();
    expect(toAiReply({ text: "a", items: [{ text: "x" }], draft: null })).toBeNull();
    expect(toAiReply({ text: "a", items: [], draft: { kind: "salvar_no_prontuario", title: "", body: "", fields: [] } })).toBeNull();
    expect(SAFE_FALLBACK.draft).toBeNull();
    expect(SAFE_FALLBACK.text).toMatch(/Nada foi criado ou salvo/);
  });
  it("mensagem do usuário: vazia ou longa demais é recusada", () => {
    expect(cleanMessage("   ")).toBeNull();
    expect(cleanMessage("a".repeat(601))).toBeNull();
    expect(cleanMessage("  quem   liga? ")).toBe("quem liga?");
  });
});

describe("intenção", () => {
  it.each([
    ["Quem precisa de mim hoje?", "quem_hoje"], ["Quem eu devo ligar?", "quem_hoje"], ["Marca a Sofia como paga", "pagamento"],
    ["Qual o diagnóstico dela?", "diagnostico"], ["Como está meu mês?", "financeiro"], ["Prepara o retorno", "resumo_retorno"],
    ["Escreve um lembrete", "rascunho_mensagem"], ["Quem está sem registrar?", "sem_registrar"], ["Monta um treino ABCD", "treino"],
  ])("%s → %s", (m, i) => expect(detectIntent(m)).toBe(i));
});
