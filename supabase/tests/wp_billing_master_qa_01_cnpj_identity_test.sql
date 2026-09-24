-- Run only against a disposable local/test database after the QA-01 migration.
begin;

do $$
begin
  if private.billing_normalize_tax_id('12.abc.345/01de-35') is distinct from '12ABC34501DE35' then
    raise exception 'BILLING_MASTER_QA_01 FAIL: CNPJ alpha normalization';
  end if;
  if private.billing_tax_id_is_valid('12.ABC.345/01DE-35') is not true then
    raise exception 'BILLING_MASTER_QA_01 FAIL: official alpha algorithm fixture rejected';
  end if;
  if private.billing_tax_id_is_valid('12.ABC.345/01DE-34') is not false
     or private.billing_tax_id_is_valid('12.ABC.345/01D!-35') is not false
     or private.billing_tax_id_is_valid('12ABC34501DE3A') is not false then
    raise exception 'BILLING_MASTER_QA_01 FAIL: malformed CNPJ accepted';
  end if;
  if private.billing_tax_id_is_valid('11222333000181') is not true
     or private.billing_tax_id_is_valid('11222333000180') is not false then
    raise exception 'BILLING_MASTER_QA_01 FAIL: legacy CNPJ regression';
  end if;
  if private.billing_tax_id_is_valid('99991111140') is not true
     or private.billing_tax_id_is_valid('11111111111') is not false then
    raise exception 'BILLING_MASTER_QA_01 FAIL: CPF regression';
  end if;
  if private.billing_normalize_phone('+55 (98) 99999-9999') is distinct from '98999999999'
     or private.billing_mobile_phone_is_valid('+55 (98) 99999-9999') is not true
     or private.billing_mobile_phone_is_valid('(10) 89999-9999') is not false then
    raise exception 'BILLING_MASTER_QA_01 FAIL: Brazilian mobile normalization';
  end if;
end;
$$;

rollback;
