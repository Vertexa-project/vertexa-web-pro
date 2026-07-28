-- =====================================================================================
-- WP-CHAT-FIX — CRIAÇÃO DE CANAL POR RPC + LEITURA POR VÍNCULO VIVO.
--
-- DOIS BUGS, UMA CORREÇÃO.
--
-- BUG 1 — 42501 ao abrir a conversa de uma paciente SEM canal.
--   O front fazia INSERT…RETURNING em chat_channels (.insert().select()). O INSERT em si
--   PASSA (o WITH CHECK é can_access_patient_internal e ele é verdadeiro). Quem falha é
--   EXCLUSIVAMENTE o RETURNING: dentro da MESMA statement a policy de SELECT chama
--   private.channel_patient(), que é STABLE e portanto usa o snapshot do INÍCIO da
--   statement — não enxerga a linha que a própria statement está inserindo. Resultado:
--   channel_patient() → NULL ⇒ patient_clinic(NULL) → NULL ⇒ is_clinic_admin(NULL) → false;
--   is_channel_participant → false (ainda não há roster) ⇒ can_read_channel → false ⇒ 42501.
--   NÃO é recursão de policy: é VISIBILIDADE DE SNAPSHOT. Provado: numa statement SEPARADA
--   a mesma linha É legível. Por isso a correção é tirar a criação de baixo do RETURNING.
--
-- BUG 2 — profissional COMUM vinculado à paciente NÃO conseguia ler o canal.
--   can_read_channel só concedia leitura a (a) quem tem linha em chat_participants ou
--   (b) admin da clínica. E NADA populava chat_participants além do seed. O bug já estava
--   vivo: Bruno Salles, Clara Vieira e Elisa Rocha têm vínculo ATIVO com pacientes que
--   possuem canal e mesmo assim não liam.
--
-- DECISÃO DE PRODUTO (lei do orquestrador): PARTICIPAÇÃO = VÍNCULO VIVO. Quem está
-- vinculado à paciente HOJE lê; quem perdeu o vínculo deixa de ler. Sem lista congelada.
-- Isso casa com a desativação futura (WP-TEAM-2b) sem código extra.
--
-- 3 PEÇAS:
--   PEÇA 1  RPC public.get_or_create_channel — cria/obtém o canal FORA do RETURNING sob RLS
--           e reconcilia o roster (chat_participants) na MESMA transação.
--   PEÇA 2  private.can_read_channel passa a derivar o lado profissional do VÍNCULO ATUAL.
--           ADITIVA: o ramo de admin que existia está LITERALMENTE CONTIDO no novo predicado
--           (é o 3º OR de can_access_patient_internal). Ninguém perde leitura.
--   PEÇA 3  ESCRITA INTOCADA. chat_messages_insert continua exigindo is_channel_participant.
--           Assimetria DELIBERADA e aprovada: vinculado LÊ na hora; ESCREVE quando o canal
--           é aberto pela RPC (que sincroniza o roster).
--
-- O QUE ESTA MIGRATION **NÃO** FAZ (garantias explícitas):
--   · NÃO altera NENHUMA POLICY. As 11 policies chat_% ficam byte a byte idênticas.
--   · NÃO toca chat_messages_insert, chat_participants_insert/delete, nem chat_mentions_*.
--   · NÃO toca identidade (handle_new_user, current_profile_id, can_see_profile).
--   · NÃO toca nenhum outro helper: can_access_patient_internal, is_channel_participant,
--     is_common_professional_of_patient, channel_patient, patient_clinic, is_clinic_admin,
--     can_manage_channel e can_prescribe_for_patient ficam INTOCADOS.
--   · Entre os helpers, SÓ private.can_read_channel muda de corpo.
--
-- KILL SWITCH (desliga a criação de canal sem afetar o resto do produto):
--   revoke execute on function public.get_or_create_channel(uuid) from authenticated;
--   (o front volta a receber erro ao ABRIR conversa nova; canais existentes seguem legíveis)
--
-- ROLLBACK COMPLETO:
--   drop function if exists public.get_or_create_channel(uuid);
--   -- restaura o can_read_channel ANTERIOR (exatamente como estava):
--   create or replace function private.can_read_channel(p_channel uuid)
--   returns boolean language sql stable security definer set search_path = '' as $rb$
--     select private.is_channel_participant(p_channel)
--         or private.is_clinic_admin(private.patient_clinic(private.channel_patient(p_channel)))
--   $rb$;
--   -- o backfill do roster NÃO é revertido de propósito: são linhas de participante
--   -- legítimas (profissionais com vínculo ativo). Para desfazer mesmo assim, remova as
--   -- linhas role='professional' criadas por ele; nenhuma mensagem depende delas.
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- PEÇA 1 — RPC get_or_create_channel
--
-- SECURITY DEFINER é o ponto inteiro: rodando como owner a RLS não se aplica, então o
-- par INSERT/SELECT não depende do RETURNING sob policy. A autorização NÃO é perdida —
-- ela é feita EXPLICITAMENTE na primeira linha, com o MESMO predicado que o WITH CHECK
-- da policy de INSERT já usava (can_access_patient_internal). Zero superfície nova.
--
-- IDEMPOTÊNCIA: garantida pelo UNIQUE(patient_id) de chat_channels — `on conflict do
-- nothing` + SELECT. Sem advisory lock, sem loop de retry: duas chamadas concorrentes
-- convergem para a mesma linha.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.get_or_create_channel(p_patient_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel         uuid;
  v_patient_profile uuid;
begin
  if p_patient_id is null then
    raise exception 'Paciente nao informado.' using errcode = '22023';
  end if;

  -- GATE. Mesmo predicado do WITH CHECK de chat_channels_insert. Um profissional não
  -- vinculado, de outra clínica, externo, ou um paciente que não é o dono param AQUI.
  if not private.can_access_patient_internal(p_patient_id) then
    raise exception 'Sem acesso a este paciente.' using errcode = '42501';
  end if;

  -- SELECT-ou-INSERT sem RETURNING sob RLS (a causa do BUG 1).
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

  -- ── ROSTER (chat_participants) ────────────────────────────────────────────────────
  -- O roster continua existindo e sendo MANTIDO: além de ser o gate de ESCRITA
  -- (chat_messages_insert), é a fonte do seletor de @menção do app do paciente
  -- (listChannelProfessionals filtra role='professional'). Derivar tudo e não manter
  -- linhas esvaziaria esse seletor — por isso o roster é reconciliado, não abolido.

  -- 1) o paciente dono do canal
  select pt.profile_id
    into v_patient_profile
    from public.patients pt
   where pt.id = p_patient_id;

  if v_patient_profile is not null then
    insert into public.chat_participants (channel_id, profile_id, role)
    values (v_channel, v_patient_profile, 'patient'::public.user_role)
    on conflict (channel_id, profile_id) do nothing;
  end if;

  -- 2) TODOS os profissionais com vínculo ATIVO e NÃO-externo (mesmo filtro de
  --    is_common_professional_of_patient — externo e status≠active ficam de fora)
  insert into public.chat_participants (channel_id, profile_id, role)
  select v_channel, pr.profile_id, 'professional'::public.user_role
    from public.professional_patient_links l
    join public.professionals pr on pr.id = l.professional_id
   where l.patient_id = p_patient_id
     and coalesce(l.status, 'active') = 'active'
     and coalesce(l.is_external, false) = false
     and pr.profile_id is not null
  on conflict (channel_id, profile_id) do nothing;

  -- 3) tira do roster quem PERDEU o vínculo. É isto que faz "perdeu o vínculo, perdeu o
  --    chat" valer também para a ESCRITA (a leitura já é viva pela PEÇA 2). Mexe SÓ em
  --    role='professional': linhas 'patient' e 'admin' são preservadas.
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

