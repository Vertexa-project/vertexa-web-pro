-- =====================================================================================
-- WP-ASAAS-04 — snapshot financeiro normalizado de payments Asaas.
--
-- NÃO edita migrations anteriores (20260830090000 / 20260909090000 / 20260910150000 /
-- 20260910160000 / 20260910170000). Forward migration só.
--
-- Princípio: Asaas é autoridade sobre o fato financeiro externo; esta tabela é o snapshot
-- normalizado (nunca payload bruto). Sem estado comercial/entitlement, sem clinic.status.
-- ASAAS-04 responde "o que aconteceu financeiramente?" — nunca "o que o produto fará".
--
-- Superfície:
--   private.billing_payments   (nova tabela; RLS ON, 0 policies, REVOKE tudo incl. service_role)
--
-- CORREÇÃO OBRIGATÓRIA 2 (subscription-only): billing_subscription_id e
-- external_subscription_id são NOT NULL. Nesta WP o Vertexa cobra SaaS exclusivamente via
-- Subscription — um payment sem subscription NUNCA vira billing_payments (o processor faz
-- ignored_non_subscription_payment). Cobrança avulsa/setup fee/add-on ganharão modelagem
-- explícita própria no futuro; não antecipar aqui.
--
-- financial_state NÃO é enum nativa do Postgres: é text + CHECK sobre um vocabulário INTERNO
-- controlado por nós (não pelo provider). provider_status é text livre (fato externo do
-- Asaas, armazenado verbatim). Isso mantém o processor tolerante a novos status do provider
-- sem quebrar, e ainda controla nosso vocabulário interno via migration.
-- =====================================================================================

create table private.billing_payments (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null
    references private.billing_accounts(id) on delete restrict,
  billing_subscription_id uuid not null
    references private.billing_subscriptions(id) on delete restrict,
  provider text not null,
  environment text not null,
  external_payment_id text not null,
  external_customer_id text not null,
  external_subscription_id text not null,
  provider_status text not null,
  financial_state text not null,
  billing_type text,
  value_cents bigint not null,
  net_value_cents bigint,
  refunded_value_cents bigint,
  due_date date,
  payment_date date,
  confirmed_date date,
  last_provider_event_id text,
  last_provider_event_type text,
  last_provider_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payments_provider_check
    check (provider = 'asaas'),
  constraint billing_payments_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_payments_external_payment_id_check
    check (btrim(external_payment_id) <> ''),
  constraint billing_payments_external_customer_id_check
    check (btrim(external_customer_id) <> ''),
  constraint billing_payments_external_subscription_id_check
    check (btrim(external_subscription_id) <> ''),
  constraint billing_payments_provider_status_check
    check (btrim(provider_status) <> ''),
  constraint billing_payments_financial_state_check
    check (financial_state in (
      'pending', 'authorized', 'confirmed', 'received', 'overdue',
      'refund_in_progress', 'refunded', 'partially_refunded',
      'chargeback_requested', 'chargeback_dispute', 'chargeback_reversal_pending',
      'voided', 'unknown'
    )),
  constraint billing_payments_value_cents_check
    check (value_cents > 0),
  constraint billing_payments_net_value_cents_check
    check (net_value_cents is null or net_value_cents >= 0),
  constraint billing_payments_refunded_value_cents_check
    check (refunded_value_cents is null or refunded_value_cents >= 0)
);

comment on table private.billing_payments is
  'WP-ASAAS-04: snapshot financeiro normalizado de um payment Asaas. Fonte de verdade = GET '
  '/payments/{id} (Asaas é autoridade). Nunca payload bruto. billing_subscription_id NOT NULL: '
  'só payments de subscription Vertexa entram (subscription-only). Sem entitlement/clinic.status.';

comment on column private.billing_payments.provider_status is
  'Status do payment no Asaas, verbatim (fato externo). Text livre — tolera status novos do '
  'provider sem quebrar. A classificação interna vive em financial_state.';

comment on column private.billing_payments.financial_state is
  'Classificação financeira INTERNA (vocabulário controlado por migration). unknown quando o '
  'provider_status não é reconhecido. Nunca dispara ação de produto nesta WP.';

comment on column private.billing_payments.refunded_value_cents is
  'Soma (em centavos) apenas dos refunds com status DONE. refunds PENDING/CANCELLED não contam '
  '(docs Asaas: só DONE representa valor efetivamente devolvido). partially_refunded quando '
  '0 < refunded_value_cents < value_cents.';

comment on column private.billing_payments.last_provider_event_created_at is
  'dateCreated do último provider event aplicado (audit/monotonicidade). NÃO usado para '
  'reconstituir provider state — o GET atual é sempre a autoridade do snapshot.';

-- Idempotência de negócio: um payment externo = no máximo 1 linha por (provider, environment).
create unique index billing_payments_external_payment_uidx
  on private.billing_payments (provider, environment, external_payment_id);

create index billing_payments_billing_account_idx
  on private.billing_payments (billing_account_id);

create index billing_payments_billing_subscription_idx
  on private.billing_payments (billing_subscription_id);

alter table private.billing_payments enable row level security;

revoke all on table private.billing_payments from public, anon, authenticated, service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910180000',
  '20260910180000_wp_asaas_04_billing_payments.sql',
  'WP-ASAAS-04: private.billing_payments (snapshot financeiro normalizado, RLS ON, 0 policies, '
  'REVOKE tudo incl. service_role). subscription-only (billing_subscription_id NOT NULL). '
  'financial_state = vocabulário interno via CHECK; provider_status text livre. Sem payload bruto.',
  'WP-ASAAS-04'
)
on conflict (version) do nothing;
