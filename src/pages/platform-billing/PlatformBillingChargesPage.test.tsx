import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { PlatformBillingCharge } from "@/lib/domain/platformBilling";

const chargesState = vi.hoisted(() => ({
  data: {
    limit: 50,
    offset: 0,
    items: [
      {
        id: "ch1",
        clinicId: "c1",
        clinicName: "Clínica Centro",
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-08-01",
        paidDate: null,
        displayState: "OVERDUE",
        method: "PIX",
      },
    ] as PlatformBillingCharge[],
  },
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true }),
}));

vi.mock("@/hooks/usePlatformBilling", () => ({
  usePlatformBillingCharges: () => chargesState,
}));

const { PlatformBillingChargesPage } = await import("./PlatformBillingChargesPage");

describe("PlatformBillingChargesPage", () => {
  it("lists charges with safe labels", () => {
    render(
      <MemoryRouter>
        <PlatformBillingChargesPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Cobranças" })).toBeInTheDocument();
    expect(screen.getAllByText("Clínica Centro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vencida").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pix").length).toBeGreaterThan(0);
  });
});
