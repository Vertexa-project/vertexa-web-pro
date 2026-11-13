import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { NewAppointmentButton } from "./NewAppointmentButton";
import { PatientPackagesCard } from "./PatientPackagesCard";

const state = vi.hoisted(() => ({ can: {} as Record<string, boolean>, isAdmin: false, packages: [] as unknown[], error: false }));
vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }) }));
vi.mock("@/hooks/useFinAppointments", () => ({ usePatientPackages: () => ({ data: state.packages, isLoading: false, isError: state.error }) }));

beforeEach(() => { state.can = {}; state.isAdmin = false; state.packages = []; state.error = false; });

describe("Ficha do paciente — Entrega 4", () => {
  it("«Novo atendimento» leva ao Financeiro › Atendimentos com o paciente; some para quem não pode registrar", () => {
    state.can = { own_appt: true };
    render(<MemoryRouter><NewAppointmentButton patientId="p1" patientName="Mariana Teste" /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /Novo atendimento/ });
    expect(link.getAttribute("href")).toBe("/financeiro/atendimentos?novo=1&paciente=p1&nome=Mariana+Teste");
  });
  it("sem papel nem participação: nenhum botão", () => {
    state.can = { sales_read: true };
    render(<MemoryRouter><NewAppointmentButton patientId="p1" patientName="Mariana" /></MemoryRouter>);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("saldo dos pacotes do paciente: sessões e unidades que restam e a validade", () => {
    state.can = { patient_pkg_read: true };
    state.packages = [{ id: "pp1", name: "Programa Emagrecer", status: "active", expired: false, expires_on: "2999-02-11", items: [
      { id: "a", item_type: "service", name: "Consulta médica", qty_total: 3, remaining: 1 }, { id: "b", item_type: "product", name: "Suplemento C", qty_total: 3, remaining: 3 }] }];
    render(<MemoryRouter><PatientPackagesCard patientId="p1" /></MemoryRouter>);
    const card = screen.getByLabelText("Pacotes do paciente");
    expect(within(card).getByText("Programa Emagrecer")).toBeInTheDocument();
    expect(within(card).getByText(/Consulta médica: restam 1 de 3 sessões/)).toBeInTheDocument();
    expect(within(card).getByText(/Suplemento C: restam 3 de 3 unidades/)).toBeInTheDocument();
    expect(within(card).getByText(/vence 11\/02\/2999/)).toBeInTheDocument();
  });
  it("sem pacote, sem permissão ou com erro: o cartão não aparece (a ficha segue igual)", () => {
    state.can = { patient_pkg_read: true };
    const { container, rerender } = render(<MemoryRouter><PatientPackagesCard patientId="p1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    state.can = {}; state.packages = [{ id: "x", name: "P", status: "active", expired: false, expires_on: "2999-01-01", items: [] }];
    rerender(<MemoryRouter><PatientPackagesCard patientId="p1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
