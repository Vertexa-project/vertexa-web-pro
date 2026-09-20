import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ClinicCommercialCheckout } from "@/lib/domain/billingCheckout";

const current: { checkout: ClinicCommercialCheckout } = { checkout: {
  clinicId: "c1",
  founderCheckout: "OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY",
  identityExists: true,
  identityComplete: true,
  localBillingAccountExists: true,
  localBillingAccountSandbox: true,
  providerCustomerBound: false,
  commercialContract: {
    id: "cc1",
    status: "active",
    planId: "p",
    planVersionId: "v",
    planCode: "pulse",
    planDisplayName: "Pulse",
    priceCents: 39000,
    currency: "BRL",
    billingCycle: "monthly",
  },
  pixAuthorizationStatus: null,
  pixNextAction: "ensure_customer",
  qrAvailableNow: false,
  entitlementEnforcement: "OFF",
  entitlementGranted: false,
} };

vi.mock("@/hooks/useBillingCheckout", () => ({
  useClinicCommercialCheckout: () => ({
    data: current.checkout,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useBillingPixCheckout", () => ({
  useEnsureClinicCustomerFromIdentity: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePrepareClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExecuteClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReissueClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

const { BillingPixCheckoutPanel } = await import("./BillingPixCheckoutPanel");

describe("BillingPixCheckoutPanel", () => {
  beforeEach(() => {
    current.checkout = {
      ...current.checkout,
      pixAuthorizationStatus: null,
      pixNextAction: "ensure_customer",
      providerCustomerBound: false,
    };
  });

  it("starts from the commercial contract and asks for explicit Pix confirmation", async () => {
    const user = userEvent.setup({ delay: null });
    render(<BillingPixCheckoutPanel clinicId="c1" checkout={current.checkout} />);
    expect(screen.getByRole("button", { name: /configurar pix automático/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /configurar pix automático/i }));
    expect(screen.getByText(/não pede senha/i)).toBeInTheDocument();
    expect(screen.queryByText(/nubank|itaú/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gerar autorização pix/i })).toBeEnabled();
  });

  it("after reload of a CREATED authorization, does not pretend the QR is recoverable", () => {
    current.checkout = {
      ...current.checkout,
      pixAuthorizationStatus: "CREATED",
      pixNextAction: "await_bank",
      providerCustomerBound: true,
    };
    render(<BillingPixCheckoutPanel clinicId="c1" checkout={current.checkout} />);
    expect(screen.getByText(/autorização criada \/ aguardando conclusão/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gerar novo qr/i })).not.toBeInTheDocument();
  });
});
