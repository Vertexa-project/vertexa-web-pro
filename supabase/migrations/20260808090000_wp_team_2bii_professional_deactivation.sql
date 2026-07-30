-- =====================================================================================
-- WP-TEAM-2b-ii — O ESTADO DO PROFISSIONAL (desativação do MEMBRO DA CLÍNICA).
--
-- A TESE DESTE WP, EM UMA FRASE: o 2b-i entregou o interruptor do VÍNCULO (uma paciente por
-- vez) e não precisou tocar RLS porque os helpers já filtravam o status do vínculo; aqui o
-- interruptor é da PESSOA na clínica, e por isso — ao contrário do 2b-i — os helpers TÊM de
-- mudar: hoje não existe UM ponto no grafo que pergunte se o profissional está ativo.
--
-- POR QUE OS HELPERS MUDAM (medido na Fase 1, G7.4): nenhuma das 109 policies cita "status";
-- a única filtragem de estado que existe está DENTRO de 3 helpers e é sempre sobre o VÍNCULO
-- (professional_patient_links.status), nunca sobre o profissional. Logo o corte de acesso da
-- PESSOA não tem carona: ou entra nos helpers, ou não existe.
--
-- O QUE ESTA MIGRATION FAZ (12 itens do WP; o 8, 9 e 10 são provas/processo, não DDL):
--   1) `professionals`: status + status_changed_at/by/reason, CHECK ('active','inactive'),
--      UNIQUE (profile_id, clinic_id) e REVOKE UPDATE das 4 colunas novas.
--      Tabela NOVA professional_status_events — trilha IMUTÁVEL (só policy de SELECT).
--   2) RPC public.deactivate_professional — admin da clínica; RECUSA o dono (L2) e a
--      autodesativação; grava trilha; CASCATEIA para TODOS os vínculos ativos pelo MESMO
--      caminho interno do 2b-i (agora extraído para private.deactivate_link_core).
--   3) RPC public.reactivate_professional — simétrica, e com uma ASSIMETRIA DELIBERADA:
--      NÃO reativa vínculo nenhum.
--   4) 6 helpers passam a exigir profissional ATIVO: is_clinic_admin (ramo do DONO INTACTO),
--      owns_professional, is_clinic_staff, is_common_professional_of_patient,
--      is_external_professional_of_patient e is_clinic_member.
--      private.can_see_profile NÃO É TOCADA (prova de identidade da L1).
--   5) report_exports_select — o ramo de AUTORIA passa a exigir profissional ativo; o ramo do
--      ADMIN fica intacto.
--   6) professionals_admin_write — sai o DELETE.
--   7) channel_professionals ganha p_include_message_authors (default false ⇒ resultado
--      idêntico ao de hoje).
--  11) RPC public.my_clinic_memberships — caminho ESTREITO para a tela de explicação.
--  12) promote_to_professional — âncora ALTERADA DE PROPÓSITO: linha existente 'inactive'
--      levanta erro legível em vez de devolver a linha desativada.
--
-- ⚠️ ITEM 4 — MUDANÇA DE DECISÃO DO DONO, REGISTRADA: no texto original do WP,
--   `is_clinic_member` NÃO filtraria (para o desativado continuar "vendo a existência da
--   clínica"). A Fase 2 parou e reportou que esse helper governa exatamente 2 policies —
--   `clinics_select` e `journey_columns_select` — e que `clinics` carrega o **join_code**, que é
--   CREDENCIAL DE ENTRADA (consumida por request_clinic_access, rotacionável por
--   rotate_clinic_join_code) e não metadado. O dono decidiu: is_clinic_member FILTRA como os
--   outros cinco, e a tela de explicação passa a ser servida pela RPC estreita do item 11.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ:
--   · NÃO toca private.can_see_profile (fica em 7a31d3522ef51b7e6b10701a637a2efd, byte a byte).
--   · NÃO toca create_clinic_with_owner nem handle_new_user (as outras 3 âncoras seguem
--     idênticas; a única âncora que muda é promote_to_professional, item 12).
--   · NÃO altera nenhuma outra policy: das 109, sai 1 (professionals_admin_write), entram 3
--     (professionals_admin_insert, professionals_admin_update, professional_status_events_select)
--     e 1 muda de texto (report_exports_select). As outras 107 ficam byte a byte iguais.
--   · NÃO altera FRONTEND: nem o opt-in do item 7 (p_include_message_authors), nem o consumo da
--     RPC do item 11. Os dois são o WP seguinte, por ordem explícita.
--   · NÃO reativa vínculo na reativação da pessoa (item 3) e NÃO reativa cadastro desativado
--     pela porta da frente (item 12): as duas assimetrias são deliberadas.
--   · NÃO invalida sessão/JWT do desativado. O corte é de ACESSO A DADO, statement a statement
--     (helpers são STABLE, reavaliados por comando). "Imediato" nesse sentido — não no sentido
--     de matar a sessão, o que nada em `professionals` faria.
--   · NÃO mexe em profiles.status (o destravar/travar do onboarding) — quem é desativado
--     continua com profiles.status='active'. Ver DÍVIDA-2bii-3 em docs/PENDENCIAS.md.
--
-- ⚠️ FRAGILIDADE CONHECIDA (a MESMA do 2b-i, agora em `professionals`): o REVOKE do item 1 é
--   privilégio de COLUNA. Uma linha futura como
--       grant update on public.professionals to authenticated;      -- (ou grant all on all tables)
--   apaga o recorte SILENCIOSAMENTE, sem erro e sem mudar nenhuma policy — nenhum hash de RLS
--   detecta. Hoje o buraco é MENOR do que era no 2b-i: `authenticated` não tem UPDATE de TABELA
--   em `professionals` (só grants de COLUNA em type/registry_number/specialty/clinic_role), então
--   as 4 colunas novas nascem NÃO-escrevíveis pelo client mesmo sem o revoke. O revoke está aqui
--   como declaração de intenção e defesa em profundidade.
--   COMO VERIFICAR (barato, serve de regressão):
--       select has_column_privilege('authenticated','public.professionals','status','update');
--       -- deve ser FALSE; e clinic_role deve continuar TRUE.
--   Registrado como DÍVIDA-PRIV-2 em docs/PENDENCIAS.md (irmã da DÍVIDA-PRIV-1).
--
-- KILL SWITCH (desliga o fluxo NOVO sem desfazer nada):
--   revoke execute on function public.deactivate_professional(uuid,text) from authenticated;
--   revoke execute on function public.reactivate_professional(uuid,text) from authenticated;
--   revoke execute on function public.my_clinic_memberships()          from authenticated;
--   ⚠️ ATENÇÃO: o kill switch NÃO religa o acesso de quem já está desativado — o corte é o
--   ESTADO na linha, não o gatilho. Para religar sem a RPC (socorro, exige service_role/owner,
--   porque `authenticated` não escreve essas colunas):
--       update public.professionals set status='active', status_changed_at=now(),
--              status_changed_by=null, status_reason='socorro manual' where id = '...';
--   (e reabrir as conversas para o roster reconciliar por get_or_create_channel)
--
-- ROLLBACK COMPLETO (inverso exato, de baixo para cima):
--   -- item 12 (volta a âncora ao corpo b377d4b1cc40068a50627622e4b230a3):
--   --   reaplicar o corpo anterior de promote_to_professional (está em
--   --   20260723090000_wp_hardening_a1_promote_to_professional.sql, seção do SSOT)
--   drop function if exists public.my_clinic_memberships();
--   drop function if exists public.channel_professionals(uuid, boolean);
--   -- e recriar channel_professionals(uuid) do 20260806090000_wp_chat_mentions_a.sql
--   drop policy if exists professionals_admin_update on public.professionals;
--   drop policy if exists professionals_admin_insert on public.professionals;
--   create policy professionals_admin_write on public.professionals
--     for all to authenticated
--     using (private.is_clinic_admin(clinic_id)) with check (private.is_clinic_admin(clinic_id));
--   alter policy report_exports_select on public.report_exports
--     using (private.is_clinic_admin(clinic_id)
--            or (exported_by_profile_id = private.current_profile_id()));
--   -- os 6 helpers: reaplicar os corpos SEM o filtro de status (hashes individuais no PR)
--   drop function if exists public.reactivate_professional(uuid,text);
--   drop function if exists public.deactivate_professional(uuid,text);
--   -- deactivate_patient_link volta a ter o núcleo INLINE (corpo do 20260805090000)
--   drop function if exists private.deactivate_link_core(uuid,text,uuid);
--   drop table if exists public.professional_status_events;
--   alter table public.professionals drop constraint if exists professionals_profile_clinic_uniq;
--   alter table public.professionals drop constraint if exists professionals_status_chk;
--   alter table public.professionals
--     drop column if exists status_reason,
--     drop column if exists status_changed_by,
--     drop column if exists status_changed_at,
--     drop column if exists status;
--   -- ATENÇÃO: o rollback NÃO reativa ninguém nem religa vínculo. Para reverter o EFEITO:
--   -- update public.professional_patient_links set status='active'
--   --  where status='inactive' and status_reason like '[DESATIVACAO_DO_PROFISSIONAL]%';
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1.a) ESTADO NA LINHA DO PROFISSIONAL
--
-- `status` NOT NULL DEFAULT 'active': as 9 linhas de hoje nascem ativas, e nenhum caminho de
-- criação (create_clinic_with_owner, promote_to_professional) lista a coluna — logo os dois
-- continuam byte a byte iguais e criando gente ATIVA. É por isso que o DEFAULT existe: sem ele,
-- as duas âncoras teriam de mudar, e uma delas (create_clinic_with_owner) não pode.
-- ADICIONAR COLUNA NÃO ALTERA POLICY: professionals_select e professionals_admin_* continuam
-- com o mesmo texto de qual/with_check.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.professionals
  add column if not exists status            text not null default 'active',
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.profiles(id),
  add column if not exists status_reason     text;

