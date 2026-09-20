# VERTEXA — Billing Product Contract

Date: 2026-09-19  
Work package: WP-BILLING-PRODUCT-01 / WP-BILLING-PRODUCT-01A  
Source: approved discovery `billing_product_contract_0fe7aede.plan.md`  
Discovery verdict: `READY_FOR_BILLING_PRODUCT_IMPLEMENTATION`  
Document verdict: `PASS_BILLING_PRODUCT_CONTRACT_CANONICALIZED`

This is the canonical product and engineering contract for the Vertexa Billing Product phase. It is not an implementation. It is not a production go-live certificate.

No API keys, JWTs, passwords, service-role values, Pix copia-e-cola, or raw QR payloads are included.

Environment for this entire phase: **Asaas Sandbox**.

---

## 1. Scope

Turn the closed Asaas sandbox **engine** into a complete Vertexa **billing product**.

Do not rebuild the payment engine.

### 1.1 In scope — Clinic Admin (own clinic only)

- View available Vertexa plans
- View own current plan
- Register / update own fiscal billing identity
- Internal checkout / contract a plan
- Start Pix Automatic setup
- Receive and display the first Pix Automatic QR / copy-and-paste **transiently**
- Complete authorization in the clinic's own banking app
- See authorization state
- See next cobrança
- See cobrança history
- See payment history
- See pending / received / overdue
- See a human-readable **business** timeline
- Regularize / recover billing where policy permits (pay existing overdue in the bank; reissue own primary REFUSED)
- See only their own clinic billing data

### 1.2 In scope — Platform Admin (cross-clinic)

- Billing dashboard
- Contracts
- Cobranças
- Payments
- Delinquency
- Pix Automatic operations
- Operational event timeline
- Reports
- Safe administrative actions
- Reissue auditing

### 1.3 Out of scope

- Production Asaas configuration
- Juliana production credentials
- Flipping the sandbox QA billing account to production
- Simulating the live QA 2026-10-18 settlement
- Mutating live QA authorization #2
- Product entitlement enforcement
- Automatic clinic suspension for unpaid status
- Credit-card collection
- Refunds
- Nota fiscal / NFS-e / tax invoice issuance
- Founder claim
- Arbitrary Clinic Admin "Create Charge"
- Monthly Clinic Admin "Generate Charge" workflow
- Top-level `/financeiro` unless later UX evidence supports it
- New invoice / fatura table

---

## 2. Definitions

| Term | Meaning |
|---|---|
| **Commercial contract** | Vertexa commercial intent. Server-side price snapshot. `pending \| active \| ended \| cancelled`. |
| **Pix authorization** | Provider authorization resource. `INTENT \| CREATED \| ACTIVE \| CANCELLED \| EXPIRED \| REFUSED`. |
| **Cobrança** | User-facing financial charge. MVP = Pix Automatic **instruction** + linked `billing_payments` row when available. |
| **Payment** | Normalized financial snapshot in `billing_payments`. Asaas GET is authority. |
| **Entitlement** | Product access / plan enforcement. Currently OFF. |
| **Clinic Admin** | `clinics.owner_profile_id` **or** `professionals.clinic_role = 'admin'`. Own clinic only. |
| **Platform Admin** | `private.is_platform_admin()`. Cross-clinic. Not a clinic-admin substitute. |
| **SUBSCRIPTION** | Asaas `paymentCreationMode`. Provider generates future monthly instructions after ACTIVE. |
| **MANUAL** | Not used for Pix Automatic. Do not switch. Distinct from Vertexa strategy `pix_manual`. |
| **Fatura / NFS-e** | Tax invoice. **Forbidden product synonym for cobrança.** Fiscal issuance is out of scope. |

---

## 3. Four separate states

The product and UI must **never** collapse these layers:

```
COMMERCIAL CONTRACT
  != PIX AUTHORIZATION
  != FINANCIAL PAYMENT
  != PRODUCT ENTITLEMENT
```

Examples that must remain true:

- commercial contract `ACTIVE` does **not** mean payment `RECEIVED`
- authorization `ACTIVE` does **not** mean entitlement `GRANTED`
- payment `RECEIVED` does **not** automatically enable product enforcement

