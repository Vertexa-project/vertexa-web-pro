import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PatientListItem } from "@/types/db";

const state = vi.hoisted(() => ({
  isClinicAdmin: false,
  patients: [] as PatientListItem[],
}));

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({
    isClinicAdmin: state.isClinicAdmin,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: state.patients, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/usePatientTeam", () => ({
  usePatientsWithoutActiveProfessional: () => ({ data: [] }),
}));
vi.mock("@/components/patient/PatientCreateDialog", () => ({
  PatientCreateDialog: () => <div data-testid="patient-create-dialog" />,
}));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: () => ({ data: undefined }),
  useProfileAvatarUrls: () => ({ data: new Map(), isLoading: false }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const { PatientsPage } = await import("./PatientsPage");

function patient(name: string): PatientListItem {
  return {
    id: name,
    goal: null,
    current_weight: null,
    start_date: null,
    birth_date: null,
    profile: { full_name: name, email: null, avatar_url: null, avatar_path: null },
    snapshot: null,
    professionals: [],
    lastActivityAt: null,
    lastWeightAt: null,
    lastPhotoAt: null,
    lastWorkoutAt: null,
  };
}

beforeEach(() => {
  state.isClinicAdmin = false;
  state.patients = [];
});

describe("PatientsPage — CTA de cadastro (ACCESS-PARTNER-01A)", () => {
  it("T13 admin vê o CTA e o diálogo pode ser montado", () => {
    state.isClinicAdmin = true;
    state.patients = [patient("Luana")];
    render(
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /cadastrar novo paciente/i })).toBeInTheDocument();
    expect(screen.getByTestId("patient-create-dialog")).toBeInTheDocument();
  });

  it("T13 admin em lista vazia vê o CTA do empty state", () => {
    state.isClinicAdmin = true;
    render(
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("button", { name: /cadastrar novo paciente/i }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("patient-create-dialog")).toBeInTheDocument();
  });

  it("T14 member não vê o CTA nem o diálogo", () => {
    state.isClinicAdmin = false;
    state.patients = [patient("Luana")];
    render(
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /cadastrar novo paciente/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("patient-create-dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exportar em lote/i })).toBeInTheDocument();
  });

  it("T14 member em lista vazia também não vê o CTA", () => {
    state.isClinicAdmin = false;
    render(
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /cadastrar novo paciente/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("patient-create-dialog")).not.toBeInTheDocument();
  });
});
