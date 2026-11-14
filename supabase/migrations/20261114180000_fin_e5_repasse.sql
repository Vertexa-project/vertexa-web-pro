-- =====================================================================================
-- FIN-E5 — Financeiro / Repasse / Estoque · Entrega 5 (motor de repasse). 100% ADITIVA:
-- cria tabelas fin_share_rules, fin_share_lines, fin_share_period_locks; funções private.share_* e public.fin_share_*;
-- 3 gatilhos novos (AFTER INSERT em fin_events; AFTER UPDATE em fin_receivables e em fin_sales); recria (create or replace)
-- private.fin_area_roles e public.fin_my_access com as áreas novas (corpo da E4 preservado + o novo). Nada mais existente muda.
-- Depende de E1 (20261113100000), E2 (20261113180000), E3 (20261113230000), E4 (20261114090000) e E4-clinical-pro (20261114100000).
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local: scripts/fin-e5-sql-proof.sh).
--
-- Modelo (escopo-v1 §5, §11, §12.1):
--  * fin_share_rules  — regra por profissional · papel · alvo (serviço > categoria > padrão) · tipo (pct com faixas, fixo por execução,
--                       fixo mensal, garantia mínima, comissão de produto, taxa de uso, sem repasse) · vigência · unidades.
--                       Regra USADA por lançamento só tem o fim da vigência alterado: mudar tipo/valor = encerrar e criar outra.
--  * fin_share_lines  — lançamento de repasse IMUTÁVEL (nem UPDATE, nem DELETE, nem TRUNCATE) com memória de cálculo (regra, base, %, valor).
--                       Correção/estorno = linha NOVA (delta, possivelmente negativa) que aponta para a origem; nunca se apaga.
--  * fin_share_period_locks — meses travados (preenchida pela Entrega 6, fechamento). Mês travado: a correção cai no próximo mês aberto.
--  * O cálculo é por RECONCILIAÇÃO idempotente: private.share_apply compara o que DEVERIA existir (chave por atendimento/título/regra)
--    com a soma do que existe e só grava a diferença. Rodar de novo não duplica nada.
--  * Gatilhos: título liquidado/estornado/corrigido e venda alterada recalculam a venda; eventos do atendimento (realizado, cancelado,
--    material ajustado, participantes trocados) e do pacote (entrega/devolução) recalculam o atendimento/pacote. Falha do motor NUNCA
--    bloqueia venda, recebimento nem atendimento: o erro vai ao log e fin_share_recalc reprocessa.
--  * Linhas mensais (ajuste de faixa, fixo mensal, garantia, taxa de uso, saldo negativo trazido, retenções) saem da PRÉVIA
--    (public.fin_share_month); a Entrega 6 (fechamento) as grava ao fechar. Sem fechamento, extrato, aceite nem pagamento aqui.
-- =====================================================================================

-- ---------- 1. Tabelas ----------
create table if not exists public.fin_share_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  role text check (role is null or role in ('responsavel','executor','auxiliar','vendedor')),
  target_type text not null default 'default' check (target_type in ('service','category','item','default')),
  service_id uuid references public.fin_services(id) on delete restrict,
  category text check (category is null or category in ('consulta','procedimento','aplicacao','avaliacao','sessao','outro')),
  stock_item_id uuid references public.stock_items(id) on delete restrict,
  rule_type text not null check (rule_type in ('pct','fixed_per_exec','fixed_monthly','min_guarantee','product_commission','usage_fee','none')),
  pct numeric(7,4) check (pct is null or (pct >= 0 and pct <= 100)),
  amount_cents integer check (amount_cents is null or amount_cents between 0 and 1000000000),
  tiers jsonb,                                    -- [{"up_to_cents": 2000000, "pct": 50}, {"up_to_cents": null, "pct": 60}] (progressivo)
  tier_scope text check (tier_scope is null or tier_scope in ('organization','unit')),
  compensation boolean not null default false,    -- garantia mínima com compensação
  usage_fee_mode text check (usage_fee_mode is null or usage_fee_mode in ('fixed','pct')),
  commission_base text not null default 'net_fee' check (commission_base in ('net_fee','margin')),
  deductions_override jsonb,                      -- {"fee": bool, "tax": bool, "material": bool}; chave ausente = herda da clínica
  all_units boolean not null default true,
  unit_ids uuid[] not null default '{}',
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (all_units or cardinality(unit_ids) > 0),
  check ((target_type = 'service') = (service_id is not null)),
  check ((target_type = 'category') = (category is not null)),
  check ((target_type = 'item') = (stock_item_id is not null)),
  check (case rule_type
    when 'pct' then role in ('responsavel','executor','auxiliar') and target_type in ('service','category','default') and amount_cents is null
                    and ((pct is not null and tiers is null) or (pct is null and tiers is not null))
    when 'fixed_per_exec' then role in ('responsavel','executor','auxiliar') and target_type in ('service','category','default') and amount_cents is not null and pct is null and tiers is null
    when 'none' then role in ('responsavel','executor','auxiliar') and target_type in ('service','category','default') and amount_cents is null and pct is null and tiers is null
    when 'fixed_monthly' then role is null and target_type = 'default' and amount_cents is not null and pct is null and tiers is null
    when 'min_guarantee' then role is null and target_type = 'default' and amount_cents is not null and pct is null and tiers is null
    when 'usage_fee' then role is null and target_type = 'default' and usage_fee_mode is not null and tiers is null
                          and ((usage_fee_mode = 'fixed' and amount_cents is not null and pct is null) or (usage_fee_mode = 'pct' and pct is not null and amount_cents is null))
    when 'product_commission' then role = 'vendedor' and target_type in ('item','default') and tiers is null
                          and ((pct is not null and amount_cents is null) or (pct is null and amount_cents is not null))
    else false end)
);
create index if not exists fin_share_rules_pro_idx on public.fin_share_rules (clinic_id, professional_id, valid_from);

create table if not exists public.fin_share_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid references public.clinic_units(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- mês do extrato (competência do repasse)
  line_type text not null check (line_type in ('pct','tier_adjust','fixed_exec','fixed_monthly','guarantee','commission','usage_fee','adjustment','withholding')),
  role text check (role is null or role in ('responsavel','executor','auxiliar','vendedor')),
  scope_type text not null check (scope_type in ('sale_item','package','appointment','manual')),
  scope_id uuid,
  line_key text not null,                                                        -- identifica a origem; várias linhas da mesma chave = original + correções
  source_date date,                                                              -- data em que o repasse foi liberado (liquidação ou execução)
  appointment_id uuid references public.fin_appointments(id) on delete cascade,
  sale_id uuid references public.fin_sales(id) on delete cascade,
  sale_item_id uuid references public.fin_sale_items(id) on delete cascade,
  receivable_id uuid references public.fin_receivables(id) on delete cascade,
  rule_id uuid references public.fin_share_rules(id) on delete restrict,
  gross_cents bigint,                                                            -- valor liquidado (bruto) que originou a linha (delta nas correções)
  base_cents bigint,                                                             -- base de cálculo (delta nas correções)
  pct numeric(7,4),
  amount_cents bigint not null,                                                  -- com sinal: estorno = negativo
  origin_period text check (origin_period is null or origin_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  origin_line_id uuid references public.fin_share_lines(id) on delete cascade,
  kind text not null default 'original' check (kind in ('original','correction','manual')),
  reason text,
  memory jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists fin_share_lines_pro_period_idx on public.fin_share_lines (clinic_id, professional_id, period);
create index if not exists fin_share_lines_key_idx on public.fin_share_lines (line_key, created_at);
create index if not exists fin_share_lines_scope_idx on public.fin_share_lines (scope_type, scope_id);
create index if not exists fin_share_lines_appt_idx on public.fin_share_lines (appointment_id) where appointment_id is not null;
create index if not exists fin_share_lines_rule_idx on public.fin_share_lines (rule_id, period) where rule_id is not null;

-- Meses travados (a Entrega 6 grava ao fechar o mês; aqui só se consulta). Mês travado nunca é recalculado: a correção cai no próximo mês aberto.
create table if not exists public.fin_share_period_locks (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  locked_at timestamptz not null default now(),
  locked_by uuid,
  primary key (clinic_id, period)
);

-- Sem exclusão física: regra se desativa; linha é imutável (nem UPDATE). Apagar a clínica inteira (cascata) continua possível, como nas Entregas 3 e 4.
do $$
declare t text;
begin
  execute 'drop trigger if exists fin_share_rules_nodel on public.fin_share_rules';
  execute 'create trigger fin_share_rules_nodel before delete on public.fin_share_rules for each row execute function private.fin_e4_no_delete()';
  execute 'drop trigger if exists fin_share_rules_nodel_trunc on public.fin_share_rules';
  execute 'create trigger fin_share_rules_nodel_trunc before truncate on public.fin_share_rules for each statement execute function private.fin_e4_no_delete()';
  foreach t in array array['fin_share_lines'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immut', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.fin_e4_immutable()', t || '_immut', t);
    execute format('drop trigger if exists %I on public.%I', t || '_immut_trunc', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.fin_e4_immutable()', t || '_immut_trunc', t);
  end loop;
end $$;

-- ---------- 2. RLS e grants ----------
alter table public.fin_share_rules enable row level security;
alter table public.fin_share_lines enable row level security;
alter table public.fin_share_period_locks enable row level security;
revoke all on public.fin_share_rules, public.fin_share_lines, public.fin_share_period_locks from anon, authenticated;
-- Regras: leitura por RLS (Gestor, Financeiro, Admin). Lançamentos e travas: SEM select direto (o paciente e o material só saem pelas RPCs, com a máscara da clínica).
grant select on public.fin_share_rules to authenticated;
create policy fin_share_rules_select on public.fin_share_rules for select to authenticated using (private.fin_can(clinic_id, 'share_rules', null, false));
create policy fin_share_lines_select on public.fin_share_lines for select to authenticated
  using (private.fin_can(clinic_id, 'share_lines', unit_id, false) or (private.appt_is_pro(clinic_id) and private.fin_is_self_professional(professional_id)));
create policy fin_share_period_locks_select on public.fin_share_period_locks for select to authenticated using (private.fin_can(clinic_id, 'share_lines', null, false));

-- ---------- 3. Matriz de papéis (replace: corpo da E4 + áreas do repasse) e acesso do chamador ----------
create or replace function private.fin_area_roles(p_area text, p_write boolean) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_area = 'units'       then case when p_write then '{}'::text[] else array['gestor','financeiro','estoquista','recepcao'] end
    when p_area = 'staff'       then '{}'::text[]
    when p_area in ('services','packages','payment','tax','pro_finance') then array['gestor','financeiro']
    when p_area = 'settings'    then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'audit'       then case when p_write then '{}'::text[] else array['gestor'] end
    when p_area = 'stock_items' then case when p_write then array['gestor','estoquista'] else array['gestor','estoquista','financeiro'] end
    -- E2
    when p_area = 'sales'           then array['gestor','financeiro','recepcao']
    when p_area = 'sales_price'     then array['gestor','financeiro']
    when p_area = 'sale_cancel'     then case when p_write then array['gestor','financeiro'] else array['gestor','financeiro','recepcao'] end
    when p_area = 'cash'            then array['gestor','financeiro','recepcao']
    when p_area = 'cash_all'        then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    when p_area = 'cash_approve'    then array['gestor']
    when p_area = 'receivables'     then array['gestor','financeiro']
    when p_area = 'receivables_fix' then array['gestor']
    when p_area = 'compliance'      then case when p_write then '{}'::text[] else array['gestor'] end
    -- E3
    when p_area = 'stock_move'      then case when p_write then array['gestor','estoquista'] else array['gestor','estoquista','financeiro'] end
    -- E4: atendimento (lista e custo do material: Gestor e Financeiro; escreve o Gestor; o profissional participante age no PRÓPRIO atendimento, pela RPC)
    when p_area = 'appt'            then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    -- E4: saldo de sessões e itens dos pacotes dos pacientes (a Recepção agenda e vende; escrita só pelas RPCs de atendimento/entrega/venda)
    when p_area = 'patient_pkg'     then case when p_write then '{}'::text[] else array['gestor','financeiro','recepcao'] end
    -- E4: entregar ao paciente o item de um pacote (quem entrega fisicamente: Estoquista, Gestor e Recepção)
    when p_area = 'package_deliver' then array['gestor','estoquista','recepcao']
    -- E5: repasse. Regras: Gestor configura, Financeiro consulta; lançamentos: Gestor e Financeiro (o profissional vê só os próprios pela RPC); recalcular: Gestor e Financeiro
    when p_area = 'share_rules'     then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'share_lines'     then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    when p_area = 'share_recalc'    then array['gestor','financeiro']
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move',
                                'appt','patient_pkg','package_deliver','share_rules','share_lines','share_recalc'];
        a text; v_can jsonb := '{}'::jsonb; v_roles jsonb; v_pro boolean;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then
    return jsonb_build_object('is_admin', false, 'roles', '[]'::jsonb, 'can', '{}'::jsonb);
  end if;
  foreach a in array v_areas loop
    v_can := v_can || jsonb_build_object(a || '_read', private.fin_can(p_clinic, a, null, false), a || '_write', private.fin_can(p_clinic, a, null, true));
  end loop;
  select exists (select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active') into v_pro;
  -- Profissional (sem papel financeiro) vê só a PRÓPRIA produção: vendas em que é vendedor e atendimentos em que participa.
  v_can := v_can || jsonb_build_object('own_sales_read', v_pro, 'own_appt', private.appt_is_pro(p_clinic), 'own_share', private.appt_is_pro(p_clinic));
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids))), '[]'::jsonb)
    into v_roles
    from public.clinic_staff_roles r
    join public.professionals pr on pr.id = r.professional_id
   where r.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  return jsonb_build_object('is_admin', private.is_clinic_admin(p_clinic), 'roles', v_roles, 'can', v_can);
