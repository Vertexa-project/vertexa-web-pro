-- =====================================================================================
-- WP-CHAT-MENTIONS-A — RESTRIÇÕES DECLARATIVAS + RPC DE LEITURA (canal único)
--
-- A TESE DESTE WP, EM UMA FRASE: as duas garantias que faltavam no chat — "a resposta é do
-- mesmo canal" e "só se marca quem participa" — deixam de depender de disciplina do cliente e
-- passam a ser IMPOSSÍVEIS DE VIOLAR, uma por constraint e outra por RLS.
--
-- O QUE ESTA MIGRATION FAZ:
--   1) chat_messages.channel_id → SET NOT NULL (0 linhas nulas hoje; verificado no GATE).
--   2) chat_messages → UNIQUE (id, channel_id): o alvo da FK composta do item 3.
--   3) chat_messages.reply_to_message_id + FK COMPOSTA (reply_to_message_id, channel_id) →
--      (id, channel_id). Responder mensagem de OUTRO canal passa a ser impossível por
--      construção — não por trigger, não por confiança no client.
--   4) chat_mentions → UNIQUE (message_id, mentioned_profile_id): marcação repetida não duplica.
--   5) chat_mentions_insert APERTADO: além de o AUTOR ser participante (já era), o PERFIL
--      MARCADO também precisa ser participante do MESMO canal.
--   6) RPC channel_professionals(uuid) — leitura, SECURITY DEFINER, portão can_read_channel.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ:
--   · NÃO altera private.can_read_channel nem nenhum outro helper (os 48 mantêm o hash agregado).
--   · NÃO altera public.get_or_create_channel.
--   · NÃO toca no roster (chat_participants) — nem dado, nem policy.
--   · NÃO altera as policies de chat_channels, chat_participants nem chat_messages.
--     A ÚNICA policy alterada em todo o sistema é chat_mentions_insert, e só para APERTAR.
--   · NÃO cria tabela de menção nova, NÃO denormaliza channel_id em chat_mentions e NÃO cria
--     send_chat_message. O desenho anterior foi cancelado: chat_mentions JÁ existe e já está
--     cabeada nos dois clientes (o app da paciente insere; a web lê, marca lida e assina o
--     realtime). Uma segunda tabela forkaria o badge de não-lidas.
--   · NÃO revoga o INSERT direto em chat_messages nem em chat_mentions: o app da paciente
--     escreve por eles hoje e quebraria em produção.
--
-- ⚠️ SOBRE O ITEM 5 — ONDE A LETRA DA ORDEM NÃO PÔDE SER SEGUIDA (leia antes de auditar):
--   O WP pediu para reusar `private.is_channel_participant`. Ele NÃO serve aqui: a assinatura é
--   `is_channel_participant(p_channel uuid)` e o perfil testado é FIXO em
--   `private.current_profile_id()` — não há como perguntar a ele por OUTRO perfil. Varri os 48
--   helpers de `private`: é o ÚNICO que toca chat_participants, e nenhum aceita (canal, perfil).
--   Como criar helper novo também é proibido pelo WP, sobrou uma saída: o EXISTS inline abaixo,
--   que repete LITERALMENTE o predicado do helper trocando `current_profile_id()` pelo
--   `mentioned_profile_id`. `private.message_channel(message_id)` continua sendo reusado.
--   Nenhuma regra de autorização nova foi inventada — só a mesma, aplicada ao outro sujeito.
--
-- ⚠️ MUDANÇA DE COMPORTAMENTO OBSERVÁVEL (item 5 é NARROWING — ver matriz no PR):
--   Hoje o INSERT em chat_mentions aceita QUALQUER `mentioned_profile_id` (o WITH CHECK só olha
--   o autor). Depois desta migration, marcar não-participante passa a falhar com 42501. Nenhum
--   caminho do produto faz isso (GATE G3: o seletor do app é alimentado por chat_participants
--   daquele canal), MAS existe uma CORRIDA real: se o profissional for removido do roster entre
--   o carregamento do seletor e o envio, o INSERT da menção passa a falhar onde antes passava.
--   Como o app insere a MENSAGEM e a MENÇÃO em chamadas separadas (não há transação no client),
--   nesse caso a mensagem fica gravada e o usuário vê erro. É pré-existente e agora alcançável.
--   Registrado em docs/PENDENCIAS.md.
--
-- ROLLBACK COMPLETO:
--   drop function if exists public.channel_professionals(uuid);
--   drop policy if exists chat_mentions_insert on public.chat_mentions;
--   create policy chat_mentions_insert on public.chat_mentions
--     for insert to authenticated
--     with check (private.is_channel_participant(private.message_channel(message_id)));
--   alter table public.chat_mentions drop constraint if exists chat_mentions_message_profile_key;
--   alter table public.chat_messages drop constraint if exists chat_messages_reply_same_channel_fkey;
--   alter table public.chat_messages drop column if exists reply_to_message_id;
--   alter table public.chat_messages drop constraint if exists chat_messages_id_channel_key;
--   alter table public.chat_messages alter column channel_id drop not null;
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) channel_id NOT NULL
--
-- Pré-requisito do item 3, não cosmética. Com channel_id anulável, a FK composta seria
-- MATCH SIMPLE com uma coluna nula ⇒ NÃO verificada — a garantia "mesmo canal" viraria letra
-- morta exatamente nas linhas malformadas. GATE: 0 linhas com channel_id nulo e 0 órfãs.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.chat_messages alter column channel_id set not null;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) UNIQUE (id, channel_id) — alvo da FK composta
--
-- Redundante do ponto de vista de unicidade (id já é PK), e é DE PROPÓSITO: o Postgres exige
-- um índice único sobre EXATAMENTE as colunas referenciadas para aceitar a FK do item 3.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.chat_messages
  add constraint chat_messages_id_channel_key unique (id, channel_id);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) RESPOSTA A MENSAGEM — mesma-canal por CONSTRUÇÃO
