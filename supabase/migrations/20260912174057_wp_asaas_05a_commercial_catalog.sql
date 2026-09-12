-- =====================================================================================
-- WP-ASAAS-05A — catálogo comercial canônico (Vertexa).
--
-- ASAAS = verdade de fatos financeiros.
-- VERTEXA = verdade do produto. Este catálogo é a verdade comercial do Vertexa.
--
-- NÃO chama API Asaas. NÃO cria customer/subscription/charge/checkout.
-- NÃO altera billing_subscriptions. NÃO adiciona plan/price em clinics.
-- NÃO reserva vaga Founder. NÃO implementa entitlement/enforcement.
-- NÃO cria RPC pública de catálogo (nenhuma surface precisa ainda).
--
-- Features aqui são MARKETING CLAIMS do catálogo comercial.
-- NÃO são entitlement técnico. ASAAS-05B fará o mapeamento real.
--
-- Dívidas explícitas (não bloqueiam este WP):
--   ACTIVE_PATIENT_DEFINITION_REQUIRED_FOR_05B
--   COMMERCIAL_DECISION_REQUIRED (profissional adicional / excedente)
--   LANDING_PAGE_PRICING_SYNC = MANUAL_DEBT
--   CONTRACTED_PRICE_SNAPSHOT_REQUIRED_FOR_05C
--   FOUNDER_CLAIM_CONCURRENCY = ASAAS-05H
--   FUTURE_ADJUSTMENT_FORMULA = WP de pricing lifecycle (não inventar matemática)
-- =====================================================================================

create table private.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null,
  sort_order integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_code_format_check
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint billing_plans_code_trim_check
    check (btrim(code) = code and code <> ''),
  constraint billing_plans_display_name_check
    check (btrim(display_name) <> ''),
  constraint billing_plans_status_check
    check (status in ('active', 'retired'))
);

comment on table private.billing_plans is
  'WP-ASAAS-05A: plano comercial Vertexa. code é estável (pulse/sync/apex). '
  'NÃO é product ID Asaas. Origem = catálogo interno Vertexa. Sem enforcement.';

comment on column private.billing_plans.code is
  'FK lógica estável. Nunca usar display_name como FK. Data-driven — sem enum rígido.';

create unique index billing_plans_code_uidx
  on private.billing_plans (code);

create unique index billing_plans_sort_order_uidx
  on private.billing_plans (sort_order);


create table private.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  version integer not null,
  currency_code text not null,
  standard_price_cents integer not null,
  max_professionals integer not null,
  max_active_patients integer not null,
  tagline text,
  marketing_message text,
  created_at timestamptz not null default now(),
  constraint billing_plan_versions_plan_id_fkey
    foreign key (plan_id) references private.billing_plans(id) on delete restrict,
  constraint billing_plan_versions_version_check
    check (version >= 1),
  constraint billing_plan_versions_currency_check
    check (currency_code = 'BRL'),
  constraint billing_plan_versions_standard_price_check
    check (standard_price_cents >= 0),
  constraint billing_plan_versions_max_professionals_check
    check (max_professionals >= 0),
  constraint billing_plan_versions_max_active_patients_check
    check (max_active_patients >= 0)
);

comment on table private.billing_plan_versions is
  'WP-ASAAS-05A: versão imutável de preço/limites/copy. Versão corrente = max(version) '
  'por plan_id. NÃO fazer UPDATE destrutivo de preço. Nova cotação = nova linha. '
  'standard_price_cents é preço de catálogo, NÃO preço contratado. '
  'ASAAS-05C deve snapshotar o preço na assinatura — ver CONTRACTED_PRICE_SNAPSHOT_REQUIRED_FOR_05C.';

comment on column private.billing_plan_versions.standard_price_cents is
  'Preço de lista em centavos BRL. Inteiro. Nunca float. Nunca string.';

comment on column private.billing_plan_versions.max_active_patients is
  'Limite comercial da LP. Sem enforcement neste WP. '
  'ACTIVE_PATIENT_DEFINITION_REQUIRED_FOR_05B: patients não tem status de seat; '
  'patient_status em adherence_snapshots é clínico/VRI; '
  'professional_patient_links.status=active é vínculo de equipe, não seat de billing.';

create unique index billing_plan_versions_plan_version_uidx
  on private.billing_plan_versions (plan_id, version);

create index billing_plan_versions_plan_id_idx
  on private.billing_plan_versions (plan_id);


create table private.billing_features (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null,
  display_name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint billing_features_key_format_check
    check (feature_key ~ '^[a-z][a-z0-9_]*$'),
  constraint billing_features_key_trim_check
    check (btrim(feature_key) = feature_key and feature_key <> ''),
  constraint billing_features_display_name_check
    check (btrim(display_name) <> '')
);

