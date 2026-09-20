# Billing Product 06 — Reports + CSV + Master E2E Preparation

> Local implementation only. No remote apply, push, deploy, or provider write.

**Goal:** Give Platform Admin period reports and a secure CSV, harden BP05 reads, and prepare a resumable Master Sandbox E2E runbook/runner.

**Architecture:** Reuse BP05 charge/payment/Pix facts. No new financial tables. Report RPCs are Platform Admin-only via `private.assert_platform_billing_reader()`. CSV is built from a bounded export RPC, never from private table dumps. Master E2E is local machinery only.

**Tech Stack:** Postgres SECURITY DEFINER RPCs, React/Vite Platform Billing UI, Vitest, TypeScript runner.

**Spec:** `docs/VERTEXA_BILLING_PRODUCT_CONTRACT_2026-09-19.md` §18 / §22 / §23 plus WP-BILLING-PRODUCT-06.

## Global Constraints

- America/Sao_Paulo civil dates. Browser timezone is not authority.
- Max report window 366 days. No unbounded history dump.
- Pix REFUSED is not delinquency.
- Entitlement enforcement stays OFF.
- QA #2 (`e8727e86-a9c4-42d6-bfd0-886c2b752f4e`) hard-excluded from E2E selection/cleanup.
- Retry policy `ALLOW_THREE_IN_SEVEN_DAYS` is documented for future new product auths; this WP does not create them.
- Migration filename `20260920220000` is canonical and local-only.

## Contract matrix

| Item | Bucket |
|---|---|
| Reports (5 families) | REQUIRED NOW |
| CSV | REQUIRED NOW |
| Sandbox Master E2E machinery | REQUIRED NOW |
| PDF / Excel | OPTIONAL — not in BP06 |
| Production Asaas, refund, card collection, entitlement enforcement, auto-suspend, Create Charge, live 18/10 | NOT IN BP06 / PROD-01 ONLY |

## Files

- Create: `supabase/migrations/20260920220000_wp_billing_product_06_platform_billing_reports.sql`
- Create: `supabase/tests/wp_billing_product_06_platform_billing_reports_test.sql`
- Create: `src/lib/domain/billingCsv.ts` + tests
- Create: `src/lib/domain/platformBillingReports.ts` + tests
- Create: `src/lib/api/platformBillingReports.ts` + tests
- Create: `src/lib/e2e/billingProduct06MasterE2e.ts` + tests
- Create: `docs/ops/BILLING-PRODUCT-06-MASTER-E2E-RUNBOOK.md`
- Create: `scripts/billing-product-06-master-e2e.mjs` (fail-closed checkpoint)
- Modify: clinic facts hardening in the BP06 migration; reports page; hooks; query keys; error copy
