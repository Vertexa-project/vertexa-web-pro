-- =====================================================================================
-- WP-05A1 — VÍNCULO MULTIPROFISSIONAL SEGURO (backend only).
--
-- A TESE: a tabela JÁ É N:N (UNIQUE (professional_id, patient_id), sem UNIQUE(patient_id)).
-- Falta o caminho de ESCRITA seguro para um segundo (e N-ésimo) profissional ativo na
-- mesma paciente. create_patient só amarra o CHAMADOR. Não havia RPC de assign/link/add.
-- A UI (PatientTeamSection) só desativa/reativa — WP-05A2. Este WP é RPC + hardening + testes.
--
-- DELTA ESTRUTURAL DECLARADO ANTES DO CORPO (nenhuma tabela/coluna/FK/par ambíguo novo):
--   1) private.sync_existing_channel_roster(uuid) — primitiva que SÓ sincroniza canal
--      EXISTENTE. Tecnicamente necessária: get_or_create_channel CRIA canal; assign e
--      reactivate NÃO podem criar. SECURITY INVOKER + revoke de cliente (mesmo padrão
--      de private.deactivate_link_core).
--   2) public.assign_patient_professional(p_patient_id, p_professional_id) — RPC
--      administrativa V1 (só private.is_clinic_admin). SECURITY DEFINER, search_path='',
--      nomes qualificados, EXECUTE só authenticated.
--   3) public.reactivate_patient_link — passa a devolver o profissional ao roster se o
--      canal existir (fecha a assimetria do 2b-i).
--   4) public.get_or_create_channel — o trecho de roster vira a primitiva (1), depois do
--      SELECT-ou-INSERT do canal. Contrato público inalterado.
--   5) Hardening: revoke INSERT/DELETE de authenticated/anon em professional_patient_links;
--      ppl_admin_write deixa de ser FOR ALL e passa a FOR UPDATE (preserva o UPDATE de
--      is_external, que NÃO tem RPC substituta — ver STOP rule). SELECT intacto.
--
-- ÂNCORAS INTOCADAS: private.can_see_profile, public.promote_to_professional,
--   public.handle_new_user, public.create_patient, public.create_clinic_with_owner.
--
-- KILL SWITCH:
--   revoke execute on function public.assign_patient_professional(uuid,uuid) from authenticated;
--
-- ROLLBACK:
--   drop function if exists public.assign_patient_professional(uuid,uuid);
--   -- restaurar reactivate_patient_link e get_or_create_channel às versões anteriores;
--   drop function if exists private.sync_existing_channel_roster(uuid);
--   drop policy if exists ppl_admin_write on public.professional_patient_links;
--   create policy ppl_admin_write on public.professional_patient_links for all to authenticated
--     using ( private.is_clinic_admin(private.patient_clinic(patient_id)) )
--     with check ( private.is_clinic_admin(private.patient_clinic(patient_id)) );
--   grant insert, delete on table public.professional_patient_links to authenticated;
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) PRIMITIVA — sincroniza roster de um canal JÁ EXISTENTE. Nunca cria canal.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.sync_existing_channel_roster(p_patient_id uuid)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_channel         uuid;
  v_patient_profile uuid;
begin
  if p_patient_id is null then
    return null;
  end if;

  select cc.id
    into v_channel
    from public.chat_channels cc
   where cc.patient_id = p_patient_id;

  if v_channel is null then
    return null;
  end if;

  select pt.profile_id
    into v_patient_profile
    from public.patients pt
   where pt.id = p_patient_id;

  if v_patient_profile is not null then
    insert into public.chat_participants (channel_id, profile_id, role)
    values (v_channel, v_patient_profile, 'patient'::public.user_role)
    on conflict (channel_id, profile_id) do nothing;
  end if;

  insert into public.chat_participants (channel_id, profile_id, role)
  select v_channel, pr.profile_id, 'professional'::public.user_role
    from public.professional_patient_links l
    join public.professionals pr on pr.id = l.professional_id
   where l.patient_id = p_patient_id
     and coalesce(l.status, 'active') = 'active'
     and coalesce(l.is_external, false) = false
     and pr.profile_id is not null
  on conflict (channel_id, profile_id) do nothing;

  delete from public.chat_participants cp
   where cp.channel_id = v_channel
     and cp.role = 'professional'::public.user_role
     and not exists (
           select 1
             from public.professional_patient_links l
             join public.professionals pr on pr.id = l.professional_id
            where l.patient_id = p_patient_id
              and coalesce(l.status, 'active') = 'active'
              and coalesce(l.is_external, false) = false
              and pr.profile_id = cp.profile_id);

  return v_channel;
end;
$$;

