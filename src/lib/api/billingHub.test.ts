import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const {
  getMyClinicBillingOverview,
  listMyClinicBillingCharges,
  listMyClinicBillingPayments,
  listMyClinicBillingTimeline,
} = await import("./billingHub");

beforeEach(() => {
  rpc.mockReset();
});

describe("billingHub API", () => {
  it("maps overview without provider ids, QR or webhook payload", async () => {
    rpc.mockResolvedValue({
      data: {
        clinic_id: "c1",
        plan: {
          status: "active",
          plan_display_name: "Pulse",
          price_cents: 39000,
          currency: "BRL",
          billing_cycle: "monthly",
        },
        pix_authorization_status: "REFUSED",
        pix_generation: 1,
        identity_complete: true,
        next_charge: null,
        financial_situation: {
          summary_code: "no_charges",
          attention: false,
          overdue_count: 0,
          overdue_cents: null,
        },
        latest_payment_display_state: null,
        charge_count: 0,
        entitlement_enforcement: "OFF",
        entitlement_granted: false,
      },
      error: null,
    });
    const overview = await getMyClinicBillingOverview("c1");
    expect(rpc).toHaveBeenCalledWith("get_my_clinic_billing_overview", { p_clinic_id: "c1" });
    expect(overview.plan?.displayName).toBe("Pulse");
    expect(overview.pixAuthorizationStatus).toBe("REFUSED");
    expect(overview.nextCharge).toBeNull();
    expect(overview.entitlementGranted).toBe(false);
    expect(JSON.stringify(overview)).not.toMatch(/asaas|cus_|pay_|webhook|qr_payload|encoded_image/i);
  });

  it("rejects a response for another clinic", async () => {
    rpc.mockResolvedValue({
      data: { clinic_id: "other", items: [] },
      error: null,
    });
    await expect(listMyClinicBillingCharges("c1")).rejects.toThrow(/BILLING_CLINIC_MISMATCH/);
  });

  it("maps charges and payments to safe domain rows", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        clinic_id: "c1",
        items: [
          {
            id: "ch1",
            amount_cents: 39000,
            currency: "BRL",
            due_date: "2026-10-18",
            paid_date: null,
            display_state: "PROGRAMMED",
            method: "PIX",
          },
          {
            id: "bad",
            amount_cents: 1,
            display_state: "SECRET",
            method: "PIX",
          },
        ],
      },
      error: null,
    });
    const charges = await listMyClinicBillingCharges("c1");
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ displayState: "PROGRAMMED", amountCents: 39000 });

    rpc.mockResolvedValueOnce({
      data: {
        clinic_id: "c1",
        items: [
          {
            id: "p1",
            amount_cents: 39000,
            currency: "BRL",
            due_date: "2026-09-01",
            received_date: "2026-09-01",
            display_state: "received",
            method: "BOLETO",
          },
        ],
      },
      error: null,
    });
    const payments = await listMyClinicBillingPayments("c1");
    expect(payments[0]).toMatchObject({ method: "BOLETO", displayState: "received" });
    expect(JSON.stringify(payments)).not.toMatch(/external_payment|provider_status|payload/i);
  });

  it("drops unknown timeline types and keeps business events", async () => {
    rpc.mockResolvedValue({
      data: {
        clinic_id: "c1",
        items: [
          { id: "e1", occurred_at: "2026-09-10T10:00:00Z", type: "plan_contracted" },
          { id: "e2", occurred_at: "2026-09-10T11:00:00Z", type: "processor_retry" },
        ],
      },
      error: null,
    });
    const events = await listMyClinicBillingTimeline("c1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("plan_contracted");
    expect(events[0].environment).toBeNull();
  });

  it("does not call asaas-outbound", async () => {
    rpc.mockResolvedValue({ data: { clinic_id: "c1", items: [] }, error: null });
    await listMyClinicBillingPayments("c1");
    expect(rpc.mock.calls.every((call) => String(call[0]).includes("asaas") === false)).toBe(true);
  });
});
