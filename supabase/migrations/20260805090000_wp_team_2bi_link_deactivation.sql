-- =====================================================================================
-- WP-TEAM-2b-i — DESATIVAÇÃO DO VÍNCULO PROFISSIONAL↔PACIENTE.
--
-- A TESE DESTE WP, EM UMA FRASE: o corte de acesso JÁ EXISTE no banco; falta só um jeito
-- seguro e auditável de acionar o interruptor.
--
-- Por que nenhum helper e nenhuma policy precisam mudar (verificado no baseline):
--   private.is_common_professional_of_patient   filtra coalesce(status,'active')='active'
--                                               AND coalesce(is_external,false)=false
--   private.is_external_professional_of_patient filtra coalesce(status,'active')='active'
--                                               AND coalesce(is_external,false)=true
-- Como TODO o acesso clínico do profissional passa por um desses dois (direta ou
-- indiretamente, via can_access_patient / can_access_patient_internal /
-- can_prescribe_for_patient / can_write_discipline / can_read_channel), virar o status para
-- 'inactive' derruba o acesso INTEIRO — interno E externo — sem tocar em uma linha de RLS.
-- A prova disso é hash: as 49 tabelas pré-existentes mantêm o hash de policies item a item e
-- os 48 helpers de private mantêm o hash agregado. Ver PROVAS no PR.
--
-- O QUE ESTA MIGRATION FAZ:
--   1) Carimbo de auditoria em professional_patient_links (3 colunas) — ADICIONAR COLUNA NÃO
--      ALTERA POLICY: o texto de qual/with_check das 2 policies da tabela fica idêntico.
--   2) Tabela NOVA ppl_status_events — trilha IMUTÁVEL. Só ela adiciona policy ao sistema
--      (1 policy de SELECT), e é o ÚNICO delta esperado no HASH_GLOBAL.
--   3) 3 RPCs SECURITY DEFINER: desativar, reativar e listar pacientes sem responsável.
--
-- FECHAMENTO DA DÍVIDA V7 (aberta no WP-CHAT-FIX): desativar o vínculo remove o profissional
-- de chat_participants NA MESMA TRANSAÇÃO. Sem isso, a leitura do chat cairia na hora
-- (derivada) mas a ESCRITA sobreviveria até alguém reabrir o canal, porque
-- chat_messages_insert exige linha no roster. Com isso, some tudo junto.
--
-- ASSIMETRIA DELIBERADA NA REATIVAÇÃO (mantida do #36, NÃO é esquecimento): reativar NÃO
-- recria a linha do roster. A LEITURA volta na hora (derivada de can_access_patient_internal)
-- e o roster é reconciliado na próxima abertura por get_or_create_channel. Ou seja: reativado
-- lê imediatamente e escreve quando a conversa for aberta.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ:
--   · NÃO altera nenhuma policy existente (as 107 pré-existentes ficam byte a byte iguais).
--   · NÃO altera nenhum helper de private (os 48 mantêm o hash agregado 18b93d84…).
--   · NÃO toca identidade (handle_new_user, can_see_profile, current_profile_id).
--   · NÃO toca promote_to_professional nem create_clinic_with_owner.
--   · NÃO faz soft-delete de `professionals` — desativar MEMBRO DA CLÍNICA é outro escopo.
--     Aqui se desativa o VÍNCULO com UMA paciente.
--   · NÃO adiciona CHECK em professional_patient_links.status (fora de escopo). Hoje a coluna
--     é text livre; quem escreve 'inactive' é a RPC. Um CHECK ('active','inactive') é candidato
--     natural a um WP de limpeza — registrado em PENDENCIAS.
--
-- KILL SWITCH (desliga o fluxo sem desfazer nada):
--   revoke execute on function public.deactivate_patient_link(uuid,uuid,text) from authenticated;
--   revoke execute on function public.reactivate_patient_link(uuid,uuid,text) from authenticated;
--   revoke execute on function public.patients_without_active_professional(uuid) from authenticated;
--   Os vínculos já desativados PERMANECEM desativados (é o estado, não o gatilho). Para
--   religar acesso sem a RPC: update professional_patient_links set status='active' where …
--
-- ROLLBACK COMPLETO:
--   drop function if exists public.patients_without_active_professional(uuid);
--   drop function if exists public.reactivate_patient_link(uuid,uuid,text);
--   drop function if exists public.deactivate_patient_link(uuid,uuid,text);
--   drop table if exists public.ppl_status_events;
--   alter table public.professional_patient_links
--     drop column if exists status_reason,
--     drop column if exists status_changed_by,
--     drop column if exists status_changed_at;
--   -- ATENÇÃO: o rollback NÃO reativa vínculos desativados. Se quiser reverter o EFEITO:
--   -- update public.professional_patient_links set status='active' where status='inactive';
--   -- (e reabrir as conversas para o roster reconciliar)
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) CARIMBO DE AUDITORIA NO VÍNCULO
-- Quem/quando/por quê da última mudança de status. `if not exists` mantém idempotente.
-- ADICIONAR COLUNA NÃO ALTERA POLICY: ppl_select e ppl_admin_write continuam com o mesmo
-- texto de qual/with_check, logo o hash da tabela professional_patient_links não muda.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.professional_patient_links
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.profiles(id),
  add column if not exists status_reason     text;

