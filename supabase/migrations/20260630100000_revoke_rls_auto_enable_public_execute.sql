-- VERTEXA — Hardening: revoga execute público em rls_auto_enable() (Supabase-native).
-- Contexto: get_advisors (security) sinaliza que public.rls_auto_enable() é SECURITY DEFINER
-- e executável por anon/authenticated (Postgres concede EXECUTE to PUBLIC por padrão p/ toda
-- função nova). A função é um event trigger nativo do Supabase (liga RLS em tabelas novas em
-- public); não é criada pelas nossas migrations, mas o aviso de segurança é válido — SECURITY
-- DEFINER + callable por anon = superfície desnecessária.
-- O bloco DO ignora OTHERS porque: (a) o owner pode não ser `postgres` neste projeto, (b) a
-- função pode mudar de nome numa versão futura do Supabase; falhar silenciosamente é correto aqui.
do $$
begin
  -- anon/authenticated herdam de PUBLIC; o grant real está em PUBLIC (=X/postgres).
  -- Revogar de PUBLIC remove o acesso para ambas sem revogar de postgres/service_role.
  revoke execute on function public.rls_auto_enable() from public;
exception when others then
  raise notice 'skip revoke rls_auto_enable: %', sqlerrm;
end $$;
