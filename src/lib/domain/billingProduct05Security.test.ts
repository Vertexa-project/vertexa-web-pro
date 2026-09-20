import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260920210000_wp_billing_product_05_platform_billing.sql";
const API = "src/lib/api/platformBilling.ts";
const DOMAIN = "src/lib/domain/platformBilling.ts";
const LAYOUT = "src/pages/platform-billing/PlatformBillingLayout.tsx";
const BP04 = "supabase/migrations/20260920200000_wp_billing_product_04_clinic_billing_hub.sql";

describe("WP-BILLING-PRODUCT-05 — security source contracts", () => {
  it("adds Platform Admin RPCs without new tables or QR/webhook leakage", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("assert_platform_billing_reader");
    expect(sql).toContain("private.is_platform_admin()");
    expect(sql).toContain("get_platform_billing_overview");
    expect(sql).toContain("list_platform_billing_clinics");
    expect(sql).toContain("get_platform_clinic_billing_detail");
    expect(sql).toContain("list_platform_billing_charges");
    expect(sql).toContain("list_platform_billing_payments");
    expect(sql).toContain("list_platform_billing_events");
    expect(sql).toContain("America/Sao_Paulo");
    expect(sql).toContain("platform_billing_overdue_aging");
    expect(sql).toContain("platform_billing_clamp_limit");
    expect(sql).toContain("grant execute on function public.get_platform_billing_overview() to authenticated");
    expect(sql).toContain("revoke all on function public.get_platform_billing_overview()");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/qr_payload|pix_payload|encoded_image|copia_e_cola/i);
    expect(sql).not.toMatch(/raw_payload|webhook_payload|request_body/i);
    expect(sql).not.toMatch(/net\.http|http_post|asaasFetch/i);
    expect(sql).not.toMatch(/grant (select|all) on table private\./i);
    expect(sql).not.toMatch(/grant execute on function public\.\w+\([^)]*\) to anon/i);
    expect(sql).not.toContain("get_my_clinic_billing_overview");
    expect(sql).not.toContain("get_my_clinic_billing_charges");
  });

  it("does not weaken Clinic Admin tenant authority", () => {
    const bp04 = readFileSync(resolve(root, BP04), "utf8");
    expect(bp04).toContain("private.is_clinic_admin(p_clinic_id)");
    expect(bp04).toContain("No Platform Admin bypass");
    expect(bp04).not.toContain("is_platform_admin");
  });

  it("keeps frontend reads on platform RPCs and never recovers QR", () => {
    const api = readFileSync(resolve(root, API), "utf8");
    const domain = readFileSync(resolve(root, DOMAIN), "utf8");
    const layout = readFileSync(resolve(root, LAYOUT), "utf8");
    expect(api).toContain("get_platform_billing_overview");
    expect(api).toContain("list_platform_billing_events");
    expect(api).not.toContain("get_my_clinic_billing_overview");
    expect(api).not.toContain("functions.invoke");
    expect(api).not.toContain("asaas-outbound");
    expect(domain).toContain("Pix REFUSED não é inadimplência");
    expect(layout).toContain("Faturamento da plataforma");
    expect(layout).toContain("/platform/billing");
    expect(api + domain + layout).not.toMatch(/localStorage|sessionStorage/);
  });
});