comment on column public.professional_patient_links.status_changed_by is
  'Profile que mudou o status pela ultima vez. Preenchido pelo SERVIDOR dentro das RPCs.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) TRILHA IMUTÁVEL — ppl_status_events
--
-- Append-only por CONSTRUÇÃO: existe policy de SELECT e mais nada. Sem policy de INSERT,
-- UPDATE ou DELETE, a RLS nega os três para `authenticated` — nem o admin reescreve a
-- história. Quem grava são as RPCs (SECURITY DEFINER rodam como owner e não passam por RLS).
--
-- changed_by vem SEMPRE de private.current_profile_id() dentro da RPC, NUNCA do cliente.
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ppl_status_events (
  id              uuid primary key default gen_random_uuid(),
  link_id         uuid not null references public.professional_patient_links(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  patient_id      uuid not null references public.patients(id)      on delete cascade,
  from_status     text,
  to_status       text not null,
  reason          text,
  changed_by      uuid references public.profiles(id),
  changed_at      timestamptz not null default now()
);

comment on table public.ppl_status_events is
  'WP-TEAM-2b-i: trilha IMUTAVEL de ativacao/desativacao de vinculo profissional<->paciente. '
  'Append-only: so existe policy de SELECT (admin da clinica do paciente). Escrita so pelas RPCs.';

create index if not exists ppl_status_events_link_idx    on public.ppl_status_events (link_id, changed_at desc);
create index if not exists ppl_status_events_patient_idx on public.ppl_status_events (patient_id, changed_at desc);

alter table public.ppl_status_events enable row level security;

-- ÚNICA policy da tabela — e o ÚNICO delta esperado no HASH_GLOBAL de policies.
-- Mesmo predicado que ppl_admin_write já usa para escrever o vínculo: admin da clínica DA
-- PACIENTE. Não há ramo para o profissional ver a própria desativação (decisão: a trilha é
-- instrumento de auditoria do admin, não notificação ao desativado).
create policy ppl_status_events_select on public.ppl_status_events
  for select to authenticated
  using (private.is_clinic_admin(private.patient_clinic(patient_id)));

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) RPC — DESATIVAR VÍNCULO
--
-- FAIL-CLOSED: sem admin da clínica da paciente ⇒ 42501, antes de qualquer leitura de dado.
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
  v_clinic       uuid;
  v_link_id      uuid;
  v_from_status  text;
  v_prof_clinic  uuid;
  v_prof_profile uuid;
  v_me           uuid;
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
  select pr.clinic_id, pr.profile_id into v_prof_clinic, v_prof_profile
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

  v_me := private.current_profile_id();

  update public.professional_patient_links
     set status            = 'inactive',
         status_changed_at = now(),
         status_changed_by = v_me,
         status_reason     = p_reason
   where id = v_link_id;

  insert into public.ppl_status_events
    (link_id, professional_id, patient_id, from_status, to_status, reason, changed_by)
  values (v_link_id, p_professional_id, p_patient_id, v_from_status, 'inactive', p_reason, v_me);

  -- ── FECHA A DÍVIDA V7 ──────────────────────────────────────────────────────────────
  -- Tira o profissional do roster do canal DESTA paciente, na MESMA transação. A leitura já
  -- cairia sozinha (derivada), mas a ESCRITA depende da linha do roster: sem este DELETE, o
  -- desativado continuaria mandando mensagem até alguém reabrir a conversa.
  -- Só role='professional': a linha da paciente e eventuais 'admin' ficam intactas.
  if v_prof_profile is not null then
    delete from public.chat_participants cp
     using public.chat_channels cc
     where cc.patient_id = p_patient_id
       and cp.channel_id = cc.id
       and cp.profile_id = v_prof_profile
       and cp.role = 'professional'::public.user_role;
  end if;

  return v_link_id;
