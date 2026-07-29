-- =====================================================================================
-- WP-METRIC-1a — O QUE CONTA COMO ADESÃO PASSA A SER DADO, NÃO AUSÊNCIA DE FILTRO
--
-- A TESE, EM UMA FRASE: "que tipo de evento conta para o VRI" deixa de ser uma decisão
-- implícita — a AUSÊNCIA de um predicado em duas consultas — e vira linha de tabela,
-- legível, versionada e sustentada por chave estrangeira.
--
-- O QUE ISTO FECHA (diagnóstico WP-METRIC-1, retorno-metric-1-diag.txt):
--   `private.event_streak_brt` contava dias com QUALQUER activity_event, e
--   `public.recompute_adherence` derivava a recência de um `max(created_at)` também sem
--   filtro. Consequência observável: um `help_requested` — um PEDIDO DE SOCORRO —
--   sustentava a sequência de dias, dava o bônus de "plano acompanhado", apagava o fator
--   de risco "N dias sem interação" e tirava a paciente do status `inativo`. Somando,
--   25 dos 75 pontos de sinal do VRI (33%) eram acionáveis por QUALQUER tipo de evento.
--
-- A DISTINÇÃO QUE ENTRA — DUAS GRANDEZAS, NÃO UMA:
--   counts_as_interaction = "deu sinal de vida"  → recência, saída de `inativo` e o fator
--                                                  de risco de sumiço
--   counts_as_adherence   = "cuidou de si"       → sequência de dias e o bônus de plano
--                                                  acompanhado
--   Pedir ajuda É interação e NÃO É adesão. `help_requested` é a única linha do catálogo
--   em que as duas colunas divergem — e é exatamente o caso que motivou este WP.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ (fronteiras explícitas do WP):
--   · NÃO toca `private.brt_date` nem o fuso. DÍVIDA-TZ-1 continua aberta, agora nomeada
--     em docs/PENDENCIAS.md. É outra decisão e atravessa 6 funções.
--   · NÃO toca o job de decaimento, `private.recompute_recovery_decay` nem
--     `muscle_recovery_states`. DÍVIDA-RLS2-1 idem.
--   · NÃO toca `public.recompute_achievements`. Ela herda a correção de graça, porque
--     `streak_7/14/30` saem de `event_streak_brt`. Nenhuma linha dela muda.
--   · NÃO toca o trigger de recuperação (já filtra tipo+ação no WHEN, corretamente).
--   · NÃO toca `public.export_patient_report` (a timeline deve mostrar tudo mesmo).
--   · NÃO toca os espelhos client-side (adherenceEngine.ts, constancy.ts) — é o
--     WP-METRIC-1b. Até lá, app e servidor divergem para quem tiver `help_requested`.
--     Registrado em docs/PENDENCIAS.md como DÍVIDA-METRIC-1b.
--   · NÃO cria helper novo em `private` (os 48 seguem 48; o único que muda de TEXTO é
--     event_streak_brt).
--   · NÃO altera as 3 tabelas de métrica derivada nem o lockdown delas.
--
-- ⚠️ NOTA DE FIDELIDADE — LEIA ANTES DE COMPARAR COM A 20260722090000:
--   Os corpos de `event_streak_brt` e `recompute_adherence` abaixo partem do TEXTO VIVO EM
--   PRODUÇÃO (`pg_get_functiondef`), não do texto do arquivo 20260722090000. Para
--   `recompute_adherence` os dois DIVERGEM em quebras de linha desde o apply original —
--   drift COSMÉTICO, sem diferença semântica, reportado no PR. Partir do texto vivo é o que
--   garante que o delta desta migration seja EXATAMENTE a mudança de regra, e nada mais.
--   (`event_streak_brt` não tem drift: arquivo e produção eram idênticos.)
--
-- ROLLBACK COMPLETO:
--   -- 1) devolver as duas funções ao corpo pré-WP (texto vivo de 20260722090000);
--   --    o corpo exato está no retorno-metric-1-diag.txt, blocos D3.1 e D3.2.
--   alter table public.activity_events drop constraint if exists activity_events_type_fkey;
--   drop policy if exists activity_event_types_catalog_read on public.activity_event_types;
--   drop table if exists public.activity_event_types;
--   -- 2) os snapshots acrescentados pelo backfill (secao 5) NAO sao removidos pelo rollback:
--   --    a tabela e append-only por desenho. Para desfazer, apagar por calculated_at.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) CATÁLOGO — public.activity_event_types
--
-- Chave = o próprio `type` (text), não um id gerado: o valor JÁ é a chave estável usada
-- pelo app, pelo web e pelas funções. Mesmo padrão de `public.achievements` (code text PK).
--
-- As duas colunas são NOT NULL SEM DEFAULT DE PROPÓSITO: um tipo novo obriga quem o
-- cadastra a declarar as duas semânticas. Default silencioso é como o problema nasceu.
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.activity_event_types (
  type                  text primary key,
  counts_as_adherence   boolean not null,
  counts_as_interaction boolean not null,
  note                  text
);

