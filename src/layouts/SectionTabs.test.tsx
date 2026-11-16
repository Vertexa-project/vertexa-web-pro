import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RelacionamentoLayout } from "./RelacionamentoLayout";
import { SectionTabs } from "./SectionTabs";
import { gestaoTabs } from "@/lib/domain/gestaoNav";
import { NO_FIN_ACCESS, rowToAccess } from "@/lib/domain/finAccess";

function Page({ name }: { name: string }) {
  const l = useLocation();
  return (
    <div>
      <h1>{name}</h1>
      <output data-testid="loc">{l.pathname + l.search}</output>
    </div>
  );
}

function renderRel(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<RelacionamentoLayout />}>
          <Route path="relacionamento" element={<Page name="Mensagens página" />} />
          <Route path="relacionamento/campanhas" element={<Page name="Campanhas página" />} />
          <Route path="mensagens" element={<Page name="Mensagens página" />} />
          <Route path="campanhas" element={<Page name="Campanhas página" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Relacionamento: sub-abas Mensagens e Campanhas", () => {
  it("mostra as duas sub-abas e alterna entre elas", async () => {
    renderRel("/relacionamento");
    const nav = screen.getByRole("navigation", { name: "Seções de Relacionamento" });
    expect(nav.querySelectorAll("a")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Mensagens" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("link", { name: "Campanhas" }));
    expect(screen.getByText("Campanhas página")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Campanhas" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("link", { name: "Mensagens" }));
    expect(screen.getByRole("link", { name: "Mensagens" })).toHaveAttribute("aria-current", "page");
  });

  it("deep link /mensagens?patient=ID continua abrindo Mensagens com o parâmetro intacto", () => {
    renderRel("/mensagens?patient=pat-42");
    expect(screen.getByText("Mensagens página")).toBeInTheDocument();
    expect(screen.getByTestId("loc").textContent).toBe("/mensagens?patient=pat-42");
    expect(screen.getByRole("link", { name: "Mensagens" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Campanhas" })).not.toHaveAttribute("aria-current");
  });

  it("/campanhas (rota antiga) ativa a sub-aba Campanhas", () => {
    renderRel("/campanhas");
    expect(screen.getByRole("link", { name: "Campanhas" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Gestão: sub-abas só para quem pode", () => {
  const renderGestao = (isAdmin: boolean, raw: Record<string, unknown> | null, url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <SectionTabs tabs={gestaoTabs(isAdmin, raw ? rowToAccess(raw) : NO_FIN_ACCESS)} label="Seções de Gestão" />
      </MemoryRouter>,
    );
  const names = () => screen.queryAllByRole("link").map((a) => a.textContent);

  it("admin vê as 4; a ativa vem pelo prefixo da rota", () => {
    renderGestao(true, null, "/financeiro/vendas");
    expect(names()).toEqual(["Visão geral", "Financeiro", "Estoque", "Documentos"]);
    expect(screen.getByRole("link", { name: "Financeiro" })).toHaveAttribute("aria-current", "page");
  });
  it("Recepção vê Financeiro e Documentos", () => {
    renderGestao(false, { roles: [{ role: "recepcao", all_units: true, unit_ids: [] }], can: { sales_read: true, cash_read: true, doc_list: true } }, "/documentos");
    expect(names()).toEqual(["Financeiro", "Documentos"]);
  });
  it("Financeiro vê Financeiro e Estoque", () => {
    renderGestao(false, { roles: [{ role: "financeiro", all_units: true, unit_ids: [] }], can: { services_read: true, stock_items_read: true } }, "/estoque/saldo");
    expect(names()).toEqual(["Financeiro", "Estoque"]);
  });
  it("profissional sem papel financeiro vê só Documentos; sem acesso não renderiza a barra", () => {
    renderGestao(false, { can: { doc_list: true } }, "/documentos");
    expect(names()).toEqual(["Documentos"]);
  });
  it("sem nenhuma sub-aba não renderiza nada", () => {
    const { container } = render(
      <MemoryRouter>
        <SectionTabs tabs={[]} label="x" />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