end $$;


-- ---------- 4. Internas: período, regra vigente, faixa, deduções ----------
create or replace function private.share_period(p_d date) returns text
language sql immutable set search_path = '' as $$ select to_char(p_d, 'YYYY-MM') $$;

create or replace function private.share_period_start(p_period text) returns date
language sql immutable set search_path = '' as $$ select (p_period || '-01')::date $$;

create or replace function private.share_locked(p_clinic uuid, p_period text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_share_period_locks k where k.clinic_id = p_clinic and k.period = p_period)
$$;

-- Mês em que uma correção cai: o próprio mês de origem se estiver aberto; senão o próximo mês aberto (D9, §5.6).
create or replace function private.share_target_period(p_clinic uuid, p_origin text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v date := private.share_period_start(p_origin); i integer := 0;
begin
  if not private.share_locked(p_clinic, p_origin) then return p_origin; end if;
  loop
    v := (v + interval '1 month')::date; i := i + 1;
    exit when not private.share_locked(p_clinic, private.share_period(v)) or i > 240;
  end loop;
  return private.share_period(v);
end $$;

-- Nível de especificidade (§5.1): 1 serviço · 2 categoria · 3 padrão; nulo = a regra não vale para este serviço.
create or replace function private.share_lvl(r public.fin_share_rules, p_service uuid, p_category text) returns integer
language sql immutable set search_path = '' as $$
  select case when r.target_type = 'service' and r.service_id = p_service then 1
              when r.target_type = 'category' and r.category = p_category then 2
              when r.target_type = 'default' then 3 end
$$;

-- Regras vigentes de um participante: só as do nível mais específico que existir (profissional + serviço + papel, depois categoria, depois padrão).
create or replace function private.share_match(p_clinic uuid, p_prof uuid, p_role text, p_service uuid, p_category text, p_on date, p_unit uuid)
returns setof public.fin_share_rules
language sql stable security definer set search_path = '' as $$
  select r.* from public.fin_share_rules r
   where r.clinic_id = p_clinic and r.professional_id = p_prof and r.role = p_role and r.is_active
     and r.rule_type in ('pct','fixed_per_exec','none')
     and r.valid_from <= p_on and (r.valid_to is null or r.valid_to >= p_on) and (r.all_units or p_unit = any (r.unit_ids))
     and private.share_lvl(r, p_service, p_category) = (
       select min(private.share_lvl(r2, p_service, p_category)) from public.fin_share_rules r2
        where r2.clinic_id = p_clinic and r2.professional_id = p_prof and r2.role = p_role and r2.is_active
          and r2.rule_type in ('pct','fixed_per_exec','none')
          and r2.valid_from <= p_on and (r2.valid_to is null or r2.valid_to >= p_on) and (r2.all_units or p_unit = any (r2.unit_ids)))
$$;

-- Regras de comissão de produto vigentes: item específico antes do padrão.
create or replace function private.share_match_commission(p_clinic uuid, p_prof uuid, p_item uuid, p_on date, p_unit uuid)
returns setof public.fin_share_rules
language sql stable security definer set search_path = '' as $$
  select r.* from public.fin_share_rules r
   where r.clinic_id = p_clinic and r.professional_id = p_prof and r.rule_type = 'product_commission' and r.is_active
     and r.valid_from <= p_on and (r.valid_to is null or r.valid_to >= p_on) and (r.all_units or p_unit = any (r.unit_ids))
     and (r.target_type = 'default' or r.stock_item_id = p_item)
     and (case when r.target_type = 'item' then 1 else 2 end) = (
       select min(case when r2.target_type = 'item' then 1 else 2 end) from public.fin_share_rules r2
        where r2.clinic_id = p_clinic and r2.professional_id = p_prof and r2.rule_type = 'product_commission' and r2.is_active
          and r2.valid_from <= p_on and (r2.valid_to is null or r2.valid_to >= p_on) and (r2.all_units or p_unit = any (r2.unit_ids))
          and (r2.target_type = 'default' or r2.stock_item_id = p_item))
$$;

-- Percentual da faixa atingida (prévia durante o mês): primeira faixa cujo teto cobre a base acumulada; a última é «acima de».
create or replace function private.share_tier_pct(p_tiers jsonb, p_cum bigint) returns numeric
language plpgsql immutable set search_path = '' as $$
declare t jsonb; v_last numeric;
begin
  for t in select e from jsonb_array_elements(p_tiers) e loop
    v_last := (t->>'pct')::numeric;
    if nullif(t->>'up_to_cents', '') is null or p_cum <= (t->>'up_to_cents')::bigint then return v_last; end if;
  end loop;
  return v_last;
end $$;

-- Cálculo progressivo (D26, Exemplo G): cada faixa só incide sobre a parte da base que cai nela. Arredonda meio-para-cima no total.
create or replace function private.share_tier_progressive(p_tiers jsonb, p_base bigint) returns bigint
language plpgsql immutable set search_path = '' as $$
declare t jsonb; v_prev numeric := 0; v_up numeric; v_part numeric; v_sum numeric := 0;
begin
  for t in select e from jsonb_array_elements(p_tiers) e loop
    v_up := case when nullif(t->>'up_to_cents', '') is null then null else (t->>'up_to_cents')::numeric end;
    v_part := greatest(least(p_base::numeric, coalesce(v_up, p_base::numeric)) - v_prev, 0);
    v_sum := v_sum + v_part * (t->>'pct')::numeric / 100;
    exit when v_up is null or p_base <= v_up;
    v_prev := v_up;
  end loop;
  return round(v_sum)::bigint;
end $$;

-- Deduções da base (§5.2): cada uma só entra se estiver ligada na clínica ou na regra (a regra sobrescreve).
create or replace function private.share_ded(p_clinic uuid, p_rule public.fin_share_rules) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'fee', coalesce((p_rule.deductions_override->>'fee')::boolean, s.deduct_fee, true),
    'tax', coalesce((p_rule.deductions_override->>'tax')::boolean, s.deduct_tax, false),
    'material', coalesce((p_rule.deductions_override->>'material')::boolean, s.deduct_material, false))
  from (select 1) d left join public.fin_settings s on s.clinic_id = p_clinic
$$;

-- Alíquota do imposto no mês: a do próprio mês ou a mais recente anterior (F21); sem cadastro, 0.
create or replace function private.share_tax_pct(p_clinic uuid, p_period text, p_unit uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select t.rate_pct from public.fin_tax_rates t
                    where t.clinic_id = p_clinic and t.period <= p_period and (t.unit_id is null or t.unit_id = p_unit)
                    order by t.period desc, (t.unit_id is null) asc limit 1), 0)
$$;

