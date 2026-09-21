import { describe, expect, it } from "vitest";

import {
  customerBoundAnyEnvironment,
  customerBoundDistinctOnNewest,
  financialBucketsByEnvironment,
  receivedTotalsByEnvironment,
  timelineEventsCollapseEnvironment,
} from "./billingEnvScoping";
import { resolveCommercialShellGate } from "./commercialAccess";

const sandboxBound = {
  id: "acc-sandbox",
  environment: "sandbox" as const,
  createdAt: "2026-01-01T00:00:00Z",
  externalCustomerId: "cus_sandbox_A",
};
const productionUnbound = {
  id: "acc-production",
  environment: "production" as const,
  createdAt: "2026-09-21T00:00:00Z",
  externalCustomerId: null,
};
const productionBound = {
  ...productionUnbound,
  externalCustomerId: "cus_production_B",
};
const sandboxUnbound = { ...sandboxBound, externalCustomerId: null };

describe("PREPROD-02R1 dual-env facts and commercial fail-closed", () => {
  it("customer_bound is BOOL_OR, not DISTINCT ON newest", () => {
    expect(customerBoundAnyEnvironment([sandboxBound, productionUnbound])).toBe(true);
    expect(customerBoundAnyEnvironment([sandboxUnbound, productionBound])).toBe(true);
    expect(customerBoundAnyEnvironment([sandboxBound, productionBound])).toBe(true);
    expect(customerBoundAnyEnvironment([sandboxUnbound, productionUnbound])).toBe(false);
    expect(customerBoundDistinctOnNewest([sandboxBound, productionUnbound])).toBe(false);
  });

  it("keeps Sandbox received out of Production received", () => {
    const buckets = financialBucketsByEnvironment([
      { id: "pay-s", environment: "sandbox", amountCents: 39000, financialState: "received" },
      { id: "pay-p", environment: "production", amountCents: 89000, financialState: "received" },
      { id: "pend-s", environment: "sandbox", amountCents: 1000, financialState: "pending" },
      { id: "over-p", environment: "production", amountCents: 2000, financialState: "overdue" },
    ]);
    expect(buckets.sandbox.receivedCents).toBe(39000);
    expect(buckets.production.receivedCents).toBe(89000);
    expect(buckets.sandbox.pendingCents).toBe(1000);
    expect(buckets.production.overdueCents).toBe(2000);
    expect(buckets.sandbox.receivedCents).not.toBe(buckets.production.receivedCents);
    const collapsed = receivedTotalsByEnvironment([
      { id: "pay-s", environment: "sandbox", amountCents: 39000, financialState: "received" },
      { id: "pay-p", environment: "production", amountCents: 89000, financialState: "received" },
    ]);
    expect(collapsed.collapsedCents).toBe(128000);
    expect(collapsed.collapsedCents).not.toBe(buckets.production.receivedCents);
  });

  it("labels timeline payment_received by environment", () => {
    const events = timelineEventsCollapseEnvironment([
      { type: "payment_received", environment: "sandbox" },
      { type: "payment_received", environment: "production" },
    ]);
    expect(new Set(events.labeled).size).toBe(2);
    expect(events.labeled).toEqual(["sandbox:payment_received", "production:payment_received"]);
  });

  it("ENFORCE unexpected resolver errors fail closed", () => {
    expect(
      resolveCommercialShellGate({
        isLoading: false,
        isError: true,
        error: { message: "network", code: "57014" },
        productAllowed: undefined,
        pathname: "/pacientes",
      }),
    ).toBe("resolution_failed");
  });
});
