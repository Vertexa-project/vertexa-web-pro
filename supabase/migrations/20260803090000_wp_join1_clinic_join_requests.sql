-- =====================================================================================
-- WP-JOIN-1 — SOLICITAÇÃO DE ACESSO À CLÍNICA (o profissional pede; o admin aprova).
--
-- DIREÇÃO DO FLUXO É O PONTO CENTRAL. O admin NUNCA descobre um pendente. É o PROFISSIONAL
-- que pede acesso a UMA clínica específica, apresentando um código que a clínica compartilha
-- (WhatsApp, na vida real). O pedido JÁ NASCE vinculado ao clinic_id ⇒ a leitura pelo admin é
-- RLS trivial (is_clinic_admin(clinic_id)). Sem consulta global, sem oráculo de enumeração de
-- e-mail, sem RPC de descoberta.
--
-- POR QUE ISSO É NECESSÁRIO: private.can_see_profile() é FALSA para um profile 'pending' (seus 4
-- ramos exigem ser o próprio, um paciente acessível, ou alguém que JÁ tenha linha em
-- professionals). O pendente é invisível até para um SELECT do admin. promote_to_professional
-- existe e funciona, mas exige p_profile_id — que o admin não tem como descobrir.
--
-- join_code NÃO É SEGREDO. A segurança está na APROVAÇÃO EXPLÍCITA do admin, não no código.
-- Adivinhar um código gera ruído (um pedido pendente), nunca privilégio.
--
-- REUSO SEM ALTERAÇÃO: promote_to_professional(p_profile_id, p_clinic_id, p_type, p_clinic_role,
-- p_registry_number, p_specialty) é CHAMADA, não reescrita. handle_new_user, can_see_profile,
-- is_clinic_admin e TODAS as policies existentes ficam intocados. Migration puramente ADITIVA.
--
-- KILL SWITCH (desliga o fluxo sem afetar o resto do produto):
--   revoke execute on function public.request_clinic_access(text)     from authenticated;
--   revoke execute on function public.approve_join_request(uuid)      from authenticated;
--   revoke execute on function public.reject_join_request(uuid)       from authenticated;
--   revoke execute on function public.rotate_clinic_join_code(uuid)   from authenticated;
-- A tabela e a coluna permanecem; nada mais no produto depende delas.
--
-- ROLLBACK COMPLETO:
--   drop function if exists public.rotate_clinic_join_code(uuid);
--   drop function if exists public.reject_join_request(uuid);
--   drop function if exists public.approve_join_request(uuid);
--   drop function if exists public.request_clinic_access(text);
--   drop table if exists public.clinic_join_requests;
--   alter table public.clinics alter column join_code drop not null;
--   alter table public.clinics alter column join_code drop default;
--   drop index if exists public.clinics_join_code_key;
--   alter table public.clinics drop column if exists join_code;
--   drop function if exists private.new_join_code();
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) GERADOR DO CÓDIGO
-- Base32 sem ambíguos: retira O/0 e I/1, porque o código é DITADO por telefone e digitado à
-- mão. 32 símbolos ^ 8 posições ≈ 1,1e12; o índice único da secção 2 é a garantia real.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.new_join_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 8);
$$;

revoke all on function private.new_join_code() from public, anon;
-- NÃO concedida a `authenticated`: os únicos caminhos que a executam são o DEFAULT da coluna
-- (disparado dentro de create_clinic_with_owner, SECURITY DEFINER, que roda como owner) e a RPC
-- de rotação (também SECURITY DEFINER). `authenticated` não insere em clinics — não há policy.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) clinics.join_code
-- ORDEM DELIBERADA: coluna anulável → ÍNDICE ÚNICO → backfill com retry → DEFAULT → NOT NULL.
-- O índice ANTES do backfill é o que torna o retry por unique_violation real; ao contrário, o
-- bloco de exceção seria código morto porque nada poderia colidir ainda.
--
-- ⚠️ O DEFAULT NÃO É OPCIONAL — verificado lendo a função em produção:
--    public.create_clinic_with_owner faz `insert into public.clinics (name, owner_profile_id)`,
--    sem informar join_code. NOT NULL sem DEFAULT QUEBRARIA a criação de clínica, hoje o único
--    caminho de onboarding que funciona ponta a ponta. Default na coluna em vez de alterar a
--    RPC: não toca função já deployada e testada (o WP proíbe alterá-la).
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
        update public.clinics set join_code = private.new_join_code() where id = r.id;
        exit;                                   -- gravou sem colidir
      exception when unique_violation then
        null;                                   -- sorteia outro e tenta de novo
      end;
    end loop;
  end loop;
