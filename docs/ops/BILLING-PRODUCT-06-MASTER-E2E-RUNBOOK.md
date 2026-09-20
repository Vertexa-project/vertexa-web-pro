# BILLING-PRODUCT-06 — Master Sandbox E2E runbook

Local machinery only. Remote provider execution waits for a later release WP.

Authorization phrase for that future WP (not this one):

```
AUTORIZADO BP06 MASTER E2E
```

The release WP must print `BP06_MASTER_E2E_PREFLIGHT = GO` and wait for that exact phrase.

## Discovery (existing, do not invent shortcuts)

| Capability | Supported mechanism | Remote write? |
|---|---|---|
| Synthetic clinic | `create_clinic_with_owner` / clinic creation RPC | yes |
| Clinic Admin | owner or `professionals.clinic_role=admin` | yes |
| Fiscal identity | `upsert_my_clinic_billing_identity` | yes (DB only) |
| Plans | `list_sellable_billing_plans` | no |
| Contract | `create_my_clinic_commercial_contract` server price | yes (DB only) |
| Sandbox customer | clinic Pix checkout / customer loader | yes (Asaas sandbox) |
| Pix PREPARE | `prepare_my_clinic_pix_automatic_authorization` | no HTTP |
| Pix EXECUTE | `asaas-outbound` clinic-gated action | yes |
| Transient QR | in-session only; `NO_SUPPORTED_QR_RECOVERY` | n/a |
| Auth state | provider_status + generation + is_primary | no |
| Payment / webhook | sandbox payer + webhook + processor | yes / observe |
| REFUSED | isolated fixture/status-fact if Sandbox is not deterministic | fixture or provider |
| Reissue | PA-gated or Clinic Admin own primary REFUSED | yes if executed |
| Overdue | isolated fixture/status facts — never QA #2 2026-10-18 | fixture |
| Cleanup | synthetic `bp06-*` ids only | DB only; no broad delete |

Retry policy for **future new product authorizations**: `ALLOW_THREE_IN_SEVEN_DAYS`. Historical QA auths stay unchanged. This implementation WP does not create new product auths.

## State machine

| STEP | Precondition | Action | Expected | Authority | Remote write? | Retry | Evidence | Cleanup |
|---|---|---|---|---|---|---|---|---|
| S01 | none | create synthetic clinic `bp06-*` | clinic exists | product clinic create | yes | resume if clinic id stored | clinic id | retain |
| S02 | S01 | create/assign Clinic Admin | admin can call clinic billing RPCs | clinic owner/admin | yes | reuse profile | admin profile id | retain |
| S03 | S02 | list sellable plans | Pulse visible | Clinic Admin | no | rerun | plan codes | none |
| S04 | S03 | upsert identity | identity complete | Clinic Admin | DB | upsert idempotent | complete=true | retain |
| S05 | S04 | create contract | active Pulse snapshot | Clinic Admin | DB | do not duplicate if contract id stored | contract id | retain |
| S06 | S05 + human GO | ensure sandbox customer | customer bound | checkout loader | **yes** | reuse bound account | bound=true | retain |
| S07 | S06 | PREPARE Pix | INTENT reserved | Clinic Admin | no HTTP | reuse pending op | op id | retain |
| S08 | S07 + human GO | EXECUTE Pix | QR in session only; persistent CREATED/ACTIVE | outbound | **yes** | no second blind POST | status, no QR stored | retain |
| S09 | S08 | observe auth | CREATED or ACTIVE | read | no | poll same auth | status/generation | none |
| S10 | S09 | Clinic Billing Hub | charge/payment/timeline visible | Clinic Admin | no | rerun reads | counts | none |
| S11 | S10 | Platform Billing | PA sees contract/charge/payment | Platform Admin | no | rerun reads | counts | none |
| S12 | S11 | Reports | period report reflects facts | Platform Admin | no | rerun reads | received/pending | none |
| S13 | isolated clinic | REFUSED path | REFUSED ≠ overdue | fixture or sandbox | maybe fixture | labeled | refused=true | retain |
| S14 | S13 REFUSED | reissue | generation +1, previous historical, duplicate click reuses | allowed actor | **yes** if executed | idempotent engine | generation | retain |
| S15 | isolated clinic | fixture overdue | aging + delinquency + no auto-suspend | fixture | no provider | labeled FIXTURE-DRIVEN OVERDUE | aging | retain/delete fixture |
| S16 | any | wrong tenant / non-admin / duplicate / timeout | fail closed or reuse | matrix | no extra write | resume same step | category | none |
| S17 | finished | cleanup vs retain | never QA #2; only `bp06-*` | runner guard | no provider delete | n/a | selector | see policy |

## Happy path

Brand-new `bp06-<runId>` clinic. Do not reuse QA #2. Product APIs only. Transient QR never persisted. Entitlement enforcement remains OFF unless a later contract says otherwise.

## REFUSED / reissue

Prove REFUSED ≠ overdue. Reissue increments generation once. Previous generation stays historical. New primary is correct. Duplicate reissue click must reuse. If Asaas Sandbox cannot deterministically refuse, use an isolated fixture and label evidence `FIXTURE-DRIVEN REFUSED`.

## Payment

Use the supported sandbox payer + webhook + processor path. Do not manually mark received and call it provider E2E. Fixture-driven payment evidence must be labeled.

## Overdue

`FIXTURE-DRIVEN OVERDUE` only. Do not alter QA #2, do not simulate 2026-10-18, do not move the system clock.

## Failure / security matrix

Wrong tenant, non-admin, patient, anonymous, PA vs Clinic Admin, duplicate contract/Pix/reissue, timeout before response, retry after timeout, replay after completed op, malformed/cross clinic id, stale reload after QR (no QR recovery, no second POST).

## Observability

Store only: run id, synthetic clinic id, internal operation ids, states, counts, HTTP/result categories, timestamps, migration/app version, provider operation type/count.

Never store: API key, service_role, JWT, refresh, magic link, QR, encodedImage, raw webhook, tax id / unnecessary PII.

## Cleanup

DELETE only synthetic `bp06-*` DB rows created by the run, and only when the product has a safe delete. RETAIN provider-side objects if deletion is unsupported. Hard guard: QA #2 id/name never matches.

## Human checkpoint

This implementation WP stops at `local_only`. Release WP prints `BP06_MASTER_E2E_PREFLIGHT = GO` and waits.
