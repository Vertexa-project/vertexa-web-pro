import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { PatientListItem } from "@/types/db";

import { STAFF_ACCESS_REVOKED_TITLE } from "@/lib/domain/staffNotifications";

vi.mock("@/hooks/useChat", () => ({
  useChannelProfessionals: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useChatThread: () => ({
    data: { channelId: "ch-1", actingProfileId: "me", messages: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSendChatMessage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUnreadMentions: () => ({ data: { total: 2, byPatient: { "pac-1": 2 } } }),
  useMarkMentionsRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useDisciplines", () => ({
  useDisciplinesList: () => ({ data: [] }),
}));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: () => ({ data: undefined }),
  useProfileAvatarUrls: () => ({ data: new Map(), isLoading: false }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({
    data: [patient()],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { MessagesPage } = await import("./MessagesPage");

function patient(): PatientListItem {
  return {
    id: "pac-1",
    goal: null,
    current_weight: null,
    start_date: null,
    birth_date: null,
    profile: { full_name: "Marina Alves", email: null, avatar_url: null },
    snapshot: null,
    professionals: [],
    lastActivityAt: null,
    lastWeightAt: null,
    lastPhotoAt: null,
    lastWorkoutAt: null,
  };
}

describe("MessagesPage deep link", () => {
  it("T10 — ?patient= seleciona a conversa existente", () => {
    render(
      <MemoryRouter initialEntries={["/mensagens?patient=pac-1"]}>
        <MessagesPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /Marina Alves/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("T17 — paciente fora do alcance → copy genérica, sem thread", () => {
    render(
      <MemoryRouter initialEntries={["/mensagens?patient=pac-revogado"]}>
        <MessagesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(STAFF_ACCESS_REVOKED_TITLE)).toBeInTheDocument();
    expect(screen.queryByText("Você responde no lugar da clínica/profissional")).not.toBeInTheDocument();
  });

  it("T19 — menções continuam independentes do sino", () => {
    render(
      <MemoryRouter initialEntries={["/mensagens"]}>
        <MessagesPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/2 menção/i)).toBeInTheDocument();
  });
});
