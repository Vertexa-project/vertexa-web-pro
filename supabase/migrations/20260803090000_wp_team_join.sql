-- =====================================================================================
-- WP-TEAM-JOIN — ENTRADA DE PROFISSIONAL NA CLÍNICA POR SOLICITAÇÃO (código de acesso).
--
-- PROBLEMA (WP-TEAM-CHECK, 2026-07-28): com VITE_AUTH_MODE=real no ar, todo profissional
-- que entra por Google sem match por e-mail vira profile 'pending' e cai no PendingAccessPage,
-- que manda "falar com o administrador". O admin NÃO TEM COMO ATENDER: private.can_see_profile()
-- é FALSA para um pendente (os 4 casos exigem ser o próprio, um paciente acessível, ou alguém
-- que JÁ tenha linha em professionals), então o pendente é INVISÍVEL até para um SELECT do admin.
-- promote_to_professional existe e funciona, mas exige p_profile_id — que o admin não descobre.
--
-- DESENHO — INVERSÃO DE DIREÇÃO. Quem pede para entrar é o profissional, apresentando um código
-- da clínica. A solicitação NASCE com clinic_id, então a leitura pelo admin é RLS trivial
-- (is_clinic_admin(clinic_id)). Sem RPC de descoberta global ⇒ sem vazamento de nome/e-mail entre
-- clínicas e sem oráculo de enumeração ("este e-mail existe no VERTEXA?").
--
-- SNAPSHOT DE IDENTIDADE (applicant_name/email/clinic_name): NÃO é conveniência. Um join do
-- frontend para public.profiles voltaria VAZIO, porque can_see_profile() continua falsa para o
-- pendente. Denormalizar é a única saída que não exige (a) mexer no helper can_see_profile —
-- load-bearing em todo o modelo de RLS — nem (b) empurrar a leitura para dentro de outra RPC.
-- Semanticamente honesto: é o que a pessoa declarou NO MOMENTO em que pediu. É transitório: assim
-- que vira professional, can_see_profile() caso 3 passa a valer e o dado normalizado volta.
-- clinic_name é snapshot pelo mesmo motivo, na outra direção: o pendente não é membro, logo
-- clinics_select (is_clinic_member) o impede de ler o nome da clínica para a qual pediu acesso.
--
-- NÃO TOCA: handle_new_user (trigger de auth), promote_to_professional, can_see_profile,
-- is_clinic_admin, nem nenhuma policy existente. Só ADITIVO.
--
-- FORA DE ESCOPO (deliberado, outro WP): convite por e-mail, tabela de tokens, aceite/expiração,
-- remoção de membro e troca de clinic_role pós-promoção.
--
-- ROLLBACK:
--   drop function if exists public.rotate_clinic_join_code(uuid);
--   drop function if exists public.decide_join_request(uuid, boolean, public.professional_type, text, text, text);
--   drop function if exists public.request_clinic_access(text);
--   drop table if exists public.clinic_join_requests;
--   alter table public.clinics alter column join_code drop not null;
--   alter table public.clinics alter column join_code drop default;
--   drop index if exists public.clinics_join_code_key;
--   alter table public.clinics drop column if exists join_code;
--   drop function if exists private.gen_join_code();
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) Gerador do código de acesso
-- Alfabeto de 32 caracteres SEM ambíguos (sem O/0 e sem I/1): o código é ditado por telefone e
-- colado no WhatsApp. 32^8 ≈ 1,1e12 combinações; o índice único abaixo é a garantia real.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.gen_join_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 8);
$$;

revoke all on function private.gen_join_code() from public, anon;
-- NÃO concedido a `authenticated`: os únicos caminhos que geram código são o DEFAULT da coluna
-- (disparado dentro de create_clinic_with_owner, SECURITY DEFINER, que roda como owner) e a RPC
-- de rotação (também SECURITY DEFINER). authenticated não insere em clinics (não há policy).

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) Coluna join_code em clinics
-- ORDEM IMPORTA: coluna anulável → índice único → backfill com retry → default → not null.
-- Criar o índice ANTES do backfill é o que torna o retry por unique_violation REAL; se o índice
-- viesse depois, o bloco de retry seria código morto (nada poderia colidir).
--
-- ⚠️ O DEFAULT NÃO É OPCIONAL. Verificado contra o banco: public.create_clinic_with_owner faz
-- `insert into public.clinics (name, owner_profile_id)` — não informa join_code. Sem DEFAULT, o
-- NOT NULL abaixo QUEBRARIA a criação de clínica, que hoje é o único caminho de onboarding que
-- funciona. Default na coluna em vez de alterar a RPC: não mexe em função já deployada e testada.
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.clinics add column if not exists join_code text;

