import { describe, expect, it } from "vitest";

import { dayIsoBR, hojeSubtitle, timeBR, todayRangeBR } from "./hoje";
import {
  applyDraftAction, assistantMessage, clearMessageDraft, contextLabel, greetingFor, hourBR, HISTORY_LIMIT, introMessage,
  newDraftView, patchDraft, peekMessageDraft, pushMessage, screenFromLocation, stashMessageDraft, suggestionsFor, draftUseLabel, hasClinicalAccess,
  type ChatMessage,
} from "./vertexaAi";
import type { AiAskResult, AiDraft } from "@/types/vertexaAi";

const PID = "cc2a636b-aec9-4132-afe7-475d293d67de";
const msgDraft: AiDraft = { kind: "mensagem", title: "Mensagem para Mariana Teste", patientId: PID, patientName: "Mariana Teste", body: "Oi, Mariana!", fields: [] };
const resumo: AiDraft = { kind: "resumo_retorno", title: "Retorno", patientId: PID, patientName: "Mariana Teste", body: "Resumo", fields: [] };
const lista: AiDraft = { kind: "lista_ligacoes", title: "Quem ligar", patientId: null, patientName: null, body: "A\nB", fields: [] };

describe("contexto por tela", () => {
  it("rotas viram tela; ficha leva paciente e aba (valor antigo mapeado)", () => {
    expect(screenFromLocation("/")).toEqual({ screen: "hoje", patientId: null, tab: null });
    expect(screenFromLocation("/agenda").screen).toBe("agenda");
    expect(screenFromLocation("/mensagens", "?patient=x").screen).toBe("relacionamento");
    expect(screenFromLocation("/financeiro/painel").screen).toBe("gestao");
    expect(screenFromLocation(`/pacientes/${PID}`, "")).toEqual({ screen: "paciente", patientId: PID, tab: "resumo" });
    expect(screenFromLocation(`/pacientes/${PID}`, "?tab=nutrition").tab).toBe("planos");
    expect(screenFromLocation("/pacientes/novo").screen).toBe("pacientes");
    expect(screenFromLocation("/qualquer").screen).toBe("outra");
  });
  it("rótulo 'Vendo:' mostra tela e, na ficha, o paciente inteiro + aba", () => {
    expect(contextLabel(screenFromLocation("/"))).toBe("Hoje");
    expect(contextLabel(screenFromLocation(`/pacientes/${PID}`, "?tab=prontuario"), "Mariana Teste")).toBe("Mariana Teste · Prontuário");
    expect(contextLabel(screenFromLocation(`/pacientes/${PID}`), null)).toBe("Paciente · Resumo");
  });
  it("sugestões dependem da tela: Hoje → quem ligar; ficha → resumo para o retorno", () => {
    expect(suggestionsFor(screenFromLocation("/"))).toContain("Quem eu devo ligar hoje?");
    // Recepção/Financeiro/Estoquista: nada clínico (achado D67)
    expect(suggestionsFor(screenFromLocation("/"), false)).toEqual(["Como está minha agenda de hoje?"]);
    expect(hasClinicalAccess(false, ["recepcao"])).toBe(false);
    expect(hasClinicalAccess(false, ["recepcao", "gestor"])).toBe(true);
    expect(hasClinicalAccess(false, [])).toBe(true);
    expect(hasClinicalAccess(true, ["financeiro"])).toBe(true);
    const ficha = suggestionsFor(screenFromLocation(`/pacientes/${PID}`));
    expect(ficha).toContain("Prepara o resumo para o retorno");
    expect(ficha).not.toContain("Quem eu devo ligar hoje?");
  });
  it("saudação usa a hora de Brasília, não a do aparelho", () => {
    expect(hourBR(new Date("2026-11-16T02:30:00Z"))).toBe(23);
    expect(hourBR(new Date("2026-11-16T15:00:00Z"))).toBe(12);
    expect(greetingFor(23)).toBe("Boa noite");
    expect(introMessage("Dra. Juliana", "Hoje", 8)).toMatch(/^Bom dia, Dra\. Juliana\. Estou vendo: Hoje\./);
    expect(introMessage(null, "Hoje", 14)).toMatch(/nada é salvo sem a sua confirmação/);
  });
});

