-- =====================================================================================
-- WP-STREAK · A2 — "Dia cumprido" = pelo menos METADE das atividades previstas do dia (decisão do Djeimyson, 21/10;
-- a regra dos 80% foi simulada e zeraria quase todas as sequências: 1 de 60 dias com registro chegaria a 80%).
-- · Previstas no dia: refeições do plano alimentar atual + suplementos cadastrados + treinos da ficha atual cujo
--   day_index é o dia da semana. Hidratação não entra (não há meta de água por paciente).
-- · Cumprido = concluídas*2 >= previstas (refeição/suplemento distintos; treino limitado ao previsto).
-- · Sem nada previsto no dia (sem plano, ou dia ANTERIOR à criação do plano/suplemento): vale a regra antiga
--   (qualquer registro de adesão). Plano novo não pune o passado.
-- · Dia de descanso e a falha perdoada por semana (20261031090000) seguem iguais.
-- · Sem retroativo: a regra nova só vale a partir de private.planned_rule_start() (22/10/2026); dias anteriores seguem
--   a regra antiga. Assim ninguém perde, no dia da mudança, uma sequência que já construiu.
-- Reversível: recriar private.streak_walk com a definição de 20261031090000.
-- =====================================================================================
create or replace function private.planned_rule_start() returns date language sql immutable set search_path = '' as $$ select date '2026-10-22' $$;
revoke all on function private.planned_rule_start() from public, anon, authenticated;

create or replace function private.streak_walk(p_patient uuid)
returns table (d date, n int, protected_day date)
language sql stable set search_path = '' as $$
  with recursive today_brt as (select private.brt_date(now()) as t),
  any_ev as (
    select distinct private.brt_date(created_at) as d
    from (
      select created_at from public.activity_events
      where patient_id = p_patient
        and type in (select t.type from public.activity_event_types t where t.counts_as_adherence)
      order by created_at desc limit 500
    ) s
  ),
  cur_np as (select id, private.brt_date(created_at) as cd from public.nutrition_plans where patient_id = p_patient order by created_at desc limit 1),
  pm as (select m.id from public.meals m join cur_np on m.nutrition_plan_id = cur_np.id),
  meals_done as (
    select ml.consumed_on as d, count(distinct ml.meal_id)::int as n from public.meal_logs ml
     where ml.patient_id = p_patient and ml.meal_id in (select id from pm) group by 1
  ),
  ps as (select s.id, private.brt_date(s.created_at) as cd from public.supplements s where s.patient_id = p_patient),
  supp_done as (
    select si.taken_on as d, count(distinct si.supplement_id)::int as n from public.supplement_intakes si
     join ps on ps.id = si.supplement_id where si.patient_id = p_patient group by 1
  ),
  cur_wp as (select id, private.brt_date(created_at) as cd from public.workout_plans where patient_id = p_patient order by created_at desc limit 1),
  pw as (select w.day_index from public.workouts w join cur_wp on w.workout_plan_id = cur_wp.id),
  wk_done as (
    select private.brt_date(e.created_at) as d, count(*)::int as n from public.activity_events e
     where e.patient_id = p_patient and e.type = 'workout_checked' group by 1
  ),
  series as (select g::date as d from today_brt, generate_series(today_brt.t - 400, today_brt.t, interval '1 day') g),
  planned as (
    select s.d,
      case when s.d >= private.planned_rule_start() and s.d >= (select cd from cur_np) then (select count(*) from pm) else 0 end as mn,
      case when s.d >= private.planned_rule_start() then (select count(*) from ps where ps.cd <= s.d) else 0 end as sn,
      case when s.d >= private.planned_rule_start() and s.d >= (select cd from cur_wp) then (select count(*) from pw where pw.day_index = extract(dow from s.d)::int) else 0 end as wn
    from series s
  ),
  ev_days as (
    select pl.d from planned pl
      left join meals_done md on md.d = pl.d left join supp_done sd on sd.d = pl.d left join wk_done wd on wd.d = pl.d
     where (pl.mn + pl.sn + pl.wn = 0 and exists (select 1 from any_ev a where a.d = pl.d))
        or (pl.mn + pl.sn + pl.wn > 0
            and 2 * (least(coalesce(md.n, 0), pl.mn) + least(coalesce(sd.n, 0), pl.sn) + least(coalesce(wd.n, 0), pl.wn)) >= pl.mn + pl.sn + pl.wn)
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

insert into public.schema_migration_log (version, filename, description, session)
values ('20261101090000','20261101090000_wp_streak_planned_a.sql','STREAK-A2: dia cumprido = metade das atividades previstas (refeições, suplementos, treino do dia); sem plano vale a regra antiga.','STREAK-A2');
