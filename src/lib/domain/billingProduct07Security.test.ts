import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION =
  "supabase/migrations/20260920230000_wp_billing_product_07_founder_commercial_governance.sql";
const API = "src/lib/api/billingCommercial.ts";
const DOMAIN = "src/lib/domain/billingCommercial.ts";
const PAGE = "src/pages/platform-billing/PlatformBillingCommercialPage.tsx";
const CLINIC = "src/components/billing/BillingCommercialUsagePanel.tsx";

describe("WP-BILLING-PRODUCT-07 — security source contracts", () => {
  it("keeps Founder admission, prices and slots server-authoritative", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("billing_founder_admissions");
    expect(sql).toContain("slot_number >= 1 and slot_number <= 50");
    expect(sql).toContain("pg_advisory_xact_lock(90707");
    expect(sql).toContain("BILLING_FOUNDER_SLOTS_EXHAUSTED");
    expect(sql).toContain("BILLING_FOUNDER_HISTORY_IMMUTABLE");
    expect(sql).toContain("private.is_platform_admin()");
    expect(sql).toContain("BILLING_NOT_PLATFORM_ADMIN");
    expect(sql).toContain("BILLING_NOT_CLINIC_ADMIN");
    expect(sql).toContain("p_plan_code");
    expect(sql).not.toMatch(/p_slot|p_price_cents|p_discount|p_final/);
    expect(sql).toContain("billing_commercial_adjustments");
    expect(sql).toContain("founder_is_not_coupon");
    expect(sql).toContain("adjustments_applied', 0");
    expect(sql).toContain("BILLING_OWNER_LOCKED_FOR_CAPACITY");
    expect(sql).toContain("BILLING_PULSE_NO_ADDON");
    expect(sql).toContain("BILLING_PROFESSIONAL_CAPACITY");
    expect(sql).toContain("BILLING_PATIENT_CAPACITY");
    expect(sql).toContain("pg_advisory_xact_lock(90701");
    expect(sql).toContain("pg_advisory_xact_lock(90702");
    expect(sql).toContain("BILLING_FOUNDER_RETURN_AFTER_CLOSE");
    expect(sql).not.toMatch(/asaasFetch|net\.http|encoded_image|qr_payload|webhook_payload/i);
    expect(sql).not.toMatch(/grant execute on function public\.\w+\([^)]*\) to anon/i);
    expect(sql).not.toMatch(/grant (select|all) on table private\./i);
    expect(sql).not.toContain("apply_migration");
  });

  it("does not apply remote migrations or grant table reads", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("LOCAL ONLY");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table private.billing_founder_admissions");
    expect(sql).not.toContain("apply_migration");
  });

  it("keeps frontend payloads free of client price, slot and discount", () => {
    const api = readFileSync(resolve(root, API), "utf8");
    const domain = readFileSync(resolve(root, DOMAIN), "utf8");
    const page = readFileSync(resolve(root, PAGE), "utf8");
    const clinic = readFileSync(resolve(root, CLINIC), "utf8");
    expect(api).toContain("admit_platform_founder_clinic");
    expect(api).toContain("p_plan_code");
    expect(api).not.toMatch(/p_price_cents|p_slot_number|p_discount/);
    expect(api).not.toContain("functions.invoke");
    expect(api).not.toContain("asaas-outbound");
    expect(domain).toContain("FOUNDER_MAX_ADMISSIONS");
    expect(domain).toContain("futureAdjustmentPreview");
    expect(page).toContain("O servidor escolhe o slot");
    expect(clinic).toContain("Não é cobrança Asaas");
    expect(api + page + clinic).not.toMatch(/localStorage|sessionStorage|service_role/);
  });
});