comment on table public.activity_event_types is
  'WP-METRIC-1a: catalogo dos tipos aceitos em activity_events.type (FK). Duas semanticas '
  'independentes: counts_as_adherence (cuidou de si -> sequencia e bonus de plano) e '
  'counts_as_interaction (deu sinal de vida -> recencia, saida de inativo, fator de sumico). '
  'Escrita so por migration/service_role.';

comment on column public.activity_event_types.counts_as_adherence is
  'Conta como ADESAO: alimenta private.event_streak_brt e o bonus de plano acompanhado.';

comment on column public.activity_event_types.counts_as_interaction is
  'Conta como INTERACAO: alimenta a recencia do VRI, a saida do status inativo e o fator de '
  'risco "N dias sem interacao".';

-- Seed = os 10 tipos da allow-list RELEVANT_EVENT_TYPES do eventSync do app paciente
-- (vertexa-app-paciente/src/lib/eventSync.ts:17-28). É a lista do que de fato pode chegar
-- na tabela hoje: o app é o ÚNICO escritor de activity_events (web e native só leem).
insert into public.activity_event_types (type, counts_as_adherence, counts_as_interaction, note) values
  ('workout_checked',         true,  true,  'Treino marcado no app.'),
  ('meal_logged',             true,  true,  'Refeicao do plano marcada.'),
  ('supplement_checked',      true,  true,  'Suplemento marcado.'),
  ('hydration_logged',        true,  true,  'Hidratacao registrada.'),
  ('activity_logged',         true,  true,  'Atividade complementar registrada.'),
  ('weight_logged',           true,  true,  'Marcador de peso (o valor canonico vive em weight_logs).'),
  ('progress_photo_uploaded', true,  true,  'Marcador de foto (o arquivo vive em progress_photos/storage).'),
  ('sleep_logged',            true,  true,  'Sono registrado.'),
  ('mood_logged',             true,  true,  'Humor registrado.'),
  ('help_requested',          false, true,
     'PEDIDO DE AJUDA (tela SOS). E INTERACAO: a paciente deu sinal de vida, entao nao pode '
     'ser tratada como sumida nem cair em inativo por causa disso. NAO E ADESAO: socorro nao '
     'e autocuidado — nao sustenta sequencia de dias e nao rende o bonus de plano '
     'acompanhado. Unica linha do catalogo em que as duas colunas divergem.')
on conflict (type) do nothing;

-- RLS — MESMO padrão de achievements_catalog_read (WP-05B Fam7): é catálogo de produto,
-- não dado clínico. SELECT para authenticated com qual=true; NENHUMA policy de
-- INSERT/UPDATE/DELETE (deny por ausência). Só migration e service_role escrevem.
alter table public.activity_event_types enable row level security;

drop policy if exists activity_event_types_catalog_read on public.activity_event_types;
create policy activity_event_types_catalog_read on public.activity_event_types
  for select to authenticated using ( true );

