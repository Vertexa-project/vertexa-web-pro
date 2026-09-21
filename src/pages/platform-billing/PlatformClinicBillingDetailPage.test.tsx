import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { PlatformClinicBillingDetail } from "@/lib/domain/platformBilling";
import { emptyProviderEnvFacts } from "@/lib/domain/platformBilling";

const detailState = vi.hoisted(() => ({
  data: undefined as PlatformClinicBillingDetail | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true }),
}));

vi.mock("@/hooks/usePlatformBilling", () => ({
  usePlatformClinicBillingDetail: () => detailState,
}));

const { PlatformClinicBillingDetailPage } = await import("./PlatformClinicBillingDetailPage");

beforeEach(() => {
  detailState.isLoading = false;
  detailState.isError = false;
  detailState.data = {
    found: true,
    clinicId: "c1",
    clinic: {
      clinicId: "c1",
      clinicName: "Clínica Sul",
      planCode: "sync",
      planDisplayName: "Sync",
      planPriceCents: 79000,
      planCurrency: "BRL",
      billingCycle: "monthly",
      contractStatus: "active",
      contractEffectiveFrom: "2026-07-01",
      identityComplete: true,
      customerBound: true,
      provider: {
        sandbox: {
          ...emptyProviderEnvFacts(),
          pixStatus: "CREATED",
          pixGeneration: 1,
          latestPaymentDate: "2026-09-20",
          latestPaymentState: "received",
          nextCharge: { amountCents: 39000, dueDate: "2026-10-05", displayState: "PENDING" },
        },
        production: {
          ...emptyProviderEnvFacts(),
          pixStatus: "ACTIVE",
          latestPaymentDate: "2026-09-01",
          latestPaymentState: "received",
          nextCharge: { amountCents: 89000, dueDate: "2026-10-20", displayState: "PENDING" },
        },
      },
      financialSummary: "no_charges",
      attention: true,
      attentionReason: "pix_absent",
      entitlementEnforcement: "OFF",
      entitlementGranted: false,
    },
    charges: [],
    payments: [],
    businessTimeline: [],
    events: [],
  };
});

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/platform/billing/clinicas/c1"]}>
      <Routes>
        <Route path="/platform/billing/clinicas/:clinicId" element={<PlatformClinicBillingDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlatformClinicBillingDetailPage", () => {
  it("keeps contract, Pix, charges and entitlement as separate facts", () => {
    renderDetail();
    expect(screen.getByText("Clínica Sul")).toBeInTheDocument();
    expect(screen.getByText(/Sync/)).toBeInTheDocument();
    expect(screen.getByText("Pix Automático Sandbox")).toBeInTheDocument();
    expect(screen.getByText("Pix Automático Produção")).toBeInTheDocument();
    expect(screen.getByText("Criado")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Próxima cobrança Sandbox")).toBeInTheDocument();
    expect(screen.getByText("Próxima cobrança Produção")).toBeInTheDocument();
    expect(screen.getByText("Último pagamento Sandbox")).toBeInTheDocument();
    expect(screen.getByText("Último pagamento Produção")).toBeInTheDocument();
    expect(screen.getByText("Sem cobrança")).toBeInTheDocument();
    expect(screen.getByText("Desligada")).toBeInTheDocument();
    expect(screen.getByText("Ainda não há cobrança registrada.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum evento técnico correlacionado.")).toBeInTheDocument();
    expect(screen.queryByText(/qr|payload|asaas/i)).not.toBeInTheDocument();
  });

  it("shows not found and error", () => {
    detailState.data = { found: false, clinicId: "missing", clinic: null, charges: [], payments: [], businessTimeline: [], events: [] };
    const { rerender } = renderDetail();
    expect(screen.getByText("Clínica não encontrada")).toBeInTheDocument();

    detailState.data = undefined;
    detailState.isError = true;
    detailState.error = { hint: "BILLING_NOT_PLATFORM_ADMIN" };
    rerender(
      <MemoryRouter initialEntries={["/platform/billing/clinicas/c1"]}>
        <Routes>
          <Route path="/platform/billing/clinicas/:clinicId" element={<PlatformClinicBillingDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
