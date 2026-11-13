-- =====================================================================================
-- FIN-E4 — Atendimento com participantes, kit automático (baixa do estoque e custo do material) e pacotes · Entrega 4.
-- 100% ADITIVA: cria tabelas fin_appointments, fin_appointment_participants, fin_appointment_materials, fin_patient_packages,
-- fin_patient_package_items, fin_package_ledger, stock_shortfalls, stock_patient_returns; funções private.appt_* / private.pkg_* e public.fin_appt_* /
-- fin_package_* / fin_patient_packages_list / fin_shortfalls_list / fin_stock_patient_return / fin_shortfall_resolve; 2 gatilhos novos sobre tabelas da E2
-- (AFTER INSERT em fin_sale_items: pacote vendido vira saldo do paciente; AFTER UPDATE OF status em fin_sales: cancelamento fecha o pacote);
-- recria (create or replace) private.fin_area_roles, public.fin_my_access (com as áreas novas) e private.stock_on_sale_cancel (agora respeita devolução
-- parcial de paciente); amplia a lista de tipos de evento de fin_events. Nenhuma outra função da E1/E2/E3 muda.
-- Depende de 20261113100000 (E1), 20261113180000 (E2) e 20261113230000 (E3): fin_can, fin_log, fin_distribute, fin_today, stock_apply/stock_exit/
-- stock_reverse_one, fin_services/fin_service_kit_items/fin_packages/fin_package_items, fin_sales/fin_sale_items, fin_events.
-- Usa também as tabelas do app: public.appointments (agenda), public.clinical_encounters e private.can_access_patient.
--
-- NÃO APLICADA em produção nesta rodada (só provada em Postgres local: scripts/fin-e4-sql-proof.sh).
--
-- Regras que valem no servidor (escopo-v1 §3, §4.4, §5.4, §8.2, §8.5, §9, §12.2 E2/E3/E11/E17):
--  * escrita SÓ por RPC security definer (search_path vazio); as tabelas novas não têm INSERT/UPDATE/DELETE para anon/authenticated;
--  * atendimento (fin_appointments) e seus materiais NÃO têm SELECT direto: o custo do material só sai pelas RPCs, mascarado para quem não lê estoque;
--  * sem exclusão física: atendimento, material, sobra sem saldo (stock_shortfalls) não se apagam; razão do pacote e devolução são imutáveis; correção = estorno;
--  * a baixa do kit usa private.stock_exit (FEFO, lote vencido, fração/unidade aberta) e private.stock_reverse_one da E3; o registro clínico NUNCA é
--    bloqueado pelo estoque: sem saldo, o atendimento fecha e a baixa vira «consumo sem saldo» (alerta ao gestor), resolvida por entrada retroativa ou ajuste;
--  * toda mudança grava fin_audit_log na mesma transação e, para o motor de repasse (E5), um evento em fin_events (sem cálculo de repasse aqui).
-- =====================================================================================

-- ---------- 0. fin_events aceita os eventos novos ----------
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.fin_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%event_type%' loop
    execute format('alter table public.fin_events drop constraint %I', c.conname);
  end loop;
  alter table public.fin_events add constraint fin_events_event_type_check check (event_type in (
    'sale_canceled','payment_reversed','receivable_reversed','receivable_settled',
    'appointment_done','appointment_canceled','appointment_material_adjusted','appointment_participants_changed',
    'package_item_delivered','package_item_returned','stock_shortfall'));
end $$;

-- ---------- 1. Matriz de papéis (replace: preserva E1/E2/E3, acrescenta appt, patient_pkg e package_deliver) ----------
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
    else '{}'::text[]
  end
$$;

create or replace function public.fin_my_access(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_areas text[] := array['units','staff','services','packages','payment','tax','pro_finance','settings','audit','stock_items',
                                'sales','sales_price','sale_cancel','cash','cash_all','cash_approve','receivables','receivables_fix','compliance','stock_move',
                                'appt','patient_pkg','package_deliver'];
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
  v_can := v_can || jsonb_build_object('own_sales_read', v_pro, 'own_appt', v_pro);
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'all_units', r.all_units, 'unit_ids', to_jsonb(r.unit_ids))), '[]'::jsonb)
    into v_roles
    from public.clinic_staff_roles r
    join public.professionals pr on pr.id = r.professional_id
   where r.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  return jsonb_build_object('is_admin', private.is_clinic_admin(p_clinic), 'roles', v_roles, 'can', v_can);
end $$;

-- ---------- 2. Tabelas ----------
-- 2.1 Pacote do paciente (nasce da venda de um pacote; um por unidade vendida): saldo de sessões e de itens.
create table if not exists public.fin_patient_packages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  patient_id uuid not null references public.patients(id) on delete restrict,
  package_id uuid not null references public.fin_packages(id) on delete restrict,
  sale_id uuid not null references public.fin_sales(id) on delete restrict,
  sale_item_id uuid not null references public.fin_sale_items(id) on delete restrict,
  seq integer not null default 1,
  name text not null,
  price_cents integer not null check (price_cents >= 0),            -- parte do valor LÍQUIDO da venda que cabe a este pacote
  purchased_on date not null,
  expires_on date not null,
  status text not null default 'active' check (status in ('active','canceled')),
  cancel_reason text,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'canceled' or canceled_at is not null),
  unique (sale_item_id, seq)
);
create index if not exists fin_patient_packages_patient_idx on public.fin_patient_packages (clinic_id, patient_id, purchased_on desc);

create table if not exists public.fin_patient_package_items (
  id uuid primary key default gen_random_uuid(),
  patient_package_id uuid not null references public.fin_patient_packages(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  position integer not null,
  item_type text not null check (item_type in ('service','product')),
  service_id uuid references public.fin_services(id) on delete restrict,
  stock_item_id uuid references public.stock_items(id) on delete restrict,
  name text not null,
  qty_total numeric(14,3) not null check (qty_total > 0),
  qty_used numeric(14,3) not null default 0 check (qty_used >= 0),
  reference_price_cents integer not null default 0,
  allocated_total_cents integer not null default 0,                  -- rateio do cadastro do pacote (§5.4), só referência
  net_total_cents integer not null default 0 check (net_total_cents >= 0),  -- parte do valor efetivamente pago desta linha (D23): base do repasse da E5
  check (qty_used <= qty_total),
  check ((item_type = 'service' and service_id is not null and stock_item_id is null) or (item_type = 'product' and stock_item_id is not null and service_id is null))
);
create index if not exists fin_patient_package_items_pkg_idx on public.fin_patient_package_items (patient_package_id, position);
create index if not exists fin_patient_package_items_service_idx on public.fin_patient_package_items (service_id) where service_id is not null;

-- 2.2 Atendimento (visão financeira, §4.4): serviço + paciente + data + unidade + venda/pacote de origem + participantes; custo do material (§8.5).
create table if not exists public.fin_appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  patient_id uuid not null references public.patients(id) on delete restrict,
  service_id uuid not null references public.fin_services(id) on delete restrict,
  service_name text not null,
  sale_id uuid references public.fin_sales(id) on delete restrict,
  sale_item_id uuid references public.fin_sale_items(id) on delete restrict,
  patient_package_item_id uuid references public.fin_patient_package_items(id) on delete restrict,
  agenda_appointment_id uuid references public.appointments(id) on delete set null,
  encounter_id uuid references public.clinical_encounters(id) on delete set null,
  performed_on date not null,
  status text not null default 'open' check (status in ('open','done','canceled')),
  base_value_cents integer check (base_value_cents is null or base_value_cents >= 0),   -- valor líquido da sessão/serviço: base do repasse (E5)
  material_cost_cents bigint not null default 0 check (material_cost_cents >= 0),
  material_estimated_cents bigint not null default 0 check (material_estimated_cents >= 0 and material_estimated_cents <= material_cost_cents),
  has_shortfall boolean not null default false,
  kit_confirmed_at timestamptz,
  kit_confirmed_by uuid,
  notes text check (notes is null or char_length(notes) <= 500),
  done_at timestamptz,
  done_by uuid,
  cancel_reason text,
  canceled_at timestamptz,
  canceled_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'canceled' or (cancel_reason is not null and canceled_at is not null)),
  check (status <> 'done' or done_at is not null),
  check (sale_item_id is null or patient_package_item_id is null)
);
create index if not exists fin_appointments_clinic_idx on public.fin_appointments (clinic_id, performed_on desc, created_at desc);
create index if not exists fin_appointments_patient_idx on public.fin_appointments (patient_id, performed_on desc);
create index if not exists fin_appointments_sale_item_idx on public.fin_appointments (sale_item_id) where sale_item_id is not null and status <> 'canceled';
create index if not exists fin_appointments_ppi_idx on public.fin_appointments (patient_package_item_id) where patient_package_item_id is not null and status <> 'canceled';
create index if not exists fin_appointments_nosale_idx on public.fin_appointments (clinic_id, performed_on desc) where status = 'done' and sale_item_id is null and patient_package_item_id is null;

