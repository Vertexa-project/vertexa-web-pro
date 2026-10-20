import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listCampaigns: vi.fn(), ensureClinicCampaigns: vi.fn(), updateCampaign: vi.fn(), listSendCounts: vi.fn(),
  listBroadcasts: vi.fn(), previewBroadcast: vi.fn(), sendBroadcast: vi.fn(),
  admin: true,
}));
vi.mock("@/lib/api/campaigns", () => api);
vi.mock("@/hooks/useClinicBrand", () => ({ useClinicBrand: () => ({ data: { clinicId: "c1", name: "Clínica" } }) }));
vi.mock("@/hooks/useIsClinicAdmin", () => ({ useIsClinicAdmin: () => ({ isClinicAdmin: api.admin }) }));
const { CampaignsPage } = await import("./CampaignsPage");

const C = (trigger: string, name: string, o: Record<string, unknown> = {}) => ({ id: trigger, clinic_id: "c1", name, trigger, title: `T ${name}`, message_template: `Msg ${name} {nome}`, days_threshold: null, is_active: false, created_at: "2026-10-01", ...o });
const LIST = [C("welcome", "Boas-vindas"), C("checkin", "Check-in periódico", { days_threshold: 15, is_active: true }), C("birthday", "Aniversário")];
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CampaignsPage /></QueryClientProvider>);

beforeEach(() => {
  Object.values(api).forEach((f) => typeof f === "function" && "mockReset" in f && (f as ReturnType<typeof vi.fn>).mockReset());
  api.admin = true;
  api.listCampaigns.mockResolvedValue(LIST);
  api.listSendCounts.mockResolvedValue({ checkin: 3 });
  api.listBroadcasts.mockResolvedValue([]);
  api.ensureClinicCampaigns.mockResolvedValue(5);
  api.updateCampaign.mockResolvedValue(undefined);
  api.previewBroadcast.mockResolvedValue(4);
  api.sendBroadcast.mockResolvedValue({ recipients: 4 });
});

describe("CampaignsPage", () => {
  it("lista as automações com estado, contagem de envios e texto", async () => {
    renderPage();
    const sec = await screen.findByRole("region", { name: "Automações" });
    expect(within(sec).getByText("Boas-vindas")).toBeTruthy();
    expect(within(sec).getByText("3 enviadas em 30 dias")).toBeTruthy();
    expect(within(sec).getAllByText("Ligada")).toHaveLength(1);
    expect(within(sec).getAllByText("Desligada")).toHaveLength(2);
    expect(within(sec).getByText(/A cada 15 dias/)).toBeTruthy();
  });
  it("admin liga uma automação", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("switch", { name: "Ligar Boas-vindas" }));
    await waitFor(() => expect(api.updateCampaign).toHaveBeenCalled());
    expect(api.updateCampaign.mock.calls[0][0]).toEqual({ id: "welcome", isActive: true });
  });
  it("membro vê tudo mas não tem botões de editar nem de ligar", async () => {
    api.admin = false;
    renderPage();
    await screen.findByText("Boas-vindas");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(api.ensureClinicCampaigns).not.toHaveBeenCalled();
  });
  it("admin sem modelos: cria os modelos padrão uma vez", async () => {
    api.listCampaigns.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(api.ensureClinicCampaigns).toHaveBeenCalledWith("c1"));
    expect(api.ensureClinicCampaigns).toHaveBeenCalledTimes(1);
  });
  it("admin com modelos já criados não chama a criação", async () => {
    renderPage();
    await screen.findByText("Boas-vindas");
    expect(api.ensureClinicCampaigns).not.toHaveBeenCalled();
  });
  it("editar valida e salva título, mensagem e dias", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Editar Check-in periódico" }));
    fireEvent.change(screen.getByLabelText("Repetir a cada (dias)"), { target: { value: "0" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/1 a 365/);
    expect(api.updateCampaign).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Repetir a cada (dias)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá {nome}" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateCampaign).toHaveBeenCalled());
    expect(api.updateCampaign.mock.calls[0][0]).toEqual({ id: "checkin", title: "T Check-in periódico", body: "Olá {nome}", days: 20 });
  });
  it("disparo: mostra quantos recebem, pede confirmação e só então envia", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Novo disparo/ }));
    await screen.findByText("4 pacientes vão receber.");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Aviso" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi {nome}" } });
    await userEvent.click(screen.getByRole("button", { name: "Revisar e enviar" }));
    expect(api.sendBroadcast).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Confirma o envio/);
    await userEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    await waitFor(() => expect(api.sendBroadcast).toHaveBeenCalled());
    expect(api.sendBroadcast.mock.calls[0][0]).toEqual({ clinicId: "c1", audience: "mine", days: null, title: "Aviso", body: "Oi {nome}" });
    expect((await screen.findByRole("status")).textContent).toMatch(/enviada para 4 pacientes/);
  });
  it("disparo: audiência vazia bloqueia o envio", async () => {
    api.previewBroadcast.mockResolvedValue(0);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Novo disparo/ }));
    await screen.findByText("Nenhum paciente nesta audiência.");
    expect((screen.getByRole("button", { name: "Revisar e enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("disparo: membro só vê audiências dos seus pacientes; admin vê as da clínica", async () => {
    api.admin = false;
    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Novo disparo/ }));
    expect(screen.queryByRole("option", { name: "Todos os pacientes da clínica" })).toBeNull();
    expect(screen.getByRole("option", { name: "Meus pacientes" })).toBeTruthy();
    unmount();
    api.admin = true;
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Novo disparo/ }));
    expect(screen.getByRole("option", { name: "Todos os pacientes da clínica" })).toBeTruthy();
  });
  it("disparo de inativos pede os dias e manda no preview", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Novo disparo/ }));
    await userEvent.selectOptions(screen.getByLabelText("Para quem"), "mine_inactive");
    fireEvent.change(screen.getByLabelText("Dias sem registrar"), { target: { value: "14" } });
    await waitFor(() => expect(api.previewBroadcast).toHaveBeenLastCalledWith("c1", "mine_inactive", 14));
  });
});
