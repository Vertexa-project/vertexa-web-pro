import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const { listSellableBillingPlans, getMyClinicCommercialCheckout, createMyClinicCommercialContract } =
  await import("./billingCheckout");

beforeEach(() => {
  rpc.mockReset();
});

describe("billingCheckout API", () => {
  it("lista só campos de catálogo e descarta founder", async () => {
    rpc.mockResolvedValue({
      data: {
        founder_checkout: "OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY",
        plans: [
          {
            plan_id: "p1",
            plan_version_id: "v1",
            code: "pulse",
            display_name: "Pulse",
            price_cents: 39000,
            currency: "BRL",
            billing_cycle: "monthly",
            tagline: "Base",
            features: ["Painel de pacientes"],
            sellable: true,
          },
          {
            plan_id: "p9",
            plan_version_id: "v9",
            code: "founder_2026",
            display_name: "Founder",
            price_cents: 24700,
            currency: "BRL",
            billing_cycle: "monthly",
            sellable: true,
          },
        ],
      },
      error: null,
    });
    const plans = await listSellableBillingPlans();
    expect(rpc).toHaveBeenCalledWith("list_sellable_billing_plans");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ code: "pulse", priceCents: 39000, planVersionId: "v1" });
    expect(JSON.stringify(plans)).not.toMatch(/asaas|cus_|founder_2026/i);
  });

  it("lê o overview comercial sem IDs de provedor", async () => {
    rpc.mockResolvedValue({
      data: {
        clinic_id: "c1",
        identity_exists: true,
        identity_complete: true,
        local_billing_account_exists: false,
        commercial_contract: null,
        pix_authorization_status: null,
        entitlement_enforcement: "OFF",
        entitlement_granted: false,
      },
      error: null,
    });
    const checkout = await getMyClinicCommercialCheckout("c1");
    expect(rpc).toHaveBeenCalledWith("get_my_clinic_commercial_checkout", { p_clinic_id: "c1" });
    expect(checkout.founderCheckout).toBe("OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY");
    expect(checkout.entitlementGranted).toBe(false);
    expect(checkout.commercialContract).toBeNull();
  });

  it("confirma contrato só com clínica e planVersionId", async () => {
    rpc.mockResolvedValue({
      data: {
        clinic_id: "c1",
        identity_complete: true,
        local_billing_account_exists: true,
        commercial_contract: {
          id: "cc1",
          status: "active",
          plan_id: "p1",
          plan_version_id: "v1",
          plan_code: "pulse",
          plan_display_name: "Pulse",
          price_cents: 39000,
          currency: "BRL",
          billing_cycle: "monthly",
        },
        pix_authorization_status: null,
        entitlement_granted: false,
      },
      error: null,
    });
    const result = await createMyClinicCommercialContract({ clinicId: "c1", planVersionId: "v1" });
    expect(rpc).toHaveBeenCalledWith("create_my_clinic_commercial_contract", {
      p_clinic_id: "c1",
      p_plan_version_id: "v1",
    });
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toMatch(/price|amount|currency|environment|offer/i);
    expect(result.commercialContract?.status).toBe("active");
    expect(result.pixAuthorizationStatus).toBeNull();
  });
});