create table if not exists public.fin_appointment_participants (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.fin_appointments(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  role text not null check (role in ('responsavel','executor','auxiliar')),
  position integer not null default 1,
  unique (appointment_id, professional_id, role)
);
create unique index if not exists fin_appointment_participants_role_uq on public.fin_appointment_participants (appointment_id, role) where role in ('responsavel','executor');
create index if not exists fin_appointment_participants_pro_idx on public.fin_appointment_participants (professional_id);

-- Material do atendimento (uma linha por item e por rodada; correção estorna a rodada e abre a seguinte).
create table if not exists public.fin_appointment_materials (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.fin_appointments(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  item_id uuid not null references public.stock_items(id),
  batch integer not null default 1,
  source text not null check (source in ('kit','added')),
  planned_qty numeric(14,3) not null default 0,                      -- do kit, na unidade de CONSUMO
  qty_consumption numeric(14,3) not null check (qty_consumption > 0), -- como o executor confirmou, na unidade de CONSUMO
  qty numeric(14,3) not null check (qty > 0),                         -- a mesma, na unidade de ESTOQUE (÷ fator)
  applied_qty numeric(14,3) not null default 0 check (applied_qty >= 0),
  short_qty numeric(14,3) not null default 0 check (short_qty >= 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),       -- custo do que realmente baixou
  estimated_cents bigint not null default 0 check (estimated_cents >= 0), -- estimativa do que faltou (custo médio do momento)
  lot_id uuid references public.stock_lots(id),
  movement_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active','reversed')),
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  check (applied_qty + short_qty = qty)
);
create index if not exists fin_appointment_materials_appt_idx on public.fin_appointment_materials (appointment_id, batch);

-- Consumo sem saldo (§8.5 item 4): o atendimento fecha mesmo sem estoque; a sobra fica aqui, em alerta, até entrada retroativa ou ajuste.
create table if not exists public.stock_shortfalls (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  item_id uuid not null references public.stock_items(id),
  appointment_id uuid not null references public.fin_appointments(id) on delete restrict,
  material_id uuid not null references public.fin_appointment_materials(id) on delete restrict,
  patient_id uuid references public.patients(id),
  qty numeric(14,3) not null check (qty > 0),                         -- unidade de ESTOQUE
  est_cost_cents bigint not null default 0 check (est_cost_cents >= 0),
  occurred_on date not null,
  status text not null default 'open' check (status in ('open','resolved','reversed')),
  resolution text check (resolution is null or resolution in ('retro_entry','adjustment','reversed')),
  resolve_reason text,
  resolved_at timestamptz,
  resolved_by uuid,
  movement_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  check (status = 'open' or (resolution is not null and resolved_at is not null))
);
create index if not exists stock_shortfalls_open_idx on public.stock_shortfalls (clinic_id, unit_id, created_at desc) where status = 'open';
create index if not exists stock_shortfalls_appt_idx on public.stock_shortfalls (appointment_id);

-- Razão do pacote (imutável): consumo de sessão, devolução da sessão, entrega e devolução de item, com o valor líquido da linha (base do repasse E5).
create table if not exists public.fin_package_ledger (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  unit_id uuid not null references public.clinic_units(id),
  patient_package_item_id uuid not null references public.fin_patient_package_items(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('session_use','session_restore','delivery','delivery_return')),
  qty numeric(14,3) not null check (qty <> 0),
  value_cents bigint not null default 0,
  appointment_id uuid references public.fin_appointments(id) on delete restrict,
  stock_movement_ids uuid[] not null default '{}',
  occurred_on date not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists fin_package_ledger_item_idx on public.fin_package_ledger (patient_package_item_id, created_at);
create index if not exists fin_package_ledger_appt_idx on public.fin_package_ledger (appointment_id) where appointment_id is not null;

-- Devolução de paciente (§8.2): liga a movimentação de volta à saída de origem (venda ou entrega de pacote).
create table if not exists public.stock_patient_returns (
  return_movement_id uuid primary key references public.stock_movements(id) on delete restrict,
  origin_movement_id uuid not null references public.stock_movements(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  qty numeric(14,3) not null check (qty > 0),
  total_cost_cents bigint not null check (total_cost_cents >= 0),
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists stock_patient_returns_origin_idx on public.stock_patient_returns (origin_movement_id);

-- Sem exclusão física (§3): atendimento, material e sobra não se apagam; razão do pacote e devolução também não se editam.
-- DELETE em cascata (apagar a clínica inteira) continua passando, como na E3.
create or replace function private.fin_e4_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'RECORD_NOT_DELETABLE: registro financeiro/de estoque não se apaga; corrija por estorno ou cancelamento' using errcode = '42501';
end $$;
create or replace function private.fin_e4_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'RECORD_IMMUTABLE: lançamento imutável; corrija por estorno' using errcode = '42501';
end $$;
do $$
declare t text;
begin
  foreach t in array array['fin_appointments','fin_appointment_materials','stock_shortfalls','fin_patient_packages','fin_patient_package_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_nodel', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.fin_e4_no_delete()', t || '_nodel', t);
    execute format('drop trigger if exists %I on public.%I', t || '_nodel_trunc', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.fin_e4_no_delete()', t || '_nodel_trunc', t);
  end loop;
  foreach t in array array['fin_package_ledger','stock_patient_returns'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immut', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.fin_e4_immutable()', t || '_immut', t);
    execute format('drop trigger if exists %I on public.%I', t || '_immut_trunc', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.fin_e4_immutable()', t || '_immut_trunc', t);
  end loop;
end $$;

-- ---------- 3. RLS e grants ----------
alter table public.fin_patient_packages enable row level security;
alter table public.fin_patient_package_items enable row level security;
alter table public.fin_appointments enable row level security;
alter table public.fin_appointment_participants enable row level security;
alter table public.fin_appointment_materials enable row level security;
alter table public.stock_shortfalls enable row level security;
alter table public.fin_package_ledger enable row level security;
alter table public.stock_patient_returns enable row level security;

revoke all on public.fin_patient_packages, public.fin_patient_package_items, public.fin_appointments, public.fin_appointment_participants, public.fin_appointment_materials,
  public.stock_shortfalls, public.fin_package_ledger, public.stock_patient_returns from anon, authenticated;
-- Atendimento, participantes e materiais: SEM select direto (o custo do material só sai pelas RPCs, mascarado por papel). Sem policy = nenhuma linha.
grant select on public.fin_patient_packages, public.fin_patient_package_items, public.fin_package_ledger, public.stock_shortfalls, public.stock_patient_returns to authenticated;

create policy fin_patient_packages_select on public.fin_patient_packages for select to authenticated using (private.fin_can(clinic_id, 'patient_pkg', unit_id, false));
create policy fin_patient_package_items_select on public.fin_patient_package_items for select to authenticated
  using (exists (select 1 from public.fin_patient_packages p where p.id = patient_package_id and private.fin_can(p.clinic_id, 'patient_pkg', p.unit_id, false)));
create policy fin_package_ledger_select on public.fin_package_ledger for select to authenticated using (private.fin_can(clinic_id, 'patient_pkg', unit_id, false));
create policy stock_shortfalls_select on public.stock_shortfalls for select to authenticated using (private.fin_can(clinic_id, 'stock_move', unit_id, false));
create policy stock_patient_returns_select on public.stock_patient_returns for select to authenticated using (private.fin_can(clinic_id, 'stock_move', null, false));

-- ---------- 4. Internas ----------
-- Evento para o motor de repasse (E5): só grava; nada é calculado aqui.
create or replace function private.fin_emit(p_clinic uuid, p_unit uuid, p_type text, p_sale uuid, p_payload jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.fin_events (clinic_id, unit_id, event_type, sale_id, payload, created_by)
  values (p_clinic, p_unit, p_type, p_sale, coalesce(p_payload, '{}'::jsonb), private.current_profile_id())
$$;

-- O profissional logado participa do atendimento (p_manage: como responsável ou executor, os que confirmam o kit).
create or replace function private.appt_self(p_appt uuid, p_manage boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_appointment_participants p join public.professionals pr on pr.id = p.professional_id
                  where p.appointment_id = p_appt and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active'
                    and (not p_manage or p.role in ('responsavel','executor')))
$$;
create or replace function private.appt_can(p_appt uuid, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_appointments a where a.id = p_appt
                    and (private.fin_can(a.clinic_id, 'appt', a.unit_id, p_write) or private.appt_self(a.id, p_write)))
$$;
create or replace function private.appt_is_pro(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active')
$$;

create or replace function private.appt_snapshot(p_appt uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(a)
    || jsonb_build_object(
         'participants', coalesce((select jsonb_agg(jsonb_build_object('professional_id', p.professional_id, 'name', pr.full_name, 'role', p.role) order by p.position, p.id)
                                     from public.fin_appointment_participants p join public.professionals x on x.id = p.professional_id left join public.profiles pr on pr.id = x.profile_id
                                    where p.appointment_id = a.id), '[]'::jsonb),
         'materials', coalesce((select jsonb_agg(jsonb_build_object('item_name', i.name, 'batch', m.batch, 'status', m.status, 'qty_consumption', m.qty_consumption, 'qty', m.qty,
                                     'applied_qty', m.applied_qty, 'short_qty', m.short_qty, 'cost_cents', m.cost_cents, 'estimated_cents', m.estimated_cents) order by m.batch, i.name)
                                  from public.fin_appointment_materials m join public.stock_items i on i.id = m.item_id where m.appointment_id = a.id), '[]'::jsonb))
    from public.fin_appointments a where a.id = p_appt
$$;

-- Participantes (§4.1/§4.4): 1 responsável (obrigatório), até 1 executor e vários auxiliares; só papéis que o serviço prevê; só profissionais ativos da clínica.
create or replace function private.appt_check_participants(p_clinic uuid, p_service uuid, p_participants jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare sv public.fin_services; x jsonb; v_pro uuid; v_role text; v_resp integer := 0; v_exec integer := 0; v_seen text[] := '{}';
begin
  select * into sv from public.fin_services where id = p_service and clinic_id = p_clinic;
  if sv.id is null then raise exception 'INVALID_SERVICE' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_participants, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_participants) = 0 then raise exception 'PARTICIPANTS_REQUIRED' using errcode = '22023'; end if;
  if jsonb_array_length(p_participants) > 10 then raise exception 'TOO_MANY_PARTICIPANTS' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_participants) loop
    v_pro := nullif(x->>'professional_id', '')::uuid; v_role := x->>'role';
    if v_pro is null or v_role is null or v_role not in ('responsavel','executor','auxiliar') then raise exception 'INVALID_ROLE' using errcode = '22023'; end if;
    if not (v_role = any (sv.roles)) then raise exception 'ROLE_NOT_ALLOWED' using errcode = '22023'; end if;
    if not exists (select 1 from public.professionals pr where pr.id = v_pro and pr.clinic_id = p_clinic and coalesce(pr.status, 'active') = 'active') then raise exception 'INVALID_PROFESSIONAL' using errcode = '22023'; end if;
    if (v_pro::text || v_role) = any (v_seen) then raise exception 'DUPLICATE_PARTICIPANT' using errcode = '22023'; end if;
    v_seen := v_seen || (v_pro::text || v_role);
    if v_role = 'responsavel' then v_resp := v_resp + 1; elsif v_role = 'executor' then v_exec := v_exec + 1; end if;
  end loop;
  if v_resp <> 1 then raise exception 'RESPONSIBLE_REQUIRED' using errcode = '22023'; end if;
  if v_exec > 1 then raise exception 'ONE_EXECUTOR' using errcode = '22023'; end if;
end $$;

-- Vínculo com a venda (item de serviço) ou com o pacote do paciente (item de sessão). Sem vínculo = «atendido sem venda» (fila do dashboard, E7).
create or replace function private.appt_check_link(p_clinic uuid, p_patient uuid, p_service uuid, p_sale_item uuid, p_ppi uuid, p_exclude uuid, p_on date) returns void
language plpgsql stable security definer set search_path = '' as $$
declare it public.fin_sale_items; s public.fin_sales; pi public.fin_patient_package_items; pp public.fin_patient_packages; v_used integer;
begin
  if p_sale_item is not null and p_ppi is not null then raise exception 'LINK_CONFLICT' using errcode = '22023'; end if;
  if p_sale_item is not null then
    select * into it from public.fin_sale_items where id = p_sale_item;
    select * into s from public.fin_sales where id = it.sale_id;
    if it.id is null or s.clinic_id <> p_clinic or s.patient_id <> p_patient or it.item_type <> 'service' or it.service_id is distinct from p_service then raise exception 'INVALID_SALE_LINK' using errcode = '22023'; end if;
    if s.status = 'canceled' then raise exception 'SALE_CANCELED' using errcode = '22023'; end if;
    select count(*) into v_used from public.fin_appointments a where a.sale_item_id = p_sale_item and a.status <> 'canceled' and a.id is distinct from p_exclude;
    if v_used + 1 > floor(it.quantity) then raise exception 'SALE_ITEM_CONSUMED' using errcode = '22023'; end if;
  elsif p_ppi is not null then
    select * into pi from public.fin_patient_package_items where id = p_ppi;
    select * into pp from public.fin_patient_packages where id = pi.patient_package_id;
    if pi.id is null or pp.clinic_id <> p_clinic or pp.patient_id <> p_patient or pi.item_type <> 'service' or pi.service_id is distinct from p_service then raise exception 'INVALID_PACKAGE_LINK' using errcode = '22023'; end if;
    if pp.status <> 'active' then raise exception 'PACKAGE_CANCELED' using errcode = '22023'; end if;
    if pp.expires_on < p_on then raise exception 'PACKAGE_EXPIRED' using errcode = '22023'; end if;
    select count(*) into v_used from public.fin_appointments a where a.patient_package_item_id = p_ppi and a.status = 'open' and a.id is distinct from p_exclude;
    if pi.qty_used + v_used + 1 > pi.qty_total then raise exception 'NO_SESSIONS_LEFT' using errcode = '22023'; end if;
  end if;
end $$;

-- Dose fracionada: reaproveita a unidade aberta do paciente (uso individual) ou a que ainda tem fração (frasco compartilhado); senão a E3 abre uma nova.
create or replace function private.appt_pick_open_unit(p_item public.stock_items, p_unit uuid, p_patient uuid, p_qty numeric) returns uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.stock_open_units o
   where o.item_id = p_item.id and o.unit_id = p_unit and o.status = 'open' and o.qty_remaining >= p_qty
     and (o.expires_on is null or o.expires_on >= private.fin_today())
     and (not p_item.individual_use or o.patient_id = p_patient)
   order by o.expires_on nulls last, o.opened_on, o.id limit 1
$$;

-- Totais do atendimento a partir dos materiais ativos.
create or replace function private.appt_recalc(p_appt uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.fin_appointments a set
    material_cost_cents = coalesce((select sum(m.cost_cents + m.estimated_cents) from public.fin_appointment_materials m where m.appointment_id = a.id and m.status = 'active'), 0),
    material_estimated_cents = coalesce((select sum(m.estimated_cents) from public.fin_appointment_materials m where m.appointment_id = a.id and m.status = 'active'), 0),
    has_shortfall = exists (select 1 from public.stock_shortfalls s where s.appointment_id = a.id and s.status = 'open'),
    updated_at = now()
   where a.id = p_appt
$$;

-- Baixa do kit/material (§8.5): cada linha sai pela E3 (FEFO, lote vencido, fração); o que faltar vira «consumo sem saldo» — o atendimento NUNCA é bloqueado.
-- p_lines: [{item_id, quantity (unidade de CONSUMO), lot_id?, open_unit_id?}]
create or replace function private.appt_apply_materials(a public.fin_appointments, p_lines jsonb, p_batch integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb; it public.stock_items; v_q numeric; v_qs numeric; v_lot uuid; v_open uuid; r jsonb; v_cost bigint; v_ids uuid[]; v_short numeric; v_est bigint; v_avg numeric; v_msg text;
  v_avail numeric; v_part numeric; v_planned numeric; v_src text; ctx jsonb; v_seen uuid[] := '{}'; v_today date := private.fin_today(); m public.fin_appointment_materials; sf public.stock_shortfalls;
begin
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' then raise exception 'INVALID_LINES' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 60 then raise exception 'TOO_MANY_LINES' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.stock_items where id = nullif(x->>'item_id', '')::uuid and clinic_id = a.clinic_id and is_active;
    if it.id is null then raise exception 'INVALID_ITEM' using errcode = '22023'; end if;
    if it.id = any (v_seen) then raise exception 'DUPLICATE_ITEM' using errcode = '22023'; end if;
    v_seen := v_seen || it.id;
    v_q := round((x->>'quantity')::numeric, 3);
    if v_q is null or v_q <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
    v_qs := round(v_q / it.stock_to_consumption_factor, 3);                       -- kit na unidade de consumo → unidade de estoque (3 casas)
    if v_qs <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
    select k.quantity into v_planned from public.fin_service_kit_items k where k.service_id = a.service_id and k.item_id = it.id;
    v_src := case when v_planned is null then 'added' else 'kit' end; v_planned := coalesce(v_planned, 0);
    v_lot := nullif(x->>'lot_id', '')::uuid; v_open := nullif(x->>'open_unit_id', '')::uuid;
    if v_lot is not null and not exists (select 1 from public.stock_lots l where l.id = v_lot and l.item_id = it.id and l.unit_id = a.unit_id and l.clinic_id = a.clinic_id) then raise exception 'INVALID_LOT' using errcode = '22023'; end if;
    if v_open is null and v_lot is null and it.fractional and v_qs < 1 then v_open := private.appt_pick_open_unit(it, a.unit_id, a.patient_id, v_qs); end if;
    ctx := jsonb_build_object('appointment_id', a.id, 'patient_id', a.patient_id, 'occurred_on', a.performed_on, 'reason', 'Atendimento: ' || a.service_name,
                              'lot_id', v_lot, 'open_unit_id', v_open);
    v_cost := 0; v_ids := '{}'; v_short := 0; v_est := 0;
    begin
      r := private.stock_exit(a.clinic_id, a.unit_id, it.id, 'appointment', v_qs, ctx);
      v_cost := (r->>'total_cost_cents')::bigint;
      v_ids := array(select jsonb_array_elements_text(r->'movement_ids')::uuid);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      -- só a FALTA vira consumo sem saldo; erro de dado (item, lote, fração, paciente) volta para quem confirma. Lote vencido ESCOLHIDO à mão também volta.
      if v_msg not in ('INSUFFICIENT_STOCK', 'LOT_EXPIRED', 'INSUFFICIENT_OPEN_UNIT', 'OPEN_UNIT_EXPIRED') or (v_lot is not null and v_msg = 'LOT_EXPIRED') then raise; end if;
      v_cost := 0; v_ids := '{}'; v_part := 0;
      if v_open is null and not (it.fractional and v_qs < 1) then
        select coalesce(sum(l.qty_on_hand - private.stock_lot_open_qty(l.id)), 0) into v_avail from public.stock_lots l
         where l.item_id = it.id and l.unit_id = a.unit_id and (v_lot is null or l.id = v_lot) and (l.expiry_date is null or l.expiry_date >= v_today);
        v_part := floor(least(v_avail, v_qs));
        if v_part >= 1 then
          begin
            r := private.stock_exit(a.clinic_id, a.unit_id, it.id, 'appointment', v_part, ctx);
            v_cost := (r->>'total_cost_cents')::bigint;
            v_ids := array(select jsonb_array_elements_text(r->'movement_ids')::uuid);
          exception when others then v_part := 0; v_cost := 0; v_ids := '{}';
          end;
        end if;
      end if;
      v_short := v_qs - v_part;
    end;
    if v_short > 0 then
      select b.avg_cost_cents into v_avg from public.stock_balances b where b.item_id = it.id and b.unit_id = a.unit_id;
      v_est := round(v_short * coalesce(v_avg, 0))::bigint;
    end if;
    insert into public.fin_appointment_materials (appointment_id, clinic_id, unit_id, item_id, batch, source, planned_qty, qty_consumption, qty, applied_qty, short_qty, cost_cents, estimated_cents, lot_id, movement_ids)
      values (a.id, a.clinic_id, a.unit_id, it.id, p_batch, v_src, v_planned, v_q, v_qs, v_qs - v_short, v_short, v_cost, v_est, v_lot, v_ids) returning * into m;
    if v_short > 0 then
      insert into public.stock_shortfalls (clinic_id, unit_id, item_id, appointment_id, material_id, patient_id, qty, est_cost_cents, occurred_on)
        values (a.clinic_id, a.unit_id, it.id, a.id, m.id, a.patient_id, v_short, v_est, a.performed_on) returning * into sf;
      perform private.fin_log(a.clinic_id, a.unit_id, 'stock_shortfall', sf.id, 'create', null,
        jsonb_build_object('item_name', it.name, 'qty', v_short, 'est_cost_cents', v_est, 'appointment_id', a.id, 'service_name', a.service_name, 'occurred_on', a.performed_on),
        'Consumo sem saldo no atendimento');
      perform private.fin_emit(a.clinic_id, a.unit_id, 'stock_shortfall', null, jsonb_build_object('shortfall_id', sf.id, 'appointment_id', a.id, 'item_id', it.id, 'qty', v_short, 'est_cost_cents', v_est));
    end if;
  end loop;
end $$;

-- Estorna a baixa de todos os materiais ativos (movimentações novas apontando para as originais) e fecha as sobras sem saldo ainda abertas.
create or replace function private.appt_reverse_materials(a public.fin_appointments, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.fin_appointment_materials; mv uuid;
begin
  for m in select * from public.fin_appointment_materials where appointment_id = a.id and status = 'active' order by batch, created_at loop
    foreach mv in array m.movement_ids loop
      if not exists (select 1 from public.stock_movements r where r.reversed_movement_id = mv) then perform private.stock_reverse_one(mv, p_reason, false); end if;
    end loop;
    update public.fin_appointment_materials set status = 'reversed', reversed_at = now(), reverse_reason = btrim(p_reason) where id = m.id;
  end loop;
  update public.stock_shortfalls set status = 'reversed', resolution = 'reversed', resolved_at = now(), resolved_by = private.current_profile_id(), resolve_reason = btrim(p_reason)
   where appointment_id = a.id and status = 'open';
end $$;

-- Valor líquido de uma baixa de linha de pacote (a última sessão/unidade leva a sobra do arredondamento, §5.4).
create or replace function private.pkg_item_value(p_item public.fin_patient_package_items, p_qty numeric) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v_prior bigint;
begin
  select coalesce(sum(l.value_cents), 0) into v_prior from public.fin_package_ledger l where l.patient_package_item_id = p_item.id;
  if p_item.qty_used + p_qty >= p_item.qty_total then return p_item.net_total_cents - v_prior; end if;
  return round(p_item.net_total_cents::numeric * p_qty / p_item.qty_total)::bigint;
end $$;

-- Consome UMA sessão do pacote do paciente no atendimento (tranca a linha; recusa pacote cancelado, vencido ou sem saldo).
create or replace function private.pkg_use_session(a public.fin_appointments) returns bigint
language plpgsql security definer set search_path = '' as $$
declare i public.fin_patient_package_items; p public.fin_patient_packages; v bigint;
begin
  select * into i from public.fin_patient_package_items where id = a.patient_package_item_id for update;
  select * into p from public.fin_patient_packages where id = i.patient_package_id;
  if p.status <> 'active' then raise exception 'PACKAGE_CANCELED' using errcode = '22023'; end if;
  if p.expires_on < a.performed_on then raise exception 'PACKAGE_EXPIRED' using errcode = '22023'; end if;
  if i.qty_used + 1 > i.qty_total then raise exception 'NO_SESSIONS_LEFT' using errcode = '22023'; end if;
  v := private.pkg_item_value(i, 1);
  update public.fin_patient_package_items set qty_used = qty_used + 1 where id = i.id;
  insert into public.fin_package_ledger (clinic_id, unit_id, patient_package_item_id, patient_id, kind, qty, value_cents, appointment_id, occurred_on, reason, created_by)
    values (a.clinic_id, a.unit_id, i.id, a.patient_id, 'session_use', 1, v, a.id, a.performed_on, 'Sessão realizada: ' || a.service_name, private.current_profile_id());
  return v;
end $$;

-- ---------- 5. Venda de pacote vira saldo do paciente; cancelar a venda fecha o pacote ----------
create or replace function private.pkg_on_sale_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.fin_sales; pk public.fin_packages; n integer; i integer; v_units bigint[]; v_lines bigint[]; v_w bigint[]; pp public.fin_patient_packages; r record; k integer;
begin
  if new.item_type <> 'package' then return new; end if;
  if new.quantity <> trunc(new.quantity) then raise exception 'PACKAGE_QUANTITY_INTEGER' using errcode = '22023'; end if;
  select * into s from public.fin_sales where id = new.sale_id;
  select * into pk from public.fin_packages where id = new.package_id;
  n := new.quantity::integer;
  v_units := private.fin_distribute(new.net_cents, array_fill(1::bigint, array[n]));          -- valor líquido de cada pacote vendido
  select array_agg(greatest(pi.allocated_total_cents, 0)::bigint order by pi.position) into v_w from public.fin_package_items pi where pi.package_id = pk.id;
  if v_w is null or (select coalesce(sum(x), 0) from unnest(v_w) x) <= 0 then raise exception 'PACKAGE_WITHOUT_ITEMS' using errcode = '22023'; end if;
  for i in 1..n loop
    insert into public.fin_patient_packages (clinic_id, unit_id, patient_id, package_id, sale_id, sale_item_id, seq, name, price_cents, purchased_on, expires_on)
      values (s.clinic_id, s.unit_id, s.patient_id, pk.id, s.id, new.id, i, pk.name, v_units[i], private.fin_today(), private.fin_today() + pk.validity_days) returning * into pp;
    v_lines := private.fin_distribute(v_units[i], v_w);                                          -- rateio do valor efetivamente pago entre as linhas (D23, §5.4)
    k := 0;
    for r in select pi.* from public.fin_package_items pi where pi.package_id = pk.id order by pi.position loop
      k := k + 1;
      insert into public.fin_patient_package_items (patient_package_id, clinic_id, position, item_type, service_id, stock_item_id, name, qty_total, reference_price_cents, allocated_total_cents, net_total_cents)
        values (pp.id, s.clinic_id, r.position, r.item_type, r.service_id, r.stock_item_id,
                coalesce((select sv.name from public.fin_services sv where sv.id = r.service_id), (select si.name from public.stock_items si where si.id = r.stock_item_id), 'Item'),
                r.quantity, r.reference_price_cents, r.allocated_total_cents, v_lines[k]);
    end loop;
    perform private.fin_log(s.clinic_id, s.unit_id, 'patient_package', pp.id, 'create', null,
      jsonb_build_object('name', pk.name, 'sale_id', s.id, 'patient_id', s.patient_id, 'price_cents', v_units[i], 'expires_on', pp.expires_on,
        'items', (select jsonb_agg(jsonb_build_object('name', x.name, 'qty_total', x.qty_total, 'net_total_cents', x.net_total_cents) order by x.position) from public.fin_patient_package_items x where x.patient_package_id = pp.id)), null);
  end loop;
  return new;
end $$;
drop trigger if exists pkg_on_sale_item on public.fin_sale_items;
create trigger pkg_on_sale_item after insert on public.fin_sale_items for each row execute function private.pkg_on_sale_item();

create or replace function private.pkg_on_sale_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.fin_patient_packages;
begin
  for p in select * from public.fin_patient_packages where sale_id = new.id and status = 'active' loop
    update public.fin_patient_packages set status = 'canceled', cancel_reason = 'Venda cancelada: ' || coalesce(new.cancel_reason, ''), canceled_at = now() where id = p.id;
    perform private.fin_log(p.clinic_id, p.unit_id, 'patient_package', p.id, 'reverse', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'canceled'), 'Venda cancelada: ' || coalesce(new.cancel_reason, ''));
  end loop;
  return new;
end $$;
drop trigger if exists pkg_on_sale_cancel on public.fin_sales;
create trigger pkg_on_sale_cancel after update of status on public.fin_sales for each row
  when (old.status is distinct from 'canceled' and new.status = 'canceled') execute function private.pkg_on_sale_cancel();

-- Cancelar a venda devolve o estoque da venda — agora respeitando o que o paciente já devolveu (a devolução parcial não volta duas vezes).
create or replace function private.stock_on_sale_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_ret numeric; v_ret_total bigint; v_rem numeric; m public.stock_movements; v_total bigint;
begin
  for r in select x.* from public.stock_movements x
            where x.sale_id = new.id and x.movement_type = 'sale'
              and not exists (select 1 from public.stock_movements z where z.reversed_movement_id = x.id)
            order by x.created_at desc, x.id loop
    select coalesce(sum(pr.qty), 0), coalesce(sum(pr.total_cost_cents), 0) into v_ret, v_ret_total from public.stock_patient_returns pr where pr.origin_movement_id = r.id;
    if v_ret = 0 then
      perform private.stock_reverse_one(r.id, 'Venda cancelada: ' || coalesce(new.cancel_reason, ''), true);
    else
      v_rem := abs(r.qty) - v_ret;
      if v_rem > 0 then
        v_total := abs(r.total_cost_cents) - v_ret_total;
        m := private.stock_apply(r.clinic_id, r.unit_id, r.item_id, r.lot_id, null, null, 'patient_return', v_rem, v_total, true,
               jsonb_build_object('reason', 'Venda cancelada: ' || coalesce(new.cancel_reason, ''), 'sale_id', new.id, 'patient_id', r.patient_id));
        insert into public.stock_patient_returns (return_movement_id, origin_movement_id, clinic_id, qty, total_cost_cents, reason, created_by)
          values (m.id, r.id, r.clinic_id, v_rem, v_total, 'Venda cancelada', private.current_profile_id());
      end if;
    end if;
  end loop;
  return new;
end $$;

-- Estorno manual de movimentação (E3) NÃO vale para a baixa de atendimento (use «corrigir kit»), a entrega de item de pacote nem a devolução de paciente.
create or replace function public.fin_stock_reverse(p_movement uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements;
begin
  select * into m from public.stock_movements where id = p_movement;
  if m.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(m.clinic_id, 'stock_move', m.unit_id, true);
  if m.movement_type = 'appointment' and exists (select 1 from public.fin_appointment_materials x where p_movement = any (x.movement_ids) and x.status = 'active') then
    raise exception 'APPOINTMENT_MOVEMENT_USE_CORRECT' using errcode = '22023';
  end if;
  if m.movement_type = 'package_delivery' then raise exception 'DELIVERY_USE_RETURN' using errcode = '22023'; end if;
  if m.movement_type = 'patient_return' then raise exception 'RETURN_NOT_REVERSIBLE' using errcode = '22023'; end if;
  return private.stock_reverse_one(p_movement, p_reason, false);
end $$;

-- ---------- 6. RPCs de escrita: atendimento ----------
-- 6.1 Criar/editar atendimento ABERTO. Gestor/Admin registra qualquer um; o profissional registra o PRÓPRIO (precisa constar como responsável ou executor) e só de paciente a que tem acesso.
-- p_data: {patient_id, service_id, performed_on, sale_item_id | patient_package_item_id, agenda_appointment_id, encounter_id, notes}; p_participants: [{professional_id, role}]
create or replace function public.fin_appt_save(p_clinic uuid, p_unit uuid, p_id uuid, p_data jsonb, p_participants jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.fin_appointments; sv public.fin_services; v_patient uuid := nullif(p_data->>'patient_id', '')::uuid; v_service uuid := nullif(p_data->>'service_id', '')::uuid;
  v_on date := coalesce(nullif(p_data->>'performed_on', '')::date, private.fin_today()); v_si uuid := nullif(p_data->>'sale_item_id', '')::uuid; v_ppi uuid := nullif(p_data->>'patient_package_item_id', '')::uuid;
  v_agenda uuid := nullif(p_data->>'agenda_appointment_id', '')::uuid; v_enc uuid := nullif(p_data->>'encounter_id', '')::uuid; v_notes text := nullif(btrim(coalesce(p_data->>'notes', '')), '');
  v_mgr boolean; v_before jsonb; x jsonb; k integer := 0; v_sale uuid; v_self boolean := false; v_action text;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic and u.is_active) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  v_mgr := private.fin_can(p_clinic, 'appt', p_unit, true);
  if not v_mgr and not private.appt_is_pro(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_service is null then raise exception 'INVALID_SERVICE' using errcode = '22023'; end if;
  select * into sv from public.fin_services where id = v_service and clinic_id = p_clinic and is_active;
  if sv.id is null then raise exception 'INVALID_SERVICE' using errcode = '22023'; end if;
  if v_patient is null or not exists (select 1 from public.patients pt where pt.id = v_patient and pt.clinic_id = p_clinic) then raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_on < private.fin_today() - 400 then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if v_agenda is not null and not exists (select 1 from public.appointments ag where ag.id = v_agenda and ag.clinic_id = p_clinic) then raise exception 'INVALID_AGENDA_LINK' using errcode = '22023'; end if;
  if v_enc is not null and not exists (select 1 from public.clinical_encounters ce where ce.id = v_enc and ce.clinic_id = p_clinic and ce.patient_id = v_patient) then raise exception 'INVALID_ENCOUNTER_LINK' using errcode = '22023'; end if;

  if p_id is not null then
    select * into a from public.fin_appointments where id = p_id and clinic_id = p_clinic for update;
    if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if not private.appt_can(a.id, true) then raise exception 'forbidden' using errcode = '42501'; end if;
    if a.status <> 'open' then raise exception 'APPOINTMENT_NOT_OPEN' using errcode = '22023'; end if;
    if a.unit_id <> p_unit then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
    v_before := private.appt_snapshot(a.id);
  elsif not v_mgr then
    if jsonb_typeof(coalesce(p_participants, 'null'::jsonb)) = 'array' then
      select exists (select 1 from jsonb_array_elements(p_participants) e join public.professionals pr on pr.id = nullif(e->>'professional_id', '')::uuid
                      where pr.profile_id = private.current_profile_id() and e->>'role' in ('responsavel','executor')) into v_self;
    end if;
    if not v_self then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not v_mgr and not private.can_access_patient(v_patient) then raise exception 'forbidden' using errcode = '42501'; end if;

  perform private.appt_check_participants(p_clinic, v_service, p_participants);
  perform private.appt_check_link(p_clinic, v_patient, v_service, v_si, v_ppi, p_id, v_on);
  v_sale := case when v_si is not null then (select it.sale_id from public.fin_sale_items it where it.id = v_si)
                 when v_ppi is not null then (select pp.sale_id from public.fin_patient_package_items pi join public.fin_patient_packages pp on pp.id = pi.patient_package_id where pi.id = v_ppi) end;

  if p_id is null then
    v_action := 'create';
    insert into public.fin_appointments (clinic_id, unit_id, patient_id, service_id, service_name, sale_id, sale_item_id, patient_package_item_id, agenda_appointment_id, encounter_id, performed_on, notes, created_by)
      values (p_clinic, p_unit, v_patient, v_service, sv.name, v_sale, v_si, v_ppi, v_agenda, v_enc, v_on, v_notes, private.current_profile_id()) returning * into a;
  else
    v_action := 'update';
    update public.fin_appointments set patient_id = v_patient, service_id = v_service, service_name = sv.name, sale_id = v_sale, sale_item_id = v_si, patient_package_item_id = v_ppi,
        agenda_appointment_id = v_agenda, encounter_id = v_enc, performed_on = v_on, notes = v_notes, updated_at = now() where id = a.id returning * into a;
    delete from public.fin_appointment_participants where appointment_id = a.id;
  end if;
  for x in select * from jsonb_array_elements(p_participants) loop
    k := k + 1;
    insert into public.fin_appointment_participants (appointment_id, clinic_id, professional_id, role, position) values (a.id, p_clinic, (x->>'professional_id')::uuid, x->>'role', k);
  end loop;
  perform private.fin_log(p_clinic, p_unit, 'appointment', a.id, v_action, v_before, private.appt_snapshot(a.id), p_reason);
  return a.id;
end $$;

-- 6.2 Realizar o atendimento (§8.5): confirma o kit, baixa o estoque, grava o custo do material, consome a sessão do pacote e avisa o repasse.
-- p_lines null = o kit do serviço como está cadastrado; lista = o que o executor confirmou (troca lote, muda quantidade, remove ou adiciona item).
create or replace function public.fin_appt_complete(p_appt uuid, p_lines jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.fin_appointments; v_lines jsonb := p_lines; v_base integer; v_val bigint; it public.fin_sale_items; v_before jsonb; v_removed jsonb;
begin
  select * into a from public.fin_appointments where id = p_appt for update;
  if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.appt_can(a.id, true) then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status <> 'open' then raise exception 'APPOINTMENT_NOT_OPEN' using errcode = '22023'; end if;
  if a.performed_on > private.fin_today() then raise exception 'FUTURE_DATE' using errcode = '22023'; end if;
  if not exists (select 1 from public.fin_appointment_participants p where p.appointment_id = a.id and p.role = 'responsavel') then raise exception 'RESPONSIBLE_REQUIRED' using errcode = '22023'; end if;
  perform private.appt_check_link(a.clinic_id, a.patient_id, a.service_id, a.sale_item_id, a.patient_package_item_id, a.id, a.performed_on);
  v_before := private.appt_snapshot(a.id);
  if v_lines is null then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', k.item_id, 'quantity', k.quantity) order by k.item_id), '[]'::jsonb) into v_lines from public.fin_service_kit_items k where k.service_id = a.service_id;
  end if;
  select coalesce(jsonb_agg(i.name order by i.name), '[]'::jsonb) into v_removed from public.fin_service_kit_items k join public.stock_items i on i.id = k.item_id
   where k.service_id = a.service_id and not exists (select 1 from jsonb_array_elements(v_lines) e where nullif(e->>'item_id', '')::uuid = k.item_id);

  perform private.appt_apply_materials(a, v_lines, 1);

  if a.patient_package_item_id is not null then
    v_val := private.pkg_use_session(a); v_base := v_val::integer;
  elsif a.sale_item_id is not null then
    select * into it from public.fin_sale_items where id = a.sale_item_id;
    v_base := round(it.net_cents::numeric / greatest(it.quantity, 1))::integer;
  end if;
  update public.fin_appointments set status = 'done', done_at = now(), done_by = private.current_profile_id(), kit_confirmed_at = now(), kit_confirmed_by = private.current_profile_id(),
      base_value_cents = v_base, notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes), updated_at = now() where id = a.id;
  perform private.appt_recalc(a.id);
  select * into a from public.fin_appointments where id = a.id;
  perform private.fin_emit(a.clinic_id, a.unit_id, 'appointment_done', a.sale_id, jsonb_build_object(
    'appointment_id', a.id, 'service_id', a.service_id, 'patient_id', a.patient_id, 'performed_on', a.performed_on, 'sale_item_id', a.sale_item_id,
    'patient_package_item_id', a.patient_package_item_id, 'base_value_cents', a.base_value_cents, 'material_cost_cents', a.material_cost_cents,
    'material_estimated_cents', a.material_estimated_cents, 'without_sale', (a.sale_item_id is null and a.patient_package_item_id is null),
    'participants', (select jsonb_agg(jsonb_build_object('professional_id', p.professional_id, 'role', p.role) order by p.position) from public.fin_appointment_participants p where p.appointment_id = a.id)));
  perform private.fin_log(a.clinic_id, a.unit_id, 'appointment', a.id, 'update', v_before,
    private.appt_snapshot(a.id) || jsonb_build_object('kit_items_removed', v_removed), coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Atendimento realizado'));
  return jsonb_build_object('appointment_id', a.id, 'has_shortfall', a.has_shortfall, 'base_value_cents', a.base_value_cents);
end $$;

-- 6.3 Corrigir a baixa depois de confirmado (§8.5 item 5): estorna a rodada anterior e lança a nova; a diferença de material vai ao repasse como ajuste.
create or replace function public.fin_appt_correct(p_appt uuid, p_lines jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.fin_appointments; v_old bigint; v_batch integer; v_before jsonb;
begin
  select * into a from public.fin_appointments where id = p_appt for update;
  if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.appt_can(a.id, true) then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status <> 'done' then raise exception 'APPOINTMENT_NOT_DONE' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' then raise exception 'INVALID_LINES' using errcode = '22023'; end if;
  v_before := private.appt_snapshot(a.id); v_old := a.material_cost_cents;
  select coalesce(max(m.batch), 0) + 1 into v_batch from public.fin_appointment_materials m where m.appointment_id = a.id;
  perform private.appt_reverse_materials(a, 'Correção do atendimento: ' || btrim(p_reason));
  perform private.appt_apply_materials(a, p_lines, v_batch);
  update public.fin_appointments set kit_confirmed_at = now(), kit_confirmed_by = private.current_profile_id() where id = a.id;
  perform private.appt_recalc(a.id);
  select * into a from public.fin_appointments where id = a.id;
  perform private.fin_emit(a.clinic_id, a.unit_id, 'appointment_material_adjusted', a.sale_id, jsonb_build_object(
    'appointment_id', a.id, 'performed_on', a.performed_on, 'old_cost_cents', v_old, 'new_cost_cents', a.material_cost_cents, 'delta_cents', a.material_cost_cents - v_old, 'reason', btrim(p_reason)));
  perform private.fin_log(a.clinic_id, a.unit_id, 'appointment', a.id, 'update', v_before, private.appt_snapshot(a.id), p_reason);
  return jsonb_build_object('appointment_id', a.id, 'has_shortfall', a.has_shortfall, 'delta_cents', a.material_cost_cents - v_old);
end $$;

-- 6.4 Cancelar o atendimento (aberto ou realizado): motivo obrigatório; estorna a baixa do estoque e devolve a sessão ao pacote.
create or replace function public.fin_appt_cancel(p_appt uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.fin_appointments; v_before jsonb; v_was text; l public.fin_package_ledger; i public.fin_patient_package_items;
begin
  select * into a from public.fin_appointments where id = p_appt for update;
  if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.appt_can(a.id, true) then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status = 'canceled' then raise exception 'ALREADY_CANCELED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_before := private.appt_snapshot(a.id); v_was := a.status;
  if v_was = 'done' then
    perform private.appt_reverse_materials(a, 'Atendimento cancelado: ' || btrim(p_reason));
    if a.patient_package_item_id is not null then
      select * into l from public.fin_package_ledger where appointment_id = a.id and kind = 'session_use' order by created_at desc limit 1;
      select * into i from public.fin_patient_package_items where id = a.patient_package_item_id for update;
      update public.fin_patient_package_items set qty_used = greatest(qty_used - 1, 0) where id = i.id;
      insert into public.fin_package_ledger (clinic_id, unit_id, patient_package_item_id, patient_id, kind, qty, value_cents, appointment_id, occurred_on, reason, created_by)
        values (a.clinic_id, a.unit_id, i.id, a.patient_id, 'session_restore', -1, -coalesce(l.value_cents, 0), a.id, private.fin_today(), 'Atendimento cancelado: ' || btrim(p_reason), private.current_profile_id());
    end if;
  end if;
  update public.fin_appointments set status = 'canceled', cancel_reason = btrim(p_reason), canceled_at = now(), canceled_by = private.current_profile_id(), updated_at = now() where id = a.id;
  perform private.appt_recalc(a.id);
  select * into a from public.fin_appointments where id = a.id;
  if v_was = 'done' then
    perform private.fin_emit(a.clinic_id, a.unit_id, 'appointment_canceled', a.sale_id, jsonb_build_object('appointment_id', a.id, 'performed_on', a.performed_on, 'reason', a.cancel_reason,
      'base_value_cents', a.base_value_cents, 'patient_package_item_id', a.patient_package_item_id, 'sale_item_id', a.sale_item_id));
  end if;
  perform private.fin_log(a.clinic_id, a.unit_id, 'appointment', a.id, 'reverse', v_before, private.appt_snapshot(a.id), p_reason);
end $$;

-- 6.5 Trocar os participantes (base do repasse): em atendimento realizado exige motivo e avisa o repasse.
create or replace function public.fin_appt_set_participants(p_appt uuid, p_participants jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.fin_appointments; v_before jsonb; x jsonb; k integer := 0;
begin
  select * into a from public.fin_appointments where id = p_appt for update;
  if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.appt_can(a.id, true) then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status = 'canceled' then raise exception 'ALREADY_CANCELED' using errcode = '22023'; end if;
  if a.status = 'done' and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  perform private.appt_check_participants(a.clinic_id, a.service_id, p_participants);
  v_before := private.appt_snapshot(a.id);
  delete from public.fin_appointment_participants where appointment_id = a.id;
  for x in select * from jsonb_array_elements(p_participants) loop
    k := k + 1;
    insert into public.fin_appointment_participants (appointment_id, clinic_id, professional_id, role, position) values (a.id, a.clinic_id, (x->>'professional_id')::uuid, x->>'role', k);
  end loop;
  -- quem edita precisa continuar com direito sobre o atendimento (não se tira do próprio atendimento sem ser gestor)
  if not private.appt_can(a.id, true) then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status = 'done' then
    perform private.fin_emit(a.clinic_id, a.unit_id, 'appointment_participants_changed', a.sale_id, jsonb_build_object('appointment_id', a.id, 'performed_on', a.performed_on, 'reason', btrim(p_reason),
      'participants', (select jsonb_agg(jsonb_build_object('professional_id', p.professional_id, 'role', p.role) order by p.position) from public.fin_appointment_participants p where p.appointment_id = a.id)));
  end if;
  update public.fin_appointments set updated_at = now() where id = a.id;
  perform private.fin_log(a.clinic_id, a.unit_id, 'appointment', a.id, 'update', v_before, private.appt_snapshot(a.id), coalesce(p_reason, 'Participantes alterados'));
end $$;

-- ---------- 7. RPCs de escrita: pacote, devolução e consumo sem saldo ----------
-- 7.1 Entrega de item de pacote ao paciente (§5.4, E17): baixa o estoque e o pacote é coberto pela data da entrega. Estoque insuficiente BLOQUEIA (é entrega física).
-- p_data: {unit_id?, lot_id?}
create or replace function public.fin_package_deliver(p_item uuid, p_qty numeric, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.fin_patient_package_items; p public.fin_patient_packages; v_unit uuid; v_lot uuid := nullif(p_data->>'lot_id', '')::uuid; r jsonb; v_ids uuid[]; v_val bigint; v_cost bigint; v_qty numeric := round(p_qty, 3);
begin
  select * into i from public.fin_patient_package_items where id = p_item for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into p from public.fin_patient_packages where id = i.patient_package_id;
  v_unit := coalesce(nullif(p_data->>'unit_id', '')::uuid, p.unit_id);
  perform private.fin_gate(p.clinic_id, 'package_deliver', v_unit, true);
  if not exists (select 1 from public.clinic_units u where u.id = v_unit and u.clinic_id = p.clinic_id and u.is_active) then raise exception 'INVALID_UNITS' using errcode = '22023'; end if;
  if i.item_type <> 'product' then raise exception 'NOT_A_PRODUCT_ITEM' using errcode = '22023'; end if;
  if p.status <> 'active' then raise exception 'PACKAGE_CANCELED' using errcode = '22023'; end if;
  if p.expires_on < private.fin_today() then raise exception 'PACKAGE_EXPIRED' using errcode = '22023'; end if;
  if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
  if i.qty_used + v_qty > i.qty_total then raise exception 'NO_ITEMS_LEFT' using errcode = '22023'; end if;
  r := private.stock_exit(p.clinic_id, v_unit, i.stock_item_id, 'package_delivery', v_qty,
         jsonb_build_object('patient_id', p.patient_id, 'sale_id', p.sale_id, 'lot_id', v_lot, 'reason', 'Entrega de pacote: ' || p.name));
  v_ids := array(select jsonb_array_elements_text(r->'movement_ids')::uuid); v_cost := (r->>'total_cost_cents')::bigint;
  v_val := private.pkg_item_value(i, v_qty);
  update public.fin_patient_package_items set qty_used = qty_used + v_qty where id = i.id;
  insert into public.fin_package_ledger (clinic_id, unit_id, patient_package_item_id, patient_id, kind, qty, value_cents, stock_movement_ids, occurred_on, reason, created_by)
    values (p.clinic_id, v_unit, i.id, p.patient_id, 'delivery', v_qty, v_val, v_ids, private.fin_today(), 'Entrega de ' || i.name, private.current_profile_id());
  perform private.fin_emit(p.clinic_id, v_unit, 'package_item_delivered', p.sale_id, jsonb_build_object('patient_package_item_id', i.id, 'patient_id', p.patient_id, 'item_name', i.name,
    'qty', v_qty, 'value_cents', v_val, 'cost_cents', v_cost, 'delivered_on', private.fin_today()));
  perform private.fin_log(p.clinic_id, v_unit, 'patient_package', p.id, 'update', jsonb_build_object('item', i.name, 'qty_used', i.qty_used),
    jsonb_build_object('item', i.name, 'qty_used', i.qty_used + v_qty, 'delivered', v_qty, 'value_cents', v_val, 'cost_cents', v_cost), 'Entrega de item do pacote');
  return jsonb_build_object('patient_package_item_id', i.id, 'qty_used', i.qty_used + v_qty, 'remaining', i.qty_total - i.qty_used - v_qty, 'movement_ids', to_jsonb(v_ids));
end $$;

-- 7.2 Devolução de paciente (§8.2): volta ao estoque, no lote e ao custo da saída original. Origem: venda ou entrega de item de pacote; parcial permitida.
create or replace function public.fin_stock_patient_return(p_movement uuid, p_qty numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements; v_ret numeric; v_ret_total bigint; v_qty numeric := round(p_qty, 3); v_total bigint; r public.stock_movements; l public.fin_package_ledger; it public.stock_items; v_val bigint;
begin
  select * into m from public.stock_movements where id = p_movement for update;
  if m.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(m.clinic_id, 'stock_move', m.unit_id, true);
  if m.movement_type not in ('sale', 'package_delivery') or m.qty >= 0 then raise exception 'RETURN_NOT_ALLOWED' using errcode = '22023'; end if;
  if m.open_unit_id is not null then raise exception 'RETURN_NOT_ALLOWED_OPEN_UNIT' using errcode = '22023'; end if;   -- D20: dose de multidose nunca vai para o paciente
  if exists (select 1 from public.stock_movements z where z.reversed_movement_id = m.id) then raise exception 'ALREADY_REVERSED' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  select * into it from public.stock_items where id = m.item_id;
  select coalesce(sum(x.qty), 0), coalesce(sum(x.total_cost_cents), 0) into v_ret, v_ret_total from public.stock_patient_returns x where x.origin_movement_id = m.id;
  if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
  if not it.fractional and v_qty <> trunc(v_qty) then raise exception 'NOT_FRACTIONAL' using errcode = '22023'; end if;
  if v_qty > abs(m.qty) - v_ret then raise exception 'RETURN_EXCEEDS_ORIGIN' using errcode = '22023'; end if;
  v_total := case when v_qty = abs(m.qty) - v_ret then abs(m.total_cost_cents) - v_ret_total else round(v_qty * m.unit_cost_cents)::bigint end;   -- custo da saída original
  r := private.stock_apply(m.clinic_id, m.unit_id, m.item_id, m.lot_id, null, null, 'patient_return', v_qty, v_total, true,
         jsonb_build_object('reason', btrim(p_reason), 'patient_id', m.patient_id, 'sale_id', m.sale_id));
  insert into public.stock_patient_returns (return_movement_id, origin_movement_id, clinic_id, qty, total_cost_cents, reason, created_by)
    values (r.id, m.id, m.clinic_id, v_qty, v_total, btrim(p_reason), private.current_profile_id());
  if m.movement_type = 'package_delivery' then
    select * into l from public.fin_package_ledger where kind = 'delivery' and m.id = any (stock_movement_ids) order by created_at desc limit 1;
    if l.id is not null then
      select * into it from public.stock_items where id = m.item_id;
      update public.fin_patient_package_items set qty_used = greatest(qty_used - v_qty, 0) where id = l.patient_package_item_id;
      v_val := round(l.value_cents::numeric * v_qty / l.qty)::bigint;
      insert into public.fin_package_ledger (clinic_id, unit_id, patient_package_item_id, patient_id, kind, qty, value_cents, stock_movement_ids, occurred_on, reason, created_by)
        values (l.clinic_id, l.unit_id, l.patient_package_item_id, l.patient_id, 'delivery_return', -v_qty, -v_val, array[r.id], private.fin_today(), 'Devolução: ' || btrim(p_reason), private.current_profile_id());
      perform private.fin_emit(l.clinic_id, l.unit_id, 'package_item_returned', m.sale_id, jsonb_build_object('patient_package_item_id', l.patient_package_item_id, 'patient_id', l.patient_id,
        'qty', v_qty, 'value_cents', v_val, 'returned_on', private.fin_today(), 'reason', btrim(p_reason)));
    end if;
  end if;
  return r.id;
end $$;

-- 7.3 Resolver «consumo sem saldo»: baixa retroativa (depois de lançar a entrada) ou ajuste (a regularização foi feita por fora). Motivo obrigatório.
create or replace function public.fin_shortfall_resolve(p_id uuid, p_mode text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.stock_shortfalls; a public.fin_appointments; it public.stock_items; r jsonb; v_ids uuid[]; v_cost bigint; v_open uuid; v_before jsonb; v_old bigint; m public.fin_appointment_materials;
begin
  select * into s from public.stock_shortfalls where id = p_id for update;
  if s.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.fin_gate(s.clinic_id, 'stock_move', s.unit_id, true);
  if s.status <> 'open' then raise exception 'ALREADY_RESOLVED' using errcode = '22023'; end if;
  if p_mode is null or p_mode not in ('retro', 'adjust') then raise exception 'INVALID_MODE' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  select * into a from public.fin_appointments where id = s.appointment_id for update;
  select * into m from public.fin_appointment_materials where id = s.material_id for update;
  select * into it from public.stock_items where id = s.item_id;
  v_before := to_jsonb(s); v_old := a.material_cost_cents;
  if p_mode = 'retro' then
    if it.fractional and s.qty < 1 then v_open := private.appt_pick_open_unit(it, s.unit_id, s.patient_id, s.qty); end if;
    r := private.stock_exit(s.clinic_id, s.unit_id, s.item_id, 'appointment', s.qty,
           jsonb_build_object('appointment_id', a.id, 'patient_id', s.patient_id, 'occurred_on', s.occurred_on, 'reason', 'Baixa retroativa do consumo sem saldo: ' || btrim(p_reason), 'open_unit_id', v_open));
    v_cost := (r->>'total_cost_cents')::bigint; v_ids := array(select jsonb_array_elements_text(r->'movement_ids')::uuid);
    update public.fin_appointment_materials set applied_qty = applied_qty + s.qty, short_qty = short_qty - s.qty, cost_cents = cost_cents + v_cost,
        estimated_cents = greatest(estimated_cents - s.est_cost_cents, 0), movement_ids = movement_ids || v_ids where id = m.id;
    update public.stock_shortfalls set status = 'resolved', resolution = 'retro_entry', resolve_reason = btrim(p_reason), resolved_at = now(), resolved_by = private.current_profile_id(), movement_ids = v_ids where id = s.id;
  else
    update public.stock_shortfalls set status = 'resolved', resolution = 'adjustment', resolve_reason = btrim(p_reason), resolved_at = now(), resolved_by = private.current_profile_id() where id = s.id;
  end if;
  perform private.appt_recalc(a.id);
  select * into a from public.fin_appointments where id = a.id;
  if a.material_cost_cents <> v_old then
    perform private.fin_emit(a.clinic_id, a.unit_id, 'appointment_material_adjusted', a.sale_id, jsonb_build_object('appointment_id', a.id, 'performed_on', a.performed_on,
      'old_cost_cents', v_old, 'new_cost_cents', a.material_cost_cents, 'delta_cents', a.material_cost_cents - v_old, 'reason', 'Consumo sem saldo resolvido'));
  end if;
  perform private.fin_log(s.clinic_id, s.unit_id, 'stock_shortfall', s.id, 'update', v_before, (select to_jsonb(x) from public.stock_shortfalls x where x.id = s.id), p_reason);
end $$;

-- ---------- 8. RPCs de leitura ----------
-- 8.1 O que a tela de «Novo atendimento» precisa: papéis do serviço, profissionais, vendas e pacotes do paciente que cobrem o serviço.
create or replace function public.fin_appt_context(p_clinic uuid, p_unit uuid, p_patient uuid, p_service uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean; v_sales boolean; v_out jsonb; sv public.fin_services;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_mgr := private.fin_can(p_clinic, 'appt', p_unit, true);
  if not v_mgr and not private.appt_is_pro(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_patient is not null and not v_mgr and not private.can_access_patient(p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_sales := private.fin_can(p_clinic, 'sales', p_unit, false);
  select * into sv from public.fin_services where id = p_service and clinic_id = p_clinic;
  v_out := jsonb_build_object(
    'can_manage', v_mgr, 'is_professional', private.appt_is_pro(p_clinic),
    'my_professional_id', (select pr.id from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active' limit 1),
    'roles', to_jsonb(sv.roles),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'roles', to_jsonb(s.roles)) order by s.name) from public.fin_services s where s.clinic_id = p_clinic and s.is_active), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(pf.full_name, 'Profissional')) order by pf.full_name)
                                 from public.professionals pr left join public.profiles pf on pf.id = pr.profile_id where pr.clinic_id = p_clinic and coalesce(pr.status, 'active') = 'active'), '[]'::jsonb),
    'sale_items', case when p_patient is null or p_service is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('sale_item_id', it.id, 'sale_id', s.id, 'description', it.description, 'sold_on', (s.created_at at time zone 'America/Sao_Paulo')::date,
                 'remaining', floor(it.quantity) - (select count(*) from public.fin_appointments a where a.sale_item_id = it.id and a.status <> 'canceled'),
                 'net_cents', case when v_sales then it.net_cents end) order by s.created_at desc)
          from public.fin_sale_items it join public.fin_sales s on s.id = it.sale_id
         where s.clinic_id = p_clinic and s.patient_id = p_patient and s.status <> 'canceled' and it.item_type = 'service' and it.service_id = p_service
           and floor(it.quantity) - (select count(*) from public.fin_appointments a where a.sale_item_id = it.id and a.status <> 'canceled') > 0), '[]'::jsonb) end,
    'packages', case when p_patient is null or p_service is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('patient_package_item_id', pi.id, 'patient_package_id', pp.id, 'name', pp.name, 'expires_on', pp.expires_on,
                 'qty_total', pi.qty_total, 'qty_used', pi.qty_used,
                 'remaining', pi.qty_total - pi.qty_used - (select count(*) from public.fin_appointments a where a.patient_package_item_id = pi.id and a.status = 'open')) order by pp.expires_on)
          from public.fin_patient_package_items pi join public.fin_patient_packages pp on pp.id = pi.patient_package_id
         where pp.clinic_id = p_clinic and pp.patient_id = p_patient and pp.status = 'active' and pp.expires_on >= private.fin_today() and pi.item_type = 'service' and pi.service_id = p_service
           and pi.qty_total - pi.qty_used - (select count(*) from public.fin_appointments a where a.patient_package_item_id = pi.id and a.status = 'open') >= 1), '[]'::jsonb) end);
  return v_out;
end $$;

-- 8.2 Lista de atendimentos. Gestor/Financeiro/Admin: todos da unidade (Financeiro vê paciente, serviço, valor e data); profissional: só os em que participa.
-- O custo do material só aparece para quem lê o estoque (Admin, Gestor, Estoquista, Financeiro): para os demais vem nulo.
create or replace function public.fin_appt_list(p_clinic uuid, p_unit uuid default null, p_status text default null, p_from date default null, p_to date default null,
                                                p_patient uuid default null, p_professional uuid default null, p_only_without_sale boolean default false, p_only_shortfall boolean default false,
                                                p_limit integer default 200, p_offset integer default 0)
returns table (id uuid, performed_on date, status text, unit_id uuid, unit_name text, patient_id uuid, patient_name text, service_id uuid, service_name text, participants jsonb,
               sale_id uuid, package_name text, without_sale boolean, base_value_cents integer, material_cost_cents bigint, material_estimated_cents bigint, has_shortfall boolean,
               can_manage boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_view uuid[]; v_cost uuid[]; v_write uuid[]; v_pros uuid[];
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(array_agg(u.id) filter (where private.fin_can(p_clinic, 'appt', u.id, false)), '{}'), coalesce(array_agg(u.id) filter (where private.fin_can(p_clinic, 'stock_move', u.id, false)), '{}'),
         coalesce(array_agg(u.id) filter (where private.fin_can(p_clinic, 'appt', u.id, true)), '{}')
    into v_view, v_cost, v_write from public.clinic_units u where u.clinic_id = p_clinic;
  select coalesce(array_agg(pr.id), '{}') into v_pros from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status, 'active') = 'active';
  if cardinality(v_view) = 0 and cardinality(v_pros) = 0 then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with page as (
      select a.* from public.fin_appointments a
       where a.clinic_id = p_clinic and (p_unit is null or a.unit_id = p_unit) and (p_status is null or a.status = p_status)
         and (p_from is null or a.performed_on >= p_from) and (p_to is null or a.performed_on <= p_to) and (p_patient is null or a.patient_id = p_patient)
         and (a.unit_id = any (v_view) or exists (select 1 from public.fin_appointment_participants q where q.appointment_id = a.id and q.professional_id = any (v_pros)))
         and (p_professional is null or exists (select 1 from public.fin_appointment_participants q where q.appointment_id = a.id and q.professional_id = p_professional))
         and (not coalesce(p_only_without_sale, false) or (a.status = 'done' and a.sale_item_id is null and a.patient_package_item_id is null))
         and (not coalesce(p_only_shortfall, false) or a.has_shortfall)
       order by a.performed_on desc, a.created_at desc, a.id
       limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0))
    select a.id, a.performed_on, a.status, a.unit_id, u.name, a.patient_id, ppr.full_name, a.service_id, a.service_name,
           coalesce((select jsonb_agg(jsonb_build_object('professional_id', q.professional_id, 'name', coalesce(qpr.full_name, 'Profissional'), 'role', q.role) order by q.position)
                       from public.fin_appointment_participants q join public.professionals qp on qp.id = q.professional_id left join public.profiles qpr on qpr.id = qp.profile_id
                      where q.appointment_id = a.id), '[]'::jsonb),
           a.sale_id, (select pp.name from public.fin_patient_package_items pi join public.fin_patient_packages pp on pp.id = pi.patient_package_id where pi.id = a.patient_package_item_id),
           (a.status = 'done' and a.sale_item_id is null and a.patient_package_item_id is null), a.base_value_cents,
           case when a.unit_id = any (v_cost) then a.material_cost_cents end, case when a.unit_id = any (v_cost) then a.material_estimated_cents end, a.has_shortfall,
           (a.unit_id = any (v_write) or exists (select 1 from public.fin_appointment_participants q where q.appointment_id = a.id and q.professional_id = any (v_pros) and q.role in ('responsavel','executor'))),
           a.created_at
      from page a
      join public.clinic_units u on u.id = a.unit_id
      join public.patients pt on pt.id = a.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
     order by a.performed_on desc, a.created_at desc, a.id;
end $$;

-- 8.3 Detalhe de um atendimento (participantes, materiais com custo mascarado, vínculos, sobras sem saldo).
create or replace function public.fin_appt_get(p_appt uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.fin_appointments; v_cost boolean; v_sales boolean;
begin
  select * into a from public.fin_appointments where id = p_appt;
  if a.id is null or not private.appt_can(a.id, false) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_cost := private.fin_can(a.clinic_id, 'stock_move', a.unit_id, false);
  v_sales := private.fin_can(a.clinic_id, 'sales', a.unit_id, false);
  return jsonb_build_object(
    'id', a.id, 'clinic_id', a.clinic_id, 'unit_id', a.unit_id, 'unit_name', (select u.name from public.clinic_units u where u.id = a.unit_id),
    'status', a.status, 'performed_on', a.performed_on, 'service_id', a.service_id, 'service_name', a.service_name, 'patient_id', a.patient_id,
    'patient_name', (select pr.full_name from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = a.patient_id),
    'sale_id', a.sale_id, 'sale_item_id', a.sale_item_id, 'patient_package_item_id', a.patient_package_item_id, 'notes', a.notes,
    'agenda_appointment_id', a.agenda_appointment_id, 'encounter_id', a.encounter_id,
    'base_value_cents', case when v_sales or v_cost then a.base_value_cents end,
    'material_cost_cents', case when v_cost then a.material_cost_cents end, 'material_estimated_cents', case when v_cost then a.material_estimated_cents end,
    'has_shortfall', a.has_shortfall, 'can_manage', private.appt_can(a.id, true), 'can_cost', v_cost,
    'cancel_reason', a.cancel_reason, 'done_at', a.done_at, 'canceled_at', a.canceled_at,
    'package', (select jsonb_build_object('name', pp.name, 'item_name', pi.name, 'qty_total', pi.qty_total, 'qty_used', pi.qty_used, 'expires_on', pp.expires_on)
                  from public.fin_patient_package_items pi join public.fin_patient_packages pp on pp.id = pi.patient_package_id where pi.id = a.patient_package_item_id),
    'sale_description', (select it.description from public.fin_sale_items it where it.id = a.sale_item_id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('professional_id', q.professional_id, 'name', coalesce(qpr.full_name, 'Profissional'), 'role', q.role) order by q.position)
                                from public.fin_appointment_participants q join public.professionals qp on qp.id = q.professional_id left join public.profiles qpr on qpr.id = qp.profile_id
                               where q.appointment_id = a.id), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'item_id', m.item_id, 'item_name', i.name, 'consumption_unit', i.consumption_unit, 'stock_unit', i.stock_unit, 'batch', m.batch, 'source', m.source,
                                   'planned_qty', m.planned_qty, 'qty_consumption', m.qty_consumption, 'qty', m.qty, 'applied_qty', m.applied_qty, 'short_qty', m.short_qty, 'status', m.status,
                                   'cost_cents', case when v_cost then m.cost_cents end, 'estimated_cents', case when v_cost then m.estimated_cents end) order by m.batch, i.name)
                             from public.fin_appointment_materials m join public.stock_items i on i.id = m.item_id where m.appointment_id = a.id), '[]'::jsonb));
end $$;

-- 8.4 Kit para a confirmação: kit do serviço pré-preenchido (atendimento aberto) ou o confirmado (realizado), com os lotes em ordem de validade e o lote sugerido.
create or replace function public.fin_appt_kit(p_appt uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.fin_appointments; v_cost boolean; v_today date := private.fin_today();
begin
  select * into a from public.fin_appointments where id = p_appt;
  if a.id is null or not private.appt_can(a.id, false) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_cost := private.fin_can(a.clinic_id, 'stock_move', a.unit_id, false);
  return jsonb_build_object(
    'appointment_id', a.id, 'status', a.status, 'unit_id', a.unit_id, 'patient_id', a.patient_id, 'can_cost', v_cost,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'consumption_unit', i.consumption_unit, 'stock_unit', i.stock_unit, 'factor', i.stock_to_consumption_factor,
               'fractional', i.fractional, 'individual_use', i.individual_use, 'lot_control', i.lot_control, 'planned_qty', src.planned, 'qty', src.qty, 'source', src.source,
               'short_qty', src.short_qty, 'status', src.status,
               'balance', coalesce((select b.qty_on_hand from public.stock_balances b where b.item_id = i.id and b.unit_id = a.unit_id), 0),
               'avg_cost_cents', case when v_cost then (select b.avg_cost_cents from public.stock_balances b where b.item_id = i.id and b.unit_id = a.unit_id) end,
               'cost_cents', case when v_cost then src.cost end,
               'lots', coalesce((select jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot_code', l.lot_code, 'expiry_date', l.expiry_date, 'available', l.qty_on_hand - private.stock_lot_open_qty(l.id),
                                        'expired', l.expiry_date is not null and l.expiry_date < v_today) order by l.expiry_date nulls last, l.lot_code)
                                   from public.stock_lots l where l.item_id = i.id and l.unit_id = a.unit_id and l.qty_on_hand > 0), '[]'::jsonb),
               'suggested_lot_id', (select l.id from public.stock_lots l where l.item_id = i.id and l.unit_id = a.unit_id and l.qty_on_hand - private.stock_lot_open_qty(l.id) > 0
                                       and (l.expiry_date is null or l.expiry_date >= v_today) order by l.expiry_date nulls last, l.lot_code, l.id limit 1)
             ) order by i.name)
        from (
          select k.item_id, k.quantity as planned, k.quantity as qty, 'kit'::text as source, 0::numeric as short_qty, 'planned'::text as status, 0::bigint as cost
            from public.fin_service_kit_items k where k.service_id = a.service_id and a.status = 'open'
          union all
          select m.item_id, m.planned_qty, m.qty_consumption, m.source, m.short_qty, m.status, m.cost_cents + m.estimated_cents
            from public.fin_appointment_materials m
           where m.appointment_id = a.id and a.status <> 'open' and m.status = 'active'
        ) src join public.stock_items i on i.id = src.item_id), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'consumption_unit', i.consumption_unit, 'stock_unit', i.stock_unit, 'fractional', i.fractional) order by i.name)
                           from public.stock_items i where i.clinic_id = a.clinic_id and i.is_active), '[]'::jsonb));
