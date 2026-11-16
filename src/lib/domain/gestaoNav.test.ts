import { describe, expect, it } from "vitest";

import { NO_FIN_ACCESS, rowToAccess } from "./finAccess";
import { activeSectionTab, gestaoTabs, RELACIONAMENTO_TABS } from "./gestaoNav";

const to = (admin: boolean, raw?: Record<string, unknown>) => gestaoTabs(admin, raw ? rowToAccess(raw) : NO_FIN_ACCESS).map((t) => t.to);
const labels = (admin: boolean, raw?: Record<string, unknown>) => gestaoTabs(admin, raw ? rowToAccess(raw) : NO_FIN_ACCESS).map((t) => t.label);

describe("sub-abas de Gestão por papel (mesma regra de antes: adminOnly + finMenu)", () => {
  it("admin: Visão geral, Financeiro, Estoque e Documentos", () => {
    expect(labels(true)).toEqual(["Visão geral", "Financeiro", "Estoque", "Documentos"]);
    expect(to(true)).toEqual(["/gestao", "/financeiro", "/estoque", "/documentos"]);
  });
  it("Recepção: Financeiro (vendas/caixa) e Documentos; sem Visão geral nem Estoque", () => {
    expect(to(false, { roles: [{ role: "recepcao", all_units: true, unit_ids: [] }], can: { sales_read: true, cash_read: true, doc_list: true, doc_resend: true } })).toEqual(["/financeiro", "/documentos"]);
  });
  it("Financeiro: Financeiro e Estoque (consulta); sem Documentos nem Visão geral", () => {
    expect(to(false, { roles: [{ role: "financeiro", all_units: true, unit_ids: [] }], can: { services_read: true, stock_items_read: true, doc_list: false } })).toEqual(["/financeiro", "/estoque"]);
  });
  it("Estoquista: só Estoque", () => {
    expect(to(false, { roles: [{ role: "estoquista", all_units: true, unit_ids: [] }], can: { stock_items_read: true, stock_move_read: true } })).toEqual(["/estoque"]);
  });
  it("profissional sem papel financeiro: só Documentos; sem acesso nenhum: nenhuma sub-aba", () => {
    expect(to(false, { can: { doc_list: true } })).toEqual(["/documentos"]);
    expect(to(false)).toEqual([]);
  });
  it("Visão geral nunca aparece para quem não é admin da clínica", () => {
    expect(to(false, { is_admin: true, can: { sales_read: true } })).not.toContain("/gestao");
  });
});

describe("sub-abas de Relacionamento", () => {
  it("Mensagens e Campanhas, nessa ordem", () => {
    expect(RELACIONAMENTO_TABS.map((t) => t.label)).toEqual(["Mensagens", "Campanhas"]);
  });
  it("rotas antigas e novas ativam a aba certa; /mensagens?patient=ID segue em Mensagens", () => {
    const act = (p: string) => activeSectionTab(RELACIONAMENTO_TABS, p)?.label;
    expect(act("/relacionamento")).toBe("Mensagens");
    expect(act("/relacionamento/mensagens")).toBe("Mensagens");
    expect(act("/mensagens")).toBe("Mensagens");
    expect(act("/relacionamento/campanhas")).toBe("Campanhas");
    expect(act("/campanhas")).toBe("Campanhas");
    expect(act("/pacientes")).toBeUndefined();
  });
  it("sub-aba de Gestão ativa por prefixo: /financeiro/vendas → Financeiro", () => {
    const tabs = gestaoTabs(true);
    expect(activeSectionTab(tabs, "/financeiro/vendas")?.label).toBe("Financeiro");
    expect(activeSectionTab(tabs, "/estoque/saldo")?.label).toBe("Estoque");
    expect(activeSectionTab(tabs, "/gestao")?.label).toBe("Visão geral");
  });
});
