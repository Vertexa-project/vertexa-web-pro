import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { PlatformBillingClinicRow, PlatformBillingOverview } from "@/lib/domain/platformBilling";
import { emptyOverview } from "@/lib/domain/platformBilling";

const overviewState = vi.hoisted(() => ({
  data: undefined as PlatformBillingOverview | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

const clinicsState = vi.hoisted(() => ({
  data: { limit: 20, offset: 0, items: [] as PlatformBillingClinicRow[] },
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

const eventsState = vi.hoisted(() => ({
  data: { limit: 8, offset: 0, items: [] as Array<{ id: string; eventType: string; processingStatus: string; receivedAt: string; clinicName?: string | null; failureCategory: string | null }> },
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/usePlatformBilling", () => ({
  usePlatformBillingOverview: () => overviewState,
  usePlatformBillingClinics: () => clinicsState,
  usePlatformBillingEvents: () => eventsState,
}));

const { PlatformBillingOverviewPage } = await import("./PlatformBillingOverviewPage");

function clinic(over: Partial<PlatformBillingClinicRow> = {}): PlatformBillingClinicRow {
  return {
    clinicId: "c1",
    clinicName: "Clínica Norte",
    planCode: "pulse",
    planDisplayName: "Pulse",
    planPriceCents: 39000,
    planCurrency: "BRL",
    billingCycle: "monthly",
    contractStatus: "active",
    contractEffectiveFrom: "2026-08-01",
    identityComplete: true,
    customerBound: true,
    pixStatus: "ACTIVE",
    pixGeneration: 1,
    financialSummary: "overdue",
    overdueCount: 1,
    overdueCents: 39000,
    pendingCents: null,
    chargeCount: 2,
    nextCharge: null,
    latestPaymentState: "overdue",
    latestPaymentDate: null,
    agingBucket: "d31_plus",
    attention: true,
    attentionReason: "overdue",
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
    ...over,
  };
}

beforeEach(() => {
  overviewState.data = {
    ...emptyOverview(),
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    financial: {
      sandbox: {
        receivedCents: 39000,
        receivedCount: 1,
        pendingCents: 0,
        pendingCount: 0,
        overdueCents: 39000,
        overdueCount: 1,
      },
      production: {
        receivedCents: 0,
        receivedCount: 0,
        pendingCents: 0,
        pendingCount: 0,
        overdueCents: 0,
        overdueCount: 0,
      },
    },
    delinquentClinics: 1,
    attentionClinicCount: 1,
    activeCommercialContracts: 2,
    activePixAutomaticAuthorizations: 1,
  };
  overviewState.isLoading = false;
  overviewState.isError = false;
  clinicsState.data = { limit: 20, offset: 0, items: [clinic()] };
  clinicsState.isLoading = false;
  clinicsState.isError = false;
  eventsState.data = {
    limit: 8,
    offset: 0,
    items: [
      {
        id: "e1",
        eventType: "PAYMENT_RECEIVED",
        processingStatus: "processed",
        receivedAt: "2026-09-10",
        clinicName: "Clínica Norte",
        failureCategory: null,
      },
    ],
  };
});

describe("PlatformBillingOverviewPage", () => {
  it("shows month metrics, attention clinics and events without MRR", () => {
    render(
      <MemoryRouter>
        <PlatformBillingOverviewPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Recebido Sandbox")).toBeInTheDocument();
    expect(screen.getByText("Recebido Produção")).toBeInTheDocument();
    expect(screen.getByText(/clínica inadimplente/)).toBeInTheDocument();
    expect(screen.getByText(/isto não é MRR/i)).toBeInTheDocument();
    expect(screen.getAllByText("Clínica Norte").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cobrança vencida").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pagamento recebido").length).toBeGreaterThan(0);
    expect(screen.queryByText(/qr|payload|asaas/i)).not.toBeInTheDocument();
  });

  it("renders loading and error states", () => {
    overviewState.isLoading = true;
    const { rerender } = render(
      <MemoryRouter>
        <PlatformBillingOverviewPage />
      </MemoryRouter>,
    );
    expect(document.querySelector(".h-64")).toBeTruthy();

    overviewState.isLoading = false;
    overviewState.isError = true;
    overviewState.error = { hint: "BILLING_NOT_PLATFORM_ADMIN" };
    rerender(
      <MemoryRouter>
        <PlatformBillingOverviewPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/administradores da plataforma/)).toBeInTheDocument();
  });

  it("shows an empty attention list honestly", () => {
    clinicsState.data = { limit: 20, offset: 0, items: [] };
    render(
      <MemoryRouter>
        <PlatformBillingOverviewPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nenhuma clínica pede atenção agora")).toBeInTheDocument();
  });
});
