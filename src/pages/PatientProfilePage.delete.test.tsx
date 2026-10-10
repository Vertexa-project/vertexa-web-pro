import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ isClinicAdmin: false }));

const patient = {
  id: "pat-1",
  clinic_id: "clinic-9",
  profile: { full_name: "Paciente Duplicado", email: "d@x.com" },
  professionals: [],
};

vi.mock("@/hooks/usePatients", () => ({
  usePatient: () => ({ data: patient, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useAdherenceSnapshot", () => ({
  useAdherenceSnapshot: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: state.isClinicAdmin, isLoading: false, isError: false }),
}));

const stub = (id: string) => () => <div data-testid={id} />;
// O diálogo real é testado à parte; aqui só importa o contrato onDeleted -> navegação.
vi.mock("@/components/patient/PatientEditDialog", () => ({
  PatientEditDialog: ({ onDeleted }: { onDeleted?: () => void }) =>
    onDeleted ? <button onClick={onDeleted}>simular exclusão</button> : <div data-testid="no-delete" />,
}));
vi.mock("@/components/patient/ProfileHeader", () => ({ ProfileHeader: stub("header") }));
vi.mock("@/components/patient/ExportPatientReportButton", () => ({ ExportPatientReportButton: stub("export") }));
vi.mock("@/components/patient/AnthropometryTab", () => ({ AnthropometryTab: stub("t1") }));
vi.mock("@/components/patient/DocumentsTab", () => ({ DocumentsTab: stub("t2") }));
vi.mock("@/components/patient/EvolutionTab", () => ({ EvolutionTab: stub("t3") }));
vi.mock("@/components/patient/NutritionTab", () => ({ NutritionTab: stub("t4") }));
vi.mock("@/components/patient/OverviewTab", () => ({ OverviewTab: stub("t5") }));
vi.mock("@/components/patient/RecoveryTab", () => ({ RecoveryTab: stub("t6") }));
vi.mock("@/components/patient/SupplementsTab", () => ({ SupplementsTab: stub("t7") }));
vi.mock("@/components/patient/TimelineTab", () => ({ TimelineTab: stub("t8") }));
vi.mock("@/components/patient/WorkoutTab", () => ({ WorkoutTab: stub("t9") }));

const { PatientProfilePage } = await import("./PatientProfilePage");

function ListProbe() {
  const location = useLocation();
  return <div data-testid="list">{(location.state as { notice?: string } | null)?.notice ?? ""}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/pacientes/pat-1"]}>
      <Routes>
        <Route path="/pacientes/:id" element={<PatientProfilePage />} />
        <Route path="/pacientes" element={<ListProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.isClinicAdmin = false;
});

describe("PatientProfilePage — exclusão de cadastro (WP-PATIENT-DIAG-DELETE-01)", () => {
  it("após excluir, volta para /pacientes com o aviso 'Cadastro excluído.'", async () => {
    state.isClinicAdmin = true;
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "simular exclusão" }));
    expect(screen.getByTestId("list")).toHaveTextContent("Cadastro excluído.");
  });

  it("não-admin nem monta o diálogo (nenhum caminho de exclusão)", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "simular exclusão" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("no-delete")).not.toBeInTheDocument();
  });
});
