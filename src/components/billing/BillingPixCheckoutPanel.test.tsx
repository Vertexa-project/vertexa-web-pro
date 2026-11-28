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
const ensureMock = vi.fn(async () => ({}));
const prepareMock = vi.fn(async () => ({ operationId: "op1" }));
const executeMock = vi.fn(async () => ({ qrAvailable: false }));
vi.mock("@/hooks/useBillingPixCheckout", () => ({
  useEnsureClinicCustomerFromIdentity: () => ({ mutateAsync: ensureMock, isPending: false }),
  usePrepareClinicPixAuthorization: () => ({ mutateAsync: prepareMock, isPending: false }),
  useExecuteClinicPixAuthorization: () => ({ mutateAsync: executeMock, isPending: false }),
  useReissueClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

const { BillingPixCheckoutPanel } = await import("./BillingPixCheckoutPanel");

describe("BillingPixCheckoutPanel", () => {
  beforeEach(() => {
    ensureMock.mockClear();
    prepareMock.mockClear();
    executeMock.mockClear();
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

  it("cria o cliente no Asaas ao abrir a confirmação, uma vez só (cartão 1568)", async () => {
    const user = userEvent.setup({ delay: null });
    render(<BillingPixCheckoutPanel clinicId="c1" checkout={current.checkout} />);
    expect(ensureMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /configurar pix automático/i }));
    expect(ensureMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /gerar autorização pix/i }));
    expect(ensureMock).toHaveBeenCalledTimes(1);
  });

  it("não chama o Asaas para o cliente quando ele já existe", async () => {
    current.checkout = { ...current.checkout, providerCustomerBound: true };
    const user = userEvent.setup({ delay: null });
    render(<BillingPixCheckoutPanel clinicId="c1" checkout={current.checkout} />);
    await user.click(screen.getByRole("button", { name: /configurar pix automático/i }));
    await user.click(screen.getByRole("button", { name: /gerar autorização pix/i }));
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("prepara ao abrir a confirmação e o clique só cria a autorização (cartão 1568)", async () => {
    const user = userEvent.setup({ delay: null });
    render(<BillingPixCheckoutPanel clinicId="c1" checkout={current.checkout} />);
    expect(prepareMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /configurar pix automático/i }));
    await vi.waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
    expect(executeMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /gerar autorização pix/i }));
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalledWith("op1"));
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });
});