-- O grant nasce permissivo por default privilege do Supabase (a,r,d,D,x,t,m p/ anon e
-- authenticated). Este revoke o reduz a `rDxtm` — exatamente o ACL de public.achievements.
-- anon MANTÉM o privilégio de tabela e é barrado pela RLS (a policy é `to authenticated`),
-- que é como o catálogo de conquistas já se comporta hoje.
revoke insert, update, delete on public.activity_event_types from authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) CHAVE ESTRANGEIRA — activity_events.type → activity_event_types.type
--
-- É isto que impede a volta do problema pela porta dos fundos: um tipo novo não pode mais
-- entrar em activity_events sem passar pela decisão explícita de adesão/interação.
--
-- O guarda abaixo existe para a mensagem, não para a garantia: sem ele a FK falharia com
-- "violates foreign key constraint", sem dizer QUAL tipo sobrou. Com ele, a migration para
-- e nomeia os tipos órfãos. Regra do WP: se sobrar tipo, NÃO se semeia tipo novo para a FK
-- caber — para-se e reporta-se.
--
-- Sem ON DELETE/ON UPDATE: o catálogo é estático e escrito só por migration. Apagar um tipo
-- que tem eventos deve falhar (NO ACTION), não cascatear apagando histórico clínico.
-- ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare v_orfaos text;
begin
  select string_agg(distinct e.type, ', ' order by e.type) into v_orfaos
    from public.activity_events e
    left join public.activity_event_types t on t.type = e.type
   where t.type is null;
  if v_orfaos is not null then
    raise exception
      'WP-METRIC-1a: activity_events contem tipos fora do catalogo: [%]. NAO semeie tipo novo '
      'para a FK caber — pare e decida a semantica (adesao/interacao) de cada um.', v_orfaos
      using errcode = '23503';
  end if;
end $$;

alter table public.activity_events
  add constraint activity_events_type_fkey
  foreign key (type) references public.activity_event_types (type);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) private.event_streak_brt — SÓ O FILTRO MUDA
--
-- Assinatura, retorno, volatilidade, search_path, janela de 500, bucketização BRT, regra de
-- "hoje ou ontem" e a recursão: TUDO idêntico. A única alteração é o predicado adicionado
-- no WHERE da subquery interna (mais a quebra de linha que ele força no `order by`).
--
-- O filtro entra DENTRO do limit 500 de propósito: assim a janela passa a ser "os 500
-- eventos de ADESÃO mais recentes". Se ficasse fora, 500 pedidos de socorro empurrariam os
-- eventos reais para fora da janela e zerariam a sequência de quem se cuida.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.event_streak_brt(p_patient uuid)
returns int language sql stable set search_path = '' as $$
  with recursive ev_days as (
    select distinct private.brt_date(created_at) as d
    from (
      select created_at from public.activity_events
      where patient_id = p_patient
        and type in (select t.type from public.activity_event_types t where t.counts_as_adherence)
      order by created_at desc limit 500
    ) s
  ),
  start_day as (
    select case
      when exists (select 1 from ev_days where d = private.brt_date(now()))     then private.brt_date(now())
      when exists (select 1 from ev_days where d = private.brt_date(now()) - 1) then private.brt_date(now()) - 1
      else null::date
    end as sd
  ),
  rec as (
    select sd as d, 1 as n from start_day where sd is not null
    union all
    select r.d - 1, r.n + 1 from rec r where exists (select 1 from ev_days where d = r.d - 1)
  )
  select coalesce(max(n), 0)::int from rec