comment on column public.professionals.status is
  'WP-TEAM-2b-ii: active|inactive. Estado da PESSOA na clinica (nao do vinculo com paciente). '
  'So muda pelas RPCs deactivate_professional/reactivate_professional — authenticated nao tem '
  'UPDATE nesta coluna.';
comment on column public.professionals.status_changed_by is
  'Profile que mudou o status pela ultima vez. Preenchido pelo SERVIDOR dentro das RPCs.';

-- CHECK e UNIQUE em bloco idempotente (o Postgres não tem `add constraint if not exists`).
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.professionals'::regclass
                    and conname  = 'professionals_status_chk') then
    alter table public.professionals
      add constraint professionals_status_chk check (status = any (array['active','inactive']));
  end if;

  -- UNIQUE (profile_id, clinic_id) — fecha a DÍVIDA-A1-1 (a ausência registrada no G2 da Fase 1)
  -- e torna "um profissional = uma linha" GARANTIA, não premissa. Sem isto, desativar uma linha
  -- deixaria a outra ativa e is_clinic_admin/is_clinic_staff/owns_professional voltariam TRUE
  -- pelo exists(...) — o estado seria burlável por duplicata.
  -- Gate 0.3 conferido antes de escrever: 0 duplicatas em 9 linhas, 0 NULL nas duas colunas.
  -- ⚠️ LIMITE HONESTO: UNIQUE do Postgres é NULLS DISTINCT por padrão, então duas linhas com
  --   profile_id NULL (ou clinic_id NULL) ainda coexistiriam. Hoje não existe nenhuma, e as duas
  --   colunas continuam anuláveis no schema. Ver DÍVIDA-2bii-1 em docs/PENDENCIAS.md.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.professionals'::regclass
                    and conname  = 'professionals_profile_clinic_uniq') then
    alter table public.professionals
      add constraint professionals_profile_clinic_uniq unique (profile_id, clinic_id);
  end if;
end
$do$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1.b) TRAVA DE PRIVILÉGIO — as 4 colunas novas NÃO são escritas pelo client
--
-- Mesmo princípio do item 4 do 2b-i: a garantia mora no DADO, não na tela. Aqui o revoke é
-- DEFENSIVO e hoje é no-op de fato — `authenticated` não tem UPDATE de TABELA em
-- `professionals` (tem grant só nas COLUNAS type/registry_number/specialty/clinic_role), e
-- coluna nova nasce sem grant. Fica escrito porque o WP pede e porque, se alguém um dia
-- conceder UPDATE de tabela, esta linha é o registro da intenção (e a DÍVIDA-PRIV-2 é o aviso
-- de que ela NÃO sobrevive a esse grant).
-- ─────────────────────────────────────────────────────────────────────────────────────
revoke update (status, status_changed_at, status_changed_by, status_reason)
  on public.professionals from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1.c) TRILHA IMUTÁVEL — professional_status_events
--
-- Append-only por CONSTRUÇÃO, igual à ppl_status_events do 2b-i: existe policy de SELECT e mais
-- nada. Sem policy de INSERT/UPDATE/DELETE a RLS nega os três para `authenticated` — nem o admin
-- reescreve a história. Quem grava são as RPCs (SECURITY DEFINER rodam como owner, fora da RLS).
--
-- changed_by vem SEMPRE de private.current_profile_id() dentro da RPC, NUNCA do cliente.
--
-- Leitura restrita ao ADMIN DA CLÍNICA (private.is_clinic_admin(clinic_id)) — e note o efeito
-- combinado com o item 4: um ex-admin desativado NÃO lê a própria trilha, porque perdeu a
-- adminidade. Mesma decisão do 2b-i (a trilha é instrumento de auditoria do admin, não
-- notificação ao desativado).
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.professional_status_events (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  clinic_id       uuid not null references public.clinics(id),
  from_status     text,
  to_status       text not null,
  reason          text,
  changed_by      uuid references public.profiles(id),
  changed_at      timestamptz not null default now()
);

