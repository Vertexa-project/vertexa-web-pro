import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const { getPlatformBillingReport, listPlatformBillingReportExport } = await import(
  "./platformBillingReports"
);

beforeEach(() => {
  rpc.mockReset();
});

describe("platformBillingReports API", () => {
  it("maps the period report without MRR, QR or provider ids", async () => {
    rpc.mockResolvedValue({
      data: {
        timezone: "America/Sao_Paulo",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        as_of: "2026-09-20",
        not_mrr: true,
        entitlement_enforcement: "OFF",
        financial: {
          sandbox: {
            received_in_period_cents: 40000,
            received_in_period_count: 1,
            pending_in_period_cents: 1000,
            pending_in_period_count: 1,
            overdue_in_period_cents: 0,
            overdue_in_period_count: 0,
          },
          production: {
            received_in_period_cents: 0,
            received_in_period_count: 0,
            pending_in_period_cents: 0,
            pending_in_period_count: 0,
            overdue_in_period_cents: 0,
            overdue_in_period_count: 0,
          },
        },
        received_by_plan: [
          {
            environment: "sandbox",
            plan_code: "pulse",
            plan_display_name: "Pulse",
            plan_attribution: "contract",
            received_cents: 40000,
            payment_count: 1,
          },
        ],
        payments_by_status: [{ status: "received", payment_count: 1, amount_cents: 40000 }],
        active_pix_automatic_authorizations: 1,
        delinquent_clinics: 0,
        delinquent_items: [],
        export_max_rows: 500,
      },
      error: null,
    });
    const report = await getPlatformBillingReport("2026-09-01", "2026-09-30");
    expect(rpc).toHaveBeenCalledWith("get_platform_billing_report", {
      p_period_start: "2026-09-01",
      p_period_end: "2026-09-30",
    });
    expect(report.notMrr).toBe(true);
    expect(report.financial.sandbox.receivedCents).toBe(40000);
    expect(report.financial.production.receivedCents).toBe(0);
    expect(report.receivedByPlan[0]?.planAttribution).toBe("contract");
    expect(JSON.stringify(report)).not.toMatch(/qr_payload|encoded_image|service_role|tax_id/i);
    expect(report.notMrr).toBe(true);
  });

  it("maps unknown historical plan as unattributed", async () => {
    rpc.mockResolvedValue({
      data: {
        received_by_plan: [{ plan_attribution: "unattributed", received_cents: 1000, payment_count: 1 }],
        payments_by_status: [],
        delinquent_items: [],
      },
      error: null,
    });
    const report = await getPlatformBillingReport();
    expect(report.receivedByPlan[0]?.planAttribution).toBe("unattributed");
    expect(report.receivedByPlan[0]?.planCode).toBeNull();
  });

  it("requests a bounded export page", async () => {
    rpc.mockResolvedValue({
      data: {
        kind: "payments",
        limit: 200,
        offset: 0,
        max_limit: 500,
        items: [{ row_kind: "payment", clinic_name: "Norte", amount_cents: 39000 }],
      },
      error: null,
    });
    const page = await listPlatformBillingReportExport({ kind: "payments", limit: 999 });
    expect(rpc).toHaveBeenCalledWith("list_platform_billing_report_export", {
      p_period_start: null,
      p_period_end: null,
      p_kind: "payments",
      p_limit: 999,
      p_offset: 0,
      p_environment: null,
    });
    expect(page.maxLimit).toBe(500);
    expect(page.items).toHaveLength(1);
  });

  it("sends the environment filter to the export RPC instead of filtering only in the browser", async () => {
    rpc.mockResolvedValue({
      data: {
        kind: "payments",
        environment: "production",
        limit: 200,
        offset: 0,
        max_limit: 500,
        items: [{ row_kind: "payment", environment: "production", amount_cents: 0 }],
      },
      error: null,
    });
    await listPlatformBillingReportExport({ kind: "payments", environment: "production" });
    expect(rpc).toHaveBeenCalledWith("list_platform_billing_report_export", {
      p_period_start: null,
      p_period_end: null,
      p_kind: "payments",
      p_limit: 200,
      p_offset: 0,
      p_environment: "production",
    });
    rpc.mockResolvedValue({
      data: {
        kind: "payments",
        environment: "sandbox",
        limit: 200,
        offset: 0,
        max_limit: 500,
        items: [{ row_kind: "payment", environment: "sandbox", amount_cents: 39000 }],
      },
      error: null,
    });
    await listPlatformBillingReportExport({ kind: "payments", environment: "sandbox" });
    expect(rpc).toHaveBeenCalledWith("list_platform_billing_report_export", {
      p_period_start: null,
      p_period_end: null,
      p_kind: "payments",
      p_limit: 200,
      p_offset: 0,
      p_environment: "sandbox",
    });
  });
});
