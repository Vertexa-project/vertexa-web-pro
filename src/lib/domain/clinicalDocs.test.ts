import { describe, expect, it } from "vitest";

import { dateTimeBR, docErrorMessage, emptyDraft, formatCpf, isoDateBR, itemsForType, validateDraft, DEMO_BADGE, DEMO_NOTICE, DOC_TYPES } from "@/lib/domain/clinicalDocs";
import { activityEventDescription, activityEventMeta } from "@/lib/domain/activityEvents";
import { filterNav } from "@/hooks/useVisibleNav";
import { mainNav } from "@/app/routes";
import { canSeeDocsMenu, rowToAccess } from "@/lib/domain/finAccess";

const rx = { name: "Medicamento Fictício 10 mg", dose: "1 comprimido", posology: "1x ao dia", quantity: "30" };

describe("rascunho do documento", () => {
  it("receita exige medicamento, dose, posologia e quantidade em cada item", () => {
    const d = emptyDraft("receita");
    expect(validateDraft("receita", d).items).toMatch(/medicamento, dose, posologia e quantidade/);
    expect(validateDraft("receita", { ...d, items: [rx] })).toEqual({});
    expect(validateDraft("receita", { ...d, items: [{ ...rx, posology: " " }] }).items).toBeDefined();
    expect(validateDraft("receita", { ...d, items: [] }).items).toMatch(/ao menos um/);
  });
  it("atestado e relatório exigem texto; exames aceita lista ou texto", () => {
    expect(validateDraft("atestado", emptyDraft("atestado")).content).toBeDefined();
    expect(validateDraft("atestado", { ...emptyDraft("atestado"), content: "Repouso de 2 dias." })).toEqual({});
    expect(validateDraft("relatorio", emptyDraft("relatorio")).content).toBeDefined();
    expect(validateDraft("exames", emptyDraft("exames")).content).toBeDefined();
    expect(validateDraft("exames", { ...emptyDraft("exames"), items: [{ name: "Hemograma", dose: "", posology: "", quantity: "" }] })).toEqual({});
    expect(validateDraft("exames", { ...emptyDraft("exames"), content: "Jejum de 12 h." })).toEqual({});
  });
  it("título obrigatório e CPF com 11 dígitos quando informado", () => {
    const d = { ...emptyDraft("atestado"), content: "Texto do atestado." };
    expect(validateDraft("atestado", { ...d, title: " " }).title).toBeDefined();
    expect(validateDraft("atestado", { ...d, cpf: "123" }).cpf).toBeDefined();
    expect(validateDraft("atestado", { ...d, cpf: "111.444.777-35" })).toEqual({});
  });
  it("itens enviados por tipo: receita completa, exames só nome, demais vazio", () => {
    expect(itemsForType("receita", [{ ...rx, name: "  X  " }])[0].name).toBe("X");
    expect(itemsForType("exames", [{ name: "Hemograma", dose: "a", posology: "b", quantity: "c" }, { name: " ", dose: "", posology: "", quantity: "" }])).toEqual([{ name: "Hemograma", dose: "", posology: "", quantity: "" }]);
    expect(itemsForType("atestado", [rx])).toEqual([]);
    expect(itemsForType("relatorio", [rx])).toEqual([]);
  });
  it("os quatro tipos existem e o aviso de demonstração não esconde a falta de validade legal", () => {
    expect(DOC_TYPES).toEqual(["receita", "atestado", "exames", "relatorio"]);
    expect(DEMO_BADGE).toBe("DEMONSTRAÇÃO — sem validade legal");
    expect(DEMO_NOTICE).toMatch(/não tem validade legal/);
  });
});

describe("formatação", () => {
  it("CPF e datas (fuso de Brasília, sem deslocar o dia)", () => {
    expect(formatCpf("11144477735")).toBe("111.444.777-35");
    expect(isoDateBR("1990-05-17")).toBe("17/05/1990");
    expect(isoDateBR(null)).toBe("—");
    // 01:30 UTC de 15/11 ainda é 14/11 22:30 em Brasília
    expect(dateTimeBR("2026-11-15T01:30:00Z")).toContain("14/11/2026");
    expect(dateTimeBR("2026-11-15T01:30:00Z")).toContain("22:30");
  });
  it("mensagens de erro do servidor viram texto claro", () => {
    expect(docErrorMessage({ message: "REGISTRY_REQUIRED" })).toMatch(/conselho\/registro/);
    expect(docErrorMessage({ message: "forbidden", code: "42501" })).toMatch(/permissão/);
    expect(docErrorMessage({ message: "algo" })).toMatch(/Tente novamente/);
    expect(docErrorMessage({ message: "DOCUMENT_INVALIDATED: x" })).toMatch(/invalidado/);
  });
});

describe("timeline do paciente", () => {
  it("documento assinado e invalidado aparecem com rótulo e aviso de demonstração, sem conteúdo clínico", () => {
    expect(activityEventMeta("document_signed").label).toBe("Documento assinado");
    expect(activityEventMeta("document_invalidated").label).toBe("Documento invalidado");
    expect(activityEventDescription("document_signed", { doc_type: "receita", is_demo: true })).toBe("Receita (demonstração, sem validade legal)");
    expect(activityEventDescription("document_signed", { doc_type: "atestado", is_demo: false })).toBe("Atestado");
    expect(activityEventDescription("document_signed", { doc_type: "x" })).toBeNull();
  });
});

describe("menu Documentos por papel", () => {
  const nav = (raw: Record<string, unknown>, admin = false) => filterNav(mainNav, admin, rowToAccess(raw)).some((i) => i.path === "/documentos");
  it("Admin, profissional e Recepção veem; Financeiro, Estoquista e Gestor sem vínculo clínico não", () => {
    expect(nav({ is_admin: true, can: {} }, true)).toBe(true);
    expect(nav({ can: { doc_list: true, doc_content: true } })).toBe(true);
    expect(nav({ roles: [{ role: "recepcao", all_units: true, unit_ids: [] }], can: { doc_list: true, doc_resend: true } })).toBe(true);
    expect(nav({ roles: [{ role: "financeiro", all_units: true, unit_ids: [] }], can: { doc_list: false, sales_read: true } })).toBe(false);
    expect(nav({ roles: [{ role: "estoquista", all_units: true, unit_ids: [] }], can: { stock_move_read: true } })).toBe(false);
    expect(canSeeDocsMenu(rowToAccess({ can: {} }))).toBe(false);
  });
});
