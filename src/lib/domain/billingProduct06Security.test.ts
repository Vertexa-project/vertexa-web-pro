import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260920220000_wp_billing_product_06_platform_billing_reports.sql";
const API = "src/lib/api/platformBillingReports.ts";
const CSV = "src/lib/domain/billingCsv.ts";
const PAGE = "src/pages/platform-billing/PlatformBillingReportsPage.tsx";
const E2E = "src/lib/e2e/billingProduct06MasterE2e.ts";
const BP05 = "supabase/migrations/20260920210000_wp_billing_product_05_platform_billing.sql";

describe("WP-BILLING-PRODUCT-06 — security source contracts", () => {
  it("adds PA report RPCs without new tables, QR or webhook leakage", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("assert_platform_billing_reader");
    expect(sql).toContain("get_platform_billing_report");
    expect(sql).toContain("list_platform_billing_report_export");
    expect(sql).toContain("platform_billing_resolve_report_period");
    expect(sql).toContain("America/Sao_Paulo");
    expect(sql).toContain("366");
    expect(sql).toContain("500");
    expect(sql).toContain("unattributed");
    expect(sql).toContain("charges as materialized");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/qr_payload|encoded_image|webhook_payload|tax_id,/i);
    expect(sql).not.toMatch(/grant execute on function public\.\w+\([^)]*\) to anon/i);
    expect(sql).not.toContain("get_my_clinic_billing_overview");
    expect(sql).toContain("grant execute on function public.get_platform_billing_report(date, date) to authenticated");
  });

  it("does not weaken BP05 tenant isolation or add browser ledger grants", () => {
    const bp05 = readFileSync(resolve(root, BP05), "utf8");
    expect(bp05).toContain("assert_platform_billing_reader");
    expect(bp05).not.toContain("get_my_clinic_billing_overview");
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).not.toMatch(/grant (select|all) on table private\./i);
  });

  it("keeps CSV construction out of React and redacts E2E secrets", () => {
    const api = readFileSync(resolve(root, API), "utf8");
    const csv = readFileSync(resolve(root, CSV), "utf8");
    const page = readFileSync(resolve(root, PAGE), "utf8");
    const e2e = readFileSync(resolve(root, E2E), "utf8");
    expect(api).toContain("get_platform_billing_report");
    expect(api).toContain("list_platform_billing_report_export");
    expect(csv).toContain("neutralizeSpreadsheetFormula");
    expect(page).toContain("buildBillingReportCsv");
    expect(page).not.toContain("Relatórios em breve");
    expect(e2e).toContain("e8727e86-a9c4-42d6-bfd0-886c2b752f4e");
    expect(e2e).toContain("assertNotQa2");
    expect(e2e).toContain("redactSecrets");
    expect(api + csv + page).not.toMatch(/service_role|encodedImage|asaas-outbound/);
  });
});
