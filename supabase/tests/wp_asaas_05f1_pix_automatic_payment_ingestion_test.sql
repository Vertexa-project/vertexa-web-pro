-- WP-ASAAS-05F1-R4 — SQL contract for Pix Automatic payment ingestion.
-- Requires the canonical 05F1 migration to be applied.

do $$
declare
  r jsonb;
  v_src text;
begin
  if to_regprocedure('private.resolve_billing_target_by_pix_automatic_payment(text,text,text,text,text,text)') is null
     or to_regprocedure('private.apply_billing_pix_automatic_payment_snapshot(uuid,text,text,text,text,text,uuid,uuid,text,text,text,bigint,bigint,bigint,date,date,date,text,timestamptz)') is null
     or to_regprocedure('private.requeue_ignored_billing_provider_event(uuid)') is null then
    raise exception 'ASAAS05F1 proposed functions missing — apply proposed migration locally first';
  end if;

  if to_regprocedure('private.resolve_billing_target_by_pix_automatic_payment(text,text,text,text,text)') is not null then
    raise exception 'ASAAS05F1 stale 5-arg resolve must be dropped';
  end if;

  if has_function_privilege('anon', 'private.resolve_billing_target_by_pix_automatic_payment(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'private.resolve_billing_target_by_pix_automatic_payment(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('public', 'private.resolve_billing_target_by_pix_automatic_payment(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.requeue_ignored_billing_provider_event(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.requeue_ignored_billing_provider_event(uuid)', 'execute') then
    raise exception 'ASAAS05F1 resolve/requeue must not be executable by browser roles';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'private'
       and indexname = 'billing_pix_automatic_authorizations_conciliation_uidx'
  ) then
    raise exception 'ASAAS05F1 conciliation unique index missing';
  end if;

  v_src := pg_get_functiondef(
    'private.resolve_billing_target_by_pix_automatic_payment(text,text,text,text,text,text)'::regprocedure
  );
  if v_src ~* 'is_primary' then
    raise exception 'ASAAS05F1 resolve must not use is_primary as correlation';
  end if;
  if v_src !~* 'conciliation_identifier' then
    raise exception 'ASAAS05F1 resolve must correlate by conciliation_identifier';
  end if;
  if v_src ~* 'customer_mismatch' then
    raise exception 'ASAAS05F1 resolve must not reject deterministic match on customer_mismatch';
  end if;

  r := private.resolve_billing_target_by_pix_automatic_payment(
    'asaas', 'sandbox', '', 'cus_x', null, null
  );
  if r->>'found' is distinct from 'false' then
    raise exception 'ASAAS05F1 empty payment id must be found=false: %', r;
  end if;

  r := private.resolve_billing_target_by_pix_automatic_payment(
    'asaas', 'sandbox', 'pay_unmanaged', 'cus_x', null, null
  );
  if r->>'found' is distinct from 'false' or r ? 'reason' then
    raise exception 'ASAAS05F1 unmanaged without deterministic id must be found=false: %', r;
  end if;

  r := private.resolve_billing_target_by_pix_automatic_payment(
    'asaas', 'sandbox', 'pay_unmanaged', 'cus_x', null, 'conciliation-does-not-exist'
  );
  if r->>'found' is distinct from 'false' or r->>'reason' is distinct from 'conciliation_unmatched' then
    raise exception 'ASAAS05F1 unknown conciliation must fail closed: %', r;
  end if;
end $$;
