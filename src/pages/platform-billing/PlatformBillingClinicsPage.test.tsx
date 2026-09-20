import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { PlatformBillingClinicRow } from "@/lib/domain/platformBilling";

const clinicsState = vi.hoisted(() => ({
  data: { limit: 50, offset: 0, items: [] as PlatformBillingClinicRow[] },
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
  lastFilters: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true }),
}));

vi.mock("@/hooks/usePlatformBilling", () => ({
  usePlatformBillingClinics: (_enabled: boolean, filters: Record<string, unknown>) => {
    clinicsState.lastFilters = filters;
    return clinicsState;
  },
}));

const { PlatformBillingClinicsPage } = await import("./PlatformBillingClinicsPage");

function clinic(over: Partial<PlatformBillingClinicRow> = {}): PlatformBillingClinicRow {
  return {
    clinicId: "c1",
    clinicName: "Clínica Leste",
    planCode: "pulse",
    planDisplayName: "Pulse",
    planPriceCents: 39000,
    planCurrency: "BRL",
    billingCycle: "monthly",
    contractStatus: "active",
    contractEffectiveFrom: "2026-08-01",
    identityComplete: false,
    customerBound: false,
    pixStatus: "REFUSED",
    pixGeneration: 2,
    financialSummary: "pending",
    overdueCount: 0,
    overdueCents: null,
    pendingCents: 39000,
    chargeCount: 1,
    nextCharge: {
      amountCents: 39000,
      dueDate: "2026-10-18",
      displayState: "PENDING",
    },
    latestPaymentState: "pending",
    latestPaymentDate: null,
    agingBucket: null,
    attention: true,
    attentionReason: "pix_refused",
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
    ...over,
  };
}

beforeEach(() => {
  clinicsState.data = { limit: 50, offset: 0, items: [clinic()] };
  clinicsState.isLoading = false;
  clinicsState.isError = false;
});

describe("PlatformBillingClinicsPage", () => {
  it("lists contracts with distinct Pix and financial states", () => {
    render(
      <MemoryRouter>
        <PlatformBillingClinicsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Contratos" })).toBeInTheDocument();
    expect(screen.getAllByText("Clínica Leste").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recusado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Em aberto").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pix Automático recusado").length).toBeGreaterThan(0);
    expect(screen.queryByText(/inadimplente/i)).not.toBeInTheDocument();
  });

  it("applies safe filters", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PlatformBillingClinicsPage />
      </MemoryRouter>,
    );
    await user.selectOptions(screen.getByLabelText("Situação financeira"), "overdue");
    expect(clinicsState.lastFilters.financialStatus).toBe("overdue");
    await user.selectOptions(screen.getByLabelText("Atenção"), "Precisa de atenção");
    expect(clinicsState.lastFilters.needsAttention).toBe(true);
  });

  it("shows empty and error states", () => {
    clinicsState.data = { limit: 50, offset: 0, items: [] };
    const { rerender } = render(
      <MemoryRouter>
        <PlatformBillingClinicsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nenhuma clínica neste recorte")).toBeInTheDocument();

    clinicsState.isError = true;
    clinicsState.error = { hint: "BILLING_NOT_PLATFORM_ADMIN" };
    rerender(
      <MemoryRouter>
        <PlatformBillingClinicsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