$$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) public.recompute_adherence — O `max(created_at)` VIRA DUAS GRANDEZAS
--
-- MUDA (e só isto):
--   a) +2 declares: v_most_recent_adherence, v_days_without_adherence.
--   b) o CTE `ev` ganha LEFT JOIN no catálogo e duas colunas booleanas derivadas.
--   c) o `max(created_at)` vira DOIS: `filter (where is_interaction)` e
--      `filter (where is_adherence)`.
--   d) v_plan_viewed passa a olhar a ADESÃO (era interação).
--
-- NÃO MUDA (byte a byte igual ao corpo vivo):
--   · v_habits_today, v_workouts_week, v_activity_week — já filtravam tipo corretamente.
--   · v_recency, v_status ('inativo'), o risk_factor "N dias sem interação" — seguem na
--     INTERAÇÃO, que é a semântica certa deles: são sinais de sumiço, e quem pede socorro
--     não sumiu.
--   · a fórmula do score, os tiers, o soft-cap, o js_round, o skip-if-unchanged, o insert.
--
-- POR QUE LEFT JOIN, e não INNER: a FK do item 2 garante que todo evento casa, então o
-- LEFT é redundante para o dado válido — e é justamente por isso que ele é o correto: com
-- INNER, um tipo órfão (só possível se a FK for removida no futuro) sumiria também dos três
-- agregados que este WP NÃO deve tocar, mudando o comportamento deles pelas costas. Com
-- LEFT + coalesce(false), o conjunto de linhas de `ev` é EXATAMENTE o de antes e o tipo
-- desconhecido apenas não conta para nenhuma das duas grandezas novas (fail-closed).
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.recompute_adherence()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid := private.current_patient_id();
  v_today date := private.brt_date(now());
  v_most_recent timestamptz;
  v_most_recent_adherence timestamptz;
  v_days_without int;
  v_days_without_adherence int;
  v_habits_today int := 0;
  v_workouts_week int := 0;
  v_activity_week int := 0;
  v_last_weight timestamptz;
  v_last_photo timestamptz;
  v_weight_recent boolean;
  v_photo_recent boolean;
  v_plan_viewed boolean;
  v_streak int;
  v_meal_total int := 0; v_meal_done int := 0; v_meal_ratio double precision := 0;
  v_supp_total int := 0; v_supp_taken int := 0; v_supp_ratio double precision := 0;
  v_engagement int := 0;
  v_recency int;
  v_signal double precision;
  v_normalized double precision;
  v_score int;
  v_level text;
  v_status public.patient_status;
  v_weekly int;
  v_risk text[] := array[]::text[];
  v_pos  text[] := array[]::text[];
  v_last_score int; v_last_level text;
