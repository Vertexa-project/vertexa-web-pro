import { describe, expect, it } from "vitest";

import { filterNav } from "@/hooks/useVisibleNav";
import { NO_FIN_ACCESS, rowToAccess } from "@/lib/domain/finAccess";
import { footerNav, isNavActive, mainNav } from "./routes";

const nav = (isAdmin: boolean, raw?: Record<string, unknown>) =>
  filterNav(mainNav, isAdmin, raw ? rowToAccess(raw) : NO_FIN_ACCESS);
const labels = (items: { label: string }[]) => items.map((i) => i.label);

// Perfis (mesma matriz de papéis de antes do redesign).
const RECEPCAO = { roles: [{ role: "recepcao", all_units: true, unit_ids: [] }], can: { sales_read: true, cash_read: true, doc_list: true, doc_resend: true, units_read: true } };
const FINANCEIRO = { roles: [{ role: "financeiro", all_units: true, unit_ids: [] }], can: { services_read: true, sales_read: true, receivables_read: true, stock_items_read: true, doc_list: false } };
const ESTOQUISTA = { roles: [{ role: "estoquista", all_units: true, unit_ids: [] }], can: { stock_items_read: true, stock_move_read: true } };
const PROFISSIONAL = { can: { doc_list: true, doc_content: true } };

describe("menu", () => {
  it("não mostra item de roadmap com cadeado nem 'Modelos'", () => {
    const all = [...mainNav, ...footerNav];
    expect(all.some((i) => i.locked)).toBe(false);
    expect(all.some((i) => /modelos/i.test(i.label))).toBe(false);
  });

  it("ordem do guia: Hoje, Pacientes, Agenda, Jornada, Relacionamento, Gestão, Biblioteca + Configurações no rodapé", () => {
    expect(labels(mainNav)).toEqual(["Hoje", "Pacientes", "Agenda", "Jornada", "Relacionamento", "Gestão", "Biblioteca"]);
    expect(labels(footerNav)).toEqual(["Configurações"]);
    expect(mainNav.map((i) => i.path).slice(0, 3)).toEqual(["/", "/pacientes", "/agenda"]);
    // Os itens antigos saíram do menu (as rotas seguem montadas): Dashboard, Mensagens, Campanhas, Financeiro, Estoque, Documentos.
    for (const old of ["Dashboard", "Mensagens", "Campanhas", "Financeiro", "Estoque", "Documentos"]) {
      expect(labels([...mainNav, ...footerNav])).not.toContain(old);
    }
  });

  it("admin vê os 7 itens e Gestão abre na Visão geral", () => {
    const items = nav(true);
    expect(labels(items)).toEqual(labels(mainNav));
    expect(items.find((i) => i.gestao)?.path).toBe("/gestao");
  });

  it("Recepção e Financeiro (sem ser admin) continuam chegando em Financeiro/Documentos pela entrada Gestão", () => {
    const rec = nav(false, RECEPCAO).find((i) => i.gestao);
    expect(rec?.label).toBe("Gestão");
    expect(rec?.path).toBe("/financeiro");
    const fin = nav(false, FINANCEIRO).find((i) => i.gestao);
    expect(fin?.path).toBe("/financeiro");
    expect(nav(false, ESTOQUISTA).find((i) => i.gestao)?.path).toBe("/estoque");
  });

  it("profissional com documentos vê Gestão só pela sub-aba Documentos; sem nenhum acesso o item some", () => {
    expect(nav(false, PROFISSIONAL).find((i) => i.gestao)?.path).toBe("/documentos");
    const none = nav(false);
    expect(none.some((i) => i.gestao)).toBe(false);
    expect(labels(none)).toEqual(["Hoje", "Pacientes", "Agenda", "Jornada", "Relacionamento", "Biblioteca"]);
  });
});

describe("item ativo (rotas antigas agrupadas)", () => {
  const item = (label: string) => mainNav.find((i) => i.label === label)!;
  it("Relacionamento fica ativo em /relacionamento, /mensagens e /campanhas", () => {
    for (const p of ["/relacionamento", "/relacionamento/campanhas", "/mensagens", "/campanhas"]) {
      expect(isNavActive(item("Relacionamento"), p)).toBe(true);
    }
    expect(isNavActive(item("Relacionamento"), "/pacientes")).toBe(false);
  });
  it("Gestão fica ativa em /gestao, /financeiro/*, /estoque/* e /documentos", () => {
    for (const p of ["/gestao", "/financeiro", "/financeiro/vendas", "/estoque/saldo", "/documentos"]) {
      expect(isNavActive(item("Gestão"), p)).toBe(true);
    }
    expect(isNavActive(item("Gestão"), "/financeirox")).toBe(false);
  });
  it("Hoje só em '/' (não em todas as rotas)", () => {
    expect(isNavActive(item("Hoje"), "/")).toBe(true);
    expect(isNavActive(item("Hoje"), "/agenda")).toBe(false);
  });
});
