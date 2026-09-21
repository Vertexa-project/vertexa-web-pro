import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ClinicBillingTimelineEvent } from "@/lib/domain/billingHub";

const fixtures = vi.hoisted(() => ({
  query: {
    data: [] as ClinicBillingTimelineEvent[],
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@/hooks/useBillingHub", () => ({
  useClinicBillingTimeline: () => fixtures.query,
}));

const { BillingHubTimeline } = await import("./BillingHubTimeline");

describe("BillingHubTimeline", () => {
  beforeEach(() => {
    fixtures.query = { data: [], isLoading: false, isError: false, error: null };
  });

  it("shows empty timeline", () => {
    render(<BillingHubTimeline clinicId="c1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/ainda não há eventos/i);
  });

  it("renders business labels newest-first, environment badges, and hides internals", () => {
    fixtures.query.data = [
      { id: "1", occurredAt: "2026-09-01T10:00:00Z", type: "plan_contracted" },
      { id: "2", occurredAt: "2026-09-10T10:00:00Z", type: "pix_refused", environment: "sandbox" },
      { id: "3", occurredAt: "2026-09-12T10:00:00Z", type: "payment_received", environment: "sandbox" },
      { id: "4", occurredAt: "2026-09-13T10:00:00Z", type: "payment_received", environment: "production" },
    ];
    render(<BillingHubTimeline clinicId="c1" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/pagamento recebido/i);
    expect(items[0]).toHaveTextContent(/produção/i);
    expect(items[1]).toHaveTextContent(/pagamento recebido/i);
    expect(items[1]).toHaveTextContent(/sandbox/i);
    expect(items[0].textContent).not.toBe(items[1].textContent);
    expect(items[2]).toHaveTextContent(/pix automático recusado/i);
    expect(items[3]).toHaveTextContent(/plano contratado/i);
    expect(screen.queryByText(/processor|webhook|payload/i)).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    fixtures.query.isLoading = true;
    render(<BillingHubTimeline clinicId="c1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/carregando a linha do tempo/i);
  });
});
