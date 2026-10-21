-- WP-STREAK · A3 — my_streak_summary também devolve os dias CUMPRIDOS (últimos 14), para a semana da tela
-- bater com a regra do servidor (dia cumprido = metade do previsto). Cumprido = dia do caminho que aumentou a contagem
-- (descanso e dia perdoado não aumentam). Reversível: recriar my_streak_summary com a definição de 20261031090000.
create or replace function public.my_streak_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid; v_cur int; v_best int; v_prot jsonb; v_ful jsonb;
begin
  select pt.id into v_pat from public.patients pt where pt.profile_id = private.current_profile_id() limit 1;
  if v_pat is null then return null; end if;
  v_cur := private.event_streak_brt(v_pat);
  select greatest(v_cur, coalesce(max(s.streak), 0)) into v_best from public.adherence_snapshots s where s.patient_id = v_pat;
  select coalesce(jsonb_agg(w.protected_day order by w.protected_day), '[]'::jsonb) into v_prot
    from private.streak_walk(v_pat) w where w.protected_day is not null and w.protected_day >= private.brt_date(now()) - 13;
  select coalesce(jsonb_agg(f.d order by f.d), '[]'::jsonb) into v_ful from (
    select w.d, w.n > coalesce(lag(w.n) over (order by w.d desc), 0) as ok from private.streak_walk(v_pat) w
  ) f where f.ok and f.d >= private.brt_date(now()) - 13;
  return jsonb_build_object('streak', v_cur, 'best', v_best, 'protected', v_prot, 'fulfilled', v_ful);
end $$;
revoke all on function public.my_streak_summary() from public, anon;
grant execute on function public.my_streak_summary() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261101100000','20261101100000_wp_streak_summary_days.sql','STREAK-A3: my_streak_summary devolve os dias cumpridos.','STREAK-A3');
