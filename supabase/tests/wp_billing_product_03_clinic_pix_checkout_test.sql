-- WP-BILLING-PRODUCT-03 local/static SQL contract.
-- NOT a remote apply. Uses BEGIN/ROLLBACK when executed against a schema that has BP03.

begin;

do $$
declare
  v_src text;
begin
  select pg_get_functiondef('public.prepare_my_clinic_pix_automatic_authorization(uuid)'::regprocedure)
    into v_src;
  if v_src is null then
    raise exception 'BP03 prepare missing';
  end if;
  if v_src !~ 'private.is_clinic_admin' then
    raise exception 'BP03 prepare must require clinic admin';
  end if;
  -- PREPROD-02 resolves the provider environment from the clinic's persisted
  -- billing account and guarded write mode. A public checkout must not force
  -- sandbox, or it could mix a production-account clinic with Sandbox facts.
  if v_src !~ 'private.billing_clinic_provider_environment' then
    raise exception 'BP03 prepare must resolve the clinic provider environment';
  end if;
  if v_src ~ 'billing_prepare_pix_automatic_authorization\\(v_contract_id, ''sandbox''\\)' then
    raise exception 'BP03 prepare must not force sandbox';
  end if;
  if v_src ~* 'qr_payload|encoded_image|payload' then
    raise exception 'BP03 prepare must not persist QR';
  end if;

  select pg_get_functiondef('public.reissue_my_clinic_pix_automatic_authorization(uuid,text)'::regprocedure)
    into v_src;
  if v_src !~ 'clinic_admin' then
    raise exception 'BP03 clinic reissue must record clinic_admin authority';
  end if;
  if v_src !~ 'REFUSED' then
    raise exception 'BP03 clinic reissue must require REFUSED';
  end if;

  if to_regprocedure('public.billing_load_provider_customer_context_outbound(uuid)') is null then
    raise exception 'BP03 identity loader missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'private'
       and table_name in (
         'billing_pix_automatic_authorizations',
         'billing_outbound_operations',
         'billing_provider_events'
       )
       and column_name ~* 'qr_payload|pix_payload|encoded_image|copia'
  ) then
    raise exception 'QR persistence column found';
  end if;
end;
$$;

rollback;
