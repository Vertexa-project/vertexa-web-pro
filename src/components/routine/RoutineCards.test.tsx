import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  settings: null as unknown, save: vi.fn(async () => undefined), routine: null as unknown, mission: null as unknown,
  override: vi.fn(async () => undefined), clear: vi.fn(async () => undefined), start: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/routine", () => ({
  getClinicRoutineSettings: vi.fn(async () => api.settings), saveClinicRoutineSettings: api.save,
  getPatientRoutine: vi.fn(async () => api.routine), getPatientMission: vi.fn(async () => api.mission),
  savePatientRoutineOverride: api.override, clearPatientRoutineOverride: api.clear, startPatientMission: api.start,
}));
import { RoutineSettingsCard } from "./RoutineSettingsCard";
import { MissionCard, RoutineCard } from "./PatientRoutineCards";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); api.settings = null; });

describe("Configurações > Rotina do paciente", () => {
  it("clínica sem configuração aparece DESLIGADA, com o padrão da Juliana", async () => {
    wrap(<RoutineSettingsCard clinicId="c1" />);
    expect(await screen.findByRole("switch", { name: "Ligar a rotina" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Ligar a missão da 1ª semana" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Feedback da semana: dia da semana")).toHaveValue("5");
    expect(screen.getByLabelText("Foto de evolução: quando pedir")).toHaveValue("monthly");
  });
  it("liga, muda o dia e salva só pelo botão", async () => {
    wrap(<RoutineSettingsCard clinicId="c1" />);
    fireEvent.click(await screen.findByRole("switch", { name: "Ligar a rotina" }));
    fireEvent.change(screen.getByLabelText("Feedback da semana: dia da semana"), { target: { value: "3" } });
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina" }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const [clinic, body] = api.save.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(clinic).toBe("c1");
    expect(body).toMatchObject({ routine_enabled: true, mission_enabled: false, feedback_weekday: 3, feedback_period: "weekly" });
    expect(await screen.findByText("Salvo.")).toBeInTheDocument();
  });
  it("passo da missão é editável (texto e liga/desliga) e vai no salvar", async () => {
    wrap(<RoutineSettingsCard clinicId="c1" />);
    const label = await screen.findByLabelText("Texto do passo photo_front");
    fireEvent.change(label, { target: { value: "Foto de frente, de roupa de banho" } });
    fireEvent.click(screen.getByLabelText("Usar o passo Foto de lado"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina" }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const steps = (api.save.mock.calls[0] as unknown as [string, { mission_steps: Array<{ key: string; label: string; enabled: boolean }> }])[1].mission_steps;
    expect(steps.find((s) => s.key === "photo_front")?.label).toBe("Foto de frente, de roupa de banho");
    expect(steps.find((s) => s.key === "photo_side")?.enabled).toBe(false);
  });
  it("missão ligada sem nenhum passo ligado não salva", async () => {
    wrap(<RoutineSettingsCard clinicId="c1" />);
    fireEvent.click(await screen.findByRole("switch", { name: "Ligar a missão da 1ª semana" }));
    for (const n of ["Foto de frente", "Foto de lado", "Foto de costas", "Peso na balança, em jejum", "Foto dos suplementos que você usa", "Bioimpedância (se você tiver)"]) fireEvent.click(screen.getByLabelText(`Usar o passo ${n}`));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina" }));
    expect(await screen.findByText("Deixe pelo menos um passo ligado na missão.")).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });
});

const routineView = (over: Record<string, unknown> = {}) => ({
  enabled: true, source: "clinic", current: [{ key: "feedback", label: "Feedback da semana", due_on: "2026-11-13", state: "overdue" }],
  items: [{ key: "feedback", label: "Feedback da semana", period: "weekly", weekday: 5, occurrences: [
    { date: "2026-11-06", state: "done", done_on: "2026-11-07" }, { date: "2026-11-13", state: "overdue", done_on: null }] }],
  last_feedback: { note: "Semana puxada, mas segui a dieta.", at: "2026-11-07T12:00:00Z" }, ...over,
});

describe("Ficha > cartão Rotina", () => {
  it("mostra padrão da clínica, o pendente, o que foi feito e o último feedback", async () => {
    api.routine = routineView();
    wrap(<RoutineCard patientId="p1" patientName="Mariana" />);
    expect(await screen.findByText("Padrão da clínica")).toBeInTheDocument();
    expect(screen.getByText("1 pendente")).toBeInTheDocument();
    expect(screen.getByText("Pendente desde 13/11.")).toBeInTheDocument();
    expect(screen.getByText(/06\/11 · feito em 07\/11/)).toBeInTheDocument();
    expect(screen.getByText(/Semana puxada/)).toBeInTheDocument();
  });
  it("rotina desligada na clínica orienta onde ligar e não oferece exceção", async () => {
    api.routine = { enabled: false, source: "clinic_off", items: [], current: [] };
    wrap(<RoutineCard patientId="p1" patientName="Mariana" />);
    expect(await screen.findByText(/Configurações → Rotina do paciente/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajustar rotina deste paciente" })).toBeNull();
  });
  it("exceção: desligar para este paciente chama a RPC de exceção", async () => {
    api.routine = routineView();
    wrap(<RoutineCard patientId="p1" patientName="Mariana" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar rotina deste paciente" }));
    fireEvent.click(await screen.findByLabelText(/Não pedir rotina a este paciente/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina do paciente" }));
    await waitFor(() => expect(api.override).toHaveBeenCalledWith("p1", { mode: "off" }));
  });
  it("exceção: voltar ao padrão limpa a exceção", async () => {
    api.routine = routineView({ source: "custom" });
    wrap(<RoutineCard patientId="p1" patientName="Mariana" />);
    expect(await screen.findByText("Personalizada para este paciente")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar rotina deste paciente" }));
    fireEvent.click(await screen.findByLabelText(/Seguir o padrão da clínica/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina do paciente" }));
    await waitFor(() => expect(api.clear).toHaveBeenCalledWith("p1"));
  });
});

describe("Ficha > cartão Missão da 1ª semana", () => {
  it("mostra x de y, passos feitos e pendentes", async () => {
    api.mission = { enabled: true, started: true, days: 7, ends_on: "2026-11-24", done_count: 2, total: 3, completed: false, steps: [
      { key: "photo_front", label: "Foto de frente", allow_skip: false, done: true, done_on: "2026-11-17" },
      { key: "weight", label: "Peso na balança, em jejum", allow_skip: false, done: true, done_on: "2026-11-18" },
      { key: "bio", label: "Bioimpedância", allow_skip: true, done: false, done_on: null }] };
    wrap(<MissionCard patientId="p1" />);
    expect(await screen.findByText("Missão da 1ª semana: 2 de 3")).toBeInTheDocument();
    expect(screen.getByText("pendente")).toBeInTheDocument();
    expect(screen.queryByText("Pronto para a consulta")).toBeNull();
  });
  it("concluída: 'Concluída em dd/mm' e selo de pronto para a consulta", async () => {
    api.mission = { enabled: true, started: true, days: 7, ends_on: "2026-11-24", done_count: 1, total: 1, completed: true, completed_on: "2026-11-19", steps: [{ key: "weight", label: "Peso", allow_skip: false, done: true, done_on: "2026-11-19" }] };
    wrap(<MissionCard patientId="p1" />);
    expect(await screen.findByText("Concluída em 19/11")).toBeInTheDocument();
    expect(screen.getByText("Pronto para a consulta")).toBeInTheDocument();
  });
  it("paciente que já existia: botão para iniciar a missão", async () => {
    api.mission = { enabled: true, started: false, days: 7 };
    wrap(<MissionCard patientId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar missão da 1ª semana" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("p1", false));
  });
  it("missão desligada na clínica: o cartão nem aparece", async () => {
    api.mission = { enabled: false, started: false };
    const { container } = wrap(<MissionCard patientId="p1" />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