Current enforcement remains **OFF**. `entitlement_granted` stays `false` on apply.

---

## 4. Architecture

Vertexa is commercial / product authority. Asaas is financial / provider-fact authority.

```
Clinic (tenant B2B)
  → billing_customer_identities     Vertexa fiscal identity
  → billing_accounts                clinic + environment
  → billing_commercial_contracts    Vertexa price snapshot
  → billing_pix_automatic_authorizations
  → billing_outbound_operations
  → asaas-outbound (action-gated)
  → Asaas sandbox

Asaas webhook
  → asaas-webhook
  → billing_provider_events
  → asaas-processor / sandbox cron drain
  → GET /payments/{id}
  → billing_payments
  → optional pix_instruction_id + pix_authorization_id
```

Patients are not payers. Browser clients never create Asaas objects directly. Environment is never browser-authoritative.

Private billing tables: RLS on, zero policies, revoke-all. Clients reach data only through `SECURITY DEFINER` RPCs.

---

## 5. Authority matrix

Fail closed.

| Surface | Patient | Professional member | Clinic Admin / Owner | Platform Admin | Backend / service_role |
|---|---|---|---|---|---|
| Catalog / plans (read) | no | no | yes | yes | no browser |
| Billing identity read/write | no | no | own clinic | inspect where operational; **no** cross-tenant identity write via clinic RPCs | no |
| Commercial contract create | no | no | own clinic; server price | read / ops; no silent price override | existing private only |
| Pix PREPARE | no | no | own clinic | own-clinic ops or dedicated PA path | no |
| Pix EXECUTE | no | no | own clinic | PA diagnostic/execute only if separately gated | Edge |
| Transient QR | no | no | own clinic, in-session | only if executing that clinic | never persist |
| Pix reissue | no | no | **own primary REFUSED only** | cross-clinic REFUSED | private engine |
| Cobranças / payments read | no | no | own clinic | cross-clinic | processor apply |
| Delinquency | no | no | own clinic | cross-clinic | no auto-suspend |
| Business timeline | no | no | own clinic, simplified | — | — |
| Operational events | no | no | no | sanitized | ingest/claim |
| Reports / CSV | no | no | no in MVP | yes | no |
| Asaas API key / raw payload | no | no | no | no | Edge env only |

Owner and `clinic_role=admin` have the **same billing capability**. Owner remains distinct only for team lifecycle (cannot deactivate owner).

**Clinic Admin ≠ Platform Admin.**

### 5.1 Outbound action-level authorization

When `asaas-outbound` is refactored for clinic checkout, **do not** replace the current PA gate with a broad authenticated gate.

Each action must declare exactly one of:

- **PA only**
- **Clinic Admin, own clinic**
- **Backend only**

Examples (design, not implementation):

| Action | Gate |
|---|---|
| `ensure_customer_from_identity` | Clinic Admin own clinic |
| `execute_pix_automatic_authorization` | Clinic Admin own clinic |
| `reissue_pix_automatic_authorization` (clinic) | Clinic Admin own clinic + primary REFUSED |
| `reissue_pix_automatic_authorization` (PA) | PA only |
| `confirm_sandbox_payment` | PA only + sandbox-only |
| `ensure_customer` with fixture | tests / ops only; never Clinic Admin checkout |
| webhook ingest / claim / apply | Backend only |

`get_or_create_billing_account` must accept Clinic Admin (owner **or** `clinic_role=admin`), not owner-only, before clinic checkout can work.

---

## 6. Data sources (reuse)

No new invoice table. Prefer existing objects.