--
-- A FK carrega channel_id nos DOIS lados: para a linha existir, a mensagem-pai tem de ter o
-- MESMO channel_id da filha. Responder mensagem de outro canal deixa de ser possível — o que
-- importa porque o preview citado renderiza o corpo da mensagem-pai: sem isto, uma resposta
-- forjada vazaria conteúdo de outra conversa para dentro desta.
--
-- MATCH SIMPLE (padrão) é o comportamento desejado aqui: com reply_to_message_id NULO a FK não
-- é verificada — mensagem sem resposta é o caso normal. E channel_id é NOT NULL (item 1), então
-- não existe o caso perigoso de "meio nulo".
--
-- ON DELETE SET NULL **(reply_to_message_id)** — a forma com lista de colunas (PG 15+; aqui
-- roda 17.6). A forma sem lista anularia TODAS as colunas referenciantes, inclusive channel_id,
-- que é NOT NULL: apagar uma mensagem respondida estouraria erro em vez de limpar a citação.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.chat_messages
  add column if not exists reply_to_message_id uuid;

comment on column public.chat_messages.reply_to_message_id is
  'WP-CHAT-MENTIONS-A: mensagem citada. FK COMPOSTA com channel_id garante que a mensagem-pai e '
  'do MESMO canal. Apagar a mensagem-pai limpa a citacao (on delete set null na coluna).';

alter table public.chat_messages
  add constraint chat_messages_reply_same_channel_fkey
  foreign key (reply_to_message_id, channel_id)
  references public.chat_messages (id, channel_id)
  on delete set null (reply_to_message_id);

-- Busca das respostas de uma mensagem (thread rasa). Parcial: a esmagadora maioria das
-- mensagens não é resposta, e índice parcial não paga por elas.
create index if not exists idx_chat_messages_reply_to
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) MENÇÃO ÚNICA POR (mensagem, perfil)
--
-- Idempotência por CONSTRUÇÃO em vez de por cuidado do cliente. Hoje há 0 duplicatas, então a
-- constraint entra sem backfill.
-- NOTA: message_id e mentioned_profile_id continuam ANULÁVEIS (assim nasceram). UNIQUE não
-- constrange linhas com nulo — hoje há 0 linhas nulas, e apertar para NOT NULL está FORA do
-- escopo deste WP (registrado em PENDENCIAS).
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.chat_mentions
  add constraint chat_mentions_message_profile_key unique (message_id, mentioned_profile_id);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) APERTO DA ÚNICA POLICY QUE MUDA — chat_mentions_insert
--
-- ANTES: with check (private.is_channel_participant(private.message_channel(message_id)))
--        ⇒ só verificava o AUTOR. O perfil marcado podia ser QUALQUER UUID de profile.
-- DEPOIS: o mesmo, E o perfil marcado tem de ser participante do MESMO canal.
--
-- POR QUE IMPORTA: sem isto, marcar identificadores é uma sonda de existência. Um cliente
-- forjado insere menções para UUIDs arbitrários e usa o sucesso/erro para descobrir quais
-- profiles existem — e, no dia em que a menção virar notificação, para entregar conteúdo a
-- quem não é do canal. É o buraco que este item fecha.
--
-- NARROWING, NÃO WIDENING: nenhuma inserção antes NEGADA passa a ser aceita.
-- ─────────────────────────────────────────────────────────────────────────────────────
drop policy if exists chat_mentions_insert on public.chat_mentions;

