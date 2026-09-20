import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION = "supabase/migrations/20260920180000_wp_billing_product_03_clinic_pix_checkout.sql";
const OUTBOUND = "supabase/functions/asaas-outbound/index.ts";
const PANEL = "src/components/billing/BillingPixCheckoutPanel.tsx";
const API = "src/lib/api/billingPixCheckout.ts";

describe("WP-BILLING-PRODUCT-03 — security source contracts", () => {
  it("migration has no QR columns and keeps clinic-admin wrappers sandbox-only", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("prepare_my_clinic_pix_automatic_authorization");
    expect(sql).toContain("reissue_my_clinic_pix_automatic_authorization");
    expect(sql).toContain("billing_load_provider_customer_context_outbound");
    expect(sql).toContain("grant execute on function public.billing_load_provider_customer_context_outbound(uuid)");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("private.is_clinic_admin(p_clinic_id)");
    expect(sql).toContain("ALLOW_THREE_IN_SEVEN_DAYS");
    expect(sql).toContain("'sandbox'");
    expect(sql).toContain("actor_authority");
    expect(sql).toContain("qr_available_now', false");
    expect(sql).not.toMatch(/qr_payload|pix_payload|encoded_image|copia_e_cola/i);
    expect(sql).not.toMatch(/alter table private\.billing_pix_automatic_authorizations add column/i);
    expect(sql).not.toMatch(/net\.http|http_post|asaasFetch/i);
  });

  it("product Edge path does not accept fixture or production override", () => {
    const src = readFileSync(resolve(root, OUTBOUND), "utf8");
    expect(src).toContain("customerBodyFromIdentity");
    expect(src).toContain("production_locked");
    expect(src).toContain('environment: "sandbox"');
    expect(src).toContain("sanitizeClinicCustomerResponse");
    expect(src).toContain("sanitizeClinicExecuteResponse");
    expect(src).not.toMatch(/console\.(log|debug|info|error|warn)\(/);
  });

  it("UI keeps QR in component state and never persists it", () => {
    const panel = readFileSync(resolve(root, PANEL), "utf8");
    const api = readFileSync(resolve(root, API), "utf8");
    expect(panel).toContain("useState<TransientPixQr | null>(null)");
    expect(panel).toContain("setSessionQr(null)");
    expect(panel).toContain("PIX_BANK_COPY");
    expect(panel).toContain("PIX_RELOAD_COPY");
    expect(panel).not.toMatch(/localStorage|sessionStorage|queryClient\.setQueryData/);
    expect(panel).not.toMatch(/nubank|itaú|itau/i);
    expect(api).toContain("ensureCustomerFromIdentityPayload");
    expect(api).not.toContain("CUSTOMER_FIXTURE");
    expect(readFileSync(resolve(root, "src/lib/domain/billingPixCheckout.ts"), "utf8")).toContain(
      "ensure_customer_from_identity",
    );
  });
});
