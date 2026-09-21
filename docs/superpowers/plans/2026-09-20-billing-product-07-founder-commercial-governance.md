# Billing Product 07 — Founder + Capacity Governance

> **For agentic workers:** Local implementation only. Do not apply remotely, push, or start PROD-01.

**Goal:** Canonical Founder Member admissions (50 historical slots) and server-authoritative professional/patient capacity before Production Asaas.

**Architecture:** Reuse `billing_offers.founder_2026` as the campaign price catalog. Add an admission ledger, dynamic server price resolution, explicit additional units, and write-boundary capacity guards. Founder is not a coupon. Future clinic discounts use a separate unused adjustment table.

**Tech Stack:** Postgres (Supabase migrations/RPCs), React, Vitest.

**Spec:** WP-BILLING-PRODUCT-07 user prompt.

## Global Constraints

- Local only. Migration timestamp `20260920220000`.
- Production Asaas locked. Entitlement enforcement stays OFF.
- Integer cents. No client-controlled price/slot/discount.
- Existing v1 contracts remain readable. New catalog versions are additive.
- One owner seat exemption. Extra admins are billable.

## Model

- `billing_commercial_campaigns` — founder campaign OPEN/CLOSED, max 50.
- `billing_founder_admissions` — immutable slot 1–50, lock, lifetime 30%, eligibility.
- `billing_contract_capacity_units` — PA-managed additional professional/patient units.
- `billing_commercial_adjustments` — future coupon seam. Not applied in BP07.
- Plan version v2 capacities + nullable add-on unit prices (Pulse stays null).

## Price

Eligible Founder + now < lock_until → locked Founder cents.  
Eligible Founder + after lock → current table × 70%.  
Plus contracted additional units × version unit prices.  
Standard clinics keep contract snapshot.

## Enforcement

Triggers on `professionals` and `professional_patient_links` with clinic advisory locks. No contract → no commercial capacity block (backward compatible).
