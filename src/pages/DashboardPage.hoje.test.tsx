import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const hoisted = vi.hoisted(() => ({ list: [] as unknown[], reminders: [] as unknown[], openWith: vi.fn() }));
vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", access: { isAdmin: true, roles: [], can: {} }, isLoading: false }) }));
vi.mock("@/hooks/usePatients", () => ({ useListPatients: () => ({ data: hoisted.list, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr1", clinicId: "c1" } }),
  useCurrentProfessionalName: () => ({ data: "Dra. Juliana Souza" }),
}));
vi.mock("@/hooks/useAppointments", () => ({
  useAgenda: () => ({
    isLoading: false, isError: false, refetch: vi.fn(),
    items: [
      { id: "internal:1", source: "internal", title: "Retorno", starts_at: "2026-11-16T12:30:00Z", ends_at: null, all_day: false, patient_name: "Camila Teste", professional_name: null, appointmentStatus: "confirmado" },
      { id: "internal:2", source: "internal", title: "Consulta", starts_at: "2026-11-16T14:00:00Z", ends_at: null, all_day: false, patient_name: "Fulano", professional_name: null, appointmentStatus: "desmarcado" },
      { id: "google:3", source: "google", title: "Almoço com fornecedor", starts_at: "2026-11-16T15:00:00Z", ends_at: null, all_day: false, patient_name: null, professional_name: null },
    ],
  }),
}));
vi.mock("@/hooks/usePatientReminders", () => ({ useOpenReminders: () => ({ data: hoisted.reminders, isLoading: false, isError: false }) }));
vi.mock("@/components/dashboard/AdherenceChart", () => ({ AdherenceChart: () => null }));

import { VertexaAiContext, type VertexaAiContextValue } from "@/components/vertexa-ai/vertexa-ai-context";
import { DashboardPage } from "./DashboardPage";

const mk = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, goal: null, current_weight: null, start_date: null, birth_date: null,
  profile: { full_name: name, email: null, avatar_url: null, avatar_path: null },
  snapshot: null, professionals: [], lastActivityAt: null, lastWeightAt: null, lastPhotoAt: null, lastWorkoutAt: null, ...extra,
});
const old = () => new Date(Date.now() - 12 * 86400000).toISOString();

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}{l.search}</p>;
}
const ai: VertexaAiContextValue = {
  open: false, setOpen: vi.fn(), openWith: hoisted.openWith, screen: { screen: "hoje", patientId: null, tab: null },
  contextText: "Hoje", messages: [], pending: false, ask: vi.fn(), actOnDraft: vi.fn(), mode: null,
};

function renderHoje(withAi = true) {
  return render(
    <MemoryRouter>
      <VertexaAiContext.Provider value={withAi ? ai : undefined}>
        <DashboardPage />
        <Where />
      </VertexaAiContext.Provider>
    </MemoryRouter>,
  );
}