begin
  if v_patient is null then
    raise exception 'recompute_adherence: not a patient / not authenticated' using errcode = '42501';
  end if;

  with ev as (
    select e.type, e.created_at, private.brt_date(e.created_at) as d, private.days_ago_brt(e.created_at, now()) as ago,
           coalesce(t.counts_as_interaction, false) as is_interaction,
           coalesce(t.counts_as_adherence,   false) as is_adherence
    from public.activity_events e
    left join public.activity_event_types t on t.type = e.type
    where e.patient_id = v_patient order by e.created_at desc limit 500
  )
  select max(created_at) filter (where is_interaction),
    max(created_at) filter (where is_adherence),
    count(*) filter (where type in ('hydration_logged','sleep_logged','mood_logged') and d = v_today),
    count(distinct d) filter (where type = 'workout_checked' and ago <= 6),
    count(distinct d) filter (where type = 'activity_logged' and ago <= 6)
  into v_most_recent, v_most_recent_adherence, v_habits_today, v_workouts_week, v_activity_week from ev;

  v_days_without := case when v_most_recent is null then 30 else private.days_ago_brt(v_most_recent, now()) end;
  v_days_without_adherence := case when v_most_recent_adherence is null then 30 else private.days_ago_brt(v_most_recent_adherence, now()) end;
  v_streak := private.event_streak_brt(v_patient);

  select max(measured_at) into v_last_weight from public.weight_logs where patient_id = v_patient;
  select max(taken_at)    into v_last_photo  from public.progress_photos where patient_id = v_patient;
  v_weight_recent := v_last_weight is not null and private.days_ago_brt(v_last_weight, now()) <= 7;
  v_photo_recent  := v_last_photo  is not null and private.days_ago_brt(v_last_photo,  now()) <= 30;
  v_plan_viewed   := v_days_without_adherence <= 3;

  with plan as (select id from public.nutrition_plans where patient_id = v_patient order by created_at desc limit 1),
  plan_meals as (select m.id from public.meals m where m.nutrition_plan_id = (select id from plan)),
  done as (select distinct meal_id from public.meal_logs where patient_id = v_patient and consumed_on = v_today)
  select count(pm.id), count(pm.id) filter (where d.meal_id is not null)
  into v_meal_total, v_meal_done from plan_meals pm left join done d on d.meal_id = pm.id;
  v_meal_ratio := case when v_meal_total > 0 then v_meal_done::double precision / v_meal_total else 0 end;

  with lst as (select id from public.supplements where patient_id = v_patient),
  taken as (select distinct supplement_id from public.supplement_intakes where patient_id = v_patient and taken_on = v_today)
  select count(l.id), count(l.id) filter (where t.supplement_id is not null)
  into v_supp_total, v_supp_taken from lst l left join taken t on t.supplement_id = l.id;
  v_supp_ratio := case when v_supp_total > 0 then v_supp_taken::double precision / v_supp_total else 0 end;

  v_engagement :=
      least(v_habits_today * 3, 12) + least(v_workouts_week * 4, 16)
    + (case when v_weight_recent then 5 else 0 end) + (case when v_photo_recent then 5 else 0 end)
    + (case when v_plan_viewed then 3 else 0 end)
    + (case when v_streak >= 30 then 10 when v_streak >= 14 then 7 when v_streak >= 7 then 4 else 0 end)
    + (case when v_meal_ratio > 0 then private.js_round(least(1, v_meal_ratio) * 6) else 0 end)
    + (case when v_activity_week > 0 then least(v_activity_week, 3) * 2 else 0 end)
    + (case when v_supp_ratio > 0 then private.js_round(least(1, v_supp_ratio) * 4) else 0 end);

  v_recency := case when v_days_without <= 1 then 12 when v_days_without <= 3 then 8
                    when v_days_without <= 6 then 4 when v_days_without <= 14 then 1 else 0 end;
  v_signal := v_recency + v_engagement;
  v_normalized := least(1, greatest(0, v_signal / 75.0));
  v_score := greatest(0, least(100, private.js_round(70 + 30 * power(v_normalized, 0.42))));
  v_level := case when v_score >= 80 then 'alta' when v_score >= 50 then 'moderada' when v_score >= 20 then 'baixa' else 'risco' end;
  v_status := (case when v_days_without >= 15 then 'inativo' when v_score < 20 then 'em_risco'
                    when v_score < 50 then 'atencao' else 'em_acompanhamento' end)::public.patient_status;
  v_weekly := private.js_round((v_workouts_week::double precision / 5) * 100);

  if v_days_without >= 3   then v_risk := array_append(v_risk, v_days_without || ' dias sem interação'); end if;
  if v_habits_today = 0    then v_risk := array_append(v_risk, 'Nenhum hábito registrado hoje'); end if;
  if v_workouts_week < 2   then v_risk := array_append(v_risk, 'Poucos treinos esta semana'); end if;
  if not v_weight_recent   then v_risk := array_append(v_risk, 'Peso não registrado recentemente'); end if;
  if not v_photo_recent    then v_risk := array_append(v_risk, 'Foto mensal pendente'); end if;

  if v_streak >= 7         then v_pos := array_append(v_pos, 'Sequência de ' || v_streak || ' dias'); end if;
  if v_habits_today >= 3   then v_pos := array_append(v_pos, 'Hábitos em dia'); end if;
  if v_workouts_week >= 3  then v_pos := array_append(v_pos, 'Treinos consistentes'); end if;
  if v_weight_recent       then v_pos := array_append(v_pos, 'Peso atualizado'); end if;
  if v_plan_viewed         then v_pos := array_append(v_pos, 'Plano acompanhado'); end if;
  if v_meal_ratio >= 0.6   then v_pos := array_append(v_pos, 'Refeições do dia em dia'); end if;
  if v_activity_week >= 2  then v_pos := array_append(v_pos, 'Atividades complementares na semana'); end if;
  if v_supp_ratio >= 0.6   then v_pos := array_append(v_pos, 'Suplementos em dia'); end if;

  select score, level into v_last_score, v_last_level
  from public.adherence_snapshots where patient_id = v_patient order by calculated_at desc limit 1;
  if v_last_score is not distinct from v_score and v_last_level is not distinct from v_level then return; end if;

  insert into public.adherence_snapshots
    (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
  values (v_patient, v_score, v_level, v_status, v_streak, v_weekly, v_risk, v_pos);
end $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5) RECÁLCULO DO HISTÓRICO — os snapshots existentes sob a regra nova
--
-- Escopo: SÓ pacientes que JÁ TÊM snapshot. Quem nunca teve VRI calculado não ganha um
-- aqui — isso seria criar histórico, não recomputá-lo.
--
-- Semântica: `adherence_snapshots` é APPEND-ONLY por desenho (recompute_adherence nunca
-- faz UPDATE nem DELETE). Portanto "recomputar" = ACRESCENTAR uma linha nova quando o valor
-- muda, preservando a série. Se (score, level) não mudarem, nada é escrito — o MESMO
-- skip-if-unchanged da função. A leitura do produto sempre pega o `calculated_at` mais
-- recente, então a correção passa a valer imediatamente sem apagar o passado.
--
-- ⚠️ POR QUE ESTE BLOCO DUPLICA A FÓRMULA (e por que a duplicação é temporária e provada):
--   `public.recompute_adherence()` deriva o paciente de `private.current_patient_id()` — não
--   aceita parâmetro. Numa migration (rodando como postgres, sem JWT) ela levanta 42501.
--   As saídas seriam: (a) extrair `private.recompute_adherence_for(uuid)` e transformar a RPC
--   num invólucro — o desenho correto, MAS que cria um 49º helper em `private` e quebra a
--   prova de hash exigida por este WP ("os 48 mudam só por event_streak_brt"); ou
--   (b) impersonar cada paciente com `request.jwt.claims` dentro da migration — que só
--   funciona para quem tem `auth_user_id` (hoje 1 de 7 pacientes) e é errado por princípio:
--   migration não finge ser usuária.
--   Escolhi replicar o cálculo AQUI, em bloco de execução única, e PROVAR a fidelidade em vez
--   de afirmá-la: no PR, logo após este backfill, a RPC real é chamada para a paciente
--   afetada e tem de ser NO-OP (0 linha nova). Se esta cópia tivesse divergido um único
--   ponto, o skip-if-unchanged falharia e a RPC inseriria uma linha diferente.
--   A extração do helper fica registrada como DÍVIDA-METRIC-1a em docs/PENDENCIAS.md.
-- ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_patient uuid;
  v_today date := private.brt_date(now());
  v_most_recent timestamptz;
  v_most_recent_adherence timestamptz;
  v_days_without int;
  v_days_without_adherence int;
  v_habits_today int := 0;
  v_workouts_week int := 0;
  v_activity_week int := 0;
  v_last_weight timestamptz;
  v_last_photo timestamptz;
  v_weight_recent boolean;
  v_photo_recent boolean;
  v_plan_viewed boolean;
  v_streak int;
  v_meal_total int := 0; v_meal_done int := 0; v_meal_ratio double precision := 0;
  v_supp_total int := 0; v_supp_taken int := 0; v_supp_ratio double precision := 0;
  v_engagement int := 0;
  v_recency int;
  v_signal double precision;
  v_normalized double precision;
  v_score int;
  v_level text;
  v_status public.patient_status;
  v_weekly int;
  v_risk text[];
  v_pos  text[];
  v_last_score int; v_last_level text;
  v_mudou int := 0; v_igual int := 0;
