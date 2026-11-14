-- =====================================================================================
-- FIN-E6 — Financeiro / Repasse / Estoque · Entrega 6 (fechamento mensal do repasse). ADITIVA:
-- cria fin_closings, fin_closing_pros, fin_closing_disputes (+ bucket privado fin-repasse com políticas), funções private.close_* e public.fin_closing_*;
-- recria (create or replace) private.fin_area_roles, public.fin_my_access, private.share_apply, private.share_month_calc e public.fin_share_lines_list
-- (corpo da E5 preservado + o novo) e adiciona a sobrecarga private.share_target_period(uuid, text, uuid). Nenhum dado existente muda.
-- Depende de E1..E5 (20261113100000, 20261113180000, 20261113213000, 20261113230000, 20261114090000, 20261114100000, 20261114180000).
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local: scripts/fin-e6-sql-proof.sh).
--
-- Modelo (escopo-v1 §6, §5.8, §5.9, §11, §12.1 F2, F7-F9, F13, F14):
--  * fin_closings        — um fechamento por clínica e mês: conferência → aprovado (todos aprovados) → travado. Travar grava fin_share_period_locks
--                          e o razão do mês (linhas mensais); destravar (só Owner/Admin, com motivo) estorna esse razão com linhas novas.
--  * fin_closing_pros    — extrato de cada profissional: fotografia do cálculo (calc), aceite, aprovação, NF e pagamento. Aprovado/pago = CONGELADO:
--                          private.share_month_calc devolve a fotografia e correções novas daquele profissional caem no próximo mês aberto.
--  * fin_closing_disputes — contestação do profissional (por linha ou geral) e resposta do gestor.
--  * Linhas mensais (ajuste de faixa, fixo mensal, garantia, taxa de uso, saldo trazido, retenções) são gravadas em fin_share_lines (imutável) ao TRAVAR,
--    com line_key 'close:...' (excluídas da prévia e da lista para não contar duas vezes). Ajuste manual (bônus/desconto/adiantamento) é linha 'adjustment'.
-- =====================================================================================

-- ---------- 1. Tabelas ----------
create table if not exists public.fin_closings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'conferencia' check (status in ('conferencia','aprovado','travado')),
  accept_days integer not null default 5 check (accept_days between 1 and 60),
  started_at timestamptz not null default now(),
  started_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  locked_at timestamptz,
  locked_by uuid,
  lock_no integer not null default 0,
  unlocked_at timestamptz,
  unlocked_by uuid,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, period)
);

