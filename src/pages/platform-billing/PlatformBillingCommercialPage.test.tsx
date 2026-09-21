import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { emptyCommercialMetrics } from "@/lib/domain/billingCommercial";

const admit = vi.hoisted(() => vi.fn());
const closeCampaign = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true, isLoading: false }),
}));
vi.mock("@/hooks/useBillingCommercial", () => ({
  usePlatformCommercialGovernance: () => ({
    data: {
      ...emptyCommercialMetrics(),
      founderCampaignStatus: "open",
      founderAdmissionsUsed: 1,
      founderAdmissionsRemaining: 49,
      founderActive: 1,
      admissions: [
        {
          clinicId: "c1",
          clinicName: "Clínica Alfa",
          slotNumber: 1,
          benefitStatus: "eligible",
          planCode: "sync",
          lockUntil: "2027-09-20",
          lifetimeDiscountBps: 3000,
          cancelledAt: null,
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePlatformCommercialPlanOptions: () => ({
    data: [{ code: "sync", displayName: "Sync" }],
    isLoading: false,
  }),
  usePlatformClinicCommercialDetail: () => ({ data: null, isLoading: false }),
  useAdmitPlatformFounder: () => ({ mutateAsync: admit, isPending: false }),
  useClosePlatformFounderCampaign: () => ({ mutateAsync: closeCampaign, isPending: false }),
  useCancelPlatformFounder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestorePlatformFounder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetPlatformAdditionalCapacity: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { PlatformBillingCommercialPage } = await import("./PlatformBillingCommercialPage");

describe("PlatformBillingCommercialPage", () => {
  it("shows historical slot governance and does not send a client price", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <PlatformBillingCommercialPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Founder Member")).toBeInTheDocument();
    expect(screen.getByText("1 / 50")).toBeInTheDocument();
    expect(screen.getByText("Clínica Alfa")).toBeInTheDocument();
    expect(screen.getByText(/não é receita recebida/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^clínica$/i), "c-new");
    await user.click(screen.getByRole("button", { name: /admitir founder/i }));
    expect(admit).toHaveBeenCalledWith({ clinicId: "c-new", planCode: "sync" });
    expect(JSON.stringify(admit.mock.calls[0]?.[0])).not.toMatch(/price|slot|discount/);
  });
});
