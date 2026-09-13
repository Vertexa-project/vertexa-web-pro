import { describe, expect, it } from "vitest";

import {
  ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED,
  PIX_AUTOMATIC_POLICY,
  pixAutomaticProviderContractId,
} from "./pixAutomatic.ts";

describe("pix automatic local helpers", () => {
  it("freezes provider policy and does not use billingType PIX", () => {
    expect(PIX_AUTOMATIC_POLICY.frequency).toBe("MONTHLY");
    expect(PIX_AUTOMATIC_POLICY.paymentCreationMode).toBe("SUBSCRIPTION");
    expect(PIX_AUTOMATIC_POLICY.retryPolicy).toBe("ALLOW_THREE_IN_SEVEN_DAYS");
    expect(PIX_AUTOMATIC_POLICY.finishDate).toBeNull();
    expect(JSON.stringify(PIX_AUTOMATIC_POLICY)).not.toContain("PIX");
    expect(ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED).toBe(
      "ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED",
    );
  });

  it("maps contract UUID to 32-char non-PII contractId", () => {
    expect(pixAutomaticProviderContractId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400e29b41d4a716446655440000",
    );
  });
});
