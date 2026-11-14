-- =====================================================================================
-- FIN-E7 — Financeiro / Repasse / Estoque · Entrega 7 (painel financeiro com números clicáveis, F12). ADITIVA:
-- só LEITURA nova (RPCs fin_dashboard_*), índices e a área de acesso «dash». Nenhuma tabela nova, nenhum dado novo, nenhum backfill.
-- Recria (create or replace) private.fin_area_roles e public.fin_my_access (corpo da E6 preservado + a área 'dash').
-- Depende de E1..E6 (20261113100000 … 20261115120000).
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local: scripts/fin-e7-sql-proof.sh).
--
-- Modelo (escopo-v1 §7, §4.4, §4.5, §12.1 F12, E10):
--  * public.fin_dashboard_summary  — UMA chamada por tela: indicadores do topo, evolução de 12 meses, por forma de pagamento, por profissional,
--                                    por serviço, agenda de recebimentos (90 dias), produtos e contagem das pendências.
--  * public.fin_dashboard_detail   — F12: a lista de linhas que compõe CADA número. Soma das linhas (total_cents) = número do painel.
--  * Os dois leem dos MESMOS auxiliares private.dash_* (um só lugar para cada definição), então painel e lista não divergem.
--  * Acesso: área 'dash' (Gestor e Financeiro; Admin/Owner sempre), conferida POR UNIDADE com private.fin_can. Recepção, Estoquista e
--    profissional não têm o painel da clínica. Quem só alcança algumas unidades vê só elas (nunca as outras).
--  * Mês sempre em horário de Brasília. Dinheiro em centavos inteiros (bigint).
-- Definições (decisões documentadas em docs/financeiro-estoque/entrega-7.md):
--  Vendido = vendas criadas no mês, sem canceladas (total líquido de desconto) · Recebido = títulos liquidados no mês (bruto)
--  Taxas = bruto − líquido liquidado dos títulos liquidados no mês · A receber = títulos «esperados» com vencimento de hoje em diante
--  Em atraso = títulos esperados vencidos + vendas sem recebimento há mais de N dias · Imposto = alíquota do mês de cada unidade × recebido
--  Custo de material = custo dos atendimentos realizados no mês · Repasses = fechamento do mês quando existe (bruto ≥ 0), senão soma dos lançamentos
--  Margem = Recebido − taxas − imposto − material − repasses − custo dos produtos vendidos · Ticket médio = Vendido ÷ nº de vendas.
-- =====================================================================================

-- ---------- 1. Índices dos filtros do painel ----------
create index if not exists fin_receivables_settled_idx on public.fin_receivables (clinic_id, settled_date) where status = 'settled';
create index if not exists fin_receivables_expected_idx on public.fin_receivables (clinic_id, expected_date) where status = 'expected';
create index if not exists fin_sales_open_idx on public.fin_sales (clinic_id, created_at) where status = 'open';
create index if not exists fin_share_lines_clinic_period_idx on public.fin_share_lines (clinic_id, period);
create index if not exists stock_movements_sale_day_idx on public.stock_movements (clinic_id, occurred_on) where sale_id is not null;
create index if not exists fin_patient_packages_expiry_idx on public.fin_patient_packages (clinic_id, expires_on) where status = 'active';
create index if not exists fin_cash_registers_pending_idx on public.fin_cash_registers (clinic_id, business_date) where status in ('open', 'pending_approval');
create index if not exists fin_appointments_done_idx on public.fin_appointments (clinic_id, performed_on) where status = 'done';

-- ---------- 2. Matriz de papéis e acesso do chamador (recriados: corpo da E6 + área 'dash') ----------
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
    -- E4
    when p_area = 'appt'            then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'patient_pkg'     then case when p_write then '{}'::text[] else array['gestor','financeiro','recepcao'] end
    when p_area = 'package_deliver' then array['gestor','estoquista','recepcao']
    -- E5
    when p_area = 'share_rules'     then case when p_write then array['gestor'] else array['gestor','financeiro'] end
    when p_area = 'share_lines'     then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    when p_area = 'share_recalc'    then array['gestor','financeiro']
    -- E6
    when p_area = 'close_prepare'   then array['gestor','financeiro']
    when p_area = 'close_decide'    then array['gestor']
    when p_area = 'close_pay'       then array['gestor','financeiro']
    -- E7: painel financeiro da clínica (escopo §3: Gestor nas unidades autorizadas, Financeiro «vê dashboard»; Admin/Owner sempre). Só leitura.
    when p_area = 'dash'            then case when p_write then '{}'::text[] else array['gestor','financeiro'] end
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move',
                                'appt','patient_pkg','package_deliver','share_rules','share_lines','share_recalc',
                                'close_prepare','close_decide','close_pay','dash'];
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