comment on table private.billing_features is
  'WP-ASAAS-05A: catálogo de features COMERCIAIS / marketing claims. '
  'NÃO é entitlement técnico. NÃO habilita feature no produto. ASAAS-05B mapeia enforcement.';

comment on column private.billing_features.feature_key is
  'Chave estável do catálogo comercial. Não confundir com flag de produto implementada.';

create unique index billing_features_key_uidx
  on private.billing_features (feature_key);

create unique index billing_features_sort_order_uidx
  on private.billing_features (sort_order);


create table private.billing_plan_version_features (
  plan_version_id uuid not null,
  feature_id uuid not null,
  created_at timestamptz not null default now(),
  constraint billing_plan_version_features_pkey
    primary key (plan_version_id, feature_id),
  constraint billing_plan_version_features_version_fkey
    foreign key (plan_version_id) references private.billing_plan_versions(id) on delete restrict,
  constraint billing_plan_version_features_feature_fkey
    foreign key (feature_id) references private.billing_features(id) on delete restrict
);

comment on table private.billing_plan_version_features is
  'WP-ASAAS-05A: estado final explícito por versão de plano. '
  'Apex v1 lista TODAS as claims (Pulse+Sync+Apex). Sem herança dinâmica: '
  'mudar Pulse no futuro não altera Apex histórico.';

create index billing_plan_version_features_feature_id_idx
  on private.billing_plan_version_features (feature_id);


create table private.billing_offers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null,
  status text not null,
  total_slots integer not null,
  price_lock_months integer not null,
  future_adjustment_discount_bps integer not null,
  commercial_terms text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_offers_code_format_check
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint billing_offers_code_trim_check
    check (btrim(code) = code and code <> ''),
  constraint billing_offers_display_name_check
    check (btrim(display_name) <> ''),
  constraint billing_offers_status_check
    check (status in ('configured', 'active', 'retired')),
  constraint billing_offers_total_slots_check
    check (total_slots > 0),
  constraint billing_offers_price_lock_months_check
    check (price_lock_months > 0),
  constraint billing_offers_discount_bps_check
    check (future_adjustment_discount_bps >= 0 and future_adjustment_discount_bps <= 10000),
  constraint billing_offers_window_check
    check (starts_at is null or ends_at is null or ends_at > starts_at)
);

comment on table private.billing_offers is
  'WP-ASAAS-05A: oferta comercial Vertexa (não cupom Asaas). '
  'FOUNDER_2026 = code founder_2026. Sem claims/alocação neste WP. '
  'ASAAS-05H: impedir 51ª clínica, race na vaga 50, double claim e release ambíguo '
  'com unique(clinic, offer) + advisory lock + contador na mesma transação.';

comment on column private.billing_offers.future_adjustment_discount_bps is
  'THIS FIELD RECORDS THE COMMERCIAL DISCOUNT TERM. '
  'THE POST-LOCK CALCULATION FORMULA IS NOT DEFINED IN ASAAS-05A. '
  '3000 = 30% preservado como termo comercial da LP, NÃO política matemática implementada. '
  'Não está congelado se 30% incide sobre o preço futuro total ou sobre o aumento.';

comment on column private.billing_offers.total_slots is
  'Capacidade (50). NÃO consumir. Sem sequence 1/50. Sem claim por clínica.';

comment on column private.billing_offers.starts_at is
  'Nullable de propósito: janela cronológica ainda não é regra comercial congelada.';

create unique index billing_offers_code_uidx
  on private.billing_offers (code);


create table private.billing_offer_plan_prices (
  offer_id uuid not null,
  plan_version_id uuid not null,
  price_cents integer not null,
  created_at timestamptz not null default now(),
  constraint billing_offer_plan_prices_pkey
    primary key (offer_id, plan_version_id),
  constraint billing_offer_plan_prices_offer_fkey
    foreign key (offer_id) references private.billing_offers(id) on delete restrict,
  constraint billing_offer_plan_prices_version_fkey
    foreign key (plan_version_id) references private.billing_plan_versions(id) on delete restrict,
  constraint billing_offer_plan_prices_price_check
    check (price_cents >= 0)
);

comment on table private.billing_offer_plan_prices is
  'WP-ASAAS-05A: preço promocional da oferta por versão de plano. '
  'Founder price ≠ standard catalog price. Sem Asaas ID.';

create index billing_offer_plan_prices_plan_version_id_idx
  on private.billing_offer_plan_prices (plan_version_id);


