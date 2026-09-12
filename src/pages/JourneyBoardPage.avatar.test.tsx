import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { uniqueAvatarPaths } from "@/lib/avatar/signedUrlBatch";
import type { JourneyColumn } from "@/lib/domain/journeyBoard";
import type { PatientListItem } from "@/types/db";

const state = vi.hoisted(() => ({
  patients: [] as PatientListItem[],
}));

const useProfileAvatarUrls = vi.hoisted(() =>
  vi.fn((paths: Array<string | null | undefined>) => ({
    data: new Map(
      uniqueAvatarPaths(paths).map((p) => [p, `https://signed.test/${p}`] as const),
    ),
    isLoading: false,
  })),
);

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: false, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: state.patients, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useJourney", () => {
  const col: JourneyColumn = {
    id: "col-1",
    clinic_id: "c1",
    name: "Acolhimento",
    position: 0,
    color: null,
    is_initial: true,
    created_at: "2026-01-01T00:00:00Z",
  };
  return {
    useJourneyColumns: () => ({ data: [col], isLoading: false, isError: false, refetch: vi.fn() }),
    useJourneyState: () => ({ data: {}, isLoading: false, isError: false }),
    useMilestoneAcks: () => ({ data: [], isLoading: false, isError: false }),
    useMovePatientJourney: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
    useAckMilestone: () => ({ mutate: vi.fn() }),
  };
});
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: (path?: string | null) => ({
    data: path ? `https://signed.test/${path}` : undefined,
  }),
  useProfileAvatarUrls,
}));

const { JourneyBoardPage } = await import("./JourneyBoardPage");

function patient(over: { id: string; name: string; avatarPath?: string | null }): PatientListItem {
  return {
    id: over.id,
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
  };
}

beforeEach(() => {
  state.patients = [];
  useProfileAvatarUrls.mockClear();
});

describe("Jornada — avatar no card", () => {
  it("repassa avatar_path do paciente da lista e renderiza foto ou iniciais", () => {
    state.patients = [
      patient({ id: "p1", name: "Luana dos Santos Costa", avatarPath: "pf-lu/a.webp" }),
      patient({ id: "p2", name: "Ana Prado", avatarPath: null }),
    ];
    render(
      <MemoryRouter>
        <JourneyBoardPage />
      </MemoryRouter>,
    );
    const photos = screen.getAllByTestId("profile-photo");
    expect(photos[0]).toHaveAttribute("data-photo", "signed");
    expect(photos[1]).toHaveAttribute("data-photo", "fallback");
    expect(screen.getByText("AP")).toBeInTheDocument();
  });

  it("3 cards / 2 paths únicos → uma batch com 2 paths", () => {
    const shared = "pf-lu/a.webp";
    state.patients = [
      patient({ id: "p1", name: "Luana dos Santos Costa", avatarPath: shared }),
      patient({ id: "p2", name: "Ana Prado", avatarPath: null }),
      patient({ id: "p3", name: "Luana Clone", avatarPath: shared }),
    ];
    render(
      <MemoryRouter>
        <JourneyBoardPage />
      </MemoryRouter>,
    );
    expect(useProfileAvatarUrls).toHaveBeenCalled();
    const paths = useProfileAvatarUrls.mock.calls[0]?.[0] as Array<string | null | undefined>;
    expect(uniqueAvatarPaths(paths)).toEqual([shared]);
    expect(useProfileAvatarUrls).toHaveBeenCalledTimes(1);
  });
});
