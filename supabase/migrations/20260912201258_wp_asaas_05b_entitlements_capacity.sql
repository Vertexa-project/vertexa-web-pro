-- =====================================================================================
-- WP-ASAAS-05B — foundation técnica: entitlements + usage + capacity.
--
-- ASAAS = verdade de fatos financeiros. Sem HTTP Asaas neste WP.
-- VERTEXA = verdade do produto. Este WP NÃO atribui plano comercial à clínica.
--
-- NÃO cria clinics.plan_id / plan_code / default Pulse / fallback.
-- NÃO altera create_patient / approve_join_request / assign_patient_professional.
-- NÃO cria RPC pública. NÃO esconde menu. NÃO reserva Founder. NÃO faz checkout.
-- NÃO altera billing_subscriptions.value_cents.
--
-- Features 05A continuam MARKETING CLAIMS. Entitlements aqui são só capacidades
-- técnicas reais. Claim sem produto NÃO vira entitlement (COMMERCIAL_IMPLEMENTATION_GAP).
--
-- Seat profissional = professionals.status='active' na clínica (owner conta 1x).
-- Seat paciente (billing) = COUNT DISTINCT patients.id da clínica com >=1
-- professional_patient_links.status='active' cujo professional.clinic_id
-- = patients.clinic_id = clínica alvo. Cross-clinic malformado NÃO conta.
-- =====================================================================================


create table private.billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  kind text not null,
  description text not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint billing_entitlements_key_format_check
    check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint billing_entitlements_key_trim_check
    check (btrim(key) = key and key <> ''),
  constraint billing_entitlements_kind_check
    check (kind = 'boolean'),
  constraint billing_entitlements_description_check
    check (btrim(description) <> ''),
  constraint billing_entitlements_status_check
    check (status in ('active', 'retired'))
);

comment on table private.billing_entitlements is
  'WP-ASAAS-05B: entitlement TÉCNICO. key estável. NÃO é claim de marketing 05A. '
  'Só existe se houver capacidade real de produto. Sem enforcement de clínica neste WP.';

comment on column private.billing_entitlements.key is
  'Chave técnica estável. Não reutilizar feature_key comercial sem auditoria.';

comment on column private.billing_entitlements.kind is
  'boolean apenas. Limites numéricos vivem em billing_plan_versions.';

create unique index billing_entitlements_key_uidx
  on private.billing_entitlements (key);


create table private.billing_plan_version_entitlements (
  plan_version_id uuid not null,
  entitlement_id uuid not null,
  enabled boolean not null,
  created_at timestamptz not null default now(),
  constraint billing_plan_version_entitlements_pkey
    primary key (plan_version_id, entitlement_id),
  constraint billing_plan_version_entitlements_version_fkey
    foreign key (plan_version_id) references private.billing_plan_versions(id) on delete restrict,
  constraint billing_plan_version_entitlements_entitlement_fkey
    foreign key (entitlement_id) references private.billing_entitlements(id) on delete restrict
);

comment on table private.billing_plan_version_entitlements is
  'WP-ASAAS-05B: estado final explícito por plan_version. Sem herança Pulse→Sync→Apex. '
  'Versão histórica continua avaliável se o plano-pai for retired.';

create index billing_plan_version_entitlements_entitlement_id_idx
  on private.billing_plan_version_entitlements (entitlement_id);


create table private.billing_feature_entitlement_map (
  feature_id uuid not null,
  entitlement_id uuid not null,
  created_at timestamptz not null default now(),
  constraint billing_feature_entitlement_map_pkey
    primary key (feature_id),
  constraint billing_feature_entitlement_map_feature_fkey
    foreign key (feature_id) references private.billing_features(id) on delete restrict,
  constraint billing_feature_entitlement_map_entitlement_fkey
    foreign key (entitlement_id) references private.billing_entitlements(id) on delete restrict
);

comment on table private.billing_feature_entitlement_map is
  'WP-ASAAS-05B: claim comercial 05A → entitlement técnico, no máximo 1. '
  'Ausência de linha = claim sem gate técnico (operacional, marketing ou gap).';

create index billing_feature_entitlement_map_entitlement_id_idx
  on private.billing_feature_entitlement_map (entitlement_id);


