-- =====================================================================================
-- WP-DISC-FIX · O ADMIN da clínica pode atribuir/revogar disciplina a SI MESMO.
-- Destrava a CLÍNICA SOLO (profissional que administra a própria clínica — persona do plano de entrada).
--
-- PROBLEMA (impasse circular, confirmado no banco):
--   · create_clinic_with_owner (WP-ONBOARDING, PR #27) cria o dono como professional type='other',
--     SEM nenhuma linha em professional_disciplines.
--   · Sem disciplina ele não escreve NADA clínico — private.can_write_discipline (WP-DISC A) exige
--     posse de alguma disciplina do mapa (nutrition/workout/supplements/body_assessments).
--   · assign_professional_discipline NEGAVA auto-atribuição INCLUSIVE para o admin (bloco removido
--     abaixo), e numa clínica recém-criada não existe OUTRA pessoa para conceder.
--   ⇒ a clínica nascia TRAVADA: o dono não conseguia prescrever nada e não havia como destravar
--     sem intervenção manual no banco.
--
-- DECISÃO DO ORQUESTRADOR (lei):
--   · O ADMIN da clínica PODE atribuir E revogar disciplinas a SI MESMO.
--   · NÃO é escalada de privilégio: quem é admin já promove pessoas (promote_to_professional) e já
--     concede disciplina a TERCEIROS — poderia contornar o bloqueio criando um co-admin e pedindo a
--     concessão. O bloqueio não produzia segurança, só o impasse acima.
--   · PERMANECE NEGADO: profissional NÃO-admin atribuir/revogar a SI MESMO ou a QUALQUER pessoa.
--     Isso continua garantido pelo gate `private.is_clinic_admin(v_clinic)` que PRECEDE a escrita —
--     e é a razão de o bloco de self ser simplesmente REMOVIDO em vez de condicionado: quem chega
--     à linha seguinte JÁ PROVOU ser admin da clínica do profissional-alvo.
--   · Continua NEGADO atribuir a profissional de OUTRA clínica (o gate usa a clínica do ALVO).
--
-- ESCOPO EXATO DESTA MIGRATION (nada além disto):
--   ALTERA  public.assign_professional_discipline(uuid, text) — remove o bloco de auto-atribuição.
--   NÃO ALTERA public.revoke_professional_discipline(uuid, text): PROVADO no banco que ela NUNCA teve
--           trava de self — só exige is_clinic_admin. O auto-revogar do admin JÁ era permitido e
--           o não-admin JÁ era negado. Mexer nela seria mudança sem efeito (mantida intacta).
--   NÃO cria/edita/remove NENHUMA policy, tabela, coluna, índice, enum ou grant.
--
-- SEGURANÇA (inalterada em relação ao WP-DISC A): SECURITY DEFINER · search_path='' ·
--   EXECUTE só `authenticated` (reafirmado abaixo, idempotente) · anon/public sem EXECUTE.
--   A migration NÃO é aplicada em produção neste WP (dry-run em ROLLBACK; PR sem merge).
--
-- ROLLBACK (repõe EXATAMENTE o comportamento anterior — volta a negar o self, inclusive p/ admin;
-- ATENÇÃO: reintroduz o impasse da clínica solo):
--   create or replace function public.assign_professional_discipline(p_professional_id uuid, p_discipline text)
--   returns void language plpgsql security definer set search_path = '' as $rb$
--   declare v_clinic uuid;
--   begin
--     if private.current_profile_id() is null then
--       raise exception 'assign_professional_discipline: not authenticated' using errcode = '42501';
--     end if;
--     select clinic_id into v_clinic from public.professionals where id = p_professional_id;
--     if v_clinic is null then
--       raise exception 'assign_professional_discipline: professional not found' using errcode = 'P0002';
--     end if;
--     if not private.is_clinic_admin(v_clinic) then
--       raise exception 'assign_professional_discipline: only clinic admin can assign' using errcode = '42501';
--     end if;
--     if exists (select 1 from public.professionals where id = p_professional_id and profile_id = private.current_profile_id()) then
--       raise exception 'assign_professional_discipline: self-assignment is not allowed' using errcode = '42501';
--     end if;
--     if not exists (select 1 from public.disciplines where code = p_discipline) then
--       raise exception 'assign_professional_discipline: unknown discipline %', p_discipline using errcode = '22023';
--     end if;
--     insert into public.professional_disciplines (professional_id, discipline, granted_by)
--     values (p_professional_id, p_discipline, private.current_profile_id())
--     on conflict (professional_id, discipline) do nothing;
--   end $rb$;
--   delete from public.schema_migration_log where version = '20260802090000';
--
-- KILL SWITCH (fail-closed — desliga TODA a concessão de disciplina, não só o self):
--   revoke execute on function public.assign_professional_discipline(uuid, text) from authenticated;
-- =====================================================================================

create or replace function public.assign_professional_discipline(p_professional_id uuid, p_discipline text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_clinic uuid;
begin
  if private.current_profile_id() is null then
    raise exception 'assign_professional_discipline: not authenticated' using errcode = '42501';
  end if;

  -- A clínica é sempre a do profissional-ALVO (nunca a do chamador) — é o que impede conceder em
  -- clínica alheia.
  select clinic_id into v_clinic from public.professionals where id = p_professional_id;
  if v_clinic is null then
    raise exception 'assign_professional_discipline: professional not found' using errcode = 'P0002';
  end if;

  -- ÚNICO gate de autoridade: SÓ admin da clínica do profissional-alvo (dono OU clinic_role='admin',
  -- AUTH-ADMIN-1). Bloqueia não-admin (para si E para terceiros) e bloqueia clínica alheia.
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'assign_professional_discipline: only clinic admin can assign' using errcode = '42501';
  end if;

  -- WP-DISC-FIX: o bloco que negava AUTO-ATRIBUIÇÃO foi REMOVIDO daqui (era o que travava a clínica
  -- solo). Não há condição a acrescentar: quem alcança esta linha já passou pelo gate de admin acima,
  -- logo o self só é possível para o ADMIN da clínica do alvo — exatamente a decisão. O NÃO-admin
  -- continua negado (para si e para qualquer um) pelo mesmo gate.

  if not exists (select 1 from public.disciplines where code = p_discipline) then
    raise exception 'assign_professional_discipline: unknown discipline %', p_discipline using errcode = '22023';
  end if;

  insert into public.professional_disciplines (professional_id, discipline, granted_by)
  values (p_professional_id, p_discipline, private.current_profile_id())
  on conflict (professional_id, discipline) do nothing;   -- concede INDIVIDUALMENTE; idempotente
end $$;

-- Reafirma o grant original (idempotente; `create or replace` já o preserva — explícito p/ auditoria).
revoke all     on function public.assign_professional_discipline(uuid, text) from public, anon;
grant  execute on function public.assign_professional_discipline(uuid, text) to authenticated;

-- ── Ledger humano ──────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260802090000','20260802090000_wp_disc_fix_admin_self_assign.sql',
  'WP-DISC-FIX: o ADMIN da clinica passa a poder atribuir disciplina a SI MESMO (remove o bloco de '
  'auto-atribuicao de assign_professional_discipline). Destrava a CLINICA SOLO: create_clinic_with_owner '
  'cria o dono sem disciplina, sem disciplina ele nao escreve nada clinico (WP-DISC A) e numa clinica '
  'nova nao ha outra pessoa para conceder. NAO e escalada: admin ja promove pessoas e ja concede a '
  'terceiros. PERMANECE NEGADO: nao-admin atribuir a si ou a terceiros, e admin atribuir em clinica '
  'alheia (gate private.is_clinic_admin da clinica do ALVO, inalterado). revoke_professional_discipline '
  'NAO foi alterada (nunca teve trava de self). Nenhuma policy/tabela/coluna/indice alterados.',
  'WP-DISC-FIX')
on conflict (version) do nothing;
