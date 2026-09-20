import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { PlatformBillingEvent } from "@/lib/domain/platformBilling";

const eventsState = vi.hoisted(() => ({
  data: { limit: 50, offset: 0, items: [] as PlatformBillingEvent[] },
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true }),
}));

vi.mock("@/hooks/usePlatformBilling", () => ({
  usePlatformBillingEvents: () => eventsState,
}));

const { PlatformBillingEventsPage } = await import("./PlatformBillingEventsPage");

beforeEach(() => {
  eventsState.isLoading = false;
  eventsState.isError = false;
  eventsState.data = {
    limit: 50,
    offset: 0,
    items: [
      {
        id: "e1",
        eventType: "PAYMENT_OVERDUE",
        processingStatus: "failed",
        receivedAt: "2026-09-02T12:00:00Z",
        processedAt: null,
        failureCategory: "provider_timeout",
        clinicId: "c1",
        clinicName: "Clínica Oeste",
        relatedPaymentId: "p1",
        relatedEntityType: "payment",
      },
    ],
  };
});

describe("PlatformBillingEventsPage", () => {
  it("shows sanitized event metadata only", () => {
    render(
      <MemoryRouter>
        <PlatformBillingEventsPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Pagamento vencido").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Falhou").length).toBeGreaterThan(0);
    expect(screen.getAllByText("provider_timeout").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clínica Oeste").length).toBeGreaterThan(0);
    expect(screen.queryByText(/payload|qr_|encoded|asaas/i)).not.toBeInTheDocument();
  });

  it("shows empty state", () => {
    eventsState.data = { limit: 50, offset: 0, items: [] };
    render(
      <MemoryRouter>
        <PlatformBillingEventsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nenhum evento neste recorte")).toBeInTheDocument();
  });
});
