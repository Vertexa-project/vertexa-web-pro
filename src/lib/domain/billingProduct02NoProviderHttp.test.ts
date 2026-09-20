import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const BP02_SURFACE = [
  "supabase/migrations/20260920130011_wp_billing_product_02_commercial_checkout.sql",
  "src/lib/domain/billingCheckout.ts",
  "src/lib/api/billingCheckout.ts",
  "src/hooks/useBillingCheckout.ts",
  "src/pages/BillingProfilePage.tsx",
  "src/components/billing/BillingIdentityForm.tsx",
];

const FORBIDDEN =
  /asaasFetch\s*\(|readAsaasCredentials\s*\(|ensureCustomer\s*\(|executePreparedPixAutomaticAuthorization\s*\(|CUSTOMER_FIXTURE|paymentCreationMode\s*=/;

describe("WP-BILLING-PRODUCT-02 — no provider HTTP", () => {
  it("superfície BP02 não chama Asaas nem persiste QR", () => {
    for (const rel of BP02_SURFACE) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, rel).not.toMatch(FORBIDDEN);
      expect(src, rel).not.toMatch(/000201|copia.?e.?cola|qr_payload|pixCopiaECola/i);
      expect(src, rel).not.toMatch(/net\.http|http_post|asaas-outbound/i);
    }
  });

  it("migration declara founder bloqueado e ambiente sandbox no checkout", () => {
    const src = readFileSync(resolve(root, BP02_SURFACE[0]), "utf8");
    expect(src).toMatch(/OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY/);
    expect(src).toMatch(/ensure_my_clinic_billing_account/);
    expect(src).toMatch(/create_my_clinic_commercial_contract/);
    expect(src).toMatch(/list_sellable_billing_plans/);
    expect(src).toMatch(/'asaas', 'sandbox'/);
    expect(src).toMatch(/BILLING_PRODUCTION_LOCKED/);
    expect(src).not.toMatch(/insert into private\.billing_pix_automatic_authorizations/i);
    expect(src).not.toMatch(/entitlement_granted',\s*true/);
  });
});