begin
  for r in select distinct patient_id from public.adherence_snapshots
            where patient_id is not null order by patient_id loop
    v_patient := r.patient_id;
    v_risk := array[]::text[];
    v_pos  := array[]::text[];

    with ev as (
      select e.type, e.created_at, private.brt_date(e.created_at) as d, private.days_ago_brt(e.created_at, now()) as ago,
             coalesce(t.counts_as_interaction, false) as is_interaction,
             coalesce(t.counts_as_adherence,   false) as is_adherence
      from public.activity_events e
      left join public.activity_event_types t on t.type = e.type
      where e.patient_id = v_patient order by e.created_at desc limit 500
    )
    select max(created_at) filter (where is_interaction),
      max(created_at) filter (where is_adherence),
      count(*) filter (where type in ('hydration_logged','sleep_logged','mood_logged') and d = v_today),
      count(distinct d) filter (where type = 'workout_checked' and ago <= 6),
      count(distinct d) filter (where type = 'activity_logged' and ago <= 6)
    into v_most_recent, v_most_recent_adherence, v_habits_today, v_workouts_week, v_activity_week from ev;

    v_days_without := case when v_most_recent is null then 30 else private.days_ago_brt(v_most_recent, now()) end;
    v_days_without_adherence := case when v_most_recent_adherence is null then 30 else private.days_ago_brt(v_most_recent_adherence, now()) end;
    v_streak := private.event_streak_brt(v_patient);

    select max(measured_at) into v_last_weight from public.weight_logs where patient_id = v_patient;
    select max(taken_at)    into v_last_photo  from public.progress_photos where patient_id = v_patient;
    v_weight_recent := v_last_weight is not null and private.days_ago_brt(v_last_weight, now()) <= 7;
    v_photo_recent  := v_last_photo  is not null and private.days_ago_brt(v_last_photo,  now()) <= 30;
    v_plan_viewed   := v_days_without_adherence <= 3;

    with plan as (select id from public.nutrition_plans where patient_id = v_patient order by created_at desc limit 1),
    plan_meals as (select m.id from public.meals m where m.nutrition_plan_id = (select id from plan)),
    done as (select distinct meal_id from public.meal_logs where patient_id = v_patient and consumed_on = v_today)
    select count(pm.id), count(pm.id) filter (where d.meal_id is not null)
    into v_meal_total, v_meal_done from plan_meals pm left join done d on d.meal_id = pm.id;
    v_meal_ratio := case when v_meal_total > 0 then v_meal_done::double precision / v_meal_total else 0 end;

    with lst as (select id from public.supplements where patient_id = v_patient),
    taken as (select distinct supplement_id from public.supplement_intakes where patient_id = v_patient and taken_on = v_today)
    select count(l.id), count(l.id) filter (where t.supplement_id is not null)
    into v_supp_total, v_supp_taken from lst l left join taken t on t.supplement_id = l.id;
    v_supp_ratio := case when v_supp_total > 0 then v_supp_taken::double precision / v_supp_total else 0 end;

    v_engagement :=
        least(v_habits_today * 3, 12) + least(v_workouts_week * 4, 16)
      + (case when v_weight_recent then 5 else 0 end) + (case when v_photo_recent then 5 else 0 end)
      + (case when v_plan_viewed then 3 else 0 end)
      + (case when v_streak >= 30 then 10 when v_streak >= 14 then 7 when v_streak >= 7 then 4 else 0 end)
      + (case when v_meal_ratio > 0 then private.js_round(least(1, v_meal_ratio) * 6) else 0 end)
      + (case when v_activity_week > 0 then least(v_activity_week, 3) * 2 else 0 end)
      + (case when v_supp_ratio > 0 then private.js_round(least(1, v_supp_ratio) * 4) else 0 end);

    v_recency := case when v_days_without <= 1 then 12 when v_days_without <= 3 then 8
                      when v_days_without <= 6 then 4 when v_days_without <= 14 then 1 else 0 end;
    v_signal := v_recency + v_engagement;
    v_normalized := least(1, greatest(0, v_signal / 75.0));
    v_score := greatest(0, least(100, private.js_round(70 + 30 * power(v_normalized, 0.42))));
    v_level := case when v_score >= 80 then 'alta' when v_score >= 50 then 'moderada' when v_score >= 20 then 'baixa' else 'risco' end;
    v_status := (case when v_days_without >= 15 then 'inativo' when v_score < 20 then 'em_risco'
                      when v_score < 50 then 'atencao' else 'em_acompanhamento' end)::public.patient_status;
    v_weekly := private.js_round((v_workouts_week::double precision / 5) * 100);

    if v_days_without >= 3   then v_risk := array_append(v_risk, v_days_without || ' dias sem interação'); end if;
    if v_habits_today = 0    then v_risk := array_append(v_risk, 'Nenhum hábito registrado hoje'); end if;
    if v_workouts_week < 2   then v_risk := array_append(v_risk, 'Poucos treinos esta semana'); end if;
    if not v_weight_recent   then v_risk := array_append(v_risk, 'Peso não registrado recentemente'); end if;
    if not v_photo_recent    then v_risk := array_append(v_risk, 'Foto mensal pendente'); end if;

    if v_streak >= 7         then v_pos := array_append(v_pos, 'Sequência de ' || v_streak || ' dias'); end if;
    if v_habits_today >= 3   then v_pos := array_append(v_pos, 'Hábitos em dia'); end if;
    if v_workouts_week >= 3  then v_pos := array_append(v_pos, 'Treinos consistentes'); end if;
    if v_weight_recent       then v_pos := array_append(v_pos, 'Peso atualizado'); end if;
    if v_plan_viewed         then v_pos := array_append(v_pos, 'Plano acompanhado'); end if;
    if v_meal_ratio >= 0.6   then v_pos := array_append(v_pos, 'Refeições do dia em dia'); end if;
    if v_activity_week >= 2  then v_pos := array_append(v_pos, 'Atividades complementares na semana'); end if;
    if v_supp_ratio >= 0.6   then v_pos := array_append(v_pos, 'Suplementos em dia'); end if;

    select score, level into v_last_score, v_last_level
    from public.adherence_snapshots where patient_id = v_patient order by calculated_at desc limit 1;

    if v_last_score is not distinct from v_score and v_last_level is not distinct from v_level then
      v_igual := v_igual + 1;
      raise notice 'WP-METRIC-1a backfill: paciente % INALTERADO (score % / %)', v_patient, v_score, v_level;
    else
      insert into public.adherence_snapshots
        (patient_id, score, level, status, streak, weekly_completion_rate, risk_factors, positive_factors)
      values (v_patient, v_score, v_level, v_status, v_streak, v_weekly, v_risk, v_pos);
      v_mudou := v_mudou + 1;
      raise notice 'WP-METRIC-1a backfill: paciente % RECALCULADO % (%) -> % (%)',
        v_patient, v_last_score, v_last_level, v_score, v_level;
    end if;
  end loop;
  raise notice 'WP-METRIC-1a backfill concluido: % recalculado(s), % inalterado(s).', v_mudou, v_igual;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6) Ledger técnico interno
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.schema_migration_log (version, filename, description, session)
values ('20260807090000', '20260807090000_wp_metric_1a_event_type_catalog.sql',
  'WP-METRIC-1a: "o que conta como adesao" vira DADO. Nova tabela catalogo '
  'public.activity_event_types (type PK, counts_as_adherence, counts_as_interaction, note) '
  'semeada com os 10 tipos da allow-list RELEVANT_EVENT_TYPES do eventSync do app; '
  'help_requested e a UNICA linha com as colunas divergentes (interacao=true, adesao=false): '
  'pedir socorro e sinal de vida, nao e autocuidado. RLS no mesmo padrao de '
  'achievements_catalog_read (SELECT to authenticated using true; nenhuma policy de escrita; '
  'revoke insert/update/delete de authenticated e anon -> ACL rDxtm identico ao de '
  'achievements). FK NOVA activity_events.type -> activity_event_types.type, precedida de '
  'guarda que nomeia tipos orfaos em vez de estourar violacao opaca (os 2 tipos em producao, '
  'hydration_logged e progress_photo_uploaded, passam). private.event_streak_brt: UNICA '
  'alteracao e o predicado counts_as_adherence dentro do limit 500 — assinatura, janela, fuso '
  'e recursao intactos; sequencia de dias deixa de ser sustentada por socorro. '
  'public.recompute_adherence: o max(created_at) SEM filtro vira DUAS grandezas — '
  'max filter(is_interaction) alimenta recencia, saida de inativo e o fator "N dias sem '
  'interacao"; max filter(is_adherence) alimenta o bonus de plano acompanhado. Os outros tres '
  'agregados (habitos/treinos/atividade), que ja filtravam tipo, ficam intactos; LEFT JOIN no '
  'catalogo preserva o conjunto de linhas do CTE para nao mexer neles pelas costas. Formula, '
  'tiers, soft-cap e skip-if-unchanged inalterados. Backfill de execucao unica recomputa os '
  'snapshots EXISTENTES sob a regra nova (append-only: acrescenta linha so quando muda). '
  'NAO toca brt_date/fuso (DIVIDA-TZ-1), job de decaimento (DIVIDA-RLS2-1), '
  'recompute_achievements (herda a correcao via event_streak_brt), trigger de recuperacao, '
  'export_patient_report, os espelhos client-side (DIVIDA-METRIC-1b) nem o lockdown das 3 '
  'tabelas derivadas. Nenhum helper novo em private (seguem 48).',
  'WP-METRIC-1a')
on conflict (version) do nothing;
