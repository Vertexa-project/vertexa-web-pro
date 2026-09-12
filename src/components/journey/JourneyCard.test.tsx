import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { JourneyColumn } from "@/lib/domain/journeyBoard";
import type { PatientListItem } from "@/types/db";

vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: (path?: string | null) => ({
    data: path && path !== "pf-lu/fail.webp" ? `https://signed.test/${path}` : undefined,
  }),
  useProfileAvatarUrls: () => ({ data: new Map(), isLoading: false }),
}));

const { JourneyCard, JOURNEY_DND_MIME } = await import("./JourneyCard");

const COLUMN: JourneyColumn = {
  id: "col-1",
  clinic_id: "c1",
  name: "Acolhimento",
  position: 0,
  color: null,
  is_initial: true,
  created_at: "2026-01-01T00:00:00Z",
};

function patient(over: { name: string; avatarPath?: string | null; id?: string }): PatientListItem {
  return {
    id: over.id ?? "pat-1",
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

function renderCard(p: PatientListItem, onDragStateChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <JourneyCard
        patient={p}
        columns={[COLUMN]}
        currentColumnId={COLUMN.id}
        today={new Date("2026-09-11T12:00:00Z")}
        isAcked={() => false}
        onMove={vi.fn()}
        onAck={vi.fn()}
        onDragStateChange={onDragStateChange}
        moving={false}
      />
    </QueryClientProvider>,
  );
}

describe("JourneyCard — avatar", () => {
  it("avatar_path → foto", () => {
    renderCard(patient({ name: "Luana dos Santos Costa", avatarPath: "pf-lu/a.webp" }));
    expect(screen.getByTestId("profile-photo")).toHaveAttribute("data-photo", "signed");
  });

  it("sem avatar_path → iniciais", () => {
    renderCard(patient({ name: "Luana dos Santos Costa", avatarPath: null }));
    expect(screen.getByTestId("profile-photo")).toHaveAttribute("data-photo", "fallback");
    expect(screen.getByText("LC")).toBeInTheDocument();
  });

  it("sign fail → iniciais", () => {
    renderCard(patient({ name: "Luana dos Santos Costa", avatarPath: "pf-lu/fail.webp" }));
    expect(screen.getByTestId("profile-photo")).toHaveAttribute("data-photo", "fallback");
    expect(screen.getByText("LC")).toBeInTheDocument();
  });

  it("drag do cartão permanece; imagem não é arrastável nativamente", () => {
    const onDragStateChange = vi.fn();
    renderCard(patient({ name: "Luana dos Santos Costa", avatarPath: "pf-lu/a.webp" }), onDragStateChange);
    const card = screen.getByRole("generic", {
      name: /Cartão de Luana dos Santos Costa/i,
    });
    expect(card).toHaveAttribute("draggable", "true");

    const dt = {
      setData: vi.fn(),
      effectAllowed: "",
    };
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith(JOURNEY_DND_MIME, "pat-1");
    expect(onDragStateChange).toHaveBeenCalledWith("pat-1");

    const img = screen.getByTestId("profile-photo").querySelector("img");
    if (img) expect(img).toHaveAttribute("draggable", "false");
  });
});
