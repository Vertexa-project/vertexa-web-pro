import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const {
  getPlatformBillingOverview,
  listPlatformBillingClinics,
  getPlatformClinicBillingDetail,
  listPlatformBillingEvents,
} = await import("./platformBilling");

beforeEach(() => {
  rpc.mockReset();
});

describe("platformBilling API", () => {
  it("maps overview without MRR, QR or provider ids", async () => {
    rpc.mockResolvedValue({
      data: {
        timezone: "America/Sao_Paulo",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        received_in_period_cents: 39000,
        pending_amount_cents: 1000,
        overdue_amount_cents: 39000,
        clinics_with_received: 1,
        delinquent_clinics: 1,
        active_commercial_contracts: 2,
        active_pix_automatic_authorizations: 1,
        payment_success_count: 1,
        attention_clinic_count: 2,
        aging: {
          d1_7: { clinic_count: 0, amount_cents: 0 },
          d8_15: { clinic_count: 0, amount_cents: 0 },
          d16_30: { clinic_count: 0, amount_cents: 0 },
          d31_plus: { clinic_count: 1, amount_cents: 39000 },
        },
        entitlement_enforcement: "OFF",
      },
      error: null,
    });
    const overview = await getPlatformBillingOverview();
    expect(rpc).toHaveBeenCalledWith("get_platform_billing_overview");
    expect(overview.delinquentClinics).toBe(1);
    expect(overview.entitlementEnforcement).toBe("OFF");
    expect(JSON.stringify(overview)).not.toMatch(/mrr|qr_payload|encoded_image|cus_|pay_/i);
  });

  it("maps clinic rows and strips unsafe event metadata", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        limit: 50,
        offset: 0,
        items: [
          {
            clinic_id: "c1",
            clinic_name: "Horizonte",
            plan_code: "pulse",
            plan_display_name: "Pulse",
            plan_price_cents: 39000,
            financial_summary: "overdue",
            overdue_count: 1,
            overdue_cents: 39000,
            attention: true,
            attention_reason: "overdue",
            pix_status: "ACTIVE",
            identity_complete: true,
            customer_bound: true,
            entitlement_granted: true,
          },
        ],
      },
      error: null,
    });
    const page = await listPlatformBillingClinics({ needsAttention: true });
    expect(rpc).toHaveBeenCalledWith(
      "list_platform_billing_clinics",
      expect.objectContaining({ p_needs_attention: true, p_limit: 50 }),
    );
    expect(page.items[0]?.entitlementGranted).toBe(false);
    expect(page.items[0]?.financialSummary).toBe("overdue");

    rpc.mockResolvedValueOnce({
      data: {
        found: true,
        clinic: { clinic_id: "c1", clinic_name: "Horizonte", financial_summary: "current" },
        charges: [],
        payments: [],
        business_timeline: [],
        events: [
          {
            id: "e1",
            event_type: "PAYMENT_RECEIVED",
            processing_status: "processed",
            received_at: "2026-09-01T00:00:00Z",
            related_entity_type: "payment",
            related_payment_id: "p1",
          },
        ],
      },
      error: null,
    });
    const detail = await getPlatformClinicBillingDetail("c1");
    expect(detail.found).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/payload|qr_|external_resource|asaas/i);

    rpc.mockResolvedValueOnce({
      data: {
        limit: 50,
        offset: 0,
        items: [
          {
            id: "e1",
            event_type: "PAYMENT_OVERDUE",
            processing_status: "failed",
            received_at: "2026-09-02T00:00:00Z",
            failure_category: "provider_timeout",
            related_entity_type: "payment",
          },
        ],
      },
      error: null,
    });
    const events = await listPlatformBillingEvents();
    expect(events.items[0]?.failureCategory).toBe("provider_timeout");
    expect(JSON.stringify(events)).not.toMatch(/payload_hash|external_event|qr_/i);
  });
});