-- Parte de um título que cabe a um item da venda: o título é distribuído entre os itens pelos pesos da alocação do recebimento (§5.2).
create or replace function private.share_item_part(p_gross integer, p_fee integer, p_payment uuid, p_item uuid)
returns table (share_gross bigint, share_fee bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[]; v_ws bigint[]; g bigint[]; f bigint[]; i integer;
begin
  select array_agg(al.sale_item_id order by it.position), array_agg(al.amount_cents::bigint order by it.position)
    into v_ids, v_ws
    from public.fin_payment_allocations al join public.fin_sale_items it on it.id = al.sale_item_id where al.payment_id = p_payment;
  if v_ids is null or (select coalesce(sum(w), 0) from unnest(v_ws) w) <= 0 then return; end if;
  i := array_position(v_ids, p_item);
  if i is null then return; end if;
  g := private.fin_distribute(p_gross, v_ws); f := private.fin_distribute(p_fee, v_ws);
  share_gross := g[i]; share_fee := f[i];
  return next;
end $$;

create or replace function private.share_initials(p_name text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif((select string_agg(upper(left(w, 1)) || '.', ' ') from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') w where w <> ''), ''), '—')
$$;

-- ---------- 5. Construtores: o que DEVERIA existir (chave, base, %, valor, memória) ----------
-- 5.1 Item de venda (serviço avulso: percentual por título liquidado e atendimento realizado; produto: comissão).
create or replace function private.share_build_sale_item(p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  it public.fin_sale_items; s public.fin_sales; sv public.fin_services; si public.stock_items; st public.fin_settings;
  v_out jsonb := '[]'::jsonb; n integer; rc record; a record; p record; rl public.fin_share_rules; v_ded jsonb; v_none boolean;
  g bigint; fee bigint; tax bigint; mat bigint; base bigint; v_taxpct numeric; v_pct numeric; v_period text; v_rel date; v_key text; v_cum bigint; v_scope text;
  v_pro uuid; v_cost bigint; v_amt bigint; v_med_ok boolean; v_sale_date date;
begin
  select * into it from public.fin_sale_items where id = p_item;
  if it.id is null then return v_out; end if;
  select * into s from public.fin_sales where id = it.sale_id;
  select * into st from public.fin_settings where clinic_id = s.clinic_id;

  if it.item_type = 'service' then
    select * into sv from public.fin_services where id = it.service_id;
    n := greatest(round(it.quantity)::integer, 1);
    for rc in
      select r.id as rid, r.settled_date, sh.share_gross, sh.share_fee
        from public.fin_receivables r
        join public.fin_payments pm on pm.id = r.payment_id and pm.status = 'active'
        cross join lateral private.share_item_part(r.gross_cents, r.fee_cents, r.payment_id, p_item) sh
       where r.sale_id = s.id and r.status = 'settled'
       order by r.settled_date, r.installment_no, r.id
    loop
      for a in select ap.* from public.fin_appointments ap where ap.sale_item_id = p_item and ap.status = 'done' order by ap.performed_on, ap.created_at, ap.id loop
        g := round(rc.share_gross::numeric / n)::bigint; fee := round(rc.share_fee::numeric / n)::bigint;
        v_rel := greatest(rc.settled_date, a.performed_on); v_period := private.share_period(v_rel);
        v_taxpct := private.share_tax_pct(s.clinic_id, v_period, a.unit_id);
        tax := round(g::numeric * v_taxpct / 100)::bigint;
        for p in select * from public.fin_appointment_participants where appointment_id = a.id order by position loop
          v_none := exists (select 1 from private.share_match(s.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id) m where m.rule_type = 'none');
          continue when v_none;
          for rl in select * from private.share_match(s.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id) m where m.rule_type = 'pct' loop
            v_ded := private.share_ded(s.clinic_id, rl);
            mat := case when not (v_ded->>'material')::boolean then 0
                        when coalesce(a.base_value_cents, 0) > 0 then least(round(a.material_cost_cents::numeric * g / a.base_value_cents)::bigint, a.material_cost_cents)
                        else a.material_cost_cents end;
            base := greatest(g - case when (v_ded->>'fee')::boolean then fee else 0 end - case when (v_ded->>'tax')::boolean then tax else 0 end - mat, 0);
            v_key := 'pct:' || p_item || ':' || a.id || ':' || p.professional_id || ':' || p.role || ':' || rl.id || ':' || rc.rid || ':' || v_period;
            v_pct := (select l.pct from public.fin_share_lines l where l.line_key = v_key order by l.created_at, l.id limit 1);
            if v_pct is null then
              if rl.tiers is null then v_pct := rl.pct;
              else
                v_scope := coalesce(rl.tier_scope, st.tier_base, 'organization');
                select coalesce(sum(l.base_cents), 0) into v_cum from public.fin_share_lines l
                 where l.rule_id = rl.id and l.period = v_period and l.line_type = 'pct' and (v_scope = 'organization' or l.unit_id is not distinct from a.unit_id);
                v_pct := private.share_tier_pct(rl.tiers, v_cum + base);
              end if;
            end if;
            v_out := v_out || jsonb_build_array(jsonb_build_object(
              'key', v_key, 'unit_id', a.unit_id, 'professional_id', p.professional_id, 'role', p.role, 'rule_id', rl.id, 'line_type', 'pct', 'period', v_period,
              'source_date', v_rel, 'appointment_id', a.id, 'sale_id', s.id, 'sale_item_id', p_item, 'receivable_id', rc.rid,
              'gross', g, 'base', base, 'pct', v_pct, 'amount', round(base::numeric * v_pct / 100)::bigint,
              'memory', jsonb_build_object('origin', 'avulso', 'service', sv.name, 'category', sv.category, 'performed_on', a.performed_on, 'settled_date', rc.settled_date,
                'gross_cents', g, 'fee_cents', fee, 'tax_cents', tax, 'tax_pct', v_taxpct, 'material_cents', mat, 'deductions', v_ded,
                'rule', jsonb_build_object('id', rl.id, 'type', rl.rule_type, 'target', rl.target_type, 'pct', rl.pct, 'tiers', rl.tiers, 'valid_from', rl.valid_from),
                'formula', format('base = %s − taxa %s − imposto %s − material %s = %s; repasse = base × %s%%',
                                  g, case when (v_ded->>'fee')::boolean then fee else 0 end, case when (v_ded->>'tax')::boolean then tax else 0 end, mat, base, v_pct))));
          end loop;
        end loop;
      end loop;
    end loop;

  elsif it.item_type in ('product','compounded') then
    select * into si from public.stock_items where id = it.stock_item_id;
    v_sale_date := (s.created_at at time zone 'America/Sao_Paulo')::date;
    v_med_ok := si.item_type not in ('medication','compounded')
                or exists (select 1 from public.fin_compliance_acceptances c where c.clinic_id = s.clinic_id and c.type = 'commission_on_medication');
    select coalesce(-sum(m.total_cost_cents), 0) into v_cost from public.stock_movements m where m.sale_id = s.id and m.item_id = it.stock_item_id;
    for v_pro in select distinct x from unnest(array[s.seller_professional_id, s.referrer_professional_id]) x where x is not null loop
      for rl in select * from private.share_match_commission(s.clinic_id, v_pro, it.stock_item_id, v_sale_date, s.unit_id) loop
        continue when not v_med_ok;
        for rc in
          select r.id as rid, r.settled_date, sh.share_gross, sh.share_fee
            from public.fin_receivables r
            join public.fin_payments pm on pm.id = r.payment_id and pm.status = 'active'
            cross join lateral private.share_item_part(r.gross_cents, r.fee_cents, r.payment_id, p_item) sh
           where r.sale_id = s.id and r.status = 'settled' order by r.settled_date, r.installment_no, r.id
        loop
          g := rc.share_gross; fee := rc.share_fee; v_period := private.share_period(rc.settled_date);
          v_cost := coalesce(v_cost, 0);
          base := greatest(g - fee - case when rl.commission_base = 'margin' and it.net_cents > 0 then round(v_cost::numeric * g / it.net_cents)::bigint else 0 end, 0);
          v_amt := case when rl.pct is not null then round(base::numeric * rl.pct / 100)::bigint
                        when it.net_cents > 0 then round(rl.amount_cents::numeric * it.quantity * g / it.net_cents)::bigint else 0 end;
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'key', 'cm:' || p_item || ':' || v_pro || ':' || rl.id || ':' || rc.rid || ':' || v_period, 'unit_id', s.unit_id, 'professional_id', v_pro, 'role', 'vendedor', 'rule_id', rl.id,
            'line_type', 'commission', 'period', v_period, 'source_date', rc.settled_date, 'sale_id', s.id, 'sale_item_id', p_item, 'receivable_id', rc.rid,
            'gross', g, 'base', base, 'pct', rl.pct, 'amount', v_amt,
            'memory', jsonb_build_object('origin', 'produto', 'item', si.name, 'item_type', si.item_type, 'settled_date', rc.settled_date, 'gross_cents', g, 'fee_cents', fee,
              'commission_base', rl.commission_base, 'rule', jsonb_build_object('id', rl.id, 'type', rl.rule_type, 'pct', rl.pct, 'amount_cents', rl.amount_cents, 'valid_from', rl.valid_from),
              'formula', case when rl.pct is not null then format('base = %s − taxa %s%s; comissão = base × %s%%', g, fee, case when rl.commission_base = 'margin' then ' − custo' else '' end, rl.pct)
                              else format('R$ %s por unidade × %s un., proporcional ao liquidado', rl.amount_cents, it.quantity) end)));
        end loop;
      end loop;
    end loop;
  end if;
  return v_out;
end $$;

-- 5.2 Pacote do paciente (§5.4, D8): cada sessão/entrega só libera quando o liquidado acumulado do pacote cobre o valor rateado dela, por ordem de data.
create or replace function private.share_build_pkg(p_pp uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pp public.fin_patient_packages; it public.fin_sale_items; s public.fin_sales; sv public.fin_services; si public.stock_items; a public.fin_appointments;
  v_out jsonb := '[]'::jsonb; rc record; u record; p record; rl public.fin_share_rules; v_ded jsonb; v_none boolean; st public.fin_settings;
  v_dates date[] := '{}'; v_cums numeric[] := '{}'; v_cum numeric := 0; v_cumval numeric := 0; k integer; i integer; v_rel date; v_period text;
  v_feeall numeric := 0; v_grossall numeric := 0; v_ratio numeric; g bigint; fee bigint; tax bigint; mat bigint; base bigint; v_taxpct numeric; v_pct numeric; v_key text;
  v_cost bigint; v_pro uuid; v_amt bigint; v_med_ok boolean; v_sale_date date; v_scope text; v_cumb bigint; v_scale numeric;
begin
  select * into pp from public.fin_patient_packages where id = p_pp;
  if pp.id is null then return v_out; end if;
  select * into it from public.fin_sale_items where id = pp.sale_item_id;
  select * into s from public.fin_sales where id = pp.sale_id;
  select * into st from public.fin_settings where clinic_id = pp.clinic_id;
  v_scale := case when it.net_cents > 0 then pp.price_cents::numeric / it.net_cents else 0 end;   -- fração do item que cabe a este pacote do paciente
  -- linha do tempo do liquidado (só títulos liquidados de pagamentos ativos) e taxa efetiva do pacote (taxa total ÷ valor total)
  for rc in
    select r.id as rid, r.status, r.settled_date, sh.share_gross, sh.share_fee
      from public.fin_receivables r
      join public.fin_payments pm on pm.id = r.payment_id and pm.status = 'active'
      cross join lateral private.share_item_part(r.gross_cents, r.fee_cents, r.payment_id, pp.sale_item_id) sh
     where r.sale_id = pp.sale_id and r.status in ('expected','settled') order by r.settled_date nulls last, r.installment_no, r.id
  loop
    v_feeall := v_feeall + rc.share_fee * v_scale; v_grossall := v_grossall + rc.share_gross * v_scale;
    if rc.status = 'settled' then
      v_cum := v_cum + rc.share_gross * v_scale; v_dates := v_dates || rc.settled_date; v_cums := v_cums || v_cum;
    end if;
  end loop;
  v_ratio := case when v_grossall > 0 then v_feeall / v_grossall else 0 end;
  v_sale_date := (s.created_at at time zone 'America/Sao_Paulo')::date;

  for u in
    select l.id as lid, l.kind, l.value_cents, l.occurred_on, l.appointment_id, l.qty, l.stock_movement_ids, pi.item_type, pi.stock_item_id, pi.name as item_name, l.created_at
      from public.fin_package_ledger l join public.fin_patient_package_items pi on pi.id = l.patient_package_item_id
     where pi.patient_package_id = pp.id
       and ((l.kind = 'session_use' and exists (select 1 from public.fin_appointments ap where ap.id = l.appointment_id and ap.status = 'done'))
         or l.kind in ('delivery','delivery_return'))
     order by l.occurred_on, l.created_at, l.id
  loop
    v_cumval := v_cumval + u.value_cents;
    v_rel := null; k := null;
    if v_cumval <= 0 then v_rel := u.occurred_on;
    else
      for i in 1..coalesce(cardinality(v_cums), 0) loop
        if v_cums[i] >= v_cumval then k := i; exit; end if;
      end loop;
      if k is not null then v_rel := greatest(v_dates[k], u.occurred_on); end if;
    end if;
    continue when v_rel is null;                      -- ainda aguardando recebimento (§5.4 item 3)
    v_period := private.share_period(v_rel);
    v_taxpct := private.share_tax_pct(pp.clinic_id, v_period, pp.unit_id);

    if u.kind = 'session_use' then
      select * into a from public.fin_appointments where id = u.appointment_id;
      select * into sv from public.fin_services where id = a.service_id;
      g := u.value_cents; fee := round(g * v_ratio)::bigint; tax := round(g::numeric * v_taxpct / 100)::bigint;
      for p in select * from public.fin_appointment_participants where appointment_id = a.id order by position loop
        v_none := exists (select 1 from private.share_match(pp.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id) m where m.rule_type = 'none');
        continue when v_none;
        for rl in select * from private.share_match(pp.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id) m where m.rule_type = 'pct' loop
          v_ded := private.share_ded(pp.clinic_id, rl);
          mat := case when (v_ded->>'material')::boolean then a.material_cost_cents else 0 end;
          base := greatest(g - case when (v_ded->>'fee')::boolean then fee else 0 end - case when (v_ded->>'tax')::boolean then tax else 0 end - mat, 0);
          v_key := 'pct:' || pp.id || ':' || a.id || ':' || p.professional_id || ':' || p.role || ':' || rl.id || ':' || v_period;
          v_pct := (select l.pct from public.fin_share_lines l where l.line_key = v_key order by l.created_at, l.id limit 1);
          if v_pct is null then
            if rl.tiers is null then v_pct := rl.pct;
            else
              v_scope := coalesce(rl.tier_scope, st.tier_base, 'organization');
              select coalesce(sum(l.base_cents), 0) into v_cumb from public.fin_share_lines l
               where l.rule_id = rl.id and l.period = v_period and l.line_type = 'pct' and (v_scope = 'organization' or l.unit_id is not distinct from a.unit_id);
              v_pct := private.share_tier_pct(rl.tiers, v_cumb + base);
            end if;
          end if;
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'key', v_key, 'unit_id', a.unit_id, 'professional_id', p.professional_id, 'role', p.role, 'rule_id', rl.id, 'line_type', 'pct', 'period', v_period,
            'source_date', v_rel, 'appointment_id', a.id, 'sale_id', pp.sale_id, 'sale_item_id', pp.sale_item_id,
            'gross', g, 'base', base, 'pct', v_pct, 'amount', round(base::numeric * v_pct / 100)::bigint,
            'memory', jsonb_build_object('origin', 'pacote', 'package', pp.name, 'service', sv.name, 'category', sv.category, 'performed_on', a.performed_on, 'released_on', v_rel,
              'gross_cents', g, 'fee_cents', fee, 'fee_effective_pct', round(v_ratio * 100, 4), 'tax_cents', tax, 'tax_pct', v_taxpct, 'material_cents', mat, 'deductions', v_ded,
              'covered_cumulative_cents', round(v_cumval), 'rule', jsonb_build_object('id', rl.id, 'type', rl.rule_type, 'target', rl.target_type, 'pct', rl.pct, 'tiers', rl.tiers, 'valid_from', rl.valid_from),
              'formula', format('sessão rateada %s − taxa efetiva %s − imposto %s − material %s = base %s; repasse = base × %s%%',
                                g, case when (v_ded->>'fee')::boolean then fee else 0 end, case when (v_ded->>'tax')::boolean then tax else 0 end, mat, base, v_pct))));
        end loop;
      end loop;

    else  -- entrega (ou devolução) de item do pacote: só comissão para quem vendeu/indicou
      select * into si from public.stock_items where id = u.stock_item_id;
      v_med_ok := si.item_type not in ('medication','compounded')
                  or exists (select 1 from public.fin_compliance_acceptances c where c.clinic_id = pp.clinic_id and c.type = 'commission_on_medication');
      continue when not v_med_ok;
      v_cost := coalesce((select -sum(m.total_cost_cents) from public.stock_movements m where m.id = any (u.stock_movement_ids)), 0);
      g := u.value_cents; fee := round(g * v_ratio)::bigint;
      for v_pro in select distinct x from unnest(array[s.seller_professional_id, s.referrer_professional_id]) x where x is not null loop
        for rl in select * from private.share_match_commission(pp.clinic_id, v_pro, u.stock_item_id, v_sale_date, pp.unit_id) loop
          base := g - fee - case when rl.commission_base = 'margin' then v_cost else 0 end;
          v_amt := case when rl.pct is not null then round(base::numeric * rl.pct / 100)::bigint else round(rl.amount_cents::numeric * u.qty)::bigint end;
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'key', 'cm:' || u.lid || ':' || v_pro || ':' || rl.id || ':' || v_period, 'unit_id', pp.unit_id, 'professional_id', v_pro, 'role', 'vendedor', 'rule_id', rl.id,
            'line_type', 'commission', 'period', v_period, 'source_date', v_rel, 'sale_id', pp.sale_id, 'sale_item_id', pp.sale_item_id,
            'gross', g, 'base', base, 'pct', rl.pct, 'amount', v_amt,
            'memory', jsonb_build_object('origin', 'pacote', 'package', pp.name, 'item', u.item_name, 'kind', u.kind, 'released_on', v_rel, 'gross_cents', g, 'fee_cents', fee,
              'commission_base', rl.commission_base, 'rule', jsonb_build_object('id', rl.id, 'type', rl.rule_type, 'pct', rl.pct, 'amount_cents', rl.amount_cents, 'valid_from', rl.valid_from),
              'formula', case when rl.pct is not null then format('base = %s − taxa efetiva %s; comissão = base × %s%%', g, fee, rl.pct) else format('R$ %s por unidade × %s', rl.amount_cents, u.qty) end)));
        end loop;
      end loop;
    end if;
  end loop;
  return v_out;
