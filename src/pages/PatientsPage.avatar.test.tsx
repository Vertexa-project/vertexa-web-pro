import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PatientListItem } from "@/types/db";

const state = vi.hoisted(() => ({
  patients: [] as PatientListItem[],
}));

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: false, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: state.patients, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/usePatientTeam", () => ({
  usePatientsWithoutActiveProfessional: () => ({ data: [] }),
}));
vi.mock("@/components/patient/PatientCreateDialog", () => ({
  PatientCreateDialog: () => null,
}));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: (path?: string | null) => ({
    data: path ? `https://signed.test/${path}` : undefined,
  }),
  useProfileAvatarUrls: (paths: Array<string | null | undefined>) => ({
    data: new Map(
      paths.filter((p): p is string => Boolean(p)).map((p) => [p, `https://signed.test/${p}`]),
    ),
    isLoading: false,
  }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const { PatientsPage } = await import("./PatientsPage");

function patient(over: Partial<PatientListItem> & { name: string; avatarPath?: string | null }): PatientListItem {
  return {
    id: over.id ?? over.name,
    goal: null,
    current_weight: null,
    start_date: null,
    birth_date: null,
    profile: {
      full_name: over.name,
      email: null,
      avatar_url: null,
      avatar_path: over.avatarPath ?? null,
    },
    snapshot: null,
    professionals: [],
    lastActivityAt: null,
    lastWeightAt: null,
    lastPhotoAt: null,
    lastWorkoutAt: null,
    ...over,
  };
}

beforeEach(() => {
  state.patients = [];
});

describe("PatientsPage — avatar da lista", () => {
  it("avatar_path → foto; sem path → iniciais", () => {
    state.patients = [
      patient({ id: "p1", name: "Luana dos Santos Costa", avatarPath: "pf-lu/aaa.webp" }),
      patient({ id: "p2", name: "Ana Prado", avatarPath: null }),
    ];
    render(
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>,
    );
    const photos = screen.getAllByTestId("profile-photo");
    expect(photos[0]).toHaveAttribute("data-photo", "signed");
    expect(photos[1]).toHaveAttribute("data-photo", "fallback");
    expect(screen.getByText("AP")).toBeInTheDocument();
  });
});
