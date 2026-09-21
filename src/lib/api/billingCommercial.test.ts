import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const {
  admitPlatformFounderClinic,
  getMyClinicCommercialUsage,
  getPlatformCommercialGovernance,
  setPlatformClinicAdditionalCapacity,
} = await import("./billingCommercial");

beforeEach(() => {
  rpc.mockReset();
});

describe("billingCommercial API", () => {
  it("maps clinic usage without accepting a client price", async () => {
    rpc.mockResolvedValue({
      data: {
        capacity: {
          clinic_id: "c1",
          has_active_contract: true,
          plan_code: "sync",
          owner_exempt: 1,
          billable_professionals: 2,
          included_professionals: 3,
          allowed_professionals: 3,
          remaining_professionals: 1,
          active_patients: 10,
          included_patients: 100,
          allowed_patients: 100,
          remaining_patients: 90,
          enforced: true,
        },
        price: {
          clinic_id: "c1",
          has_active_contract: true,
          plan_code: "sync",
          table_price_cents: 49700,
          locked_price_cents: 39000,
          final_projected_cents: 39000,
          pricing_reason: "founder_lock",
          founder_eligible: true,
        },
        founder: {
          badge: true,
          benefit_status: "eligible",
          slot_number: 7,
          lock_until: "2027-09-20",
          lifetime_discount_bps: 3000,
          initial_founder_price_cents: 39000,
        },
      },
      error: null,
    });
    const usage = await getMyClinicCommercialUsage("c1");
    expect(rpc).toHaveBeenCalledWith("get_my_clinic_commercial_usage", { p_clinic_id: "c1" });
    expect(usage.price.finalProjectedCents).toBe(39000);
    expect(usage.founder?.slotNumber).toBe(7);
    expect(usage.projectionNotCharge).toBe(true);
    expect(JSON.stringify(usage)).not.toMatch(/qr_payload|asaas|service_role/);
  });

  it("sends only clinic and plan code for Founder admission", async () => {
    rpc.mockResolvedValue({ data: { outcome: "admitted" }, error: null });
    await admitPlatformFounderClinic("c1", "sync");
    expect(rpc).toHaveBeenCalledWith("admit_platform_founder_clinic", {
      p_clinic_id: "c1",
      p_plan_code: "sync",
    });
    expect(JSON.stringify(rpc.mock.calls[0]?.[1])).not.toMatch(/price|slot|discount/);
  });

  it("maps governance metrics and rejects client-controlled add-on amounts", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        founder_campaign_status: "open",
        founder_admissions_used: 2,
        founder_admissions_remaining: 48,
        founder_active: 1,
        founder_historical: 1,
        founder_clinics_by_plan: { sync: 1 },
        admissions: [{ clinic_id: "c1", clinic_name: "Alfa", slot_number: 1, benefit_status: "eligible", plan_code: "sync" }],
      },
      error: null,
    });
    const gov = await getPlatformCommercialGovernance();
    expect(gov.founderAdmissionsRemaining).toBe(48);
    expect(gov.admissions[0]?.clinicName).toBe("Alfa");
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await setPlatformClinicAdditionalCapacity({
      clinicId: "c1",
      additionalProfessionals: 2,
      additionalPatients: 1,
    });
    expect(rpc).toHaveBeenLastCalledWith("set_platform_clinic_additional_capacity", {
      p_clinic_id: "c1",
      p_additional_professionals: 2,
      p_additional_patients: 1,
    });
  });
});
