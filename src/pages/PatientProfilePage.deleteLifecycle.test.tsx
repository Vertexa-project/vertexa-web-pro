import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Regressão do 406 pós-exclusão (WP-PATIENT-IDENTITY-POLISH-01): depois de excluir, a ficha NÃO
// pode buscar de novo o paciente que acabou de ser apagado (no PostgREST isso vira 406 do
// `.single()`). Hooks REAIS de react-query; só a camada de API é simulada.

const api = vi.hoisted(() => ({
  getPatient: vi.fn(),
  getPatientRegistrationAccess: vi.fn(),
  getPatientDeletionEligibility: vi.fn(),
  deleteUnusedPatientRegistration: vi.fn(),
  listPatients: vi.fn(),
}));

vi.mock("@/lib/api/patients", () => ({
  createPatient: vi.fn(),
  updatePatientRegistration: vi.fn(),
  getPatient: api.getPatient,
  getPatientRegistrationAccess: api.getPatientRegistrationAccess,
  getPatientDeletionEligibility: api.getPatientDeletionEligibility,
  deleteUnusedPatientRegistration: api.deleteUnusedPatientRegistration,
  listPatients: api.listPatients,
}));
vi.mock("@/hooks/useAdherenceSnapshot", () => ({
  useAdherenceSnapshot: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: true, isLoading: false, isError: false }),
}));

const stub = (id: string) => () => <div data-testid={id} />;
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

// jsdom fornece o AbortSignal dele; o `Request` do Node (undici) rejeita esse sinal na navegação do
// data router. As rotas deste teste não têm loaders, então um Request mínimo basta.
class TestRequest {
  url: string;
  method: string;
  signal: unknown;
  constructor(url: string | URL, init: { method?: string; signal?: unknown } = {}) {
    this.url = String(url);
    this.method = init.method ?? "GET";
    this.signal = init.signal;
  }
}
vi.stubGlobal("Request", TestRequest);

const { PatientProfilePage } = await import("./PatientProfilePage");

const patient = {
  id: "pat-qa",
  profile_id: "pf-qa",
  clinic_id: "c-1",
  birth_date: null,
  sex: null,
  height_cm: null,
  goal: null,
  start_date: "2026-10-10",
  start_weight: null,
  current_weight: null,
  target_weight: null,
  profile: { id: "pf-qa", full_name: "QA Fixture", email: "qa@example.invalid", auth_user_id: null },
  professionals: [],
};

function ListProbe() {
  const location = useLocation();
  return <div data-testid="list">{(location.state as { notice?: string } | null)?.notice ?? "list"}</div>;
}

describe("PatientProfilePage — ciclo de vida da exclusão (sem refetch do paciente excluído)", () => {
  it("excluir → aviso + lista, e o detalhe do paciente excluído NUNCA é buscado de novo", async () => {
    api.getPatient.mockResolvedValue(patient);
    api.getPatientRegistrationAccess.mockResolvedValue({ hasLoginAccount: false, loginEmailMatchesRegistration: null });
    api.getPatientDeletionEligibility.mockResolvedValue({ eligible: true, reason: "PATIENT_DELETE_ELIGIBLE" });
    api.deleteUnusedPatientRegistration.mockResolvedValue(undefined);
    api.listPatients.mockResolvedValue([]);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    // Mesmo modo de produção (src/main.tsx): data router + v7_startTransition, ou seja, a navegação
    // é uma transição e o fechamento do diálogo (urgente) renderiza a ficha ANTES de ela desmontar.
    const router = createMemoryRouter(
      [
        { path: "/pacientes/:id", element: <PatientProfilePage /> },
        { path: "/pacientes", element: <ListProbe /> },
      ],
      { initialEntries: ["/pacientes/pat-qa"] },
    );
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /editar cadastro/i }));
    const openDelete = await screen.findByRole("button", { name: "Excluir cadastro" });
    await waitFor(() => expect(openDelete).toBeEnabled());
    expect(api.getPatient).toHaveBeenCalledTimes(1);

    await user.click(openDelete);
    await user.type(screen.getByLabelText(/para confirmar/i), "EXCLUIR");
    await user.click(screen.getByRole("button", { name: "Excluir definitivamente" }));

    expect(await screen.findByTestId("list")).toHaveTextContent("Cadastro excluído.");
    expect(api.deleteUnusedPatientRegistration).toHaveBeenCalledWith("pat-qa");

    // dá tempo para qualquer refetch tardio aparecer
    await new Promise((r) => setTimeout(r, 50));
    expect(api.getPatient).toHaveBeenCalledTimes(1);
    expect(api.getPatient).not.toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(["patient", "pat-qa"])).toBeUndefined();
  });
});