describe("Hoje no formato do protótipo", () => {
  it("saudação, data e resumo do dia; KPIs e seções reais preservados", () => {
    hoisted.list = [
      mk("11111111-1111-4111-8111-111111111111", "Mariana Teste", { snapshot: { status: "em_risco", weekly_completion_rate: 30, score: 40, level: null, calculated_at: "2026-11-15" }, lastWeightAt: old(), lastActivityAt: old() }),
      mk("22222222-2222-4222-8222-222222222222", "Camila Teste"),
    ];
    renderHoje();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^(Bom dia|Boa tarde|Boa noite), Dra\. Juliana$/);
    expect(screen.getByText(/segunda-feira, \d+ de .+ · 2 compromissos · 2 pacientes precisam de você/)).toBeTruthy();
    for (const k of ["Pacientes ativos", "Em risco", "Em atenção", "Adesão média", "Com pendências"]) expect(screen.getByText(k)).toBeTruthy();
    for (const t of ["Foco do dia", "Agenda de hoje", "Para reativar", "Pendências de registro", "Vertexa IA sugere", "Adesão semanal por paciente"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
  });

  it("agenda de hoje: horário de Brasília, desmarcado fora, Google marcado; sem dado fictício", () => {
    hoisted.list = [];
    renderHoje();
    const agenda = screen.getByText("Agenda de hoje").closest('[class*="rounded"]') as HTMLElement;
    expect(within(agenda).getByText("09:30")).toBeTruthy();
    expect(within(agenda).getByText("Camila Teste")).toBeTruthy();
    expect(within(agenda).queryByText("Fulano")).toBeNull();
    expect(within(agenda).getByText("Almoço com fornecedor")).toBeTruthy();
    expect(within(agenda).getByText("Google")).toBeTruthy();
    expect(within(agenda).getByRole("button", { name: "Ver semana" })).toBeTruthy();
  });

  it("Foco do dia: ação por motivo preservada (links certos), nome inteiro, nunca 'Tratar'", () => {
    const id1 = "11111111-1111-4111-8111-111111111111";
    const id2 = "22222222-2222-4222-8222-222222222222";
    hoisted.list = [
      mk(id1, "Mariana Teste da Silva Pereira", { snapshot: { status: "atencao", weekly_completion_rate: 41, score: 50, level: null, calculated_at: "2026-11-15" }, lastWeightAt: new Date().toISOString(), lastPhotoAt: new Date().toISOString(), lastWorkoutAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() }),
      mk(id2, "Camila Teste"),
    ];
    renderHoje();
    const foco = screen.getByText("Foco do dia").closest('[class*="rounded"]') as HTMLElement;
    expect(within(foco).getByText("Mariana Teste da Silva Pereira")).toBeTruthy();
    expect(within(foco).getByText("Adesão caiu (41% na semana)")).toBeTruthy();
    fireEvent.click(within(foco).getByRole("button", { name: /^Preparar retorno/ }));
    expect(screen.getByTestId("where").textContent).toBe(`/pacientes/${id1}`);
    fireEvent.click(within(foco).getByRole("button", { name: /^Chamar no app/ }));
    expect(screen.getByTestId("where").textContent).toBe(`/mensagens?patient=${id2}`);
    expect(screen.queryByRole("button", { name: /Tratar/ })).toBeNull();
  });

  it("Preparar meu dia e sugestões da tela abrem a Vertexa IA com o pedido", () => {
    hoisted.list = [mk("33333333-3333-4333-8333-333333333333", "Paulo Novo")];
    hoisted.openWith.mockClear();
    renderHoje();
    fireEvent.click(screen.getByRole("button", { name: "Preparar meu dia" }));
    expect(hoisted.openWith).toHaveBeenCalledWith("Quem precisa de mim hoje?");
    fireEvent.click(screen.getByRole("button", { name: "Quem eu devo ligar hoje?" }));
    expect(hoisted.openWith).toHaveBeenLastCalledWith("Quem eu devo ligar hoje?");
  });

  it("sem o painel (fora do AppShell) o Hoje segue funcionando", () => {
    hoisted.list = [];
    renderHoje(false);
    expect(screen.queryByText("Vertexa IA sugere")).toBeNull();
    expect(screen.getByText("Foco do dia")).toBeTruthy();
  });
  it("Exames e retornos (A2): só o que entrou na janela da equipe, atrasado primeiro, com a data pt-BR; clique abre a ficha", () => {
    hoisted.list = [];
    const day = (n: number) => {
      const d = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const base = { notify_patient: true, notify_days_before: 7, pro_notify_days_before: 7, message_template: null, done_at: null };
    hoisted.reminders = [
      { ...base, id: "r1", patient_id: "p-longe", kind: "return", title: null, due_on: day(40), patientName: "Longe Demais" },
      { ...base, id: "r2", patient_id: "p-ana", kind: "return", title: null, due_on: day(3), patientName: "Ana Teste" },
      { ...base, id: "r3", patient_id: "p-bia", kind: "exam", title: "Hemograma", due_on: day(-2), patientName: "Bia Teste" },
    ];
    renderHoje();
    const card = screen.getByText("Exames e retornos").closest("div[class*='rounded']") as HTMLElement;
    const rows = within(card).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Bia Teste"), expect.stringContaining("Ana Teste")]);
    expect(within(card).queryByText("Longe Demais")).toBeNull();
    // o prazo fica na mesma linha do título; a data, na linha de baixo
    expect(within(rows[0]).getByText("Exame: Hemograma · há 2 dias")).toBeTruthy();
    expect(within(rows[1]).getByText("Retorno · em 3 dias")).toBeTruthy();
    expect(rows[1].textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    fireEvent.click(rows[1]);
    expect(screen.getByTestId("where").textContent).toBe("/pacientes/p-ana");
    hoisted.reminders = [];
  });
});
