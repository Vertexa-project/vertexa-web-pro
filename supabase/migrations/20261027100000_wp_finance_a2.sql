-- =====================================================================================
-- WP-FIN · A2 — ao definir o valor de um paciente (cobrança ligada), a cobrança do MÊS ATUAL já nasce se o
-- vencimento ainda não passou (dia de vencimento >= hoje). Se já passou, a primeira cobrança é a do próximo mês
-- (evita nascer "em atraso" uma mensalidade que o administrador acabou de cadastrar). Idempotente.
-- =====================================================================================
create or replace function public.set_patient_billing(p_patient uuid, p_amount_cents integer, p_due_day integer, p_active boolean default true, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid := private.finance_admin_clinic_of_patient(p_patient);
  v_today date := private.brt_date(now());
  v_month date := date_trunc('month', private.brt_date(now()))::date;
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
  -- primeira cobrança: mês atual, se o vencimento ainda não passou
  if coalesce(p_active, true) and p_due_day >= extract(day from v_today)::int
     and exists (select 1 from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = p_patient and pr.status = 'active') then
    insert into public.patient_charges (clinic_id, patient_id, competence, due_on, amount_cents)
      values (v_clinic, p_patient, v_month, make_date(extract(year from v_month)::int, extract(month from v_month)::int, p_due_day), p_amount_cents)
    on conflict (patient_id, competence) do nothing;
  end if;
  return p_patient;
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261027100000','20261027100000_wp_finance_a2.sql','FIN-A2: set_patient_billing cria a cobrança do mês atual quando o vencimento ainda não passou.','FIN-A2');