comment on table public.professional_status_events is
  'WP-TEAM-2b-ii: trilha IMUTAVEL de ativacao/desativacao do PROFISSIONAL na clinica. '
  'Append-only: so existe policy de SELECT (admin da clinica). Escrita so pelas RPCs.';

create index if not exists professional_status_events_prof_idx
  on public.professional_status_events (professional_id, changed_at desc);
create index if not exists professional_status_events_clinic_idx
  on public.professional_status_events (clinic_id, changed_at desc);

alter table public.professional_status_events enable row level security;

create policy professional_status_events_select on public.professional_status_events
  for select to authenticated
  using (private.is_clinic_admin(clinic_id));

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2.a) O NÚCLEO DA BAIXA DE VÍNCULO, EXTRAÍDO DO 2b-i
--
-- O item 2 manda cascatear "pelo MESMO caminho interno do 2b-i, para herdar trilha e remoção do
-- roster do chat". Herdar DE VERDADE é chamar o mesmo código, não copiá-lo: o trecho que estava
-- INLINE em public.deactivate_patient_link (UPDATE do status + INSERT na trilha + DELETE do
-- roster) vira este núcleo, e as DUAS RPCs passam a chamá-lo. Zero duplicação da regra.
--
-- SEGURANÇA — por que NÃO é SECURITY DEFINER (e leva revoke): `authenticated` tem USAGE em
-- `private` e EXECUTE nos helpers (a RLS depende disso). Uma função SECDEF em `private` sem
-- portão seria uma porta de desativar QUALQUER vínculo. Duas barreiras independentes, mesmo
-- padrão da extração do WP-METRIC-1a:
--   (a) SECURITY INVOKER — chamada de dentro das RPCs SECDEF ela roda como o owner (postgres);
--       chamada por um cliente rodaria como o cliente, que não tem UPDATE (status) nem policy
--       de INSERT em ppl_status_events ⇒ falharia;
--   (b) revoke all de public/anon/authenticated — o cliente não tem nem EXECUTE.
-- Autorização continua sendo dos INVÓLUCROS (deactivate_patient_link e
-- deactivate_professional), que checam is_clinic_admin ANTES de chamar. O núcleo é mecânica,
-- não autoridade — e a guarda de contrato abaixo existe para não gravar trilha órfã.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.deactivate_link_core(
  p_link_id uuid,
  p_reason  text,
  p_actor   uuid
) returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_prof         uuid;
  v_patient      uuid;
  v_from_status  text;
  v_prof_profile uuid;
begin
  if p_link_id is null then
    raise exception 'deactivate_link_core: p_link_id is required' using errcode = '22023';
  end if;

  select l.professional_id, l.patient_id, coalesce(l.status,'active')
    into v_prof, v_patient, v_from_status
    from public.professional_patient_links l
   where l.id = p_link_id;

  if v_prof is null and v_patient is null then
    raise exception 'deactivate_link_core: link % not found', p_link_id using errcode = 'P0002';
  end if;

  -- IDEMPOTÊNCIA no núcleo também: já inativo ⇒ não erra e NÃO grava trilha duplicada.
  if v_from_status = 'inactive' then
    return null;
  end if;

  update public.professional_patient_links
     set status            = 'inactive',
         status_changed_at = now(),
         status_changed_by = p_actor,
         status_reason     = p_reason
   where id = p_link_id;

  insert into public.ppl_status_events
    (link_id, professional_id, patient_id, from_status, to_status, reason, changed_by)
  values (p_link_id, v_prof, v_patient, v_from_status, 'inactive', p_reason, p_actor);

  -- ── O QUE FECHA A DÍVIDA V7 (herdado do 2b-i, palavra por palavra na intenção) ──────
  -- Tira o profissional do roster do canal DESTA paciente, na MESMA transação. A leitura já
  -- cairia sozinha (derivada), mas a ESCRITA depende da linha do roster: sem este DELETE, o
  -- desativado continuaria mandando mensagem até alguém reabrir a conversa.
  -- Só role='professional': a linha da paciente e eventuais 'admin' ficam intactas.
  select pr.profile_id into v_prof_profile
    from public.professionals pr where pr.id = v_prof;

  if v_prof_profile is not null then
    delete from public.chat_participants cp
     using public.chat_channels cc
     where cc.patient_id  = v_patient
       and cp.channel_id  = cc.id
       and cp.profile_id  = v_prof_profile
       and cp.role        = 'professional'::public.user_role;
  end if;

  return p_link_id;
end;
$$;

comment on function private.deactivate_link_core(uuid,text,uuid) is
  'WP-TEAM-2b-ii: nucleo da baixa de vinculo extraido do 2b-i (UPDATE do status + trilha '
  'ppl_status_events + remocao do roster do chat). SECURITY INVOKER e sem EXECUTE para o '
  'cliente: a autorizacao e dos involucros (deactivate_patient_link, deactivate_professional).';

