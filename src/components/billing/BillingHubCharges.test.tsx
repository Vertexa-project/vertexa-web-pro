import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ClinicBillingCharge } from "@/lib/domain/billingHub";

const fixtures = vi.hoisted(() => ({
  query: {
    data: [] as ClinicBillingCharge[],
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@/hooks/useBillingHub", () => ({
  useClinicBillingCharges: () => fixtures.query,
}));

const { BillingHubCharges } = await import("./BillingHubCharges");

describe("BillingHubCharges", () => {
  beforeEach(() => {
    fixtures.query = { data: [], isLoading: false, isError: false, error: null };
  });

  it("shows empty, loading and error states", () => {
    const { rerender } = render(<BillingHubCharges clinicId="c1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/ainda não há cobrança/i);
    fixtures.query.isLoading = true;
    rerender(<BillingHubCharges clinicId="c1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/carregando cobranças/i);
    fixtures.query.isLoading = false;
    fixtures.query.isError = true;
    rerender(<BillingHubCharges clinicId="c1" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar cobrança/i })).not.toBeInTheDocument();
  });

  it("distinguishes programmed, pending, paid and overdue", () => {
    fixtures.query.data = [
      {
        id: "1",
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-10-18",
        paidDate: null,
        displayState: "PROGRAMMED",
        method: "PIX",
      },
      {
        id: "2",
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-09-18",
        paidDate: null,
        displayState: "PENDING",
        method: "PIX",
      },
      {
        id: "3",
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-08-18",
        paidDate: "2026-08-18",
        displayState: "PAID",
        method: "BOLETO",
      },
      {
        id: "4",
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-07-18",
        paidDate: null,
        displayState: "OVERDUE",
        method: "CREDIT_CARD",
      },
    ];
    render(<BillingHubCharges clinicId="c1" />);
    expect(screen.getByText("Programada")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Paga")).toBeInTheDocument();
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(screen.getByText(/não cria outra cobrança/i)).toBeInTheDocument();
    expect(screen.getByText(/cartão/i)).toBeInTheDocument();
  });
});
