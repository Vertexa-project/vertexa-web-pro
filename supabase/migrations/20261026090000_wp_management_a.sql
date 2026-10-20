-- =====================================================================================
-- WP-GEST · A — gestão da clínica (só ADMIN).
-- · clinic_management_overview: carteira por profissional (pacientes, em risco, atenção, inativos, adesão média,
--   sem registro), pacientes sem profissional, novos pacientes por mês (6 meses) e quem parou de usar.
-- · professional_roster: pacientes ATIVOS de um profissional (para escolher o que transferir).
-- · transfer_patients: move pacientes de um profissional para outro numa única transação, reaproveitando
--   assign_patient_professional (vínculo novo/reativado) e deactivate_patient_link (trilha + chat). Pacientes que o
--   profissional de origem não atende são ignorados (contados em "skipped"). p_patients null = toda a carteira.
-- Depende de private.patient_last_activity_day (20261025090000).
-- =====================================================================================
create or replace function public.clinic_management_overview(p_clinic uuid, p_idle_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := coalesce(p_idle_days, 7); v_today date := private.brt_date(now()); v_out jsonb;
begin
  if p_clinic is null or v_days not between 1 and 365 then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;

  with pats as (
    select pt.id, pr.full_name, pr.created_at,
           (v_today - private.patient_last_activity_day(pt.id)) as idle,
           (select s.status::text from public.adherence_snapshots s where s.patient_id = pt.id order by s.calculated_at desc limit 1) as st,
           (select s.weekly_completion_rate from public.adherence_snapshots s where s.patient_id = pt.id order by s.calculated_at desc limit 1) as rate
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic and pr.status = 'active'
  ), lk as (
    select l.professional_id, l.patient_id from public.professional_patient_links l
      join pats on pats.id = l.patient_id
     where coalesce(l.status, 'active') = 'active' and not coalesce(l.is_external, false)
  ), profs as (
    select pf.id, pp.full_name, pf.clinic_role from public.professionals pf join public.profiles pp on pp.id = pf.profile_id
     where pf.clinic_id = p_clinic and coalesce(pf.status, 'active') = 'active'
  )
  select jsonb_build_object(
    'idle_days', v_days,
    'patients', (select count(*) from pats),
    'unassigned', (select count(*) from pats where not exists (select 1 from lk where lk.patient_id = pats.id)),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object(
        'professional_id', pf.id, 'name', pf.full_name, 'clinic_role', pf.clinic_role,
        'patients', (select count(*) from lk join pats on pats.id = lk.patient_id where lk.professional_id = pf.id),
        'em_risco', (select count(*) from lk join pats on pats.id = lk.patient_id where lk.professional_id = pf.id and pats.st = 'em_risco'),
        'atencao', (select count(*) from lk join pats on pats.id = lk.patient_id where lk.professional_id = pf.id and pats.st = 'atencao'),
        'avg_adherence', (select round(avg(coalesce(pats.rate, 0)))::int from lk join pats on pats.id = lk.patient_id where lk.professional_id = pf.id),
        'idle', (select count(*) from lk join pats on pats.id = lk.patient_id where lk.professional_id = pf.id and pats.idle >= v_days)
      ) order by pf.full_name) from profs pf), '[]'::jsonb),
    'new_by_month', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'n', (select count(*) from pats where date_trunc('month', private.brt_date(pats.created_at)) = m)) order by m)
        from (select (date_trunc('month', v_today) - (g || ' months')::interval)::date as m from generate_series(0, 5) g) mm),
    'stopped', coalesce((select jsonb_agg(x order by (x->>'idle_days')::int desc) from (
        select jsonb_build_object('patient_id', pats.id, 'name', pats.full_name, 'idle_days', pats.idle,
               'professionals', coalesce((select jsonb_agg(pf.full_name order by pf.full_name) from lk join profs pf on pf.id = lk.professional_id where lk.patient_id = pats.id), '[]'::jsonb)) as x
          from pats where pats.idle >= v_days order by pats.idle desc limit 20) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.clinic_management_overview(uuid, integer) from public, anon;
grant execute on function public.clinic_management_overview(uuid, integer) to authenticated;

create or replace function public.professional_roster(p_clinic uuid, p_professional uuid)
returns table (patient_id uuid, full_name text, idle_days integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic is null or p_professional is null then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  return query
    select pt.id, pr.full_name, (private.brt_date(now()) - private.patient_last_activity_day(pt.id))
      from public.professional_patient_links l
      join public.professionals pf on pf.id = l.professional_id
      join public.patients pt on pt.id = l.patient_id
      join public.profiles pr on pr.id = pt.profile_id
     where l.professional_id = p_professional and pf.clinic_id = p_clinic and pt.clinic_id = p_clinic
       and coalesce(l.status, 'active') = 'active' and not coalesce(l.is_external, false)
     order by pr.full_name;
end $$;
revoke all on function public.professional_roster(uuid, uuid) from public, anon;
grant execute on function public.professional_roster(uuid, uuid) to authenticated;

create or replace function public.transfer_patients(p_from uuid, p_to uuid, p_patients uuid[] default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid; v_to_clinic uuid; v_to_status text; v_ids uuid[]; v_id uuid; v_moved integer := 0; v_skipped integer := 0;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Transferência de carteira');
begin
  if p_from is null or p_to is null or p_from = p_to then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if p_patients is not null and cardinality(p_patients) not between 1 and 200 then raise exception 'invalid patient list' using errcode = '22023'; end if;
  select clinic_id into v_clinic from public.professionals where id = p_from;
  select clinic_id, coalesce(status, 'active') into v_to_clinic, v_to_status from public.professionals where id = p_to;
  if v_clinic is null or v_to_clinic is distinct from v_clinic or not private.is_clinic_admin(v_clinic) then
    raise exception 'forbidden: clinic admin only' using errcode = '42501';
  end if;
  if v_to_status <> 'active' then raise exception 'destination professional is not active' using errcode = '42501'; end if;

  select coalesce(array_agg(distinct l.patient_id), '{}') into v_ids
    from public.professional_patient_links l join public.patients pt on pt.id = l.patient_id
   where l.professional_id = p_from and pt.clinic_id = v_clinic and coalesce(l.status, 'active') = 'active'
     and not coalesce(l.is_external, false)
     and (p_patients is null or l.patient_id = any (p_patients));
  if p_patients is not null then v_skipped := cardinality(p_patients) - coalesce(cardinality(v_ids), 0); end if;

  foreach v_id in array v_ids loop
    perform public.assign_patient_professional(v_id, p_to);
    perform public.deactivate_patient_link(p_from, v_id, v_reason);
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('moved', v_moved, 'skipped', greatest(v_skipped, 0));
end $$;
revoke all on function public.transfer_patients(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.transfer_patients(uuid, uuid, uuid[], text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261026090000','20261026090000_wp_management_a.sql',
  'GEST-A: clinic_management_overview, professional_roster e transfer_patients (admin).','GEST-A');
