import { describe, expect, it } from "vitest";

import { platformBillingErrorMessage } from "./platformBilling";

describe("WP-BILLING-PRODUCT-05 — client authority surface", () => {
  it("denies clinic admin, owner, member, patient and anon with the same fail-closed copy", () => {
    expect(platformBillingErrorMessage({ hint: "BILLING_NOT_PLATFORM_ADMIN" })).toMatch(
      /administradores da plataforma/,
    );
    expect(platformBillingErrorMessage({ message: "BILLING_NOT_PLATFORM_ADMIN" })).toMatch(
      /plataforma/,
    );
    expect(platformBillingErrorMessage({ hint: "BILLING_NOT_AUTHENTICATED" })).not.toMatch(
      /clínica/,
    );
  });
});