create policy chat_mentions_insert on public.chat_mentions
  for insert to authenticated
  with check (
    private.is_channel_participant(private.message_channel(message_id))
    and exists (
      select 1
        from public.chat_participants cp
       where cp.channel_id = private.message_channel(message_id)
         and cp.profile_id = mentioned_profile_id
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) RPC — PROFISSIONAIS DO CANAL (leitura)
--
-- POR QUE ELA EXISTE: a paciente enxerga o NOME do profissional vinculado (ramo 4 de
-- private.can_see_profile), mas NÃO lê `professionals` (policy exige ser o próprio ou admin da
-- clínica) nem `professional_disciplines` (exige ser staff). Resultado hoje, em produção: o
-- seletor de @ do app da paciente pede `profiles(...professionals(type, specialty))` e recebe
-- VAZIO — o tipo cai para null, sem erro. Esta RPC resolve isso SEM alargar policy nenhuma.
--
-- PORTÃO: private.can_read_channel(p_channel_id) — o MESMO helper das policies de chat, reusado
-- e não reescrito. Quem lê o canal vê a equipe dele; qualquer outro recebe 42501 antes de
-- qualquer leitura de dado. A profissional EXTERNA não é participante e can_access_patient_
-- internal a exclui ⇒ ela nem chama a RPC, nem aparece no resultado de quem chama.
--
-- SUPERFÍCIE MÍNIMA: as colunas são ENUMERADAS. `registry_number` (documento profissional)
-- NÃO é devolvido, e nenhuma outra coluna de `professionals` além de type/specialty.
--
-- O left join escopa por clínica DA PACIENTE do canal para não duplicar linha caso um profile
-- venha a ter registro profissional em mais de uma clínica; e é LEFT para o participante ainda
-- aparecer (com type nulo) em vez de sumir da lista.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.channel_professionals(p_channel_id uuid)
returns table (
  profile_id  uuid,
  full_name   text,
  type        public.professional_type,
  specialty   text,
  disciplines text[]
)
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
    select cp.profile_id,
           pf.full_name,
           pr.type,
           pr.specialty,
           coalesce(
             (select array_agg(pd.discipline order by pd.discipline)
                from public.professional_disciplines pd
               where pd.professional_id = pr.id),
             '{}'::text[]
           )
      from public.chat_participants cp
      join public.profiles pf on pf.id = cp.profile_id
      left join public.professionals pr
             on pr.profile_id = cp.profile_id
            and pr.clinic_id = v_clinic
     where cp.channel_id = p_channel_id
       and cp.role = 'professional'::public.user_role
     order by pf.full_name nulls last;
end;
$$;

comment on function public.channel_professionals(uuid) is
  'WP-CHAT-MENTIONS-A: profissionais participantes do canal (nome, tipo, especialidade e '
  'disciplinas) para quem ja pode ler o canal (private.can_read_channel). NAO devolve '
  'registry_number. Existe para o seletor de @ do app da paciente, que hoje recebe vazio em '
  'professionals/professional_disciplines por RLS.';

revoke all     on function public.channel_professionals(uuid) from public, anon;
grant  execute on function public.channel_professionals(uuid) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260806090000', '20260806090000_wp_chat_mentions_a.sql',
  'WP-CHAT-MENTIONS-A: restricoes DECLARATIVAS de resposta/mencao + RPC de leitura. '
  'chat_messages.channel_id vira NOT NULL (0 nulos no gate), ganha UNIQUE (id, channel_id) e a '
  'coluna reply_to_message_id com FK COMPOSTA (reply_to_message_id, channel_id) -> (id, '
  'channel_id) ON DELETE SET NULL (reply_to_message_id): responder mensagem de OUTRO canal vira '
  'impossivel por construcao, sem trigger. chat_mentions ganha UNIQUE (message_id, '
  'mentioned_profile_id). UNICA policy alterada no sistema: chat_mentions_insert, so para '
  'APERTAR — alem do autor participante (ja era), o PERFIL MARCADO passa a precisar ser '
  'participante do mesmo canal (fecha sondagem de existencia de profile por marcacao). '
  'is_channel_participant NAO pode ser reusado para o marcado (e fixo em current_profile_id) e '
  'criar helper e proibido: a checagem ficou inline com o MESMO predicado; message_channel '
  'segue reusado. RPC nova channel_professionals(uuid) SECDEF com portao can_read_channel '
  'devolve profile_id/full_name/type/specialty/disciplines dos participantes profissionais — '
  'colunas enumeradas, SEM registry_number — para destravar o seletor de @ do app da paciente, '
  'que hoje recebe VAZIO de professionals/professional_disciplines por RLS. NAO cria tabela de '
  'mencao nova, NAO denormaliza channel_id, NAO cria send_chat_message, NAO altera '
  'can_read_channel/get_or_create_channel/roster nem as policies de chat_channels/'
  'chat_participants/chat_messages. INSERT direto em chat_messages e chat_mentions PRESERVADO '
  '(o app da paciente depende dele).',
  'WP-CHAT-MENTIONS-A')
on conflict (version) do nothing;
