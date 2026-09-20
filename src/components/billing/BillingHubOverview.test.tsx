import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fixtures = vi.hoisted(() => ({
  query: {
    data: {
      clinicId: "c1",
      plan: null as null | {
        displayName: string;
        priceCents: number;
        currency: string;
        billingCycle: "monthly";
        contractStatus: string;
      },
      pixAuthorizationStatus: null as "ACTIVE" | "REFUSED" | null,
      pixGeneration: null as number | null,
      identityComplete: false,
      nextCharge: null as null | {
        amountCents: number;
        currency: string;
        dueDate: string;
        displayState: "PROGRAMMED";
      },
      financialSituation: {
        summaryCode: "no_plan" as "no_plan" | "no_charges" | "pending" | "overdue",
        attention: false,
        overdueCount: 0,
        overdueCents: null as number | null,
      },
      latestPaymentDisplayState: null as "pending" | "received" | "overdue" | null,
      chargeCount: 0,
      entitlementEnforcement: "OFF" as const,
      entitlementGranted: false as const,
    },
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@/hooks/useBillingHub", () => ({
  useClinicBillingOverview: () => fixtures.query,
}));

const { BillingHubOverview } = await import("./BillingHubOverview");
const { emptyBillingOverview } = await import("@/lib/domain/billingHub");
type ClinicCommercialCheckout = import("@/lib/domain/billingCheckout").ClinicCommercialCheckout;

const checkout: ClinicCommercialCheckout = {
  clinicId: "c1",
  founderCheckout: "OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY",
  identityExists: true,
  identityComplete: true,
  localBillingAccountExists: true,
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
  pixAuthorizationStatus: "ACTIVE",
  entitlementEnforcement: "OFF",
  entitlementGranted: false,
};

describe("BillingHubOverview", () => {
  beforeEach(() => {
    fixtures.query = {
      data: {
        ...emptyBillingOverview("c1"),
        clinicId: "c1",
        plan: {
          displayName: "Pulse",
          priceCents: 39000,
          currency: "BRL",
          billingCycle: "monthly",
          contractStatus: "active",
        },
        pixAuthorizationStatus: "ACTIVE",
        identityComplete: true,
        nextCharge: {
          amountCents: 39000,
          currency: "BRL",
          dueDate: "2026-10-18",
          displayState: "PROGRAMMED",
        },
        financialSituation: {
          summaryCode: "pending",
          attention: false,
          overdueCount: 0,
          overdueCents: null,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it("shows plan, Pix, next charge and situation without collapsing four states", () => {
    render(<BillingHubOverview clinicId="c1" checkout={checkout} />);
    expect(screen.getByText("Plano atual")).toBeInTheDocument();
    expect(screen.getAllByText(/Pulse/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pix Automático").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/autorizada/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Próxima cobrança")).toBeInTheDocument();
    expect(screen.getAllByText(/390/).length).toBeGreaterThan(0);
    expect(screen.getByText("desligada")).toBeInTheDocument();
    expect(screen.queryByText(/asaas|cus_/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/qr code|encoded_image/i)).not.toBeInTheDocument();
  });

  it("uses empty copy when no next charge exists", () => {
    fixtures.query.data.nextCharge = null;
    fixtures.query.data.financialSituation = {
      summaryCode: "no_charges",
      attention: false,
      overdueCount: 0,
      overdueCents: null,
    };
    render(<BillingHubOverview clinicId="c1" checkout={checkout} />);
    expect(screen.getByText(/nenhuma cobrança futura/i)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    fixtures.query.isLoading = true;
    const { rerender } = render(<BillingHubOverview clinicId="c1" checkout={checkout} />);
    expect(screen.getByRole("status")).toHaveTextContent(/carregando o resumo/i);
    fixtures.query.isLoading = false;
    fixtures.query.isError = true;
    fixtures.query.error = { hint: "BILLING_NOT_CLINIC_ADMIN" };
    rerender(<BillingHubOverview clinicId="c1" checkout={checkout} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/administrador/i);
  });

  it("marks overdue as attention", () => {
    fixtures.query.data.financialSituation = {
      summaryCode: "overdue",
      attention: true,
      overdueCount: 1,
      overdueCents: 39000,
    };
    fixtures.query.data.pixAuthorizationStatus = "REFUSED";
    render(<BillingHubOverview clinicId="c1" checkout={checkout} />);
    expect(screen.getByText("Atenção")).toBeInTheDocument();
    expect(screen.getByText(/não cria outra cobrança/i)).toBeInTheDocument();
    expect(screen.getAllByText(/recusada/i).length).toBeGreaterThan(0);
  });
});
