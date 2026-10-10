-- WP-PATIENT-DIAG-DELETE-01
-- Exclusão DEFINITIVA de cadastro de paciente NÃO UTILIZADO (cadastro acidental/duplicado).
--
-- Hard delete só quando AMBAS as condições valem (AND, nunca OR):
--   1. nenhuma identidade de acesso estabelecida, em conflito ou ambígua;
--   2. nenhuma movimentação significativa na plataforma.
-- Casos com Auth (inclusive pending duplicado, e-mail divergente) são reconciliação de identidade
-- e NÃO passam por aqui — a exclusão nunca é atalho para "consertar" login.
--
-- Inventário (catálogo de produção, 2026-10-10):
--   CREATION_SCAFFOLDING (removível): professional_patient_links criado pelo create_patient
--     (1 link, ativo, interno, nunca alterado, sem ppl_status_events); chat_channels criado sob
--     demanda por get_or_create_channel SEM mensagens/notificações (+ chat_participants do roster).
--   MEANINGFUL_ACTIVITY (bloqueia): todo o restante que referencia patients.id / o profile.
--   AUDIT_RECORD (preservado): patient_registration_events (sem FK de propósito) e a nova
--     patient_registration_deletions.
--   IDENTITY_DEPENDENCY (bloqueia): auth_user_id, auth.users/auth.identities por e-mail
--     (normalizado exato OU chave de risco gmail.com), outros profiles com o mesmo e-mail, papéis/vínculos do profile.
--
-- 1) private.destructive_identity_risk_key(text)        — chave de RISCO (só para NEGAR; nunca casa identidade)
-- 2) private.patient_deletion_assessment(uuid)     — avaliação interna (sem checagem de autoridade)
-- 3) public.patient_registration_deletions          — auditoria append-only, sem PII
-- 4) public.get_patient_deletion_eligibility(uuid) — leitura admin-only, sanitizada
-- 5) public.delete_unused_patient_registration(uuid) — única operação de escrita
--
-- Não toca billing / Asaas / entitlements. Nunca altera nem apaga auth.users / auth.identities.


-- =====================================================================================
-- 1. Chave de RISCO de identidade para ação destrutiva (NÃO é chave de identidade)
-- =====================================================================================
-- A chave de identidade do Vertexa continua sendo lower(btrim(email)), igualdade EXATA
-- (handle_new_user, ensure_auth_profile, create_patient, update_patient_registration: intocados).
--
-- Esta função existe só para dizer "PODE existir identidade relacionada → NEGAR hard delete".
-- Nunca para dizer "é a mesma identidade → vincular/mesclar/claimar".
-- Motivo (incidente Alan, 2026-10-10): cadastro "al.mosena@gmail.com", Google autenticou
-- "almosena@gmail.com" (mesma caixa Gmail); o claim exato (corretamente) não vinculou e nasceu
-- um profile pending. A exclusão do cadastro clínico nesse estado destruiria o registro real.
--
-- Escopo deliberadamente estreito: domínio EXATAMENTE gmail.com, local-part sem pontos.
-- Sem +tag, sem googlemail.com, sem domínios Google Workspace, sem nenhum outro domínio
-- (john.smith@example.com e johnsmith@example.com continuam DIFERENTES).
create or replace function private.destructive_identity_risk_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or btrim(p_email) = '' then null
    when split_part(lower(btrim(p_email)), '@', 2) = 'gmail.com'
      and array_length(string_to_array(lower(btrim(p_email)), '@'), 1) = 2
      then replace(split_part(lower(btrim(p_email)), '@', 1), '.', '') || '@gmail.com'
    else lower(btrim(p_email))
  end
$$;

comment on function private.destructive_identity_risk_key(text) is
  'PATIENT-DIAG-DELETE-01: chave de RISCO para negar ação destrutiva (gmail.com sem pontos no '
  'local-part; demais domínios = lower(btrim)). NÃO é chave de identidade: nunca usar em claim, '
  'vínculo, merge, matching de profile ou edição de e-mail.';

revoke all on function private.destructive_identity_risk_key(text) from public, anon, authenticated, service_role;


