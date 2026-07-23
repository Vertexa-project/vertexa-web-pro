-- =====================================================================================
-- WP-ONBOARDING · Criação de clínica pelo próprio profissional (elimina a intervenção manual).
-- SÓ BANCO nesta migration: UMA RPC SECURITY DEFINER — public.create_clinic_with_owner(text).
--
-- PROBLEMA: não existia caminho para criar a PRIMEIRA clínica. Cadastrar paciente exige ser
-- profissional; virar profissional exige um admin promover (promote_to_professional); admin é quem é
-- dono/clinic_role='admin' de uma clínica — mas NENHUMA função criava clínica. Resultado: cada clínica
-- nova dependia de intervenção manual no banco, e com o banco limpo nenhum fluxo podia ser testado.
--
-- DECISÕES DO ORQUESTRADOR (lei):
--  · Qualquer pessoa AUTENTICADA cria a SUA clínica (isolamento por clínica já provado no RLS; o risco
--    é comercial, não de vazamento — quem cria só enxerga a própria).
--  · GUARDA-CORPO: UMA clínica por perfil COMO DONO. Segunda tentativa ⇒ recusa clara
--    (errcode 42501, hint ALREADY_OWNS_CLINIC).
--  · O DONO vem SEMPRE do servidor: private.current_profile_id() ← auth.uid(). NUNCA de parâmetro do
--    cliente ⇒ dono NÃO forjável por construção (a assinatura não tem owner).
--  · Autoridade de admin = POSSE/clinic_role (AUTH-ADMIN-1). O ajuste de profiles.role/status é
--    COSMÉTICO (destrava a UI de "pendente"); private.is_clinic_admin NUNCA lê profiles.role.
--  · PORTÃO COMERCIAL (código de ativação / plano / aprovação da Vertexa) = decisão FUTURA do cliente.
--    NÃO implementado aqui. Há UM ÚNICO ponto de encaixe comentado (bloco "PORTÃO COMERCIAL" abaixo):
--    a checagem entra ali, antes de qualquer escrita, sem espalhar lógica.
--  · Transacional: função plpgsql única, SEM COMMIT interno e SEM swallow de exceção ⇒ cria a clínica,
--    a linha de professionals (dono, clinic_role='admin') e destrava o perfil TUDO-OU-NADA. Jamais deixa
--    clínica sem profissional dono nem profissional sem clínica (estado parcial trancaria a pessoa fora
--    do que ela mesma criou).
--
-- Campos mínimos coerentes na linha do dono (public.professionals — type é NOT NULL sem default):
--   type='other' (professional_type; a profissão real é ajustada depois), clinic_role='admin',
--   registry_number=NULL, specialty=NULL, profile_id=<chamador>, clinic_id=<nova clínica>.
-- Perfil do chamador (public.profiles): role='professional', status='active' (deixa de ser
--   'patient'/'pending' que handle_new_user cria no primeiro login).
--
-- VALIDAÇÃO DE ENTRADA (regras adotadas): nome obrigatório (btrim não-vazio); 2..120 caracteres.
--   (clinics só tem 'name' obrigatório — não há colunas de documento/endereço/contato no schema.)
--
-- SEGURANÇA: SECURITY DEFINER · search_path='' · EXECUTE só authenticated (revoke public/anon).
--   Nenhuma policy EXISTENTE alterada; nenhuma tabela/coluna/policy nova (a migration só ACRESCENTA a
--   função). NÃO cria caminho de auto-promoção em clínica ALHEIA (o chamador só cria a PRÓPRIA e vira
--   admin DELA). A migration NÃO é aplicada em produção neste WP (dry-run em ROLLBACK; PR sem merge).
--
-- ROLLBACK / KILL SWITCH (fail-closed — revogar EXECUTE já desativa a criação sem afetar o resto):
--   revoke execute on function public.create_clinic_with_owner(text) from authenticated;  -- desativa
--   drop function if exists public.create_clinic_with_owner(text);                          -- remove
-- =====================================================================================

