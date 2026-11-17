import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "@/lib/domain/reengagement";

const api = vi.hoisted(() => ({ getReengagementConfig: vi.fn(), saveReengagementConfig: vi.fn(), listReengagementOverview: vi.fn(), listReengagementHistory: vi.fn(), getPatientReengagementLine: vi.fn() }));
vi.mock("@/lib/api/reengagement", () => api);
const { ReengagementSection } = await import("./ReengagementSection");
const { ReengagementLine } = await import("@/components/patient/ReengagementLine");

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const ROWS = [
  { patient_id: "p1", full_name: "Mariana Teste", last_interaction_day: "2026-11-10", idle_days: 7, steps_sent: 1, last_step: 1, last_sent_on: "2026-11-15", state: "em_andamento" },
  { patient_id: "p2", full_name: "Camila Teste", last_interaction_day: "2026-11-16", idle_days: 1, steps_sent: 0, last_step: 2, last_sent_on: "2026-11-14", state: "respondeu" },
];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getReengagementConfig.mockResolvedValue(DEFAULT_CONFIG);
  api.saveReengagementConfig.mockResolvedValue(undefined);
  api.listReengagementOverview.mockResolvedValue(ROWS);
  api.listReengagementHistory.mockResolvedValue([{ id: "h1", patient_id: "p1", step: 1, sent_on: "2026-11-15", title: "Oi, Mariana, tudo bem?", simulated: true }]);
});

describe("ReengagementSection", () => {
  it("mostra a sequência, a situação por paciente e o histórico", async () => {
    wrap(<ReengagementSection clinicId="c1" isAdmin />);
    expect(await screen.findByText("Mensagem 2 · 8 dias sem interação")).toBeTruthy();
    expect(screen.getByText("Desligada")).toBeTruthy();
    const tbl = await screen.findByRole("table", { name: "Pacientes no reengajamento" });
    expect(within(tbl).getByText("Mariana Teste")).toBeTruthy();
    expect(within(tbl).getByText("Em andamento")).toBeTruthy();
    expect(within(tbl).getByText("Parou: voltou a interagir")).toBeTruthy();
    const hist = await screen.findByRole("list", { name: "Histórico de reengajamento" });
    expect(within(hist).getByText("Mariana Teste")).toBeTruthy();
    expect(within(hist).getByText("Teste")).toBeTruthy();
    expect(within(hist).getByText(/Mensagem 1 de 3/)).toBeTruthy();
  });
  it("1 dia sem interação fica no singular (nunca '1 dias')", async () => {
    wrap(<ReengagementSection clinicId="c1" isAdmin />);
    const tbl = await screen.findByRole("table", { name: "Pacientes no reengajamento" });
    expect(within(tbl).getAllByText(/^1 dia( sem interação)?$/).length).toBeGreaterThan(0);
    expect(within(tbl).queryByText(/1 dias/)).toBeNull();
    expect(within(tbl).getAllByText(/^7 dias( sem interação)?$/).length).toBeGreaterThan(0);
  });
  it("admin liga a sequência (grava a configuração inteira com isActive=true)", async () => {
    wrap(<ReengagementSection clinicId="c1" isAdmin />);
    await userEvent.click(await screen.findByRole("switch", { name: "Ligar Reengajamento" }));
    await waitFor(() => expect(api.saveReengagementConfig).toHaveBeenCalled());
    expect(api.saveReengagementConfig.mock.calls[0]![0]).toBe("c1");
    expect(api.saveReengagementConfig.mock.calls[0]![1]).toMatchObject({ isActive: true, steps: DEFAULT_CONFIG.steps });
  });
  it("admin edita dias e mensagem; dias fora de ordem não salvam", async () => {
    wrap(<ReengagementSection clinicId="c1" isAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Reengajamento" }));
    const day2 = await screen.findByLabelText("Dias sem interação", { selector: "#reeng-day-1" });
    await userEvent.clear(day2); await userEvent.type(day2, "4");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/crescentes/);
    expect(api.saveReengagementConfig).not.toHaveBeenCalled();
    await userEvent.clear(day2); await userEvent.type(day2, "9");
    const title1 = document.querySelector<HTMLInputElement>("#reeng-title-0")!;
    await userEvent.clear(title1); await userEvent.type(title1, "Olá!");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.saveReengagementConfig).toHaveBeenCalled());
    const sent = api.saveReengagementConfig.mock.calls[0]![1];
    expect(sent.steps.map((s: { day: number }) => s.day)).toEqual([5, 9, 12]);
    expect(sent.steps[0].title).toBe("Olá!");
  });
  it("quem não é admin vê tudo e não tem botões de editar nem de ligar", async () => {
    wrap(<ReengagementSection clinicId="c1" isAdmin={false} />);
    await screen.findByText("Mensagem 1 · 5 dias sem interação");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
  });
  it("ligar recusado pelo banco mostra aviso", async () => {
    api.saveReengagementConfig.mockRejectedValue(new Error("42501"));
    wrap(<ReengagementSection clinicId="c1" isAdmin />);
    await userEvent.click(await screen.findByRole("switch", { name: "Ligar Reengajamento" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/administrador/);
  });
});

describe("ReengagementLine (ficha)", () => {
  it("mostra 'mensagem 2 de 3 enviada em dd/mm'", async () => {
    api.getPatientReengagementLine.mockResolvedValue({ step: 2, sent_on: "2026-11-24", state: "em_andamento" });
    wrap(<ReengagementLine patientId="p1" />);
    expect(await screen.findByText("Reengajamento: mensagem 2 de 3 enviada em 24/11")).toBeTruthy();
  });
  it("paciente que voltou a interagir: diz que parou", async () => {
    api.getPatientReengagementLine.mockResolvedValue({ step: 1, sent_on: "2026-11-24", state: "respondeu" });
    wrap(<ReengagementLine patientId="p1" />);
    expect(await screen.findByText(/parou porque o paciente voltou a interagir/)).toBeTruthy();
  });
  it("sem envio ou sem permissão: não mostra nada", async () => {
    api.getPatientReengagementLine.mockResolvedValue(null);
    const { container } = wrap(<ReengagementLine patientId="p1" />);
    await waitFor(() => expect(api.getPatientReengagementLine).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
