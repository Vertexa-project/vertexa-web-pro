import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fixtures = vi.hoisted(() => ({
  emptyIdentity: {
    clinicId: "c1",
    exists: false,
    isComplete: false,
    legalName: null as string | null,
    taxId: null as string | null,
    taxIdMasked: null as string | null,
    email: null as string | null,
    mobilePhone: null as string | null,
    updatedAt: null as string | null,
  },
  savedIdentity: {
    clinicId: "c1",
    exists: true,
    isComplete: true,
    legalName: "Clínica Sintética LTDA",
    taxId: "99991111140",
    taxIdMasked: "***.***.***-40",
    email: "bill@t.test",
    mobilePhone: null as string | null,
    updatedAt: "2026-09-12T00:00:00Z",
  },
  pulse: {
    planId: "plan-pulse",
    planVersionId: "ver-pulse",
    code: "pulse",
    displayName: "Pulse",
    priceCents: 39000,
    currency: "BRL" as const,
    billingCycle: "monthly" as const,
    tagline: "O pulso constante",
    marketingMessage: null,
    features: ["Painel de pacientes"],
    sellable: true,
  },
  checkout: {
    clinicId: "c1",
    founderCheckout: "OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY" as const,
    identityExists: false,
    identityComplete: false,
    localBillingAccountExists: false,
    commercialContract: null as null | {
      id: string;
      status: "active";
      planId: string;
      planVersionId: string;
      planCode: string;
      planDisplayName: string;
      priceCents: number;
      currency: string;
      billingCycle: "monthly";
    },
    pixAuthorizationStatus: null,
    entitlementEnforcement: "OFF" as const,
    entitlementGranted: false as const,
  },
  isClinicAdmin: true,
  adminLoading: false,
  pageLoading: false,
  pageError: false,
  identityExists: false,
  createPending: false,
  mutateIdentity: vi.fn(),
  mutateContract: vi.fn(),
  refetchCheckout: vi.fn(),
}));

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({
    isClinicAdmin: fixtures.isClinicAdmin,
    isLoading: fixtures.adminLoading,
    isError: false,
  }),
}));
vi.mock("@/hooks/useBillingProfile", () => ({
  useClinicBillingIdentity: () => ({
    data: fixtures.identityExists ? fixtures.savedIdentity : fixtures.emptyIdentity,
    isLoading: false,
    isError: false,
  }),
  useUpsertClinicBillingIdentity: () => ({
    mutate: fixtures.mutateIdentity,
    isPending: false,
  }),
}));
vi.mock("@/hooks/useBillingCheckout", () => ({
  useSellableBillingPlans: () => ({
    data: [fixtures.pulse],
    isLoading: fixtures.pageLoading,
    isError: fixtures.pageError,
  }),
  useClinicCommercialCheckout: () => ({
    data: fixtures.checkout,
    isLoading: fixtures.pageLoading,
    isError: fixtures.pageError,
    refetch: fixtures.refetchCheckout,
  }),
  useCreateClinicCommercialContract: () => ({
    mutate: fixtures.mutateContract,
    isPending: fixtures.createPending,
  }),
}));
vi.mock("@/hooks/useBillingPixCheckout", () => ({
  useEnsureClinicCustomerFromIdentity: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePrepareClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExecuteClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReissueClinicPixAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useBillingCommercial", () => ({
  useClinicCommercialUsage: () => ({
    data: {
      capacity: {
        clinicId: "c1",
        hasActiveContract: true,
        planCode: "pulse",
        ownerExempt: 1,
        billableProfessionals: 0,
        includedProfessionals: 2,
        additionalProfessionalUnits: 0,
        allowedProfessionals: 2,
        remainingProfessionals: 2,
        professionalsExceeded: false,
        activePatients: 0,
        includedPatients: 50,
        additionalPatientUnits: 0,
        allowedPatients: 50,
        remainingPatients: 50,
        patientsExceeded: false,
        enforced: true,
      },
      price: {
        clinicId: "c1",
        hasActiveContract: true,
        planCode: "pulse",
        contractedPlanVersion: 2,
        currentTableVersion: 2,
        tablePriceCents: 39000,
        lockedPriceCents: null,
        founderAdjustmentCents: 0,
        additionalCapacityCents: 0,
        finalProjectedCents: 39000,
        pricingReason: "standard_snapshot",
        founderEligible: false,
        lockUntil: null,
        lifetimeDiscountBps: null,
        additionalProfessionalUnits: 0,
        additionalPatientUnits: 0,
        adjustmentsApplied: 0,
        projectionNotCharge: true,
      },
      founder: null,
      entitlementEnforcement: "OFF",
      projectionNotCharge: true,
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useBillingHub", () => ({
  useClinicBillingOverview: () => ({
    data: {
      clinicId: "c1",
      plan: fixtures.checkout.commercialContract
        ? {
            displayName: fixtures.checkout.commercialContract.planDisplayName,
            priceCents: fixtures.checkout.commercialContract.priceCents,
            currency: "BRL",
            billingCycle: "monthly",
            contractStatus: "active",
          }
        : null,
      pixAuthorizationStatus: fixtures.checkout.pixAuthorizationStatus,
      pixGeneration: null,
      identityComplete: fixtures.checkout.identityComplete,
      nextCharge: null,
      financialSituation: {
        summaryCode: fixtures.checkout.commercialContract ? "no_charges" : "no_plan",
        attention: false,
        overdueCount: 0,
        overdueCents: null,
      },
      latestPaymentDisplayState: null,
      chargeCount: 0,
      entitlementEnforcement: "OFF",
      entitlementGranted: false,
    },
    isLoading: false,
    isError: false,
  }),
  useClinicBillingCharges: () => ({ data: [], isLoading: false, isError: false }),
  useClinicBillingPayments: () => ({ data: [], isLoading: false, isError: false }),
  useClinicBillingTimeline: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

const { BillingProfilePage } = await import("./BillingProfilePage");

describe("BillingProfilePage commercial checkout", () => {
  beforeEach(() => {
    fixtures.isClinicAdmin = true;
    fixtures.adminLoading = false;
    fixtures.pageLoading = false;
    fixtures.pageError = false;
    fixtures.identityExists = false;
    fixtures.createPending = false;
    fixtures.checkout.identityExists = false;
    fixtures.checkout.identityComplete = false;
    fixtures.checkout.commercialContract = null;
    fixtures.checkout.localBillingAccountExists = false;
    fixtures.mutateIdentity.mockReset();
    fixtures.mutateContract.mockReset();
    fixtures.refetchCheckout.mockReset();
  });

  it("nega acesso ao não-admin sem checkout", () => {
    fixtures.isClinicAdmin = false;
    render(<BillingProfilePage />);
    expect(screen.getByText(/apenas o administrador da clínica/i)).toBeInTheDocument();
    expect(screen.queryByText("Pulse")).not.toBeInTheDocument();
    expect(screen.queryByText(/asaas|cus_|billing_customer/i)).not.toBeInTheDocument();
  });

  it("mostra cards com preço vindo do RPC e avança para cobrança", async () => {
    const user = userEvent.setup({ delay: null });
    render(<BillingProfilePage />);
    expect(screen.getByRole("button", { name: /pulse/i })).toBeInTheDocument();
    expect(screen.getByText(/390/)).toBeInTheDocument();
    expect(screen.queryByText("390")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /pulse/i }));
    await user.click(screen.getByRole("button", { name: /^continuar$/i }));
    expect(screen.getByLabelText(/razão social \/ nome legal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cpf\/cnpj/i)).toBeInTheDocument();
  });

  it("valida CPF no passo de cobrança e não chama contrato", async () => {
    const user = userEvent.setup({ delay: null });
    render(<BillingProfilePage />);
    await user.click(screen.getByRole("button", { name: /pulse/i }));
    await user.click(screen.getByRole("button", { name: /^continuar$/i }));
    await user.type(screen.getByLabelText(/razão social \/ nome legal/i), "Clínica Alfa");
    await user.type(screen.getByLabelText(/cpf\/cnpj/i), "11111111111");
    await user.type(screen.getByLabelText(/e-mail de cobrança/i), "bill@t.test");
    await user.click(screen.getByRole("button", { name: /salvar dados de cobrança/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cpf ou cnpj inválido/i);
    expect(fixtures.mutateIdentity).not.toHaveBeenCalled();
    expect(fixtures.mutateContract).not.toHaveBeenCalled();
  });

  it("revisa e confirma só o contrato comercial", async () => {
    const user = userEvent.setup({ delay: null });
    fixtures.identityExists = true;
    fixtures.checkout.identityExists = true;
    fixtures.checkout.identityComplete = true;
    render(<BillingProfilePage />);
    await user.click(screen.getByRole("button", { name: /pulse/i }));
    await user.click(screen.getByRole("button", { name: /^continuar$/i }));
    expect(screen.getByRole("button", { name: /confirmar contratação/i })).toBeInTheDocument();
    expect(screen.getByText(/sem pix e sem qr/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirmar contratação/i }));
    expect(fixtures.mutateContract).toHaveBeenCalledWith("ver-pulse", expect.any(Object));
  });

  it("desabilita confirmação em double-submit", async () => {
    const user = userEvent.setup({ delay: null });
    fixtures.identityExists = true;
    fixtures.checkout.identityComplete = true;
    fixtures.createPending = true;
    render(<BillingProfilePage />);
    await user.click(screen.getByRole("button", { name: /pulse/i }));
    await user.click(screen.getByRole("button", { name: /^continuar$/i }));
    expect(screen.getByRole("button", { name: /confirmando/i })).toBeDisabled();
  });

  it("mostra o hub da clínica sem fingir checkout completo", () => {
    fixtures.identityExists = true;
    fixtures.checkout.identityComplete = true;
    fixtures.checkout.commercialContract = {
      id: "cc1",
      status: "active",
      planId: "plan-pulse",
      planVersionId: "ver-pulse",
      planCode: "pulse",
      planDisplayName: "Pulse",
      priceCents: 39000,
      currency: "BRL",
      billingCycle: "monthly",
    };
    render(<BillingProfilePage />);
    expect(screen.getByText("Situação da assinatura")).toBeInTheDocument();
    expect(screen.getByText("Cobranças")).toBeInTheDocument();
    expect(screen.getByText("Pagamentos")).toBeInTheDocument();
    expect(screen.getByText("Linha do tempo")).toBeInTheDocument();
    expect(screen.getAllByText("Plano atual").length).toBeGreaterThan(0);
    expect(screen.getByText("Uso e valor comercial")).toBeInTheDocument();
    expect(screen.getByText(/não é cobrança Asaas/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /configurar pix automático/i })).toBeEnabled();
    expect(screen.queryByText(/cus_/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar cobrança/i })).not.toBeInTheDocument();
  });
});