create or replace function public.create_clinic_with_owner(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_profile_id();   -- AUTOR DO SERVIDOR (auth.uid()); jamais do cliente
  v_name   text := btrim(coalesce(p_name, ''));
  v_clinic uuid;
  v_prof   uuid;
begin
  -- 1) AUTENTICAÇÃO (autor derivado do servidor)
  if v_me is null then
    raise exception 'create_clinic_with_owner: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  -- ┌─ PORTÃO COMERCIAL — PONTO ÚNICO DE ENCAIXE (hoje NO-OP; NÃO implementar agora) ───────────────┐
  -- │ Quando a Vertexa definir o portão (código de ativação / plano / aprovação), a checagem entra   │
  -- │ EXCLUSIVAMENTE AQUI — antes de QUALQUER escrita — e deve LANÇAR exceção para bloquear:          │
  -- │     if not private.onboarding_allowed(v_me /*, p_activation_code */) then                      │
  -- │       raise exception 'create_clinic_with_owner: onboarding not permitted'                     │
  -- │         using errcode = '42501', hint = 'ONBOARDING_NOT_ALLOWED';                              │
  -- │     end if;                                                                                    │
  -- │ Um único ponto — não espalhar a lógica. (A assinatura pode ganhar p_activation_code no WP do   │
  -- │ portão; nada mais muda aqui: a web já trata erro por 'hint'.)                                  │
  -- └───────────────────────────────────────────────────────────────────────────────────────────────┘

  -- 2) GUARDA-CORPO: uma clínica por perfil COMO DONO
  if exists (select 1 from public.clinics c where c.owner_profile_id = v_me) then
    raise exception 'create_clinic_with_owner: profile already owns a clinic'
      using errcode = '42501', hint = 'ALREADY_OWNS_CLINIC';
  end if;

  -- 3) VALIDAÇÃO DE ENTRADA (nome obrigatório; 2..120 caracteres)
  if v_name = '' then
    raise exception 'create_clinic_with_owner: clinic name is required'
      using errcode = '22023', hint = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'create_clinic_with_owner: clinic name too short (min 2)'
      using errcode = '22023', hint = 'NAME_TOO_SHORT';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'create_clinic_with_owner: clinic name too long (max 120)'
      using errcode = '22023', hint = 'NAME_TOO_LONG';
  end if;

  -- 4) cria a CLÍNICA com owner_profile_id = perfil do CHAMADOR (servidor)
  insert into public.clinics (name, owner_profile_id)
  values (v_name, v_me)
  returning id into v_clinic;

  -- 5) cria a linha do DONO em professionals (clinic_role='admin'), campos mínimos coerentes
  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_me, v_clinic, 'other', 'admin')
  returning id into v_prof;

  -- 6) DESTRAVA o perfil: deixa de ser 'pending'/'patient' e reflete profissional.
  --    COSMÉTICO — a autoridade continua sendo posse/clinic_role (is_clinic_admin não lê profiles.role).
  update public.profiles
     set role = 'professional', status = 'active'
   where id = v_me;

  -- 7) ATÔMICO por construção (plpgsql; sem COMMIT/EXCEPTION interno) ⇒ tudo-ou-nada.
  return jsonb_build_object('clinic_id', v_clinic, 'professional_id', v_prof);
end
$$;

revoke all     on function public.create_clinic_with_owner(text) from public, anon;
grant  execute on function public.create_clinic_with_owner(text) to authenticated;

-- ── Ledger humano ──────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260801090000','20260801090000_wp_onboarding_create_clinic.sql',
  'WP-ONBOARDING: RPC create_clinic_with_owner (SECDEF, search_path vazio, EXECUTE so authenticated; '
  'revoke public/anon). Qualquer autenticado cria a SUA clinica; guarda-corpo de UMA clinica por perfil '
  'como DONO (hint ALREADY_OWNS_CLINIC); dono derivado do servidor (current_profile_id), nao forjavel; '
  'cria clinica + linha professionals (type=other, clinic_role=admin) + destrava perfil '
  '(role=professional/status=active, COSMETICO; autoridade = posse/clinic_role, AUTH-ADMIN-1); '
  'transacional tudo-ou-nada; ponto unico comentado para o PORTAO COMERCIAL futuro. Nenhuma policy '
  'existente alterada; nenhuma tabela nova.',
  'WP-ONBOARDING')
on conflict (version) do nothing;
