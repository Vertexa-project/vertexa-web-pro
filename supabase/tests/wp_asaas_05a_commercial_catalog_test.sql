-- =====================================================================================
-- WP-ASAAS-05A · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260912174057 aplicada.
-- Anon = has_*_privilege (sem SET ROLE anon — isolador PG 17.6 SIGSEGV).
-- =====================================================================================

-- T1: tabelas private, RLS ON, 0 policies
begin;
do $$
declare
  v_n int;
  v_rls boolean;
  v_rel text;
begin
  if to_regclass('private.billing_plans') is null
     or to_regclass('private.billing_plan_versions') is null
     or to_regclass('private.billing_features') is null
     or to_regclass('private.billing_plan_version_features') is null
     or to_regclass('private.billing_offers') is null
     or to_regclass('private.billing_offer_plan_prices') is null then
    raise exception 'ASAAS05A T1 FAIL: tabela de catálogo ausente';
  end if;

  foreach v_rel in array array[
    'billing_plans',
    'billing_plan_versions',
    'billing_features',
    'billing_plan_version_features',
    'billing_offers',
    'billing_offer_plan_prices'
  ] loop
    select c.relrowsecurity into v_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'private' and c.relname = v_rel;
    if v_rls is not true then
      raise exception 'ASAAS05A T1 FAIL: RLS off em %', v_rel;
    end if;
  end loop;

  select count(*) into v_n
    from pg_policies
   where schemaname = 'private'
     and tablename in (
       'billing_plans',
       'billing_plan_versions',
       'billing_features',
       'billing_plan_version_features',
       'billing_offers',
       'billing_offer_plan_prices'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05A T1 FAIL: policies=%', v_n;
  end if;
end $$;
rollback;

-- T2: authenticated / anon / service_role sem table priv no catálogo
begin;
do $$
declare
  v_rel text;
begin
  foreach v_rel in array array[
    'private.billing_plans',
    'private.billing_plan_versions',
    'private.billing_features',
    'private.billing_plan_version_features',
    'private.billing_offers',
    'private.billing_offer_plan_prices'
  ] loop
    if has_table_privilege('authenticated', v_rel, 'select')
       or has_table_privilege('authenticated', v_rel, 'insert')
       or has_table_privilege('authenticated', v_rel, 'update')
       or has_table_privilege('authenticated', v_rel, 'delete') then
      raise exception 'ASAAS05A T2 FAIL: authenticated priv em %', v_rel;
    end if;
    if has_table_privilege('anon', v_rel, 'select')
       or has_table_privilege('anon', v_rel, 'insert')
       or has_table_privilege('anon', v_rel, 'update') then
      raise exception 'ASAAS05A T2 FAIL: anon priv em %', v_rel;
    end if;
    if has_table_privilege('service_role', v_rel, 'select')
       or has_table_privilege('service_role', v_rel, 'insert')
       or has_table_privilege('service_role', v_rel, 'update')
       or has_table_privilege('service_role', v_rel, 'delete') then
      raise exception 'ASAAS05A T2 FAIL: service_role table priv em %', v_rel;
    end if;
  end loop;
end $$;
rollback;

-- T3: exatamente 3 planos ativos pulse/sync/apex
begin;
do $$
declare
  v_n int;
  v_codes text[];
begin
  select count(*) into v_n from private.billing_plans where status = 'active';
  if v_n <> 3 then
    raise exception 'ASAAS05A T3 FAIL: active plans=%', v_n;
  end if;
  select array_agg(code order by sort_order) into v_codes
    from private.billing_plans
   where status = 'active';
  if v_codes is distinct from array['pulse', 'sync', 'apex']::text[] then
    raise exception 'ASAAS05A T3 FAIL: codes=%', v_codes;
  end if;
end $$;
rollback;

-- T4 / T6 / T7: preços standard, limites, BRL
begin;
do $$
declare
  r record;
begin
  for r in
    select p.code, pv.currency_code, pv.standard_price_cents,
           pv.max_professionals, pv.max_active_patients, pv.version
      from private.billing_plan_versions pv
      join private.billing_plans p on p.id = pv.plan_id
     where pv.version = 1
  loop
    if r.currency_code is distinct from 'BRL' then
      raise exception 'ASAAS05A T7 FAIL: currency % = %', r.code, r.currency_code;
    end if;
    if r.code = 'pulse' then
      if r.standard_price_cents <> 39000 or r.max_professionals <> 2 or r.max_active_patients <> 30 then
        raise exception 'ASAAS05A T4/T6 FAIL: pulse std/limits';
      end if;
    elsif r.code = 'sync' then
      if r.standard_price_cents <> 49700 or r.max_professionals <> 3 or r.max_active_patients <> 50 then
        raise exception 'ASAAS05A T4/T6 FAIL: sync std/limits';
      end if;
    elsif r.code = 'apex' then
      if r.standard_price_cents <> 146700 or r.max_professionals <> 3 or r.max_active_patients <> 50 then
        raise exception 'ASAAS05A T4/T6 FAIL: apex std/limits';
      end if;
    else
      raise exception 'ASAAS05A T4 FAIL: unexpected plan %', r.code;
    end if;
  end loop;
end $$;
rollback;

-- T5 / T8: Founder 2026 — preços, 50 slots, 12 meses, 3000 bps
begin;
do $$
declare
  v_slots int;
  v_lock int;
  v_bps int;
  v_status text;
  v_terms text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_n int;
  r record;
begin
  select total_slots, price_lock_months, future_adjustment_discount_bps,
         status, commercial_terms, starts_at, ends_at
    into v_slots, v_lock, v_bps, v_status, v_terms, v_starts, v_ends
    from private.billing_offers
   where code = 'founder_2026';

  if v_slots <> 50 or v_lock <> 12 or v_bps <> 3000 then
    raise exception 'ASAAS05A T8 FAIL: slots=% lock=% bps=%', v_slots, v_lock, v_bps;
  end if;
  if v_status is distinct from 'active' then
    raise exception 'ASAAS05A T8 FAIL: status=%', v_status;
  end if;
  if v_terms is distinct from '30% de desconto vitalício sobre reajustes futuros' then
    raise exception 'ASAAS05A T8 FAIL: commercial_terms adulterado';
  end if;
  if v_starts is not null or v_ends is not null then
    raise exception 'ASAAS05A T8 FAIL: janela inventada starts=% ends=%', v_starts, v_ends;
  end if;

  select count(*) into v_n
    from private.billing_offer_plan_prices opp
    join private.billing_offers o on o.id = opp.offer_id
   where o.code = 'founder_2026';
  if v_n <> 3 then
    raise exception 'ASAAS05A T5 FAIL: founder prices=%', v_n;
  end if;

  for r in
    select p.code, opp.price_cents
      from private.billing_offer_plan_prices opp
      join private.billing_offers o on o.id = opp.offer_id
      join private.billing_plan_versions pv on pv.id = opp.plan_version_id
      join private.billing_plans p on p.id = pv.plan_id
     where o.code = 'founder_2026'
  loop
    if r.code = 'pulse' and r.price_cents <> 24700 then
      raise exception 'ASAAS05A T5 FAIL: pulse founder=%', r.price_cents;
    elsif r.code = 'sync' and r.price_cents <> 39000 then
      raise exception 'ASAAS05A T5 FAIL: sync founder=%', r.price_cents;
    elsif r.code = 'apex' and r.price_cents <> 89000 then
      raise exception 'ASAAS05A T5 FAIL: apex founder=%', r.price_cents;
    end if;
  end loop;
end $$;
rollback;

-- T9: features — estado final explícito (Pulse 9 / Sync 17 / Apex 23)
begin;
do $$
declare
  v_n int;
  v_missing int;
begin
  select count(*) into v_n from private.billing_features;
  if v_n <> 23 then
    raise exception 'ASAAS05A T9 FAIL: features=%', v_n;
  end if;

  select count(*) into v_n
    from private.billing_plan_version_features pvf
    join private.billing_plan_versions pv on pv.id = pvf.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
  if v_n <> 9 then
    raise exception 'ASAAS05A T9 FAIL: pulse features=%', v_n;
  end if;

  select count(*) into v_n
    from private.billing_plan_version_features pvf
    join private.billing_plan_versions pv on pv.id = pvf.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;
  if v_n <> 17 then
    raise exception 'ASAAS05A T9 FAIL: sync features=%', v_n;
  end if;

  select count(*) into v_n
    from private.billing_plan_version_features pvf
    join private.billing_plan_versions pv on pv.id = pvf.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'apex' and pv.version = 1;
  if v_n <> 23 then
    raise exception 'ASAAS05A T9 FAIL: apex features=%', v_n;
  end if;

  select count(*) into v_missing
    from (
      values
        ('white_label'),
        ('support_sla_4h'),
        ('guided_onboarding'),
        ('centralized_team_management')
    ) as extra(feature_key)
    where not exists (
      select 1
        from private.billing_plan_version_features pvf
        join private.billing_plan_versions pv on pv.id = pvf.plan_version_id
        join private.billing_plans p on p.id = pv.plan_id
        join private.billing_features f on f.id = pvf.feature_id
       where p.code = 'apex' and pv.version = 1 and f.feature_key = extra.feature_key
    );
  if v_missing <> 0 then
    raise exception 'ASAAS05A T9 FAIL: apex missing extras';
  end if;

  select count(*) into v_n
    from private.billing_plan_version_features pvf
    join private.billing_plan_versions pv on pv.id = pvf.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
    join private.billing_features f on f.id = pvf.feature_id
   where p.code = 'pulse' and f.feature_key = 'white_label';
  if v_n <> 0 then
    raise exception 'ASAAS05A T9 FAIL: pulse não deve ter white_label';
  end if;
end $$;
rollback;

-- T10: sem RPC pública de catálogo
begin;
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname ~* '(billing_plan|billing_offer|billing_feature|commercial_catalog)';
  if v_n <> 0 then
    raise exception 'ASAAS05A T10 FAIL: RPC pública de catálogo=%', v_n;
  end if;
end $$;
rollback;

-- T11: duplicate plan code falha
begin;
do $$
declare
  v_ok boolean := false;
begin
  begin
    insert into private.billing_plans (code, display_name, sort_order, status)
    values ('pulse', 'Pulse Dup', 99, 'active');
  exception
    when unique_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T11 FAIL: duplicate code aceito';
  end if;
end $$;
rollback;

-- T12: preço negativo falha
begin;
do $$
declare
  v_ok boolean := false;
  v_plan uuid;
begin
  select id into v_plan from private.billing_plans where code = 'pulse';
  begin
    insert into private.billing_plan_versions (
      plan_id, version, currency_code, standard_price_cents,
      max_professionals, max_active_patients
    ) values (v_plan, 99, 'BRL', -1, 2, 30);
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T12 FAIL: preço negativo aceito';
  end if;
end $$;
rollback;

-- T13: discount bps inválido falha
begin;
do $$
declare
  v_ok boolean := false;
begin
  begin
    insert into private.billing_offers (
      code, display_name, status, total_slots, price_lock_months,
      future_adjustment_discount_bps, commercial_terms
    ) values (
      'bad_bps', 'Bad', 'configured', 1, 1, 10001, 'x'
    );
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T13 FAIL: bps 10001 aceito';
  end if;
end $$;
rollback;

-- T14: nova versão NÃO destrói a anterior
begin;
do $$
declare
  v_plan uuid;
  v_old int;
  v_new int;
  v_n int;
begin
  select id into v_plan from private.billing_plans where code = 'pulse';
  select standard_price_cents into v_old
    from private.billing_plan_versions
   where plan_id = v_plan and version = 1;

  insert into private.billing_plan_versions (
    plan_id, version, currency_code, standard_price_cents,
    max_professionals, max_active_patients
  ) values (v_plan, 2, 'BRL', 30000, 2, 30);

  select standard_price_cents into v_new
    from private.billing_plan_versions
   where plan_id = v_plan and version = 1;
  if v_new is distinct from v_old or v_old <> 39000 then
    raise exception 'ASAAS05A T14 FAIL: v1 destruída old=% now=%', v_old, v_new;
  end if;

  select count(*) into v_n
    from private.billing_plan_versions
   where plan_id = v_plan;
  if v_n <> 2 then
    raise exception 'ASAAS05A T14 FAIL: versions=%', v_n;
  end if;
end $$;
rollback;

-- T15: UPDATE destrutivo de preço histórico falha
begin;
do $$
declare
  v_ok boolean := false;
begin
  begin
    update private.billing_plan_versions
       set standard_price_cents = 1
     where plan_id = (select id from private.billing_plans where code = 'pulse')
       and version = 1;
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T15 FAIL: rewrite de preço aceito';
  end if;
  if exists (
    select 1
      from private.billing_plan_versions pv
      join private.billing_plans p on p.id = pv.plan_id
     where p.code = 'pulse' and pv.version = 1 and pv.standard_price_cents <> 39000
  ) then
    raise exception 'ASAAS05A T15 FAIL: preço pulse v1 alterado';
  end if;
end $$;
rollback;

-- T16: catálogo sem colunas Asaas / external
begin;
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private'
     and table_name in (
       'billing_plans',
       'billing_plan_versions',
       'billing_features',
       'billing_plan_version_features',
       'billing_offers',
       'billing_offer_plan_prices'
     )
     and (
       column_name ~* '(asaas|external_|provider)'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05A T16 FAIL: coluna de provedor no catálogo';
  end if;
end $$;
rollback;

-- T17: clinics sem plan/price; subscriptions sem plan_code de catálogo
begin;
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'clinics'
     and column_name in ('plan', 'plan_name', 'asaas_plan', 'price');
  if v_n <> 0 then
    raise exception 'ASAAS05A T17 FAIL: clinics ganhou coluna de plano';
  end if;

  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private'
     and table_name = 'billing_subscriptions'
     and column_name in (
       'plan_id', 'plan_code', 'catalog_plan_version_id',
       'contracted_price_cents', 'commercial_offer_id'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05A T17 FAIL: subscriptions alterada neste WP';
  end if;
end $$;
rollback;

-- T18: source='asaas' permanece 0; sem tabela de claim Founder
begin;
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from private.clinic_creation_authorizations
   where source = 'asaas';
  if v_n <> 0 then
    raise exception 'ASAAS05A T18 FAIL: grant source=asaas=%', v_n;
  end if;

  if to_regclass('private.billing_offer_claims') is not null
     or to_regclass('private.billing_founder_claims') is not null
     or to_regclass('public.billing_offer_claims') is not null then
    raise exception 'ASAAS05A T18 FAIL: tabela de claim criada neste WP';
  end if;
end $$;
rollback;

-- T19: unique offer+version; slots/lock inválidos
begin;
do $$
declare
  v_ok boolean := false;
  v_offer uuid;
  v_version uuid;
begin
  select o.id, opp.plan_version_id
    into v_offer, v_version
    from private.billing_offer_plan_prices opp
    join private.billing_offers o on o.id = opp.offer_id
   where o.code = 'founder_2026'
   limit 1;

  begin
    insert into private.billing_offer_plan_prices (offer_id, plan_version_id, price_cents)
    values (v_offer, v_version, 1);
  exception
    when unique_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T19 FAIL: duplicate offer-version aceito';
  end if;

  v_ok := false;
  begin
    insert into private.billing_offers (
      code, display_name, status, total_slots, price_lock_months,
      future_adjustment_discount_bps, commercial_terms
    ) values ('zero_slots', 'Z', 'configured', 0, 1, 0, 'x');
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T19 FAIL: total_slots=0 aceito';
  end if;
end $$;
rollback;

-- T20: feature_key duplicada falha
begin;
do $$
declare
  v_ok boolean := false;
begin
  begin
    insert into private.billing_features (feature_key, display_name, sort_order)
    values ('vri_score', 'dup', 9999);
  exception
    when unique_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05A T20 FAIL: duplicate feature_key aceito';
  end if;
end $$;
rollback;

do $$
begin
  raise notice 'ASAAS05A_SQL_ASSERTIONS_PASSED';
end $$;
