import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION =
  "supabase/migrations/20260921120000_wp_billing_preprod_02_commercial_gate_env_isolation.sql";
const OUTBOUND = "supabase/functions/asaas-outbound/index.ts";
const WEBHOOK = "supabase/functions/_shared/asaasWebhook.js";
const PROCESSOR = "supabase/functions/_shared/asaas/processor.ts";
const GUARD = "supabase/functions/_shared/asaas/productionWriteGuard.ts";
const DOMAIN = "src/lib/domain/commercialAccess.ts";

describe("WP-BILLING-PREPROD-02 — security source contracts", () => {
  it("defaults OBSERVE and Production LOCKED without fake contracts", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("rollout_mode text not null default 'observe'");
    expect(sql).toContain("write_mode text not null default 'locked'");
    expect(sql).toContain("billing_accounts_clinic_environment_uidx");
    expect(sql).toContain("BILLING_ACCOUNT_ENVIRONMENT_IMMUTABLE");
    expect(sql).toContain("billing_assert_clinic_commercial_access");
    expect(sql).toContain("grant_platform_commercial_access_exemption");
    expect(sql).toContain("BILLING_NOT_PLATFORM_ADMIN");
    expect(sql).not.toMatch(/is_paid\s*=/);
    expect(sql).not.toMatch(
      /insert into private\.billing_commercial_access_exemptions[\s\S]{0,120}select/i,
    );
  });

  it("keeps PA fixtures Production-impossible and routes by persisted environment", () => {
    const outbound = readFileSync(resolve(root, OUTBOUND), "utf8");
    const guard = readFileSync(resolve(root, GUARD), "utf8");
    expect(guard).toContain("production_fixture_forbidden");
    expect(outbound).toContain("assertSandboxFixtureEnvironment");
    expect(outbound).toContain("assertProductionProviderWriteForClinic");
    expect(outbound).toContain("accountEnv");
    expect(outbound).not.toMatch(/console\.(log|debug|info|error|warn)\(/);
  });

  it("attributes webhook environment from the matching token, never the body", () => {
    const src = readFileSync(resolve(root, WEBHOOK), "utf8");
    expect(src).toContain("resolveWebhookChannelFromToken");
    expect(src).toContain("sandboxMatch");
    expect(src).toContain("productionMatch");
    expect(src).not.toMatch(/body\.environment/);
  });

  it("fails closed when claimed event environment disagrees with drain", () => {
    const src = readFileSync(resolve(root, PROCESSOR), "utf8");
    expect(src).toContain("environment_mismatch");
    expect(src).toContain("ev.environment !== environment");
  });

  it("does not let the browser declare commercial access", () => {
    const src = readFileSync(resolve(root, DOMAIN), "utf8");
    expect(src).toContain("hasActiveContract");
    expect(src).toContain("exemptionActive");
    expect(src).not.toMatch(/localStorage|sessionStorage/);
  });

  it("makes customer_bound a BOOL_OR clinic fact and buckets financials by environment", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toContain("bool_or(a.external_customer_id is not null)");
    expect(sql).not.toMatch(
      /select distinct on \(a\.clinic_id\)[\s\S]{0,120}as customer_bound/i,
    );
    expect(sql).toContain("'sandbox', coalesce(v_sandbox");
    expect(sql).toContain("'production', coalesce(v_production");
    expect(sql).toContain("'environment', f.environment");
    expect(sql).toContain("acc.environment");
    expect(sql).toContain("BILLING_REPORT_ENVIRONMENT_INVALID");
  });
});