create or replace function private.billing_catalog_protect_commercial_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'billing_plans' then
    if new.code is distinct from old.code then
      raise exception 'BILLING_CATALOG_CODE_IMMUTABLE'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'billing_plan_versions' then
    if new.standard_price_cents is distinct from old.standard_price_cents
       or new.currency_code is distinct from old.currency_code
       or new.max_professionals is distinct from old.max_professionals
       or new.max_active_patients is distinct from old.max_active_patients
       or new.plan_id is distinct from old.plan_id
       or new.version is distinct from old.version then
      raise exception 'BILLING_CATALOG_VERSION_IMMUTABLE'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'billing_offers' then
    if new.code is distinct from old.code
       or new.total_slots is distinct from old.total_slots
       or new.price_lock_months is distinct from old.price_lock_months
       or new.future_adjustment_discount_bps is distinct from old.future_adjustment_discount_bps
       or new.commercial_terms is distinct from old.commercial_terms then
      raise exception 'BILLING_CATALOG_OFFER_TERMS_IMMUTABLE'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'billing_offer_plan_prices' then
    if new.price_cents is distinct from old.price_cents
       or new.offer_id is distinct from old.offer_id
       or new.plan_version_id is distinct from old.plan_version_id then
      raise exception 'BILLING_CATALOG_OFFER_PRICE_IMMUTABLE'
        using errcode = '23514';
    end if;
    return new;
  end if;

  return new;
end;
$$;

comment on function private.billing_catalog_protect_commercial_history() is
  'WP-ASAAS-05A: impede UPDATE destrutivo de código/preço/limites/termos. '
  'Nova cotação = nova billing_plan_versions. SECURITY INVOKER. Sem RPC pública.';

revoke all on function private.billing_catalog_protect_commercial_history()
  from public, anon, authenticated, service_role;

create trigger billing_plans_protect_code
  before update on private.billing_plans
  for each row
  execute function private.billing_catalog_protect_commercial_history();

create trigger billing_plan_versions_protect_history
  before update on private.billing_plan_versions
  for each row
  execute function private.billing_catalog_protect_commercial_history();

create trigger billing_offers_protect_terms
  before update on private.billing_offers
  for each row
  execute function private.billing_catalog_protect_commercial_history();

create trigger billing_offer_plan_prices_protect_price
  before update on private.billing_offer_plan_prices
  for each row
  execute function private.billing_catalog_protect_commercial_history();


alter table private.billing_plans enable row level security;
alter table private.billing_plan_versions enable row level security;
alter table private.billing_features enable row level security;
alter table private.billing_plan_version_features enable row level security;
alter table private.billing_offers enable row level security;
alter table private.billing_offer_plan_prices enable row level security;

revoke all on table private.billing_plans from public, anon, authenticated, service_role;
revoke all on table private.billing_plan_versions from public, anon, authenticated, service_role;
revoke all on table private.billing_features from public, anon, authenticated, service_role;
revoke all on table private.billing_plan_version_features from public, anon, authenticated, service_role;
revoke all on table private.billing_offers from public, anon, authenticated, service_role;
revoke all on table private.billing_offer_plan_prices from public, anon, authenticated, service_role;


-- -------------------------------------------------------------------------------------
-- Seed canônico (LP atual). Mutação futura = nova migration, não cliente.
-- -------------------------------------------------------------------------------------

insert into private.billing_plans (code, display_name, sort_order, status)
values
  ('pulse', 'Pulse', 10, 'active'),
  ('sync', 'Sync', 20, 'active'),
  ('apex', 'Apex', 30, 'active');

insert into private.billing_plan_versions (
  plan_id,
  version,
  currency_code,
  standard_price_cents,
  max_professionals,
  max_active_patients,
  tagline,
  marketing_message
)
select p.id, 1, 'BRL', v.standard_price_cents, v.max_professionals, v.max_active_patients,
       v.tagline, v.marketing_message
  from private.billing_plans p
  join (
    values
      ('pulse', 39000, 2, 30,
       'O pulso constante entre você e seu paciente.',
       'Base do ecossistema.'),
      ('sync', 49700, 3, 50,
       'Sua equipe, em sincronia. Um paciente no centro.',
       null),
      ('apex', 146700, 3, 50,
       'O topo do acompanhamento.',
       'Para clínicas que não aceitam menos.')
  ) as v(code, standard_price_cents, max_professionals, max_active_patients, tagline, marketing_message)
    on v.code = p.code;