comment on function private.sync_existing_channel_roster(uuid) is
  'WP-05A1: reconcilia chat_participants de um canal EXISTENTE com os vinculos ativos '
  'nao-externos. Nao cria canal. SECURITY INVOKER; sem EXECUTE para o cliente.';

revoke all on function private.sync_existing_channel_roster(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) get_or_create_channel — cria/obtém o canal e delega o roster à primitiva.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.get_or_create_channel(p_patient_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel uuid;
begin
  if p_patient_id is null then
    raise exception 'Paciente nao informado.' using errcode = '22023';
  end if;

  if not private.can_access_patient_internal(p_patient_id) then
    raise exception 'Sem acesso a este paciente.' using errcode = '42501';
  end if;

  insert into public.chat_channels (patient_id)
  values (p_patient_id)
  on conflict (patient_id) do nothing;

  select cc.id
    into v_channel
    from public.chat_channels cc
   where cc.patient_id = p_patient_id;

  if v_channel is null then
    raise exception 'Nao foi possivel obter o canal do paciente.' using errcode = 'P0001';
  end if;

  perform private.sync_existing_channel_roster(p_patient_id);

  return v_channel;
end;
$$;

comment on function public.get_or_create_channel(uuid) is
  'WP-CHAT-FIX + WP-05A1: obtem (ou cria) o canal 1:1 do paciente e reconcilia o roster '
  'via private.sync_existing_channel_roster. Autoriza com can_access_patient_internal.';

revoke all     on function public.get_or_create_channel(uuid) from public, anon;
grant  execute on function public.get_or_create_channel(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) reactivate_patient_link — fecha a assimetria: se o canal existe, volta ao roster.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reactivate_patient_link(
  p_professional_id uuid,
  p_patient_id      uuid,
  p_reason          text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_clinic      uuid;
  v_link_id     uuid;
  v_from_status text;
  v_prof_clinic uuid;
  v_me          uuid;
begin
  if p_professional_id is null or p_patient_id is null then
    raise exception 'Parametros obrigatorios ausentes.' using errcode = '22023';
  end if;

  v_clinic := private.patient_clinic(p_patient_id);

  if not private.is_clinic_admin(v_clinic) then
    raise exception 'Apenas o administrador da clinica gerencia vinculos.' using errcode = '42501';
  end if;

  select pr.clinic_id into v_prof_clinic
    from public.professionals pr where pr.id = p_professional_id;

  if v_prof_clinic is null or v_prof_clinic is distinct from v_clinic then
    raise exception 'Profissional nao pertence a clinica desta paciente.' using errcode = '42501';
  end if;

  select l.id, coalesce(l.status,'active') into v_link_id, v_from_status
    from public.professional_patient_links l
   where l.professional_id = p_professional_id and l.patient_id = p_patient_id;

  if v_link_id is null then
    raise exception 'Vinculo inexistente.' using errcode = 'P0002';
  end if;

  if v_from_status = 'active' then
    perform private.sync_existing_channel_roster(p_patient_id);
    return v_link_id;
  end if;

  v_me := private.current_profile_id();

  update public.professional_patient_links
     set status            = 'active',
         status_changed_at = now(),
         status_changed_by = v_me,
         status_reason     = p_reason
   where id = v_link_id;

  insert into public.ppl_status_events
    (link_id, professional_id, patient_id, from_status, to_status, reason, changed_by)
  values (v_link_id, p_professional_id, p_patient_id, v_from_status, 'active', p_reason, v_me);

  perform private.sync_existing_channel_roster(p_patient_id);

  return v_link_id;
end;
$$;

comment on function public.reactivate_patient_link(uuid,uuid,text) is
  'WP-TEAM-2b-i + WP-05A1: reativa o vinculo e, se o canal existir, devolve o profissional '
  'ao roster na mesma transacao. Nao cria canal.';

revoke all     on function public.reactivate_patient_link(uuid,uuid,text) from public, anon;
grant  execute on function public.reactivate_patient_link(uuid,uuid,text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) RPC — assign_patient_professional (V1 administrativa)
--
-- Clínica, adminidade e pertinência saem de relações reais (patients, professionals,
-- private.is_clinic_admin). Nada de clinic_id ou papel vindo do browser.
-- Mensagem de recusa única (42501) para não enumerar outra clínica.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_patient_professional(
  p_patient_id      uuid,
  p_professional_id uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me          uuid;
  v_clinic      uuid;
  v_prof_clinic uuid;
  v_prof_status text;
  v_link_id     uuid;
  v_from_status text;
begin
  v_me := private.current_profile_id();
  if v_me is null then
    raise exception 'Apenas o administrador da clinica gerencia vinculos.' using errcode = '42501';
  end if;

  if p_patient_id is null or p_professional_id is null then
    raise exception 'Parametros obrigatorios ausentes.' using errcode = '22023';
  end if;

  v_clinic := private.patient_clinic(p_patient_id);
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'Apenas o administrador da clinica gerencia vinculos.' using errcode = '42501';
  end if;

  select pr.clinic_id, coalesce(pr.status, 'active')
    into v_prof_clinic, v_prof_status
    from public.professionals pr
   where pr.id = p_professional_id;

  if v_prof_clinic is null
     or v_prof_clinic is distinct from v_clinic
     or v_prof_status is distinct from 'active' then
    raise exception 'Apenas o administrador da clinica gerencia vinculos.' using errcode = '42501';
  end if;

  select l.id, coalesce(l.status, 'active')
    into v_link_id, v_from_status
    from public.professional_patient_links l
   where l.professional_id = p_professional_id
     and l.patient_id = p_patient_id
   for update;

  if v_link_id is not null then
    if v_from_status = 'active' then
      perform private.sync_existing_channel_roster(p_patient_id);
      return v_link_id;
    end if;
    return public.reactivate_patient_link(p_professional_id, p_patient_id, null);
  end if;

  begin
    insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (p_professional_id, p_patient_id, false, 'active')
    returning id into v_link_id;
  exception when unique_violation then
    select l.id, coalesce(l.status, 'active')
      into v_link_id, v_from_status
      from public.professional_patient_links l
     where l.professional_id = p_professional_id
       and l.patient_id = p_patient_id
     for update;

    if v_link_id is null then
      raise exception 'Apenas o administrador da clinica gerencia vinculos.' using errcode = '42501';
    end if;

    if v_from_status is distinct from 'active' then
      return public.reactivate_patient_link(p_professional_id, p_patient_id, null);
    end if;
  end;

  perform private.sync_existing_channel_roster(p_patient_id);
  return v_link_id;
end;
$$;

comment on function public.assign_patient_professional(uuid,uuid) is
  'WP-05A1: admin/owner da clinica da paciente vincula um profissional ATIVO da MESMA clinica. '
  'Idempotente no UNIQUE (professional_id, patient_id): ativa inexistente, devolve ativo, '
  'reativa inativo na mesma linha. Nao cria canal; se o canal existir, entra no roster.';

revoke all     on function public.assign_patient_professional(uuid,uuid) from public, anon;
grant  execute on function public.assign_patient_professional(uuid,uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) HARDENING — escrita bruta deixa de criar/apagar vínculo.
--
-- ppl_admin_write FOR ALL autorizava INSERT sem checar se o profissional-alvo é da mesma
-- clínica. O UPDATE de is_external AINDA depende desta policy e NÃO tem RPC substituta,
-- então a policy NÃO é removida: só deixa de cobrir INSERT/DELETE (FOR UPDATE).
-- Defesa em profundidade: revoke de INSERT/DELETE no privilégio de tabela.
-- SELECT (ppl_select) intacto. update (is_external) intacto. update (status) continua
-- revogado desde o 2b-i. RPCs SECURITY DEFINER seguem escrevendo como owner.
-- ─────────────────────────────────────────────────────────────────────────────────────
drop policy if exists ppl_admin_write on public.professional_patient_links;

create policy ppl_admin_write on public.professional_patient_links
  for update to authenticated
  using ( private.is_clinic_admin(private.patient_clinic(patient_id)) )
  with check ( private.is_clinic_admin(private.patient_clinic(patient_id)) );

revoke insert, delete on table public.professional_patient_links from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260813090000', '20260813090000_wp_05a1_multiprofessional_link.sql',
  'WP-05A1: RPC public.assign_patient_professional (SECDEF, search_path vazio, EXECUTE so '
  'authenticated) — admin/owner da clinica da paciente vincula profissional ativo da mesma '
  'clinica; fail-closed 42501 sem enumerar outra clinica; idempotente no UNIQUE '
  '(professional_id, patient_id): INSERT ativo / devolve ativo / REATIVA a mesma linha. '
  'Primitiva private.sync_existing_channel_roster (INVOKER, sem EXECUTE no cliente): sincroniza '
  'roster so se o canal ja existe — assign NUNCA cria canal. reactivate_patient_link passa a '
  'devolver o profissional ao roster (fecha assimetria 2b-i). get_or_create_channel reusa a '
  'primitiva. Hardening: ppl_admin_write FOR ALL -> FOR UPDATE (is_external sem RPC substituta '
  'permanece); revoke INSERT/DELETE de authenticated/anon em professional_patient_links; SELECT '
  'intacto. Sem tabela/coluna/FK nova. Ancoras intocadas.',
  'WP-05A1')
on conflict (version) do nothing;