end $$;

-- 8.5 Pacotes dos pacientes: saldo de sessões e itens. Recepção/Financeiro/Gestor/Admin: todos; profissional: só do paciente a que tem acesso (sem valores).
create or replace function public.fin_patient_packages_list(p_clinic uuid, p_patient uuid default null, p_status text default null, p_search text default null, p_limit integer default 200, p_offset integer default 0)
returns table (id uuid, patient_id uuid, patient_name text, unit_id uuid, unit_name text, name text, sale_id uuid, purchased_on date, expires_on date, status text, expired boolean,
               price_cents integer, items jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_units uuid[]; v_all boolean;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(array_agg(u.id) filter (where private.fin_can(p_clinic, 'patient_pkg', u.id, false)), '{}') into v_units from public.clinic_units u where u.clinic_id = p_clinic;
  v_all := cardinality(v_units) > 0;
  if not v_all then
    if p_patient is null or not private.appt_is_pro(p_clinic) or not private.can_access_patient(p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  return query
    with page as (
      select p.* from public.fin_patient_packages p
       where p.clinic_id = p_clinic and (p_patient is null or p.patient_id = p_patient) and (v_all and p.unit_id = any (v_units) or (not v_all))
         and (p_status is null or p.status = p_status)
       order by p.purchased_on desc, p.created_at desc, p.id
       limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0))
    select p.id, p.patient_id, ppr.full_name, p.unit_id, u.name, p.name, p.sale_id, p.purchased_on, p.expires_on, p.status, (p.status = 'active' and p.expires_on < private.fin_today()),
           case when v_all then p.price_cents end,
           coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'item_type', i.item_type, 'name', i.name, 'service_id', i.service_id, 'stock_item_id', i.stock_item_id,
                                      'qty_total', i.qty_total, 'qty_used', i.qty_used, 'remaining', i.qty_total - i.qty_used,
                                      'net_total_cents', case when v_all then i.net_total_cents end) order by i.position)
                       from public.fin_patient_package_items i where i.patient_package_id = p.id), '[]'::jsonb)
      from page p
      join public.clinic_units u on u.id = p.unit_id
      join public.patients pt on pt.id = p.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
     where (nullif(btrim(coalesce(p_search, '')), '') is null or ppr.full_name ilike '%' || btrim(p_search) || '%' or p.name ilike '%' || btrim(p_search) || '%')
     order by p.purchased_on desc, p.created_at desc, p.id;