insert into private.billing_features (feature_key, display_name, sort_order)
values
  ('patient_dashboard', 'Painel de pacientes', 10),
  ('vri_score', 'Score VRI', 20),
  ('abandonment_risk_alerts', 'Alertas de risco de abandono', 30),
  ('retention_automation', 'Retenção automatizada (D+1, D+15, D+30)', 40),
  ('patient_app', 'App do paciente completo', 50),
  ('combined_training_nutrition', 'Treino e alimentar simultâneos, sem restrição', 60),
  ('daily_goals_gamification', 'Metas diárias + gamificação individual', 70),
  ('external_collaborator', 'Convite de colaborador externo por paciente', 80),
  ('whatsapp_support', 'Suporte por WhatsApp', 90),
  ('granular_permissions', 'Permissões granulares por papel', 100),
  ('revenue_projection', 'Receita projetada', 110),
  ('revenue_at_risk', 'Receita em risco', 120),
  ('body_recovery_map', 'Mapa de recuperação corporal por região', 130),
  ('multidisciplinary_chat', 'Chat com a equipe multiprofissional', 140),
  ('financial_bi', 'BI financeiro + comparativo mensal', 150),
  ('patient_challenges_ranking', 'Desafios e ranking entre pacientes', 160),
  ('clinic_branding', 'Marca da clínica em destaque', 170),
  ('centralized_team_management', 'Gestão de equipe centralizada', 180),
  ('professional_revenue_distribution', 'Distribuição de receita por profissional', 190),
  ('multidisciplinary_ecosystem', 'Ecossistema completo: médico + nutri + personal', 200),
  ('support_sla_4h', 'Suporte com SLA de resposta em 4h úteis', 210),
  ('guided_onboarding', 'Onboarding guiado completo (2 dias)', 220),
  ('white_label', 'Compartilhamento 100% white-label', 230);

insert into private.billing_plan_version_features (plan_version_id, feature_id)
select pv.id, f.id
  from private.billing_plan_versions pv
  join private.billing_plans p on p.id = pv.plan_id
  join private.billing_features f on f.feature_key in (
    'patient_dashboard',
    'vri_score',
    'abandonment_risk_alerts',
    'retention_automation',
    'patient_app',
    'combined_training_nutrition',
    'daily_goals_gamification',
    'external_collaborator',
    'whatsapp_support'
  )
 where p.code = 'pulse'
   and pv.version = 1;

insert into private.billing_plan_version_features (plan_version_id, feature_id)
select pv.id, f.id
  from private.billing_plan_versions pv
  join private.billing_plans p on p.id = pv.plan_id
  join private.billing_features f on f.feature_key in (
    'patient_dashboard',
    'vri_score',
    'abandonment_risk_alerts',
    'retention_automation',
    'patient_app',
    'combined_training_nutrition',
    'daily_goals_gamification',
    'external_collaborator',
    'whatsapp_support',
    'granular_permissions',
    'revenue_projection',
    'revenue_at_risk',
    'body_recovery_map',
    'multidisciplinary_chat',
    'financial_bi',
    'patient_challenges_ranking',
    'clinic_branding'
  )
 where p.code = 'sync'
   and pv.version = 1;

insert into private.billing_plan_version_features (plan_version_id, feature_id)
select pv.id, f.id
  from private.billing_plan_versions pv
  join private.billing_plans p on p.id = pv.plan_id
  join private.billing_features f on f.feature_key in (
    'patient_dashboard',
    'vri_score',
    'abandonment_risk_alerts',
    'retention_automation',
    'patient_app',
    'combined_training_nutrition',
    'daily_goals_gamification',
    'external_collaborator',
    'whatsapp_support',
    'granular_permissions',
    'revenue_projection',
    'revenue_at_risk',
    'body_recovery_map',
    'multidisciplinary_chat',
    'financial_bi',
    'patient_challenges_ranking',
    'clinic_branding',
    'centralized_team_management',
    'professional_revenue_distribution',
    'multidisciplinary_ecosystem',
    'support_sla_4h',
    'guided_onboarding',
    'white_label'
  )
 where p.code = 'apex'
   and pv.version = 1;

insert into private.billing_offers (
  code,
  display_name,
  status,
  total_slots,
  price_lock_months,
  future_adjustment_discount_bps,
  commercial_terms,
  starts_at,
  ends_at
) values (
  'founder_2026',
  'Founder 2026',
  'active',
  50,
  12,
  3000,
  '30% de desconto vitalício sobre reajustes futuros',
  null,
  null
);

insert into private.billing_offer_plan_prices (offer_id, plan_version_id, price_cents)
select o.id, pv.id, v.price_cents
  from private.billing_offers o
  cross join (
    values
      ('pulse', 24700),
      ('sync', 39000),
      ('apex', 89000)
  ) as v(code, price_cents)
  join private.billing_plans p on p.code = v.code
  join private.billing_plan_versions pv on pv.plan_id = p.id and pv.version = 1
 where o.code = 'founder_2026';


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260912174057',
  '20260912174057_wp_asaas_05a_commercial_catalog.sql',
  'WP-ASAAS-05A: catálogo comercial Vertexa (pulse/sync/apex + founder_2026). '
  'private, RLS ON, 0 policies, sem RPC pública, sem Asaas HTTP, sem claims, sem enforcement.',
  'WP-ASAAS-05A'
)
on conflict (version) do nothing;