revoke all on function private.deactivate_link_core(uuid,text,uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2.b) deactivate_patient_link PASSA A CHAMAR O NÚCLEO
--
-- COMPORTAMENTO IDÊNTICO ao do 2b-i — os gates, a ordem das checagens, os errcodes, o retorno e
-- a idempotência são os mesmos; só o trecho mecânico saiu de dentro. Está no PR a prova de que
-- desativar vínculo pela RPC continua produzindo exatamente o mesmo efeito (status, trilha e
-- roster) que produzia antes.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.deactivate_patient_link(
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
begin
  if p_professional_id is null or p_patient_id is null then
    raise exception 'Parametros obrigatorios ausentes.' using errcode = '22023';
  end if;

  v_clinic := private.patient_clinic(p_patient_id);

  -- GATE. Mesmo predicado da policy ppl_admin_write que já governa a escrita do vínculo.
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'Apenas o administrador da clinica gerencia vinculos.' using errcode = '42501';
  end if;

  -- O profissional precisa ser DA MESMA CLÍNICA da paciente. Sem isto, um admin poderia
  -- carimbar trilha sobre um profissional de outra clínica.
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

  -- IDEMPOTÊNCIA: já inativo ⇒ não erra e NÃO grava trilha duplicada.
  if v_from_status = 'inactive' then
    return v_link_id;
  end if;

  perform private.deactivate_link_core(v_link_id, p_reason, private.current_profile_id());

  return v_link_id;
end;
$$;

comment on function public.deactivate_patient_link(uuid,uuid,text) is
  'WP-TEAM-2b-i: desativa o vinculo profissional<->paciente (status=inactive), grava trilha '
  'imutavel com autor do servidor e remove o profissional do roster do chat na mesma transacao. '
  'WP-TEAM-2b-ii: o trecho mecanico virou private.deactivate_link_core — comportamento identico.';

revoke all     on function public.deactivate_patient_link(uuid,uuid,text) from public, anon;
grant  execute on function public.deactivate_patient_link(uuid,uuid,text) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2.c) RPC — DESATIVAR O PROFISSIONAL NA CLÍNICA
--
-- FAIL-CLOSED: sem admin da clínica DAQUELE profissional ⇒ 42501, antes de qualquer escrita.
--
-- AS DUAS RECUSAS, e por que não são capricho:
--   · O DONO (L2): o G5 da Fase 1 provou que a adminidade do dono vem de um ramo OR que consulta
--     APENAS public.clinics (owner_profile_id) e NÃO passa por professionals. Um dono
--     "desativado" continuaria podendo tudo — ou seja, a UI mentiria. Então não se desativa o
--     dono: transfere-se a posse primeiro.
--   · AUTODESATIVAÇÃO: não tem caso de uso legítimo e é o caminho mais curto para uma clínica
--     travada (o admin que se corta e não consegue mais se religar).
--
-- CASCATA (o que faz a L3 valer de fato): is_common_professional_of_patient e
-- is_external_professional_of_patient olham o VÍNCULO. O item 4 passa a exigir também o
-- profissional ativo, então o corte já valeria pelo helper; mas deixar 4 vínculos "ativos"
-- pendurados num desativado é dado que mente. Aqui os vínculos caem NA MESMA TRANSAÇÃO, pelo
-- núcleo do 2b-i, com trilha e com o roster do chat reconciliado.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.deactivate_professional(
  p_professional_id uuid,
  p_reason          text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_clinic      uuid;
  v_profile     uuid;
  v_from_status text;
  v_owner       uuid;
  v_me          uuid;
  v_link        record;
begin
  if p_professional_id is null then
    raise exception 'Profissional nao informado.' using errcode = '22023';
  end if;

  select pr.clinic_id, pr.profile_id, coalesce(pr.status,'active')
    into v_clinic, v_profile, v_from_status
    from public.professionals pr where pr.id = p_professional_id;

  if v_from_status is null then
    raise exception 'Profissional inexistente.' using errcode = 'P0002';
  end if;

  -- GATE — admin da clínica DAQUELE profissional. Qualquer outro: 42501.
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'Apenas o administrador da clinica gerencia profissionais.'
      using errcode = '42501';
  end if;

  v_me := private.current_profile_id();

  -- L2 — o dono não pode ser desativado.
  select c.owner_profile_id into v_owner from public.clinics c where c.id = v_clinic;
  if v_profile is not null and v_owner is not null and v_profile = v_owner then
    raise exception 'O dono da clinica nao pode ser desativado: transfira a posse da clinica antes.'
      using errcode = '42501', hint = 'OWNER_CANNOT_BE_DEACTIVATED';
  end if;

  -- Sem autodesativação.
  if v_profile is not null and v_profile = v_me then
    raise exception 'Voce nao pode desativar o seu proprio cadastro: peca a outro administrador.'
      using errcode = '42501', hint = 'SELF_DEACTIVATION_NOT_ALLOWED';
  end if;

  -- IDEMPOTÊNCIA: já inativo ⇒ não erra e NÃO grava trilha duplicada.
  -- (Não recascateia de propósito: um vínculo religado depois da desativação não dá acesso
  --  nenhum, porque os helpers do item 4 exigem o PROFISSIONAL ativo. Ver DÍVIDA-2bii-2.)
  if v_from_status = 'inactive' then
    return p_professional_id;
  end if;

  update public.professionals
     set status            = 'inactive',
         status_changed_at = now(),
         status_changed_by = v_me,
         status_reason     = p_reason
   where id = p_professional_id;

  insert into public.professional_status_events
    (professional_id, clinic_id, from_status, to_status, reason, changed_by)
  values (p_professional_id, v_clinic, v_from_status, 'inactive', p_reason, v_me);

  -- CASCATA pelo MESMO caminho interno do 2b-i. O prefixo no motivo é o que deixa claro, na
  -- trilha do VÍNCULO, que a causa foi a desativação da PESSOA — não uma decisão sobre aquela
  -- paciente. Um relatório de auditoria distingue os dois só por isto.
  for v_link in
    select l.id
      from public.professional_patient_links l
     where l.professional_id = p_professional_id
       and coalesce(l.status,'active') = 'active'
     order by l.id
  loop
    perform private.deactivate_link_core(
      v_link.id,
      '[DESATIVACAO_DO_PROFISSIONAL] ' || coalesce(p_reason, 'sem motivo informado'),
      v_me);
  end loop;

  return p_professional_id;
end;
$$;

comment on function public.deactivate_professional(uuid,text) is
  'WP-TEAM-2b-ii: desativa o PROFISSIONAL na clinica (status=inactive). Admin da clinica apenas; '
  'recusa o DONO (L2) e a autodesativacao; grava trilha imutavel com autor do servidor; cascateia '
  'TODOS os vinculos ativos pelo nucleo do 2b-i (trilha do vinculo com prefixo '
  '[DESATIVACAO_DO_PROFISSIONAL] e roster do chat reconciliado). Idempotente.';

revoke all     on function public.deactivate_professional(uuid,text) from public, anon;
grant  execute on function public.deactivate_professional(uuid,text) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) RPC — REATIVAR O PROFISSIONAL (simétrica na autorização e na trilha)
--
-- ⚠️ ASSIMETRIA DELIBERADA, e é o coração deste item: NÃO reativa vínculo nenhum.
--   Devolver o poder de agir NA CLÍNICA é uma coisa; devolver acesso ao dado clínico de uma
--   PACIENTE específica é outra, e se reconquista vínculo por vínculo (reactivate_patient_link,
--   do 2b-i). Quem volta, volta sem carteira de pacientes — de propósito.
--   Consequência medida e provada no PR: depois de reativar a PESSOA, o conjunto que ela vê é
--   SUBCONJUNTO ESTRITO do que via antes da desativação; reativando também os vínculos, volta a
--   ser EXATAMENTE igual. Nada se perde para sempre; nada volta sozinho.
--
-- Não há checagem de autorreativação porque ela é IMPOSSÍVEL por construção: quem está
-- desativado não é admin (item 4), então não passa do gate. Idem para o dono, que nunca chega a
-- ficar inativo (item 2).
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reactivate_professional(
  p_professional_id uuid,
  p_reason          text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_clinic      uuid;
  v_from_status text;
  v_me          uuid;
begin
  if p_professional_id is null then
    raise exception 'Profissional nao informado.' using errcode = '22023';
  end if;

  select pr.clinic_id, coalesce(pr.status,'active')
    into v_clinic, v_from_status
    from public.professionals pr where pr.id = p_professional_id;

  if v_from_status is null then
    raise exception 'Profissional inexistente.' using errcode = 'P0002';
  end if;

  if not private.is_clinic_admin(v_clinic) then
    raise exception 'Apenas o administrador da clinica gerencia profissionais.'
      using errcode = '42501';
  end if;

  if v_from_status = 'active' then
    return p_professional_id;   -- idempotente, sem trilha duplicada
  end if;

  v_me := private.current_profile_id();

  update public.professionals
     set status            = 'active',
         status_changed_at = now(),
         status_changed_by = v_me,
         status_reason     = p_reason
   where id = p_professional_id;

  insert into public.professional_status_events
    (professional_id, clinic_id, from_status, to_status, reason, changed_by)
  values (p_professional_id, v_clinic, v_from_status, 'active', p_reason, v_me);

  return p_professional_id;
end;
$$;

comment on function public.reactivate_professional(uuid,text) is
  'WP-TEAM-2b-ii: reativa o PROFISSIONAL na clinica. NAO reativa vinculo nenhum — assimetria '
  'DELIBERADA: poder de agir na clinica volta pela RPC, acesso a paciente volta vinculo por '
  'vinculo (reactivate_patient_link). Admin da clinica apenas; trilha imutavel; idempotente.';

revoke all     on function public.reactivate_professional(uuid,text) from public, anon;
grant  execute on function public.reactivate_professional(uuid,text) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) OS 6 HELPERS — PASSAM A EXIGIR PROFISSIONAL ATIVO
--
-- A forma do filtro é SEMPRE a mesma, e é a mesma do 2b-i para vínculo:
--     and coalesce(pr.status,'active') = 'active'
-- `coalesce` mesmo com a coluna NOT NULL: é a convenção da casa ("NULO conta como ATIVO"), e
-- mantém o predicado correto se algum dia o NOT NULL cair.
--
-- CADA UM É `create or replace`: a assinatura, a volatilidade (STABLE), o SECURITY DEFINER, o
-- `search_path=''` e as ACLs continuam exatamente como estão. Nenhuma policy é tocada — o que
-- muda é o que os helpers RESPONDEM. Alcance medido na Fase 1: 88 das 109 policies e 23 RPCs.
--
-- O QUE **NÃO** MUDA AQUI: private.can_see_profile. Ela é a prova da L1 (identidade preservada)
-- e fica em 7a31d3522ef51b7e6b10701a637a2efd byte a byte. Note que o COMPORTAMENTO dela muda na
-- direção "A1 olhando os outros" (porque ela chama is_clinic_admin e can_access_patient) — isso
-- é o corte da L3 agindo, não violação da L1: a direção protegida é "os outros olhando A1", e
-- essa depende só da EXISTÊNCIA da linha de A1, que continua lá. Desativar ≠ deletar.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- 4.1 is_clinic_admin — ⚠️ O RAMO DO DONO FICA INTACTO (é a L2 sustentada pelo schema).
create or replace function private.is_clinic_admin(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic is not null and (
    exists(select 1 from public.clinics c where c.id = p_clinic and c.owner_profile_id = private.current_profile_id())
    or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.clinic_role = 'admin' and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active')) $$;

comment on function private.is_clinic_admin(uuid) is
  'WP-TEAM-2b-ii: o ramo do PROFISSIONAL admin passa a exigir status active. O ramo do DONO '
  '(clinics.owner_profile_id) fica INTACTO de proposito: e o unico caminho de resgate se todo '
  'admin da clinica for desativado, e e por isso que desativar o DONO e proibido.';

-- 4.2 owns_professional — "esta linha de professionals é minha E está ativa".
create or replace function private.owns_professional(p_prof uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.professionals pr where pr.id = p_prof and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active') $$;

comment on function private.owns_professional(uuid) is
  'WP-TEAM-2b-ii: exige status active. Efeito colateral DECLARADO: o desativado deixa de ler as '
  'proprias disciplinas e a propria conexao de calendario (professional_disciplines_select, '
  'calendar_connections_select, ppl_select, appointments_*) — e o admin continua lendo tudo isso '
  'sobre ele por is_clinic_admin/is_clinic_staff, que e o que a L1 protege.';

-- 4.3 is_clinic_staff — pertencimento COM poder de agir (campanhas, disciplinas da equipe).
create or replace function private.is_clinic_staff(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic is not null and (
    private.is_clinic_admin(p_clinic)
    or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active')) $$;

comment on function private.is_clinic_staff(uuid) is
  'WP-TEAM-2b-ii: exige status active no ramo do profissional (o ramo do admin ja filtra por '
  'is_clinic_admin). Passa a ser usado tambem pelo ramo de AUTORIA de report_exports_select.';

-- 4.4 is_common_professional_of_patient — o eixo de 66 policies. Agora exige as DUAS pontas:
--     vínculo ativo (2b-i) E profissional ativo (2b-ii).
create or replace function private.is_common_professional_of_patient(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.professional_patient_links l join public.professionals pr on pr.id = l.professional_id
    where l.patient_id = p_patient and coalesce(l.status,'active') = 'active' and coalesce(l.is_external,false) = false
      and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active') $$;

comment on function private.is_common_professional_of_patient(uuid) is
  'WP-TEAM-2b-ii: exige vinculo ativo (2b-i) E profissional ativo (2b-ii). E a razao pela qual o '
  'corte da PESSOA vale mesmo se algum vinculo dela for religado depois.';

-- 4.5 is_external_professional_of_patient — idem, para o convidado de fora.
create or replace function private.is_external_professional_of_patient(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.professional_patient_links l join public.professionals pr on pr.id = l.professional_id
    where l.patient_id = p_patient and coalesce(l.status,'active') = 'active' and coalesce(l.is_external,false) = true
      and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active') $$;

comment on function private.is_external_professional_of_patient(uuid) is
  'WP-TEAM-2b-ii: exige vinculo ativo (2b-i) E profissional ativo (2b-ii).';

-- 4.6 is_clinic_member — ⚠️ MUDANÇA DE DECISÃO DO DONO (ver bloco no cabeçalho).
--     Governa clinics_select e journey_columns_select. `clinics` carrega o JOIN_CODE, que é
--     credencial de entrada e não metadado: sem filtro, o desativado continuaria lendo o código
--     da clínica que acabou de o desativar. O ramo da PACIENTE fica intacto — paciente não tem
--     estado de "profissional" e continua membro da clínica dela.
create or replace function private.is_clinic_member(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic is not null and (
    private.is_clinic_admin(p_clinic)
    or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active')
    or exists(select 1 from public.patients pt where pt.clinic_id = p_clinic and pt.profile_id = private.current_profile_id())) $$;

comment on function private.is_clinic_member(uuid) is
  'WP-TEAM-2b-ii: exige status active no ramo do profissional. Motivo: as 2 policies que ele '
  'governa entregam o registro inteiro de clinics — inclusive o JOIN_CODE, credencial de entrada '
  '— e a configuracao do kanban (journey_columns). A tela de explicacao do desativado passa a '
  'ser servida por public.my_clinic_memberships(), que devolve so clinic_id, nome e status.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) report_exports_select — O RAMO DE AUTORIA PASSA A EXIGIR PROFISSIONAL ATIVO
--
-- Antes:  is_clinic_admin(clinic_id) OR exported_by_profile_id = current_profile_id()
-- Depois: is_clinic_admin(clinic_id) OR (exported_by_profile_id = current_profile_id()
--                                        AND is_clinic_staff(clinic_id))
--
-- POR QUE: o ramo de autoria não consultava `professionals` em ponto nenhum (G7.3 da Fase 1),
-- então era a ÚNICA superfície onde o desativado continuaria vendo conteúdo clínico consolidado
-- de paciente depois do corte. `is_clinic_staff(clinic_id)` é exatamente "sou profissional ATIVO
-- (ou admin/dono) desta clínica" — reusa o helper canônico em vez de inventar predicado novo.
--
-- O RAMO DO ADMIN FICA INTACTO, e isso é a regra de auditoria: quem exportou pode sair da
-- clínica, ser desativado ou até ter a linha apagada; o admin continua vendo o registro. A
-- trilha não pode depender do exportador continuar lá.
--
-- ALTER POLICY (não drop/create): o `cmd` continua SELECT, o nome continua o mesmo, os roles
-- continuam {authenticated}. A contagem de policies não muda por causa deste item.
-- Hoje report_exports tem 0 linhas — o efeito é estrutural, não retroativo.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter policy report_exports_select on public.report_exports
  using (private.is_clinic_admin(clinic_id)
         or (exported_by_profile_id = private.current_profile_id()
             and private.is_clinic_staff(clinic_id)));

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) professionals_admin_write — SAI O DELETE
--
-- POR QUE (e é o achado mais desconfortável da Fase 1, G7.2): a policy é FOR ALL e
-- `authenticated` tem DELETE de tabela, então HOJE um admin consegue APAGAR a linha de um
-- profissional da sua clínica — inclusive a do DONO, porque nenhum trigger e nenhuma constraint
-- impedem. E o DELETE cascateia:
--     ppl_status_events ............ CASCADE  ⇒ apaga a trilha imutável que o 2b-i criou
--     professional_patient_links ... CASCADE  ⇒ apaga os vínculos (não inativa: APAGA)
--     professional_disciplines ..... CASCADE
--     media_piece_version_professionals ... CASCADE
-- Ou seja: existia um caminho de "sumir" que destrói o histórico que a L4 quer preservar,
-- convivendo com uma L2 que só falava de desativação. Soft-delete é o padrão de toda a
-- hierarquia (vínculo no 2b-i, pessoa aqui); o DELETE físico não pertence ao client.
--
-- COMO: `cmd` de policy é imutável — não existe "ALTER POLICY ... FOR". Então a policy FOR ALL
-- é substituída por duas, uma por comando, exatamente como o repo já faz em `patients`
-- (patients_admin_insert/delete), `journey_columns` e `campaigns`. O predicado é o MESMO
-- (is_clinic_admin(clinic_id)) — nada de novo é autorizado.
--   · SELECT do admin: PRESERVADO por professionals_select, que já tem o ramo
--     `is_clinic_admin(clinic_id)` (conferido; não é consequência presumida da policy removida).
--   · INSERT e UPDATE do admin: PRESERVADOS, mesmo predicado.
--   · DELETE: passa a não ter policy nenhuma ⇒ negado para authenticated/anon.
--   · service_role e owner (postgres, relforcerowsecurity=false): INTACTOS. Foi medido na Fase 2
--     que os dois únicos DELETEs em SQL do repo (a migration de purge já aplicada e o script
--     manual de seed) rodam como owner/service_role e NÃO passam por policy — por isso o gate
--     0.2 achou string mas não achou risco.
-- ARITMÉTICA DE POLICIES DESTE ITEM: −1 (ALL) +2 (INSERT, UPDATE) = +1.
-- ─────────────────────────────────────────────────────────────────────────────────────
drop policy if exists professionals_admin_write on public.professionals;

create policy professionals_admin_insert on public.professionals
  for insert to authenticated
  with check (private.is_clinic_admin(clinic_id));

create policy professionals_admin_update on public.professionals
  for update to authenticated
  using (private.is_clinic_admin(clinic_id))
  with check (private.is_clinic_admin(clinic_id));

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7) channel_professionals — p_include_message_authors (default false)
--
-- O PROBLEMA (a T5 da Fase 1): esta RPC é por onde o nome de um profissional chega ao chat do
-- painel (private.can_see_profile não cobre "colega da mesma clínica"). Ela lê o ROSTER
-- (chat_participants). Quando alguém sai do roster — e a cascata do item 2 tira o desativado de
-- lá — o nome dele desaparece do histórico que ele mesmo escreveu. A L1 diz que a identidade
-- fica; então precisa existir um caminho que devolva também os AUTORES.
--
-- COM false: resultado IDÊNTICO ao de hoje (roster only). Está PROVADO no PR por comparação
-- linha a linha do retorno da função antiga com o da nova, em todos os canais reais.
-- COM true: acrescenta os autores de mensagens do canal que são (ou foram) profissionais DA
-- CLÍNICA DA PACIENTE, mesmo fora do roster.
--
-- ⚠️ DE PROPÓSITO, NÃO filtra `status` em lugar nenhum: identidade não se apaga com a
--   desativação (L1). O portão de acesso continua sendo can_read_channel, no topo.
-- ⚠️ DROP + CREATE (não `create or replace`): mudar a lista de parâmetros criaria uma SEGUNDA
--   função `channel_professionals(uuid)` e a chamada de 1 argumento ficaria AMBÍGUA ("function
--   is not unique"). O drop é o que mantém a chamada de hoje funcionando — o frontend continua
--   chamando com um argumento só e cai no default.
-- ⚠️ TODA coluna é QUALIFICADA por alias, inclusive dentro dos CTEs. Não é estilo: os nomes de
--   RETURNS TABLE (profile_id, full_name, type, specialty, disciplines) são VARIÁVEIS OUT dentro
--   do plpgsql, então um `select profile_id from roster` sem alias levanta
--   `42702 column reference "profile_id" is ambiguous` EM TEMPO DE EXECUÇÃO — a função é criada
--   sem erro e só explode quando chamada. A matriz pegou exatamente isto na primeira rodada.
-- ⚠️ NÃO ALTERA FRONTEND: o opt-in é o WP seguinte, por ordem explícita.
-- ─────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.channel_professionals(uuid);

create or replace function public.channel_professionals(
  p_channel_id             uuid,
  p_include_message_authors boolean default false
) returns table(profile_id uuid, full_name text, type public.professional_type, specialty text, disciplines text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  if p_channel_id is null then
    raise exception 'Canal nao informado.' using errcode = '22023';
  end if;

  -- FAIL-CLOSED, antes de qualquer leitura de dado.
  if not private.can_read_channel(p_channel_id) then
    raise exception 'Sem acesso a esta conversa.' using errcode = '42501';
  end if;

  v_clinic := private.patient_clinic(private.channel_patient(p_channel_id));

  return query
    with roster as (
      select cp.profile_id
        from public.chat_participants cp
       where cp.channel_id = p_channel_id
         and cp.role = 'professional'::public.user_role
    ),
    autores as (
      select distinct m.sender_profile_id as profile_id
        from public.chat_messages m
       where coalesce(p_include_message_authors, false)
         and m.channel_id = p_channel_id
         and m.sender_profile_id is not null
         and exists (select 1
                       from public.professionals pr2
                      where pr2.profile_id = m.sender_profile_id
                        and pr2.clinic_id  = v_clinic)
    ),
    todos as (
      select r.profile_id from roster r
      union
      select au.profile_id from autores au
    )
    select t.profile_id,
           pf.full_name,
           pr.type,
           pr.specialty,
           coalesce(
             (select array_agg(pd.discipline order by pd.discipline)
                from public.professional_disciplines pd
               where pd.professional_id = pr.id),
             '{}'::text[]
           )
      from todos t
      join public.profiles pf on pf.id = t.profile_id
      left join public.professionals pr
             on pr.profile_id = t.profile_id
            and pr.clinic_id  = v_clinic
     order by pf.full_name nulls last;
end;
$$;

comment on function public.channel_professionals(uuid, boolean) is
  'WP-CHAT-B: nome/tipo/especialidade/disciplinas dos profissionais de um canal (atravessa a RLS '
  'de profiles, que nao cobre "colega da mesma clinica"). WP-TEAM-2b-ii: '
  'p_include_message_authors (default false = resultado identico ao anterior) inclui tambem os '
  'AUTORES de mensagens do canal, para o nome do historico nao desaparecer quando alguem sai do '
  'roster — identidade preservada (L1), sem filtro de status de proposito.';

revoke all     on function public.channel_professionals(uuid, boolean) from public, anon;
grant  execute on function public.channel_professionals(uuid, boolean) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 11) RPC ESTREITA — my_clinic_memberships()
--
-- PARA QUE EXISTE: o item 4 fechou clinics_select para o desativado, e com razão (join_code).
-- Mas a tela precisa poder DIZER o que aconteceu, e para isso bastam três coisas: qual clínica,
-- o nome dela, e o meu status nela. É só isso que esta RPC devolve.
--
-- O QUE ELA **NUNCA** DEVOLVE, e está garantido por construção (colunas ENUMERADAS, sem
-- select *; não existe parâmetro nenhum):
--   · join_code ......... a credencial de entrada. Não está no SELECT.
--   · owner_profile_id .. quem é o dono. Não está no SELECT.
--   · dado de OUTRA pessoa ... o WHERE é `pr.profile_id = private.current_profile_id()`. Não há
--     como pedir o status de um colega: não existe argumento para isso.
--   · dado de outra clínica ... só as clínicas em que EU tenho linha em professionals.
--
-- FAIL-CLOSED: sem profile resolvido (JWT ausente/estranho, profile inexistente) ela devolve
-- VAZIO — `return;` sem `return query`. Não levanta erro genérico: erro distingue "não existe"
-- de "não posso", e essa distinção é vazamento. Vazio não distingue nada.
--
-- É SECDEF de propósito (precisa atravessar a RLS de clinics, que é justamente o que o item 4
-- fechou) e por isso entra no advisor 0029 — intencional, igual às outras RPCs de escrita
-- autenticada do projeto: a segurança está no fato de não haver parâmetro e no WHERE do autor.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.my_clinic_memberships()
returns table(clinic_id uuid, clinic_name text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
begin
  if v_me is null then
    return;   -- FAIL-CLOSED: vazio, nunca erro que vaze existencia
  end if;

  return query
    select pr.clinic_id,
           c.name,
           coalesce(pr.status,'active')
      from public.professionals pr
      join public.clinics c on c.id = pr.clinic_id
     where pr.profile_id = v_me
     order by c.name nulls last;
end;
$$;

comment on function public.my_clinic_memberships() is
  'WP-TEAM-2b-ii: caminho ESTREITO para a tela explicar a desativacao. Devolve APENAS clinic_id, '
  'nome da clinica e o status do PROPRIO chamador — nunca join_code, nunca owner_profile_id, '
  'nunca dado de terceiro (sem parametro; WHERE em current_profile_id). Fail-closed: sem profile '
  'resolvido devolve vazio. Frontend NAO alterado neste WP (opt-in e o WP seguinte).';

revoke all     on function public.my_clinic_memberships() from public, anon;
grant  execute on function public.my_clinic_memberships() to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 12) promote_to_professional — ÂNCORA ALTERADA DE PROPÓSITO
--
-- ⚠️ ESTE É O ÚNICO ITEM QUE MUDA UMA DAS 4 ÂNCORAS. Delta declarado antes de escrever:
--   b79d7630… (agregado das 4) muda; can_see_profile (7a31d3522ef51b7e6b10701a637a2efd),
--   create_clinic_with_owner e handle_new_user continuam BYTE A BYTE idênticas. A prova por
--   reconstrução no PR mostra que o delta é EXCLUSIVAMENTE esta função.
--
-- O BURACO QUE ISTO FECHA (achado D da Fase 2, e é o tipo que mais incomoda: UI que mente):
--   approve_join_request → promote_to_professional → encontra a linha EXISTENTE (que está
--   'inactive') → RETORNA ELA → a solicitação é marcada 'approved'. O admin vê "aprovado", o
--   badge fica verde, e a pessoa continua CORTADA. Nenhum erro, nenhum aviso.
--
-- A DECISÃO (do dono, explícita): NÃO reativar por aqui. Reativar é ato administrativo com
-- trilha própria (reactivate_professional). A porta da frente passa a RECUSAR, com mensagem
-- legível dizendo o que fazer. Consequências, as duas provadas na matriz:
--   · approve_join_request FALHA em consequência (não trata exceção) e a solicitação
--     PERMANECE 'pending' — nada de "aprovado" mentiroso.
--   · Linha existente ATIVA: comportamento IDÊNTICO ao de hoje (dedup, devolve a linha). Este
--     caminho está provado inalterado.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.promote_to_professional(
  p_profile_id      uuid,
  p_clinic_id       uuid,
  p_type            public.professional_type,
  p_clinic_role     text default 'member'::text,
  p_registry_number text default null::text,
  p_specialty       text default null::text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller          uuid := private.current_profile_id();
  v_existing        uuid;
  v_existing_status text;
  v_target_status   text;
  v_new_prof        uuid;
begin
  if v_caller is null then
    raise exception 'promote_to_professional: not authenticated' using errcode = '42501';
  end if;

  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'promote_to_professional: caller is not admin of clinic %', p_clinic_id
      using errcode = '42501';
  end if;

  if p_profile_id = v_caller then
    raise exception 'promote_to_professional: self-promotion is not allowed'
      using errcode = '42501';
  end if;

  if p_profile_id is null or p_type is null then
    raise exception 'promote_to_professional: p_profile_id and p_type are required'
      using errcode = '22004';
  end if;
  if p_clinic_role not in ('member', 'admin') then
    raise exception 'promote_to_professional: invalid clinic_role %', p_clinic_role
      using errcode = '22023';
  end if;

  select pr.id, coalesce(pr.status,'active') into v_existing, v_existing_status
  from public.professionals pr
  where pr.profile_id = p_profile_id and pr.clinic_id = p_clinic_id
  limit 1;
  if v_existing is not null then
    -- WP-TEAM-2b-ii: cadastro DESATIVADO nao volta pela porta da frente. Sem isto, aprovar uma
    -- solicitacao de quem foi desativado devolvia a linha inativa e marcava a solicitacao como
    -- 'approved' — aprovacao muda, acesso nao. Reativar tem RPC propria, com trilha.
    if v_existing_status = 'inactive' then
      raise exception 'promote_to_professional: profile % tem cadastro DESATIVADO na clinica % e precisa ser REATIVADO por reactivate_professional, nao promovido de novo', p_profile_id, p_clinic_id
        using errcode = '22023', hint = 'PROFESSIONAL_INACTIVE';
    end if;
    return v_existing;
  end if;

  select status into v_target_status from public.profiles where id = p_profile_id;
  if v_target_status is null then
    raise exception 'promote_to_professional: target profile % not found', p_profile_id
      using errcode = 'P0002';
  end if;
  if v_target_status <> 'pending' then
    raise exception 'promote_to_professional: target profile % is not pending (status=%)',
      p_profile_id, v_target_status using errcode = '22023';
  end if;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, registry_number, specialty)
  values (p_profile_id, p_clinic_id, p_type, p_clinic_role, p_registry_number, p_specialty)
  returning id into v_new_prof;

  update public.profiles
    set role = 'professional', status = 'active'
  where id = p_profile_id;

  return v_new_prof;
end $$;

comment on function public.promote_to_professional(uuid,uuid,public.professional_type,text,text,text) is
  'SSOT de promocao a profissional (WP-HARDENING-A1). WP-TEAM-2b-ii: linha existente com '
  'status=inactive levanta erro legivel (hint PROFESSIONAL_INACTIVE) em vez de devolver a linha '
  'desativada — approve_join_request falha em consequencia e a solicitacao PERMANECE pending. '
  'Linha existente ATIVA: dedup inalterado.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 13) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260808090000', '20260808090000_wp_team_2bii_professional_deactivation.sql',
  'WP-TEAM-2b-ii: desativacao do PROFISSIONAL na clinica. Ao contrario do 2b-i (vinculo), aqui os '
  'helpers TEM de mudar: nenhuma das 109 policies cita status e a unica filtragem de estado do '
  'grafo era sobre o VINCULO. Entrega: professionals.status (+changed_at/by/reason) com CHECK, '
  'UNIQUE (profile_id, clinic_id) fechando a DIVIDA-A1-1, revoke update das 4 colunas novas, e a '
  'tabela IMUTAVEL professional_status_events (append-only: so policy de SELECT para admin da '
  'clinica). RPCs deactivate_professional (recusa o DONO — L2, e a autodesativacao; cascateia '
  'TODOS os vinculos ativos pelo nucleo extraido private.deactivate_link_core, herdando trilha e '
  'roster do chat, com prefixo [DESATIVACAO_DO_PROFISSIONAL] no motivo) e reactivate_professional '
  '(NAO reativa vinculo — assimetria deliberada). 6 helpers passam a exigir profissional ativo: '
  'is_clinic_admin (ramo do DONO INTACTO), owns_professional, is_clinic_staff, '
  'is_common_professional_of_patient, is_external_professional_of_patient e is_clinic_member — '
  'este ultimo por decisao do dono na Fase 2, porque clinics_select entrega o JOIN_CODE, que e '
  'credencial de entrada e nao metadado. can_see_profile NAO TOCADA (7a31d352…, byte a byte). '
  'report_exports_select: o ramo de AUTORIA passa a exigir is_clinic_staff (profissional ativo) e '
  'o ramo do ADMIN fica intacto — auditoria nao depende de quem exportou continuar na clinica. '
  'professionals_admin_write (FOR ALL) substituida por professionals_admin_insert/update: sai o '
  'DELETE, que cascateava apagando a trilha imutavel do 2b-i e os vinculos, inclusive os do dono '
  '(cmd de policy e imutavel, por isso 1 policy virou 2 — mesmo predicado, nada novo autorizado; '
  'o SELECT do admin ja vem de professionals_select). channel_professionals ganha '
  'p_include_message_authors default false (false = resultado identico, provado) para o nome do '
  'autor nao desaparecer do historico quando ele sai do roster (T5) — sem filtro de status, de '
  'proposito. my_clinic_memberships(): caminho ESTREITO (clinic_id, nome, meu status) para a tela '
  'explicar a desativacao sem reabrir clinics — nunca join_code, nunca owner_profile_id, sem '
  'parametro, fail-closed vazio. promote_to_professional (ANCORA, mudanca declarada): linha '
  'existente inactive levanta erro legivel em vez de devolver a linha desativada, entao '
  'approve_join_request falha e a solicitacao PERMANECE pending; caminho da linha ATIVA '
  'inalterado. NAO altera frontend, NAO invalida sessao, NAO mexe em profiles.status. '
  'DIVIDA-PRIV-2: o revoke de coluna e apagado por um grant de TABELA futuro, silenciosamente.',
  'WP-TEAM-2b-ii')
on conflict (version) do nothing;
