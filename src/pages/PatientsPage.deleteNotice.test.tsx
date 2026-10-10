import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: true, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/usePatientTeam", () => ({
  usePatientsWithoutActiveProfessional: () => ({ data: [] }),
}));
vi.mock("@/components/patient/PatientCreateDialog", () => ({
  PatientCreateDialog: () => null,
}));
vi.mock("@/hooks/useBillingCommercial", () => ({
  useClinicCommercialUsage: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: () => ({ data: undefined }),
  useProfileAvatarUrls: () => ({ data: new Map(), isLoading: false }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const { PatientsPage } = await import("./PatientsPage");

describe("PatientsPage — aviso pós-exclusão (WP-PATIENT-DIAG-DELETE-01)", () => {
  it("mostra 'Cadastro excluído.' quando chega da ficha excluída", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/pacientes", state: { notice: "Cadastro excluído." } }]}>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Cadastro excluído.");
  });

  it("sem aviso na navegação normal", () => {
    render(
      <MemoryRouter initialEntries={["/pacientes"]}>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Cadastro excluído.")).not.toBeInTheDocument();
  });
});
