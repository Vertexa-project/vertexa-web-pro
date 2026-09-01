import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PlatformClinicRequest } from "@/lib/api/platformAdmin";

const listState = vi.hoisted(() => ({
  data: [] as PlatformClinicRequest[] | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

const approveState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

const rejectState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({
    isPlatformAdmin: true,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePlatformOnboarding", () => ({
  usePlatformClinicRequests: () => listState,
  useApproveClinicCreationRequest: () => approveState,
  useRejectClinicCreationRequest: () => rejectState,
}));

const { PlatformRequestsPage } = await import("./PlatformRequestsPage");

const pending: PlatformClinicRequest = {
  requestId: "r1",
  requestedClinicName: "Clínica Norte",
  requesterProfileId: "p1",
  requesterName: "Ana",
  requesterEmail: "ana@t.test",
  status: "pending",
  requestedAt: "2026-09-01T00:00:00Z",
  decidedAt: null,
  rejectionReason: null,
};

beforeEach(() => {
  listState.data = [];
  listState.isLoading = false;
  listState.isError = false;
  approveState.mutate.mockReset();
  approveState.isPending = false;
  rejectState.mutate.mockReset();
  rejectState.isPending = false;
});

describe("PlatformRequestsPage", () => {
  it("empty sem pedidos", () => {
    render(<PlatformRequestsPage />);
    expect(screen.getByText("Nenhuma solicitação")).toBeInTheDocument();
  });

  it("erro é fail-closed", () => {
    listState.isError = true;
    listState.data = undefined;
    render(<PlatformRequestsPage />);
    expect(screen.getByText("Não foi possível carregar as solicitações")).toBeInTheDocument();
  });

  it("lista pedido e abre confirmação de aprovar", async () => {
    listState.data = [pending];
    const user = userEvent.setup();
    render(<PlatformRequestsPage />);
    expect(screen.getByText("Clínica Norte")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("ana@t.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(screen.getByText("Aprovar criação de clínica?")).toBeInTheDocument();
  });

  it("recusa pede motivo opcional", async () => {
    listState.data = [pending];
    const user = userEvent.setup();
    render(<PlatformRequestsPage />);
    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect(screen.getByLabelText(/motivo/i)).toBeInTheDocument();
  });
});
