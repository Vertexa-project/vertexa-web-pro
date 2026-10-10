import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isClinicAdmin: false,
  adminClinicArg: undefined as unknown,
}));

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

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/pacientes/pat-1"]}>
        <Routes>
          <Route path="/pacientes/:id" element={<PatientProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.isClinicAdmin = false;
  state.adminClinicArg = undefined;
});

describe("PatientProfilePage — 'Editar cadastro' (WP-PATIENT-ADMIN-EDIT-01)", () => {
  it("admin da clínica do paciente vê o botão e abre o diálogo", async () => {
    state.isClinicAdmin = true;
    renderPage();
    const btn = screen.getByRole("button", { name: /editar cadastro/i });
    expect(screen.getByTestId("edit-dialog")).toHaveAttribute("data-open", "false");
    await userEvent.click(btn);
    expect(screen.getByTestId("edit-dialog")).toHaveAttribute("data-open", "true");
  });

  it("a autoridade é avaliada na clínica DO PACIENTE (não na do profissional logado)", () => {
    state.isClinicAdmin = true;
    renderPage();
    expect(state.adminClinicArg).toBe("clinic-9");
  });

  it("member não vê o botão nem monta o diálogo", () => {
    state.isClinicAdmin = false;
    renderPage();
    expect(screen.queryByRole("button", { name: /editar cadastro/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("export")).toBeInTheDocument();
  });
});
