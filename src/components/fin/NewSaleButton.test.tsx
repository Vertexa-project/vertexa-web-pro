import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { NewSaleButton } from "./NewSaleButton";

const state = vi.hoisted(() => ({ can: {} as Record<string, boolean> }));
vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: false, roles: [], can: state.can } }) }));

describe("Botão «Nova venda» na ficha do paciente", () => {
  it("quem lança venda vê o botão, que leva ao Financeiro › Vendas com o paciente", () => {
    state.can = { sales_write: true };
    render(<MemoryRouter><NewSaleButton patientId="p1" patientName="Mariana Teste" /></MemoryRouter>);
    const a = screen.getByRole("link", { name: /Nova venda/ });
    expect(a.getAttribute("href")).toBe("/financeiro/vendas?novo=1&paciente=p1&nome=Mariana+Teste");
  });
  it("sem permissão de venda o botão não aparece", () => {
    state.can = { sales_read: true };
    render(<MemoryRouter><NewSaleButton patientId="p1" patientName="X" /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: /Nova venda/ })).toBeNull();
  });
});