| Object | Authority | Product use |
|---|---|---|
| `billing_plans` / versions / offers / prices | Vertexa | Catalog. Pulse 39000 / Sync 49700 / Apex 146700 BRL. Founder offer exists. |
| `billing_customer_identities` | Vertexa | `legal_name`, `tax_id` (11/14 + checksum), `email`, optional `mobile_phone`. No address required for current Asaas customer POST. |
| `billing_accounts` | Vertexa + provider customer id | One account per clinic; environment isolated. |
| `billing_commercial_contracts` | Vertexa | Create writes `active`. One active contract per clinic. Price immutable snapshot. |
| `billing_pix_automatic_authorizations` | Vertexa INTENT; Asaas thereafter | `payment_creation_mode = SUBSCRIPTION` only. |
| `billing_pix_automatic_payment_instructions` | Asaas | Cobrança programmed / scheduled / refused / done. |
| `billing_payments` | Asaas GET | Payment history. XOR: subscription **or** Pix authorization. |
| `billing_provider_events` | Asaas ingest | PA operational timeline. No raw JSON. |
| `billing_outbound_operations` | Vertexa | Idempotency. No blind POST. |
| `billing_pix_automatic_reissue_events` | Vertexa | Reissue audit. |
| `billing_entitlements` | Vertexa catalog | Not enforced. |

Existing clinic identity UI: `/configuracoes/faturamento`.  
Existing PA Pix UI: `/platform/clinicas`.

---

## 7. Catalog / commercial contract

Price authority is **Vertexa server-side**. Frontend cannot pass or alter price.

`billing_create_commercial_contract` already:

- snapshots offer price or `standard_price_cents`
- inserts `status = 'active'`
- rejects a second active contract

Checkout may hold `plan_version_id` in the wizard until confirm. On confirm: create the active contract **before** QR. That is commercial intent, not settlement.

Do not change the contract status machine in this phase.

---

## 8. Checkout (projected, not a second persisted machine)

Do not invent a duplicate persisted checkout state machine unless later proven necessary. The wizard is a **projection**:

| Product moment | Source of truth |
|---|---|
| No plan | no active commercial contract |
| Identity required | `billing_customer_identity_complete` is false |
| Review / confirm | wizard local state |
| Contract confirmed | `billing_create_commercial_contract` → `active` |
| Pix prepared | authorization `INTENT` + outbound pending |
| QR shown | Edge EXECUTE 200 `qrAvailable` in memory only |
| Waiting for bank | authorization `CREATED` |
| Live | authorization `ACTIVE` |
| First payment | `billing_payments.financial_state = received` |
| Future cycles | Asaas instructions + webhook ingest |
| Recover | primary `REFUSED` → own-clinic or PA reissue → new `INTENT` |

Journey:

```
Plan selection
  → Billing identity
  → Review
  → Commercial contract (active)
  → Pix INTENT / PREPARE
  → explicit EXECUTE
  → transient QR
  → bank app
  → CREATED / waiting
  → ACTIVE
  → first payment
  → future cycles (provider-generated)
```

One server transaction for confirm: create contract + PREPARE. EXECUTE is a separate explicit command.

---

## 9. Customer productization

Canonical sandbox product path:

```
billing_customer_identity
  → trusted loader RPC
  → ensure Asaas customer
  → billing_account.external_customer_id
```

`CUSTOMER_FIXTURE` is **tests / ops only**. Never normal Clinic Admin checkout.

Asaas customer body for product path: legal name, tax id, email (matches current provider POST). Phone optional. Address not required by the current engine.

---

## 10. Pix Automatic lifecycle

Canonical recurring mode:

```
paymentCreationMode = SUBSCRIPTION
```

Do **not** change to MANUAL.

After authorization is `ACTIVE`, Asaas generates future monthly instructions. Vertexa observes and reconciles through webhooks and provider GET facts. Cron does not CREATE. There is no Clinic Admin "Generate Charge" workflow.

```
PREPARE (SQL, insert-only)
  → INTENT + outbound pending
EXECUTE (Edge, explicit, action-gated)
  → lookup-first → Asaas CREATE
  → CREATED + transient QR (response only)
payer authorizes in own bank
  → ACTIVE
Asaas creates later instructions
  → webhook + GET
  → cobrança + payment ledger
```

Reissue remains local: current primary `REFUSED` only → demote historical → insert `INTENT` N+1 → pending outbound. Provider CREATE stays a separate EXECUTE. `ACTIVE` cannot reissue. Historical (non-primary) `REFUSED` cannot reissue.

Clinic Admin may reissue **own primary REFUSED**. Platform Admin may reissue across clinics. Same private engine.

---

## 11. QR security

Current invariant, unchanged:

- CREATE response is the source of the immediate QR / Pix copy-and-paste
- Payload and encoded image are **not** persisted
- Persist only `qr_expires_at` and `conciliation_identifier`
- Do not log payload
- Do not send payload to analytics
- Do not store payload in `localStorage` / durable browser storage
- GET / list authorization is **not** treated as a QR source unless a later proven provider contract says otherwise
- Blind second CREATE is forbidden

TTL requested today: 3600 seconds. Actual expiry is the provider `expirationDate`.

---

## 12. QR recovery gate

```
CHECKOUT_QR_RECOVERY = REQUIRED_DESIGN_BEFORE_BP03_RELEASE
```

**Risk:** Clinic Admin may close or reload the page while authorization is `CREATED` and before the bank flow completes. The transient QR is then gone from memory.

**Known facts:**

- CREATE returns the transient initial QR
- QR / Pix payload must not be persisted
- Blind second CREATE is forbidden
- Do **not** assume GET authorization can regenerate or retrieve the QR unless the provider contract is later proven to support it

**BP03 must resolve this safely before checkout can be called complete.**

Any solution must be **provider-supported** and must preserve:

- no duplicate authorization
- no blind POST
- no persisted QR payload

This document **does not choose** an unsupported implementation. Candidates may be researched in BP03 only against official provider behavior, for example:

- complete-in-your-bank UX while `CREATED` (no QR replay)
- a later-proven provider read that returns a new immediate QR without creating a second authorization
- expiry + `REFUSED` then reissue (new generation), never a second CREATE on the same attempt

If none is provider-safe, checkout cannot ship.

---

## 13. Retry policy gate

```
PIX_AUTOMATIC_RETRY_POLICY = DECISION_REQUIRED_BEFORE_MASTER_E2E
```

The engine currently hardcodes `ALLOW_THREE_IN_SEVEN_DAYS`. That is an implementation default, **not** a closed product decision for new real product authorizations.

Provider supports:

- `NOT_ALLOWED`
- `ALLOW_THREE_IN_SEVEN_DAYS`

Implications that must be reviewed before Master E2E / new product authorizations:

- a failed payment does **not** necessarily cancel the authorization
- authorization may remain `ACTIVE`
- payment may become `OVERDUE`
- instruction may become `REFUSED`
- future cycles may continue

Do **not** choose the policy silently in this document. A dedicated implementation / review gate must decide it before new real product authorizations are created.

---

## 14. Cobranças and payments

Canonical Vertexa financial concept: **Cobrança**.

Do not use "fatura" in a way that could be confused with nota fiscal / NFS-e.

MVP mapping:

```
Cobrança =
  Pix Automatic instruction
  + linked billing_payment when available
```

No new invoice table. Fiscal invoice issuance is out of scope.

User-facing cobrança states (do not fabricate provider payments):

| User state | Source |
|---|---|
| Programmed | instruction `AWAITING_REQUEST` / `SCHEDULED`, no received payment |
| Created | linked payment `pending` |
| Received / paid | payment `financial_state = received` |
| Overdue | payment `overdue`, or `pending` and `due_date < today` |
| Refused / cancelled | instruction `REFUSED` / `CANCELLED` |

Payment history (clinic-safe fields):

- amount
- due date
- paid date when available
- status (`pending` / `received` / `overdue` and other ledger states as needed)
- payment method (`billing_type`)
- plan / contract
- cobrança relationship

Do not expose raw Asaas ids to Clinic Admin. Platform Admin may use internal identifiers on diagnostic surfaces only.

Refund is future. Do not implement it here.

---

## 15. Delinquency

Financial delinquency only. **No automatic product suspension.**

Canonical presentation: `pending` / `received` / `overdue`, plus aging.

Aging buckets:

- 1–7 days
- 8–15 days
- 16–30 days
- 31+ days

Must answer: overdue charge count, overdue value, days overdue, clinic view, platform view.

Product blocking / grace / suspend / reactivate is a later entitlement policy. Hook points exist (`financial_state`, due dates, clinic lifecycle suspend) but remain **unwired**.

---

## 16. Clinic Admin UX

MVP lives under:

```
/configuracoes/faturamento
```