end $$;

alter table public.clinics alter column join_code set default private.new_join_code();
alter table public.clinics alter column join_code set not null;

comment on column public.clinics.join_code is
  'Código de acesso da clínica (8 caracteres, base32 sem O/0/I/1). O profissional o apresenta em '
  'public.request_clinic_access para PEDIR entrada. Rotacionável pelo admin via '
  'public.rotate_clinic_join_code. NÃO é segredo: a segurança é a aprovação explícita do admin.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) TABELA DE PEDIDOS
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.clinic_join_requests (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  clinic_id       uuid not null references public.clinics(id)  on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- IDENTIFICAÇÃO DENORMALIZADA do solicitante (WP-JOIN-1b). Ver bloco abaixo.
  requester_name  text,
  requester_email text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id)
);

-- Colunas idempotentes: se a tabela já existir de uma execução anterior, acrescenta sem falhar.
alter table public.clinic_join_requests add column if not exists requester_name  text;
alter table public.clinic_join_requests add column if not exists requester_email text;

comment on table public.clinic_join_requests is
  'Pedidos de entrada de profissional numa clínica (WP-JOIN-1). O pedido nasce vinculado ao '
  'clinic_id, então a leitura pelo admin é RLS trivial — sem consulta global. Escrita SOMENTE '
  'pelas RPCs SECURITY DEFINER; nunca INSERT/UPDATE direto do client.';

-- ── IDENTIFICAÇÃO DENORMALIZADA (WP-JOIN-1b) ─────────────────────────────────────────
-- POR QUE NÃO UM JOIN: private.can_see_profile() é FALSA para um profile 'pending' (os 4 ramos
-- exigem ser o próprio, um paciente acessível, ou alguém que JÁ tenha linha em professionals).
-- Um join de clinic_join_requests para public.profiles voltaria VAZIO exatamente no caso que
-- importa — a fila do admin. As alternativas eram abrir uma exceção em can_see_profile (helper
-- load-bearing de toda a RLS) ou empurrar a leitura para dentro de outra RPC. Ambas piores.
--
-- POR QUE É LEGÍTIMO, e não só conveniente: o que o admin vê é o que o profissional ESCOLHEU
-- APRESENTAR ao pedir acesso ÀQUELA clínica. O consentimento está embutido no ato do pedido —
-- não é a clínica bisbilhotando um cadastro alheio. É um SNAPSHOT do momento da solicitação.
--
-- PREENCHIDO NO SERVIDOR: request_clinic_access é SECURITY DEFINER e lê o profile do PRÓPRIO
-- chamador (private.current_profile_id()). O client NUNCA envia nome/e-mail — não é forjável.
--
-- SEM SUPERFÍCIE NOVA: os campos vivem na MESMA linha, sob a MESMA policy
-- clinic_join_requests_select. Quem não podia ler a linha continua não podendo ler nada dela.
comment on column public.clinic_join_requests.requester_name is
  'SNAPSHOT do profiles.full_name do solicitante no momento do pedido. Preenchido pelo servidor '
  'em request_clinic_access (SECURITY DEFINER); nunca pelo client. Existe porque can_see_profile() '
  'é falsa para um pendente e um join a profiles voltaria vazio para o admin.';
comment on column public.clinic_join_requests.requester_email is
  'SNAPSHOT do profiles.email do solicitante no momento do pedido. Mesma justificativa e mesma '
  'policy de leitura de requester_name — nenhuma superfície nova.';

-- Impede DOIS pedidos 'pending' do mesmo profile para a MESMA clínica (sustenta a idempotência).
-- Parcial de propósito: depois de decidido, a pessoa pode pedir de novo à mesma clínica.
create unique index if not exists clinic_join_requests_one_pending
  on public.clinic_join_requests (profile_id, clinic_id)
  where status = 'pending';

-- Fila do admin.
create index if not exists clinic_join_requests_clinic_status
  on public.clinic_join_requests (clinic_id, status);

