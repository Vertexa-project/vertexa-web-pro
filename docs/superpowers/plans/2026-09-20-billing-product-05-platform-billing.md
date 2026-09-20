# Platform Billing (BP05) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Platform Admin a bounded, fail-closed cross-clinic billing workbench under the existing `/platform` app without weakening Clinic Admin tenant RPCs.

**Architecture:** Separate Platform Admin read RPCs (`assert_platform_billing_reader` → `is_platform_admin()`). Reuse private BP04 derivation helpers internally. Never call `get_my_clinic_*` from Platform Admin. Delinquency and financial state are derived server-side from existing ledger facts. Events come from `billing_provider_events` with sanitized metadata only.

**Tech Stack:** Postgres/Supabase SQL, React 18, React Router, TanStack Query, Vitest, existing `/platform` shell.

**Spec:** `docs/VERTEXA_BILLING_PRODUCT_CONTRACT_2026-09-19.md` §§1.2, 5, 6, 15–18, 21–22

## Global Constraints

- Local implementation only. Do not apply migration remotely. Do not use MCP `apply_migration`.
- Filename timestamp `20260920210000` is canonical and greater than `20260920200000`.
- Asaas production LOCKED. No provider writes. Do not mutate QA #2.
- No entitlement enforcement. No auto-suspend. Pix REFUSED ≠ delinquent.
- Dates: `America/Sao_Paulo`. Lists bounded (limit ≤ 50, deterministic order).
- Reports/CSV = BP06. Relatórios IA slot is a stub. Reissue stays on `/platform/clinicas`.
- No new financial tables. No QR / webhook body / API keys / service_role / provider ids in browser.

## Canonical scope matrix

| REQUIRED IN BP05 | NOT IN BP05 | DEFERRED TO BP06 | DEFERRED TO PROD-01 |
|---|---|---|---|
| `/platform/billing` IA: overview, contratos, cobranças, pagamentos, inadimplência, Pix, eventos | Clinic Admin hub changes | CSV / period reports | Production Asaas |
| Separate PA read APIs | Reusing `get_my_clinic_*` | Master Sandbox E2E | Entitlement enforcement |
| Derived delinquency + aging | Editable delinquency flag | Retry-policy product writes | Auto clinic suspend |
| Sanitized event metadata | Raw webhook / QR / provider ids | | Juliana / live QA #2 |
| Bounded lists + filters | Advanced analytics | | |
| Dual-role PA access via PA authority | New admin concept | | |

IA choice (one clear repository pattern): nest Billing inside existing `PlatformShell` + `PlatformAdminGate`. Canonical routes under `/platform/billing/*`. One nav item **Faturamento**.

## Files

Create:

- `supabase/migrations/20260920210000_wp_billing_product_05_platform_billing.sql`
- `supabase/tests/wp_billing_product_05_platform_billing_test.sql`
- `src/lib/domain/platformBilling.ts` (+ tests)
- `src/lib/domain/billingProduct05Security.test.ts`
- `src/lib/domain/billingProduct05Authority.test.ts`
- `src/lib/api/platformBilling.ts` (+ tests)
- `src/hooks/usePlatformBilling.ts`
- `src/pages/platform-billing/*` layout + section pages + tests
- `src/components/platform-billing/*`

Modify:

- `src/layouts/PlatformShell.tsx` (+ test)
- `src/app/router.tsx`
- `src/lib/queryKeys.ts`

## Tasks

- [x] Phase 0–4 discovery and contract extract
- [x] SQL migration + SQL harness
- [x] Domain / API / hooks
- [x] Platform Billing UI
- [x] Frontend + source-contract tests
- [x] Regression + local QA + local commit (no push)
