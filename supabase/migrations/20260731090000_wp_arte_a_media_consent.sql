-- =====================================================================================
-- WP-ARTE · A — Modelo de dados: peça, consentimento POR PEÇA E POR VERSÃO, canais, termo, auditoria.
-- SÓ BANCO (tabelas, policies, RPCs, seed). SEM interface/render/notificação (etapas posteriores).
--
-- LEI DO CLIENTE: consentimento é POR PEÇA e POR VERSÃO (nunca genérico); autoriza o PACIENTE no app,
-- OU registro PRESENCIAL pela clínica (método/data/responsável/termo/comprovação, DISTINGUÍVEL do app);
-- validade 12 meses OU até revogação; escopo travado (peça+versão exata+canais selecionados+clínica/
-- profissionais); revogação pelo paciente sozinho, sem justificativa; auditoria preservada e NUNCA
-- reutilizável como ativa; alteração relevante ⇒ NOVA autorização.
--
-- DECISÕES DO ORQUESTRADOR (lei):
--  D1 — DOIS NÍVEIS: mudança na PEÇA (imagem/texto/inclusão de peso/medidas/%/VRI/resultado/troca de
--       clínica ou profissional) ⇒ NOVA VERSÃO + novo consentimento; mudança no USO (incluir canal,
--       virar anúncio pago, mudar finalidade) ⇒ NOVO CONSENTIMENTO sobre a MESMA versão. version_no
--       explícito + content_hash como guarda de consistência (detecta divergência).
--  D2 — CANAIS em TABELA (não constante), semeada: instagram, site, whatsapp, tela_interna, impresso,
--       anuncio_pago (anuncio_pago = canal separado, is_paid_ad). Extensível sem migration (INSERT).
--  D3 — TRÊS FRONTEIRAS: GERIR (staff interno vinculado/admin: vê e cria rascunho SEM consentimento);
--       DECIDIR (paciente dono: vê a própria peça pendente para consentir informado — ver ≠ usar);
--       USAR (baixar/publicar: exige consentimento ATIVO para AQUELE canal, via função canônica).
--  D4 — MENOR bloqueado nesta fase: birth_date indica menor OU birth_date NULA ⇒ concessão NEGADA com
--       erro claro ("requer modelo de responsável legal"). Modelo de representante vem depois.
--  D5 — AVISO 30 DIAS: destino = alertas da clínica (etapa D). AQUI: só garantir que "consents que
--       expiram em N dias" seja consultável (public.media_consents_expiring). Tabela de alertas + job = D.
--  D6 — LINK ASSINADO: 300s (5 min) p/ material publicável (link emitido NÃO é revogável, só expira).
--       Limitação documentada p/ constar no termo ao paciente (seed do termo v1).
--
-- V1 SEM FOTO (decisão do orquestrador): media_piece_versions PREVÊ has_before_after_photo/
-- photo_asset_path (para o futuro) mas as RPCs V1 os fixam em false/null — nenhuma peça com foto é
-- gerada nesta fase (e sem INSERT direto de client: escrita só por RPC).
--
-- SEGURANÇA: escrita de ESTADO só por RPC SECURITY DEFINER (search_path='', EXECUTE só authenticated,
-- autor DERIVADO DO SERVIDOR — anti-forja). Nenhuma policy EXISTENTE alterada. Helpers/checagens em
-- `private` (SECDEF, search_path='', fora da Data API). "Impossível usar sem consentimento ATIVO" — a
-- checagem vive no banco (função canônica), não na interface.
--
-- ROLLBACK (kill switch — fail-closed; dropar remove TODO o modelo → nada usável, deny-by-absence):
--   drop function if exists public.media_consents_expiring(int);
--   drop function if exists public.media_use_check(uuid,text);
--   drop function if exists public.media_consent_revoke(uuid,text);
--   drop function if exists public.media_consent_record_in_person(uuid,text[],uuid,text,timestamptz,text,text,boolean);
--   drop function if exists public.media_consent_grant_app(uuid,text[],uuid,text,boolean);
--   drop function if exists public.media_piece_new_version(uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text,uuid[]);
--   drop function if exists public.media_piece_create(uuid,text,uuid,text,jsonb,boolean,boolean,boolean,boolean,boolean,text,uuid[]);
--   drop function if exists private.media_version_channel_usable(uuid,text);
--   drop function if exists private.consent_blocked_by_age(uuid);
--   drop function if exists private.media_consent_patient(uuid);
--   drop function if exists private.media_version_patient(uuid);
--   drop function if exists private.media_piece_patient(uuid);
--   drop table if exists public.media_consent_channels, public.media_consents, public.media_consent_terms,
--     public.media_piece_version_professionals, public.media_piece_versions, public.media_pieces,
--     public.media_channels cascade;
-- =====================================================================================

