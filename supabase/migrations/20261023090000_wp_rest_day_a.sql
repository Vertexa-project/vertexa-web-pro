-- =====================================================================================
-- WP-REST · A — dia de descanso não interrompe a sequência.
-- · rest_days: o PACIENTE marca "hoje é meu dia de descanso" (hoje ou ontem, no máx. 2 por janela de 7 dias).
-- · private.event_streak_brt: dia de descanso sem registro NÃO quebra a sequência e NÃO soma (o dia não conta
--   como dia ativo; só atravessa). Dia com registro conta normal. Sem dias de descanso o resultado é idêntico
--   ao anterior (recursão inalterada). Usada por recompute_adherence_for e recompute_achievements.
-- =====================================================================================
create table if not exists public.rest_days (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  rest_on date not null,
  created_at timestamptz not null default now(),
  unique (patient_id, rest_on)
);
create index if not exists rest_days_patient_day_idx on public.rest_days (patient_id, rest_on desc);
alter table public.rest_days enable row level security;
revoke all on public.rest_days from anon, authenticated;
grant select, insert, delete on public.rest_days to authenticated;

drop policy if exists rest_days_select on public.rest_days;
drop policy if exists rest_days_insert_self on public.rest_days;
drop policy if exists rest_days_delete_self on public.rest_days;
create policy rest_days_select on public.rest_days for select to authenticated using ( private.can_access_patient(patient_id) );
create policy rest_days_insert_self on public.rest_days for insert to authenticated
  with check ( private.is_self_patient(patient_id)
               and rest_on between private.brt_date(now()) - 1 and private.brt_date(now()) );
create policy rest_days_delete_self on public.rest_days for delete to authenticated
  using ( private.is_self_patient(patient_id) and rest_on >= private.brt_date(now()) - 1 );

-- Limite: no máximo 2 dias de descanso em qualquer janela de 7 dias (senão a sequência viraria enfeite).
create or replace function private.rest_days_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.rest_days r
       where r.patient_id = new.patient_id and r.rest_on between new.rest_on - 6 and new.rest_on) >= 2 then
    raise exception 'rest day limit: max 2 per 7 days' using errcode = '23514', hint = 'REST_DAY_LIMIT';
  end if;
  return new;
end $$;
drop trigger if exists rest_days_limit_trg on public.rest_days;
create trigger rest_days_limit_trg before insert on public.rest_days for each row execute function private.rest_days_limit();

create or replace function private.event_streak_brt(p_patient uuid)
returns integer language sql stable set search_path = '' as $function$
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
  covered as (select d from ev_days union select d from rest),
  start_day as (
    select case
      when exists (select 1 from covered where d = private.brt_date(now()))     then private.brt_date(now())
      when exists (select 1 from covered where d = private.brt_date(now()) - 1) then private.brt_date(now()) - 1
      else null::date
    end as sd
  ),
  rec as (
    select sd as d, case when exists (select 1 from ev_days where d = sd) then 1 else 0 end as n
      from start_day where sd is not null
    union all
    select r.d - 1, r.n + case when exists (select 1 from ev_days where d = r.d - 1) then 1 else 0 end
      from rec r where exists (select 1 from covered where d = r.d - 1)
  )
  select coalesce(max(n), 0)::int from rec
$function$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261023090000','20261023090000_wp_rest_day_a.sql',
  'REST-A: rest_days (paciente marca descanso, máx 2/7 dias) e event_streak_brt atravessa dias de descanso sem contá-los.','REST-A');