comment on function public.get_or_create_channel(uuid) is
  'WP-CHAT-FIX: obtem (ou cria) o canal 1:1 do paciente sem depender de INSERT..RETURNING '
  'sob RLS, e reconcilia o roster de chat_participants com os vinculos ATIVOS nao-externos. '
  'Autoriza com private.can_access_patient_internal — mesmo gate do WITH CHECK da policy.';

revoke all      on function public.get_or_create_channel(uuid) from public, anon;
grant  execute  on function public.get_or_create_channel(uuid) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- PEÇA 2 — can_read_channel passa a derivar o lado profissional do VÍNCULO ATUAL.
--
-- ANTES:
--   is_channel_participant(p_channel)
--   OR is_clinic_admin(patient_clinic(channel_patient(p_channel)))
-- DEPOIS:
--   is_channel_participant(p_channel)
--   OR can_access_patient_internal(channel_patient(p_channel))
--
-- POR QUE É ADITIVA (ninguém perde leitura): can_access_patient_internal(p) é, por
-- definição, `is_self_patient(p) OR is_common_professional_of_patient(p) OR
-- is_clinic_admin(patient_clinic(p))`. O terceiro OR é EXATAMENTE o ramo que existia
-- antes — ele não sumiu, foi absorvido. Os outros dois é que são o ganho.
--
-- QUEM GANHA leitura: o paciente dono do canal e o profissional COMUM com vínculo ATIVO
-- e NÃO-externo — derivado do vínculo, logo VIVO nos dois sentidos (vinculou, lê na hora;
-- desvinculou, para de ler na hora, sem reabrir nada).
-- QUEM NÃO GANHA: externo (is_external=true) e vínculo status≠'active' são excluídos pelo
-- filtro que já existe DENTRO de is_common_professional_of_patient — a regra vigente de
-- externo fica preservada sem eu escrever uma linha sobre ela. Profissional não vinculado,
-- de outra clínica, e anon continuam fora.
--
-- RAIO DE ALCANCE: can_read_channel é usada por 4 policies, TODAS de SELECT e TODAS de
-- chat (chat_channels_select, chat_messages_select, chat_participants_select,
-- chat_mentions_select). Nenhuma policy de ESCRITA a usa ⇒ escrita não é ampliada.
--
-- `create or replace` PRESERVA as permissões existentes da função. Assinatura, volatilidade
-- (stable), security definer e search_path='' ficam idênticos ao original.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.can_read_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_channel_participant(p_channel)
      or private.can_access_patient_internal(private.channel_patient(p_channel))
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- BACKFILL ÚNICO — reconcilia o roster dos canais QUE JÁ EXISTEM.
--
-- Objetivo: antecipar a ESCRITA. A LEITURA já fica correta sem backfill (PEÇA 2); o que
-- o backfill resolve é o profissional vinculado que ainda não estava no roster e por isso
-- não conseguiria ENVIAR mensagem até alguém abrir o canal pela RPC.
--
-- Só ADICIONA. NÃO cria canal nenhum (só percorre chat_channels existentes) e NÃO remove
-- linha nenhuma — a remoção de quem perdeu o vínculo é responsabilidade da RPC, no fluxo
-- normal, e não de uma migration. Idempotente por `on conflict do nothing`.
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.chat_participants (channel_id, profile_id, role)
select cc.id, pr.profile_id, 'professional'::public.user_role
  from public.chat_channels cc
  join public.professional_patient_links l on l.patient_id = cc.patient_id
  join public.professionals pr            on pr.id = l.professional_id
 where coalesce(l.status, 'active') = 'active'
   and coalesce(l.is_external, false) = false
   and pr.profile_id is not null
