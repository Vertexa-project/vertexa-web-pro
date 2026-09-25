import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = resolve(root, "supabase/migrations/20260925143000_billing_customer_postal_province.sql");

describe("WP-BILLING-MASTER-QA-03R6 — checkout-ready customer security contract", () => {
  it("keeps CEP/bairro private, clinic-scoped and forward-only", () => {
    const sql = readFileSync(migration, "utf8");
    expect(sql).toContain("add column billing_postal_code text");
    expect(sql).toContain("add column billing_province text");
    expect(sql).not.toMatch(/billing_(city|state)/i);
    expect(sql).toContain("billing_postal_code");
    expect(sql).toContain("billing_province");
    expect(sql).toContain("p_billing_postal_code text");
    expect(sql).toContain("p_billing_province text");
    expect(sql).toContain("grant execute on function public.billing_load_provider_customer_context_outbound(uuid) to service_role");
    expect(sql).not.toMatch(/grant\s+select\s+on\s+private\.billing_customer_identities/i);
    expect(sql).toContain("billing_postal_code_required");
    expect(sql).toContain("billing_province_required");
  });
});
