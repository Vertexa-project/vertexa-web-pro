# PREPROD-02 Commercial Gate + Dual-Env Isolation

> **For agentic workers:** Implement locally only. Do not apply, deploy, push, or configure Production.

**Goal:** Resolve PROD-01A blockers: PRE_CONTRACT commercial policy + billing-account environment isolation + Production write kill switch.

**Architecture:** Server-authoritative commercial access resolver (OBSERVE default). Unique `(clinic_id, environment)` billing accounts with immutable environment. Production provider writes gated LOCKED/CANARY/OPEN. Outbound routes by persisted operation environment. Webhook environment from matching auth token.

**Tech Stack:** Postgres migrations, Edge Functions, React clinic/platform UI, Vitest.

**Spec:** WP-BILLING-PREPROD-02
