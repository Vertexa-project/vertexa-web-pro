-- FIN-E2 ajuste: a busca de paciente da venda não lista paciente removido (perfil anonimizado, status inactive).
create or replace function public.fin_sale_patients(p_clinic uuid, p_search text default null, p_limit integer default 20)
returns table (patient_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'sales', null, true);
  return query
    select pt.id, pr.full_name
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic
       and coalesce(pr.status::text, '') <> 'inactive'
       and (nullif(btrim(coalesce(p_search, '')), '') is null or pr.full_name ilike '%' || btrim(p_search) || '%')
     order by pr.full_name limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261113213000','20261113213000_fin_e2_sale_patients_active.sql','FIN-E2 ajuste: busca de paciente da venda sem paciente removido.','FIN-E2');