create table if not exists public.fin_closing_pros (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.fin_closings(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  stmt_version integer not null default 1,
  appointments_count integer not null default 0,
  pct_cents bigint not null default 0,            -- percentual + ajuste de faixa
  fixed_exec_cents bigint not null default 0,
  fixed_monthly_cents bigint not null default 0,
  guarantee_cents bigint not null default 0,
  commission_cents bigint not null default 0,
  usage_fee_cents bigint not null default 0,      -- negativo
  adjustment_cents bigint not null default 0,     -- estornos, saldo trazido e ajustes manuais (±)
  gross_cents bigint not null default 0,
  withholding_cents bigint not null default 0,
  net_cents bigint not null default 0,
  calc jsonb not null,                            -- fotografia do cálculo mensal (derivadas, retenções, saldos)
  bond_type text,
  requires_invoice boolean not null default false,
  status text not null default 'open' check (status in ('open','approved','paid')),
  acceptance text not null default 'pending' check (acceptance in ('pending','accepted','contested','approved_without')),
  accept_deadline date not null,
  accepted_at timestamptz,
  accepted_by uuid,
  notified_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  invoice_number text check (invoice_number is null or char_length(invoice_number) between 1 and 40),
  invoice_date date,
  invoice_path text check (invoice_path is null or char_length(invoice_path) <= 300),
  invoice_by uuid,
  invoice_at timestamptz,
  paid_on date,
  pay_method text check (pay_method is null or pay_method in ('pix','transfer','cash','other')),
  pay_note text check (pay_note is null or char_length(pay_note) <= 200),
  proof_path text check (proof_path is null or char_length(proof_path) <= 300),
  paid_by uuid,
  paid_registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (closing_id, professional_id),
  check (status <> 'paid' or (paid_on is not null and pay_method is not null))
);
create index if not exists fin_closing_pros_clinic_pro_idx on public.fin_closing_pros (clinic_id, professional_id);

create table if not exists public.fin_closing_disputes (
  id uuid primary key default gen_random_uuid(),
  closing_pro_id uuid not null references public.fin_closing_pros(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  share_line_id uuid references public.fin_share_lines(id) on delete restrict,
  line_label text check (line_label is null or char_length(line_label) <= 120),
  comment text not null check (char_length(comment) between 3 and 500),
  stmt_version integer not null default 1,
  status text not null default 'open' check (status in ('open','answered')),
  response text check (response is null or char_length(response) between 3 and 500),
  answered_by uuid,
  answered_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (status <> 'answered' or (response is not null and answered_at is not null))
);
create index if not exists fin_closing_disputes_cp_idx on public.fin_closing_disputes (closing_pro_id, status);

-- Sem exclusão física (apagar a clínica inteira, em cascata, continua possível como nas Entregas 3 a 5).
do $$
declare t text;
begin
  foreach t in array array['fin_closings','fin_closing_pros','fin_closing_disputes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_nodel', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.fin_e4_no_delete()', t || '_nodel', t);
    execute format('drop trigger if exists %I on public.%I', t || '_nodel_trunc', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.fin_e4_no_delete()', t || '_nodel_trunc', t);
  end loop;
end $$;

-- ---------- 2. RLS e grants (leitura: Gestor/Financeiro/Admin; o profissional lê só o PRÓPRIO extrato; escrita só por RPC) ----------
alter table public.fin_closings enable row level security;
alter table public.fin_closing_pros enable row level security;
alter table public.fin_closing_disputes enable row level security;
revoke all on public.fin_closings, public.fin_closing_pros, public.fin_closing_disputes from anon, authenticated;
grant select on public.fin_closings, public.fin_closing_pros, public.fin_closing_disputes to authenticated;
-- as políticas abaixo (e as do bucket) chamam private.appt_is_pro com o papel do chamador: precisa de EXECUTE (o schema private não é exposto pela API)
grant execute on function private.appt_is_pro(uuid) to authenticated;
drop policy if exists fin_closings_select on public.fin_closings;
create policy fin_closings_select on public.fin_closings for select to authenticated using (private.fin_can(clinic_id, 'share_lines', null, false));
drop policy if exists fin_closing_pros_select on public.fin_closing_pros;
create policy fin_closing_pros_select on public.fin_closing_pros for select to authenticated
  using (private.fin_can(clinic_id, 'share_lines', null, false) or (private.appt_is_pro(clinic_id) and private.fin_is_self_professional(professional_id)));
drop policy if exists fin_closing_disputes_select on public.fin_closing_disputes;
create policy fin_closing_disputes_select on public.fin_closing_disputes for select to authenticated
  using (private.fin_can(clinic_id, 'share_lines', null, false) or (private.appt_is_pro(clinic_id) and private.fin_is_self_professional(professional_id)));

-- ---------- 3. Arquivos (NF e comprovante): bucket privado, caminho <clínica>/<extrato>/<arquivo>; sem UPDATE/DELETE (arquivo não se troca nem se apaga) ----------
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('fin-repasse', 'fin-repasse', false) on conflict (id) do nothing;
    execute 'drop policy if exists fin_repasse_files_select on storage.objects';
    execute 'drop policy if exists fin_repasse_files_insert on storage.objects';
    execute $p$create policy fin_repasse_files_select on storage.objects for select to authenticated
      using (bucket_id = 'fin-repasse' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
        and exists (select 1 from public.fin_closing_pros cp
                     where cp.id = split_part(name, '/', 2)::uuid and cp.clinic_id = split_part(name, '/', 1)::uuid
                       and (private.fin_can(cp.clinic_id, 'share_lines', null, false) or (private.appt_is_pro(cp.clinic_id) and private.fin_is_self_professional(cp.professional_id)))))$p$;
    execute $p$create policy fin_repasse_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'fin-repasse' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
        and exists (select 1 from public.fin_closing_pros cp
                     where cp.id = split_part(name, '/', 2)::uuid and cp.clinic_id = split_part(name, '/', 1)::uuid
                       and (private.fin_can(cp.clinic_id, 'close_pay', null, true) or (private.appt_is_pro(cp.clinic_id) and private.fin_is_self_professional(cp.professional_id)))))$p$;
  end if;
end $$;

-- ---------- 4. Matriz de papéis, acesso do chamador e motor (recriados: corpo da E5 + o novo) ----------
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
    -- E6: fechamento mensal. Preparar (iniciar, atualizar extratos, notificar): Gestor e Financeiro; decidir (aprovar, travar, responder contestação, ajuste manual): Gestor; NF e pagamento: Gestor e Financeiro. Destravar é só do Admin/Owner (verificado na RPC)
    when p_area = 'close_prepare'   then array['gestor','financeiro']
    when p_area = 'close_decide'    then array['gestor']
    when p_area = 'close_pay'       then array['gestor','financeiro']
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move',
                                'appt','patient_pkg','package_deliver','share_rules','share_lines','share_recalc',
                                'close_prepare','close_decide','close_pay'];
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
      v_origin := d->>'period'; v_period := private.share_target_period(p_clinic, v_origin, (d->>'professional_id')::uuid); v_type := d->>'line_type'; v_kind := 'original';
      v_mem := coalesce(d->'memory', '{}'::jsonb);
      insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, scope_id, line_key, source_date, appointment_id, sale_id, sale_item_id, receivable_id,
          rule_id, gross_cents, base_cents, pct, amount_cents, origin_period, kind, reason, memory, created_by)
        values (p_clinic, nullif(d->>'unit_id', '')::uuid, (d->>'professional_id')::uuid, v_period, v_type, d->>'role', p_scope_type, p_scope_id, k, nullif(d->>'source_date', '')::date,
          nullif(d->>'appointment_id', '')::uuid, nullif(d->>'sale_id', '')::uuid, nullif(d->>'sale_item_id', '')::uuid, nullif(d->>'receivable_id', '')::uuid,
          nullif(d->>'rule_id', '')::uuid, d_gross, nullif(d->>'base', '')::bigint, nullif(d->>'pct', '')::numeric, d_amt, v_origin, v_kind, p_reason,
          v_mem || case when v_period <> v_origin then jsonb_build_object('late_release', jsonb_build_object('wanted_period', v_origin, 'reason', 'mês de origem travado')) else '{}'::jsonb end,
          private.current_profile_id());
    else
      v_origin := coalesce(f.origin_period, f.period); v_period := private.share_target_period(p_clinic, v_origin, f.professional_id);
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

create or replace function private.share_month_calc(p_clinic uuid, p_prof uuid, p_period text, p_carry bigint, p_bal jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := private.share_period_start(p_period); v_end date := (private.share_period_start(p_period) + interval '1 month - 1 day')::date; v_dim integer;
  v_tb text; r record; rl public.fin_share_rules; v_derived jsonb := '[]'::jsonb;
  v_pct bigint; v_fx bigint; v_comm bigint; v_adj bigint; v_liq bigint; v_tier bigint := 0; v_fm bigint := 0; v_guar bigint := 0; v_usage bigint := 0;
  v_bal jsonb := coalesce(p_bal, '{}'::jsonb); v_variable bigint; v_b bigint; v_comp bigint; v_exc bigint; v_abate bigint; v_days integer; v_amt bigint; v_prog bigint; v_adjt bigint;
  v_gross bigint; fin public.fin_professional_finance; v_w jsonb := '[]'::jsonb; v_wt bigint := 0; w record; v_wamt bigint; v_net bigint; v_snap jsonb;
begin
  -- E6: extrato aprovado/pago está congelado: devolve a fotografia gravada na aprovação (regra, taxa ou retenção alterada depois não mexe no que foi aprovado)
  select cp.calc into v_snap from public.fin_closing_pros cp join public.fin_closings c on c.id = cp.closing_id
   where c.clinic_id = p_clinic and c.period = p_period and cp.professional_id = p_prof and cp.status in ('approved','paid');
  if v_snap is not null then return v_snap; end if;
  v_dim := (v_end - v_start) + 1;
  select s.tier_base into v_tb from public.fin_settings s where s.clinic_id = p_clinic;
  select coalesce(sum(l.amount_cents) filter (where l.line_type = 'pct'), 0), coalesce(sum(l.amount_cents) filter (where l.line_type = 'fixed_exec'), 0),
         coalesce(sum(l.amount_cents) filter (where l.line_type = 'commission'), 0), coalesce(sum(l.amount_cents) filter (where l.line_type = 'adjustment'), 0),
         coalesce(sum(l.gross_cents) filter (where l.line_type = 'pct'), 0)
    into v_pct, v_fx, v_comm, v_adj, v_liq
    from public.fin_share_lines l where l.clinic_id = p_clinic and l.professional_id = p_prof and l.period = p_period and l.line_key not like 'close:%';

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
         and (v_all or l.professional_id = any (v_self)) and l.line_key not like 'close:%'
       order by l.period desc, l.source_date desc nulls last, l.created_at desc
       limit least(greatest(coalesce(p_limit, 300), 1), 1000) offset greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb);
end $$;

-- ---------- 5. Congelamento por profissional e mês de destino das correções ----------
create or replace function private.share_pro_frozen(p_clinic uuid, p_period text, p_prof uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_closing_pros cp join public.fin_closings c on c.id = cp.closing_id
                  where c.clinic_id = p_clinic and c.period = p_period and cp.professional_id = p_prof and cp.status in ('approved','paid'))
$$;

-- Mês em que a correção de UM profissional cai: o mês de origem se estiver aberto E o extrato dele não estiver aprovado/pago; senão o próximo mês nessa condição.
create or replace function private.share_target_period(p_clinic uuid, p_origin text, p_prof uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v date := private.share_period_start(p_origin); i integer := 0; m text := p_origin;
begin
  loop
    exit when not private.share_locked(p_clinic, m) and not private.share_pro_frozen(p_clinic, m, p_prof);
    v := (v + interval '1 month')::date; i := i + 1; m := private.share_period(v);
    exit when i > 240;
  end loop;
  return m;
end $$;

-- ---------- 6. Internas do fechamento ----------
-- Participantes de atendimento realizado no mês sem regra vigente (bloqueia a aprovação, F2).
create or replace function private.close_unruled(p_clinic uuid, p_period text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('appointment_id', a.id, 'performed_on', a.performed_on, 'service_name', a.service_name, 'professional_id', p.professional_id,
           'professional_name', coalesce(pf.full_name, 'Profissional'), 'role', p.role) order by a.performed_on, a.created_at), '[]'::jsonb)
    from public.fin_appointment_participants p
    join public.fin_appointments a on a.id = p.appointment_id join public.fin_services sv on sv.id = a.service_id
    join public.professionals pr on pr.id = p.professional_id left join public.profiles pf on pf.id = pr.profile_id
   where a.clinic_id = p_clinic and a.status = 'done' and private.share_period(a.performed_on) = p_period
     and not exists (select 1 from private.share_match(a.clinic_id, p.professional_id, p.role, a.service_id, sv.category, a.performed_on, a.unit_id))
$$;

-- Fotografia do mês de um profissional (colunas da tabela do gestor + cálculo completo). Só vale para extrato ainda aberto.
create or replace function private.close_snapshot(p_clinic uuid, p_period text, p_prof uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_n integer;
begin
  r := private.share_month(p_clinic, p_prof, p_period);
  select count(distinct l.appointment_id) into v_n from public.fin_share_lines l
   where l.clinic_id = p_clinic and l.professional_id = p_prof and l.period = p_period and l.appointment_id is not null and l.line_key not like 'close:%';
  return jsonb_build_object('calc', r, 'appointments', v_n,
    'pct', (r->'persisted'->>'pct')::bigint + (r->>'tier_adjust_cents')::bigint, 'fixed_exec', (r->'persisted'->>'fixed_exec')::bigint,
    'fixed_monthly', (r->>'fixed_monthly_cents')::bigint, 'guarantee', (r->>'guarantee_cents')::bigint, 'commission', (r->'persisted'->>'commission')::bigint,
    'usage_fee', (r->>'usage_fee_cents')::bigint, 'adjustment', (r->'persisted'->>'adjustment')::bigint + (r->>'carry_in_cents')::bigint,
    'gross', (r->>'gross_total_cents')::bigint, 'withholding', (r->>'withholding_total_cents')::bigint, 'net', (r->>'net_total_cents')::bigint,
    'active', (v_n > 0 or (r->>'gross_total_cents')::bigint <> 0 or (r->>'carry_in_cents')::bigint <> 0 or jsonb_array_length(r->'derived') > 0
               or exists (select 1 from public.fin_share_lines l where l.clinic_id = p_clinic and l.professional_id = p_prof and l.period = p_period and l.line_key not like 'close:%')));
end $$;

-- Grava a fotografia no extrato (aberto). Se mudou algo, a versão sobe e o aceite volta a pendente (F7).
-- Devolve true se o extrato mudou. Contestação aberta mantém «contestado»; contestação toda respondida volta para «pendente» (o profissional reavalia).
create or replace function private.close_refresh_cp(p_cp uuid, p_force_reset boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings; s jsonb; v_changed boolean; v_open integer; v_reset boolean := false;
begin
  select * into cp from public.fin_closing_pros where id = p_cp;
  if cp.id is null or cp.status <> 'open' then return false; end if;
  select * into c from public.fin_closings where id = cp.closing_id;
  s := private.close_snapshot(cp.clinic_id, c.period, cp.professional_id);
  v_changed := cp.calc is distinct from (s->'calc') or cp.gross_cents <> (s->>'gross')::bigint or cp.net_cents <> (s->>'net')::bigint or cp.withholding_cents <> (s->>'withholding')::bigint;
  select count(*) into v_open from public.fin_closing_disputes d where d.closing_pro_id = cp.id and d.status = 'open';
  if p_force_reset or (v_changed and cp.acceptance in ('accepted','contested') and v_open = 0) or (cp.acceptance = 'contested' and v_open = 0) then v_reset := true; end if;
  if not v_changed and not v_reset then return false; end if;
  update public.fin_closing_pros set
      calc = s->'calc', appointments_count = (s->>'appointments')::integer, pct_cents = (s->>'pct')::bigint, fixed_exec_cents = (s->>'fixed_exec')::bigint,
      fixed_monthly_cents = (s->>'fixed_monthly')::bigint, guarantee_cents = (s->>'guarantee')::bigint, commission_cents = (s->>'commission')::bigint,
      usage_fee_cents = (s->>'usage_fee')::bigint, adjustment_cents = (s->>'adjustment')::bigint, gross_cents = (s->>'gross')::bigint,
      withholding_cents = (s->>'withholding')::bigint, net_cents = (s->>'net')::bigint,
      stmt_version = stmt_version + case when v_changed or v_reset then 1 else 0 end,
      acceptance = case when v_reset then 'pending' else acceptance end,
      accept_deadline = case when v_reset then private.fin_today() + c.accept_days else accept_deadline end,
      accepted_at = case when v_reset then null else accepted_at end, accepted_by = case when v_reset then null else accepted_by end,
      notified_at = case when v_reset then now() else notified_at end, updated_at = now()
    where id = cp.id;
  return true;
end $$;

-- Estado do fechamento a partir dos extratos: conferência enquanto houver extrato aberto; aprovado quando todos estão aprovados/pagos.
create or replace function private.close_sync(p_closing uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; v_open integer;
begin
  select * into c from public.fin_closings where id = p_closing;
  if c.id is null or c.status = 'travado' then return; end if;
  select count(*) into v_open from public.fin_closing_pros where closing_id = c.id and status = 'open';
  if v_open = 0 and exists (select 1 from public.fin_closing_pros where closing_id = c.id) then
    if c.status <> 'aprovado' then update public.fin_closings set status = 'aprovado', approved_at = now(), approved_by = private.current_profile_id(), updated_at = now() where id = c.id; end if;
  elsif c.status <> 'conferencia' then
    update public.fin_closings set status = 'conferencia', approved_at = null, approved_by = null, updated_at = now() where id = c.id;
  end if;
end $$;

-- Lançamentos do mês de um profissional como o extrato mostra (paciente com a máscara da clínica). Quem chama já conferiu o acesso.
create or replace function private.close_lines(p_clinic uuid, p_prof uuid, p_period text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_disp text;
begin
  select coalesce(patient_display, 'initials') into v_disp from public.fin_settings where clinic_id = p_clinic;
  return coalesce((
    select jsonb_agg(q.x order by q.sort_date nulls last, q.sort_created) from (
      select jsonb_build_object(
        'id', l.id, 'period', l.period, 'line_type', l.line_type, 'role', l.role, 'kind', l.kind, 'base_cents', l.base_cents, 'gross_cents', l.gross_cents, 'pct', l.pct,
        'amount_cents', l.amount_cents, 'source_date', l.source_date, 'origin_period', l.origin_period, 'reason', l.reason, 'created_at', l.created_at, 'appointment_id', l.appointment_id,
        'unit_name', u.name, 'service_name', l.memory->>'service', 'memory', l.memory,
        'patient', case coalesce(v_disp, 'initials') when 'hidden' then null when 'full' then ppf.full_name else private.share_initials(ppf.full_name) end) as x,
        l.source_date as sort_date, l.created_at as sort_created
        from public.fin_share_lines l
        left join public.clinic_units u on u.id = l.unit_id
        left join public.fin_appointments a on a.id = l.appointment_id left join public.fin_sales s on s.id = l.sale_id
        left join public.patients pt on pt.id = coalesce(a.patient_id, s.patient_id) left join public.profiles ppf on ppf.id = pt.profile_id
       where l.clinic_id = p_clinic and l.professional_id = p_prof and l.period = p_period and l.line_key not like 'close:%') q), '[]'::jsonb);
end $$;

create or replace function private.close_is_self(p_cp public.fin_closing_pros) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.appt_is_pro(p_cp.clinic_id) and private.fin_is_self_professional(p_cp.professional_id)
$$;

-- NF: não exigida / pendente / recebida.
create or replace function private.close_nf_status(p_req boolean, p_number text, p_path text) returns text
language sql immutable set search_path = '' as $$
  select case when not p_req then 'not_required' when p_number is not null and p_path is not null then 'received' else 'pending' end
$$;

-- Linha da tabela do gestor a partir do extrato.
create or replace function private.close_row_json(cp public.fin_closing_pros, c public.fin_closings, p_name text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', cp.id, 'professional_id', cp.professional_id, 'name', p_name, 'bond_type', cp.bond_type, 'appointments', cp.appointments_count,
    'pct_cents', cp.pct_cents, 'fixed_exec_cents', cp.fixed_exec_cents, 'fixed_monthly_cents', cp.fixed_monthly_cents, 'guarantee_cents', cp.guarantee_cents,
    'commission_cents', cp.commission_cents, 'usage_fee_cents', cp.usage_fee_cents, 'adjustment_cents', cp.adjustment_cents,
    'gross_cents', cp.gross_cents, 'withholding_cents', cp.withholding_cents, 'net_cents', cp.net_cents, 'withholdings', coalesce(cp.calc->'withholdings', '[]'::jsonb),
    'negative', coalesce((cp.calc->>'negative')::boolean, false), 'status', cp.status, 'acceptance', cp.acceptance, 'accept_deadline', cp.accept_deadline,
    'deadline_passed', (cp.acceptance = 'pending' and private.fin_today() > cp.accept_deadline), 'notified_at', cp.notified_at, 'stmt_version', cp.stmt_version,
    'requires_invoice', cp.requires_invoice, 'nf_status', private.close_nf_status(cp.requires_invoice, cp.invoice_number, cp.invoice_path),
    'invoice_number', cp.invoice_number, 'invoice_date', cp.invoice_date, 'invoice_path', cp.invoice_path,
    'paid_on', cp.paid_on, 'pay_method', cp.pay_method, 'pay_note', cp.pay_note, 'proof_path', cp.proof_path,
    'payment_status', case when cp.status = 'paid' then 'paid' when cp.net_cents > 0 then 'pending' else 'none' end,
    'open_disputes', (select count(*) from public.fin_closing_disputes d where d.closing_pro_id = cp.id and d.status = 'open'),
    'answered_disputes', (select count(*) from public.fin_closing_disputes d where d.closing_pro_id = cp.id and d.status = 'answered'))
$$;

-- Razão do mês: grava as linhas mensais do extrato congelado (fotografia) em fin_share_lines; chamado ao travar.
create or replace function private.close_do_lock(p_closing uuid, p_auto boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; cp record; d jsonb; w jsonb; i integer; v_end date; v_n integer := 0; v_ver text;
begin
  select * into c from public.fin_closings where id = p_closing;
  v_end := (private.share_period_start(c.period) + interval '1 month - 1 day')::date;
  insert into public.fin_share_period_locks (clinic_id, period, locked_by) values (c.clinic_id, c.period, private.current_profile_id()) on conflict (clinic_id, period) do nothing;
  update public.fin_closings set status = 'travado', locked_at = now(), locked_by = private.current_profile_id(), lock_no = lock_no + 1, updated_at = now() where id = c.id returning * into c;
  for cp in select * from public.fin_closing_pros where closing_id = c.id order by id loop
    i := 0;
    for d in select e from jsonb_array_elements(cp.calc->'derived') e loop
      i := i + 1; v_n := v_n + 1;
      insert into public.fin_share_lines (clinic_id, professional_id, period, line_type, scope_type, scope_id, line_key, source_date, rule_id, base_cents, amount_cents, origin_period, kind, reason, memory, created_by)
        values (c.clinic_id, cp.professional_id, c.period, d->>'line_type', 'manual', cp.id, 'close:' || c.lock_no || ':' || cp.id || ':' || i, v_end, nullif(d->>'rule_id', '')::uuid,
                nullif(d->>'base_cents', '')::bigint, (d->>'amount_cents')::bigint, c.period, 'manual', 'Fechamento ' || c.period,
                coalesce(d->'memory', '{}'::jsonb) || jsonb_build_object('closing_id', c.id, 'lock_no', c.lock_no, 'stmt_version', cp.stmt_version), private.current_profile_id());
    end loop;
    for w in select e from jsonb_array_elements(cp.calc->'withholdings') e where (e->>'amount_cents')::bigint <> 0 loop
      i := i + 1; v_n := v_n + 1;
      insert into public.fin_share_lines (clinic_id, professional_id, period, line_type, scope_type, scope_id, line_key, source_date, amount_cents, origin_period, kind, reason, memory, created_by)
        values (c.clinic_id, cp.professional_id, c.period, 'withholding', 'manual', cp.id, 'close:' || c.lock_no || ':' || cp.id || ':' || i, v_end, -(w->>'amount_cents')::bigint, c.period, 'manual', 'Fechamento ' || c.period,
                w || jsonb_build_object('closing_id', c.id, 'lock_no', c.lock_no, 'stmt_version', cp.stmt_version), private.current_profile_id());
    end loop;
  end loop;
  perform private.fin_log(c.clinic_id, null, 'closing', c.id, 'update', jsonb_build_object('status', 'aprovado'),
    jsonb_build_object('status', 'travado', 'period', c.period, 'lock_no', c.lock_no, 'auto', p_auto, 'ledger_lines', v_n), coalesce(p_reason, case when p_auto then 'Todos os extratos pagos: mês travado automaticamente' else 'Mês travado' end));
end $$;

-- ---------- 7. RPCs de leitura ----------
-- Tabela do gestor do mês (uma linha por profissional) + pendências que bloqueiam/avisam. Sem fechamento iniciado: closing = null.
create or replace function public.fin_closing_get(p_clinic uuid, p_period text, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.fin_closings; v_rows jsonb; v_unruled jsonb; v_end date; v_start date;
begin
  perform private.fin_gate(p_clinic, 'share_lines', null, false);
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  v_start := private.share_period_start(p_period); v_end := (v_start + interval '1 month - 1 day')::date;
  select * into c from public.fin_closings where clinic_id = p_clinic and period = p_period;
  v_unruled := private.close_unruled(p_clinic, p_period);
  if c.id is not null then
    select coalesce(jsonb_agg(private.close_row_json(cp, c, coalesce(pf.full_name, 'Profissional')) order by pf.full_name, cp.id), '[]'::jsonb) into v_rows
      from public.fin_closing_pros cp join public.professionals pr on pr.id = cp.professional_id left join public.profiles pf on pf.id = pr.profile_id
     where cp.closing_id = c.id
       and (p_unit is null or exists (select 1 from public.fin_share_lines l where l.clinic_id = p_clinic and l.professional_id = cp.professional_id and l.period = p_period and l.unit_id = p_unit and l.line_key not like 'close:%'));
  else
    v_rows := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'period', p_period,
    'closing', case when c.id is null then null else jsonb_build_object('id', c.id, 'status', c.status, 'accept_days', c.accept_days, 'started_at', c.started_at, 'approved_at', c.approved_at,
        'locked_at', c.locked_at, 'lock_no', c.lock_no, 'unlocked_at', c.unlocked_at, 'unlock_reason', c.unlock_reason) end,
    'period_ended', p_period < private.share_period(private.fin_today()),
    'rows', v_rows,
    'totals', jsonb_build_object(
      'appointments', coalesce((select sum((r->>'appointments')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'pct_cents', coalesce((select sum((r->>'pct_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'fixed_exec_cents', coalesce((select sum((r->>'fixed_exec_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'fixed_monthly_cents', coalesce((select sum((r->>'fixed_monthly_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'guarantee_cents', coalesce((select sum((r->>'guarantee_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'commission_cents', coalesce((select sum((r->>'commission_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'usage_fee_cents', coalesce((select sum((r->>'usage_fee_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'adjustment_cents', coalesce((select sum((r->>'adjustment_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'gross_cents', coalesce((select sum((r->>'gross_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'withholding_cents', coalesce((select sum((r->>'withholding_cents')::bigint) from jsonb_array_elements(v_rows) r), 0),
      'net_cents', coalesce((select sum((r->>'net_cents')::bigint) from jsonb_array_elements(v_rows) r), 0)),
    'pendencies', jsonb_build_object(
      'unruled', v_unruled, 'unruled_count', jsonb_array_length(v_unruled),
      'appointments_without_sale', (select count(*) from public.fin_appointments a where a.clinic_id = p_clinic and a.status = 'done' and a.performed_on between v_start and v_end
                                      and a.sale_item_id is null and a.patient_package_item_id is null),
      'overdue_receivables', (select count(*) from public.fin_receivables r where r.clinic_id = p_clinic and r.status = 'expected' and r.expected_date <= v_end),
      'negative_count', (select count(*) from jsonb_array_elements(v_rows) r where (r->>'negative')::boolean)),
    'can', jsonb_build_object('prepare', private.fin_can(p_clinic, 'close_prepare', null, true), 'decide', private.fin_can(p_clinic, 'close_decide', null, true),
      'pay', private.fin_can(p_clinic, 'close_pay', null, true), 'unlock', private.is_clinic_admin(p_clinic)));
end $$;

-- Extrato de um profissional no fechamento: Gestor/Financeiro/Admin ou o PRÓPRIO profissional (nunca o de outro).
create or replace function public.fin_closing_statement(p_cp uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings; v_name text; v_lines jsonb; v_items bigint; v_self boolean; fin public.fin_professional_finance;
begin
  select * into cp from public.fin_closing_pros where id = p_cp;
  if cp.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_self := private.close_is_self(cp);
  if not (private.fin_can(cp.clinic_id, 'share_lines', null, false) or v_self) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.fin_closings where id = cp.closing_id;
  select coalesce(pf.full_name, 'Profissional') into v_name from public.professionals pr left join public.profiles pf on pf.id = pr.profile_id where pr.id = cp.professional_id;
  v_lines := private.close_lines(cp.clinic_id, cp.professional_id, c.period);
  -- conferência (F13): o extrato é a soma dos lançamentos do mês + as linhas mensais; precisa fechar com o total bruto da tabela do gestor
  v_items := coalesce((select sum((l->>'amount_cents')::bigint) from jsonb_array_elements(v_lines) l), 0)
           + coalesce((select sum((d->>'amount_cents')::bigint) from jsonb_array_elements(cp.calc->'derived') d), 0);
  select * into fin from public.fin_professional_finance f where f.professional_id = cp.professional_id;
  return jsonb_build_object(
    'closing', jsonb_build_object('id', c.id, 'period', c.period, 'status', c.status, 'locked', c.status = 'travado'),
    'row', private.close_row_json(cp, c, v_name),
    'professional', jsonb_build_object('id', cp.professional_id, 'name', v_name, 'bond_type', coalesce(cp.bond_type, fin.bond_type), 'simples_optant', coalesce(fin.simples_optant, false)),
    'derived', coalesce(cp.calc->'derived', '[]'::jsonb), 'withholdings', coalesce(cp.calc->'withholdings', '[]'::jsonb),
    'lines', v_lines,
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'share_line_id', d.share_line_id, 'line_label', d.line_label, 'comment', d.comment, 'status', d.status, 'response', d.response,
                  'created_at', d.created_at, 'answered_at', d.answered_at, 'stmt_version', d.stmt_version) order by d.created_at) from public.fin_closing_disputes d where d.closing_pro_id = cp.id), '[]'::jsonb),
    'check', jsonb_build_object('items_total_cents', v_items, 'gross_cents', cp.gross_cents, 'matches', v_items = cp.gross_cents),
    'is_self', v_self,
    'can', jsonb_build_object('decide', private.fin_can(cp.clinic_id, 'close_decide', null, true), 'pay', private.fin_can(cp.clinic_id, 'close_pay', null, true), 'prepare', private.fin_can(cp.clinic_id, 'close_prepare', null, true)));
end $$;

-- Meus extratos (profissional): lista dos fechamentos em que o chamador tem extrato.
create or replace function public.fin_closing_my_list(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) or not private.appt_is_pro(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', cp.id, 'period', c.period, 'closing_status', c.status, 'status', cp.status, 'acceptance', cp.acceptance, 'accept_deadline', cp.accept_deadline,
             'deadline_passed', (cp.acceptance = 'pending' and private.fin_today() > cp.accept_deadline), 'gross_cents', cp.gross_cents, 'withholding_cents', cp.withholding_cents, 'net_cents', cp.net_cents,
             'requires_invoice', cp.requires_invoice, 'nf_status', private.close_nf_status(cp.requires_invoice, cp.invoice_number, cp.invoice_path), 'paid_on', cp.paid_on,
             'open_disputes', (select count(*) from public.fin_closing_disputes d where d.closing_pro_id = cp.id and d.status = 'open')) order by c.period desc)
      from public.fin_closing_pros cp join public.fin_closings c on c.id = cp.closing_id join public.professionals pr on pr.id = cp.professional_id
     where cp.clinic_id = p_clinic and pr.profile_id = private.current_profile_id()), '[]'::jsonb);
end $$;

-- Arquivo de pagamento (F14): nome, documento, chave Pix/banco e líquido de cada profissional APROVADO e ainda não pago. Dado pessoal: o acesso fica no histórico.
create or replace function public.fin_closing_payment_file(p_closing uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; v_rows jsonb;
begin
  select * into c from public.fin_closings where id = p_closing;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'close_pay', null, true);
  select coalesce(jsonb_agg(jsonb_build_object('closing_pro_id', cp.id, 'name', coalesce(pf.full_name, 'Profissional'), 'tax_id', f.tax_id, 'pix_key', f.pix_key, 'bank_name', f.bank_name,
           'bank_agency', f.bank_agency, 'bank_account', f.bank_account, 'net_cents', cp.net_cents) order by pf.full_name), '[]'::jsonb) into v_rows
    from public.fin_closing_pros cp join public.professionals pr on pr.id = cp.professional_id left join public.profiles pf on pf.id = pr.profile_id
    left join public.fin_professional_finance f on f.professional_id = cp.professional_id
   where cp.closing_id = c.id and cp.status = 'approved' and cp.net_cents > 0;
  perform private.fin_log(c.clinic_id, null, 'payment_file', c.id, 'view_sensitive', null, jsonb_build_object('period', c.period, 'rows', jsonb_array_length(v_rows)), 'Arquivo de pagamento do fechamento ' || c.period);
  return jsonb_build_object('period', c.period, 'rows', v_rows);
end $$;

-- ---------- 8. RPCs de escrita ----------
-- Iniciar o fechamento (a partir do dia 1 do mês seguinte): gera o extrato de cada profissional com movimento no mês. Idempotente.
create or replace function public.fin_closing_start(p_clinic uuid, p_period text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; pr record; s jsonb; v_days integer; v_n integer := 0; fin public.fin_professional_finance;
begin
  perform private.fin_gate(p_clinic, 'close_prepare', null, true);
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  if p_period >= private.share_period(private.fin_today()) then raise exception 'PERIOD_NOT_ENDED: o fechamento começa no dia 1 do mês seguinte' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('closing:' || p_clinic::text || ':' || p_period, 6));
  select * into c from public.fin_closings where clinic_id = p_clinic and period = p_period;
  if c.id is not null then return jsonb_build_object('id', c.id, 'created', false, 'professionals', (select count(*) from public.fin_closing_pros where closing_id = c.id)); end if;
  select coalesce(s2.accept_days, 5) into v_days from (select 1) d left join public.fin_settings s2 on s2.clinic_id = p_clinic;
  insert into public.fin_closings (clinic_id, period, accept_days, started_by) values (p_clinic, p_period, v_days, private.current_profile_id()) returning * into c;
  for pr in select p.id from public.professionals p where p.clinic_id = p_clinic order by p.id loop
    s := private.close_snapshot(p_clinic, p_period, pr.id);
    continue when not (s->>'active')::boolean;
    select * into fin from public.fin_professional_finance f where f.professional_id = pr.id;
    insert into public.fin_closing_pros (closing_id, clinic_id, professional_id, calc, appointments_count, pct_cents, fixed_exec_cents, fixed_monthly_cents, guarantee_cents, commission_cents, usage_fee_cents,
        adjustment_cents, gross_cents, withholding_cents, net_cents, bond_type, requires_invoice, accept_deadline, notified_at)
      values (c.id, p_clinic, pr.id, s->'calc', (s->>'appointments')::integer, (s->>'pct')::bigint, (s->>'fixed_exec')::bigint, (s->>'fixed_monthly')::bigint, (s->>'guarantee')::bigint, (s->>'commission')::bigint,
        (s->>'usage_fee')::bigint, (s->>'adjustment')::bigint, (s->>'gross')::bigint, (s->>'withholding')::bigint, (s->>'net')::bigint, fin.bond_type, coalesce(fin.requires_invoice, false),
        private.fin_today() + v_days, now());
    v_n := v_n + 1;
  end loop;
  perform private.close_sync(c.id);
  perform private.fin_log(p_clinic, null, 'closing', c.id, 'create', null, jsonb_build_object('period', p_period, 'professionals', v_n, 'accept_days', v_days), 'Fechamento de ' || p_period || ' iniciado');
  return jsonb_build_object('id', c.id, 'created', true, 'professionals', v_n);
end $$;

-- Atualizar (regenerar) os extratos em conferência: depois de corrigir regra, participante ou atendimento (F7). Extrato que mudou volta para aceite.
create or replace function public.fin_closing_refresh(p_closing uuid, p_professional uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; cp record; pr record; s jsonb; v_changed integer := 0; v_added integer := 0; fin public.fin_professional_finance; v_days integer;
begin
  select * into c from public.fin_closings where id = p_closing for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'close_prepare', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado; só se altera destravando (Owner, com motivo)' using errcode = '42501'; end if;
  for cp in select id from public.fin_closing_pros where closing_id = c.id and status = 'open' and (p_professional is null or professional_id = p_professional) order by id loop
    if private.close_refresh_cp(cp.id) then v_changed := v_changed + 1; end if;
  end loop;
  -- profissional que passou a ter movimento no mês depois do início
  if p_professional is null then
    for pr in select p.id from public.professionals p where p.clinic_id = c.clinic_id and not exists (select 1 from public.fin_closing_pros x where x.closing_id = c.id and x.professional_id = p.id) order by p.id loop
      s := private.close_snapshot(c.clinic_id, c.period, pr.id);
      continue when not (s->>'active')::boolean;
      select * into fin from public.fin_professional_finance f where f.professional_id = pr.id;
      insert into public.fin_closing_pros (closing_id, clinic_id, professional_id, calc, appointments_count, pct_cents, fixed_exec_cents, fixed_monthly_cents, guarantee_cents, commission_cents, usage_fee_cents,
          adjustment_cents, gross_cents, withholding_cents, net_cents, bond_type, requires_invoice, accept_deadline, notified_at)
        values (c.id, c.clinic_id, pr.id, s->'calc', (s->>'appointments')::integer, (s->>'pct')::bigint, (s->>'fixed_exec')::bigint, (s->>'fixed_monthly')::bigint, (s->>'guarantee')::bigint, (s->>'commission')::bigint,
          (s->>'usage_fee')::bigint, (s->>'adjustment')::bigint, (s->>'gross')::bigint, (s->>'withholding')::bigint, (s->>'net')::bigint, fin.bond_type, coalesce(fin.requires_invoice, false),
          private.fin_today() + c.accept_days, now());
      v_added := v_added + 1;
    end loop;
  end if;
  perform private.close_sync(c.id);
  perform private.fin_log(c.clinic_id, null, 'closing', c.id, 'update', null, jsonb_build_object('period', c.period, 'changed', v_changed, 'added', v_added), 'Extratos atualizados');
  return jsonb_build_object('changed', v_changed, 'added', v_added);
end $$;

-- Notificar: reenvia o aviso de extrato disponível aos profissionais com extrato em conferência.
create or replace function public.fin_closing_notify(p_closing uuid, p_professionals uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; v_n integer;
begin
  select * into c from public.fin_closings where id = p_closing for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'close_prepare', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  update public.fin_closing_pros set notified_at = now(), updated_at = now() where closing_id = c.id and status = 'open' and (p_professionals is null or professional_id = any (p_professionals));
  get diagnostics v_n = row_count;
  perform private.fin_log(c.clinic_id, null, 'closing', c.id, 'update', null, jsonb_build_object('period', c.period, 'notified', v_n), 'Profissionais notificados do extrato');
  return v_n;
end $$;

-- Aceite do profissional (F7/F8): só o próprio, enquanto o extrato está em conferência.
create or replace function public.fin_closing_accept(p_cp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings;
begin
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = p_cp) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = p_cp;
  if not private.close_is_self(cp) then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  if cp.status <> 'open' then raise exception 'STATEMENT_NOT_OPEN: extrato já aprovado' using errcode = '22023'; end if;
  if cp.acceptance <> 'pending' then raise exception 'NOT_PENDING: o extrato não está aguardando aceite' using errcode = '22023'; end if;
  update public.fin_closing_pros set acceptance = 'accepted', accepted_at = now(), accepted_by = private.current_profile_id(), updated_at = now() where id = cp.id;
  perform private.fin_log(cp.clinic_id, null, 'closing_pro', cp.id, 'update', jsonb_build_object('acceptance', cp.acceptance), jsonb_build_object('acceptance', 'accepted', 'period', c.period, 'stmt_version', cp.stmt_version), 'Aceite do extrato');
end $$;

-- Contestação (F7): comentário obrigatório, por linha ou geral. O gestor vê na linha e responde.
create or replace function public.fin_closing_contest(p_cp uuid, p_comment text, p_line uuid default null, p_line_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings; v_id uuid; v_cm text := btrim(coalesce(p_comment, ''));
begin
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = p_cp) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = p_cp;
  if not private.close_is_self(cp) then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  if cp.status <> 'open' then raise exception 'STATEMENT_NOT_OPEN: extrato já aprovado' using errcode = '22023'; end if;
  if char_length(v_cm) < 3 or char_length(v_cm) > 500 then raise exception 'COMMENT_REQUIRED' using errcode = '22023'; end if;
  if p_line is not null and not exists (select 1 from public.fin_share_lines l where l.id = p_line and l.clinic_id = cp.clinic_id and l.professional_id = cp.professional_id and l.period = c.period) then
    raise exception 'INVALID_LINE' using errcode = '22023';
  end if;
  insert into public.fin_closing_disputes (closing_pro_id, clinic_id, professional_id, share_line_id, line_label, comment, stmt_version, created_by)
    values (cp.id, cp.clinic_id, cp.professional_id, p_line, nullif(left(btrim(coalesce(p_line_label, '')), 120), ''), v_cm, cp.stmt_version, private.current_profile_id()) returning id into v_id;
  update public.fin_closing_pros set acceptance = 'contested', accepted_at = null, accepted_by = null, updated_at = now() where id = cp.id;
  perform private.fin_log(cp.clinic_id, null, 'closing_dispute', v_id, 'create', jsonb_build_object('acceptance', cp.acceptance), jsonb_build_object('acceptance', 'contested', 'period', c.period, 'line_id', p_line, 'comment', v_cm), 'Contestação do extrato');
  return v_id;
end $$;

-- Resposta do gestor à contestação. Depois de corrigir a origem, «Atualizar extratos» regenera e devolve o extrato para aceite.
create or replace function public.fin_closing_answer(p_dispute uuid, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.fin_closing_disputes; cp public.fin_closing_pros; c public.fin_closings; v_rs text := btrim(coalesce(p_response, ''));
begin
  select * into d from public.fin_closing_disputes where id = p_dispute;
  if d.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = d.closing_pro_id) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = d.closing_pro_id;
  perform private.fin_gate(cp.clinic_id, 'close_decide', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  select * into d from public.fin_closing_disputes where id = p_dispute;
  if d.status <> 'open' then raise exception 'ALREADY_ANSWERED' using errcode = '22023'; end if;
  if char_length(v_rs) < 3 or char_length(v_rs) > 500 then raise exception 'RESPONSE_REQUIRED' using errcode = '22023'; end if;
  update public.fin_closing_disputes set status = 'answered', response = v_rs, answered_by = private.current_profile_id(), answered_at = now() where id = d.id;
  perform private.fin_log(cp.clinic_id, null, 'closing_dispute', d.id, 'update', jsonb_build_object('status', 'open'), jsonb_build_object('status', 'answered', 'response', v_rs, 'period', c.period), 'Resposta à contestação');
end $$;

-- Ajuste manual com motivo obrigatório (bônus, desconto, adiantamento): linha «adjustment» no mês do fechamento e extrato regenerado.
create or replace function public.fin_closing_adjust(p_cp uuid, p_kind text, p_amount_cents bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings; v_amt bigint; v_rs text := btrim(coalesce(p_reason, ''));
begin
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = p_cp) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = p_cp;
  perform private.fin_gate(cp.clinic_id, 'close_decide', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  if cp.status <> 'open' then raise exception 'STATEMENT_NOT_OPEN: extrato já aprovado' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('bonus','discount','advance') then raise exception 'INVALID_KIND' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 1000000000 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  if char_length(v_rs) < 3 or char_length(v_rs) > 300 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_amt := case when p_kind = 'bonus' then p_amount_cents else -p_amount_cents end;
  insert into public.fin_share_lines (clinic_id, professional_id, period, line_type, scope_type, scope_id, line_key, source_date, amount_cents, origin_period, kind, reason, memory, created_by)
    values (cp.clinic_id, cp.professional_id, c.period, 'adjustment', 'manual', cp.id, 'adj:' || gen_random_uuid(), private.fin_today(), v_amt, c.period, 'manual', v_rs,
            jsonb_build_object('manual', true, 'kind', p_kind, 'service', case p_kind when 'bonus' then 'Bônus' when 'discount' then 'Desconto' else 'Adiantamento' end,
                               'formula', format('ajuste manual (%s): %s', p_kind, v_amt), 'reason', v_rs), private.current_profile_id());
  perform private.fin_log(cp.clinic_id, null, 'closing_pro', cp.id, 'update', null, jsonb_build_object('adjustment_cents', v_amt, 'kind', p_kind, 'period', c.period), v_rs);
  perform private.close_refresh_cp(cp.id);
end $$;

-- Aprovar (Gestor/Admin): valores congelados para pagamento. Bloqueia com produção «sem regra» (F2). Sem aceite só depois do prazo (F8: «aprovado sem aceite»).
create or replace function public.fin_closing_approve(p_closing uuid, p_professionals uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; cp record; s jsonb; v_unruled jsonb; v_ok integer := 0; v_skip jsonb := '[]'::jsonb; v_reason text; v_name text; v_acc text;
begin
  select * into c from public.fin_closings where id = p_closing for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'close_decide', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  v_unruled := private.close_unruled(c.clinic_id, c.period);
  if jsonb_array_length(v_unruled) > 0 then raise exception 'UNRULED_PENDING: % participante(s) de atendimento sem regra de repasse; crie a regra ou marque «sem repasse»', jsonb_array_length(v_unruled) using errcode = '22023'; end if;
  for cp in select x.* from public.fin_closing_pros x where x.closing_id = c.id and x.status = 'open' and (p_professionals is null or x.professional_id = any (p_professionals)) order by x.id loop
    select coalesce(pf.full_name, 'Profissional') into v_name from public.professionals pr left join public.profiles pf on pf.id = pr.profile_id where pr.id = cp.professional_id;
    v_reason := null; v_acc := cp.acceptance;
    if cp.acceptance = 'contested' then v_reason := 'CONTESTED';
    elsif cp.acceptance = 'pending' then
      if private.fin_today() > cp.accept_deadline then v_acc := 'approved_without'; else v_reason := 'ACCEPTANCE_PENDING'; end if;
    end if;
    if v_reason is null then
      s := private.close_snapshot(c.clinic_id, c.period, cp.professional_id);
      if (s->'calc') is distinct from cp.calc or (s->>'gross')::bigint <> cp.gross_cents or (s->>'net')::bigint <> cp.net_cents or (s->>'withholding')::bigint <> cp.withholding_cents then v_reason := 'STATEMENT_CHANGED'; end if;
    end if;
    if v_reason is not null then
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('closing_pro_id', cp.id, 'professional_id', cp.professional_id, 'name', v_name, 'reason', v_reason));
    else
      update public.fin_closing_pros set status = 'approved', acceptance = v_acc, approved_at = now(), approved_by = private.current_profile_id(), updated_at = now() where id = cp.id;
      perform private.fin_log(c.clinic_id, null, 'closing_pro', cp.id, 'update', jsonb_build_object('status', 'open', 'acceptance', cp.acceptance),
        jsonb_build_object('status', 'approved', 'acceptance', v_acc, 'period', c.period, 'gross_cents', cp.gross_cents, 'net_cents', cp.net_cents, 'stmt_version', cp.stmt_version),
        case when v_acc = 'approved_without' then 'Aprovado sem aceite (prazo vencido em ' || cp.accept_deadline || ')' else 'Extrato aprovado' end);
      v_ok := v_ok + 1;
    end if;
  end loop;
  perform private.close_sync(c.id);
  return jsonb_build_object('approved', v_ok, 'skipped', v_skip);
end $$;

-- NF do profissional (número, data e arquivo): pelo próprio profissional ou por Gestor/Financeiro. Não muda depois de travado.
create or replace function public.fin_closing_invoice_save(p_cp uuid, p_number text, p_date date, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings; v_no text := btrim(coalesce(p_number, '')); v_self boolean; v_prev jsonb;
begin
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = p_cp) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = p_cp;
  v_self := private.close_is_self(cp);
  if not (v_self or private.fin_can(cp.clinic_id, 'close_pay', null, true)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  if not cp.requires_invoice then raise exception 'INVOICE_NOT_REQUIRED' using errcode = '22023'; end if;
  if char_length(v_no) < 1 or char_length(v_no) > 40 then raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = '22023'; end if;
  if p_date is null or p_date > private.fin_today() then raise exception 'INVALID_INVOICE_DATE' using errcode = '22023'; end if;
  if p_path is null or p_path not like cp.clinic_id::text || '/' || cp.id::text || '/%' then raise exception 'INVOICE_FILE_REQUIRED' using errcode = '22023'; end if;
  v_prev := jsonb_build_object('number', cp.invoice_number, 'date', cp.invoice_date, 'path', cp.invoice_path);
  update public.fin_closing_pros set invoice_number = v_no, invoice_date = p_date, invoice_path = p_path, invoice_by = private.current_profile_id(), invoice_at = now(), updated_at = now() where id = cp.id;
  perform private.fin_log(cp.clinic_id, null, 'closing_pro', cp.id, 'update', v_prev, jsonb_build_object('invoice_number', v_no, 'invoice_date', p_date, 'invoice_path', p_path, 'period', c.period, 'by_professional', v_self), 'NF do profissional registrada');
end $$;

-- Pagamento (Gestor/Financeiro/Admin): data, forma e comprovante; exige NF quando o profissional é obrigado. Quando todos estão pagos, o mês trava sozinho.
create or replace function public.fin_closing_pay(p_cp uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cp public.fin_closing_pros; c public.fin_closings; v_on date := nullif(p_data->>'paid_on', '')::date; v_method text := nullif(p_data->>'method', ''); v_proof text := nullif(p_data->>'proof_path', '');
        v_note text := nullif(btrim(coalesce(p_data->>'note', '')), ''); v_locked boolean := false;
begin
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = p_cp) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = p_cp;
  perform private.fin_gate(cp.clinic_id, 'close_pay', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  if cp.status = 'paid' then raise exception 'ALREADY_PAID' using errcode = '22023'; end if;
  if cp.status <> 'approved' then raise exception 'NOT_APPROVED: aprove o extrato antes de pagar' using errcode = '22023'; end if;
  if cp.net_cents <= 0 then raise exception 'NOTHING_TO_PAY' using errcode = '22023'; end if;
  if cp.requires_invoice and private.close_nf_status(true, cp.invoice_number, cp.invoice_path) <> 'received' then raise exception 'INVOICE_REQUIRED: a NF do profissional ainda não foi recebida' using errcode = '22023'; end if;
  if v_on is null or v_on > private.fin_today() then raise exception 'INVALID_PAID_ON' using errcode = '22023'; end if;
  if v_method is null or v_method not in ('pix','transfer','cash','other') then raise exception 'INVALID_METHOD' using errcode = '22023'; end if;
  if v_proof is null or v_proof not like cp.clinic_id::text || '/' || cp.id::text || '/%' then raise exception 'PROOF_REQUIRED' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 200 then raise exception 'NOTE_TOO_LONG' using errcode = '22023'; end if;
  update public.fin_closing_pros set status = 'paid', paid_on = v_on, pay_method = v_method, proof_path = v_proof, pay_note = v_note, paid_by = private.current_profile_id(), paid_registered_at = now(), updated_at = now() where id = cp.id;
  perform private.fin_log(cp.clinic_id, null, 'closing_pro', cp.id, 'update', jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'paid', 'period', c.period, 'net_cents', cp.net_cents, 'paid_on', v_on, 'method', v_method, 'proof_path', v_proof), 'Pagamento registrado');
  -- todos pagos (extratos com líquido a pagar) e fechamento aprovado: trava o mês
  perform private.close_sync(c.id);
  select * into c from public.fin_closings where id = c.id;
  if c.status = 'aprovado' and not exists (select 1 from public.fin_closing_pros x where x.closing_id = c.id and x.status = 'approved' and x.net_cents > 0) then
    perform private.close_do_lock(c.id, true, null); v_locked := true;
  end if;
  return jsonb_build_object('paid', true, 'locked', v_locked);
end $$;

-- Travar o mês (Gestor/Admin): exige todos os extratos aprovados; grava o razão do mês e a trava (o motor passa a mandar correções ao próximo mês aberto).
create or replace function public.fin_closing_lock(p_closing uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings;
begin
  select * into c from public.fin_closings where id = p_closing for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(c.clinic_id, 'close_decide', null, true);
  if c.status = 'travado' then raise exception 'ALREADY_LOCKED' using errcode = '22023'; end if;
  perform private.close_sync(c.id);
  select * into c from public.fin_closings where id = c.id;
  if c.status <> 'aprovado' then raise exception 'NOT_ALL_APPROVED: aprove todos os extratos antes de travar o mês' using errcode = '22023'; end if;
  perform private.close_do_lock(c.id, false, nullif(btrim(coalesce(p_reason, '')), ''));
end $$;

-- Destravar (F9): só Owner/Admin, motivo obrigatório. Estorna o razão do mês com linhas novas; extratos não pagos voltam para conferência e aceite.
create or replace function public.fin_closing_unlock(p_closing uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.fin_closings; cp record; v_rs text := btrim(coalesce(p_reason, '')); v_n integer;
begin
  select * into c from public.fin_closings where id = p_closing for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.is_clinic_admin(c.clinic_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status <> 'travado' then raise exception 'NOT_LOCKED' using errcode = '22023'; end if;
  if char_length(v_rs) < 3 or char_length(v_rs) > 300 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  insert into public.fin_share_lines (clinic_id, unit_id, professional_id, period, line_type, role, scope_type, scope_id, line_key, source_date, rule_id, gross_cents, base_cents, pct, amount_cents, origin_period, origin_line_id, kind, reason, memory, created_by)
    select l.clinic_id, l.unit_id, l.professional_id, l.period, l.line_type, l.role, 'manual', l.scope_id, 'close:rev:' || l.id, l.source_date, l.rule_id, -l.gross_cents, -l.base_cents, l.pct, -l.amount_cents, l.origin_period, l.id,
           'correction', 'Fechamento ' || c.period || ' destravado: ' || v_rs, l.memory || jsonb_build_object('reversal_of', l.id), private.current_profile_id()
      from public.fin_share_lines l
     where l.clinic_id = c.clinic_id and l.period = c.period and l.line_key like 'close:' || c.lock_no || ':%';
  get diagnostics v_n = row_count;
  delete from public.fin_share_period_locks where clinic_id = c.clinic_id and period = c.period;
  update public.fin_closings set status = 'conferencia', unlocked_at = now(), unlocked_by = private.current_profile_id(), unlock_reason = v_rs, approved_at = null, approved_by = null, updated_at = now() where id = c.id;
  -- extratos não pagos reabrem (aceite de novo); o pago continua pago e congelado
  update public.fin_closing_pros set status = 'open', acceptance = 'pending', accept_deadline = private.fin_today() + c.accept_days, accepted_at = null, accepted_by = null, approved_at = null, approved_by = null,
         stmt_version = stmt_version + 1, notified_at = now(), updated_at = now()
   where closing_id = c.id and status = 'approved';
  for cp in select id from public.fin_closing_pros where closing_id = c.id and status = 'open' order by id loop
    perform private.close_refresh_cp(cp.id);
  end loop;
  perform private.close_sync(c.id);
  perform private.fin_log(c.clinic_id, null, 'closing', c.id, 'update', jsonb_build_object('status', 'travado', 'lock_no', c.lock_no), jsonb_build_object('status', 'conferencia', 'period', c.period, 'ledger_reversed', v_n), v_rs);
end $$;

-- ---------- 9. Permissões de execução ----------
revoke all on function private.share_pro_frozen(uuid, text, uuid), private.share_target_period(uuid, text, uuid), private.close_unruled(uuid, text), private.close_snapshot(uuid, text, uuid),
  private.close_refresh_cp(uuid, boolean), private.close_sync(uuid), private.close_lines(uuid, uuid, text), private.close_is_self(public.fin_closing_pros),
  private.close_nf_status(boolean, text, text), private.close_row_json(public.fin_closing_pros, public.fin_closings, text), private.close_do_lock(uuid, boolean, text) from public, anon, authenticated;

revoke all on function public.fin_closing_get(uuid, text, uuid), public.fin_closing_statement(uuid), public.fin_closing_my_list(uuid), public.fin_closing_payment_file(uuid),
  public.fin_closing_start(uuid, text), public.fin_closing_refresh(uuid, uuid), public.fin_closing_notify(uuid, uuid[]), public.fin_closing_accept(uuid), public.fin_closing_contest(uuid, text, uuid, text),
  public.fin_closing_answer(uuid, text), public.fin_closing_adjust(uuid, text, bigint, text), public.fin_closing_approve(uuid, uuid[]), public.fin_closing_invoice_save(uuid, text, date, text),
  public.fin_closing_pay(uuid, jsonb), public.fin_closing_lock(uuid, text), public.fin_closing_unlock(uuid, text) from public, anon;
grant execute on function public.fin_closing_get(uuid, text, uuid), public.fin_closing_statement(uuid), public.fin_closing_my_list(uuid), public.fin_closing_payment_file(uuid),
  public.fin_closing_start(uuid, text), public.fin_closing_refresh(uuid, uuid), public.fin_closing_notify(uuid, uuid[]), public.fin_closing_accept(uuid), public.fin_closing_contest(uuid, text, uuid, text),
  public.fin_closing_answer(uuid, text), public.fin_closing_adjust(uuid, text, bigint, text), public.fin_closing_approve(uuid, uuid[]), public.fin_closing_invoice_save(uuid, text, date, text),
  public.fin_closing_pay(uuid, jsonb), public.fin_closing_lock(uuid, text), public.fin_closing_unlock(uuid, text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261115100000','20261115100000_fin_e6_fechamento.sql','FIN-E6: fechamento mensal do repasse (tabela do gestor, extrato do profissional, retenções, aceite/contestação, NF, pagamento, travar/destravar, razão do mês; aditiva).','FIN-E6');