end $$;

-- 5.3 Atendimento: fixo por execução (D7) — entra no mês da execução, independe de o paciente ter pago.
create or replace function private.share_build_appt_fixed(p_appt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.fin_appointments; sv public.fin_services; p record; rl public.fin_share_rules; v_out jsonb := '[]'::jsonb; v_none boolean;
begin
  select * into a from public.fin_appointments where id = p_appt;
  if a.id is null or a.status <> 'done' then return v_out; end if;
  select * into sv from public.fin_services where id = a.service_id;
  for p in select * from public.fin_appointment_participants where appointment_id = a.id order by position loop
    v_none := exists (select 1 from private.share_match(a.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id) m where m.rule_type = 'none');
    continue when v_none;
    for rl in select * from private.share_match(a.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id) m where m.rule_type = 'fixed_per_exec' loop
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'key', 'fx:' || a.id || ':' || p.professional_id || ':' || p.role || ':' || rl.id, 'unit_id', a.unit_id, 'professional_id', p.professional_id, 'role', p.role, 'rule_id', rl.id,
        'line_type', 'fixed_exec', 'period', private.share_period(a.performed_on), 'source_date', a.performed_on, 'appointment_id', a.id, 'sale_id', a.sale_id, 'sale_item_id', a.sale_item_id,
        'base', null, 'pct', null, 'amount', rl.amount_cents,
        'memory', jsonb_build_object('origin', 'execucao', 'service', sv.name, 'category', sv.category, 'performed_on', a.performed_on,
          'rule', jsonb_build_object('id', rl.id, 'type', rl.rule_type, 'target', rl.target_type, 'amount_cents', rl.amount_cents, 'valid_from', rl.valid_from),
          'formula', format('fixo por execução R$ %s (mês da execução)', rl.amount_cents))));
    end loop;
  end loop;
  return v_out;
end $$;

