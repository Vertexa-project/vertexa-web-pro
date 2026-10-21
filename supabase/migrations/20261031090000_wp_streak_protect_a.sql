-- =====================================================================================
-- WP-STREAK · A — Sequência com 1 falha perdoada por semana + recorde (PDF do Ernâni, telas 06–07;
-- decisão do Djeimyson em 21/10: "1 falha perdoada por semana; recorde = maior sequência de todos os tempos").
-- · Um dia sem registro (e sem descanso) NÃO quebra a sequência se for a única falha daquela semana (seg–dom, BRT)
--   e o dia anterior estiver coberto. O dia perdoado não soma dias; só mantém a continuidade.
-- · Duas falhas seguidas, ou duas na mesma semana, quebram. Hoje ou ontem precisam estar cobertos (como antes).
-- · A regra é mais branda que a antiga: nenhuma sequência existente diminui.
-- · private.streak_walk(p) devolve o caminho; event_streak_brt = maior contagem; my_streak_summary() = sequência,
--   recorde e dias protegidos para o app.
-- Reversível: recriar event_streak_brt com a definição de 20261025* e dropar streak_walk/my_streak_summary.
-- =====================================================================================
create or replace function private.streak_walk(p_patient uuid)
returns table (d date, n int, protected_day date)
language sql stable set search_path = '' as $$
  with recursive ev_days as (
    select distinct private.brt_date(created_at) as d
    from (
      select created_at from public.activity_events
      where patient_id = p_patient
        and type in (select t.type from public.activity_event_types t where t.counts_as_adherence)
      order by created_at desc limit 500
    ) s
  ),
  rest as (
    select r.rest_on as d from public.rest_days r
     where r.patient_id = p_patient and r.rest_on >= private.brt_date(now()) - 120
  ),
  covered as (select ev_days.d from ev_days union select rest.d from rest),
  start_day as (
    select case
      when exists (select 1 from covered where covered.d = private.brt_date(now()))     then private.brt_date(now())
      when exists (select 1 from covered where covered.d = private.brt_date(now()) - 1) then private.brt_date(now()) - 1
      else null::date
    end as sd
  ),
  rec as (
    select sd as d, case when exists (select 1 from ev_days where ev_days.d = sd) then 1 else 0 end as n,
           null::date as fw, null::date as pd
      from start_day where sd is not null
    union all
    select x.nd, r.n + case when exists (select 1 from ev_days where ev_days.d = x.nd) then 1 else 0 end,
           case when x.gap then date_trunc('week', (r.d - 1)::timestamp)::date else r.fw end,
           case when x.gap then r.d - 1 else null end
      from rec r
      cross join lateral (
        select case
                 when exists (select 1 from covered where covered.d = r.d - 1) then r.d - 1
                 when exists (select 1 from covered where covered.d = r.d - 2)
                      and r.fw is distinct from date_trunc('week', (r.d - 1)::timestamp)::date then r.d - 2
               end as nd,
               not exists (select 1 from covered where covered.d = r.d - 1) as gap
      ) x
     where x.nd is not null
  )
  select rec.d, rec.n, rec.pd from rec
$$;
revoke all on function private.streak_walk(uuid) from public, anon, authenticated;

create or replace function private.event_streak_brt(p_patient uuid)
returns integer language sql stable set search_path = '' as $$
  select coalesce(max(n), 0)::int from private.streak_walk(p_patient)
$$;

create or replace function public.my_streak_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid; v_cur int; v_best int; v_prot jsonb;
begin
  select pt.id into v_pat from public.patients pt where pt.profile_id = private.current_profile_id() limit 1;
  if v_pat is null then return null; end if;
  v_cur := private.event_streak_brt(v_pat);
  select greatest(v_cur, coalesce(max(s.streak), 0)) into v_best from public.adherence_snapshots s where s.patient_id = v_pat;
  select coalesce(jsonb_agg(w.protected_day order by w.protected_day), '[]'::jsonb) into v_prot
    from private.streak_walk(v_pat) w where w.protected_day is not null and w.protected_day >= private.brt_date(now()) - 13;
  return jsonb_build_object('streak', v_cur, 'best', v_best, 'protected', v_prot);
end $$;
revoke all on function public.my_streak_summary() from public, anon;
grant execute on function public.my_streak_summary() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261031090000','20261031090000_wp_streak_protect_a.sql','STREAK-A: 1 falha perdoada por semana + recorde; streak_walk e my_streak_summary.','STREAK-A');