-- ── Canais (D2: tabela, extensível sem migration) ─────────────────────────────────────
create table if not exists public.media_channels (
  code       text primary key,
  label      text not null,
  is_paid_ad boolean not null default false,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ── Peça (casca estável) + VERSÃO (imutável) + profissionais destacados ────────────────
create table if not exists public.media_pieces (
  id                    uuid primary key default gen_random_uuid(),
  patient_id            uuid not null references public.patients(id) on delete cascade,
  clinic_id             uuid not null references public.clinics(id) on delete cascade,
  origin_kind           text not null,            -- 'journey_milestone'|'achievement'|'progress_numbers'|'manual'
  origin_ref            uuid,                     -- id do marco/conquista de origem (opcional)
  internal_title        text not null,
  created_by_profile_id uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);
create index if not exists idx_media_pieces_patient on public.media_pieces (patient_id);
create index if not exists idx_media_pieces_clinic  on public.media_pieces (clinic_id);

create table if not exists public.media_piece_versions (
  id                     uuid primary key default gen_random_uuid(),
  piece_id               uuid not null references public.media_pieces(id) on delete cascade,
  version_no             integer not null,
  content                jsonb not null default '{}'::jsonb,   -- conteúdo ESTRUTURADO (números/marcos/conquistas/depoimento)
  shows_weight           boolean not null default false,
  shows_measures         boolean not null default false,
  shows_body_fat_pct     boolean not null default false,
  shows_vri              boolean not null default false,
  shows_result           boolean not null default false,
  has_before_after_photo boolean not null default false,       -- PREVISTO p/ futuro; V1 sempre false
  photo_asset_path       text,                                 -- PREVISTO p/ futuro; V1 sempre null
  purpose                text,
  content_hash           text not null,                        -- md5 canônico (guarda de consistência D1)
  created_by_profile_id  uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  unique (piece_id, version_no)
);
create index if not exists idx_media_piece_versions_piece on public.media_piece_versions (piece_id, version_no desc);

create table if not exists public.media_piece_version_professionals (
  version_id      uuid not null references public.media_piece_versions(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  primary key (version_id, professional_id)
);
create index if not exists idx_media_ppv_professional on public.media_piece_version_professionals (professional_id);

-- ── Termo versionado (texto IMUTÁVEL por versão) ──────────────────────────────────────
create table if not exists public.media_consent_terms (
  id                    uuid primary key default gen_random_uuid(),
  version_no            integer not null unique,
  body                  text not null,
  effective_from        timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);

-- ── Consentimento (amarrado à VERSÃO exata) + canais selecionados ─────────────────────
create table if not exists public.media_consents (
  id                               uuid primary key default gen_random_uuid(),
  piece_version_id                 uuid not null references public.media_piece_versions(id) on delete cascade,
  patient_id                       uuid not null references public.patients(id) on delete cascade,
  granted_by_kind                  text not null check (granted_by_kind in ('patient','legal_guardian')),
  granted_by_profile_id            uuid references public.profiles(id),
  origin                           text not null check (origin in ('app','in_person')),
  in_person_method                 text,
  in_person_obtained_at            timestamptz,
  in_person_recorded_by_profile_id uuid references public.profiles(id),
  in_person_proof_path             text,
  term_version_id                  uuid not null references public.media_consent_terms(id),
  purpose                          text,
  is_sponsored_ad                  boolean not null default false,
  granted_at                       timestamptz not null default now(),
  expires_at                       timestamptz not null,
  status                           text not null default 'authorized'
                                     check (status in ('pending','authorized','change_requested','refused','revoked','expired')),
  revoked_at                       timestamptz,
  revoke_reason                    text,
  created_by_profile_id            uuid references public.profiles(id),
  created_at                       timestamptz not null default now(),
  -- EXCEÇÃO PRESENCIAL: campos obrigatórios quando origin='in_person'; nulos quando origin='app'.
  -- ⇒ app × presencial DISTINGUÍVEL e verificável no banco.
  constraint media_consents_in_person_fields check (
    (origin = 'in_person'
      and in_person_method is not null and in_person_obtained_at is not null
      and in_person_recorded_by_profile_id is not null and in_person_proof_path is not null)
    or
    (origin = 'app'
      and in_person_method is null and in_person_obtained_at is null
      and in_person_recorded_by_profile_id is null and in_person_proof_path is null)
  )
);
create index if not exists idx_media_consents_version on public.media_consents (piece_version_id);
create index if not exists idx_media_consents_patient on public.media_consents (patient_id);
create index if not exists idx_media_consents_expiry  on public.media_consents (expires_at) where status = 'authorized';

create table if not exists public.media_consent_channels (
  consent_id   uuid not null references public.media_consents(id) on delete cascade,
  channel_code text not null references public.media_channels(code),
  primary key (consent_id, channel_code)
);
create index if not exists idx_media_consent_channels_channel on public.media_consent_channels (channel_code);

-- ── Helpers privados (SECDEF, search_path='', EXECUTE só authenticated, fora da Data API) ──
-- Resolvem peça/versão/consentimento → paciente SEM recursão de RLS (DEFINER bypassa RLS), como manda
-- o contrato de helpers do WP-05B (nenhum corpo de policy referencia tabela com RLS diretamente).
create or replace function private.media_piece_patient(p_piece uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select patient_id from public.media_pieces where id = p_piece $$;

create or replace function private.media_version_patient(p_version uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select mp.patient_id from public.media_piece_versions v
    join public.media_pieces mp on mp.id = v.piece_id where v.id = p_version $$;

create or replace function private.media_consent_patient(p_consent uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select patient_id from public.media_consents where id = p_consent $$;

-- D4: bloqueio por idade — menor OU birth_date NULA OU paciente inexistente ⇒ true (fail-closed).
create or replace function private.consent_blocked_by_age(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select birth_date is null or birth_date > (current_date - interval '18 years')
     from public.patients where id = p_patient),
    true) $$;

-- FUNÇÃO CANÔNICA (D3 USAR): "esta versão pode ser usada NESTE canal AGORA?" — status authorized,
-- não revogado, não expirado, canal selecionado. TODA decisão de uso passa por aqui (checagem no banco).
create or replace function private.media_version_channel_usable(p_version uuid, p_channel text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.media_consents c
    join public.media_consent_channels cc on cc.consent_id = c.id
    where c.piece_version_id = p_version
      and c.status = 'authorized'
      and c.revoked_at is null
      and c.expires_at > now()
      and cc.channel_code = p_channel) $$;

revoke all on function private.media_piece_patient(uuid)              from public, anon;
revoke all on function private.media_version_patient(uuid)            from public, anon;
revoke all on function private.media_consent_patient(uuid)            from public, anon;
revoke all on function private.consent_blocked_by_age(uuid)           from public, anon;
revoke all on function private.media_version_channel_usable(uuid,text) from public, anon;
grant  execute on function private.media_piece_patient(uuid)              to authenticated;
grant  execute on function private.media_version_patient(uuid)            to authenticated;
grant  execute on function private.media_consent_patient(uuid)            to authenticated;
grant  execute on function private.consent_blocked_by_age(uuid)           to authenticated;
grant  execute on function private.media_version_channel_usable(uuid,text) to authenticated;

-- ── RLS + grants + policies (escrita de ESTADO só por RPC; nenhuma policy de INSERT/UPDATE/DELETE) ──
alter table public.media_channels                    enable row level security;
alter table public.media_pieces                      enable row level security;
alter table public.media_piece_versions              enable row level security;
alter table public.media_piece_version_professionals enable row level security;
alter table public.media_consent_terms               enable row level security;
alter table public.media_consents                    enable row level security;
alter table public.media_consent_channels            enable row level security;

revoke all on public.media_channels                    from anon, authenticated;
revoke all on public.media_pieces                      from anon, authenticated;
revoke all on public.media_piece_versions              from anon, authenticated;
revoke all on public.media_piece_version_professionals from anon, authenticated;
revoke all on public.media_consent_terms               from anon, authenticated;
revoke all on public.media_consents                    from anon, authenticated;
revoke all on public.media_consent_channels            from anon, authenticated;

-- SÓ SELECT ao client (escrita é exclusiva das RPCs definer). anon: zero policy (negado).
grant select on public.media_channels                    to authenticated;
grant select on public.media_pieces                      to authenticated;
grant select on public.media_piece_versions              to authenticated;
grant select on public.media_piece_version_professionals to authenticated;
grant select on public.media_consent_terms               to authenticated;
grant select on public.media_consents                    to authenticated;
grant select on public.media_consent_channels            to authenticated;

-- Referência (canais/termo): leitura por qualquer authenticated (rótulos/termo). Sem escrita de client.
create policy media_channels_select on public.media_channels
  for select to authenticated using (true);
create policy media_consent_terms_select on public.media_consent_terms
  for select to authenticated using (true);

-- Peça/versão/profissionais: GERIR (staff interno/admin) + DECIDIR (paciente dono). EXTERNO EXCLUÍDO.
create policy media_pieces_select on public.media_pieces
  for select to authenticated using (private.can_access_patient_internal(patient_id));
create policy media_piece_versions_select on public.media_piece_versions
  for select to authenticated using (private.can_access_patient_internal(private.media_version_patient(id)));
create policy media_ppv_select on public.media_piece_version_professionals
  for select to authenticated using (private.can_access_patient_internal(private.media_version_patient(version_id)));

-- Consentimento/canais: paciente dono + staff interno/admin veem (status é preciso p/ saber se usável).
create policy media_consents_select on public.media_consents
  for select to authenticated using (private.can_access_patient_internal(patient_id));
create policy media_consent_channels_select on public.media_consent_channels
  for select to authenticated using (private.can_access_patient_internal(private.media_consent_patient(consent_id)));

-- ── RPC: criar peça + versão 1 (GERIR — staff interno vinculado/admin; paciente/externo negados) ──
create or replace function public.media_piece_create(
  p_patient_id uuid, p_origin_kind text, p_origin_ref uuid, p_internal_title text, p_content jsonb,
  p_shows_weight boolean default false, p_shows_measures boolean default false,
  p_shows_body_fat_pct boolean default false, p_shows_vri boolean default false,
  p_shows_result boolean default false, p_purpose text default null,
  p_professional_ids uuid[] default '{}'
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := private.current_profile_id(); v_clinic uuid; v_piece uuid; v_version uuid; v_hash text; pid uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_clinic := private.patient_clinic(p_patient_id);
  if v_clinic is null then raise exception 'media_piece_create: patient not found' using errcode = '22023'; end if;
  if not private.can_prescribe_for_patient(p_patient_id) then
    raise exception 'media_piece_create: not authorized' using errcode = '42501';
  end if;
  if btrim(coalesce(p_internal_title,'')) = '' then raise exception 'media_piece_create: title required' using errcode = '22023'; end if;
  insert into public.media_pieces (patient_id, clinic_id, origin_kind, origin_ref, internal_title, created_by_profile_id)
    values (p_patient_id, v_clinic, coalesce(nullif(btrim(p_origin_kind),''),'manual'), p_origin_ref, btrim(p_internal_title), v_me)
    returning id into v_piece;
  v_hash := md5(coalesce(p_content::text,'{}')
    || '|w'||p_shows_weight::text || '|m'||p_shows_measures::text || '|bf'||p_shows_body_fat_pct::text
    || '|vri'||p_shows_vri::text || '|r'||p_shows_result::text || '|p'||coalesce(p_purpose,'')
    || '|profs'||coalesce(array_to_string((select array_agg(x order by x) from unnest(p_professional_ids) x),','),''));
  insert into public.media_piece_versions (piece_id, version_no, content, shows_weight, shows_measures,
      shows_body_fat_pct, shows_vri, shows_result, has_before_after_photo, photo_asset_path, purpose, content_hash, created_by_profile_id)
    values (v_piece, 1, coalesce(p_content,'{}'::jsonb), p_shows_weight, p_shows_measures,
      p_shows_body_fat_pct, p_shows_vri, p_shows_result, false, null, p_purpose, v_hash, v_me)
    returning id into v_version;
  if p_professional_ids is not null then
    foreach pid in array p_professional_ids loop
      if exists (select 1 from public.professional_patient_links l
                 where l.professional_id = pid and l.patient_id = p_patient_id and coalesce(l.status,'active') = 'active') then
        insert into public.media_piece_version_professionals (version_id, professional_id)
          values (v_version, pid) on conflict do nothing;
      else
        raise exception 'media_piece_create: professional % not linked to patient', pid using errcode = '42501';
      end if;
    end loop;
  end if;
  return jsonb_build_object('piece_id', v_piece, 'version_id', v_version, 'version_no', 1);
end $$;
revoke all     on function public.media_piece_create(uuid,text,uuid,text,jsonb,boolean,boolean,boolean,boolean,boolean,text,uuid[]) from public, anon;
grant  execute on function public.media_piece_create(uuid,text,uuid,text,jsonb,boolean,boolean,boolean,boolean,boolean,text,uuid[]) to authenticated;

-- ── RPC: nova versão (D1 — alteração relevante de PEÇA; guarda content_hash detecta "sem mudança") ──
create or replace function public.media_piece_new_version(
  p_piece_id uuid, p_content jsonb,
  p_shows_weight boolean default false, p_shows_measures boolean default false,
  p_shows_body_fat_pct boolean default false, p_shows_vri boolean default false,
  p_shows_result boolean default false, p_purpose text default null,
  p_professional_ids uuid[] default '{}'
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := private.current_profile_id(); v_patient uuid; v_next int; v_hash text; v_prev text; v_version uuid; pid uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_patient := private.media_piece_patient(p_piece_id);
  if v_patient is null then raise exception 'media_piece_new_version: piece not found' using errcode = '22023'; end if;
  if not private.can_prescribe_for_patient(v_patient) then
    raise exception 'media_piece_new_version: not authorized' using errcode = '42501';
  end if;
  v_hash := md5(coalesce(p_content::text,'{}')
    || '|w'||p_shows_weight::text || '|m'||p_shows_measures::text || '|bf'||p_shows_body_fat_pct::text
    || '|vri'||p_shows_vri::text || '|r'||p_shows_result::text || '|p'||coalesce(p_purpose,'')
    || '|profs'||coalesce(array_to_string((select array_agg(x order by x) from unnest(p_professional_ids) x),','),''));
  select content_hash into v_prev from public.media_piece_versions where piece_id = p_piece_id order by version_no desc limit 1;
  if v_prev = v_hash then raise exception 'media_piece_new_version: no relevant change (content identical)' using errcode = '22023'; end if;
  select coalesce(max(version_no),0)+1 into v_next from public.media_piece_versions where piece_id = p_piece_id;
  insert into public.media_piece_versions (piece_id, version_no, content, shows_weight, shows_measures,
      shows_body_fat_pct, shows_vri, shows_result, has_before_after_photo, photo_asset_path, purpose, content_hash, created_by_profile_id)
    values (p_piece_id, v_next, coalesce(p_content,'{}'::jsonb), p_shows_weight, p_shows_measures,
      p_shows_body_fat_pct, p_shows_vri, p_shows_result, false, null, p_purpose, v_hash, v_me)
    returning id into v_version;
  if p_professional_ids is not null then
    foreach pid in array p_professional_ids loop
      if exists (select 1 from public.professional_patient_links l
                 where l.professional_id = pid and l.patient_id = v_patient and coalesce(l.status,'active') = 'active') then
        insert into public.media_piece_version_professionals (version_id, professional_id) values (v_version, pid) on conflict do nothing;
      else raise exception 'media_piece_new_version: professional % not linked', pid using errcode = '42501'; end if;
    end loop;
  end if;
  return jsonb_build_object('piece_id', p_piece_id, 'version_id', v_version, 'version_no', v_next);
end $$;
revoke all     on function public.media_piece_new_version(uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text,uuid[]) from public, anon;
grant  execute on function public.media_piece_new_version(uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text,uuid[]) to authenticated;

-- ── RPC: CONCEDER no app (DECIDIR — SÓ o PACIENTE dono; autor do servidor; 12 meses; D4 bloqueia menor) ──
create or replace function public.media_consent_grant_app(
  p_piece_version_id uuid, p_channels text[], p_term_version_id uuid,
  p_purpose text default null, p_is_sponsored_ad boolean default false
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_patient uuid; v_me_patient uuid := private.current_patient_id(); v_me uuid := private.current_profile_id(); v_consent uuid; v_ch text;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_patient := private.media_version_patient(p_piece_version_id);
  if v_patient is null then raise exception 'media_consent_grant_app: version not found' using errcode = '22023'; end if;
  if v_me_patient is null or v_me_patient <> v_patient then
    raise exception 'media_consent_grant_app: only the patient owner can grant' using errcode = '42501';
  end if;
  if private.consent_blocked_by_age(v_patient) then
    raise exception 'media_consent_grant_app: requires legal guardian model (minor or unknown birth_date)' using errcode = '42501';
  end if;
  if p_term_version_id is null or not exists (select 1 from public.media_consent_terms t where t.id = p_term_version_id) then
    raise exception 'media_consent_grant_app: invalid term version' using errcode = '22023';
  end if;
  if p_channels is null or array_length(p_channels,1) is null then
    raise exception 'media_consent_grant_app: at least one channel required' using errcode = '22023';
  end if;
  insert into public.media_consents (piece_version_id, patient_id, granted_by_kind, granted_by_profile_id, origin,
      term_version_id, purpose, is_sponsored_ad, granted_at, expires_at, status, created_by_profile_id)
    values (p_piece_version_id, v_patient, 'patient', v_me, 'app',
      p_term_version_id, p_purpose, coalesce(p_is_sponsored_ad,false), now(), now() + interval '12 months', 'authorized', v_me)
    returning id into v_consent;
  foreach v_ch in array p_channels loop
    if not exists (select 1 from public.media_channels mc where mc.code = v_ch and mc.active) then
      raise exception 'media_consent_grant_app: unknown/inactive channel %', v_ch using errcode = '22023';
    end if;
    insert into public.media_consent_channels (consent_id, channel_code) values (v_consent, v_ch) on conflict do nothing;
  end loop;
  return v_consent;
end $$;
revoke all     on function public.media_consent_grant_app(uuid,text[],uuid,text,boolean) from public, anon;
grant  execute on function public.media_consent_grant_app(uuid,text[],uuid,text,boolean) to authenticated;

-- ── RPC: registrar PRESENCIAL (exceção — STAFF registra; campos obrigatórios; origem 'in_person'; D4) ──
create or replace function public.media_consent_record_in_person(
  p_piece_version_id uuid, p_channels text[], p_term_version_id uuid,
  p_method text, p_obtained_at timestamptz, p_proof_path text,
  p_purpose text default null, p_is_sponsored_ad boolean default false
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_patient uuid; v_me uuid := private.current_profile_id(); v_patient_profile uuid; v_consent uuid; v_ch text; v_when timestamptz;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_patient := private.media_version_patient(p_piece_version_id);
  if v_patient is null then raise exception 'media_consent_record_in_person: version not found' using errcode = '22023'; end if;
  if not private.can_prescribe_for_patient(v_patient) then
    raise exception 'media_consent_record_in_person: only clinic staff can record' using errcode = '42501';
  end if;
  if private.consent_blocked_by_age(v_patient) then
    raise exception 'media_consent_record_in_person: requires legal guardian model (minor or unknown birth_date)' using errcode = '42501';
  end if;
  if btrim(coalesce(p_method,'')) = '' or p_obtained_at is null or btrim(coalesce(p_proof_path,'')) = '' then
    raise exception 'media_consent_record_in_person: method, obtained_at and proof_path are required' using errcode = '22023';
  end if;
  if p_term_version_id is null or not exists (select 1 from public.media_consent_terms t where t.id = p_term_version_id) then
    raise exception 'media_consent_record_in_person: invalid term version' using errcode = '22023';
  end if;
  if p_channels is null or array_length(p_channels,1) is null then
    raise exception 'media_consent_record_in_person: at least one channel required' using errcode = '22023';
  end if;
  select profile_id into v_patient_profile from public.patients where id = v_patient;
  v_when := coalesce(p_obtained_at, now());
  insert into public.media_consents (piece_version_id, patient_id, granted_by_kind, granted_by_profile_id, origin,
      in_person_method, in_person_obtained_at, in_person_recorded_by_profile_id, in_person_proof_path,
      term_version_id, purpose, is_sponsored_ad, granted_at, expires_at, status, created_by_profile_id)
    values (p_piece_version_id, v_patient, 'patient', v_patient_profile, 'in_person',
      btrim(p_method), v_when, v_me, btrim(p_proof_path),
      p_term_version_id, p_purpose, coalesce(p_is_sponsored_ad,false), v_when, v_when + interval '12 months', 'authorized', v_me)
    returning id into v_consent;
  foreach v_ch in array p_channels loop
    if not exists (select 1 from public.media_channels mc where mc.code = v_ch and mc.active) then
      raise exception 'media_consent_record_in_person: unknown/inactive channel %', v_ch using errcode = '22023';
    end if;
    insert into public.media_consent_channels (consent_id, channel_code) values (v_consent, v_ch) on conflict do nothing;
  end loop;
  return v_consent;
end $$;
revoke all     on function public.media_consent_record_in_person(uuid,text[],uuid,text,timestamptz,text,text,boolean) from public, anon;
grant  execute on function public.media_consent_record_in_person(uuid,text[],uuid,text,timestamptz,text,text,boolean) to authenticated;

-- ── RPC: REVOGAR (só o PACIENTE dono, sozinho, sem justificativa; corta o uso na hora) ──
create or replace function public.media_consent_revoke(p_consent_id uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_patient uuid; v_me_patient uuid := private.current_patient_id(); v_status text;
begin
  v_patient := private.media_consent_patient(p_consent_id);
  if v_patient is null then raise exception 'media_consent_revoke: consent not found' using errcode = '22023'; end if;
  if v_me_patient is null or v_me_patient <> v_patient then
    raise exception 'media_consent_revoke: only the patient owner can revoke' using errcode = '42501';
  end if;
  select status into v_status from public.media_consents where id = p_consent_id;
  if v_status = 'revoked' then return jsonb_build_object('consent_id', p_consent_id, 'status', 'revoked', 'already', true); end if;
  update public.media_consents
    set status = 'revoked', revoked_at = now(), revoke_reason = nullif(btrim(coalesce(p_reason,'')),'')
    where id = p_consent_id;
  return jsonb_build_object('consent_id', p_consent_id, 'status', 'revoked');
end $$;
revoke all     on function public.media_consent_revoke(uuid,text) from public, anon;
grant  execute on function public.media_consent_revoke(uuid,text) to authenticated;

-- ── RPC CANÔNICA de USO (D3 USAR): "pode usar esta versão neste canal agora?" (+ motivo). ──
create or replace function public.media_use_check(p_piece_version_id uuid, p_channel text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_patient uuid; v_reason text; v_expires timestamptz;
begin
  v_patient := private.media_version_patient(p_piece_version_id);
  if v_patient is null then return jsonb_build_object('usable', false, 'reason', 'version_not_found'); end if;
  if not private.can_access_patient_internal(v_patient) then
    raise exception 'media_use_check: not authorized' using errcode = '42501';
  end if;
  if private.media_version_channel_usable(p_piece_version_id, p_channel) then
    select min(c.expires_at) into v_expires from public.media_consents c
      join public.media_consent_channels cc on cc.consent_id = c.id
      where c.piece_version_id = p_piece_version_id and c.status='authorized' and c.revoked_at is null
        and c.expires_at > now() and cc.channel_code = p_channel;
    return jsonb_build_object('usable', true, 'reason', 'ok', 'expires_at', v_expires);
  end if;
  if exists (select 1 from public.media_consents c join public.media_consent_channels cc on cc.consent_id=c.id
      where c.piece_version_id=p_piece_version_id and cc.channel_code=p_channel
        and (c.status='revoked' or c.revoked_at is not null)) then v_reason := 'revoked';
  elsif exists (select 1 from public.media_consents c join public.media_consent_channels cc on cc.consent_id=c.id
      where c.piece_version_id=p_piece_version_id and cc.channel_code=p_channel and c.status='authorized' and c.expires_at <= now()) then v_reason := 'expired';
  elsif exists (select 1 from public.media_consents c
      where c.piece_version_id=p_piece_version_id and c.status='authorized' and c.revoked_at is null and c.expires_at > now()) then v_reason := 'channel_not_authorized';
  elsif exists (select 1 from public.media_consents c where c.piece_version_id=p_piece_version_id and c.status='pending') then v_reason := 'pending';
  else v_reason := 'no_consent'; end if;
  return jsonb_build_object('usable', false, 'reason', v_reason);
end $$;
revoke all     on function public.media_use_check(uuid,text) from public, anon;
grant  execute on function public.media_use_check(uuid,text) to authenticated;

-- ── RPC (D5): consents que expiram em N dias — CONSULTÁVEL (a tabela de alertas + job = etapa D). ──
create or replace function public.media_consents_expiring(p_within_days int default 30)
returns table(consent_id uuid, patient_id uuid, piece_version_id uuid, clinic_id uuid, expires_at timestamptz, days_left int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.patient_id, c.piece_version_id, mp.clinic_id, c.expires_at,
         (c.expires_at::date - current_date) as days_left
  from public.media_consents c
  join public.media_piece_versions v on v.id = c.piece_version_id
  join public.media_pieces mp on mp.id = v.piece_id
  where c.status = 'authorized' and c.revoked_at is null
    and c.expires_at > now()
    and c.expires_at <= now() + make_interval(days => greatest(p_within_days, 0))
    and private.can_access_patient_internal(c.patient_id)
  order by c.expires_at $$;
revoke all     on function public.media_consents_expiring(int) from public, anon;
grant  execute on function public.media_consents_expiring(int) to authenticated;

-- ── Seeds ──────────────────────────────────────────────────────────────────────────────
insert into public.media_channels (code, label, is_paid_ad, active, sort_order) values
  ('instagram',    'Instagram',           false, true, 1),
  ('site',         'Site da clínica',     false, true, 2),
  ('whatsapp',     'WhatsApp',            false, true, 3),
  ('tela_interna', 'Tela interna',        false, true, 4),
  ('impresso',     'Material impresso',   false, true, 5),
  ('anuncio_pago', 'Anúncio pago',        true,  true, 6)
on conflict (code) do nothing;

insert into public.media_consent_terms (version_no, body) values
  (1,
   'Autorizo o uso da PEÇA e VERSÃO específicas que visualizei, exclusivamente nos CANAIS que selecionei, '
   'pela clínica e profissionais identificados, pelo prazo de 12 meses ou até que eu revogue — o que ocorrer '
   'primeiro. Posso revogar a qualquer momento, sozinho(a) e sem justificativa; a revogação bloqueia novos '
   'downloads, edições, duplicações e republicações e retira a peça da biblioteca. LIMITAÇÃO TÉCNICA: um link '
   'de acesso já gerado NÃO é revogável e pode continuar funcionando por até 5 minutos (300s) após a revogação, '
   'até expirar. Qualquer alteração relevante (imagem, texto/depoimento, inclusão de peso/medidas/percentual/VRI/'
   'resultado, troca de clínica ou profissional, novo canal, virar anúncio pago ou mudança de finalidade) exige '
   'uma NOVA autorização.')
on conflict (version_no) do nothing;

-- ── Ledger humano ──────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260731090000','20260731090000_wp_arte_a_media_consent.sql',
  'WP-ARTE A: modelo de PEÇA + VERSÃO imutável + profissionais destacados; CONSENTIMENTO amarrado à '
  'versão + canais (tabela media_channels, D2); TERMO versionado imutavel; funcao canonica de uso '
  '(status/expiracao/canal); RLS SELECT via helpers (externo excluido), escrita so por RPC SECDEF (autor '
  'do servidor): media_piece_create/new_version, media_consent_grant_app (paciente), '
  'media_consent_record_in_person (staff, exceco presencial com campos obrigatorios via CHECK), '
  'media_consent_revoke (so paciente), media_use_check (canonica), media_consents_expiring (D5). D1 dois '
  'niveis (versao vs consentimento) + content_hash. D4 menor/birth_date nula bloqueado. D6 link 300s no termo. '
  'V1 sem foto (campos previstos false/null). Nenhuma policy existente alterada.',
  'WP-ARTE-A')
on conflict (version) do nothing;
