import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NO_FIN_ACCESS, type FinAccess } from "@/lib/domain/finAccess";
import type { PatientListItem } from "@/types/db";

const state = vi.hoisted(() => ({ isClinicAdmin: false, access: null as unknown as FinAccess }));

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: state.isClinicAdmin, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useFin", () => ({ useFinAccess: () => ({ access: state.access, isLoading: false }) }));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: [patient("Luana")], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/usePatientTeam", () => ({ usePatientsWithoutActiveProfessional: () => ({ data: [] }) }));
vi.mock("@/components/patient/PatientCreateDialog", () => ({ PatientCreateDialog: () => null }));
vi.mock("@/components/patient/PatientImportDialog", () => ({ PatientImportDialog: () => <div data-testid="import-dialog" /> }));
vi.mock("@/components/patient/PatientExportDialog", () => ({ PatientExportDialog: () => <div data-testid="export-dialog" /> }));
vi.mock("@/hooks/useBillingCommercial", () => ({ useClinicCommercialUsage: () => ({ data: null, isLoading: false, isError: false }) }));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: () => ({ data: undefined }),
  useProfileAvatarUrls: () => ({ data: new Map(), isLoading: false }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const { PatientsPage } = await import("./PatientsPage");

function patient(name: string): PatientListItem {
  return {
    id: name, goal: null, current_weight: null, start_date: null, birth_date: null,
    profile: { full_name: name, email: null, avatar_url: null, avatar_path: null },
    snapshot: null, professionals: [], lastActivityAt: null, lastWeightAt: null, lastPhotoAt: null, lastWorkoutAt: null,
  };
}

const withRole = (role: "gestor" | "financeiro" | "recepcao" | "estoquista"): FinAccess => ({
  ...NO_FIN_ACCESS,
  roles: [{ role, allUnits: true, unitIds: [] }],
});

function show() {
  render(
    <MemoryRouter>
      <PatientsPage />
    </MemoryRouter>,
  );
}
const importBtn = () => screen.queryByRole("button", { name: /importar pacientes/i });
const exportBtn = () => screen.queryByRole("button", { name: /^exportar base$/i });

beforeEach(() => {
  state.isClinicAdmin = false;
  state.access = NO_FIN_ACCESS;
});

describe("PatientsPage — Importar pacientes e Exportar base (parte 4)", () => {
  it("admin da clínica vê os dois botões", () => {
    state.isClinicAdmin = true;
    state.access = { ...NO_FIN_ACCESS, isAdmin: true };
    show();
    expect(importBtn()).toBeInTheDocument();
    expect(exportBtn()).toBeInTheDocument();
  });

  it("Gestor (papel de equipe, não admin) vê Exportar base, mas não Importar", () => {
    state.access = withRole("gestor");
    show();
    expect(exportBtn()).toBeInTheDocument();
    expect(importBtn()).toBeNull();
  });

  it.each(["financeiro", "recepcao", "estoquista"] as const)("%s não vê nenhum dos dois", (role) => {
    state.access = withRole(role);
    show();
    expect(exportBtn()).toBeNull();
    expect(importBtn()).toBeNull();
  });

  it("profissional comum (sem papel e sem admin) não vê nenhum dos dois", () => {
    show();
    expect(exportBtn()).toBeNull();
    expect(importBtn()).toBeNull();
    expect(screen.queryByTestId("export-dialog")).toBeNull();
  });
});