-- Predicado da RLS do lado do solicitante (`profile_id = current_profile_id()`) e cobertura da FK.
-- O índice único acima é PARCIAL (só 'pending'), então não serve de cobertura para a FK.
create index if not exists clinic_join_requests_profile
  on public.clinic_join_requests (profile_id);

alter table public.clinic_join_requests enable row level security;

-- SELECT: o próprio solicitante vê os SEUS pedidos; o admin vê os da SUA clínica. NADA global.
drop policy if exists clinic_join_requests_select on public.clinic_join_requests;
create policy clinic_join_requests_select
  on public.clinic_join_requests for select to authenticated
  using (
    profile_id = private.current_profile_id()
    or private.is_clinic_admin(clinic_id)
  );

-- ESCRITA: sem policy de INSERT/UPDATE/DELETE ⇒ negada pela RLS. O revoke é a segunda tranca
-- (defesa em profundidade) e o grant devolve exclusivamente o SELECT, que a policy então filtra.
revoke all    on public.clinic_join_requests from anon, authenticated;
grant  select on public.clinic_join_requests to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) RPC — o profissional pendente SOLICITA acesso
--
-- ERRO GENÉRICO POR DESENHO: código inexistente devolve a MESMA mensagem neutra
-- ('invalid join code'), sem dizer se aquela clínica existe. Evita sondagem de códigos como
-- oráculo de existência de clínica.
--
-- REGRA DO CHAMADOR (decisão reportada): só um profile status='pending' pode solicitar. Quem já
-- é professional (status='active') recebe erro — pertencer a DUAS clínicas não está no escopo
-- deste WP e exigiria repensar a resolução de identidade (useIdentity assume uma clínica).
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.request_clinic_access(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_profile_id();   -- AUTOR DO SERVIDOR; jamais parâmetro do client
  v_clinic uuid;
  v_status text;
  v_name   text;
  v_email  text;
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'request_clinic_access: not authenticated' using errcode = '42501';
  end if;

  -- SECURITY DEFINER de propósito: o pendente NÃO é membro, então clinics_select
  -- (private.is_clinic_member) o impediria de resolver o código para uma clínica.
  select c.id into v_clinic
    from public.clinics c
   where c.join_code = upper(btrim(coalesce(p_join_code, '')));

  if v_clinic is null then
    -- Mensagem NEUTRA: não revela se a clínica existe.
    raise exception 'request_clinic_access: invalid join code' using errcode = 'P0002';
  end if;

  -- Lê o profile DO PRÓPRIO CHAMADOR (v_caller vem do servidor). O nome e o e-mail gravados são,
  -- portanto, os da pessoa que está pedindo — o client não tem como informar outros.
  select p.status, p.full_name, p.email
    into v_status, v_name, v_email
    from public.profiles p where p.id = v_caller;
  if v_status is distinct from 'pending' then
    raise exception 'request_clinic_access: caller is not pending' using errcode = '22023';
  end if;

  -- IDEMPOTENTE: reapresentar o mesmo código devolve o pedido aberto que já existe.
  select r.id into v_id
    from public.clinic_join_requests r
   where r.profile_id = v_caller and r.clinic_id = v_clinic and r.status = 'pending';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.clinic_join_requests
    (profile_id, clinic_id, requester_name, requester_email)
  values (v_caller, v_clinic, v_name, v_email)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all     on function public.request_clinic_access(text) from public, anon;
grant  execute on function public.request_clinic_access(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) RPC — o admin APROVA
--
-- p_type: a assinatura pedida pelo WP tem UM parâmetro, mas promote_to_professional EXIGE
-- p_type (levanta 22023 se nulo). Adotado 'other' — o MESMO tipo com que
-- create_clinic_with_owner cria o dono da clínica. Coerente com o modelo: `type` é grosso e a
-- capacidade real vem das DISCIPLINAS (WP-DISC), atribuídas depois em /configuracoes/disciplinas.
-- O admin pode ajustar professionals.type depois — a policy professionals_admin_write já concede
-- UPDATE de (type, registry_number, specialty, clinic_role) ao admin da clínica.
--
-- TRANSACIONAL: função plpgsql sem COMMIT interno ⇒ promoção + marcação do pedido são
-- tudo-ou-nada por construção. Se promote_to_professional levantar, nada é gravado.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.approve_join_request(p_request_id uuid)
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
    raise exception 'approve_join_request: not authenticated' using errcode = '42501';
  end if;

  select * into v_req from public.clinic_join_requests r where r.id = p_request_id;
  if not found then
    raise exception 'approve_join_request: request not found' using errcode = 'P0002';
  end if;

  -- Um só portão bloqueia (a) não-admin e (b) admin de OUTRA clínica.
  if not private.is_clinic_admin(v_req.clinic_id) then
    raise exception 'approve_join_request: caller is not admin of clinic %', v_req.clinic_id
      using errcode = '42501';
  end if;

  if v_req.status is distinct from 'pending' then
    raise exception 'approve_join_request: request already decided (status=%)', v_req.status
      using errcode = '22023';
  end if;

  -- REUSO, não reescrita. SECURITY DEFINER troca o ROLE, NÃO o auth.uid() (que vem do JWT):
  -- o private.current_profile_id() DENTRO de promote_to_professional resolve o MESMO admin e o
  -- gate is_clinic_admin de lá revalida. Defesa em profundidade proposital.
  v_prof := public.promote_to_professional(v_req.profile_id, v_req.clinic_id, 'other');

  update public.clinic_join_requests
     set status = 'approved', decided_at = now(), decided_by = v_caller
   where id = p_request_id;

  return v_prof;
end;
$$;

revoke all     on function public.approve_join_request(uuid) from public, anon;
grant  execute on function public.approve_join_request(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) RPC — o admin REJEITA (o profissional segue 'pending'; nada é criado)
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reject_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_profile_id();
  v_req    public.clinic_join_requests;
begin
  if v_caller is null then
    raise exception 'reject_join_request: not authenticated' using errcode = '42501';
  end if;

  select * into v_req from public.clinic_join_requests r where r.id = p_request_id;
  if not found then
    raise exception 'reject_join_request: request not found' using errcode = 'P0002';
  end if;

  if not private.is_clinic_admin(v_req.clinic_id) then
    raise exception 'reject_join_request: caller is not admin of clinic %', v_req.clinic_id
      using errcode = '42501';
  end if;

  if v_req.status is distinct from 'pending' then
    raise exception 'reject_join_request: request already decided (status=%)', v_req.status
      using errcode = '22023';
  end if;

  update public.clinic_join_requests
     set status = 'rejected', decided_at = now(), decided_by = v_caller
   where id = p_request_id;
end;
$$;

revoke all     on function public.reject_join_request(uuid) from public, anon;
grant  execute on function public.reject_join_request(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7) RPC — o admin ROTACIONA o código (código vazado ⇒ troca, sem migration)
-- DESVIO MICRO REPORTADO: o WP escreveu `rotate_clinic_join_code()`. Recebe p_clinic_id porque
-- um profile PODE administrar mais de uma clínica (is_clinic_admin é por clínica), e sem o
-- parâmetro a função seria ambígua. O gate continua sendo is_clinic_admin(p_clinic_id).
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
      update public.clinics set join_code = private.new_join_code()
       where id = p_clinic_id
       returning join_code into v_code;
      exit;
    exception when unique_violation then
      null;                                     -- sorteia outro
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
-- 8) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260803090000', '20260803090000_wp_join1_clinic_join_requests.sql',
  'WP-JOIN-1: solicitacao de acesso a clinica com INVERSAO DE DIRECAO — o profissional pede, o '
  'admin aprova. clinics.join_code (base32 sem ambiguos, unico, NOT NULL com DEFAULT — default '
  'OBRIGATORIO porque create_clinic_with_owner nao informa a coluna) + backfill. Tabela '
  'clinic_join_requests (RLS: le o proprio solicitante OU o admin da clinica; escrita so por RPC) '
  'com requester_name/requester_email DENORMALIZADOS (WP-JOIN-1b) preenchidos pelo SERVIDOR dentro '
  'de request_clinic_access — can_see_profile e falsa para pendente, entao um join a profiles '
  'voltaria vazio para o admin; os campos vivem sob a MESMA policy, sem superficie nova. '
  'RPCs request_clinic_access (idempotente, erro NEUTRO para codigo inexistente), '
  'approve_join_request (CHAMA promote_to_professional, intocada), reject_join_request e '
  'rotate_clinic_join_code. Nenhuma policy existente alterada; handle_new_user, can_see_profile e '
  'identidade NAO tocados. ADITIVA. Convite por e-mail = WP futuro (pre-cria pedido ja aprovado).',
  'WP-JOIN-1')
on conflict (version) do nothing;
