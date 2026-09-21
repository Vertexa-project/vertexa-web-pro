import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CommercialUsageBody } from "./BillingCommercialUsagePanel";
import type { ClinicCommercialUsage } from "@/lib/domain/billingCommercial";

const usage: ClinicCommercialUsage = {
  capacity: {
    clinicId: "c1",
    hasActiveContract: true,
    planCode: "sync",
    ownerExempt: 1,
    billableProfessionals: 3,
    includedProfessionals: 3,
    additionalProfessionalUnits: 0,
    allowedProfessionals: 3,
    remainingProfessionals: 0,
    professionalsExceeded: false,
    activePatients: 12,
    includedPatients: 100,
    additionalPatientUnits: 0,
    allowedPatients: 100,
    remainingPatients: 88,
    patientsExceeded: false,
    enforced: true,
  },
  price: {
    clinicId: "c1",
    hasActiveContract: true,
    planCode: "sync",
    contractedPlanVersion: 2,
    currentTableVersion: 2,
    tablePriceCents: 49700,
    lockedPriceCents: 39000,
    founderAdjustmentCents: 10700,
    additionalCapacityCents: 0,
    finalProjectedCents: 39000,
    pricingReason: "founder_lock",
    founderEligible: true,
    lockUntil: "2027-09-20",
    lifetimeDiscountBps: 3000,
    additionalProfessionalUnits: 0,
    additionalPatientUnits: 0,
    adjustmentsApplied: 0,
    projectionNotCharge: true,
  },
  founder: {
    badge: true,
    benefitStatus: "eligible",
    slotNumber: 4,
    lockUntil: "2027-09-20",
    lifetimeDiscountBps: 3000,
    initialFounderPriceCents: 39000,
    historical: true,
  },
  entitlementEnforcement: "OFF",
  projectionNotCharge: true,
};

vi.mock("@/hooks/useBillingCommercial", () => ({
  useClinicCommercialUsage: () => ({ data: usage, isLoading: false, isError: false }),
}));

describe("CommercialUsageBody", () => {
  it("separates projection from payment and explains owner exemption", () => {
    render(<CommercialUsageBody usage={usage} />);
    expect(screen.getByText("Founder Member")).toBeInTheDocument();
    expect(screen.getByText(/não é cobrança Asaas/i)).toBeInTheDocument();
    expect(screen.getByText(/dono responsável não consome/i)).toBeInTheDocument();
    expect(screen.getByText(/limite de profissionais/i)).toBeInTheDocument();
    expect(screen.getByText("Unidades adicionais")).toBeInTheDocument();
    expect(screen.queryByText(/R\$ 39,00/)).not.toBeInTheDocument();
  });
});
