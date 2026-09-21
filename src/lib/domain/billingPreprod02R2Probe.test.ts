import { describe, expect, it, vi } from "vitest";

import {
  agingByEnvironment,
  latestFactByEnvironment,
  nextChargeByEnvironment,
  pixStatusByEnvironment,
} from "./billingEnvScoping";
import {
  emptyClinicProviderFacts,
  emptyProviderEnvFacts,
  providerPixCopy,
} from "./platformBilling";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

const { mapPlatformClinicRow, mapPlatformOverview } = await import("@/lib/api/platformBilling");

const DEBUG_ENDPOINT = "http://127.0.0.1:7264/ingest/177d568b-dc11-4b10-8280-e97a64be4cf0";

function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "280e0a" },
    body: JSON.stringify({
      sessionId: "280e0a",
      runId: "preprod-02r2",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

describe("PREPROD-02R2 financial environment isolation", () => {
  it("keeps Pix ACTIVE in Sandbox from making Production ACTIVE", () => {
    const pix = pixStatusByEnvironment([
      { environment: "sandbox", status: "ACTIVE" },
      { environment: "production", status: "CREATED" },
    ]);
    debugLog("H1", "billingPreprod02R2Probe.test.ts:pix", "pix by environment", pix);
    expect(pix.sandbox).toBe("ACTIVE");
    expect(pix.production).toBe("CREATED");
    expect(pix.production).not.toBe("ACTIVE");
    expect(providerPixCopy({
      sandbox: { ...emptyProviderEnvFacts(), pixStatus: pix.sandbox },
      production: { ...emptyProviderEnvFacts(), pixStatus: pix.production },
    })).toContain("Sandbox: Ativo");
    expect(providerPixCopy({
      sandbox: { ...emptyProviderEnvFacts(), pixStatus: pix.sandbox },
      production: { ...emptyProviderEnvFacts(), pixStatus: pix.production },
    })).toContain("Produção: Criado");
  });

  it("does not let a newer Sandbox payment hide the Production latest payment", () => {
    const latest = latestFactByEnvironment([
      { environment: "sandbox", at: "2026-09-20", id: "pay-sandbox-newer" },
      { environment: "production", at: "2026-09-01", id: "pay-production-older" },
    ]);
    debugLog("H2", "billingPreprod02R2Probe.test.ts:latest", "latest pay by environment", latest);
    expect(latest.sandboxId).toBe("pay-sandbox-newer");
    expect(latest.productionId).toBe("pay-production-older");
    const reversed = latestFactByEnvironment([
      { environment: "production", at: "2026-09-21", id: "pay-production-newer" },
      { environment: "sandbox", at: "2026-09-02", id: "pay-sandbox-older" },
    ]);
    expect(reversed.productionId).toBe("pay-production-newer");
    expect(reversed.sandboxId).toBe("pay-sandbox-older");
  });

  it("keeps next charge dates independent per environment", () => {
    const next = nextChargeByEnvironment([
      { environment: "sandbox", dueDate: "2026-09-25" },
      { environment: "production", dueDate: "2026-09-28" },
    ]);
    debugLog("H3", "billingPreprod02R2Probe.test.ts:next", "next charge by environment", next);
    expect(next.sandboxDue).toBe("2026-09-25");
    expect(next.productionDue).toBe("2026-09-28");
    expect(next.sandboxDue).not.toBe(next.productionDue);
  });

  it("never puts Sandbox overdue cents into Production aging", () => {
    const aging = agingByEnvironment([
      { environment: "sandbox", aging: "d8_15", amountCents: 39000 },
      { environment: "production", aging: "d31_plus", amountCents: 15000 },
    ]);
    debugLog("H4", "billingPreprod02R2Probe.test.ts:aging", "aging by environment", aging);
    expect(aging.sandbox.d8_15).toBe(39000);
    expect(aging.production.d8_15).toBe(0);
    expect(aging.production.d31_plus).toBe(15000);
    expect(aging.sandbox.d31_plus).toBe(0);
  });

  it("maps clinic and overview provider facts without unlabeled collapse", () => {
    const row = mapPlatformClinicRow({
      clinic_id: "c-dual",
      clinic_name: "Dual",
      provider: {
        sandbox: {
          pix_status: "ACTIVE",
          latest_payment_date: "2026-09-20",
          latest_payment_state: "received",
          next_charge: { amount_cents: 1000, due_date: "2026-09-25", display_state: "PENDING" },
          aging_bucket: "d8_15",
          overdue_count: 1,
          overdue_cents: 39000,
        },
        production: {
          pix_status: "CREATED",
          latest_payment_date: "2026-09-01",
          latest_payment_state: "received",
          next_charge: { amount_cents: 2500, due_date: "2026-09-28", display_state: "PENDING" },
          aging_bucket: "d31_plus",
          overdue_count: 1,
          overdue_cents: 15000,
        },
      },
    });
    const overview = mapPlatformOverview({
      aging: {
        sandbox: { d8_15: { clinic_count: 1, amount_cents: 39000 } },
        production: { d31_plus: { clinic_count: 1, amount_cents: 15000 } },
      },
      delinquent: { sandbox: 1, production: 1 },
      active_pix_automatic_authorizations: { sandbox: 1, production: 0 },
    });
    debugLog("H5", "billingPreprod02R2Probe.test.ts:map", "mapped clinic/overview", {
      sandboxPix: row?.provider.sandbox.pixStatus,
      productionPix: row?.provider.production.pixStatus,
      sandboxLatest: row?.provider.sandbox.latestPaymentDate,
      productionLatest: row?.provider.production.latestPaymentDate,
      sandboxAging: overview.aging.sandbox.d8_15.amountCents,
      productionAgingD815: overview.aging.production.d8_15.amountCents,
    });
    expect(row?.provider.sandbox.pixStatus).toBe("ACTIVE");
    expect(row?.provider.production.pixStatus).toBe("CREATED");
    expect(row?.provider.sandbox.latestPaymentDate).toBe("2026-09-20");
    expect(row?.provider.production.latestPaymentDate).toBe("2026-09-01");
    expect(row?.provider.sandbox.nextCharge?.dueDate).toBe("2026-09-25");
    expect(row?.provider.production.nextCharge?.dueDate).toBe("2026-09-28");
    expect(overview.aging.sandbox.d8_15.amountCents).toBe(39000);
    expect(overview.aging.production.d8_15.amountCents).toBe(0);
    expect(overview.delinquent.sandbox).toBe(1);
    expect(emptyClinicProviderFacts().sandbox.pixStatus).toBeNull();
  });
});
