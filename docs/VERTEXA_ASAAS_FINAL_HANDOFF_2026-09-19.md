# VERTEXA — Asaas sandbox closeout handoff

Date: 2026-09-19  
Work package: WP-ASAAS-06 / WP-ASAAS-06A  
Verdict: `PASS_ASAAS_SANDBOX_INTEGRATION_CLOSED`

This document is the canonical engineering handoff for the current Asaas sandbox integration. It is not a production go-live certificate. No API keys, JWTs, service-role values, passwords, or Pix QR payloads are included.

---

## 1. Verdict

Sandbox engineering for the intended Asaas scope is closed:

- B2B clinic customer / billing account
- Vertexa commercial contract
- Pix Automatic CREATE + activation
- REFUSED handling + generation / PA-gated reissue
- Initial Pix payment ingestion
- Future recurring instruction + PENDING payment ingestion
- Webhook ingest + claim/drain processor
- Outbound idempotency
- Platform Admin read model + REFUSED CTA
- Production frontend publication of 05G1

Remaining work is either:

- real future provider events (first recurring settlement on 2026-10-18)
- production Asaas configuration and identity cutover
- product decisions outside this integration (entitlement enforcement, checkout, Founder)

Do not treat this file as permission to flip Edge environment to production.

---

## 2. Source / release alignment

