import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ClinicBillingPayment } from "@/lib/domain/billingHub";

const fixtures = vi.hoisted(() => ({
  query: {
    data: [] as ClinicBillingPayment[],
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@/hooks/useBillingHub", () => ({
  useClinicBillingPayments: () => fixtures.query,
}));

const { BillingHubPayments } = await import("./BillingHubPayments");

describe("BillingHubPayments", () => {
  beforeEach(() => {
    fixtures.query = { data: [], isLoading: false, isError: false, error: null };
  });

  it("shows empty history", () => {
    render(<BillingHubPayments clinicId="c1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/ainda não há pagamento/i);
  });

  it("renders received and overdue payments with method labels", () => {
    fixtures.query.data = [
      {
        id: "p1",
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-08-18",
        receivedDate: "2026-08-18",
        displayState: "received",
        method: "PIX",
      },
      {
        id: "p2",
        amountCents: 49700,
        currency: "BRL",
        dueDate: "2026-07-18",
        receivedDate: null,
        displayState: "overdue",
        method: "UNDEFINED",
      },
    ];
    render(<BillingHubPayments clinicId="c1" />);
    expect(screen.getByText("Recebido")).toBeInTheDocument();
    expect(screen.getByText("Vencido")).toBeInTheDocument();
    expect(screen.getByText(/não informado/i)).toBeInTheDocument();
    expect(screen.queryByText(/webhook|payload|asaas/i)).not.toBeInTheDocument();
  });

  it("shows error state", () => {
    fixtures.query.isError = true;
    render(<BillingHubPayments clinicId="c1" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