create unique index if not exists clinics_join_code_key on public.clinics (join_code);

do $$
declare
  r record;
begin
  for r in select id from public.clinics where join_code is null loop
    loop
      begin
        update public.clinics set join_code = private.gen_join_code() where id = r.id;
        exit;                                  -- gravou sem colidir
      exception when unique_violation then
        null;                                  -- sorteia outro
      end;
    end loop;
  end loop;
end $$;

alter table public.clinics alter column join_code set default private.gen_join_code();
alter table public.clinics alter column join_code set not null;

comment on column public.clinics.join_code is
  'Código de acesso da clínica (8 caracteres, alfabeto sem ambíguos). O profissional o apresenta '
  'em public.request_clinic_access para pedir entrada. Rotacionável pelo admin via '
  'public.rotate_clinic_join_code. NÃO é segredo forte: toda solicitação exige aprovação explícita.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) Tabela de solicitações
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.clinic_join_requests (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  clinic_id       uuid not null references public.clinics(id)  on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- SNAPSHOT (ver cabeçalho): sem isto nem o admin vê quem pediu, nem o solicitante vê para onde.
  applicant_name  text,
  applicant_email text,
  clinic_name     text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id)
);

comment on table public.clinic_join_requests is
  'Pedidos de entrada de profissional numa clínica (WP-TEAM-JOIN). Escrita SOMENTE pelas RPCs '
  'SECURITY DEFINER request_clinic_access / decide_join_request. Nome e e-mail são SNAPSHOT: '
  'can_see_profile() é falsa para um profile pendente, então um join normal voltaria vazio.';

-- No máximo UMA solicitação aberta por (pessoa, clínica) — sustenta a idempotência da RPC.
create unique index if not exists clinic_join_requests_one_open
  on public.clinic_join_requests (profile_id, clinic_id)
  where status = 'pending';

-- Listagem do admin (fila da clínica).
create index if not exists clinic_join_requests_clinic_pending
  on public.clinic_join_requests (clinic_id)
  where status = 'pending';

alter table public.clinic_join_requests enable row level security;

-- LEITURA: o admin da clínica-alvo, ou o próprio solicitante. Mais ninguém.
drop policy if exists clinic_join_requests_select on public.clinic_join_requests;
create policy clinic_join_requests_select
  on public.clinic_join_requests for select to authenticated
  using (
    private.is_clinic_admin(clinic_id)
    or profile_id = private.current_profile_id()
  );

