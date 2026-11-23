-- Cartão 1317 · Central de Ajuda (achado D97): excluir assunto vazio pela Plataforma.
-- Só cria função nova. Assunto com tutorial não se exclui (tutoriais ficam protegidos pela chave).

create or replace function public.platform_help_delete_category(p_id text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if exists (select 1 from public.help_articles where category_id = p_id) then
    raise exception 'category_not_empty' using errcode = '23503';
  end if;
  delete from public.help_categories where id = p_id;
  if not found then
    raise exception 'category_not_found' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.platform_help_delete_category(text) from public, anon;
grant execute on function public.platform_help_delete_category(text) to authenticated;