| Surface | State |
|---|---|
| `origin/main` | `2e64a7141357a565aba10ab400638259b23d5bef` |
| Functional ancestor | `81d5054e9a14b01e04d663822dfaef1a533e0fd9` (PR #88) |
| Delta `81d5054..2e64a71` | `README.md` only (`build47` → `build48`) |
| Production frontend | https://app.vertexa.app.br — Vercel success on `2e64a71` |
| Remote migrations | 116 |
| Latest migration | `20260919190000_wp_asaas_05g1_pa_gated_pix_automatic_reissue` |
| Pending migrations | NONE |

### Edge (do not redeploy from this document)

| Function | Version | `verify_jwt` |
|---|---|---|
| `asaas-outbound` | 22 | true |
| `asaas-webhook` | 10 | false |
| `asaas-processor` | 10 | true |
| `asaas-processor-cron` | 10 | false |

Leftover: `asaas-05f1-r2-payment-conciliation-probe` v5 (410 stub). Not on the product path.

---

## 3. Architecture

Vertexa is commercial / product authority. Asaas is financial / provider-fact authority.

```
Clinic (tenant B2B)
  → billing_accounts (sandbox|production, unique per clinic)
  → billing_customer_identities (fiscal identity; future customer source)
  → billing_commercial_contracts (Vertexa price/plan snapshot)
  → billing_pix_automatic_authorizations (INTENT → CREATED → ACTIVE | REFUSED | …)
  → billing_outbound_operations (reserve / complete / fail)
  → asaas-outbound (explicit PA command)
  → Asaas sandbox

Asaas webhook
  → asaas-webhook (token + environment fail-closed)
  → billing_provider_events
  → asaas-processor / asaas-processor-cron (sandbox auto-drain only)
  → GET /payments/{id} (Asaas is snapshot authority)
  → billing_payments
  → optional pix_instruction_id / pix_authorization_id
```

Patients are not payers. Browser clients cannot create Asaas customers, subscriptions, or authorizations directly. Platform Admin uses user JWT. Environment is never browser-authoritative.

---

## 4. State machines

### 4.1 Pix Automatic authorization

```
PREPARE (SQL, insert-only)
  → local INTENT + outbound pending
EXECUTE (Edge, PA, explicit)
  → lookup-first → Asaas CREATE
  → CREATED
payer authorizes
  → ACTIVE
or provider refuses
  → REFUSED (if current primary: PA may reissue)
```

CANCELLED / EXPIRED exist as stored provider facts. Reissue of those statuses is unsupported.

### 4.2 Reissue (local only)

```
current primary REFUSED
  → public.reissue_pix_automatic_authorization
  → require private.is_platform_admin()
  → environment from billing_accounts
  → private.billing_reissue_pix_automatic_authorization
  → demote old (historical, primary=false)
  → insert INTENT generation N+1
  → reserve local outbound create_pix_automatic_authorization
  → audit billing_pix_automatic_reissue_events
```

Zero Asaas HTTP during reissue. Provider CREATE remains a separate explicit `execute_pix_automatic_authorization`.

Blocked:

- ACTIVE / CREATED → `BILLING_REISSUE_NOT_REFUSED`
- historical REFUSED (not primary) → `BILLING_REISSUE_NOT_PRIMARY`
- CANCELLED / EXPIRED → `BILLING_REISSUE_STATUS_UNSUPPORTED`
- already INTENT primary → `already_reissued` (idempotent + audit)

### 4.3 Payment ingestion

```
provider event
  → claim
  → GET /payments/{id}
  → if Pix Automatic:
       instruction.provider_payment_id
       or observed authorization id
       or payment.pixTransaction → GET /pix/transactions/{id} → conciliationIdentifier
  → apply billing_payments
  → entitlement_granted = false always
```

XOR on `billing_payments`:

- subscription path: subscription IDs set, `pix_authorization_id` null
- Pix path: `pix_authorization_id` set, subscription IDs null

`payment.customer` is not correlation authority for the initial QR.

---

## 5. Database (private billing)

Core tables:

| Table | Role |
|---|---|
| `billing_accounts` | Clinic-scoped provider account; env-isolated |
| `billing_customer_identities` | Fiscal identity for future customer CREATE |
| `billing_plans` / `billing_plan_versions` / `billing_offers` / prices | Vertexa catalog |
| `billing_commercial_contracts` | Immutable contracted snapshot |
| `billing_pix_automatic_authorizations` | Authorization fact + generation + primary |
| `billing_pix_automatic_payment_instructions` | Recurring instruction fact |
| `billing_outbound_operations` | Provider write ledger |
| `billing_provider_events` | Webhook ingest ledger (hash, no raw JSONB) |
| `billing_payments` | Canonical payment snapshot |
| `billing_subscriptions` | Legacy subscription binding |
| `billing_entitlements` + maps | Technical catalog; not enforced |
| `billing_pix_automatic_reissue_events` | PA reissue audit |

Public PA RPCs:

- `am_i_platform_admin`
- `list_platform_clinic_pix_automatic_statuses` (sanitized read)
- `reissue_pix_automatic_authorization` (`SECURITY DEFINER`, `authenticated` only)

Private reissue engine: `EXECUTE` granted to `postgres` only.

---

## 6. Edge functions

| Function | Job |
|---|---|
| `asaas-outbound` | PA commands: customer/subscription fixtures, execute Pix CREATE, reissue (no HTTP), sandbox confirm |
| `asaas-webhook` | Ingress. Auth = `asaas-access-token` vs env-specific secret. ACK 200 after durable idempotent store |
| `asaas-processor` | PA drain of already-ingested events |
| `asaas-processor-cron` | Sandbox-only auto-drain. Does not call outbound. Refuses production |

Secrets live in Edge env only. Never `VITE_*` / `NEXT_PUBLIC_*` Asaas keys.

Documented names (no values):

- `ASAAS_API_KEY_SANDBOX` / `ASAAS_API_KEY_PRODUCTION`
- `ASAAS_WEBHOOK_AUTH_TOKEN_SANDBOX` / `ASAAS_WEBHOOK_AUTH_TOKEN_PRODUCTION`
- `ASAAS_WEBHOOK_ENVIRONMENT`
- `ASAAS_OUTBOUND_ENVIRONMENT`

---

## 7. Pix Automatic CREATE

Validated sandbox path:

1. Local PREPARE inserts INTENT + pending outbound (no HTTP).
2. Explicit PA EXECUTE loads prepared facts.
3. Lookup-first GET by `contractId`.
4. POST only on first write or deterministic 4xx/429.
5. Unknown timeout / 5xx → fail ledger, no blind second POST (`BLOCKED_AMBIGUOUS_CREATE_RECONCILIATION`).
6. QR payload is response-only and transient. Not persisted. Not logged.
7. Idempotency authority is `billing_outbound_operations.idempotency_key` (per authorization attempt). Asaas `mutationId` header is not used.

Frontend does not expose CREATE. CREATE is an explicit outbound command, not a clinic-admin browser action.

---

## 8. Reissue

Closed and published:

- Synthetic PA E2E: PASS (fixture cleaned; live QA untouched)
- Public wrapper + Edge action + UI: on `main` / production
- ACTIVE CTA hidden; REFUSED CTA covered by tests
- Environment derived server-side
- Actor recorded when the 05G1 audit path is used

Live QA #1 → #2 predates the 05G1 audit table (`billing_pix_automatic_reissue_events` count for those IDs = 0). That is historical, not a current product hole.

---

## 9. Payment ingestion

Initial Pix:

- 39000 cents
- `RECEIVED`
- authorization #2
- instruction NULL
- subscription NULL

Future cycle already stored:

- payment `PENDING`
- instruction `AWAITING_REQUEST`
- due 2026-10-18
- authorization #2
- instruction linked (`has_provider_payment` true)

Deterministic future correlation already exists in the ledger: payment → instruction → authorization. Settlement of 18/10 has not happened and must not be simulated.

---

## 10. Webhooks and processor

- At-least-once ingress; `external_event_id` unique per provider+environment
- Duplicate ACK 200; original row intact
- Hash mismatch ACK 200; `payload_hash_mismatch`; original intact
- Claim with `FOR UPDATE SKIP LOCKED`; retryable failed; stale processing reclaim
- Current sandbox events: processed=11, ignored=4, received=0, failed=0, processing=0
- Cron does not CREATE authorizations and does not invoke outbound

---

## 11. Outbound idempotency

QA sandbox account operations (all completed):

| Type | Attempts | Notes |
|---|---|---|
| `create_customer` | 1 | Sandbox fixture customer |
| `create_subscription` | 1 | Legacy subscription path |
| `create_pix_automatic_authorization` #1 | 2 | PREPARE insert-only + EXECUTE |
| `create_pix_automatic_authorization` #2 | 2 | Same pattern after human CREATE |

`attempt_count=2` on Pix CREATE is the prepare-then-execute contract, not a duplicate provider POST.

No automatic CREATE. No cron execution of outbound.

---

## 12. Platform Admin

Production `https://app.vertexa.app.br/platform/clinicas` (WP-ASAAS-05G1-R2 smoke):

- Pix Automático column visible
- Vertexa QA Sandbox Billing = **Ativo**
- CTA `Gerar nova autorização` absent for ACTIVE
- Read RPC sanitized (no provider ids, QR, keys)
- No reissue / execute / Asaas HTTP during the smoke

REFUSED → CTA visible is covered by `PlatformClinicsPage.test.tsx` and synthetic E2E. Do not create another live REFUSED authorization to re-prove it.

---

## 13. Security

Closed for the current design:

- Asaas keys server-side only
- No frontend Asaas secret
- `service_role` not in the browser
- PA mutations independently authorized (`is_platform_admin`)
- Private engine not executable by `anon` / `authenticated` / `service_role`
- Sandbox / production secret isolation
- QR not persisted
- Raw provider objects not stored or logged
- Environment not taken from the browser as authority
- `confirm_sandbox_payment` fail-closed in production (`sandbox_only`)

---

## 14. Observability / operations

An operator with SQL / service access can answer:

| Question | Source |
|---|---|
| Why did this payment not enter? | `billing_provider_events.processing_status`, `last_error_category`, ignore reasons; `billing_payments` by `external_payment_id` |
| Why did authorization fail? | authorization `provider_status`; outbound `last_error_category` / `status` |
| Was CREATE sent twice? | outbound `attempt_count` + unique idempotency key + unknown-outcome block |
| Which authorization owns this payment? | `billing_payments.pix_authorization_id` (+ optional instruction) |
| Who reissued? | `billing_pix_automatic_reissue_events.actor_profile_id` (05G1 path) |

There is no dedicated billing ops UI. That is optional, not a launch blocker, because the private ledgers are complete.

Browser Sentry (`docs/ops/OBSERVABILITY.md`) is general frontend error capture, not Asaas financial forensics.

---

## 15. Failure recovery

| Failure | Safe behavior |
|---|---|
| Provider timeout / 5xx | `unknown`; fail outbound; lookup-first; no blind POST |
| Duplicate webhook | ACK 200; original row |
| Processor exception | retryable failed + backoff |
| Temporary GET failure | retryable |
| GET 404 | dedicated missing-payment handler |
| Provider auth 401/403 | non-retryable |
| Ambiguous CREATE | blocked; no second POST |
| REFUSED | stored; reissue only if current primary |
| Stale PA reissue | `BILLING_REISSUE_NOT_PRIMARY` |
| ACTIVE reissue | blocked |
| Database failure mid-reissue | same transaction as audit |

---

## 16. Current QA canonical state

Clinic: Vertexa QA Sandbox Billing  
Environment: sandbox  
Contract: active, 39000 cents

| Auth | Generation | Status | Primary |
|---|---|---|---|
| #1 | 1 | REFUSED | false (historical) |
| #2 | 2 | ACTIVE | true |

- Authorization count = 2
- Max generation = 2
- Generation 3 = absent
- Payments total = 4
  - BOLETO 1000 RECEIVED 2026-09-10 (legacy subscription)
  - BOLETO 1000 PENDING 2026-10-10 (legacy subscription)
  - PIX 39000 RECEIVED 2026-09-18 (auth #2, no instruction)
  - PIX 39000 PENDING 2026-10-18 (auth #2, instruction linked)
- Duplicate initial R$390 without instruction = 1
- Ledger XOR violations = 0
- Instruction = 1, `AWAITING_REQUEST`, due 2026-10-18
- Entitlements catalog = 9, unchanged
- `clinic_creation_authorizations.source='asaas'` = 0
- Product enforcement = OFF
- `billing_customer_identities` for QA clinic = 0 (sandbox customer came from outbound fixture)

Do not reissue #2. Do not create generation 3. Do not simulate 18/10.

---

## 17. Entitlement / product enforcement

Classification: **INTENTIONALLY_DEFERRED_PRODUCT_SCOPE**

Current invariant:

```
AUTHORIZATION ACTIVE
  != PAYMENT RECEIVED
  != ENTITLEMENT GRANTED
```

Do not enable product enforcement in this closeout.

Evidence is consistent across ASAAS-02 and 05A–05G:

- `RECORDING PAYMENT != GRANTING ENTITLEMENT`
- apply always returns `entitlement_granted=false`
- `PLAN_ENFORCEMENT_NOT_ACTIVATED`
- no `source=asaas` grant
- clinics continue operating unchanged
- non-payment cut is manual Platform Admin suspend, not billing automation

This is not required to close the Asaas sandbox integration. It is a separate product WP if/when paid status must gate access.

---

## 18. Production configuration checklist

These items are **future authorized cutover work**, not current sandbox defects.

Do not configure from this document. Do not ask humans for keys here.

**DO NOT flip the existing sandbox QA billing account to production.**

Create a new production billing account when cutover is authorized.

Required later:

1. Production Asaas API credentials (`ASAAS_API_KEY_PRODUCTION`)
2. Production webhook token and Asaas webhook configuration pointing at `asaas-webhook`
3. Environment `production` (`ASAAS_WEBHOOK_ENVIRONMENT` and `ASAAS_OUTBOUND_ENVIRONMENT`; fail-closed, no silent fallback)
4. NEW production `billing_accounts` row
5. Real clinic fiscal identity in `billing_customer_identities`
6. Remove dependency on sandbox `CUSTOMER_FIXTURE` (do not POST the fixture to production)
7. Explicit production event-drain policy (cron is sandbox-only today)
8. Controlled first production clinic / contract / PA-operated CREATE

Also keep sandbox-only actions fail-closed (`confirm_sandbox_payment`).

`CUSTOMER_FIXTURE` / `SUBSCRIPTION_FIXTURE` in `asaas-outbound` are sandbox homologation fixtures. They are not production customer/legal identity.

---

## 19. Vercel Git-author ACL

Operational deployment issue, not an Asaas functional blocker.

Symptom: commits from the non-authorized Git identity get `Deployment was blocked`.

Established workaround: README-only commit on `main` by `Vertexa-project <vertexa@dizeops.com>` (GitHub.com). Do not stack repeated triggers. Do not change application code to bypass ACL.

---

## 20. Classification buckets

### CLOSED_PASS

- Source control / database / Edge / published frontend alignment
- Commercial contract model (≠ authorization ≠ payment ≠ entitlement)
- Legacy BOLETO / subscription compatibility
- Pix authorization CREATE (sandbox)
- Pix authorization reissue (PA-gated)
- Initial Pix payment ingestion
- Recurring payment **implementation** (PENDING + instruction stored)
- Webhook pipeline
- Outbound idempotency
- Billing payment ledger
- Asaas security model
- Platform Admin operations
- Observability sufficient for the five operator questions
- Failure recovery of the cases above

### REQUIRED_BEFORE_PRODUCTION

Only items that must be true before charging a real production clinic:

1. Production Asaas secrets + webhook configuration
2. Production environment records / new billing account (not the sandbox QA row)
3. Real clinic fiscal identity as customer source (no production POST of sandbox fixture)
4. Explicit production event-drain policy
5. First production clinic commercial rollout (business + PA operation)

### DEFERRED_UNTIL_REAL_EVENT

**2026-10-18** recurring settlement is `DEFERRED_UNTIL_REAL_EVENT`.

Do not simulate it. Do not create a fake financial settlement to close QA.

Future validation must observe provider facts naturally:

```
PENDING
  → provider event
  → processor
  → ledger reconciliation
```

Also deferred: later cycles, overdue, refund, or cancellation on the live ACTIVE authorization.

### OPTIONAL_POST_MVP

- Entitlement / plan enforcement
- Self-serve checkout
- Founder claim
- Billing ops UI
- Asaas-native `mutationId` header
- Unused `create_charge` outbound type
- Remove leftover conciliation-probe function
- Landing-page pricing sync

---

## 21. Exact remaining blockers

No Asaas sandbox engineering blocker remains.

Next real validation that cannot be honest today: wait for the 2026-10-18 provider cycle. Do not simulate it.

Next production work belongs in a dedicated configuration / identity cutover WP, not in more sandbox feature code.

---

## 22. Asaas development freeze

`ASAAS_DEVELOPMENT_PHASE = FROZEN`

No new Asaas engineering work should begin unless one of these occurs:

- **A.** a real 18/10 provider event requires investigation
- **B.** an explicit production cutover is authorized
- **C.** a real defect or regression is found
- **D.** product scope changes, such as entitlement enforcement

Do not mutate live authorization #2. Do not create generation 3. Do not configure production Asaas from this document.