-- ESCRITA: exclusivamente pelas RPCs. Sem policy de INSERT/UPDATE/DELETE ⇒ negado pela RLS;
-- o revoke é a segunda tranca (defesa em profundidade), e o grant devolve só o SELECT.
revoke all on public.clinic_join_requests from anon, authenticated;
grant select on public.clinic_join_requests to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) RPC — o profissional pendente solicita acesso
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.request_clinic_access(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_profile_id();
  v_clinic uuid;
  v_cname  text;
  v_status text;
  v_name   text;
  v_email  text;
  v_id     uuid;
  v_open   int;
begin
  if v_caller is null then
    raise exception 'request_clinic_access: not authenticated' using errcode = '42501';
  end if;

  -- SECURITY DEFINER de propósito: o pendente NÃO é membro, logo clinics_select
  -- (private.is_clinic_member) o impediria de resolver o código para uma clínica.
  select c.id, c.name into v_clinic, v_cname
    from public.clinics c
   where c.join_code = upper(btrim(coalesce(p_join_code, '')));
  if v_clinic is null then
    raise exception 'request_clinic_access: clinic not found for join code' using errcode = 'P0002';
  end if;

  select p.status, p.full_name, p.email into v_status, v_name, v_email
    from public.profiles p where p.id = v_caller;
  if v_status is distinct from 'pending' then
    raise exception 'request_clinic_access: caller is not pending (status=%)', v_status
      using errcode = '22023';
  end if;

  -- Idempotente: reapresentar o mesmo código devolve a solicitação aberta que já existe.
  select r.id into v_id
    from public.clinic_join_requests r
   where r.profile_id = v_caller and r.clinic_id = v_clinic and r.status = 'pending';
  if v_id is not null then
    return v_id;
  end if;

  -- Teto anti-spam: no máximo 3 solicitações abertas simultâneas por pessoa.
  select count(*) into v_open
    from public.clinic_join_requests r
   where r.profile_id = v_caller and r.status = 'pending';
  if v_open >= 3 then
    raise exception 'request_clinic_access: too many open requests' using errcode = '22023';
  end if;

  insert into public.clinic_join_requests
    (profile_id, clinic_id, applicant_name, applicant_email, clinic_name)
  values (v_caller, v_clinic, v_name, v_email, v_cname)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all     on function public.request_clinic_access(text) from public, anon;
grant  execute on function public.request_clinic_access(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) RPC — o admin decide a solicitação
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.decide_join_request(
  p_request_id      uuid,
  p_approve         boolean,
  p_type            public.professional_type default null,
  p_clinic_role     text default 'member',
  p_registry_number text default null,
  p_specialty       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_profile_id();
  v_req    public.clinic_join_requests;
  v_prof   uuid;
begin
  if v_caller is null then
    raise exception 'decide_join_request: not authenticated' using errcode = '42501';
  end if;

  select * into v_req from public.clinic_join_requests r where r.id = p_request_id;
  if not found then
    raise exception 'decide_join_request: request not found' using errcode = 'P0002';
  end if;

  if not private.is_clinic_admin(v_req.clinic_id) then
    raise exception 'decide_join_request: caller is not admin of clinic %', v_req.clinic_id
      using errcode = '42501';
  end if;

  if v_req.status is distinct from 'pending' then
    raise exception 'decide_join_request: request already decided (status=%)', v_req.status
      using errcode = '22023';
  end if;

  if p_approve then
    if p_type is null then
      raise exception 'decide_join_request: p_type is required to approve' using errcode = '22023';
    end if;
    -- SECURITY DEFINER troca o ROLE, NÃO o auth.uid() (que vem do JWT). Logo o
    -- private.current_profile_id() DENTRO de promote_to_professional ainda resolve o MESMO admin,
    -- e o gate is_clinic_admin de lá revalida a autorização. É defesa em profundidade proposital,
    -- não redundância a remover: a autoridade continua sendo derivada do servidor.
    v_prof := public.promote_to_professional(
                v_req.profile_id, v_req.clinic_id, p_type,
                p_clinic_role, p_registry_number, p_specialty);
  end if;

  update public.clinic_join_requests
     set status     = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(),
         decided_by = v_caller
   where id = p_request_id;

  return v_prof;   -- null quando rejeitado
end;
$$;

revoke all on function public.decide_join_request(uuid, boolean, public.professional_type, text, text, text)
  from public, anon;
grant execute on function public.decide_join_request(uuid, boolean, public.professional_type, text, text, text)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) RPC — o admin rotaciona o código (código vazado ⇒ troca, sem migration)
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.rotate_clinic_join_code(p_clinic_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if private.current_profile_id() is null then
    raise exception 'rotate_clinic_join_code: not authenticated' using errcode = '42501';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'rotate_clinic_join_code: caller is not admin of clinic %', p_clinic_id
      using errcode = '42501';
  end if;
  loop
    begin
      update public.clinics set join_code = private.gen_join_code()
       where id = p_clinic_id
       returning join_code into v_code;
      exit;
    exception when unique_violation then
      null;                                    -- sorteia outro
    end;
  end loop;
  if v_code is null then
    raise exception 'rotate_clinic_join_code: clinic % not found', p_clinic_id using errcode = 'P0002';
  end if;
  return v_code;
end;
$$;

revoke all     on function public.rotate_clinic_join_code(uuid) from public, anon;
grant  execute on function public.rotate_clinic_join_code(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260803090000', '20260803090000_wp_team_join.sql',
  'WP-TEAM-JOIN: entrada de profissional por SOLICITACAO com codigo da clinica. clinics.join_code '
  '(unico, default private.gen_join_code, NOT NULL — default OBRIGATORIO porque '
  'create_clinic_with_owner nao informa a coluna) + tabela clinic_join_requests (RLS: le o admin da '
  'clinica-alvo ou o proprio solicitante; escrita so por RPC) + RPCs request_clinic_access, '
  'decide_join_request (delega a promote_to_professional, intocada) e rotate_clinic_join_code. '
  'Nome/e-mail/clinica sao SNAPSHOT porque can_see_profile e falsa para pendente. Inverte a direcao '
  'da descoberta: sem RPC de listagem global, sem vazamento entre clinicas, sem oraculo de e-mail. '
  'Trigger de auth e can_see_profile NAO tocados. Convite por e-mail = outro WP. ADITIVA.',
  'WP-TEAM-JOIN')
on conflict (version) do nothing;