end $$;

-- 8.6 Consumo sem saldo (alerta ao gestor, §8.5 item 4).
create or replace function public.fin_shortfalls_list(p_clinic uuid, p_unit uuid default null, p_status text default 'open', p_limit integer default 200, p_offset integer default 0)
returns table (id uuid, created_at timestamptz, occurred_on date, unit_id uuid, unit_name text, item_id uuid, item_name text, stock_unit text, qty numeric, est_cost_cents bigint,
               appointment_id uuid, service_name text, patient_name text, status text, resolution text, resolve_reason text, resolved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_gate(p_clinic, 'stock_move', p_unit, false);
  return query
    with allowed as (select u.id, u.name from public.clinic_units u where u.clinic_id = p_clinic and (p_unit is null or u.id = p_unit) and private.fin_can(p_clinic, 'stock_move', u.id, false)),
    page as (
      select s.* from public.stock_shortfalls s
       where s.clinic_id = p_clinic and s.unit_id in (select al.id from allowed al) and (p_status is null or s.status = p_status)
       order by s.created_at desc, s.id
       limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0))
    select s.id, s.created_at, s.occurred_on, s.unit_id, al.name, s.item_id, i.name, i.stock_unit, s.qty, s.est_cost_cents, s.appointment_id, a.service_name, ppr.full_name,
           s.status, s.resolution, s.resolve_reason, s.resolved_at
      from page s
      join allowed al on al.id = s.unit_id
      join public.stock_items i on i.id = s.item_id
      join public.fin_appointments a on a.id = s.appointment_id
      left join public.patients pt on pt.id = s.patient_id
      left join public.profiles ppr on ppr.id = pt.profile_id
     order by s.created_at desc, s.id;
