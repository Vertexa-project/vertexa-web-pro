-- Consulta assistida (parte 1) — leitura do histórico de alterações com o NOME de quem alterou.
-- ADITIVA: só uma função nova. A tabela clinical_record_versions já existe (20261113120000).
create or replace function public.clinical_list_versions(p_encounter uuid)
returns table (id bigint, action text, field_key text, before_value jsonb, after_value jsonb,
               actor_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.action, v.field_key, v.before_value, v.after_value,
         case when v.action = 'ai' then 'IA'
              else (select pf.full_name from public.professionals pr join public.profiles pf on pf.id = pr.profile_id
                     where pr.id = v.actor_professional_id) end as actor_name,
         v.created_at
    from public.clinical_record_versions v
   where v.encounter_id = p_encounter and private.clinical_can_access_encounter(p_encounter)
   order by v.id
$$;
revoke all on function public.clinical_list_versions(uuid) from public, anon;
grant execute on function public.clinical_list_versions(uuid) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261113123000', '20261113123000_clinical_versions_rpc.sql',
        'Consulta assistida: RPC clinical_list_versions (histórico com nome do autor), aditiva.', 'CONSULTA-ASSISTIDA-1');
