-- =====================================================================================
-- WP-FIN · A — financeiro da clínica (controle MANUAL; só ADMIN). Nada aqui é visível ao paciente nem ao
-- profissional comum; também não aparece na ficha do paciente (decisão: lente financeira só no painel).
-- · patient_billing: valor mensal e dia de vencimento por paciente (1 por paciente).
-- · patient_charges: cobrança por mês (competência) com status pending|paid|canceled.
-- · RPCs (security definer): set_patient_billing, generate_month_charges, mark_charge_paid, reopen_charge,
--   cancel_charge, finance_overview, finance_charges, finance_patients. Escrita direta nas tabelas é revogada.
-- · Receita em risco = valor mensal dos pacientes com cobrança ativa e sem registro há 14+ dias.
-- Depende de private.patient_last_activity_day (20261025090000).
-- =====================================================================================
create table if not exists public.patient_billing (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  monthly_amount_cents integer not null check (monthly_amount_cents between 0 and 100000000),
  due_day smallint not null default 10 check (due_day between 1 and 28),
  is_active boolean not null default true,
  started_on date not null default private.brt_date(now()),
  notes text check (notes is null or char_length(notes) <= 200),
  updated_at timestamptz not null default now()
);
create index if not exists patient_billing_clinic_idx on public.patient_billing (clinic_id);

create table if not exists public.patient_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  competence date not null check (extract(day from competence) = 1),
  due_on date not null,
  amount_cents integer not null check (amount_cents between 0 and 100000000),
  status text not null default 'pending' check (status in ('pending','paid','canceled')),
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, competence),
  check ((status = 'paid') = (paid_on is not null))
);
create index if not exists patient_charges_clinic_month_idx on public.patient_charges (clinic_id, competence);

alter table public.patient_billing enable row level security;
alter table public.patient_charges enable row level security;
revoke all on public.patient_billing, public.patient_charges from anon, authenticated;
grant select on public.patient_billing, public.patient_charges to authenticated;
drop policy if exists patient_billing_select on public.patient_billing;
drop policy if exists patient_charges_select on public.patient_charges;
create policy patient_billing_select on public.patient_billing for select to authenticated using ( private.is_clinic_admin(clinic_id) );
create policy patient_charges_select on public.patient_charges for select to authenticated using ( private.is_clinic_admin(clinic_id) );