-- =====================================================================================
-- 2. Avaliação interna de elegibilidade (sem autoridade: quem chama já provou admin)
-- =====================================================================================
create or replace function private.patient_deletion_assessment(p_patient_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_profile   uuid;
  v_clinic    uuid;
  v_auth      uuid;
  v_email     text;
  v_norm      text;
  v_risk     text;
  v_role      text;
  v_avatar    text;
  v_auth_linked   boolean;
  v_conflict      boolean;
  v_ambiguous     boolean;
  v_clinical      boolean;
  v_plans         boolean;
  v_documents     boolean;
  v_messages      boolean;
  v_activity      boolean;
  v_blockers  text[] := '{}';
begin
  select pt.profile_id, pt.clinic_id into v_profile, v_clinic
    from public.patients pt where pt.id = p_patient_id;
  if v_profile is null then
    return null;
  end if;

  select pr.auth_user_id, pr.email, pr.role::text, pr.avatar_path
    into v_auth, v_email, v_role, v_avatar
    from public.profiles pr where pr.id = v_profile;
  v_norm  := nullif(lower(btrim(coalesce(v_email, ''))), '');
  v_risk := private.destructive_identity_risk_key(v_email);

  -- ---------- identidade ----------
  v_auth_linked := v_auth is not null;

  v_conflict := v_norm is not null and (
    exists (
      select 1 from auth.users u
       where u.email is not null
         and (lower(btrim(u.email)) = v_norm or private.destructive_identity_risk_key(u.email) = v_risk)
    )
    or exists (
      select 1 from auth.identities i
       where i.email is not null
         and (lower(btrim(i.email)) = v_norm or private.destructive_identity_risk_key(i.email) = v_risk)
    )
  );

  v_ambiguous :=
       v_role is distinct from 'patient'
    or (select count(*) from public.patients x where x.profile_id = v_profile) <> 1
    or exists (select 1 from public.professionals x where x.profile_id = v_profile)
    or exists (select 1 from public.clinics x where x.owner_profile_id = v_profile)
    or exists (select 1 from private.platform_admins x where x.profile_id = v_profile)
    or exists (select 1 from public.clinic_join_requests x where x.profile_id = v_profile or x.decided_by = v_profile)
    or exists (select 1 from private.clinic_creation_authorizations x
                where x.target_profile_id = v_profile or x.granted_by_profile_id = v_profile)
    or exists (select 1 from private.clinic_creation_requests x
                where x.requester_profile_id = v_profile or x.decided_by_profile_id = v_profile)
    or (v_norm is not null and exists (
          select 1 from public.profiles o
           where o.id <> v_profile
             and o.email is not null
             and (lower(btrim(o.email)) = v_norm or private.destructive_identity_risk_key(o.email) = v_risk)
        ));

  -- ---------- movimentação ----------
  v_clinical :=
       exists (select 1 from public.body_assessments x where x.patient_id = p_patient_id)
    or exists (select 1 from public.weight_logs x where x.patient_id = p_patient_id)
    or exists (select 1 from public.muscle_recovery_states x where x.patient_id = p_patient_id)
    or exists (select 1 from public.adherence_snapshots x where x.patient_id = p_patient_id);

  v_plans :=
       exists (select 1 from public.workout_plans x where x.patient_id = p_patient_id)
    or exists (select 1 from public.nutrition_plans x where x.patient_id = p_patient_id)
    or exists (select 1 from public.supplements x where x.patient_id = p_patient_id);

  v_documents :=
       v_avatar is not null
    or exists (select 1 from public.patient_documents x where x.patient_id = p_patient_id)
    or exists (select 1 from public.progress_photos x where x.patient_id = p_patient_id)
    or exists (select 1 from public.report_exports x where x.patient_id = p_patient_id)
    or exists (select 1 from public.media_pieces x where x.patient_id = p_patient_id)
    or exists (select 1 from public.media_consents x where x.patient_id = p_patient_id);

  v_messages :=
       exists (select 1 from public.chat_messages m
                 join public.chat_channels c on c.id = m.channel_id
                where c.patient_id = p_patient_id)
    or exists (select 1 from public.chat_messages m where m.sender_profile_id = v_profile)
    or exists (select 1 from public.chat_mentions x where x.mentioned_profile_id = v_profile)
    or exists (select 1 from public.staff_notifications x
                where x.patient_id = p_patient_id
                   or x.recipient_profile_id = v_profile
                   or x.actor_profile_id = v_profile
                   or x.channel_id in (select c.id from public.chat_channels c where c.patient_id = p_patient_id))
    or exists (select 1 from public.chat_participants cp
                where cp.profile_id = v_profile
                  and cp.channel_id not in (select c.id from public.chat_channels c where c.patient_id = p_patient_id));

  v_activity :=
       exists (select 1 from public.activity_events x where x.patient_id = p_patient_id)
    or exists (select 1 from public.activity_sessions x where x.patient_id = p_patient_id)
    or exists (select 1 from public.meal_logs x where x.patient_id = p_patient_id)
    or exists (select 1 from public.workout_session_logs x where x.patient_id = p_patient_id)
    or exists (select 1 from public.supplement_intakes x where x.patient_id = p_patient_id)
    or exists (select 1 from public.patient_achievements x where x.patient_id = p_patient_id)
    or exists (select 1 from public.notifications x where x.patient_id = p_patient_id)
    or exists (select 1 from public.appointments x where x.patient_id = p_patient_id)
    or exists (select 1 from public.patient_journey_state x where x.patient_id = p_patient_id)
    or exists (select 1 from public.patient_journey_moves x where x.patient_id = p_patient_id)
    or exists (select 1 from public.journey_milestone_ack x where x.patient_id = p_patient_id)
    or exists (select 1 from public.ppl_status_events x where x.patient_id = p_patient_id)
    -- scaffolding do create_patient = no máximo 1 vínculo, ativo, interno, nunca alterado
    or (select count(*) from public.professional_patient_links l where l.patient_id = p_patient_id) > 1
    or exists (select 1 from public.professional_patient_links l
                where l.patient_id = p_patient_id
                  and (l.status is distinct from 'active' or l.is_external
                       or l.status_changed_at is not null or l.status_changed_by is not null));

  -- ordem = prioridade da razão principal (identidade antes de movimentação)
  if v_auth_linked then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_AUTH_LINKED'); end if;
  if v_conflict    then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_AUTH_EMAIL_CONFLICT'); end if;
  if v_ambiguous   then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_AMBIGUOUS_IDENTITY'); end if;
  if v_clinical    then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_HAS_CLINICAL_DATA'); end if;
  if v_plans       then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_HAS_PLANS'); end if;
  if v_documents   then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_HAS_DOCUMENTS'); end if;
  if v_messages    then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_HAS_MESSAGES'); end if;
  if v_activity    then v_blockers := array_append(v_blockers, 'PATIENT_DELETE_HAS_ACTIVITY'); end if;

  return jsonb_build_object(
    'patient_id', p_patient_id,
    'profile_id', v_profile,
    'clinic_id', v_clinic,
    'eligible', coalesce(array_length(v_blockers, 1), 0) = 0,
    'reason', coalesce(v_blockers[1], 'PATIENT_DELETE_ELIGIBLE'),
    'blockers', to_jsonb(v_blockers),
    'identity', jsonb_build_object(
      'auth_linked', v_auth_linked,
      'email_conflict', v_conflict,
      'ambiguous', v_ambiguous
    ),
    'activity', jsonb_build_object(
      'clinical_data', v_clinical,
      'plans', v_plans,
      'documents', v_documents,
      'messages', v_messages,
      'other', v_activity
    )
  );
end;
$$;

comment on function private.patient_deletion_assessment(uuid) is
  'PATIENT-DIAG-DELETE-01: avaliação interna (identidade AND movimentação). Sem autoridade própria; '
  'chamada apenas pelas RPCs públicas depois de provar admin da clínica do paciente.';

revoke all on function private.patient_deletion_assessment(uuid) from public, anon, authenticated, service_role;


-- =====================================================================================
-- 3. Auditoria da exclusão (append-only, sem PII, sem FK: sobrevive ao paciente/profile)
-- =====================================================================================
create table if not exists public.patient_registration_deletions (
  id                        uuid primary key default gen_random_uuid(),
  patient_id                uuid not null,
  profile_id                uuid not null,
  clinic_id                 uuid not null,
  actor_profile_id          uuid not null,
  profile_deleted           boolean not null,
  removed_links             int not null default 0,
  removed_empty_channels    int not null default 0,
  preserved_registration_events int not null default 0,
  created_at                timestamptz not null default now()
);

comment on table public.patient_registration_deletions is
  'PATIENT-DIAG-DELETE-01: append-only. Um registro por cadastro não utilizado excluído. Só ids e '
  'contagens de scaffolding; nunca nome, e-mail, valores clínicos, tokens. Sem FK de propósito.';

create index if not exists patient_registration_deletions_clinic_idx
  on public.patient_registration_deletions (clinic_id, created_at desc);

alter table public.patient_registration_deletions enable row level security;

drop policy if exists patient_registration_deletions_select_admin on public.patient_registration_deletions;
create policy patient_registration_deletions_select_admin
  on public.patient_registration_deletions
  for select
  to authenticated
  using (private.is_clinic_admin(clinic_id));

revoke all on table public.patient_registration_deletions from public, anon, authenticated;
grant select on table public.patient_registration_deletions to authenticated;


-- =====================================================================================
-- 4. Leitura de elegibilidade (admin da clínica DO PACIENTE; resultado sanitizado)
-- =====================================================================================
create or replace function public.get_patient_deletion_eligibility(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.current_profile_id();
  v_clinic uuid;
  v_a      jsonb;
begin
  if (select auth.uid()) is null or v_actor is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;
  if p_patient_id is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;

  select pt.clinic_id into v_clinic from public.patients pt where pt.id = p_patient_id;
  if v_clinic is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;

  -- sem autoridade: só a razão (nenhum detalhe do paciente vaza)
  if not private.is_clinic_admin(v_clinic) then
    return jsonb_build_object(
      'eligible', false,
      'reason', case
        when exists (select 1 from public.professionals pr
                      where pr.clinic_id = v_clinic and pr.profile_id = v_actor
                        and coalesce(pr.status, 'active') = 'active')
          then 'PATIENT_DELETE_NOT_ADMIN'
        else 'PATIENT_DELETE_FOREIGN_CLINIC'
      end
    );
  end if;

  v_a := private.patient_deletion_assessment(p_patient_id);
  return jsonb_build_object(
    'eligible',  (v_a->>'eligible')::boolean,
    'reason',    v_a->>'reason',
    'blockers',  v_a->'blockers',
    'identity',  v_a->'identity',
    'activity',  v_a->'activity'
  );
end;
$$;

comment on function public.get_patient_deletion_eligibility(uuid) is
  'PATIENT-DIAG-DELETE-01: elegibilidade de exclusão definitiva. Admin da clínica do paciente '
  '(derivada no servidor). Só booleanos e códigos; sem e-mail, nomes, ids de terceiros ou contagens clínicas.';

revoke all on function public.get_patient_deletion_eligibility(uuid) from public, anon;
grant execute on function public.get_patient_deletion_eligibility(uuid) to authenticated;


-- =====================================================================================
-- 5. delete_unused_patient_registration — única operação de exclusão
-- =====================================================================================
create or replace function public.delete_unused_patient_registration(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := private.current_profile_id();
  v_clinic    uuid;
  v_profile   uuid;
  v_email     text;
  v_norm      text;
  v_risk     text;
  v_k1        text;
  v_k2        text;
  v_pat       public.patients%rowtype;
  v_cur_email text;
  v_a         jsonb;
  v_links     int;
  v_channels  int;
  v_regev     int;
  v_n         int;
  -- fotografias para as pós-condições
  v_auth_users0    bigint;
  v_auth_ident0    bigint;
  v_patients0      bigint;
  v_profiles0      bigint;
  v_clinic_row0    text;
  v_other_pat0     text;
begin
  -- 1. autenticação
  if (select auth.uid()) is null or v_actor is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;
  if p_patient_id is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;

  -- 2. paciente / profile / clínica derivados no servidor (nunca do browser)
  select pt.clinic_id, pt.profile_id into v_clinic, v_profile
    from public.patients pt where pt.id = p_patient_id;
  if v_clinic is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;

  -- 3. autoridade: admin/owner ATIVO da clínica do paciente (platform admin não herda nada)
  if not private.clinic_is_operational(v_clinic) then
    raise exception 'forbidden: clinic not operational'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  if not private.is_clinic_admin(v_clinic) then
    if exists (select 1 from public.professionals pr
                where pr.clinic_id = v_clinic and pr.profile_id = v_actor
                  and coalesce(pr.status, 'active') = 'active') then
      raise exception 'forbidden: PATIENT_DELETE_NOT_ADMIN'
        using errcode = '42501', hint = 'PATIENT_DELETE_NOT_ADMIN';
    end if;
    raise exception 'forbidden: PATIENT_DELETE_FOREIGN_CLINIC'
      using errcode = '42501', hint = 'PATIENT_DELETE_FOREIGN_CLINIC';
  end if;

  -- 4. serialização de identidade: mesma chave advisory dos claim paths / edição de e-mail
  --    (advisory ANTES de qualquer lock de linha; ordem determinística). A chave de risco gmail.com
  --    também serializa com o 1º login de um endereço "sem ponto" (caso Alan).
  select pr.email into v_email from public.profiles pr where pr.id = v_profile;
  v_norm  := nullif(lower(btrim(coalesce(v_email, ''))), '');
  v_risk := private.destructive_identity_risk_key(v_email);
  if v_norm is not null then
    v_k1 := least(v_norm, v_risk);
    v_k2 := greatest(v_norm, v_risk);
    perform private.identity_email_lock(v_k1);
    if v_k2 is distinct from v_k1 then
      perform private.identity_email_lock(v_k2);
    end if;
  end if;

  -- 5. locks de linha: paciente (conflita com o FOR KEY SHARE de TODO insert que referencia
  --    patients.id por FK), profile, vínculos e canal (conflita com insert de mensagem/notificação).
  select * into v_pat from public.patients pt where pt.id = p_patient_id for update;
  if v_pat.id is null then
    -- outra transação excluiu primeiro: resultado determinístico
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;
  select pr.email into v_cur_email from public.profiles pr where pr.id = v_profile for update;
  if v_pat.clinic_id is distinct from v_clinic or v_pat.profile_id is distinct from v_profile
     or nullif(lower(btrim(coalesce(v_cur_email, ''))), '') is distinct from v_norm then
    raise exception 'registration changed concurrently'
      using errcode = '40001', hint = 'PATIENT_CHANGED_CONCURRENTLY';
  end if;
  perform 1 from public.professional_patient_links l where l.patient_id = p_patient_id for update;
  perform 1 from public.chat_channels c where c.patient_id = p_patient_id for update;

  -- 6. elegibilidade RECALCULADA sob lock, dentro da transação de escrita
  v_a := private.patient_deletion_assessment(p_patient_id);
  if v_a is null then
    raise exception 'patient not found' using errcode = 'P0002', hint = 'PATIENT_NOT_FOUND';
  end if;
  if not (v_a->>'eligible')::boolean then
    raise exception 'patient registration not deletable: %', v_a->>'reason'
      using errcode = '55000', hint = v_a->>'reason';
  end if;

  -- fotografias para as pós-condições
  select count(*) into v_auth_users0 from auth.users;
  select count(*) into v_auth_ident0 from auth.identities;
  select count(*) into v_patients0 from public.patients;
  select count(*) into v_profiles0 from public.profiles;
  select md5(c::text) into v_clinic_row0 from public.clinics c where c.id = v_clinic;
  select md5(coalesce(string_agg(pt::text, '|' order by pt.id), '')) into v_other_pat0
    from public.patients pt where pt.clinic_id = v_clinic and pt.id <> p_patient_id;
  select count(*) into v_regev from public.patient_registration_events e where e.patient_id = p_patient_id;

  -- 7. remove SOMENTE scaffolding provado + paciente + profile não utilizado.
  --    Qualquer FK NO ACTION/RESTRICT inesperada aborta TUDO (fail-closed).
  begin
    delete from public.chat_channels c where c.patient_id = p_patient_id;  -- + chat_participants (cascade)
    get diagnostics v_channels = row_count;
    delete from public.professional_patient_links l where l.patient_id = p_patient_id;
    get diagnostics v_links = row_count;
    delete from public.patients pt where pt.id = p_patient_id;
    delete from public.profiles pr where pr.id = v_profile and pr.auth_user_id is null;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'invariant: profile not deleted' using errcode = 'XX001';
    end if;
  exception
    when foreign_key_violation then
      raise exception 'patient registration has dependent records'
        using errcode = '55000', hint = 'PATIENT_DELETE_HAS_ACTIVITY';
  end;

  -- 8. auditoria (trilha anterior preservada; nenhuma linha de patient_registration_events é tocada)
  insert into public.patient_registration_deletions
    (patient_id, profile_id, clinic_id, actor_profile_id, profile_deleted,
     removed_links, removed_empty_channels, preserved_registration_events)
  values
    (p_patient_id, v_profile, v_clinic, v_actor, true, v_links, v_channels, v_regev);

  -- 9. pós-condições (qualquer falha desfaz tudo)
  if exists (select 1 from public.patients pt where pt.id = p_patient_id) then
    raise exception 'invariant: patient still exists' using errcode = 'XX001';
  end if;
  if exists (select 1 from public.profiles pr where pr.id = v_profile) then
    raise exception 'invariant: profile still exists' using errcode = 'XX001';
  end if;
  if (select count(*) from auth.users) <> v_auth_users0 then
    raise exception 'invariant: auth.users changed' using errcode = 'XX001';
  end if;
  if (select count(*) from auth.identities) <> v_auth_ident0 then
    raise exception 'invariant: auth.identities changed' using errcode = 'XX001';
  end if;
  if (select count(*) from public.patients) <> v_patients0 - 1 then
    raise exception 'invariant: other patients changed' using errcode = 'XX001';
  end if;
  if (select count(*) from public.profiles) <> v_profiles0 - 1 then
    raise exception 'invariant: other profiles changed' using errcode = 'XX001';
  end if;
  if (select md5(c::text) from public.clinics c where c.id = v_clinic) is distinct from v_clinic_row0 then
    raise exception 'invariant: clinic changed' using errcode = 'XX001';
  end if;
  if (select md5(coalesce(string_agg(pt::text, '|' order by pt.id), ''))
        from public.patients pt where pt.clinic_id = v_clinic) is distinct from v_other_pat0 then
    raise exception 'invariant: clinic patients changed' using errcode = 'XX001';
  end if;
  if (select count(*) from public.patient_registration_events e where e.patient_id = p_patient_id) <> v_regev then
    raise exception 'invariant: registration audit changed' using errcode = 'XX001';
  end if;
  if exists (select 1 from public.professional_patient_links l where l.patient_id = p_patient_id)
     or exists (select 1 from public.chat_channels c where c.patient_id = p_patient_id) then
    raise exception 'invariant: scaffolding left behind' using errcode = 'XX001';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'patient_id', p_patient_id,
    'profile_deleted', true
  );
end;
$$;

comment on function public.delete_unused_patient_registration(uuid) is
  'PATIENT-DIAG-DELETE-01: exclusão definitiva de cadastro NÃO utilizado. Admin/owner ativo da '
  'clínica do paciente (derivada no servidor). Exige: sem Auth/conflito/ambiguidade de identidade '
  'AND sem movimentação; recalcula sob lock (advisory de identidade + FOR UPDATE no paciente/canal). '
  'Remove só scaffolding provado (vínculo do create_patient, canal vazio). Nunca toca auth.*, billing. '
  'Retorno sem PII. Segunda chamada: PATIENT_NOT_FOUND.';

revoke all on function public.delete_unused_patient_registration(uuid) from public, anon;
grant execute on function public.delete_unused_patient_registration(uuid) to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20261010120000',
  '20261010120000_wp_patient_diag_delete_01_unused_patient_delete.sql',
  'PATIENT-DIAG-DELETE-01: delete_unused_patient_registration + get_patient_deletion_eligibility + '
  'patient_registration_deletions (auditoria); destructive_identity_risk_key só para negar.',
  'PATIENT-DIAG-DELETE-01'
);
