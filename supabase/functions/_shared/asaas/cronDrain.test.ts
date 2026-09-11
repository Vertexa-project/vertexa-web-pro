// WP-ASAAS-04C — A04C-01..A04C-08. Fixtures/mocks only. Nenhuma secret real.
import { describe, it, expect, vi } from "vitest";
import {
  CRON_AUTH_MODE,
  CRON_DRAIN_LIMIT,
  CRON_JOB_NAME,
  CRON_SCHEDULE,
  CRON_SECRET_NAME,
  assertMinimizedResponse,
  authorizePresentedCronCredential,
  cronDrainLimitFromClient,
  ignoreCronRequestBody,
  minimizeDrainResponse,
  resolveCronAutomationEnvironment,
  runAutomatedSandboxDrain,
} from "./cronDrain.ts";
import type { DrainResult } from "./processor.ts";

const fakeAdmin = {} as never;
const fakeCreds = { apiKey: "fake-sandbox-key-never-real", baseUrl: "https://api-sandbox.asaas.test" };

function emptyDrain(): DrainResult {
  return { claimed: 0, processed: 0, ignored: 0, failed: 0, voided: 0, skipped: 0, outcomes: [] };
}

describe("A04C cron auth contract (named secret asaas_processor_cron)", () => {
  it("A04C-01: no credential → denied", () => {
    expect(authorizePresentedCronCredential({ kind: "none" })).toEqual({
      authorized: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("A04C-02: publishable credential → denied", () => {
    expect(authorizePresentedCronCredential({ kind: "publishable" }).authorized).toBe(false);
  });

  it("A04C-03: wrong secret key → denied", () => {
    expect(authorizePresentedCronCredential({ kind: "wrong_secret" }).authorized).toBe(false);
  });

  it("A04C-04: correct named secret → authorized", () => {
    expect(authorizePresentedCronCredential({ kind: "named_secret", name: CRON_SECRET_NAME })).toEqual({
      authorized: true,
    });
    expect(CRON_AUTH_MODE).toBe("secret:asaas_processor_cron");
  });

  it("user JWT is not a named secret → denied", () => {
    expect(authorizePresentedCronCredential({ kind: "user_jwt" }).authorized).toBe(false);
  });

  it("named secret with the wrong name → denied", () => {
    expect(authorizePresentedCronCredential({ kind: "named_secret", name: "service_role" }).authorized).toBe(false);
  });
});

describe("A04C cron drain body / environment", () => {
  it("A04C-05: body environment override is ignored; server env wins", async () => {
    const drain = vi.fn(async () => emptyDrain());
    const poisoned = { environment: "production", ASAAS_OUTBOUND_ENVIRONMENT: "production" };
    ignoreCronRequestBody(poisoned);
    const out = await runAutomatedSandboxDrain({
      adminClient: fakeAdmin,
      environmentRaw: "sandbox",
      creds: fakeCreds,
      drain,
    });
    expect(out.status).toBe(200);
    expect(drain).toHaveBeenCalledWith(expect.objectContaining({ environment: "sandbox", limit: CRON_DRAIN_LIMIT }));
  });

  it("A04C-06: body paymentId injection does not reach drain", async () => {
    const drain = vi.fn(async () => emptyDrain());
    ignoreCronRequestBody({ paymentId: "pay_injected", customerId: "cus_injected" });
    await runAutomatedSandboxDrain({
      adminClient: fakeAdmin,
      environmentRaw: "sandbox",
      creds: fakeCreds,
      drain,
    });
    const arg = drain.mock.calls[0][0] as { creds: unknown; limit: number };
    expect(arg).not.toHaveProperty("paymentId");
    expect(JSON.stringify(arg)).not.toContain("pay_injected");
  });

  it("A04C-07: body limit injection is ignored", async () => {
    expect(cronDrainLimitFromClient(1)).toBe(25);
    expect(cronDrainLimitFromClient(999)).toBe(25);
    expect(cronDrainLimitFromClient("1")).toBe(25);
    const drain = vi.fn(async () => emptyDrain());
    await runAutomatedSandboxDrain({
      adminClient: fakeAdmin,
      environmentRaw: "sandbox",
      creds: fakeCreds,
      drain,
    });
    expect(drain).toHaveBeenCalledWith(expect.objectContaining({ limit: CRON_DRAIN_LIMIT }));
    expect(drain.mock.calls[0][0]).not.toHaveProperty("limit", 1);
  });

  it("schedule contract is exactly one named minutely job", () => {
    expect(CRON_JOB_NAME).toBe("vertexa-asaas-financial-drain");
    expect(CRON_SCHEDULE).toBe("* * * * *");
  });

  it("A04C-08: Production environment → fail closed", async () => {
    const drain = vi.fn(async () => emptyDrain());
    const out = await runAutomatedSandboxDrain({
      adminClient: fakeAdmin,
      environmentRaw: "production",
      creds: fakeCreds,
      drain,
    });
    expect(out.status).toBe(503);
    expect(out.body).toEqual({ error: "auto_drain_sandbox_only" });
    expect(drain).not.toHaveBeenCalled();
  });

  it("missing environment → fail closed", () => {
    expect(resolveCronAutomationEnvironment(undefined)).toEqual({
      ok: false,
      error: "asaas_outbound_not_configured",
    });
  });

  it("response has only aggregates — no outcomes or IDs", () => {
    const minimized = minimizeDrainResponse({
      claimed: 2,
      processed: 1,
      ignored: 1,
      failed: 0,
      voided: 0,
      skipped: 0,
      outcomes: [
        {
          event_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          external_event_id: "evt_secret",
          outcome: "processed",
          category: "received",
        },
      ],
    });
    expect(minimized).toEqual({
      claimed: 2,
      processed: 1,
      ignored: 1,
      failed: 0,
      voided: 0,
      skipped: 0,
    });
    expect(assertMinimizedResponse(minimized)).toBe(true);
    expect(JSON.stringify(minimized)).not.toContain("evt_secret");
  });
});
