-- =====================================================================================
-- WP-HARDENING · A4(b) — DROP das 3 funções DEMO residuais em public.
-- A demo (Mariana) foi DESCARTADA no WP05a (20260710090000_wp05a_purge_demo_data), que apagou os
-- DADOS mas manteve as FUNÇÕES como "estrutura" (Fase A). Agora que a demo não volta, as funções
-- saem — elas aparecem nos advisors (0011 function_search_path_mutable: search_path mutável).
--
-- PROVA de que é seguro dropar (auditado neste WP):
--   · Nenhuma referência no client: grep por refresh_demo_mariana* em vertexa-web-pro/src e
--     vertexa-app-paciente = ZERO (só aparecem nas próprias migrations de seed + docs).
--   · Sem dependentes no banco: pg_depend (deptype n/a) = 0 para as 3 (nenhum trigger/view/rotina
--     viva depende delas).
--   · EXECUTE já revogado de public/anon/authenticated desde a criação (só service_role/MCP as usava
--     no ritual de demo, agora extinto).
--
-- Remove também os 3 WARN de search_path mutável dos advisors.
--
-- ROLLBACK (recria os corpos originais — só faria sentido se a demo voltasse):
--   ver supabase/migrations/20260702130000_seed_demo_mariana_streak_convergence.sql
--       supabase/migrations/20260702250000_seed_demo_mariana_workout_execution.sql
-- =====================================================================================

drop function if exists public.refresh_demo_mariana();
drop function if exists public.refresh_demo_mariana_streak();
drop function if exists public.refresh_demo_mariana_workout_execution();

insert into public.schema_migration_log (version, filename, description, session)
values ('20260723091000','20260723091000_wp_hardening_a4b_drop_demo_functions.sql',
  'WP-HARDENING A4b: DROP das 3 funcoes demo residuais (refresh_demo_mariana, _streak, '
  '_workout_execution). Demo descartada no WP05a; funcoes sem uso no client (grep=0) e sem '
  'dependentes (pg_depend=0). Resolve 3 WARN function_search_path_mutable dos advisors.',
  'WP-HARDENING')
on conflict (version) do nothing;