-- Live usage. Sem counter cache. Sem PII. Sem preço. Sem Asaas.
create view private.billing_clinic_usage
with (security_invoker = true) as
select
  c.id as clinic_id,
  (
    select count(*)::integer
      from public.professionals pr
     where pr.clinic_id = c.id
       and pr.status = 'active'
  ) as active_professionals,
  (
    select count(distinct pat.id)::integer
      from public.patients pat
      join public.professional_patient_links l
        on l.patient_id = pat.id
       and l.status = 'active'
      join public.professionals pr
        on pr.id = l.professional_id
       and pr.clinic_id = pat.clinic_id
     where pat.clinic_id = c.id
  ) as active_patients
from public.clinics c;

comment on view private.billing_clinic_usage is
  'WP-ASAAS-05B: usage ao vivo. active_professionals = professionals.status=active. '
  'active_patients = DISTINCT patient da clínica com >=1 link ativo same-clinic. '
  'Link cross-clinic é ignorado. Sem preço, PII ou Asaas.';


create or replace function private.billing_evaluate_clinic_capacity(
  p_clinic_id uuid,
  p_plan_version_id uuid
)
returns table (
  clinic_id uuid,
  plan_version_id uuid,
  active_professionals integer,
  max_professionals integer,
  professional_slots_remaining integer,
  can_add_professional boolean,
  professionals_over_limit boolean,
  active_patients integer,
  max_active_patients integer,
  patient_slots_remaining integer,
  can_activate_patient boolean,
  patients_over_limit boolean,
  over_limit boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_version uuid;
  v_max_p integer;
  v_max_a integer;
  v_use_p integer;
  v_use_a integer;
begin
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023';
  end if;
  if p_plan_version_id is null then
    raise exception 'BILLING_PLAN_VERSION_REQUIRED'
      using errcode = '22023';
  end if;

  select c.id into v_clinic
    from public.clinics c
   where c.id = p_clinic_id;
  if v_clinic is null then
    raise exception 'BILLING_CLINIC_UNKNOWN'
      using errcode = 'P0002';
  end if;

  -- NÃO filtra billing_plans.status: versão histórica de plano retired continua válida.
  -- NÃO escolhe Pulse/default se a versão for desconhecida.
  select pv.id, pv.max_professionals, pv.max_active_patients
    into v_version, v_max_p, v_max_a
    from private.billing_plan_versions pv
   where pv.id = p_plan_version_id;
  if v_version is null then
    raise exception 'BILLING_PLAN_VERSION_UNKNOWN'
      using errcode = 'P0002';
  end if;

  select u.active_professionals, u.active_patients
    into v_use_p, v_use_a
    from private.billing_clinic_usage u
   where u.clinic_id = p_clinic_id;

  v_use_p := coalesce(v_use_p, 0);
  v_use_a := coalesce(v_use_a, 0);

  return query select
    p_clinic_id,
    v_version,
    v_use_p,
    v_max_p,
    greatest(0, v_max_p - v_use_p),
    (v_use_p < v_max_p),
    (v_use_p > v_max_p),
    v_use_a,
    v_max_a,
    greatest(0, v_max_a - v_use_a),
    (v_use_a < v_max_a),
    (v_use_a > v_max_a),
    (v_use_p > v_max_p or v_use_a > v_max_a);
end;
$$;

comment on function private.billing_evaluate_clinic_capacity(uuid, uuid) is
  'WP-ASAAS-05B: compara usage ao vivo com plan_version_id EXPLÍCITO. '
  'Sem default Pulse. Sem RPC pública. usage>=limit ⇒ can_add false. '
  'usage>limit ⇒ over_limit, remaining=0, sem mutar entidades. '
  'SECURITY INVOKER. Execute revogado de anon/authenticated/service_role.';


create or replace function private.billing_resolve_plan_entitlements(
  p_plan_version_id uuid
)
returns table (
  entitlement_key text,
  kind text,
  enabled boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_plan_version_id is null then
    raise exception 'BILLING_PLAN_VERSION_REQUIRED'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from private.billing_plan_versions pv
     where pv.id = p_plan_version_id
  ) then
    raise exception 'BILLING_PLAN_VERSION_UNKNOWN'
      using errcode = 'P0002';
  end if;

  return query
    select e.key, e.kind, pve.enabled
      from private.billing_entitlements e
      join private.billing_plan_version_entitlements pve
        on pve.entitlement_id = e.id
     where pve.plan_version_id = p_plan_version_id
     order by e.key;
end;
$$;

comment on function private.billing_resolve_plan_entitlements(uuid) is
  'WP-ASAAS-05B: resolve entitlements técnicos de uma plan_version explícita. '
  'Sem clínica, sem frontend, sem RPC pública. SECURITY INVOKER.';


create index if not exists billing_05b_professionals_clinic_active_idx
  on public.professionals (clinic_id)
  where status = 'active';

create index if not exists billing_05b_patients_clinic_idx
  on public.patients (clinic_id);

create index if not exists billing_05b_ppl_patient_active_idx
  on public.professional_patient_links (patient_id)
  where status = 'active';


alter table private.billing_entitlements enable row level security;
alter table private.billing_plan_version_entitlements enable row level security;
alter table private.billing_feature_entitlement_map enable row level security;

revoke all on table private.billing_entitlements
  from public, anon, authenticated, service_role;
revoke all on table private.billing_plan_version_entitlements
  from public, anon, authenticated, service_role;
revoke all on table private.billing_feature_entitlement_map
  from public, anon, authenticated, service_role;
revoke all on table private.billing_clinic_usage
  from public, anon, authenticated, service_role;

revoke all on function private.billing_evaluate_clinic_capacity(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.billing_resolve_plan_entitlements(uuid)
  from public, anon, authenticated, service_role;


-- -------------------------------------------------------------------------------------
-- Seed: só entitlements com superfície técnica real. Estado final por versão.
-- -------------------------------------------------------------------------------------

insert into private.billing_entitlements (key, kind, description, status)
values
  ('patient_dashboard', 'boolean',
   'Painel/lista de pacientes da clínica.', 'active'),
  ('vri_score', 'boolean',
   'Score VRI / adherence_snapshots.', 'active'),
  ('abandonment_risk_alerts', 'boolean',
   'Superfície de retenção / risco de abandono.', 'active'),
  ('combined_training_nutrition', 'boolean',
   'Planos de treino e nutricional no mesmo produto.', 'active'),
  ('daily_goals_gamification', 'boolean',
   'Metas/hábitos e conquistas persistidas.', 'active'),
  ('external_collaborator', 'boolean',
   'Vínculo profissional_patient_links.is_external.', 'active'),
  ('body_recovery_map', 'boolean',
   'Mapa de recuperação muscular por região.', 'active'),
  ('multidisciplinary_chat', 'boolean',
   'Chat da equipe no contexto do paciente.', 'active'),
  ('centralized_team_management', 'boolean',
   'Administração de equipe da clínica.', 'active');

insert into private.billing_plan_version_entitlements (plan_version_id, entitlement_id, enabled)
select pv.id, e.id,
       e.key in (
         'patient_dashboard',
         'vri_score',
         'abandonment_risk_alerts',
         'combined_training_nutrition',
         'daily_goals_gamification',
         'external_collaborator'
       )
  from private.billing_plan_versions pv
  join private.billing_plans p on p.id = pv.plan_id
  cross join private.billing_entitlements e
 where p.code = 'pulse'
   and pv.version = 1;

insert into private.billing_plan_version_entitlements (plan_version_id, entitlement_id, enabled)
select pv.id, e.id,
       e.key in (
         'patient_dashboard',
         'vri_score',
         'abandonment_risk_alerts',
         'combined_training_nutrition',
         'daily_goals_gamification',
         'external_collaborator',
         'body_recovery_map',
         'multidisciplinary_chat'
       )
  from private.billing_plan_versions pv
  join private.billing_plans p on p.id = pv.plan_id
  cross join private.billing_entitlements e
 where p.code = 'sync'
   and pv.version = 1;

insert into private.billing_plan_version_entitlements (plan_version_id, entitlement_id, enabled)
select pv.id, e.id, true
  from private.billing_plan_versions pv
  join private.billing_plans p on p.id = pv.plan_id
  cross join private.billing_entitlements e
 where p.code = 'apex'
   and pv.version = 1;

insert into private.billing_feature_entitlement_map (feature_id, entitlement_id)
select f.id, e.id
  from private.billing_features f
  join private.billing_entitlements e on e.key = f.feature_key
 where f.feature_key in (
   'patient_dashboard',
   'vri_score',
   'abandonment_risk_alerts',
   'combined_training_nutrition',
   'daily_goals_gamification',
   'external_collaborator',
   'body_recovery_map',
   'multidisciplinary_chat',
   'centralized_team_management'
 );


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260912201258',
  '20260912201258_wp_asaas_05b_entitlements_capacity.sql',
  'WP-ASAAS-05B: entitlements técnicos, usage ao vivo, evaluator de capacity '
  'contra plan_version explícito. private, RLS ON, 0 policies, sem RPC pública, '
  'sem plano em clínica, sem enforcement de produto, sem Asaas HTTP.',
  'WP-ASAAS-05B'
)
on conflict (version) do nothing;