end $$;

-- 8.7 Busca de paciente para o «Novo atendimento»: Gestor/Admin acham qualquer paciente da clínica; o profissional só os pacientes a que tem acesso.
create or replace function public.fin_appt_patients(p_clinic uuid, p_search text default null, p_limit integer default 20)
returns table (patient_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean;
begin
  if p_clinic is null or not private.is_clinic_member(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_mgr := private.fin_can(p_clinic, 'appt', null, true);
  if not v_mgr and not private.appt_is_pro(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select pt.id, pr.full_name
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic and coalesce(pr.status::text, '') <> 'inactive'
       and (v_mgr or private.can_access_patient(pt.id))
       and (nullif(btrim(coalesce(p_search, '')), '') is null or pr.full_name ilike '%' || btrim(p_search) || '%')
     order by pr.full_name limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- ---------- 9. Permissões de execução ----------
revoke all on function private.fin_e4_no_delete(), private.fin_e4_immutable(), private.fin_emit(uuid, uuid, text, uuid, jsonb), private.appt_self(uuid, boolean), private.appt_can(uuid, boolean),
  private.appt_is_pro(uuid), private.appt_snapshot(uuid), private.appt_check_participants(uuid, uuid, jsonb), private.appt_check_link(uuid, uuid, uuid, uuid, uuid, uuid, date),
  private.appt_pick_open_unit(public.stock_items, uuid, uuid, numeric), private.appt_recalc(uuid), private.appt_apply_materials(public.fin_appointments, jsonb, integer),
  private.appt_reverse_materials(public.fin_appointments, text), private.pkg_item_value(public.fin_patient_package_items, numeric), private.pkg_use_session(public.fin_appointments),
  private.pkg_on_sale_item(), private.pkg_on_sale_cancel(), private.stock_on_sale_cancel() from public, anon, authenticated;

revoke all on function public.fin_appt_save(uuid, uuid, uuid, jsonb, jsonb, text), public.fin_appt_complete(uuid, jsonb, text), public.fin_appt_correct(uuid, jsonb, text),
  public.fin_appt_cancel(uuid, text), public.fin_appt_set_participants(uuid, jsonb, text), public.fin_package_deliver(uuid, numeric, jsonb), public.fin_stock_patient_return(uuid, numeric, text),
  public.fin_shortfall_resolve(uuid, text, text), public.fin_appt_context(uuid, uuid, uuid, uuid),
  public.fin_appt_list(uuid, uuid, text, date, date, uuid, uuid, boolean, boolean, integer, integer), public.fin_appt_get(uuid), public.fin_appt_kit(uuid),
  public.fin_patient_packages_list(uuid, uuid, text, text, integer, integer), public.fin_shortfalls_list(uuid, uuid, text, integer, integer),
  public.fin_appt_patients(uuid, text, integer) from public, anon;
grant execute on function public.fin_appt_save(uuid, uuid, uuid, jsonb, jsonb, text), public.fin_appt_complete(uuid, jsonb, text), public.fin_appt_correct(uuid, jsonb, text),
  public.fin_appt_cancel(uuid, text), public.fin_appt_set_participants(uuid, jsonb, text), public.fin_package_deliver(uuid, numeric, jsonb), public.fin_stock_patient_return(uuid, numeric, text),
  public.fin_shortfall_resolve(uuid, text, text), public.fin_appt_context(uuid, uuid, uuid, uuid),
  public.fin_appt_list(uuid, uuid, text, date, date, uuid, uuid, boolean, boolean, integer, integer), public.fin_appt_get(uuid), public.fin_appt_kit(uuid),
  public.fin_patient_packages_list(uuid, uuid, text, text, integer, integer), public.fin_shortfalls_list(uuid, uuid, text, integer, integer),
  public.fin_appt_patients(uuid, text, integer) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261114090000','20261114090000_fin_e4_atendimento.sql','FIN-E4: atendimento com participantes, kit automático (baixa do estoque, custo do material, consumo sem saldo), pacotes (saldo de sessões, entrega de item), devolução de paciente (aditiva).','FIN-E4');