-- ---------- 6. Reconciliação idempotente ----------
-- Compara o que deve existir (p_desired) com a soma do que existe por chave e grava SÓ a diferença, como linha nova (nunca altera nem apaga).
-- Mês de origem aberto: a diferença cai nele (equivale a recalcular a linha). Mês travado: tipo «adjustment» no próximo mês aberto, com referência à origem.
create or replace function private.share_apply(p_clinic uuid, p_scope_type text, p_scope_id uuid, p_desired jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  k text; d jsonb; f public.fin_share_lines; ex_base bigint; ex_amt bigint; ex_gross bigint; d_base bigint; d_amt bigint; d_gross bigint; v_n integer := 0;
  v_period text; v_origin text; v_type text; v_kind text; v_mem jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_scope_type || ':' || p_scope_id::text, 5));
  for k in
    select distinct l.line_key from public.fin_share_lines l where l.scope_type = p_scope_type and l.scope_id = p_scope_id
    union
    select e->>'key' from jsonb_array_elements(coalesce(p_desired, '[]'::jsonb)) e
  loop
    select e into d from jsonb_array_elements(coalesce(p_desired, '[]'::jsonb)) e where e->>'key' = k limit 1;
    select coalesce(sum(l.base_cents), 0), coalesce(sum(l.amount_cents), 0), coalesce(sum(l.gross_cents), 0) into ex_base, ex_amt, ex_gross from public.fin_share_lines l where l.line_key = k;
    d_base := coalesce((d->>'base')::bigint, 0); d_amt := coalesce((d->>'amount')::bigint, 0); d_gross := coalesce((d->>'gross')::bigint, 0);
    continue when d_base = ex_base and d_amt = ex_amt and d_gross = ex_gross;
    select * into f from public.fin_share_lines l where l.line_key = k order by l.created_at, l.id limit 1;
    if f.id is null then
      v_origin := d->>'period'; v_period := private.share_target_period(p_clinic, v_origin); v_type := d->>'line_type'; v_kind := 'original';
      v_mem := coalesce(d->'memory', '{}'::jsonb);
      insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, scope_id, line_key, source_date, appointment_id, sale_id, sale_item_id, receivable_id,
          rule_id, gross_cents, base_cents, pct, amount_cents, origin_period, kind, reason, memory, created_by)
        values (p_clinic, nullif(d->>'unit_id', '')::uuid, (d->>'professional_id')::uuid, v_period, v_type, d->>'role', p_scope_type, p_scope_id, k, nullif(d->>'source_date', '')::date,
          nullif(d->>'appointment_id', '')::uuid, nullif(d->>'sale_id', '')::uuid, nullif(d->>'sale_item_id', '')::uuid, nullif(d->>'receivable_id', '')::uuid,
          nullif(d->>'rule_id', '')::uuid, d_gross, nullif(d->>'base', '')::bigint, nullif(d->>'pct', '')::numeric, d_amt, v_origin, v_kind, p_reason,
          v_mem || case when v_period <> v_origin then jsonb_build_object('late_release', jsonb_build_object('wanted_period', v_origin, 'reason', 'mês de origem travado')) else '{}'::jsonb end,
          private.current_profile_id());
    else
      v_origin := coalesce(f.origin_period, f.period); v_period := private.share_target_period(p_clinic, v_origin);
      v_type := case when v_period = v_origin then f.line_type else 'adjustment' end;
      v_mem := coalesce(d->'memory', f.memory) || jsonb_build_object('correction', jsonb_build_object(
        'reason', p_reason, 'previous_base', ex_base, 'previous_amount', ex_amt, 'new_base', d_base, 'new_amount', d_amt, 'origin_period', v_origin, 'origin_line_id', f.id,
        'original_type', f.line_type, 'origin_appointment_id', f.appointment_id, 'origin_receivable_id', f.receivable_id));
      insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, scope_id, line_key, source_date, appointment_id, sale_id, sale_item_id, receivable_id,
          rule_id, gross_cents, base_cents, pct, amount_cents, origin_period, origin_line_id, kind, reason, memory, created_by)
        values (p_clinic, f.unit_id, f.professional_id, v_period, v_type, f.role, p_scope_type, p_scope_id, k, coalesce(nullif(d->>'source_date', '')::date, f.source_date), f.appointment_id, f.sale_id, f.sale_item_id, f.receivable_id,
          f.rule_id, d_gross - ex_gross, case when f.base_cents is null and d->>'base' is null then null else d_base - ex_base end, f.pct, d_amt - ex_amt, v_origin, f.id, 'correction', p_reason, v_mem, private.current_profile_id());
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function private.share_reconcile_sale(p_sale uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare s public.fin_sales; it record; pp record; v_n integer := 0;
begin
  select * into s from public.fin_sales where id = p_sale;
  if s.id is null then return 0; end if;
  for it in select i.id from public.fin_sale_items i where i.sale_id = s.id and i.item_type in ('service','product','compounded') loop
    v_n := v_n + private.share_apply(s.clinic_id, 'sale_item', it.id, private.share_build_sale_item(it.id), p_reason);
  end loop;
  for pp in select p.id from public.fin_patient_packages p where p.sale_id = s.id loop
    v_n := v_n + private.share_apply(s.clinic_id, 'package', pp.id, private.share_build_pkg(pp.id), p_reason);
  end loop;
  return v_n;
end $$;

create or replace function private.share_reconcile_pkg(p_pp uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare pp public.fin_patient_packages;
begin
  select * into pp from public.fin_patient_packages where id = p_pp;
  if pp.id is null then return 0; end if;
  return private.share_apply(pp.clinic_id, 'package', pp.id, private.share_build_pkg(pp.id), p_reason);
end $$;

create or replace function private.share_reconcile_appt(p_appt uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.fin_appointments; v_n integer := 0; v_pp uuid;
begin
  select * into a from public.fin_appointments where id = p_appt;
  if a.id is null then return 0; end if;
  v_n := private.share_apply(a.clinic_id, 'appointment', a.id, private.share_build_appt_fixed(a.id), p_reason);
  if a.sale_item_id is not null then
    v_n := v_n + private.share_apply(a.clinic_id, 'sale_item', a.sale_item_id, private.share_build_sale_item(a.sale_item_id), p_reason);
  end if;
  if a.patient_package_item_id is not null then
    select pi.patient_package_id into v_pp from public.fin_patient_package_items pi where pi.id = a.patient_package_item_id;
    v_n := v_n + private.share_reconcile_pkg(v_pp, p_reason);
  end if;
  return v_n;
end $$;

-- ---------- 7. Gatilhos: o repasse acompanha o que acontece (sem nunca bloquear venda, recebimento ou atendimento) ----------
create or replace function private.share_handle_event(e public.fin_events) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; v_pp uuid; v_reason text;
begin
  v_reason := case e.event_type
    when 'appointment_done' then 'Atendimento realizado' when 'appointment_canceled' then 'Atendimento cancelado'
    when 'appointment_material_adjusted' then 'Custo do material ajustado' when 'appointment_participants_changed' then 'Participantes do atendimento alterados'
    when 'package_item_delivered' then 'Entrega de item do pacote' when 'package_item_returned' then 'Devolução de item do pacote'
    when 'sale_canceled' then 'Venda cancelada' when 'stock_shortfall' then 'Consumo sem saldo' else e.event_type end;
  if e.event_type in ('appointment_done','appointment_canceled','appointment_material_adjusted','appointment_participants_changed','stock_shortfall') then
    if nullif(e.payload->>'appointment_id', '') is not null then v_n := private.share_reconcile_appt((e.payload->>'appointment_id')::uuid, v_reason); end if;
  elsif e.event_type in ('package_item_delivered','package_item_returned') then
    select pi.patient_package_id into v_pp from public.fin_patient_package_items pi where pi.id = nullif(e.payload->>'patient_package_item_id', '')::uuid;
    if v_pp is not null then v_n := private.share_reconcile_pkg(v_pp, v_reason); end if;
  elsif e.event_type = 'sale_canceled' and e.sale_id is not null then
    v_n := private.share_reconcile_sale(e.sale_id, v_reason);
  end if;
  return v_n;
end $$;

create or replace function private.share_trg_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.share_handle_event(new);
    update public.fin_events set processed_at = now() where id = new.id and processed_at is null;
  exception when others then
    perform private.fin_log(new.clinic_id, new.unit_id, 'share_engine', new.id, 'update', null,
      jsonb_build_object('event_type', new.event_type, 'error', sqlerrm), 'Erro no cálculo do repasse; o financeiro pode usar «Recalcular»');
  end;
  return new;
end $$;
drop trigger if exists trg_share_event on public.fin_events;
create trigger trg_share_event after insert on public.fin_events for each row execute function private.share_trg_event();

create or replace function private.share_trg_sale_side() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sale uuid; v_clinic uuid; v_unit uuid;
begin
  if tg_table_name = 'fin_sales' then v_sale := new.id; else v_sale := new.sale_id; end if;
  begin
    perform private.share_reconcile_sale(v_sale, case when tg_table_name = 'fin_sales' then 'Venda alterada ou cancelada' else 'Título liquidado, estornado ou corrigido' end);
  exception when others then
    select s.clinic_id, s.unit_id into v_clinic, v_unit from public.fin_sales s where s.id = v_sale;
    perform private.fin_log(v_clinic, v_unit, 'share_engine', v_sale, 'update', null, jsonb_build_object('table', tg_table_name, 'error', sqlerrm),
      'Erro no cálculo do repasse; o financeiro pode usar «Recalcular»');
  end;
  return new;
end $$;
drop trigger if exists trg_share_receivable on public.fin_receivables;
create trigger trg_share_receivable after update on public.fin_receivables for each row
  when (old.status is distinct from new.status or old.settled_date is distinct from new.settled_date or old.settled_net_cents is distinct from new.settled_net_cents)
  execute function private.share_trg_sale_side();
-- depois que o recebimento e a alocação entre os itens estão gravados (fin_sale_recalc atualiza a venda no fim)
drop trigger if exists trg_share_sale on public.fin_sales;
create trigger trg_share_sale after update on public.fin_sales for each row
  when (old.status is distinct from new.status or old.paid_cents is distinct from new.paid_cents)
  execute function private.share_trg_sale_side();

-- ---------- 8. Prévia do mês por profissional (§5.9): linhas do mês + faixa + fixo mensal + garantia + comissões + taxa de uso + ajustes − retenções ----------
create or replace function private.share_month_calc(p_clinic uuid, p_prof uuid, p_period text, p_carry bigint, p_bal jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := private.share_period_start(p_period); v_end date := (private.share_period_start(p_period) + interval '1 month - 1 day')::date; v_dim integer;
  v_tb text; r record; rl public.fin_share_rules; v_derived jsonb := '[]'::jsonb;
  v_pct bigint; v_fx bigint; v_comm bigint; v_adj bigint; v_liq bigint; v_tier bigint := 0; v_fm bigint := 0; v_guar bigint := 0; v_usage bigint := 0;
  v_bal jsonb := coalesce(p_bal, '{}'::jsonb); v_variable bigint; v_b bigint; v_comp bigint; v_exc bigint; v_abate bigint; v_days integer; v_amt bigint; v_prog bigint; v_adjt bigint;
  v_gross bigint; fin public.fin_professional_finance; v_w jsonb := '[]'::jsonb; v_wt bigint := 0; w record; v_wamt bigint; v_net bigint;
begin
  v_dim := (v_end - v_start) + 1;
  select s.tier_base into v_tb from public.fin_settings s where s.clinic_id = p_clinic;
  select coalesce(sum(l.amount_cents) filter (where l.line_type = 'pct'), 0), coalesce(sum(l.amount_cents) filter (where l.line_type = 'fixed_exec'), 0),
         coalesce(sum(l.amount_cents) filter (where l.line_type = 'commission'), 0), coalesce(sum(l.amount_cents) filter (where l.line_type = 'adjustment'), 0),
         coalesce(sum(l.gross_cents) filter (where l.line_type = 'pct'), 0)
    into v_pct, v_fx, v_comm, v_adj, v_liq
    from public.fin_share_lines l where l.clinic_id = p_clinic and l.professional_id = p_prof and l.period = p_period;

  -- 1b. ajuste de faixa (D26, Exemplo G): total recalculado de forma progressiva − o que as linhas já somam
  for r in
    select l.rule_id, ru.tiers, coalesce(sum(l.base_cents), 0)::bigint as b, coalesce(sum(l.amount_cents), 0)::bigint as a
      from public.fin_share_lines l join public.fin_share_rules ru on ru.id = l.rule_id
     where l.clinic_id = p_clinic and l.professional_id = p_prof and l.period = p_period and l.line_type = 'pct' and ru.tiers is not null
     group by l.rule_id, ru.tiers, case when coalesce(ru.tier_scope, v_tb, 'organization') = 'unit' then l.unit_id end
  loop
    v_prog := private.share_tier_progressive(r.tiers, r.b); v_adjt := v_prog - r.a;
    if v_adjt <> 0 then
      v_tier := v_tier + v_adjt;
      v_derived := v_derived || jsonb_build_array(jsonb_build_object('line_type', 'tier_adjust', 'amount_cents', v_adjt, 'rule_id', r.rule_id, 'base_cents', r.b,
        'memory', jsonb_build_object('progressive_cents', v_prog, 'lines_cents', r.a, 'tiers', r.tiers, 'formula', format('progressivo sobre base %s = %s; linhas já somam %s; ajuste de faixa %s', r.b, v_prog, r.a, v_adjt))));
    end if;
  end loop;

  -- 3. fixo mensal proporcional aos dias de vigência (§5.3)
  for rl in select * from public.fin_share_rules x where x.clinic_id = p_clinic and x.professional_id = p_prof and x.rule_type = 'fixed_monthly' and x.is_active
                and x.valid_from <= v_end and coalesce(x.valid_to, v_end) >= v_start order by x.valid_from loop
    v_days := (least(coalesce(rl.valid_to, v_end), v_end) - greatest(rl.valid_from, v_start)) + 1;
    v_amt := round(rl.amount_cents::numeric * v_days / v_dim)::bigint;
    v_fm := v_fm + v_amt;
    v_derived := v_derived || jsonb_build_array(jsonb_build_object('line_type', 'fixed_monthly', 'amount_cents', v_amt, 'rule_id', rl.id,
      'memory', jsonb_build_object('days', v_days, 'days_in_month', v_dim, 'rule_amount_cents', rl.amount_cents, 'formula', format('fixo mensal R$ %s × %s/%s dias de vigência', rl.amount_cents, v_days, v_dim))));
  end loop;

  -- 4. garantia mínima (D25, Exemplo F): compara percentual + faixa + fixo por execução com o piso; compensação opcional
  v_variable := v_pct + v_tier + v_fx;
  for rl in select * from public.fin_share_rules x where x.clinic_id = p_clinic and x.professional_id = p_prof and x.rule_type = 'min_guarantee' and x.is_active
                and x.valid_from <= v_end and coalesce(x.valid_to, v_end) >= v_start order by x.valid_from loop
    v_b := coalesce((v_bal->>rl.id::text)::bigint, 0);
    v_comp := greatest(rl.amount_cents - v_variable, 0);
    if v_comp > 0 then
      v_guar := v_guar + v_comp;
      if rl.compensation then v_b := v_b + v_comp; end if;
      v_derived := v_derived || jsonb_build_array(jsonb_build_object('line_type', 'guarantee', 'amount_cents', v_comp, 'rule_id', rl.id,
        'memory', jsonb_build_object('floor_cents', rl.amount_cents, 'variable_cents', v_variable, 'compensation', rl.compensation, 'balance_to_compensate_cents', v_b,
          'formula', format('complemento = piso %s − (percentual + fixo por execução) %s', rl.amount_cents, v_variable))));
    elsif rl.compensation and v_b > 0 then
      v_exc := v_variable - rl.amount_cents; v_abate := least(v_b, v_exc);
      if v_abate > 0 then
        v_b := v_b - v_abate; v_guar := v_guar - v_abate;
        v_derived := v_derived || jsonb_build_array(jsonb_build_object('line_type', 'guarantee', 'amount_cents', -v_abate, 'rule_id', rl.id,
          'memory', jsonb_build_object('floor_cents', rl.amount_cents, 'variable_cents', v_variable, 'compensation', true, 'balance_to_compensate_cents', v_b,
            'formula', format('excedente sobre o piso %s abate o saldo a compensar: −%s', v_exc, v_abate))));
      end if;
    end if;
    v_bal := v_bal || jsonb_build_object(rl.id::text, v_b);
  end loop;

  -- 6. taxa de uso (D27, Exemplo H): linha negativa, só para quem tem a regra cadastrada
  for rl in select * from public.fin_share_rules x where x.clinic_id = p_clinic and x.professional_id = p_prof and x.rule_type = 'usage_fee' and x.is_active
                and x.valid_from <= v_end and coalesce(x.valid_to, v_end) >= v_start order by x.valid_from loop
    v_amt := case when rl.usage_fee_mode = 'fixed' then rl.amount_cents else round(v_liq::numeric * rl.pct / 100)::bigint end;
    v_usage := v_usage - v_amt;
    v_derived := v_derived || jsonb_build_array(jsonb_build_object('line_type', 'usage_fee', 'amount_cents', -v_amt, 'rule_id', rl.id,
      'memory', jsonb_build_object('mode', rl.usage_fee_mode, 'liquidated_cents', v_liq, 'formula',
        case when rl.usage_fee_mode = 'fixed' then format('taxa de uso fixa R$ %s', rl.amount_cents) else format('taxa de uso %s%% do liquidado %s', rl.pct, v_liq) end)));
  end loop;

  -- 7. ajustes: saldo negativo trazido do mês anterior (§5.6) + estornos de mês travado (já gravados como 'adjustment')
  if coalesce(p_carry, 0) <> 0 then
    v_derived := v_derived || jsonb_build_array(jsonb_build_object('line_type', 'adjustment', 'amount_cents', p_carry,
      'memory', jsonb_build_object('carried_negative', true, 'formula', 'saldo negativo do mês anterior levado a este mês')));
  end if;

  v_gross := v_pct + v_tier + v_fx + v_fm + v_guar + v_comm + v_usage + v_adj + coalesce(p_carry, 0);

  -- 8. retenções (§5.8): sobre o total bruto positivo; dispensa para optante pelo Simples (por tipo)
  select * into fin from public.fin_professional_finance f where f.professional_id = p_prof;
  if v_gross > 0 then
    for w in select * from public.fin_withholding_rules x where x.professional_id = p_prof and x.is_active and x.valid_from <= v_end and coalesce(x.valid_to, v_end) >= v_start order by x.rule_type, x.valid_from, x.id loop
      if coalesce(fin.simples_optant, false) and w.waive_if_simples then
        v_w := v_w || jsonb_build_array(jsonb_build_object('rule_type', w.rule_type, 'label', w.label, 'rate_pct', w.rate_pct, 'amount_cents', 0, 'waived', 'simples'));
      elsif v_gross < w.min_base_cents then
        v_w := v_w || jsonb_build_array(jsonb_build_object('rule_type', w.rule_type, 'label', w.label, 'rate_pct', w.rate_pct, 'amount_cents', 0, 'waived', 'min_base'));
      else
        v_wamt := round(v_gross::numeric * w.rate_pct / 100)::bigint; v_wt := v_wt + v_wamt;
        v_w := v_w || jsonb_build_array(jsonb_build_object('rule_type', w.rule_type, 'label', w.label, 'rate_pct', w.rate_pct, 'amount_cents', v_wamt, 'waived', null));
      end if;
    end loop;
  end if;
  v_net := case when v_gross > 0 then v_gross - v_wt else 0 end;
  return jsonb_build_object('period', p_period, 'professional_id', p_prof,
    'persisted', jsonb_build_object('pct', v_pct, 'fixed_exec', v_fx, 'commission', v_comm, 'adjustment', v_adj, 'liquidated_cents', v_liq),
    'derived', v_derived, 'tier_adjust_cents', v_tier, 'fixed_monthly_cents', v_fm, 'guarantee_cents', v_guar, 'usage_fee_cents', v_usage, 'carry_in_cents', coalesce(p_carry, 0),
    'gross_total_cents', v_gross, 'withholdings', v_w, 'withholding_total_cents', v_wt, 'net_total_cents', v_net,
    'negative', v_gross < 0, 'balances', v_bal);
end $$;

-- Itera os meses desde o primeiro movimento do profissional (saldo de garantia e saldo negativo são acumulados mês a mês).
create or replace function private.share_month(p_clinic uuid, p_prof uuid, p_period text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_first text; v_cur date; v_end date := private.share_period_start(p_period); m text; v_carry bigint := 0; v_bal jsonb := '{}'::jsonb; res jsonb;
begin
  select min(l.period) into v_first from public.fin_share_lines l where l.clinic_id = p_clinic and l.professional_id = p_prof;
  select least(coalesce(v_first, p_period), coalesce(min(private.share_period(x.valid_from)), p_period)) into v_first
    from public.fin_share_rules x where x.clinic_id = p_clinic and x.professional_id = p_prof and x.is_active and x.rule_type in ('fixed_monthly','min_guarantee','usage_fee');
  v_cur := greatest(private.share_period_start(least(v_first, p_period)), (v_end - interval '36 months')::date);
  loop
    m := private.share_period(v_cur);
    res := private.share_month_calc(p_clinic, p_prof, m, v_carry, v_bal);
    v_carry := case when (res->>'gross_total_cents')::bigint < 0 then (res->>'gross_total_cents')::bigint else 0 end;
    v_bal := res->'balances';
    exit when v_cur >= v_end;
    v_cur := (v_cur + interval '1 month')::date;
  end loop;
  return res;
end $$;

-- Quem o chamador pode ver: todos (Gestor, Financeiro, Admin) ou só os próprios (profissional clínico). Recepção/Estoquista: nada.
create or replace function private.share_view_scope(p_clinic uuid, out v_all boolean, out v_self uuid[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_all := private.fin_can(p_clinic, 'share_lines', null, false);
  v_self := '{}';
  if not v_all then
    if not private.appt_is_pro(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
    select coalesce(array_agg(pr.id), '{}') into v_self from public.professionals pr
     where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  end if;
end $$;

-- ---------- 9. RPCs de leitura ----------
create or replace function public.fin_share_context(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_set public.fin_settings;
begin
  perform private.fin_gate(p_clinic, 'share_rules', null, false);
  select * into v_set from public.fin_settings where clinic_id = p_clinic;
  return jsonb_build_object(
    'can_write', private.fin_can(p_clinic, 'share_rules', null, true), 'is_owner', private.is_clinic_admin(p_clinic),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(pf.full_name, 'Profissional')) order by pf.full_name)
                                 from public.professionals pr left join public.profiles pf on pf.id = pr.profile_id
                                where pr.clinic_id = p_clinic and coalesce(pr.status, 'active') = 'active'), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category) order by s.name) from public.fin_services s where s.clinic_id = p_clinic and s.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'item_type', i.item_type) order by i.name) from public.stock_items i where i.clinic_id = p_clinic and i.is_active and (i.sellable or i.item_type in ('medication','compounded'))), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name) from public.clinic_units u where u.clinic_id = p_clinic and u.is_active), '[]'::jsonb),
    'settings', jsonb_build_object('deduct_fee', coalesce(v_set.deduct_fee, true), 'deduct_tax', coalesce(v_set.deduct_tax, false), 'deduct_material', coalesce(v_set.deduct_material, false), 'tier_base', coalesce(v_set.tier_base, 'organization')),
    'tax_pct', private.share_tax_pct(p_clinic, private.share_period(private.fin_today()), null));
