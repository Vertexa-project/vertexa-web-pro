import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION = "supabase/migrations/20260920200000_wp_billing_product_04_clinic_billing_hub.sql";
const HUB_API = "src/lib/api/billingHub.ts";
const HUB_DOMAIN = "src/lib/domain/billingHub.ts";
const PAGE = "src/pages/BillingProfilePage.tsx";
const OVERVIEW = "src/components/billing/BillingHubOverview.tsx";

describe("WP-BILLING-PRODUCT-04 — security source contracts", () => {
  it("adds focused read RPCs without new core tables or QR/webhook leakage", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("get_my_clinic_billing_overview");
    expect(sql).toContain("list_my_clinic_billing_charges");
    expect(sql).toContain("list_my_clinic_billing_payments");
    expect(sql).toContain("list_my_clinic_billing_timeline");
    expect(sql).toContain("private.assert_my_clinic_billing_reader");
    expect(sql).toContain("private.is_clinic_admin(p_clinic_id)");
    expect(sql).toContain("America/Sao_Paulo");
    expect(sql).toContain("grant execute on function public.get_my_clinic_billing_overview(uuid) to authenticated");
    expect(sql).toContain("revoke all on function public.get_my_clinic_billing_overview(uuid)");
    expect(sql).toContain("from public, anon, service_role");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/qr_payload|pix_payload|encoded_image|copia_e_cola/i);
    expect(sql).not.toMatch(/raw_payload|webhook_payload|request_body/i);
    expect(sql).not.toMatch(/net\.http|http_post|asaasFetch/i);
    expect(sql).not.toMatch(/grant (select|all) on table private\./i);
    expect(sql).not.toMatch(/grant execute on function public\.\w+\([^)]*\) to anon/i);
  });

  it("derives charge states and next charge on the server", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("billing_hub_charge_state_from_payment");
    expect(sql).toContain("PROGRAMMED");
    expect(sql).toContain("PENDING");
    expect(sql).toContain("PAID");
    expect(sql).toContain("OVERDUE");
    expect(sql).toContain("due_date < p_today");
    expect(sql).toContain("billing_hub_next_charge");
    expect(sql).toContain("due_date >= private.billing_hub_business_date()");
  });

  it("keeps frontend reads on hub RPCs and never recovers QR", () => {
    const api = readFileSync(resolve(root, HUB_API), "utf8");
    const domain = readFileSync(resolve(root, HUB_DOMAIN), "utf8");
    const page = readFileSync(resolve(root, PAGE), "utf8");
    const overview = readFileSync(resolve(root, OVERVIEW), "utf8");
    expect(api).toContain("get_my_clinic_billing_overview");
    expect(api).not.toContain("functions.invoke");
    expect(api).not.toContain("asaas-outbound");
    expect(domain).toContain("NO_SUPPORTED_QR_RECOVERY");
    expect(page).toContain("BillingHubOverview");
    expect(page).toContain("Assinatura e faturamento");
    expect(page).not.toMatch(/Criar cobrança/i);
    expect(overview).toContain("Situação da assinatura");
    expect(overview + page).not.toMatch(/localStorage|sessionStorage/);
  });
});