-- ---------- 3. Auxiliares (uma definição por conjunto de linhas; painel e lista leem daqui) ----------
-- Unidades que o chamador alcança no painel (por unidade, nunca pela clínica inteira) e se são TODAS as da clínica.
create or replace function private.dash_scope(p_clinic uuid, p_unit uuid, out v_units uuid[], out v_all boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_total integer;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(array_agg(u.id) filter (where private.fin_can(p_clinic, 'dash', u.id, false)), '{}'), count(*)
    into v_units, v_total from public.clinic_units u where u.clinic_id = p_clinic;
  if cardinality(v_units) = 0 then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_unit is not null then
    if not (p_unit = any (v_units)) then raise exception 'forbidden' using errcode = '42501'; end if;
    v_units := array[p_unit]; v_all := false;
  else
    v_all := cardinality(v_units) = v_total;
  end if;
end $$;

create or replace function private.dash_period(p_period text) returns text
language plpgsql stable set search_path = '' as $$
declare v text := coalesce(nullif(btrim(p_period), ''), to_char(private.fin_today(), 'YYYY-MM'));
begin
  if v !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  return v;
end $$;

-- Meia-noite de Brasília do dia informado (limite sargável para created_at).
create or replace function private.dash_ts(p_d date) returns timestamptz
language sql stable set search_path = '' as $$ select p_d::timestamp at time zone 'America/Sao_Paulo' $$;

create or replace function private.dash_sold(p_clinic uuid, p_from date, p_to date, p_units uuid[]) returns setof public.fin_sales
language sql stable security definer set search_path = '' as $$
  select s.* from public.fin_sales s
   where s.clinic_id = p_clinic and s.status <> 'canceled' and s.created_at >= private.dash_ts(p_from) and s.created_at < private.dash_ts(p_to + 1) and s.unit_id = any (p_units)
$$;

create or replace function private.dash_settled(p_clinic uuid, p_from date, p_to date, p_units uuid[]) returns setof public.fin_receivables
language sql stable security definer set search_path = '' as $$
  select r.* from public.fin_receivables r
   where r.clinic_id = p_clinic and r.status = 'settled' and r.settled_date between p_from and p_to and r.unit_id = any (p_units)
$$;

create or replace function private.dash_appts(p_clinic uuid, p_from date, p_to date, p_units uuid[]) returns setof public.fin_appointments
language sql stable security definer set search_path = '' as $$
  select a.* from public.fin_appointments a
   where a.clinic_id = p_clinic and a.status = 'done' and a.performed_on between p_from and p_to and a.unit_id = any (p_units)
$$;

-- Movimentações de estoque ligadas a uma venda (saída, estorno e devolução do paciente): custo = −total (a saída tem total negativo).
create or replace function private.dash_prodcost(p_clinic uuid, p_from date, p_to date, p_units uuid[]) returns setof public.stock_movements
language sql stable security definer set search_path = '' as $$
  select m.* from public.stock_movements m
   where m.clinic_id = p_clinic and m.sale_id is not null and m.movement_type in ('sale', 'reversal', 'patient_return')
     and m.occurred_on between p_from and p_to and m.unit_id = any (p_units)
$$;

create or replace function private.dash_prodrev(p_clinic uuid, p_from date, p_to date, p_units uuid[]) returns setof public.fin_sale_items
language sql stable security definer set search_path = '' as $$
  select si.* from public.fin_sale_items si join private.dash_sold(p_clinic, p_from, p_to, p_units) s on s.id = si.sale_id
   where si.item_type in ('product', 'compounded')
$$;

create or replace function private.dash_commission(p_clinic uuid, p_period text, p_units uuid[], p_all boolean) returns setof public.fin_share_lines
language sql stable security definer set search_path = '' as $$
  select l.* from public.fin_share_lines l
   where l.clinic_id = p_clinic and l.period = p_period and l.line_type = 'commission' and l.line_key not like 'close:%' and (p_all or l.unit_id = any (p_units))
$$;

-- Imposto por unidade: alíquota do mês (ou a mais recente anterior) × recebido bruto da unidade, arredondado meio-para-cima por unidade.
create or replace function private.dash_tax_rows(p_clinic uuid, p_period text, p_from date, p_to date, p_units uuid[])
returns table (unit_id uuid, base_cents bigint, rate_pct numeric, tax_cents bigint)
language sql stable security definer set search_path = '' as $$
  select x.unit_id, x.g, x.rate, round(x.g::numeric * x.rate / 100)::bigint
    from (select r.unit_id, sum(r.gross_cents)::bigint as g, private.share_tax_pct(p_clinic, p_period, r.unit_id) as rate
            from private.dash_settled(p_clinic, p_from, p_to, p_units) r group by r.unit_id) x
$$;

-- Repasse do mês por profissional. Com todas as unidades: o fechamento do mês quando existe (bruto, nunca negativo: o saldo negativo é levado ao mês seguinte
-- dentro do bruto dele); senão a soma dos lançamentos do mês (a prévia — fixo mensal, garantia, ajuste de faixa e taxa de uso só entram no fechamento).
-- Com uma unidade (ou só algumas): soma dos lançamentos daquelas unidades.
create or replace function private.dash_repasse(p_clinic uuid, p_period text, p_units uuid[], p_all boolean)
returns table (professional_id uuid, source text, amount_cents bigint, closing_pro_id uuid)
language sql stable security definer set search_path = '' as $$
  with l as (
    select sl.professional_id, sum(sl.amount_cents)::bigint as amt from public.fin_share_lines sl
     where sl.clinic_id = p_clinic and sl.period = p_period and sl.line_key not like 'close:%' and (p_all or sl.unit_id = any (p_units))
     group by sl.professional_id),
  c as (
    select cp.professional_id, greatest(cp.gross_cents, 0)::bigint as amt, cp.id
      from public.fin_closing_pros cp join public.fin_closings fc on fc.id = cp.closing_id
     where p_all and fc.clinic_id = p_clinic and fc.period = p_period)
  select coalesce(c.professional_id, l.professional_id),
         case when c.professional_id is not null then 'closing' else 'lines' end,
         case when c.professional_id is not null then c.amt else l.amt end,
         c.id
    from c full join l on l.professional_id = c.professional_id
$$;

-- Números do mês (uma definição só: o topo do painel, a evolução e a composição da margem usam esta).
create or replace function private.dash_figures(p_clinic uuid, p_period text, p_units uuid[], p_all boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := (p_period || '-01')::date; v_to date := ((p_period || '-01')::date + interval '1 month - 1 day')::date;
  v_sold bigint; v_cnt bigint; v_rec bigint; v_fee bigint; v_tax bigint; v_mat bigint; v_rep bigint; v_pc bigint; v_pr bigint; v_com bigint;
begin
  select coalesce(sum(s.total_net_cents), 0), count(*) into v_sold, v_cnt from private.dash_sold(p_clinic, v_from, v_to, p_units) s;
  select coalesce(sum(r.gross_cents), 0), coalesce(sum(r.gross_cents - r.settled_net_cents), 0) into v_rec, v_fee from private.dash_settled(p_clinic, v_from, v_to, p_units) r;
  select coalesce(sum(t.tax_cents), 0) into v_tax from private.dash_tax_rows(p_clinic, p_period, v_from, v_to, p_units) t;
  select coalesce(sum(a.material_cost_cents), 0) into v_mat from private.dash_appts(p_clinic, v_from, v_to, p_units) a;
  select coalesce(sum(d.amount_cents), 0) into v_rep from private.dash_repasse(p_clinic, p_period, p_units, p_all) d;
  select coalesce(sum(-m.total_cost_cents), 0) into v_pc from private.dash_prodcost(p_clinic, v_from, v_to, p_units) m;
  select coalesce(sum(i.net_cents), 0) into v_pr from private.dash_prodrev(p_clinic, v_from, v_to, p_units) i;
  select coalesce(sum(l.amount_cents), 0) into v_com from private.dash_commission(p_clinic, p_period, p_units, p_all) l;
  return jsonb_build_object('sold_cents', v_sold, 'sold_count', v_cnt, 'ticket_cents', case when v_cnt > 0 then round(v_sold::numeric / v_cnt)::bigint end,
    'received_cents', v_rec, 'fees_cents', v_fee, 'tax_cents', v_tax, 'material_cents', v_mat, 'repasse_cents', v_rep, 'products_cost_cents', v_pc,
    'margin_cents', v_rec - v_fee - v_tax - v_mat - v_rep - v_pc,
    'products_revenue_cents', v_pr, 'products_commission_cents', v_com, 'products_margin_cents', v_pr - v_pc - v_com);
end $$;

-- Pendências (filas): cada uma é um conjunto de linhas; o painel conta, a lista mostra.
create or replace function private.dash_p_nosale(p_clinic uuid, p_units uuid[]) returns setof public.fin_appointments
language sql stable security definer set search_path = '' as $$
  select a.* from public.fin_appointments a
   where a.clinic_id = p_clinic and a.status = 'done' and a.sale_item_id is null and a.patient_package_item_id is null and a.unit_id = any (p_units)
$$;

-- Participantes de atendimento realizado (últimos 12 meses) sem regra de repasse vigente.
create or replace function private.dash_p_unruled(p_clinic uuid, p_units uuid[])
returns table (appointment_id uuid, professional_id uuid, role text, performed_on date, unit_id uuid, service_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, p.professional_id, p.role, a.performed_on, a.unit_id, a.service_name, a.created_at
    from public.fin_appointments a
    join public.fin_appointment_participants p on p.appointment_id = a.id
    join public.fin_services sv on sv.id = a.service_id
   where a.clinic_id = p_clinic and a.status = 'done' and a.unit_id = any (p_units) and a.performed_on >= private.fin_today() - 365
     and not exists (select 1 from private.share_match(a.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id))
$$;

create or replace function private.dash_p_overdue_titles(p_clinic uuid, p_units uuid[]) returns setof public.fin_receivables
language sql stable security definer set search_path = '' as $$
  select r.* from public.fin_receivables r
   where r.clinic_id = p_clinic and r.status = 'expected' and r.expected_date < private.fin_today() and r.unit_id = any (p_units)
$$;

create or replace function private.dash_p_unpaid_sales(p_clinic uuid, p_units uuid[], p_days integer) returns setof public.fin_sales
language sql stable security definer set search_path = '' as $$
  select s.* from public.fin_sales s
   where s.clinic_id = p_clinic and s.status = 'open' and s.unit_id = any (p_units)
     and private.fin_today() - (s.created_at at time zone 'America/Sao_Paulo')::date > p_days
$$;

create or replace function private.dash_p_packages(p_clinic uuid, p_units uuid[])
returns table (package_id uuid, patient_id uuid, unit_id uuid, name text, expires_on date, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select pp.id, pp.patient_id, pp.unit_id, pp.name, pp.expires_on, sum(pi.qty_total - pi.qty_used)
    from public.fin_patient_packages pp
    join public.fin_patient_package_items pi on pi.patient_package_id = pp.id and pi.item_type = 'service'
   where pp.clinic_id = p_clinic and pp.status = 'active' and pp.unit_id = any (p_units)
     and pp.expires_on between private.fin_today() and private.fin_today() + 30
   group by pp.id, pp.patient_id, pp.unit_id, pp.name, pp.expires_on
  having sum(pi.qty_total - pi.qty_used) > 0
$$;

-- Caixa de dia anterior ainda aberto, fechamento aguardando aprovação do gestor e fechamento (últimos 30 dias) com diferença.
create or replace function private.dash_p_cash(p_clinic uuid, p_units uuid[]) returns setof public.fin_cash_registers
language sql stable security definer set search_path = '' as $$
  select c.* from public.fin_cash_registers c
   where c.clinic_id = p_clinic and c.unit_id = any (p_units)
     and ((c.status = 'open' and c.business_date < private.fin_today()) or c.status = 'pending_approval'
          or (c.status = 'closed' and coalesce(c.difference_cents, 0) <> 0 and c.business_date >= private.fin_today() - 30))
$$;

create or replace function private.dash_p_stock(p_clinic uuid, p_units uuid[])
returns table (item_id uuid, unit_id uuid, qty_on_hand numeric, min_qty numeric)
language sql stable security definer set search_path = '' as $$
  select b.item_id, b.unit_id, b.qty_on_hand, mn.min_qty
    from public.stock_balances b
    join public.stock_item_minimums mn on mn.item_id = b.item_id and mn.unit_id = b.unit_id
    join public.stock_items i on i.id = b.item_id and i.is_active
   where b.clinic_id = p_clinic and b.unit_id = any (p_units) and b.qty_on_hand < mn.min_qty
$$;

-- ---------- 4. RPC agregada: uma chamada por tela ----------
create or replace function public.fin_dashboard_summary(p_clinic uuid, p_period text default null, p_unit uuid default null, p_overdue_days integer default 7)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_units uuid[]; v_all boolean; v_period text := private.dash_period(p_period); v_today date := private.fin_today(); v_days integer := least(greatest(coalesce(p_overdue_days, 7), 0), 365);
  v_from date := (v_period || '-01')::date; v_to date := ((v_period || '-01')::date + interval '1 month - 1 day')::date;
  f jsonb; v_exp_c bigint; v_exp_n bigint; v_od_c bigint; v_od_n bigint; v_us_c bigint; v_us_n bigint; v_evo jsonb; v_method jsonb; v_pro jsonb; v_svc jsonb; v_agenda jsonb; v_closing text; v_pend jsonb;
begin
  select * into v_units, v_all from private.dash_scope(p_clinic, p_unit);
  f := private.dash_figures(p_clinic, v_period, v_units, v_all);

  select coalesce(sum(r.gross_cents), 0), count(*) into v_exp_c, v_exp_n from public.fin_receivables r
   where r.clinic_id = p_clinic and r.status = 'expected' and r.expected_date >= v_today and r.unit_id = any (v_units);
  select coalesce(sum(r.gross_cents), 0), count(*) into v_od_c, v_od_n from private.dash_p_overdue_titles(p_clinic, v_units) r;
  select coalesce(sum(s.total_net_cents), 0), count(*) into v_us_c, v_us_n from private.dash_p_unpaid_sales(p_clinic, v_units, v_days) s;

  select jsonb_agg(jsonb_build_object('period', x.m, 'sold_cents', x.f->'sold_cents', 'received_cents', x.f->'received_cents', 'margin_cents', x.f->'margin_cents') order by x.m)
    into v_evo
    from (select mm.m, private.dash_figures(p_clinic, mm.m, v_units, v_all) as f
            from (select to_char(v_from - (g || ' month')::interval, 'YYYY-MM') as m from generate_series(0, 11) g) mm) x;

  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'label', lbl, 'cents', c, 'count', n) order by c desc, k), '[]'::jsonb) into v_method
    from (select p.cash_key as k, min(p.cash_label) as lbl, sum(r.gross_cents)::bigint as c, count(*) as n
            from private.dash_settled(p_clinic, v_from, v_to, v_units) r join public.fin_payments p on p.id = r.payment_id group by p.cash_key) x;

  select coalesce(jsonb_agg(jsonb_build_object('professional_id', z.pid, 'name', coalesce(pf.full_name, 'Profissional'), 'appointments', z.n, 'revenue_cents', z.rev, 'material_cents', z.mat,
           'repasse_cents', z.rep, 'repasse_source', z.src, 'closing_pro_id', z.cpid, 'pct_repassed', case when z.rev > 0 then round(z.rep::numeric * 100 / z.rev, 1) end,
           'margin_cents', z.rev - z.rep - z.mat) order by z.rev desc, pf.full_name, z.pid), '[]'::jsonb)
    into v_pro
    from (select coalesce(q.pid, d.professional_id) as pid, coalesce(q.n, 0) as n, coalesce(q.rev, 0) as rev, coalesce(q.mat, 0) as mat, coalesce(d.amount_cents, 0) as rep, d.source as src, d.closing_pro_id as cpid
            from (select p.professional_id as pid, count(distinct a.id) as n,
                         coalesce(sum(coalesce(a.base_value_cents, 0)) filter (where p.role = 'responsavel'), 0)::bigint as rev,
                         coalesce(sum(a.material_cost_cents) filter (where p.role = 'responsavel'), 0)::bigint as mat
                    from private.dash_appts(p_clinic, v_from, v_to, v_units) a join public.fin_appointment_participants p on p.appointment_id = a.id group by p.professional_id) q
            full join private.dash_repasse(p_clinic, v_period, v_units, v_all) d on d.professional_id = q.pid) z
    left join public.professionals pr on pr.id = z.pid left join public.profiles pf on pf.id = pr.profile_id;

  select coalesce(jsonb_agg(jsonb_build_object('service_id', x.sid, 'name', x.nm, 'quantity', x.n, 'revenue_cents', x.rev, 'material_cents', x.mat,
           'avg_material_cents', round(x.mat::numeric / x.n), 'unit_margin_cents', round((x.rev - x.mat)::numeric / x.n)) order by x.rev desc, x.nm, x.sid), '[]'::jsonb)
    into v_svc
    from (select a.service_id as sid, max(a.service_name) as nm, count(*) as n, coalesce(sum(a.base_value_cents), 0)::bigint as rev, coalesce(sum(a.material_cost_cents), 0)::bigint as mat
            from private.dash_appts(p_clinic, v_from, v_to, v_units) a group by a.service_id) x;

  -- Agenda de recebimentos: 13 faixas a partir de hoje (7 dias cada, até o dia 89) + «depois de 90 dias», para o total fechar com «A receber».
  select jsonb_agg(jsonb_build_object('from', b.d_from, 'to', b.d_to, 'cents', b.c, 'count', b.n) order by b.k) into v_agenda
    from (select g.k, g.d_from, g.d_to, coalesce(sum(r.gross_cents), 0)::bigint as c, count(r.id) as n
            from (select k, case when k = 13 then v_today + 90 else v_today + 7 * k end as d_from, case when k = 13 then null else least(v_today + 7 * k + 6, v_today + 89) end as d_to from generate_series(0, 13) k) g
            left join public.fin_receivables r on r.clinic_id = p_clinic and r.status = 'expected' and r.unit_id = any (v_units)
                 and r.expected_date >= g.d_from and (g.d_to is null or r.expected_date <= g.d_to)

           group by g.k, g.d_from, g.d_to) b;

  select fc.status into v_closing from public.fin_closings fc where fc.clinic_id = p_clinic and fc.period = v_period and v_all;

  v_pend := jsonb_build_object(
    'appt_no_sale', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(a.base_value_cents), 0)) from private.dash_p_nosale(p_clinic, v_units) a),
    'unruled', (select jsonb_build_object('count', count(*), 'cents', 0) from private.dash_p_unruled(p_clinic, v_units)),
    'overdue_titles', jsonb_build_object('count', v_od_n, 'cents', v_od_c),
    'packages', (select jsonb_build_object('count', count(*), 'cents', 0) from private.dash_p_packages(p_clinic, v_units)),
    'cash', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(c.cash_difference_cents), 0)) from private.dash_p_cash(p_clinic, v_units) c),
    'stock', (select jsonb_build_object('count', count(*), 'cents', 0) from private.dash_p_stock(p_clinic, v_units)));

  return jsonb_build_object(
    'period', v_period, 'unit_id', p_unit, 'today', v_today, 'overdue_days', v_days, 'all_units', v_all, 'closing_status', v_closing,
    'cards', f || jsonb_build_object(
      'to_receive_cents', v_exp_c, 'to_receive_count', v_exp_n,
      'overdue_cents', v_od_c + v_us_c, 'overdue_count', v_od_n + v_us_n, 'overdue_titles_cents', v_od_c, 'overdue_titles_count', v_od_n, 'overdue_sales_cents', v_us_c, 'overdue_sales_count', v_us_n),
    'evolution', v_evo, 'by_method', v_method, 'by_professional', v_pro, 'by_service', v_svc, 'agenda', v_agenda, 'pendencies', v_pend);
