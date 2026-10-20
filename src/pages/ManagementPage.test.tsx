import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getManagementOverview: vi.fn(), getProfessionalRoster: vi.fn(), transferPatients: vi.fn(), admin: true }));
vi.mock("@/lib/api/management", () => api);
vi.mock("@/hooks/useClinicBrand", () => ({ useClinicBrand: () => ({ data: { clinicId: "c1", name: "Clínica" } }) }));
vi.mock("@/hooks/useIsClinicAdmin", () => ({ useIsClinicAdmin: () => ({ isClinicAdmin: api.admin, isLoading: false }) }));
const { ManagementPage } = await import("./ManagementPage");

const PRO = (id: string, name: string, patients: number, o: Record<string, unknown> = {}) => ({ professional_id: id, name, clinic_role: "member", patients, em_risco: 1, atencao: 2, avg_adherence: 55, idle: 1, ...o });
const OV = {
  idle_days: 7, patients: 9, unassigned: 2,
  professionals: [PRO("e1", "Ana Nutri", 6, { clinic_role: "admin" }), PRO("e2", "Bia Nutri", 3, { avg_adherence: null })],
  new_by_month: [{ month: "2026-05", n: 0 }, { month: "2026-06", n: 1 }, { month: "2026-07", n: 2 }, { month: "2026-08", n: 4 }, { month: "2026-09", n: 1 }, { month: "2026-10", n: 3 }],
  stopped: [{ patient_id: "t9", name: "Paulo Parado", idle_days: 21, professionals: ["Ana Nutri"] }, { patient_id: "t8", name: "Sem Dono", idle_days: 9, professionals: [] }],
};
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ManagementPage /></MemoryRouter></QueryClientProvider>);

beforeEach(() => {
  api.admin = true;
  api.getManagementOverview.mockReset().mockResolvedValue(OV);
  api.getProfessionalRoster.mockReset().mockResolvedValue([{ patient_id: "t1", full_name: "Pac Um", idle_days: 0 }, { patient_id: "t2", full_name: "Pac Dois", idle_days: 12 }]);
  api.transferPatients.mockReset().mockResolvedValue({ moved: 1, skipped: 0 });
});

describe("ManagementPage", () => {
  it("não-admin vê aviso e nenhuma consulta é feita", async () => {
    api.admin = false;
    renderPage();
    expect(await screen.findByRole("note")).toBeTruthy();
    expect(api.getManagementOverview).not.toHaveBeenCalled();
  });
  it("mostra carteira por profissional, parados e pacientes sem profissional", async () => {
    renderPage();
    const sec = await screen.findByRole("region", { name: "Carteira por profissional" });
    expect(within(sec).getByText("Ana Nutri")).toBeTruthy();
    expect(within(sec).getByText("55%")).toBeTruthy();
    expect(within(sec).getByText("—")).toBeTruthy(); // adesão nula
    expect(screen.getByText("Paulo Parado")).toBeTruthy();
    expect(screen.getAllByText("Sem profissional").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 pacientes estão sem profissional/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Novos pacientes/ })).toBeTruthy();
    // barras com altura real em px (o maior mês = 96px; mês vazio = mínimo de 4px)
    const heights = screen.getAllByTestId("month-bar").map((b) => (b as HTMLElement).style.height);
    expect(heights).toEqual(["4px", "24px", "48px", "96px", "24px", "72px"]);
  });
  it("trocar o limite de dias refaz a consulta", async () => {
    renderPage();
    await screen.findByText("Paulo Parado");
    await userEvent.click(screen.getByRole("button", { name: "30+ dias" }));
    await waitFor(() => expect(api.getManagementOverview).toHaveBeenLastCalledWith("c1", 30));
  });
  it("transferir: escolhe pacientes, confirma e envia só os selecionados", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Transferir pacientes de Ana Nutri" }));
    await screen.findByLabelText("Pac Um");
    await userEvent.selectOptions(screen.getByLabelText("Para"), "e2");
    await userEvent.click(screen.getByLabelText("Pac Um"));
    fireEvent.change(screen.getByLabelText("Motivo (opcional)"), { target: { value: "agenda" } });
    await userEvent.click(screen.getByRole("button", { name: "Revisar e transferir" }));
    expect(api.transferPatients).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Transferir 1 paciente de Ana Nutri para Bia Nutri/);
    await userEvent.click(screen.getByRole("button", { name: "Transferir agora" }));
    await waitFor(() => expect(api.transferPatients).toHaveBeenCalled());
    expect(api.transferPatients.mock.calls[0][0]).toEqual({ fromId: "e1", toId: "e2", patientIds: ["t1"], reason: "agenda" });
    expect((await screen.findByRole("status")).textContent).toMatch(/1 paciente transferido/);
  });
  it("transferir todos envia lista nula (carteira inteira)", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Transferir pacientes de Ana Nutri" }));
    await screen.findByLabelText("Pac Um");
    await userEvent.selectOptions(screen.getByLabelText("Para"), "e2");
    await userEvent.click(screen.getByLabelText(/Selecionar todos/));
    await userEvent.click(screen.getByRole("button", { name: "Revisar e transferir" }));
    await userEvent.click(await screen.findByRole("button", { name: "Transferir agora" }));
    await waitFor(() => expect(api.transferPatients).toHaveBeenCalled());
    expect(api.transferPatients.mock.calls[0][0].patientIds).toBeNull();
  });
  it("transferir sem destino ou sem seleção bloqueia", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Transferir pacientes de Ana Nutri" }));
    await screen.findByLabelText("Pac Um");
    await userEvent.click(screen.getByRole("button", { name: "Revisar e transferir" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/destino/);
    await userEvent.selectOptions(screen.getByLabelText("Para"), "e2");
    await userEvent.click(screen.getByRole("button", { name: "Revisar e transferir" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ao menos um paciente/);
    expect(api.transferPatients).not.toHaveBeenCalled();
  });
  it("com um só profissional não oferece transferência", async () => {
    api.getManagementOverview.mockResolvedValue({ ...OV, professionals: [PRO("e1", "Ana Nutri", 6)] });
    renderPage();
    await screen.findByRole("region", { name: "Carteira por profissional" });
    expect(screen.queryByRole("button", { name: /Transferir/ })).toBeNull();
  });
});
