-- =====================================================================================
-- WP-RANK · A — Desafio e ranking da clínica (PDF do Ernâni, telas 09–12; decisões 21/10: "Geral" = só a própria clínica).
-- · Só entra no ranking quem ACEITAR (ranking_members). Sair remove na hora. O ranking mostra só INICIAIS e pontos:
--   nenhum nome, peso, foto ou dado de terceiros sai desta função.
-- · Pontos por dia, teto 100: treino 40 · refeições 30 (proporcional às refeições do plano atual) · água 10 ·
--   suplemento 10 · peso ou foto 10 (peso "em análise" não conta). Semana = segunda a domingo (BRT); mês = calendário.
-- · Empates dividem a mesma posição. Sem prêmio real (só posição).
-- Não inclui: ligas Bronze→Platina e desafios criados pela clínica (dependem de decisões da Juliana).
-- Reversível: drop das funções e da tabela ranking_members.
-- =====================================================================================
create table if not exists public.ranking_members (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  joined_at timestamptz not null default now()
);
alter table public.ranking_members enable row level security;
revoke all on public.ranking_members from anon, authenticated;
grant select on public.ranking_members to authenticated;
drop policy if exists ranking_members_select on public.ranking_members;
create policy ranking_members_select on public.ranking_members for select to authenticated using (private.is_self_patient(patient_id));

create or replace function public.join_ranking() returns void language plpgsql security definer set search_path = '' as $$
declare v_pat uuid;
begin
  select id into v_pat from public.patients where profile_id = private.current_profile_id() limit 1;
  if v_pat is null then raise exception 'not a patient' using errcode = '42501'; end if;
  insert into public.ranking_members (patient_id) values (v_pat) on conflict do nothing;
end $$;

create or replace function public.leave_ranking() returns void language plpgsql security definer set search_path = '' as $$
declare v_pat uuid;
begin
  select id into v_pat from public.patients where profile_id = private.current_profile_id() limit 1;
  if v_pat is null then raise exception 'not a patient' using errcode = '42501'; end if;
  delete from public.ranking_members where patient_id = v_pat;
end $$;

create or replace function private.points_by_day(p_patients uuid[], p_from date, p_to date)
returns table (patient_id uuid, d date, pts int) language sql stable set search_path = '' as $$
  select x.pid, x.d,
    least(100,
      (case when exists (select 1 from public.activity_events e where e.patient_id = x.pid and e.type = 'workout_checked'
              and e.created_at >= (x.d::timestamp at time zone 'America/Sao_Paulo') and e.created_at < ((x.d + 1)::timestamp at time zone 'America/Sao_Paulo')) then 40 else 0 end)
    + (case when pl.n > 0 then round(30.0 * least(1, coalesce(ml.n, 0)::numeric / pl.n))::int else 0 end)
    + (case when exists (select 1 from public.activity_events e where e.patient_id = x.pid and e.type = 'hydration_logged'
              and e.created_at >= (x.d::timestamp at time zone 'America/Sao_Paulo') and e.created_at < ((x.d + 1)::timestamp at time zone 'America/Sao_Paulo')) then 10 else 0 end)
    + (case when exists (select 1 from public.supplement_intakes si where si.patient_id = x.pid and si.taken_on = x.d) then 10 else 0 end)
    + (case when exists (select 1 from public.weight_logs w where w.patient_id = x.pid and w.review_status in ('ok','approved')
              and w.measured_at >= (x.d::timestamp at time zone 'America/Sao_Paulo') and w.measured_at < ((x.d + 1)::timestamp at time zone 'America/Sao_Paulo'))
              or exists (select 1 from public.progress_photos f where f.patient_id = x.pid
              and f.taken_at >= (x.d::timestamp at time zone 'America/Sao_Paulo') and f.taken_at < ((x.d + 1)::timestamp at time zone 'America/Sao_Paulo')) then 10 else 0 end)
    )::int
  from (select u.pid, g::date as d from unnest(p_patients) as u(pid), generate_series(p_from, p_to, interval '1 day') g) x
  cross join lateral (
    select count(*)::int as n from public.meals m
     where m.nutrition_plan_id = (select np.id from public.nutrition_plans np where np.patient_id = x.pid order by np.created_at desc limit 1)
  ) pl
  left join lateral (
    select count(distinct l.meal_id)::int as n from public.meal_logs l
     where l.patient_id = x.pid and l.consumed_on = x.d
       and l.meal_id in (select m.id from public.meals m where m.nutrition_plan_id = (select np.id from public.nutrition_plans np where np.patient_id = x.pid order by np.created_at desc limit 1))
  ) ml on true
$$;
revoke all on function private.points_by_day(uuid[], date, date) from public, anon, authenticated;

create or replace function public.clinic_ranking(p_period text default 'week')
returns table (rank_position int, initials text, points int, active_days int, is_me boolean)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_clinic uuid; v_from date; v_to date := private.brt_date(now()); v_ids uuid[];
begin
  select id, clinic_id into v_me, v_clinic from public.patients where profile_id = private.current_profile_id() limit 1;
  if v_me is null or not exists (select 1 from public.ranking_members where patient_id = v_me) then
    raise exception 'join the ranking first' using errcode = '42501';
  end if;
  if p_period not in ('week','month') then raise exception 'bad period' using errcode = '22023'; end if;
  v_from := case when p_period = 'week' then date_trunc('week', v_to::timestamp)::date else date_trunc('month', v_to::timestamp)::date end;
  select array_agg(rm.patient_id) into v_ids
    from public.ranking_members rm join public.patients pa on pa.id = rm.patient_id join public.profiles pr on pr.id = pa.profile_id
   where pa.clinic_id = v_clinic and coalesce(pr.status, 'active') = 'active';
  return query
    with t as (
      select b.patient_id as pid, sum(b.pts)::int as tot, count(*) filter (where b.pts > 0)::int as ad
        from private.points_by_day(v_ids, v_from, v_to) b group by b.patient_id
    ), nm as (
      select pa.id as pid, regexp_split_to_array(btrim(pr.full_name), '\s+') as w
        from public.patients pa join public.profiles pr on pr.id = pa.profile_id where pa.id = any(v_ids)
    )
    select (rank() over (order by t.tot desc))::int,
           upper(case when array_length(nm.w, 1) > 1 then left(nm.w[1], 1) || left(nm.w[array_length(nm.w, 1)], 1) else left(nm.w[1], 2) end),
           t.tot, t.ad, (t.pid = v_me)
      from t join nm on nm.pid = t.pid
     order by 1, 2;
end $$;

revoke all on function public.join_ranking() from public, anon;
revoke all on function public.leave_ranking() from public, anon;
revoke all on function public.clinic_ranking(text) from public, anon;
grant execute on function public.join_ranking() to authenticated;
grant execute on function public.leave_ranking() to authenticated;
grant execute on function public.clinic_ranking(text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261104090000','20261104090000_wp_ranking_a.sql','RANK-A: ranking da clínica por pontos diários (opt-in, só iniciais).','RANK-A');