create or replace function private.finance_admin_clinic_of_patient(p_patient uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select clinic_id into v from public.patients where id = p_patient;
  if v is null or not private.is_clinic_admin(v) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  return v;
end $$;
revoke all on function private.finance_admin_clinic_of_patient(uuid) from public, anon, authenticated;

create or replace function public.set_patient_billing(p_patient uuid, p_amount_cents integer, p_due_day integer, p_active boolean default true, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid := private.finance_admin_clinic_of_patient(p_patient); v_month date := date_trunc('month', private.brt_date(now()))::date;
begin
  insert into public.patient_billing (patient_id, clinic_id, monthly_amount_cents, due_day, is_active, notes)
    values (p_patient, v_clinic, p_amount_cents, p_due_day, coalesce(p_active, true), nullif(btrim(coalesce(p_notes,'')), ''))
  on conflict (patient_id) do update
    set monthly_amount_cents = excluded.monthly_amount_cents, due_day = excluded.due_day, is_active = excluded.is_active,
        notes = excluded.notes, updated_at = now();
  -- cobranças AINDA PENDENTES do mês atual em diante acompanham o novo valor/vencimento; pagas e canceladas não mudam
  update public.patient_charges c
     set amount_cents = p_amount_cents, due_on = make_date(extract(year from c.competence)::int, extract(month from c.competence)::int, p_due_day), updated_at = now()
   where c.patient_id = p_patient and c.status = 'pending' and c.competence >= v_month;
  return p_patient;
end $$;
revoke all on function public.set_patient_billing(uuid, integer, integer, boolean, text) from public, anon;
grant execute on function public.set_patient_billing(uuid, integer, integer, boolean, text) to authenticated;

create or replace function public.generate_month_charges(p_clinic uuid, p_month date)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_cur date := date_trunc('month', private.brt_date(now()))::date; v_n integer;
begin
  if p_clinic is null or p_month is null then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  if v_month > (v_cur + interval '1 month')::date or v_month < (v_cur - interval '12 months')::date then
    raise exception 'month out of range' using errcode = '22023';
  end if;
  insert into public.patient_charges (clinic_id, patient_id, competence, due_on, amount_cents)
    select b.clinic_id, b.patient_id, v_month, make_date(extract(year from v_month)::int, extract(month from v_month)::int, b.due_day), b.monthly_amount_cents
      from public.patient_billing b
      join public.patients pt on pt.id = b.patient_id
      join public.profiles pr on pr.id = pt.profile_id
     where b.clinic_id = p_clinic and b.is_active and pr.status = 'active'
       and b.started_on <= (v_month + interval '1 month - 1 day')::date
  on conflict (patient_id, competence) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.generate_month_charges(uuid, date) from public, anon;
grant execute on function public.generate_month_charges(uuid, date) to authenticated;

create or replace function private.finance_charge_for_admin(p_charge uuid) returns public.patient_charges
language plpgsql security definer set search_path = '' as $$
declare c public.patient_charges;
begin
  select * into c from public.patient_charges where id = p_charge for update;
  if c.id is null or not private.is_clinic_admin(c.clinic_id) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  return c;
end $$;
revoke all on function private.finance_charge_for_admin(uuid) from public, anon, authenticated;

create or replace function public.mark_charge_paid(p_charge uuid, p_paid_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.patient_charges := private.finance_charge_for_admin(p_charge); v_day date := coalesce(p_paid_on, private.brt_date(now()));
begin
  if v_day > private.brt_date(now()) then raise exception 'paid_on in the future' using errcode = '22023'; end if;
  if c.status = 'paid' then return c.id; end if;
  if c.status = 'canceled' then raise exception 'charge is canceled' using errcode = '22023'; end if;
  update public.patient_charges set status = 'paid', paid_on = v_day, updated_at = now() where id = c.id;
  return c.id;
end $$;
revoke all on function public.mark_charge_paid(uuid, date) from public, anon;
grant execute on function public.mark_charge_paid(uuid, date) to authenticated;

create or replace function public.reopen_charge(p_charge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.patient_charges := private.finance_charge_for_admin(p_charge);
begin
  update public.patient_charges set status = 'pending', paid_on = null, updated_at = now() where id = c.id and status <> 'pending';
  return c.id;
end $$;
revoke all on function public.reopen_charge(uuid) from public, anon;
grant execute on function public.reopen_charge(uuid) to authenticated;

create or replace function public.cancel_charge(p_charge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.patient_charges := private.finance_charge_for_admin(p_charge);
begin
  if c.status = 'paid' then raise exception 'reopen the paid charge first' using errcode = '22023'; end if;
  update public.patient_charges set status = 'canceled', updated_at = now() where id = c.id and status = 'pending';
  return c.id;
end $$;
revoke all on function public.cancel_charge(uuid) from public, anon;
grant execute on function public.cancel_charge(uuid) to authenticated;

create or replace function public.finance_charges(p_clinic uuid, p_month date)
returns table (charge_id uuid, patient_id uuid, full_name text, due_on date, amount_cents integer, status text, paid_on date, overdue boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  if p_clinic is null or p_month is null then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  return query
    select c.id, c.patient_id, pr.full_name, c.due_on, c.amount_cents, c.status, c.paid_on,
           (c.status = 'pending' and c.due_on < private.brt_date(now()))
      from public.patient_charges c join public.patients pt on pt.id = c.patient_id join public.profiles pr on pr.id = pt.profile_id
     where c.clinic_id = p_clinic and c.competence = v_month
     order by c.due_on, pr.full_name;
end $$;
revoke all on function public.finance_charges(uuid, date) from public, anon;
grant execute on function public.finance_charges(uuid, date) to authenticated;

create or replace function public.finance_patients(p_clinic uuid)
returns table (patient_id uuid, full_name text, monthly_amount_cents integer, due_day smallint, is_active boolean, idle_days integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic is null then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  return query
    select pt.id, pr.full_name, b.monthly_amount_cents, b.due_day, b.is_active,
           (private.brt_date(now()) - private.patient_last_activity_day(pt.id))
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
      left join public.patient_billing b on b.patient_id = pt.id
     where pt.clinic_id = p_clinic and pr.status = 'active'
     order by pr.full_name;
end $$;
revoke all on function public.finance_patients(uuid) from public, anon;
grant execute on function public.finance_patients(uuid) to authenticated;

create or replace function public.finance_overview(p_clinic uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_today date := private.brt_date(now()); v_out jsonb;
begin
  if p_clinic is null or p_month is null then raise exception 'invalid parameters' using errcode = '22023'; end if;
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  with ch as (select * from public.patient_charges where clinic_id = p_clinic and competence = v_month),
  act as (
    select b.patient_id, b.monthly_amount_cents, b.started_on, (v_today - private.patient_last_activity_day(b.patient_id)) as idle
      from public.patient_billing b join public.patients pt on pt.id = b.patient_id join public.profiles pr on pr.id = pt.profile_id
     where b.clinic_id = p_clinic and b.is_active and pr.status = 'active'
  )
  select jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'expected_cents',  coalesce((select sum(amount_cents) from ch where status <> 'canceled'), 0),
    'received_cents',  coalesce((select sum(amount_cents) from ch where status = 'paid'), 0),
    'pending_cents',   coalesce((select sum(amount_cents) from ch where status = 'pending' and due_on >= v_today), 0),
    'overdue_cents',   coalesce((select sum(amount_cents) from ch where status = 'pending' and due_on < v_today), 0),
    'overdue_count',   (select count(*) from ch where status = 'pending' and due_on < v_today),
    'charges_count',   (select count(*) from ch where status <> 'canceled'),
    'at_risk_patients', (select count(*) from act where idle >= 14),
    'at_risk_cents',    coalesce((select sum(monthly_amount_cents) from act where idle >= 14), 0),
    'billed_patients',  (select count(*) from act),
    'unconfigured_patients', (select count(*) from public.patients pt join public.profiles pr on pr.id = pt.profile_id
                               where pt.clinic_id = p_clinic and pr.status = 'active'
                                 and not exists (select 1 from public.patient_billing b where b.patient_id = pt.id)),
    'ticket_avg_cents', (select round(avg(monthly_amount_cents))::int from act),
    'tenure_avg_months', (select round(avg(greatest(1, ((v_today - started_on) / 30.0)))::numeric, 1) from act),
    'projection', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'expected_cents', coalesce((select sum(monthly_amount_cents) from act), 0)) order by m)
        from (select (date_trunc('month', v_today) + (g || ' months')::interval)::date as m from generate_series(1, 3) g) mm)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.finance_overview(uuid, date) from public, anon;
grant execute on function public.finance_overview(uuid, date) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261027090000','20261027090000_wp_finance_a.sql',
  'FIN-A: patient_billing/patient_charges (controle manual, só admin), RPCs de cobrança e painel financeiro.','FIN-A');