end $$;

create or replace function public.fin_share_rules_list(p_clinic uuid, p_professional uuid default null, p_include_inactive boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'share_rules', null, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'professional_id', r.professional_id, 'professional_name', coalesce(pf.full_name, 'Profissional'), 'role', r.role, 'target_type', r.target_type,
      'service_id', r.service_id, 'service_name', sv.name, 'category', r.category, 'stock_item_id', r.stock_item_id, 'item_name', si.name, 'item_type', si.item_type,
      'rule_type', r.rule_type, 'pct', r.pct, 'amount_cents', r.amount_cents, 'tiers', r.tiers, 'tier_scope', r.tier_scope, 'compensation', r.compensation,
      'usage_fee_mode', r.usage_fee_mode, 'commission_base', r.commission_base, 'deductions_override', r.deductions_override, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids),
      'valid_from', r.valid_from, 'valid_to', r.valid_to, 'is_active', r.is_active, 'notes', r.notes, 'created_at', r.created_at,
      'in_use', exists (select 1 from public.fin_share_lines l where l.rule_id = r.id))
      order by pf.full_name, r.rule_type, r.valid_from desc)
      from public.fin_share_rules r
      join public.professionals pr on pr.id = r.professional_id left join public.profiles pf on pf.id = pr.profile_id
      left join public.fin_services sv on sv.id = r.service_id left join public.stock_items si on si.id = r.stock_item_id
     where r.clinic_id = p_clinic and (p_professional is null or r.professional_id = p_professional) and (coalesce(p_include_inactive, false) or r.is_active)), '[]'::jsonb);
end $$;

