-- =====================================================================================
-- WP-HARDENING · A1 (AUTH-4) — PROMOÇÃO CONFIÁVEL de "pendente" para PROFISSIONAL.
-- Hoje todo signup Google sem match vira profile role='patient' status='pending' (fail-closed,
-- ver handle_new_user). Faltava o caminho LEGÍTIMO de um profissional novo virar professional da
-- clínica. Esta RPC é esse caminho — e SÓ um ADMIN da clínica pode chamá-la.
--
-- SEGURANÇA (por que NÃO é escalonamento de privilégio):
--   · SECURITY DEFINER (roda como owner p/ poder inserir em professionals e promover o profile), MAS
--     todo o poder está atrás de private.is_clinic_admin(p_clinic) — derivado do current_profile_id()
--     do CHAMADOR (nunca de parâmetro do client).
--   · NÃO-ADMIN é negado (is_clinic_admin falso).
--   · CLÍNICA ALHEIA é negada pela MESMA checagem: admin da clínica X chamando com p_clinic=Y ⇒
--     is_clinic_admin(Y) falso ⇒ negado. Não há como promover para clínica que não se administra.
--   · AUTO-PROMOÇÃO negada: p_profile_id = current_profile_id() ⇒ erro (o próprio usuário nunca se
--     promove; e um pendente, por não ser admin, já cai no gate de admin antes disso).
--   · Valida que o alvo está PENDING (não "rouba" um profile já ativo/de outra função).
--   · Idempotente: se o profile já é professional daquela clínica, retorna o id existente (no-op).
--
-- RLS NÃO afrouxada. Identidade/trigger de auth intactos. Não toca patient-native.
--
-- ESCOPO ENTREGUE = a RPC BASE (admin promove pending → professional). O FLUXO DE CONVITE completo
-- (enviar convite por e-mail a um profissional que ainda não tem conta, criar o profile 'pending'
-- previamente com o e-mail, aceite/expiração do convite, UI no web) é DECISÃO DE PRODUTO de outro WP
-- — reportado, não implementado aqui.
--
-- NOTA (advisor 0029 authenticated_security_definer_function_executable): esperado/intencional —
-- segue o padrão de create_patient/save_nutrition_plan/save_workout_plan; a segurança é a checagem
-- interna is_clinic_admin, não a ausência de EXECUTE.
--
-- ROLLBACK:
--   drop function if exists public.promote_to_professional(uuid, uuid, public.professional_type, text, text, text);
-- =====================================================================================

create or replace function public.promote_to_professional(
  p_profile_id       uuid,
  p_clinic_id        uuid,
  p_type             public.professional_type,
  p_clinic_role      text default 'member',
  p_registry_number  text default null,
  p_specialty        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller        uuid := private.current_profile_id();
  v_existing      uuid;
  v_target_status text;
  v_new_prof      uuid;
begin
  -- 1) autenticado (tem profile)
  if v_caller is null then
    raise exception 'promote_to_professional: not authenticated' using errcode = '42501';
  end if;

  -- 2) o CHAMADOR precisa ser ADMIN da clínica ALVO.
  --    Bloqueia num só gate: (a) não-admin e (b) clínica alheia (admin de X, p_clinic=Y ⇒ falso).
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'promote_to_professional: caller is not admin of clinic %', p_clinic_id
      using errcode = '42501';
  end if;

  -- 3) sem AUTO-PROMOÇÃO (o próprio usuário nunca se promove)
  if p_profile_id = v_caller then
    raise exception 'promote_to_professional: self-promotion is not allowed'
      using errcode = '42501';
  end if;

  -- validação de argumentos
  if p_profile_id is null or p_type is null then
    raise exception 'promote_to_professional: p_profile_id and p_type are required'
      using errcode = '22004';
  end if;
  if p_clinic_role not in ('member', 'admin') then
    raise exception 'promote_to_professional: invalid clinic_role %', p_clinic_role
      using errcode = '22023';
  end if;

  -- 4) idempotência: já é professional DESTA clínica ⇒ retorna o existente (no-op seguro)
  select pr.id into v_existing
  from public.professionals pr
  where pr.profile_id = p_profile_id and pr.clinic_id = p_clinic_id
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- 5) valida que o ALVO existe e está PENDING (não promove um já-ativo/de outra função)
  select status into v_target_status from public.profiles where id = p_profile_id;
  if v_target_status is null then
    raise exception 'promote_to_professional: target profile % not found', p_profile_id
      using errcode = 'P0002';
  end if;
  if v_target_status <> 'pending' then
    raise exception 'promote_to_professional: target profile % is not pending (status=%)',
      p_profile_id, v_target_status using errcode = '22023';
  end if;

  -- efetiva: cria a linha professionals (vínculo com a clínica) e promove o profile.
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, registry_number, specialty)
  values (p_profile_id, p_clinic_id, p_type, p_clinic_role, p_registry_number, p_specialty)
  returning id into v_new_prof;

  update public.profiles
    set role = 'professional', status = 'active'
  where id = p_profile_id;

  return v_new_prof;
end $$;

-- Grants: fora do alcance de public/anon; execute só p/ authenticated (o gate real é is_clinic_admin).
revoke all     on function public.promote_to_professional(uuid, uuid, public.professional_type, text, text, text) from public, anon;
grant  execute on function public.promote_to_professional(uuid, uuid, public.professional_type, text, text, text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260723090000','20260723090000_wp_hardening_a1_promote_to_professional.sql',
  'WP-HARDENING A1 (AUTH-4): RPC SECURITY DEFINER promote_to_professional — SO admin da clinica '
  '(is_clinic_admin, derivado do current_profile_id do chamador) promove um profile PENDING para '
  'professional daquela clinica (cria professionals + role/status). Nega nao-admin, clinica alheia e '
  'auto-promocao; idempotente; valida alvo pending. RLS NAO afrouxada. Fluxo de convite = outro WP.',
  'WP-HARDENING')
on conflict (version) do nothing;
