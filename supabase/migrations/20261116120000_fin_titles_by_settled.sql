-- E7 (achado D43): Títulos podem ser filtrados pela data de liquidação (o atalho de «Recebido» do painel usa a liquidação, não a previsão).
drop function if exists public.fin_receivables_list(uuid, uuid, text, date, date, integer, integer);
create or replace function public.fin_receivables_list(p_clinic uuid, p_unit uuid default null, p_status text default null, p_from date default null, p_to date default null,
                                                       p_limit integer default 300, p_offset integer default 0, p_date_by text default 'expected')
returns table (id uuid, sale_id uuid, payment_id uuid, unit_id uuid, patient_name text, acquirer_name text, method text, brand text, installment_no integer, installments integer,
               gross_cents integer, fee_cents integer, net_cents integer, expected_date date, settled_date date, settled_net_cents integer, status text, reverse_reason text, nsu text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'receivables', null, false);
  return query
    select r.id, r.sale_id, r.payment_id, r.unit_id, ppr.full_name, a.name, p.method, p.brand, r.installment_no, r.installments, r.gross_cents, r.fee_cents, r.net_cents,
           r.expected_date, r.settled_date, r.settled_net_cents, r.status, r.reverse_reason, p.nsu
      from public.fin_receivables r
      join public.fin_payments p on p.id = r.payment_id
      join public.fin_acquirers a on a.id = p.acquirer_id
      join public.fin_sales s on s.id = r.sale_id
      join public.patients pt on pt.id = s.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
     where r.clinic_id = p_clinic and (p_unit is null or r.unit_id = p_unit) and (p_status is null or r.status = p_status)
       and (p_from is null or (case when p_date_by = 'settled' then r.settled_date else r.expected_date end) >= p_from)
       and (p_to is null or (case when p_date_by = 'settled' then r.settled_date else r.expected_date end) <= p_to)
       and private.fin_can(p_clinic, 'receivables', r.unit_id, false)
     order by r.expected_date, r.id
     limit least(greatest(coalesce(p_limit, 300), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.fin_receivables_list(uuid, uuid, text, date, date, integer, integer, text) from public, anon;
grant execute on function public.fin_receivables_list(uuid, uuid, text, date, date, integer, integer, text) to authenticated, service_role;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261116120000','20261116120000_fin_titles_by_settled.sql','FIN-E7: Títulos filtráveis pela data de liquidação (achado D43).','FIN-E7');