end $$;

-- ---------- 5. F12: a lista que compõe cada número ----------
-- Devolve (valor, ordem, linha) por métrica. O valor de cada linha é o que entra na soma do número do painel.
create or replace function private.dash_detail_rows(p_clinic uuid, p_metric text, p_period text, p_units uuid[], p_all boolean, p_params jsonb, p_days integer)
returns table (out_value bigint, out_ord bigint, out_item jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := (p_period || '-01')::date; v_to date := ((p_period || '-01')::date + interval '1 month - 1 day')::date; v_today date := private.fin_today();
  f jsonb; v_pro uuid := nullif(p_params->>'professional', '')::uuid; v_svc uuid := nullif(p_params->>'service', '')::uuid; v_method text := nullif(p_params->>'method', '');
  v_rf date := coalesce(nullif(p_params->>'from', '')::date, private.fin_today()); v_rt date := nullif(p_params->>'to', '')::date;
begin
  if p_metric in ('sold', 'ticket') then
    return query
      select s.total_net_cents::bigint, extract(epoch from s.created_at)::bigint,
             jsonb_build_object('id', s.id, 'at', s.created_at, 'unit_name', u.name, 'patient_name', ppr.full_name, 'seller_name', spr.full_name, 'status', s.status)
        from private.dash_sold(p_clinic, v_from, v_to, p_units) s
        join public.clinic_units u on u.id = s.unit_id
        left join public.patients pt on pt.id = s.patient_id left join public.profiles ppr on ppr.id = pt.profile_id
        left join public.professionals sp on sp.id = s.seller_professional_id left join public.profiles spr on spr.id = sp.profile_id;

  elsif p_metric in ('received', 'fees') then
    return query
      select (case when p_metric = 'fees' then r.gross_cents - r.settled_net_cents else r.gross_cents end)::bigint, extract(epoch from r.settled_date::timestamp)::bigint,
             jsonb_build_object('id', r.id, 'sale_id', r.sale_id, 'date', r.settled_date, 'unit_name', u.name, 'patient_name', ppr.full_name, 'method_label', p.cash_label,
               'installment', r.installment_no || '/' || r.installments, 'gross_cents', r.gross_cents, 'fee_cents', r.gross_cents - r.settled_net_cents, 'net_cents', r.settled_net_cents)
        from private.dash_settled(p_clinic, v_from, v_to, p_units) r
        join public.fin_payments p on p.id = r.payment_id
        join public.clinic_units u on u.id = r.unit_id
        join public.fin_sales s on s.id = r.sale_id
        left join public.patients pt on pt.id = s.patient_id left join public.profiles ppr on ppr.id = pt.profile_id
       where v_method is null or p.cash_key = v_method;

  elsif p_metric = 'to_receive' then
    return query
      select r.gross_cents::bigint, extract(epoch from r.expected_date::timestamp)::bigint,
             jsonb_build_object('id', r.id, 'sale_id', r.sale_id, 'kind', 'titulo', 'date', r.expected_date, 'unit_name', u.name, 'patient_name', ppr.full_name, 'method_label', p.cash_label,
               'installment', r.installment_no || '/' || r.installments, 'gross_cents', r.gross_cents, 'fee_cents', r.fee_cents, 'net_cents', r.net_cents)
        from public.fin_receivables r
        join public.fin_payments p on p.id = r.payment_id
        join public.clinic_units u on u.id = r.unit_id
        join public.fin_sales s on s.id = r.sale_id
        left join public.patients pt on pt.id = s.patient_id left join public.profiles ppr on ppr.id = pt.profile_id
       where r.clinic_id = p_clinic and r.status = 'expected' and r.unit_id = any (p_units) and r.expected_date >= v_rf and (v_rt is null or r.expected_date <= v_rt);

  elsif p_metric in ('overdue', 'overdue_titles') then
    return query
      select r.gross_cents::bigint, extract(epoch from r.expected_date::timestamp)::bigint,
             jsonb_build_object('id', r.id, 'sale_id', r.sale_id, 'kind', 'titulo', 'date', r.expected_date, 'days_late', v_today - r.expected_date, 'unit_name', u.name, 'patient_name', ppr.full_name,
               'method_label', p.cash_label, 'installment', r.installment_no || '/' || r.installments, 'gross_cents', r.gross_cents)
        from private.dash_p_overdue_titles(p_clinic, p_units) r
        join public.fin_payments p on p.id = r.payment_id
        join public.clinic_units u on u.id = r.unit_id
        join public.fin_sales s on s.id = r.sale_id
        left join public.patients pt on pt.id = s.patient_id left join public.profiles ppr on ppr.id = pt.profile_id;
    if p_metric = 'overdue' then
      return query
        select s.total_net_cents::bigint, extract(epoch from s.created_at)::bigint,
               jsonb_build_object('id', s.id, 'sale_id', s.id, 'kind', 'venda', 'date', (s.created_at at time zone 'America/Sao_Paulo')::date,
                 'days_late', v_today - (s.created_at at time zone 'America/Sao_Paulo')::date, 'unit_name', u.name, 'patient_name', ppr.full_name,
                 'method_label', 'Sem recebimento', 'installment', null, 'gross_cents', s.total_net_cents)
          from private.dash_p_unpaid_sales(p_clinic, p_units, p_days) s
          join public.clinic_units u on u.id = s.unit_id
          left join public.patients pt on pt.id = s.patient_id left join public.profiles ppr on ppr.id = pt.profile_id;
    end if;

  elsif p_metric = 'repasse' then
    return query
      select d.amount_cents, d.amount_cents,
             jsonb_build_object('id', d.professional_id, 'name', coalesce(pf.full_name, 'Profissional'), 'source', d.source, 'closing_pro_id', d.closing_pro_id,
               'closing_status', cp.status, 'gross_cents', coalesce(cp.gross_cents, d.amount_cents))
        from private.dash_repasse(p_clinic, p_period, p_units, p_all) d
        left join public.professionals pr on pr.id = d.professional_id left join public.profiles pf on pf.id = pr.profile_id
        left join public.fin_closing_pros cp on cp.id = d.closing_pro_id
       where d.amount_cents <> 0;

  elsif p_metric = 'pro_lines' then
    return query
      select l.amount_cents, extract(epoch from l.created_at)::bigint,
             jsonb_build_object('id', l.id, 'date', coalesce(l.source_date, l.created_at::date), 'line_type', l.line_type, 'role', l.role, 'kind', l.kind, 'service_name', a.service_name,
               'patient_name', ppr.full_name, 'reason', l.reason)
        from public.fin_share_lines l
        left join public.fin_appointments a on a.id = l.appointment_id
        left join public.patients pt on pt.id = a.patient_id left join public.profiles ppr on ppr.id = pt.profile_id
       where l.clinic_id = p_clinic and l.period = p_period and l.professional_id = v_pro and l.line_key not like 'close:%' and (p_all or l.unit_id = any (p_units));

  elsif p_metric = 'material' then
    return query
      select a.material_cost_cents, extract(epoch from a.performed_on::timestamp)::bigint,
             jsonb_build_object('id', a.id, 'date', a.performed_on, 'unit_name', u.name, 'patient_name', ppr.full_name, 'service_name', a.service_name, 'estimated_cents', a.material_estimated_cents)
        from private.dash_appts(p_clinic, v_from, v_to, p_units) a
        join public.clinic_units u on u.id = a.unit_id
        left join public.patients pt on pt.id = a.patient_id left join public.profiles ppr on ppr.id = pt.profile_id
       where a.material_cost_cents > 0;

  elsif p_metric = 'tax' then
    return query
      select t.tax_cents, t.tax_cents, jsonb_build_object('id', t.unit_id, 'unit_name', u.name, 'base_cents', t.base_cents, 'rate_pct', t.rate_pct)
        from private.dash_tax_rows(p_clinic, p_period, v_from, v_to, p_units) t join public.clinic_units u on u.id = t.unit_id;

  elsif p_metric = 'products_revenue' then
    return query
      select i.net_cents::bigint, extract(epoch from s.created_at)::bigint,
             jsonb_build_object('id', i.id, 'sale_id', i.sale_id, 'at', s.created_at, 'item_name', i.description, 'quantity', i.quantity, 'unit_name', u.name, 'patient_name', ppr.full_name)
        from private.dash_prodrev(p_clinic, v_from, v_to, p_units) i
        join public.fin_sales s on s.id = i.sale_id join public.clinic_units u on u.id = s.unit_id
        left join public.patients pt on pt.id = s.patient_id left join public.profiles ppr on ppr.id = pt.profile_id;

  elsif p_metric = 'products_cost' then
    return query
      select (-m.total_cost_cents)::bigint, extract(epoch from m.created_at)::bigint,
             jsonb_build_object('id', m.id, 'sale_id', m.sale_id, 'date', m.occurred_on, 'item_name', it.name, 'unit_name', u.name, 'movement_type', m.movement_type, 'quantity', m.qty)
        from private.dash_prodcost(p_clinic, v_from, v_to, p_units) m
        join public.stock_items it on it.id = m.item_id join public.clinic_units u on u.id = m.unit_id;

  elsif p_metric = 'products_commission' then
    return query
      select l.amount_cents, extract(epoch from l.created_at)::bigint,
             jsonb_build_object('id', l.id, 'date', coalesce(l.source_date, l.created_at::date), 'professional_name', coalesce(pf.full_name, 'Profissional'), 'item_name', coalesce(l.memory->>'item', '—'), 'kind', l.kind)
        from private.dash_commission(p_clinic, p_period, p_units, p_all) l
        left join public.professionals pr on pr.id = l.professional_id left join public.profiles pf on pf.id = pr.profile_id;

  elsif p_metric = 'margin' then
    f := private.dash_figures(p_clinic, p_period, p_units, p_all);
    return query
      select (c.sign * (f->>c.k)::bigint), (10 - c.n)::bigint, jsonb_build_object('id', c.k, 'label', c.label, 'metric', c.metric, 'sign', case when c.sign > 0 then '+' else '−' end, 'amount_cents', (f->>c.k)::bigint)
        from (values (1, 'received_cents', 'Recebido', 'received', 1), (-1, 'fees_cents', 'Taxas de pagamento', 'fees', 2), (-1, 'tax_cents', 'Imposto', 'tax', 3),
                     (-1, 'material_cents', 'Custo de material', 'material', 4), (-1, 'repasse_cents', 'Repasses do mês', 'repasse', 5), (-1, 'products_cost_cents', 'Custo dos produtos vendidos', 'products_cost', 6))
             as c(sign, k, label, metric, n);

  elsif p_metric = 'pro_appointments' then
    return query
      select (case when q.role = 'responsavel' then coalesce(a.base_value_cents, 0) else 0 end)::bigint, extract(epoch from a.performed_on::timestamp)::bigint,
             jsonb_build_object('id', a.id, 'date', a.performed_on, 'unit_name', u.name, 'patient_name', ppr.full_name, 'service_name', a.service_name, 'role', q.role,
               'material_cents', case when q.role = 'responsavel' then a.material_cost_cents else 0 end)
        from private.dash_appts(p_clinic, v_from, v_to, p_units) a
        join public.fin_appointment_participants q on q.appointment_id = a.id and q.professional_id = v_pro
        join public.clinic_units u on u.id = a.unit_id
        left join public.patients pt on pt.id = a.patient_id left join public.profiles ppr on ppr.id = pt.profile_id;

  elsif p_metric = 'pro_margin' then
    return query
      select c.v, (10 - c.n)::bigint, jsonb_build_object('id', c.k, 'label', c.label, 'metric', c.metric, 'sign', case when c.v >= 0 then '+' else '−' end, 'amount_cents', abs(c.v))
        from (values
          ('revenue', 'Receita gerada', 'pro_appointments', 1,
             (select coalesce(sum(coalesce(a.base_value_cents, 0)), 0)::bigint from private.dash_appts(p_clinic, v_from, v_to, p_units) a
                join public.fin_appointment_participants q on q.appointment_id = a.id and q.professional_id = v_pro and q.role = 'responsavel')),
          ('repasse', 'Repasse', 'pro_repasse', 2,
             -(select coalesce(sum(d.amount_cents), 0)::bigint from private.dash_repasse(p_clinic, p_period, p_units, p_all) d where d.professional_id = v_pro)),
          ('material', 'Custo de material', 'pro_appointments', 3,
             -(select coalesce(sum(a.material_cost_cents), 0)::bigint from private.dash_appts(p_clinic, v_from, v_to, p_units) a
                join public.fin_appointment_participants q on q.appointment_id = a.id and q.professional_id = v_pro and q.role = 'responsavel'))
        ) as c(k, label, metric, n, v);

  elsif p_metric = 'service_appointments' then
    return query
      select coalesce(a.base_value_cents, 0)::bigint, extract(epoch from a.performed_on::timestamp)::bigint,
             jsonb_build_object('id', a.id, 'date', a.performed_on, 'unit_name', u.name, 'patient_name', ppr.full_name, 'service_name', a.service_name, 'material_cents', a.material_cost_cents)
        from private.dash_appts(p_clinic, v_from, v_to, p_units) a
        join public.clinic_units u on u.id = a.unit_id
        left join public.patients pt on pt.id = a.patient_id left join public.profiles ppr on ppr.id = pt.profile_id
       where a.service_id = v_svc;

  elsif p_metric = 'appt_no_sale' then
    return query
      select coalesce(a.base_value_cents, 0)::bigint, extract(epoch from a.performed_on::timestamp)::bigint,
             jsonb_build_object('id', a.id, 'date', a.performed_on, 'unit_name', u.name, 'patient_name', ppr.full_name, 'service_name', a.service_name,
               'professionals', (select string_agg(coalesce(qpr.full_name, 'Profissional'), ', ' order by q.position) from public.fin_appointment_participants q
                                   join public.professionals qp on qp.id = q.professional_id left join public.profiles qpr on qpr.id = qp.profile_id where q.appointment_id = a.id))
        from private.dash_p_nosale(p_clinic, p_units) a
        join public.clinic_units u on u.id = a.unit_id
        left join public.patients pt on pt.id = a.patient_id left join public.profiles ppr on ppr.id = pt.profile_id;

  elsif p_metric = 'unruled' then
    return query
      select 0::bigint, extract(epoch from x.performed_on::timestamp)::bigint,
             jsonb_build_object('id', x.appointment_id || ':' || x.professional_id || ':' || x.role, 'appointment_id', x.appointment_id, 'date', x.performed_on, 'unit_name', u.name,
               'service_name', x.service_name, 'professional_name', coalesce(pf.full_name, 'Profissional'), 'role', x.role)
        from private.dash_p_unruled(p_clinic, p_units) x
        join public.clinic_units u on u.id = x.unit_id
        left join public.professionals pr on pr.id = x.professional_id left join public.profiles pf on pf.id = pr.profile_id;

  elsif p_metric = 'packages' then
    return query
      select 0::bigint, extract(epoch from x.expires_on::timestamp)::bigint,
             jsonb_build_object('id', x.package_id, 'patient_name', ppr.full_name, 'package_name', x.name, 'expires_on', x.expires_on, 'remaining', x.remaining, 'unit_name', u.name)
        from private.dash_p_packages(p_clinic, p_units) x
        join public.clinic_units u on u.id = x.unit_id
        left join public.patients pt on pt.id = x.patient_id left join public.profiles ppr on ppr.id = pt.profile_id;

  elsif p_metric = 'cash' then
    return query
      select coalesce(c.cash_difference_cents, 0)::bigint, extract(epoch from c.business_date::timestamp)::bigint,
             jsonb_build_object('id', c.id, 'date', c.business_date, 'unit_name', u.name, 'operator_name', opr.full_name, 'status', c.status,
               'stale', c.status = 'open', 'difference_cents', c.cash_difference_cents)
        from private.dash_p_cash(p_clinic, p_units) c
        join public.clinic_units u on u.id = c.unit_id
        left join public.profiles opr on opr.id = c.operator_profile_id;

  elsif p_metric = 'stock' then
    return query
      select 0::bigint, 0::bigint,
             jsonb_build_object('id', x.item_id || ':' || x.unit_id, 'item_name', it.name, 'unit_name', u.name, 'qty_on_hand', x.qty_on_hand, 'min_qty', x.min_qty, 'stock_unit', it.stock_unit)
        from private.dash_p_stock(p_clinic, p_units) x
        join public.stock_items it on it.id = x.item_id join public.clinic_units u on u.id = x.unit_id;

  else
    raise exception 'INVALID_METRIC' using errcode = '22023';
  end if;
end $$;

create or replace function public.fin_dashboard_detail(p_clinic uuid, p_metric text, p_period text default null, p_unit uuid default null, p_params jsonb default '{}'::jsonb,
                                                       p_overdue_days integer default 7, p_limit integer default 300, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_units uuid[]; v_all boolean; v_period text := private.dash_period(p_period); v_days integer := least(greatest(coalesce(p_overdue_days, 7), 0), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000); v_off integer := greatest(coalesce(p_offset, 0), 0); v_n bigint; v_sum bigint; v_rows jsonb;
begin
  select * into v_units, v_all from private.dash_scope(p_clinic, p_unit);
  with r as materialized (select * from private.dash_detail_rows(p_clinic, p_metric, v_period, v_units, v_all, coalesce(p_params, '{}'::jsonb), v_days))
  select (select count(*) from r), (select coalesce(sum(r.out_value), 0) from r),
         (select coalesce(jsonb_agg(t.out_item || jsonb_build_object('value_cents', t.out_value) order by t.out_ord desc, t.out_item->>'id'), '[]'::jsonb)
            from (select r.out_item, r.out_ord, r.out_value from r order by r.out_ord desc, r.out_item->>'id' offset v_off limit v_limit) t)
    into v_n, v_sum, v_rows;
  return jsonb_build_object('metric', p_metric, 'period', v_period, 'count', v_n, 'total_cents', v_sum, 'offset', v_off, 'limit', v_limit, 'truncated', v_n > v_off + v_limit, 'rows', v_rows);
end $$;

-- ---------- 6. Permissões de execução ----------
revoke all on function private.dash_scope(uuid, uuid), private.dash_period(text), private.dash_ts(date), private.dash_sold(uuid, date, date, uuid[]), private.dash_settled(uuid, date, date, uuid[]),
  private.dash_appts(uuid, date, date, uuid[]), private.dash_prodcost(uuid, date, date, uuid[]), private.dash_prodrev(uuid, date, date, uuid[]), private.dash_commission(uuid, text, uuid[], boolean),
  private.dash_tax_rows(uuid, text, date, date, uuid[]), private.dash_repasse(uuid, text, uuid[], boolean), private.dash_figures(uuid, text, uuid[], boolean),
  private.dash_p_nosale(uuid, uuid[]), private.dash_p_unruled(uuid, uuid[]), private.dash_p_overdue_titles(uuid, uuid[]), private.dash_p_unpaid_sales(uuid, uuid[], integer),
  private.dash_p_packages(uuid, uuid[]), private.dash_p_cash(uuid, uuid[]), private.dash_p_stock(uuid, uuid[]),
  private.dash_detail_rows(uuid, text, text, uuid[], boolean, jsonb, integer) from public, anon, authenticated;

revoke all on function public.fin_dashboard_summary(uuid, text, uuid, integer), public.fin_dashboard_detail(uuid, text, text, uuid, jsonb, integer, integer, integer) from public, anon;
grant execute on function public.fin_dashboard_summary(uuid, text, uuid, integer), public.fin_dashboard_detail(uuid, text, text, uuid, jsonb, integer, integer, integer) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261116100000','20261116100000_fin_e7_painel.sql','FIN-E7: painel financeiro (RPCs fin_dashboard_summary e fin_dashboard_detail, números clicáveis F12, filas de pendências), área dash e índices; só leitura (aditiva).','FIN-E7');