describe("rascunho: nada é salvo sem confirmação", () => {
  it("nasce como rascunho; revisar não tem efeito", () => {
    const v = newDraftView(msgDraft);
    expect(v.status).toBe("rascunho");
    const r = applyDraftAction(v, "revisar");
    expect(r.view.status).toBe("em_revisao");
    expect(r.effect).toEqual({ type: "nenhum" });
  });
  it("descartar não tem efeito e encerra; depois disso nada mais acontece", () => {
    const d = applyDraftAction(newDraftView(msgDraft), "descartar");
    expect(d.effect).toEqual({ type: "nenhum" });
    expect(applyDraftAction(d.view, "usar").effect).toEqual({ type: "nenhum" });
    expect(applyDraftAction(d.view, "usar").view.status).toBe("descartado");
  });
  it("usar mensagem só entrega ao campo de resposta do paciente (com o texto editado)", () => {
    const rev = applyDraftAction(newDraftView(msgDraft), "revisar").view;
    const r = applyDraftAction({ ...rev, text: "Oi, Mari! Texto editado." }, "usar");
    expect(r.view.status).toBe("usado");
    expect(r.effect).toEqual({ type: "preencher_mensagem", patientId: PID, text: "Oi, Mari! Texto editado.", to: `/mensagens?patient=${PID}` });
  });
  it("usar resumo/lista só copia (e abre a ficha); nunca existe efeito de gravar ou enviar", () => {
    expect(applyDraftAction(newDraftView(resumo), "usar").effect).toEqual({ type: "copiar_e_abrir", text: "Resumo", to: `/pacientes/${PID}` });
    expect(applyDraftAction(newDraftView(lista), "usar").effect).toEqual({ type: "copiar_e_abrir", text: "A\nB", to: null });
    const tipos = new Set<string>();
    for (const d of [msgDraft, resumo, lista]) for (const a of ["revisar", "usar", "descartar"] as const) tipos.add(applyDraftAction(newDraftView(d), a).effect.type);
    expect([...tipos].sort()).toEqual(["copiar_e_abrir", "nenhum", "preencher_mensagem"]);
  });
  it("rótulo do botão diz o que acontece", () => {
    expect(draftUseLabel(msgDraft)).toBe("Usar em Mensagens");
    expect(draftUseLabel(resumo)).toBe("Copiar resumo");
  });
  it("entrega ao campo de resposta: lê sem apagar, apaga depois, uma vez", () => {
    const mem = new Map<string, string>();
    const st = { setItem: (k: string, v: string) => void mem.set(k, v), getItem: (k: string) => mem.get(k) ?? null, removeItem: (k: string) => void mem.delete(k) };
    stashMessageDraft(PID, "Oi!", st);
    expect(peekMessageDraft(PID, st)).toBe("Oi!");
    expect(peekMessageDraft(PID, st)).toBe("Oi!");
    clearMessageDraft(PID, st);
    expect(peekMessageDraft(PID, st)).toBe("");
  });
});

describe("histórico da sessão", () => {
  const res: AiAskResult = {
    mode: "demo", request_id: "r1", traced: true,
    reply: { text: "ok", items: [], draft: msgDraft, actions: [], blocked: null },
  };
  it("resposta com rascunho vira cartão em estado rascunho, com o modo e o contexto", () => {
    const m = assistantMessage("a1", res, "Hoje");
    expect(m.draft?.status).toBe("rascunho");
    expect(m.mode).toBe("demo");
    expect(m.context).toBe("Hoje");
  });
  it("guarda no máximo HISTORY_LIMIT e atualiza só o cartão pedido", () => {
    let list: ChatMessage[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) list = pushMessage(list, { id: `u${i}`, role: "user", text: String(i), context: "Hoje" });
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].id).toBe("u5");
    const withDraft = pushMessage(list, assistantMessage("a1", res, "Hoje"));
    const patched = patchDraft(withDraft, "a1", { ...newDraftView(msgDraft), status: "usado" });
    expect(patched.find((m) => m.id === "a1")?.draft?.status).toBe("usado");
    expect(patched.filter((m) => m.draft).length).toBe(1);
  });
});

describe("Hoje: datas de Brasília", () => {
  it("dia e janela seguem America/Sao_Paulo (nunca toISOString do aparelho)", () => {
    expect(dayIsoBR(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-15");
    expect(todayRangeBR(new Date("2026-11-16T15:00:00Z"))).toEqual({ from: "2026-11-16T03:00:00.000Z", to: "2026-11-17T03:00:00.000Z" });
    expect(timeBR("2026-11-16T12:30:00Z")).toBe("09:30");
  });
  it("subtítulo: data · compromissos · pacientes", () => {
    expect(hojeSubtitle("segunda-feira, 16 de novembro", 3, 2)).toBe("segunda-feira, 16 de novembro · 3 compromissos · 2 pacientes precisam de você");
    expect(hojeSubtitle("x", 1, 1)).toBe("x · 1 compromisso · 1 paciente precisa de você");
    expect(hojeSubtitle("x", null, 0)).toBe("x · ninguém precisa de você agora");
    expect(hojeSubtitle("x", 0, null)).toBe("x · 0 compromissos");
  });
});