on conflict (channel_id, profile_id) do nothing;

insert into public.chat_participants (channel_id, profile_id, role)
select cc.id, pt.profile_id, 'patient'::public.user_role
  from public.chat_channels cc
  join public.patients pt on pt.id = cc.patient_id
 where pt.profile_id is not null
on conflict (channel_id, profile_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260804090000', '20260804090000_wp_chat_fix_channel_rpc.sql',
  'WP-CHAT-FIX: corrige 42501 na abertura de conversa e a leitura por vinculo. BUG 1 era o '
  'INSERT..RETURNING do front: o INSERT passa, o RETURNING falha porque channel_patient() e '
  'STABLE e nao enxerga a linha da propria statement (visibilidade de snapshot, NAO recursao '
  'de policy). RPC public.get_or_create_channel (SECURITY DEFINER, search_path vazio, EXECUTE '
  'so authenticated) autoriza com can_access_patient_internal — mesmo gate do WITH CHECK — e '
  'faz on conflict(patient_id) do nothing + SELECT, fora do RETURNING sob RLS; idempotente pelo '
  'UNIQUE. BUG 2 era o roster estatico: private.can_read_channel passa a is_channel_participant '
  'OR can_access_patient_internal(channel_patient(...)), ADITIVA — o ramo de admin ja estava '
  'contido no novo predicado; externo e status<>active seguem excluidos pelo filtro de '
  'is_common_professional_of_patient. A RPC reconcilia chat_participants (adiciona vinculados '
  'ativos, remove role=professional sem vinculo; nao toca patient/admin), mantendo o roster como '
  'fonte do seletor de @mencao do app. Backfill unico so ADITIVO dos canais existentes para '
  'antecipar a ESCRITA. NENHUMA policy alterada (as 11 chat_% intactas); chat_messages_insert, '
  'identidade e os demais helpers NAO tocados; entre os helpers so can_read_channel mudou.',
  'WP-CHAT-FIX')
on conflict (version) do nothing;
