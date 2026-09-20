import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PlatformBillingLayout } from "./PlatformBillingLayout";

describe("PlatformBillingLayout", () => {
  it("exposes the canonical billing workbench without Relatórios CSV", () => {
    render(
      <MemoryRouter initialEntries={["/platform/billing"]}>
        <Routes>
          <Route path="/platform/billing" element={<PlatformBillingLayout />}>
            <Route index element={<div>visão</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Faturamento da plataforma" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Faturamento da plataforma" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contratos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cobranças" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagamentos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inadimplência" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pix Automático" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Eventos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Relatórios" })).toBeInTheDocument();
    expect(screen.getByText(/Pix recusado não é atraso financeiro/)).toBeInTheDocument();
  });
});
