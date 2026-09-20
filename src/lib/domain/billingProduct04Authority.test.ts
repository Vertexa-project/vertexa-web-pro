import { describe, expect, it } from "vitest";

import { billingHubErrorMessage } from "./billingHub";

describe("WP-BILLING-PRODUCT-04 — client authority surface", () => {
  it("fails closed for anon, patient, member and foreign clinic", () => {
    expect(billingHubErrorMessage({ hint: "BILLING_NOT_AUTHENTICATED" })).toMatch(/sessão/);
    expect(billingHubErrorMessage({ hint: "BILLING_NOT_CLINIC_ADMIN" })).toMatch(/administrador/);
    expect(billingHubErrorMessage({ message: "BILLING_NOT_CLINIC_ADMIN" })).toMatch(/administrador/);
  });
});