create or replace function public.fin_share_lines_list(p_clinic uuid, p_professional uuid default null, p_period text default null, p_unit uuid default null,
                                                       p_limit integer default 300, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean; v_self uuid[]; v_disp text;
begin
  select * into v_all, v_self from private.share_view_scope(p_clinic);
  if not v_all and p_professional is not null and not (p_professional = any (v_self)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(patient_display, 'initials') into v_disp from public.fin_settings where clinic_id = p_clinic;
  return coalesce((
    select jsonb_agg(q.x order by q.sort_period desc, q.sort_date desc nulls last, q.sort_created desc) from (
      select jsonb_build_object(
        'id', l.id, 'professional_id', l.professional_id, 'professional_name', coalesce(pf.full_name, 'Profissional'), 'period', l.period, 'line_type', l.line_type, 'role', l.role,
        'kind', l.kind, 'base_cents', l.base_cents, 'gross_cents', l.gross_cents, 'pct', l.pct, 'amount_cents', l.amount_cents, 'source_date', l.source_date, 'origin_period', l.origin_period,
        'reason', l.reason, 'created_at', l.created_at, 'appointment_id', l.appointment_id, 'unit_name', u.name, 'service_name', l.memory->>'service', 'memory', l.memory,
        'patient', case coalesce(v_disp, 'initials') when 'hidden' then null when 'full' then ppf.full_name else private.share_initials(ppf.full_name) end) as x,
        l.period as sort_period, l.source_date as sort_date, l.created_at as sort_created
        from public.fin_share_lines l
        join public.professionals pr on pr.id = l.professional_id left join public.profiles pf on pf.id = pr.profile_id
        left join public.clinic_units u on u.id = l.unit_id
        left join public.fin_appointments a on a.id = l.appointment_id left join public.fin_sales s on s.id = l.sale_id
        left join public.patients pt on pt.id = coalesce(a.patient_id, s.patient_id) left join public.profiles ppf on ppf.id = pt.profile_id
       where l.clinic_id = p_clinic and (p_professional is null or l.professional_id = p_professional) and (p_period is null or l.period = p_period) and (p_unit is null or l.unit_id = p_unit)
         and (v_all or l.professional_id = any (v_self))
       order by l.period desc, l.source_date desc nulls last, l.created_at desc
       limit least(greatest(coalesce(p_limit, 300), 1), 1000) offset greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb);
end $$;

create or replace function public.fin_share_month(p_clinic uuid, p_professional uuid default null, p_period text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean; v_self uuid[]; v_pro uuid := p_professional; v_period text := coalesce(p_period, private.share_period(private.fin_today()));
begin
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  select * into v_all, v_self from private.share_view_scope(p_clinic);
  if not v_all then
    if v_pro is null then v_pro := v_self[1]; end if;
    if v_pro is null or not (v_pro = any (v_self)) then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif v_pro is null then raise exception 'INVALID_PROFESSIONAL' using errcode = '22023';
  elsif not exists (select 1 from public.professionals pr where pr.id = v_pro and pr.clinic_id = p_clinic) then raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.share_month(p_clinic, v_pro, v_period) || jsonb_build_object('locked', private.share_locked(p_clinic, v_period));
end $$;

-- Totais do mês de todos os profissionais (Gestor/Financeiro): base do alerta de saldo negativo (F6) e do fechamento (Entrega 6).
create or replace function public.fin_share_month_all(p_clinic uuid, p_period text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_period text := coalesce(p_period, private.share_period(private.fin_today())); pr record; r jsonb; v_out jsonb := '[]'::jsonb;
begin
  perform private.fin_gate(p_clinic, 'share_lines', null, false);
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  for pr in
    select p.id, coalesce(pf.full_name, 'Profissional') as name from public.professionals p left join public.profiles pf on pf.id = p.profile_id
     where p.clinic_id = p_clinic and (exists (select 1 from public.fin_share_lines l where l.professional_id = p.id and l.period <= v_period)
           or exists (select 1 from public.fin_share_rules x where x.professional_id = p.id and x.is_active and x.rule_type in ('fixed_monthly','min_guarantee','usage_fee')))
     order by pf.full_name
  loop
    r := private.share_month(p_clinic, pr.id, v_period);
    v_out := v_out || jsonb_build_array(jsonb_build_object('professional_id', pr.id, 'name', pr.name, 'gross_total_cents', r->'gross_total_cents', 'withholding_total_cents', r->'withholding_total_cents',
      'net_total_cents', r->'net_total_cents', 'negative', r->'negative', 'carry_in_cents', r->'carry_in_cents'));
  end loop;
  return jsonb_build_object('period', v_period, 'locked', private.share_locked(p_clinic, v_period), 'professionals', v_out,
    'unruled_count', (select count(*) from public.fin_appointment_participants p join public.fin_appointments a on a.id = p.appointment_id join public.fin_services sv on sv.id = a.service_id
                        where a.clinic_id = p_clinic and a.status = 'done' and private.share_period(a.performed_on) = v_period
                          and not exists (select 1 from private.share_match(a.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id))));
end $$;

-- Fila «sem regra» (§5.1 item 4, F2): participantes de atendimento realizado sem regra vigente. Bloqueia a aprovação do fechamento (Entrega 6).
create or replace function public.fin_share_unruled(p_clinic uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'share_lines', null, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object('appointment_id', a.id, 'performed_on', a.performed_on, 'service_name', a.service_name, 'professional_id', p.professional_id,
             'professional_name', coalesce(pf.full_name, 'Profissional'), 'role', p.role, 'unit_name', u.name) order by a.performed_on desc, a.created_at desc)
      from public.fin_appointment_participants p
      join public.fin_appointments a on a.id = p.appointment_id join public.fin_services sv on sv.id = a.service_id
      join public.professionals pr on pr.id = p.professional_id left join public.profiles pf on pf.id = pr.profile_id join public.clinic_units u on u.id = a.unit_id
     where a.clinic_id = p_clinic and a.status = 'done' and (p_from is null or a.performed_on >= p_from) and (p_to is null or a.performed_on <= p_to)
       and not exists (select 1 from private.share_match(a.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id))), '[]'::jsonb);
end $$;

-- Relatório de comissão sobre Medicação/Manipulado (§5.5, D12).
create or replace function public.fin_share_med_commissions(p_clinic uuid, p_period text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'share_lines', null, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object('line_id', l.id, 'period', l.period, 'professional_name', coalesce(pf.full_name, 'Profissional'), 'item_name', coalesce(l.memory->>'item', '—'),
             'item_type', l.memory->>'item_type', 'amount_cents', l.amount_cents, 'kind', l.kind) order by l.period desc, l.created_at desc)
      from public.fin_share_lines l join public.professionals pr on pr.id = l.professional_id left join public.profiles pf on pf.id = pr.profile_id
     where l.clinic_id = p_clinic and l.line_type = 'commission' and (p_period is null or l.period = p_period)
       and coalesce(l.memory->>'item_type', (select i.item_type from public.fin_sale_items si2 join public.stock_items i on i.id = si2.stock_item_id where si2.id = l.sale_item_id)) in ('medication','compounded')), '[]'::jsonb);
end $$;

-- ---------- 10. RPCs de escrita ----------
create or replace function public.fin_share_rule_save(p_clinic uuid, p_id uuid, p_data jsonb, p_reason text default null, p_accept_medication boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.fin_share_rules; n public.fin_share_rules; v_pro uuid := nullif(p_data->>'professional_id', '')::uuid; v_type text := p_data->>'rule_type'; v_role text := nullif(p_data->>'role', '');
  v_target text := coalesce(nullif(p_data->>'target_type', ''), 'default'); v_svc uuid := nullif(p_data->>'service_id', '')::uuid; v_cat text := nullif(p_data->>'category', '');
  v_item uuid := nullif(p_data->>'stock_item_id', '')::uuid; v_pct numeric := nullif(p_data->>'pct', '')::numeric; v_amt integer := nullif(p_data->>'amount_cents', '')::integer;
  v_tiers jsonb := case when jsonb_typeof(p_data->'tiers') = 'array' and jsonb_array_length(p_data->'tiers') > 0 then p_data->'tiers' end;
  v_from date := nullif(p_data->>'valid_from', '')::date; v_to date := nullif(p_data->>'valid_to', '')::date; v_all boolean := coalesce((p_data->>'all_units')::boolean, true); v_units uuid[];
  v_comp boolean := coalesce((p_data->>'compensation')::boolean, false); v_ded jsonb := case when jsonb_typeof(p_data->'deductions_override') = 'object' then p_data->'deductions_override' end;
  v_mode text := nullif(p_data->>'usage_fee_mode', ''); v_tscope text := nullif(p_data->>'tier_scope', ''); v_cbase text := coalesce(nullif(p_data->>'commission_base', ''), 'net_fee');
  v_notes text := nullif(btrim(coalesce(p_data->>'notes', '')), ''); t jsonb; v_prev bigint := 0; v_up bigint; i integer := 0; v_cnt integer; v_before jsonb;
  v_used boolean := false; v_lastuse date; v_si public.stock_items; v_warn jsonb := '[]'::jsonb; v_sum numeric; v_u uuid; v_action text;
begin
  perform private.fin_gate(p_clinic, 'share_rules', null, true);
  if not exists (select 1 from public.professionals pr where pr.id = v_pro and pr.clinic_id = p_clinic) then raise exception 'INVALID_PROFESSIONAL' using errcode = '22023'; end if;
  if v_type is null or v_type not in ('pct','fixed_per_exec','fixed_monthly','min_guarantee','product_commission','usage_fee','none') then raise exception 'INVALID_RULE_TYPE' using errcode = '22023'; end if;
  if v_from is null then raise exception 'INVALID_VALID_FROM' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from then raise exception 'INVALID_VALID_TO' using errcode = '22023'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p_data->'unit_ids', '[]'::jsonb)) x;
  if not v_all and (cardinality(v_units) = 0 or exists (select 1 from unnest(v_units) uid where not exists (select 1 from public.clinic_units cu where cu.id = uid and cu.clinic_id = p_clinic))) then
    raise exception 'INVALID_UNITS' using errcode = '22023';
  end if;
  if v_all then v_units := '{}'; end if;
  -- papel e alvo conforme o tipo
  if v_type in ('pct','fixed_per_exec','none') then
    if v_role is null or v_role not in ('responsavel','executor','auxiliar') then raise exception 'INVALID_ROLE' using errcode = '22023'; end if;
    if v_target not in ('service','category','default') then raise exception 'INVALID_TARGET' using errcode = '22023'; end if;
  elsif v_type = 'product_commission' then
    v_role := 'vendedor';
    if v_target not in ('item','default') then raise exception 'INVALID_TARGET' using errcode = '22023'; end if;
  else
    v_role := null; v_target := 'default';
  end if;
  if v_target = 'service' and not exists (select 1 from public.fin_services s where s.id = v_svc and s.clinic_id = p_clinic) then raise exception 'INVALID_SERVICE' using errcode = '22023'; end if;
  if v_target = 'category' and (v_cat is null or v_cat not in ('consulta','procedimento','aplicacao','avaliacao','sessao','outro')) then raise exception 'INVALID_CATEGORY' using errcode = '22023'; end if;
  if v_target = 'item' then
    select * into v_si from public.stock_items i where i.id = v_item and i.clinic_id = p_clinic;
    if v_si.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
  end if;
  if v_target <> 'service' then v_svc := null; end if;
  if v_target <> 'category' then v_cat := null; end if;
  if v_target <> 'item' then v_item := null; end if;
  -- valores conforme o tipo
  if v_type = 'pct' then
    if v_tiers is not null then
      v_pct := null; v_cnt := jsonb_array_length(v_tiers);
      if v_cnt < 2 then raise exception 'INVALID_TIERS' using errcode = '22023'; end if;
      for t in select e from jsonb_array_elements(v_tiers) e loop
        i := i + 1;
        if nullif(t->>'pct', '') is null or (t->>'pct')::numeric < 0 or (t->>'pct')::numeric > 100 then raise exception 'INVALID_TIERS' using errcode = '22023'; end if;
        if i < v_cnt then
          v_up := nullif(t->>'up_to_cents', '')::bigint;
          if v_up is null or v_up <= v_prev then raise exception 'INVALID_TIERS' using errcode = '22023'; end if;
          v_prev := v_up;
        elsif nullif(t->>'up_to_cents', '') is not null then raise exception 'INVALID_TIERS' using errcode = '22023';
        end if;
      end loop;
      v_amt := null;
    elsif v_pct is null or v_pct < 0 or v_pct > 100 then raise exception 'INVALID_PCT' using errcode = '22023';
    end if;
  elsif v_type in ('fixed_per_exec','fixed_monthly','min_guarantee') then
    if v_amt is null or v_amt < 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
    v_pct := null; v_tiers := null;
  elsif v_type = 'usage_fee' then
    if v_mode is null or v_mode not in ('fixed','pct') then raise exception 'INVALID_USAGE_MODE' using errcode = '22023'; end if;
    if v_mode = 'fixed' then if v_amt is null or v_amt < 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if; v_pct := null;
    else if v_pct is null or v_pct < 0 or v_pct > 100 then raise exception 'INVALID_PCT' using errcode = '22023'; end if; v_amt := null; end if;
    v_tiers := null;
  elsif v_type = 'product_commission' then
    if (v_pct is null) = (v_amt is null) then raise exception 'INVALID_COMMISSION' using errcode = '22023'; end if;
    if v_pct is not null and (v_pct < 0 or v_pct > 100) then raise exception 'INVALID_PCT' using errcode = '22023'; end if;
    v_tiers := null;
  else
    v_pct := null; v_amt := null; v_tiers := null;
  end if;
  if v_type <> 'usage_fee' then v_mode := null; end if;
  if v_type <> 'min_guarantee' then v_comp := false; end if;
  if v_tiers is null then v_tscope := null; elsif v_tscope is not null and v_tscope not in ('organization','unit') then raise exception 'INVALID_TIER_SCOPE' using errcode = '22023'; end if;
  if v_cbase not in ('net_fee','margin') then raise exception 'INVALID_COMMISSION_BASE' using errcode = '22023'; end if;
  if v_type <> 'product_commission' then v_cbase := 'net_fee'; end if;

  -- D12 / F17: comissão sobre Medicação ou Manipulado exige o aceite do Owner (art. 69 do Código de Ética Médica), registrado em log com nome e data
  if v_type = 'product_commission' and v_target = 'item' and v_si.item_type in ('medication','compounded') then
    if not coalesce(p_accept_medication, false) then raise exception 'MEDICATION_COMMISSION_ACCEPT_REQUIRED' using errcode = '22023'; end if;
    if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;

  if p_id is not null then
    select * into o from public.fin_share_rules where id = p_id and clinic_id = p_clinic for update;
    if o.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if o.rule_type <> v_type then raise exception 'RULE_TYPE_LOCKED' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
    v_used := exists (select 1 from public.fin_share_lines l where l.rule_id = o.id);
    if v_used then
      if (o.professional_id, o.role, o.target_type, o.service_id, o.category, o.stock_item_id, o.pct, o.amount_cents, o.tiers, o.tier_scope, o.compensation, o.usage_fee_mode, o.commission_base,
          o.deductions_override, o.all_units, o.unit_ids, o.valid_from)
         is distinct from (v_pro, v_role, v_target, v_svc, v_cat, v_item, v_pct, v_amt, v_tiers, v_tscope, v_comp, v_mode, v_cbase, v_ded, v_all, v_units, v_from) then
        raise exception 'RULE_IN_USE: regra com repasse calculado só tem o fim da vigência alterado; encerre esta e crie outra a partir do dia seguinte' using errcode = '22023';
      end if;
      select max(coalesce(a.performed_on, l.source_date)) into v_lastuse from public.fin_share_lines l left join public.fin_appointments a on a.id = l.appointment_id where l.rule_id = o.id;
      if v_to is not null and v_lastuse is not null and v_to < v_lastuse then raise exception 'RULE_END_BEFORE_USE' using errcode = '22023'; end if;
    end if;
  end if;

  -- sobreposição: mesma pessoa, papel, alvo e tipo (ou «sem repasse» contra % / fixo) com vigência e unidade que se cruzam
  select count(*) into v_cnt from public.fin_share_rules x
   where x.clinic_id = p_clinic and x.professional_id = v_pro and x.is_active and x.id is distinct from p_id
     and x.role is not distinct from v_role and x.target_type = v_target and x.service_id is not distinct from v_svc and x.category is not distinct from v_cat and x.stock_item_id is not distinct from v_item
     and (x.rule_type = v_type or (v_type = 'none' and x.rule_type in ('pct','fixed_per_exec')) or (x.rule_type = 'none' and v_type in ('pct','fixed_per_exec')))
     and x.valid_from <= coalesce(v_to, 'infinity'::date) and coalesce(x.valid_to, 'infinity'::date) >= v_from
     and (x.all_units or v_all or x.unit_ids && v_units);
  if v_cnt > 0 then raise exception 'RULE_OVERLAP' using errcode = '22023'; end if;

  if p_id is null then
    v_action := 'create';
    insert into public.fin_share_rules (clinic_id, professional_id, role, target_type, service_id, category, stock_item_id, rule_type, pct, amount_cents, tiers, tier_scope, compensation,
        usage_fee_mode, commission_base, deductions_override, all_units, unit_ids, valid_from, valid_to, notes, created_by)
      values (p_clinic, v_pro, v_role, v_target, v_svc, v_cat, v_item, v_type, v_pct, v_amt, v_tiers, v_tscope, v_comp, v_mode, v_cbase, v_ded, v_all, v_units, v_from, v_to, v_notes, private.current_profile_id())
      returning * into n;
  else
    v_action := 'update'; v_before := to_jsonb(o);
    update public.fin_share_rules set professional_id = v_pro, role = v_role, target_type = v_target, service_id = v_svc, category = v_cat, stock_item_id = v_item, pct = v_pct, amount_cents = v_amt,
        tiers = v_tiers, tier_scope = v_tscope, compensation = v_comp, usage_fee_mode = v_mode, commission_base = v_cbase, deductions_override = v_ded, all_units = v_all, unit_ids = v_units,
        valid_from = v_from, valid_to = v_to, notes = v_notes, updated_at = now()
     where id = o.id returning * into n;
  end if;
  perform private.fin_log(p_clinic, null, 'share_rule', n.id, v_action, v_before, to_jsonb(n), p_reason);

  if v_type = 'product_commission' and v_target = 'item' and v_si.item_type in ('medication','compounded') then
    for v_u in select u.id from public.clinic_units u where u.clinic_id = p_clinic and u.is_active loop
      insert into public.fin_compliance_acceptances (clinic_id, unit_id, type, accepted_by) values (p_clinic, v_u, 'commission_on_medication', private.current_profile_id()) on conflict (clinic_id, unit_id, type) do nothing;
    end loop;
    perform private.fin_log(p_clinic, null, 'compliance', n.id, 'create', null,
      jsonb_build_object('type', 'commission_on_medication', 'rule_id', n.id, 'item', v_si.name, 'text', 'Código de Ética Médica, art. 69: veda ao médico obter vantagem pela comercialização de medicamentos', 'accepted_by', private.current_profile_id(), 'accepted_at', now()),
      'aceite do Owner: comissão sobre ' || v_si.item_type);
    v_warn := v_warn || '"COMMISSION_MEDICATION_ART69"'::jsonb;
  end if;
  -- F11: a soma dos percentuais de todos os participantes de um mesmo serviço não pode passar de 100%
  if v_type = 'pct' then
    select coalesce(sum(coalesce(x.pct, (select max((e->>'pct')::numeric) from jsonb_array_elements(x.tiers) e))), 0) into v_sum
      from public.fin_share_rules x
     where x.clinic_id = p_clinic and x.is_active and x.rule_type = 'pct' and x.target_type = v_target and x.service_id is not distinct from v_svc and x.category is not distinct from v_cat
       and x.valid_from <= coalesce(v_to, 'infinity'::date) and coalesce(x.valid_to, 'infinity'::date) >= v_from;
    if v_sum > 100 then v_warn := v_warn || '"PCT_SUM_OVER_100"'::jsonb; end if;
  end if;
  return jsonb_build_object('id', n.id, 'warnings', v_warn, 'pct_sum', v_sum);
end $$;

create or replace function public.fin_share_rule_set_active(p_rule uuid, p_active boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.fin_share_rules; n public.fin_share_rules;
begin
  select * into o from public.fin_share_rules where id = p_rule for update;
  if o.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(o.clinic_id, 'share_rules', null, true);
  if o.is_active = coalesce(p_active, false) then return; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if not p_active and exists (select 1 from public.fin_share_lines l where l.rule_id = o.id) then raise exception 'RULE_IN_USE: regra com repasse calculado não se desativa; encerre a vigência' using errcode = '22023'; end if;
  if p_active and exists (select 1 from public.fin_share_rules x where x.clinic_id = o.clinic_id and x.professional_id = o.professional_id and x.is_active and x.id <> o.id and x.role is not distinct from o.role
       and x.target_type = o.target_type and x.service_id is not distinct from o.service_id and x.category is not distinct from o.category and x.stock_item_id is not distinct from o.stock_item_id
       and (x.rule_type = o.rule_type or (o.rule_type = 'none' and x.rule_type in ('pct','fixed_per_exec')) or (x.rule_type = 'none' and o.rule_type in ('pct','fixed_per_exec')))
       and x.valid_from <= coalesce(o.valid_to, 'infinity'::date) and coalesce(x.valid_to, 'infinity'::date) >= o.valid_from and (x.all_units or o.all_units or x.unit_ids && o.unit_ids)) then
    raise exception 'RULE_OVERLAP' using errcode = '22023';
  end if;
  update public.fin_share_rules set is_active = p_active, updated_at = now() where id = o.id returning * into n;
  perform private.fin_log(o.clinic_id, null, 'share_rule', o.id, case when p_active then 'update' else 'deactivate' end, to_jsonb(o), to_jsonb(n), p_reason);
end $$;

-- Recalcular (Financeiro/Gestor): processa eventos pendentes e reconcilia vendas e atendimentos do período. Idempotente: rodar de novo não grava nada.
create or replace function public.fin_share_recalc(p_clinic uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.fin_events; s record; a record; v_before bigint; v_after bigint; v_ev integer := 0;
begin
  perform private.fin_gate(p_clinic, 'share_recalc', null, true);
  select count(*) into v_before from public.fin_share_lines where clinic_id = p_clinic;
  for e in select * from public.fin_events x where x.clinic_id = p_clinic and x.processed_at is null order by x.created_at, x.id loop
    perform private.share_handle_event(e);
    update public.fin_events set processed_at = now() where id = e.id;
    v_ev := v_ev + 1;
  end loop;
  for s in select sl.id from public.fin_sales sl where sl.clinic_id = p_clinic
            and (p_from is null or p_to is null or (sl.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
                 or exists (select 1 from public.fin_receivables r where r.sale_id = sl.id and r.settled_date between p_from and p_to)) order by sl.created_at loop
    perform private.share_reconcile_sale(s.id, 'Recálculo do repasse');
  end loop;
  for a in select ap.id from public.fin_appointments ap where ap.clinic_id = p_clinic and ap.status in ('done','canceled')
            and (p_from is null or ap.performed_on >= p_from) and (p_to is null or ap.performed_on <= p_to) order by ap.performed_on, ap.created_at loop
    perform private.share_reconcile_appt(a.id, 'Recálculo do repasse');
  end loop;
  select count(*) into v_after from public.fin_share_lines where clinic_id = p_clinic;
  perform private.fin_log(p_clinic, null, 'share_recalc', null, 'update', null, jsonb_build_object('from', p_from, 'to', p_to, 'lines_created', v_after - v_before, 'events_processed', v_ev), 'Recálculo do repasse');
  return jsonb_build_object('lines_created', v_after - v_before, 'events_processed', v_ev);
end $$;

-- ---------- 11. Permissões de execução ----------
revoke all on function private.share_period(date), private.share_period_start(text), private.share_locked(uuid, text), private.share_target_period(uuid, text),
  private.share_lvl(public.fin_share_rules, uuid, text), private.share_match(uuid, uuid, text, uuid, text, date, uuid), private.share_match_commission(uuid, uuid, uuid, date, uuid),
  private.share_tier_pct(jsonb, bigint), private.share_tier_progressive(jsonb, bigint), private.share_ded(uuid, public.fin_share_rules), private.share_tax_pct(uuid, text, uuid),
  private.share_item_part(integer, integer, uuid, uuid), private.share_initials(text), private.share_build_sale_item(uuid), private.share_build_pkg(uuid), private.share_build_appt_fixed(uuid),
  private.share_apply(uuid, text, uuid, jsonb, text), private.share_reconcile_sale(uuid, text), private.share_reconcile_pkg(uuid, text), private.share_reconcile_appt(uuid, text),
  private.share_handle_event(public.fin_events), private.share_trg_event(), private.share_trg_sale_side(), private.share_month_calc(uuid, uuid, text, bigint, jsonb),
  private.share_month(uuid, uuid, text), private.share_view_scope(uuid) from public, anon, authenticated;

revoke all on function public.fin_share_context(uuid), public.fin_share_rules_list(uuid, uuid, boolean), public.fin_share_lines_list(uuid, uuid, text, uuid, integer, integer),
  public.fin_share_month(uuid, uuid, text), public.fin_share_month_all(uuid, text), public.fin_share_unruled(uuid, date, date), public.fin_share_med_commissions(uuid, text),
  public.fin_share_rule_save(uuid, uuid, jsonb, text, boolean), public.fin_share_rule_set_active(uuid, boolean, text), public.fin_share_recalc(uuid, date, date) from public, anon;
grant execute on function public.fin_share_context(uuid), public.fin_share_rules_list(uuid, uuid, boolean), public.fin_share_lines_list(uuid, uuid, text, uuid, integer, integer),
  public.fin_share_month(uuid, uuid, text), public.fin_share_month_all(uuid, text), public.fin_share_unruled(uuid, date, date), public.fin_share_med_commissions(uuid, text),
  public.fin_share_rule_save(uuid, uuid, jsonb, text, boolean), public.fin_share_rule_set_active(uuid, boolean, text), public.fin_share_recalc(uuid, date, date) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261114180000','20261114180000_fin_e5_repasse.sql','FIN-E5: motor de repasse (regras por profissional/serviço/papel, lançamentos imutáveis com memória de cálculo, reconciliação idempotente, prévia mensal com faixas, garantia, fixo mensal, taxa de uso e retenções; aditiva).','FIN-E5');