end;
$$;

comment on function public.deactivate_patient_link(uuid,uuid,text) is
  'WP-TEAM-2b-i: desativa o vinculo profissional<->paciente (status=inactive), grava trilha '
  'imutavel com autor do servidor e remove o profissional do roster do chat na mesma transacao.';

revoke all     on function public.deactivate_patient_link(uuid,uuid,text) from public, anon;
grant  execute on function public.deactivate_patient_link(uuid,uuid,text) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) RPC — REATIVAR VÍNCULO (simétrica)
--
-- NÃO recria a linha do roster de propósito — ver nota de assimetria no cabeçalho.
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
    return v_link_id;   -- idempotente, sem trilha duplicada
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

  return v_link_id;
end;
$$;

comment on function public.reactivate_patient_link(uuid,uuid,text) is
  'WP-TEAM-2b-i: reativa o vinculo. NAO recria linha em chat_participants — a leitura do chat '
  'volta na hora (derivada) e o roster reconcilia na proxima abertura por get_or_create_channel.';

revoke all     on function public.reactivate_patient_link(uuid,uuid,text) from public, anon;
grant  execute on function public.reactivate_patient_link(uuid,uuid,text) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) RPC — PACIENTES SEM RESPONSÁVEL ATIVO
--
-- "Sem responsável" = nenhum vínculo INTERNO ativo. Um vínculo apenas EXTERNO não conta como
-- responsável — é o mesmo critério de is_common_professional_of_patient, que é quem governa
-- o acesso clínico. Admin da clínica apenas.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.patients_without_active_professional(p_clinic_id uuid)
returns table (patient_id uuid, full_name text, since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_clinic_id is null then
    raise exception 'Clinica nao informada.' using errcode = '22023';
  end if;

  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'Apenas o administrador da clinica ve esta lista.' using errcode = '42501';
  end if;

  return query
    select pt.id,
           pr.full_name,
           (select max(l.status_changed_at)
              from public.professional_patient_links l
             where l.patient_id = pt.id) as since
      from public.patients pt
      left join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic_id
       and not exists (
             select 1
               from public.professional_patient_links l
              where l.patient_id = pt.id
                and coalesce(l.status,'active') = 'active'
                and coalesce(l.is_external,false) = false)
     order by pr.full_name nulls last;
end;
$$;

comment on function public.patients_without_active_professional(uuid) is
  'WP-TEAM-2b-i: pacientes da clinica sem NENHUM vinculo interno ativo. Admin da clinica apenas. '
  'Vinculo apenas EXTERNO nao conta como responsavel (mesmo criterio de is_common_professional_of_patient).';

revoke all     on function public.patients_without_active_professional(uuid) from public, anon;
grant  execute on function public.patients_without_active_professional(uuid) to   authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260805090000', '20260805090000_wp_team_2bi_link_deactivation.sql',
  'WP-TEAM-2b-i: desativacao do vinculo profissional<->paciente SEM tocar RLS. A tese: '
  'is_common_professional_of_patient e is_external_professional_of_patient JA filtram '
  'coalesce(status,active)=active, entao virar o status derruba o acesso clinico inteiro '
  '(interno E externo) por identidade de hash — 49 tabelas com hash de policy identico item a '
  'item e os 48 helpers de private com hash agregado identico. Adiciona status_changed_at/by/'
  'reason em professional_patient_links (coluna nao altera policy) e a tabela IMUTAVEL '
  'ppl_status_events (append-only: so policy de SELECT para admin da clinica; escrita so pelas '
  'RPCs SECURITY DEFINER) — unica policy nova do sistema. RPCs deactivate_patient_link e '
  'reactivate_patient_link (admin da clinica da paciente, recusam profissional de outra clinica, '
  'idempotentes, autor do servidor) e patients_without_active_professional. Desativar remove o '
  'profissional de chat_participants na MESMA transacao, fechando a divida V7 do WP-CHAT-FIX '
  '(sem isso a leitura caia mas a escrita sobrevivia ate reabrir o canal). Reativar NAO recria o '
  'roster — assimetria mantida do #36. NENHUMA policy existente alterada, NENHUM helper alterado, '
  'identidade e promote_to_professional intocados. NAO faz soft-delete de professionals.',
  'WP-TEAM-2b-i')
on conflict (version) do nothing;