Expand the existing **Assinatura e faturamento** Settings card. Do not create top-level `/financeiro` unless later UX evidence supports it.

Hub contents:

- current plan and contracted price
- billing identity completeness
- Pix authorization status
- next cobrança (date + expected amount)
- cobrança history
- payment history
- delinquency summary
- simplified business timeline
- allowed actions only

Checkout screens (design, not implementation):

1. Plan
2. Billing identity
3. Review
4. Pix Automatic activation (EXECUTE + transient QR)
5. Waiting for authorization (`CREATED`)
6. Success / current plan (`ACTIVE`)

States: loading, empty, error, retry, expired QR (recovery gate), REFUSED + reissue.

**Bank instruction:** Vertexa does not integrate with Nubank, Itaú, or any bank. The user opens their own banking app, scans the QR or pastes Pix, reviews the first payment, and approves Pix Automatic recurrence. Vertexa observes provider webhooks afterward.

Regularizar = pay the existing overdue cobrança in the bank. Not "Create Charge".

---

## 17. Platform Admin information architecture

Canonical target:

```
/platform/billing
  Visão geral
  Contratos
  Cobranças
  Pagamentos
  Inadimplência
  Pix Automático
  Eventos
  Relatórios
```

Keep `/platform/clinicas` Pix status + REFUSED CTA.

Do not dump every KPI onto one screen.

### 17.1 Overview metrics (do not label MRR)

Period = calendar month `America/Sao_Paulo` unless a filter says otherwise.

- `received_in_period`
- `pending_amount`
- `overdue_amount`
- `clinics_with_received`
- `delinquent_clinics`
- `active_commercial_contracts`
- `active_pix_automatic_authorizations`
- `payment_success_count`

### 17.2 Contracts

Clinic, plan, price, cycle, status, start, next cobrança, authorization, billing health. Safe actions only.

### 17.3 Cobranças / payments

Global lists with clinic / status / period / plan / method filters. Drill-down: cobrança facts, payment facts, instruction, authorization, human-readable timeline. Separate cobrança from payment.

### 17.4 Delinquency

Total overdue, clinic count, aging buckets, drill-down. No auto-suspend.

### 17.5 Pix Automatic

State, generation, contract, clinic, next cobrança, safe actions. REFUSED → reissue. ACTIVE → no reissue. INTENT → awaiting create. CREATED → awaiting customer bank authorization.

### 17.6 Events

Sanitized `billing_provider_events`: event type, received time, processing status, processed time, related payment/auth if safely correlated, ignore/retry reason, attempts. Never raw payload.

Clinic Admin gets a **business** timeline, not this diagnostic surface.

---

## 18. Reports

MVP:

- received by period
- pending by period
- overdue
- revenue by plan
- payments by status
- active Pix Automatic
- delinquent clinics
- CSV export

PDF / Excel: `OPTIONAL_POST_MVP`.

---

## 19. Future card compatibility

Do not implement cards.

Domain must stay method-agnostic. `billing_payments.billing_type` already includes `CREDIT_CARD`.

Later `CREDIT_CARD` must attach without rewriting:

- commercial contracts
- cobranças
- payments
- delinquency
- reports

Pix Automatic remains the current authorization rail, not the permanent domain model.

---

## 20. Security invariants

- Asaas keys: Edge environment only. Never `VITE_*` / `NEXT_PUBLIC_*`
- `service_role` never in the browser
- Raw webhook payload never stored or shown
- QR / Pix payload never persisted
- Environment never browser-authoritative
- Tenant isolation: Clinic Admin sees only own clinic
- Patient and ordinary professional: no billing
- Action-level outbound gates (section 5.1)
- `confirm_sandbox_payment` remains sandbox-only
- Sandbox cron drain remains sandbox-only

---

## 21. Database / Edge / frontend gap (design only)

**Reuse:** all `private.billing_*` tables; identity RPCs; PA Pix RPCs; PREPARE / EXECUTE / REISSUE engines; webhook; processor.

**Extend (no new tables unless later proven necessary):**

