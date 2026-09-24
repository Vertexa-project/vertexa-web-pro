-- WP-ASAAS-04C · TESTES Nível 1 (BEGIN / DO / ROLLBACK). Sem valores de Vault.

begin;

do $t$
declare
  v_n int;
  v_others int;
begin
  -- T1: exatamente 1 job Vertexa com esse nome
  select count(*) into v_n from cron.job where jobname = 'vertexa-asaas-financial-drain';
  if v_n is distinct from 1 then
    raise exception 'ASAAS04C T1 FAIL: expected 1 vertexa-asaas-financial-drain, got %', v_n;
  end if;

  -- T2: não mexemos nos jobs existentes
  select count(*) into v_others
    from cron.job
   where jobname in ('wp-rls2-recovery-decay', 'wp-vri-recompute-daily');
  if v_others < 1 then
    raise notice 'ASAAS04C T2: jobs VRI/RLS2 ausentes neste banco local (ok se reset parcial)';
  end if;

  -- T3: schedule do job Vertexa
  if not exists (
    select 1 from cron.job
     where jobname = 'vertexa-asaas-financial-drain'
       and schedule = '* * * * *'
       and active
  ) then
    raise exception 'ASAAS04C T3 FAIL: job inativo ou schedule != * * * * *';
  end if;

  -- T4: invoke existe e anon/authenticated NÃO executam
  if not has_function_privilege('postgres', 'private.invoke_asaas_processor_cron()', 'execute') then
    raise exception 'ASAAS04C T4 FAIL: postgres sem execute no invoker';
  end if;
  if has_function_privilege('anon', 'private.invoke_asaas_processor_cron()', 'execute')
     or has_function_privilege('authenticated', 'private.invoke_asaas_processor_cron()', 'execute') then
    raise exception 'ASAAS04C T4 FAIL: client roles com execute no invoker';
  end if;

  -- T5: Vault decrypted — browser roles cannot SELECT. service_role is a
  -- trusted server role with full database access by Supabase design.
  if has_table_privilege('anon', 'vault.decrypted_secrets', 'select')
     or has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') then
    raise exception 'ASAAS04C T5 FAIL: client roles leem vault.decrypted_secrets';
  end if;

  -- T6: nenhuma RPC public devolve vault.decrypted_secrets
  if exists (
    select 1
     from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ilike '%vault.decrypted_secrets%'
  ) then
    raise exception 'ASAAS04C T6 FAIL: RPC public referencia vault.decrypted_secrets';
  end if;
end
$t$;

rollback;
