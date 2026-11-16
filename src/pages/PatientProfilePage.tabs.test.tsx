import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isClinicAdmin: false,
  adminClinicArg: undefined as unknown,
}));
const GO = vi.hoisted(() => ({ go: null as null | ((v: string) => void) }));

const patient = {
  id: "pat-1",
  clinic_id: "clinic-9",
  profile: { full_name: "Luana", email: "l@x.com" },
  professionals: [],
};

vi.mock("@/hooks/usePatients", () => ({
  usePatient: () => ({ data: patient, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useAdherenceSnapshot", () => ({
  useAdherenceSnapshot: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: (clinicId: unknown) => {
    state.adminClinicArg = clinicId;
    return { isClinicAdmin: state.isClinicAdmin, isLoading: false, isError: false };
  },
}));

const stub = (id: string) => () => <div data-testid={id} />;
vi.mock("@/components/patient/PatientEditDialog", () => ({
  PatientEditDialog: ({ open }: { open: boolean }) => <div data-testid="edit-dialog" data-open={String(open)} />,
}));
vi.mock("@/components/patient/ProfileHeader", () => ({ ProfileHeader: stub("header") }));
vi.mock("@/components/patient/ExportPatientReportButton", () => ({ ExportPatientReportButton: stub("export") }));
vi.mock("@/components/fin/NewSaleButton", () => ({ NewSaleButton: () => null }));
vi.mock("@/components/documents/NewDocumentButton", () => ({ NewDocumentButton: () => null }));
vi.mock("@/components/fin/NewAppointmentButton", () => ({ NewAppointmentButton: () => null }));
vi.mock("@/components/fin/PatientPackagesCard", () => ({ PatientPackagesCard: () => null }));
vi.mock("@/components/patient/AnthropometryTab", () => ({ AnthropometryTab: stub("t1") }));
vi.mock("@/components/patient/DocumentsTab", () => ({ DocumentsTab: stub("t2") }));
vi.mock("@/components/patient/EvolutionTab", () => ({ EvolutionTab: stub("t3") }));
vi.mock("@/components/patient/NutritionTab", () => ({ NutritionTab: stub("t4") }));
vi.mock("@/components/patient/OverviewTab", () => ({
  OverviewTab: ({ onGoToTab }: { onGoToTab: (v: string) => void }) => {
    GO.go = onGoToTab;
    return <div data-testid="t5" />;
  },
}));
vi.mock("@/components/patient/ClinicalRecordTab", () => ({ ClinicalRecordTab: stub("pront") }));
vi.mock("@/components/patient/RecoveryTab", () => ({ RecoveryTab: stub("t6") }));
vi.mock("@/components/patient/SupplementsTab", () => ({ SupplementsTab: stub("t7") }));
vi.mock("@/components/patient/TimelineTab", () => ({ TimelineTab: stub("t8") }));
vi.mock("@/components/patient/WorkoutTab", () => ({ WorkoutTab: stub("t9") }));

const { PatientProfilePage } = await import("./PatientProfilePage");

import { act } from "@testing-library/react";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.search}</output>;
}

function renderAt(url: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/pacientes/:id" element={<><PatientProfilePage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sel = (name: string) => screen.getByRole("tab", { name });

describe("ficha do paciente — 6 abas (redesign P2)", () => {
  it("mostra as 6 abas na ordem e abre em Resumo", () => {
    renderAt("/pacientes/pat-1");
    const main = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(main).toEqual(["Resumo", "Timeline", "Prontuário", "Planos", "Evolução", "Documentos"]);
    expect(sel("Resumo")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("t5")).toBeInTheDocument();
  });

  it("Planos traz Plano alimentar, Suplementos e Treino; Evolução traz Antropometria, Evolução/Fotos e Recuperação", async () => {
    renderAt("/pacientes/pat-1");
    await userEvent.click(sel("Planos"));
    expect(screen.getByRole("tab", { name: "Plano alimentar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("t4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Suplementos" }));
    expect(screen.getByTestId("t7")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Treino" }));
    expect(screen.getByTestId("t9")).toBeInTheDocument();
    await userEvent.click(sel("Evolução"));
    expect(screen.getByRole("tab", { name: "Antropometria" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("t1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Evolução/Fotos" }));
    expect(screen.getByTestId("t3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Recuperação" }));
    expect(screen.getByTestId("t6")).toBeInTheDocument();
  });

  it.each([
    ["overview", "Resumo", "t5", null],
    ["timeline", "Timeline", "t8", null],
    ["prontuario", "Prontuário", "pront", null],
    ["documents", "Documentos", "t2", null],
    ["nutrition", "Planos", "t4", "Plano alimentar"],
    ["supplements", "Planos", "t7", "Suplementos"],
    ["workout", "Planos", "t9", "Treino"],
    ["anthropometry", "Evolução", "t1", "Antropometria"],
    ["evolution", "Evolução", "t3", "Evolução/Fotos"],
    ["recovery", "Evolução", "t6", "Recuperação"],
  ])("?tab=%s (valor antigo) abre %s", (old, tab, testId, subName) => {
    renderAt(`/pacientes/pat-1?tab=${old}`);
    expect(sel(tab)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(testId)).toBeInTheDocument();
    if (subName) expect(screen.getByRole("tab", { name: subName })).toHaveAttribute("aria-selected", "true");
  });

  it("links internos do Resumo (valores antigos 'workout' e 'nutrition') caem em Planos › Treino / Plano alimentar", () => {
    renderAt("/pacientes/pat-1");
    act(() => GO.go?.("workout"));
    expect(sel("Planos")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Treino" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("t9")).toBeInTheDocument();
    act(() => GO.go?.("nutrition"));
    expect(screen.getByRole("tab", { name: "Plano alimentar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("where").textContent).toBe("?tab=planos&sub=alimentar");
  });

  it("teclado: seta para a direita nas abas move o foco (Radix Tabs)", async () => {
    renderAt("/pacientes/pat-1");
    sel("Resumo").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(sel("Timeline")).toHaveFocus();
  });
});