- Public catalog list RPC
- Public commercial-contract create wrapper (Clinic Admin, server price)
- Focused clinic read RPCs: overview, cobranças, payments, timeline
- Identity → customer loader
- Clinic-gated outbound actions
- Clinic-gated own REFUSED reissue
- `get_or_create_billing_account` accepts Clinic Admin
- PA list/detail RPCs for the Billing IA
- Action-level authorization on `asaas-outbound`

**New table: NOT REQUIRED for MVP.**

**Frontend reuse:** `BillingProfilePage`, Settings billing card, `PlatformClinicsPage` Pix badges/dialogs, `pixAutomaticReissue` domain.

**Frontend net-new:** checkout wizard, clinic hub, `/platform/billing/*`.

Prefer adding gated actions on `asaas-outbound` over many new Edge functions.

---

## 22. Implementation work packages

| WP | Scope | Forbidden |
|---|---|---|
| **BILLING-PRODUCT-02** | Catalog + identity + commercial checkout foundation | No Pix provider HTTP |
| **BILLING-PRODUCT-03** | Identity-backed Asaas customer + clinic Pix PREPARE/EXECUTE + transient QR + **QR recovery design** | No blind POST; no persisted QR; no fixture checkout |
| **BILLING-PRODUCT-04** | Clinic Billing Hub: plan + cobranças + payments + delinquency + business timeline | No Create Charge; no enforcement |
| **BILLING-PRODUCT-05** | Platform Billing: overview, contracts, cobranças, payments, delinquency, Pix, events | No raw payloads |
| **BILLING-PRODUCT-06** | Reports CSV + hardening + Master Sandbox E2E | No 18/10 simulation; **retry-policy decision required before new product authorizations / Master E2E** |
| **BILLING-PRODUCT-PROD-01** | Production cutover | Locked until BP06 PASS |

Do not start BP02 from this documentation WP.

---

## 23. Master Sandbox E2E (eventual)

Brand-new **synthetic** clinic. Do not mutate live QA #2. Do not simulate real 18/10 settlement.

```
clinic admin
  → select Pulse
  → fiscal identity
  → commercial contract
  → Asaas sandbox customer from identity
  → Pix Automatic PREPARE + EXECUTE
  → transient QR
  → human Sandbox payer
  → initial payment
  → ACTIVE
  → Clinic Admin sees plan + payment
  → next cobrança appears
  → PA sees contract / cobrança / payment
  → timelines
  → reports
```

Also: REFUSED / reissue; delinquency **fixture** (not live 18/10); wrong tenant; non-admin; duplicate-click safety; provider timeout / unknown-outcome safety.

---

## 24. Production lock

```
BILLING-PRODUCT-PROD-01 is LOCKED until BILLING-PRODUCT-06 = PASS
```

Until then, do **not**:

- use Juliana production credentials
- configure production webhook
- create production Asaas customers
- flip the sandbox QA billing account
- enable production drain
- set Edge environment to production against existing sandbox rows

After BP06 PASS, a dedicated cutover WP may perform production configuration on a **new** production billing account, real fiscal identities, and an explicit production drain policy.

---

## 25. Open gates (must not be papered over)

| Gate | Status |
|---|---|
| `CHECKOUT_QR_RECOVERY` | `REQUIRED_DESIGN_BEFORE_BP03_RELEASE` |
| `PIX_AUTOMATIC_RETRY_POLICY` | `DECISION_REQUIRED_BEFORE_MASTER_E2E` |
| Product entitlement enforcement | `INTENTIONALLY_DEFERRED_PRODUCT_SCOPE` |
| Production Asaas | Locked until BP06 PASS |
| Live QA 2026-10-18 settlement | `DEFERRED_UNTIL_REAL_EVENT` (observe; do not simulate) |

---

## 26. Relationship to the engine handoff

Engine closeout remains:

[docs/VERTEXA_ASAAS_FINAL_HANDOFF_2026-09-19.md](VERTEXA_ASAAS_FINAL_HANDOFF_2026-09-19.md)

`PASS_ASAAS_SANDBOX_INTEGRATION_CLOSED`

Development freeze was lifted **only** because product scope changed:

```
ASAAS_DEVELOPMENT_PHASE = UNFROZEN_BY_PRODUCT_SCOPE_CHANGE
```

This contract is the new phase authority. It does not authorize production cutover or live QA mutation.
