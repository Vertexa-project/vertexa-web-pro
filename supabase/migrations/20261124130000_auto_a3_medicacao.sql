-- =====================================================================================
-- AUTOMAÇÃO A3 — Controle de aplicação de medicação (tirzepatida) · Versão 1
--
-- SÓ OBJETOS NOVOS. Nada existente é recriado, alterado ou removido.
--   1) clinic_med_settings        liga/desliga do lembrete no app, por clínica (nasce DESLIGADO).
--   2) patient_med_treatments     o tratamento do paciente (medicação, início, dose atual em mg, dia da semana, onde aplica).
--   3) patient_med_doses          histórico de doses (cada ajuste gera uma linha com a data de vigência).
--   4) patient_med_applications   aplicações feitas (data, dose, onde, quem) + baixa de estoque opcional.
--   5) patient_med_deliveries     entregas (data, quantidade de canetas/doses) + baixa de estoque opcional.
--   RPCs: med_get_settings/med_set_settings, med_save_treatment, med_adjust_dose, med_end_treatment,
--         med_record_application, med_record_delivery, med_remove_entry, med_stock_options, med_states, med_overdue_list,
--         med_patient_today (app) e med_patient_confirm (app, "Já apliquei").
--
-- Permissão (E9: Recepção/Financeiro/Estoquista NÃO veem dado clínico):
--   * ler  = private.can_access_patient_internal (paciente, profissional vinculado, admin da clínica);
--   * editar = private.can_write_discipline(paciente, medico|nutricionista) (a mesma regra de quem escreve no prontuário);
--   * o PACIENTE só escreve pela med_patient_confirm ("Já apliquei"), e só com o lembrete ligado na clínica;
--   * a baixa no estoque usa private.stock_exit (E3: FEFO, validade, fração; saldo insuficiente BLOQUEIA e desfaz tudo) —
--     o profissional NÃO precisa de papel de estoque para isso, como no atendimento (E4).
--   * escrita direta nas tabelas é revogada: só RPC.
--
-- "Atrasada/hoje" é DERIVADO na leitura em America/Sao_Paulo (sem cron): o dia da aplicação mais recente (>= início) sem
-- aplicação registrada de 2 dias antes em diante.
--
-- Reversão: drop das 13 funções public + 4 private, das 5 tabelas (cascade) e do registro em schema_migration_log.
-- =====================================================================================

-- ───────────────────────── 1) Configuração por clínica
create table if not exists public.clinic_med_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  patient_reminder_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.clinic_med_settings enable row level security;
revoke all on public.clinic_med_settings from anon, authenticated;
grant select on public.clinic_med_settings to authenticated;
drop policy if exists clinic_med_settings_select on public.clinic_med_settings;
create policy clinic_med_settings_select on public.clinic_med_settings for select to authenticated
  using ( private.is_clinic_admin(clinic_id) );

-- ───────────────────────── 2) Tratamento
create table if not exists public.patient_med_treatments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  medication text not null default 'Tirzepatida' check (char_length(btrim(medication)) between 1 and 80),
  started_on date not null,
  dose_mg numeric(6,2) not null check (dose_mg > 0 and dose_mg <= 100),
  weekday smallint not null check (weekday between 0 and 6),            -- 0 = domingo ... 6 = sábado (igual ao JavaScript)
  applied_where text not null default 'home' check (applied_where in ('home','clinic')),
  notes text check (notes is null or char_length(notes) <= 500),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  stock_unit_id uuid references public.clinic_units(id) on delete set null,
  status text not null default 'active' check (status in ('active','ended')),
  ended_on date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'active' or ended_on is not null)
);
create unique index if not exists patient_med_one_active on public.patient_med_treatments (patient_id, lower(btrim(medication))) where status = 'active';
create index if not exists patient_med_treatments_clinic_idx on public.patient_med_treatments (clinic_id) where status = 'active';
create index if not exists patient_med_treatments_patient_idx on public.patient_med_treatments (patient_id);

-- ───────────────────────── 3) Histórico de doses
create table if not exists public.patient_med_doses (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.patient_med_treatments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  dose_mg numeric(6,2) not null check (dose_mg > 0 and dose_mg <= 100),
  effective_on date not null,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists patient_med_doses_treatment_idx on public.patient_med_doses (treatment_id, effective_on desc, created_at desc);
create index if not exists patient_med_doses_patient_idx on public.patient_med_doses (patient_id);

-- ───────────────────────── 4) Aplicações
create table if not exists public.patient_med_applications (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.patient_med_treatments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  applied_on date not null,
  dose_mg numeric(6,2) not null check (dose_mg > 0 and dose_mg <= 100),
  place text not null check (place in ('home','clinic')),
  source text not null check (source in ('patient','professional')),
  applied_by_name text check (applied_by_name is null or char_length(applied_by_name) <= 120),
  note text check (note is null or char_length(note) <= 300),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  stock_movement_ids uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint patient_med_one_application_per_day unique (treatment_id, applied_on)
);
create index if not exists patient_med_applications_patient_idx on public.patient_med_applications (patient_id, applied_on desc);

-- ───────────────────────── 5) Entregas
create table if not exists public.patient_med_deliveries (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.patient_med_treatments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  delivered_on date not null,
  quantity integer not null check (quantity between 1 and 99),
  note text check (note is null or char_length(note) <= 300),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  stock_movement_ids uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists patient_med_deliveries_patient_idx on public.patient_med_deliveries (patient_id, delivered_on desc);

-- ───────────────────────── RLS (leitura; escrita só por RPC)
do $$
declare t text;
begin
  foreach t in array array['patient_med_treatments','patient_med_doses','patient_med_applications','patient_med_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ( private.can_access_patient_internal(patient_id) )', t || '_select', t);
  end loop;
end $$;

-- ───────────────────────── Helpers privados
-- Quem edita: médico ou nutricionista com vínculo (a mesma regra do prontuário). Recepção, Financeiro e Estoquista não passam.
create or replace function private.med_gate(p_patient uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_profile_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not coalesce(private.can_write_discipline(p_patient, array['medico','nutricionista']), false) then
    raise exception 'forbidden: clinical access required' using errcode = '42501';
  end if;
end $$;

-- Estado derivado: hoje | atrasada | em dia | futuro (início ainda não chegou) | encerrado.
create or replace function private.med_state(p_treatment uuid, p_today date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.patient_med_treatments; v_due date; v_done boolean;
begin
  select * into t from public.patient_med_treatments where id = p_treatment;
  if t.id is null or t.status <> 'active' then return jsonb_build_object('state', 'ended', 'due_on', null, 'days_late', 0); end if;
  v_due := p_today - ((extract(dow from p_today)::int - t.weekday + 7) % 7);
  if v_due < t.started_on then return jsonb_build_object('state', 'upcoming', 'due_on', null, 'days_late', 0); end if;
  select exists (select 1 from public.patient_med_applications a where a.treatment_id = t.id and a.applied_on >= v_due - 2) into v_done;
  if v_done then return jsonb_build_object('state', 'ok', 'due_on', v_due, 'days_late', 0); end if;
  if v_due = p_today then return jsonb_build_object('state', 'today', 'due_on', v_due, 'days_late', 0); end if;
  return jsonb_build_object('state', 'overdue', 'due_on', v_due, 'days_late', p_today - v_due);
end $$;

-- Baixa de estoque (E3). Item e unidade são da clínica do paciente; saldo insuficiente levanta INSUFFICIENT_STOCK e a transação inteira volta.
create or replace function private.med_stock_out(p_clinic uuid, p_patient uuid, p_item uuid, p_unit uuid, p_qty numeric, p_on date, p_reason text)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not exists (select 1 from public.stock_items i where i.id = p_item and i.clinic_id = p_clinic and i.is_active) then
    raise exception 'INVALID_ITEM' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinic_units u where u.id = p_unit and u.clinic_id = p_clinic and u.is_active) then
    raise exception 'INVALID_UNITS' using errcode = '22023';
  end if;
  r := private.stock_exit(p_clinic, p_unit, p_item, 'appointment', p_qty,
         jsonb_build_object('patient_id', p_patient, 'occurred_on', p_on, 'reason', left(p_reason, 300)));
  return array(select jsonb_array_elements_text(r->'movement_ids')::uuid);
end $$;

-- ───────────────────────── 1) Configuração
create or replace function public.med_get_settings(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('patient_reminder_enabled',
    coalesce((select s.patient_reminder_enabled from public.clinic_med_settings s where s.clinic_id = p_clinic), false));
end $$;

create or replace function public.med_set_settings(p_clinic uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.clinic_med_settings (clinic_id, patient_reminder_enabled, updated_by)
  values (p_clinic, coalesce(p_enabled, false), private.current_profile_id())
  on conflict (clinic_id) do update set patient_reminder_enabled = excluded.patient_reminder_enabled,
         updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ───────────────────────── 2) Cadastrar / editar tratamento (a dose muda só por med_adjust_dose)
create or replace function public.med_save_treatment(
  p_patient uuid, p_id uuid, p_medication text, p_started_on date, p_dose_mg numeric, p_weekday int,
  p_where text, p_notes text, p_stock_item uuid default null, p_stock_unit uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid := private.patient_clinic(p_patient); v_med text := coalesce(nullif(btrim(coalesce(p_medication, '')), ''), 'Tirzepatida');
        v_id uuid; v_today date := private.brt_date(now());
begin
  perform private.med_gate(p_patient);
  if p_weekday is null or p_weekday not between 0 and 6 then raise exception 'INVALID_WEEKDAY' using errcode = '22023'; end if;
  if p_where is null or p_where not in ('home','clinic') then raise exception 'INVALID_PLACE' using errcode = '22023'; end if;
  if p_started_on is null or p_started_on < v_today - 3650 or p_started_on > v_today + 365 then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if char_length(v_med) > 80 then raise exception 'INVALID_MEDICATION' using errcode = '22023'; end if;
  if (p_stock_item is null) <> (p_stock_unit is null) then raise exception 'STOCK_LINK_INCOMPLETE' using errcode = '22023'; end if;
  if p_stock_item is not null and not (
       exists (select 1 from public.stock_items i where i.id = p_stock_item and i.clinic_id = v_clinic)
       and exists (select 1 from public.clinic_units u where u.id = p_stock_unit and u.clinic_id = v_clinic)) then
    raise exception 'INVALID_ITEM' using errcode = '22023';
  end if;
  if p_id is null then
    if p_dose_mg is null or p_dose_mg <= 0 or p_dose_mg > 100 then raise exception 'INVALID_DOSE' using errcode = '22023'; end if;
    if exists (select 1 from public.patient_med_treatments x where x.patient_id = p_patient and x.status = 'active' and lower(btrim(x.medication)) = lower(v_med)) then
      raise exception 'TREATMENT_EXISTS' using errcode = '23505';
    end if;
    insert into public.patient_med_treatments (patient_id, clinic_id, medication, started_on, dose_mg, weekday, applied_where, notes, stock_item_id, stock_unit_id, created_by)
    values (p_patient, v_clinic, v_med, p_started_on, round(p_dose_mg, 2), p_weekday, p_where, nullif(btrim(coalesce(p_notes, '')), ''), p_stock_item, p_stock_unit, private.current_profile_id())
    returning id into v_id;
    insert into public.patient_med_doses (treatment_id, patient_id, clinic_id, dose_mg, effective_on, note, created_by)
    values (v_id, p_patient, v_clinic, round(p_dose_mg, 2), p_started_on, 'Dose inicial', private.current_profile_id());
  else
    update public.patient_med_treatments set medication = v_med, started_on = p_started_on, weekday = p_weekday, applied_where = p_where,
           notes = nullif(btrim(coalesce(p_notes, '')), ''), stock_item_id = p_stock_item, stock_unit_id = p_stock_unit, updated_at = now()
     where id = p_id and patient_id = p_patient and status = 'active' returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.med_adjust_dose(p_treatment uuid, p_dose_mg numeric, p_effective_on date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.patient_med_treatments; v_id uuid; v_today date := private.brt_date(now());
begin
  select * into t from public.patient_med_treatments where id = p_treatment and status = 'active' for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.med_gate(t.patient_id);
  if p_dose_mg is null or p_dose_mg <= 0 or p_dose_mg > 100 then raise exception 'INVALID_DOSE' using errcode = '22023'; end if;
  if round(p_dose_mg, 2) = t.dose_mg then raise exception 'DOSE_UNCHANGED' using errcode = '22023'; end if;
  if p_effective_on is null or p_effective_on < v_today - 365 or p_effective_on > v_today + 90 then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  insert into public.patient_med_doses (treatment_id, patient_id, clinic_id, dose_mg, effective_on, note, created_by)
  values (t.id, t.patient_id, t.clinic_id, round(p_dose_mg, 2), p_effective_on, nullif(btrim(coalesce(p_note, '')), ''), private.current_profile_id())
  returning id into v_id;
  update public.patient_med_treatments set dose_mg = round(p_dose_mg, 2), updated_at = now() where id = t.id;
  return v_id;
end $$;

create or replace function public.med_end_treatment(p_treatment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.patient_med_treatments;
begin
  select * into t from public.patient_med_treatments where id = p_treatment for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.med_gate(t.patient_id);
  update public.patient_med_treatments set status = 'ended', ended_on = private.brt_date(now()), updated_at = now() where id = t.id and status = 'active';
end $$;

-- ───────────────────────── 4) Aplicação feita (pelo profissional)
create or replace function public.med_record_application(
  p_treatment uuid, p_applied_on date, p_dose_mg numeric, p_place text, p_note text default null,
  p_stock_item uuid default null, p_stock_unit uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.patient_med_treatments; v_id uuid; v_today date := private.brt_date(now()); v_mov uuid[] := '{}'; v_name text;
begin
  select * into t from public.patient_med_treatments where id = p_treatment and status = 'active' for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.med_gate(t.patient_id);
  if p_place is null or p_place not in ('home','clinic') then raise exception 'INVALID_PLACE' using errcode = '22023'; end if;
  if p_applied_on is null or p_applied_on > v_today or p_applied_on < v_today - 365 then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if p_dose_mg is null or p_dose_mg <= 0 or p_dose_mg > 100 then raise exception 'INVALID_DOSE' using errcode = '22023'; end if;
  if exists (select 1 from public.patient_med_applications a where a.treatment_id = t.id and a.applied_on = p_applied_on) then
    raise exception 'APPLICATION_EXISTS' using errcode = '23505';
  end if;
  select pr.full_name into v_name from public.profiles pr where pr.id = private.current_profile_id();
  -- baixa só quando há item escolhido (aplicação na clínica); sem item, só registra.
  if p_stock_item is not null then
    if p_place <> 'clinic' then raise exception 'STOCK_ONLY_CLINIC' using errcode = '22023'; end if;
    if p_stock_unit is null then raise exception 'STOCK_LINK_INCOMPLETE' using errcode = '22023'; end if;
    v_mov := private.med_stock_out(t.clinic_id, t.patient_id, p_stock_item, p_stock_unit, 1, p_applied_on,
                                   'Aplicação de ' || t.medication || ' ' || round(p_dose_mg, 2)::text || ' mg na clínica');
  end if;
  insert into public.patient_med_applications (treatment_id, patient_id, clinic_id, applied_on, dose_mg, place, source, applied_by_name, note, stock_item_id, stock_movement_ids, created_by)
  values (t.id, t.patient_id, t.clinic_id, p_applied_on, round(p_dose_mg, 2), p_place, 'professional', v_name, nullif(btrim(coalesce(p_note, '')), ''),
          case when p_stock_item is not null then p_stock_item end, v_mov, private.current_profile_id())
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── 5) Entrega (pelo profissional)
create or replace function public.med_record_delivery(
  p_treatment uuid, p_delivered_on date, p_quantity int, p_note text default null,
  p_stock_item uuid default null, p_stock_unit uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.patient_med_treatments; v_id uuid; v_today date := private.brt_date(now()); v_mov uuid[] := '{}';
begin
  select * into t from public.patient_med_treatments where id = p_treatment and status = 'active' for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.med_gate(t.patient_id);
  if p_quantity is null or p_quantity not between 1 and 99 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
  if p_delivered_on is null or p_delivered_on > v_today or p_delivered_on < v_today - 365 then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if p_stock_item is not null then
    if p_stock_unit is null then raise exception 'STOCK_LINK_INCOMPLETE' using errcode = '22023'; end if;
    v_mov := private.med_stock_out(t.clinic_id, t.patient_id, p_stock_item, p_stock_unit, p_quantity, p_delivered_on,
                                   'Entrega de ' || p_quantity::text || ' un. de ' || t.medication || ' ao paciente');
  end if;
  insert into public.patient_med_deliveries (treatment_id, patient_id, clinic_id, delivered_on, quantity, note, stock_item_id, stock_movement_ids, created_by)
  values (t.id, t.patient_id, t.clinic_id, p_delivered_on, p_quantity, nullif(btrim(coalesce(p_note, '')), ''),
          case when p_stock_item is not null then p_stock_item end, v_mov, private.current_profile_id())
  returning id into v_id;
  return v_id;
end $$;

-- Apagar um lançamento errado (aplicação ou entrega). A baixa de estoque, se houve, é ESTORNADA (nada é apagado do kardex).
create or replace function public.med_remove_entry(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; v_mov uuid[]; m uuid;
begin
  if p_kind = 'application' then
    select patient_id, stock_movement_ids into v_patient, v_mov from public.patient_med_applications where id = p_id for update;
  elsif p_kind = 'delivery' then
    select patient_id, stock_movement_ids into v_patient, v_mov from public.patient_med_deliveries where id = p_id for update;
  else
    raise exception 'INVALID_KIND' using errcode = '22023';
  end if;
  if v_patient is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.med_gate(v_patient);
  foreach m in array coalesce(v_mov, '{}') loop
    perform private.stock_reverse_one(m, 'Lançamento de medicação desfeito', false);
  end loop;
  if p_kind = 'application' then delete from public.patient_med_applications where id = p_id;
  else delete from public.patient_med_deliveries where id = p_id; end if;
end $$;

-- ───────────────────────── Itens de estoque para o seletor (o profissional não lê o estoque direto)
create or replace function public.med_stock_options(p_patient uuid)
returns table (item_id uuid, item_name text, unit_id uuid, unit_name text, qty_on_hand numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.med_gate(p_patient);
  return query
    select i.id, i.name, u.id, u.name, b.qty_on_hand
      from public.stock_items i
      join public.stock_balances b on b.item_id = i.id
      join public.clinic_units u on u.id = b.unit_id and u.is_active
     where i.clinic_id = private.patient_clinic(p_patient) and i.is_active and i.item_type = 'medication'
     order by i.name, u.is_primary desc, u.name;
end $$;

-- Estado (hoje/atrasada/em dia) dos tratamentos ativos de UM paciente, para a ficha. Lê quem acessa o paciente (inclui o próprio).
create or replace function public.med_states(p_patient uuid)
returns table (treatment_id uuid, state text, due_on date, days_late int)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.brt_date(now());
begin
  if not private.can_access_patient_internal(p_patient) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select t.id, x.s->>'state', (x.s->>'due_on')::date, (x.s->>'days_late')::int
      from public.patient_med_treatments t cross join lateral (select private.med_state(t.id, v_today) as s) x
     where t.patient_id = p_patient and t.status = 'active';
end $$;

-- ───────────────────────── Atrasadas da clínica (para o Hoje/atenção; só pacientes que a pessoa acompanha, via RLS de patients)
create or replace function public.med_overdue_list(p_limit int default 100)
returns table (treatment_id uuid, patient_id uuid, patient_name text, medication text, dose_mg numeric, due_on date, days_late int)
language plpgsql stable security invoker set search_path = '' as $$
declare v_today date := private.brt_date(now());
begin
  return query
    select t.id, t.patient_id, pr.full_name, t.medication, t.dose_mg, (x.s->>'due_on')::date, (x.s->>'days_late')::int
      from public.patient_med_treatments t
      join public.patients p on p.id = t.patient_id
      left join public.profiles pr on pr.id = p.profile_id
      cross join lateral (select private.med_state(t.id, v_today) as s) x
     where t.status = 'active' and x.s->>'state' = 'overdue'
     order by (x.s->>'days_late')::int desc
     limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

-- ───────────────────────── App do paciente
-- O tratamento que pede ação primeiro: atrasada > hoje > o resto (empate: o mais novo).
create or replace function private.med_patient_pick(p_patient uuid, p_today date) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.patient_med_treatments x
   where x.patient_id = p_patient and x.status = 'active'
   order by case private.med_state(x.id, p_today)->>'state' when 'overdue' then 0 when 'today' then 1 when 'ok' then 2 else 3 end, x.created_at desc
   limit 1
$$;

create or replace function public.med_patient_today() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_patient uuid; v_clinic uuid; t public.patient_med_treatments; v_today date := private.brt_date(now()); st jsonb;
begin
  select pt.id, pt.clinic_id into v_patient, v_clinic from public.patients pt where pt.profile_id = private.current_profile_id() limit 1;
  if v_patient is null or not private.clinic_is_operational(v_clinic) then return jsonb_build_object('enabled', false); end if;
  if not coalesce((select s.patient_reminder_enabled from public.clinic_med_settings s where s.clinic_id = v_clinic), false) then
    return jsonb_build_object('enabled', false);
  end if;
  select * into t from public.patient_med_treatments x where x.id = private.med_patient_pick(v_patient, v_today);
  if t.id is null then return jsonb_build_object('enabled', true, 'state', 'none'); end if;
  st := private.med_state(t.id, v_today);
  return jsonb_build_object('enabled', true, 'state', st->>'state', 'due_on', st->'due_on', 'days_late', st->'days_late',
    'treatment_id', t.id, 'medication', t.medication, 'dose_mg', t.dose_mg, 'weekday', t.weekday);
end $$;

create or replace function public.med_patient_confirm(p_treatment uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; v_clinic uuid; t public.patient_med_treatments; v_today date := private.brt_date(now()); st jsonb; v_id uuid; v_name text;
begin
  select pt.id, pt.clinic_id, pr.full_name into v_patient, v_clinic, v_name
    from public.patients pt left join public.profiles pr on pr.id = pt.profile_id
   where pt.profile_id = private.current_profile_id() limit 1;
  if v_patient is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not coalesce((select s.patient_reminder_enabled from public.clinic_med_settings s where s.clinic_id = v_clinic), false) then
    raise exception 'forbidden: reminder is off for this clinic' using errcode = '42501';
  end if;
  select * into t from public.patient_med_treatments x
   where x.id = coalesce(p_treatment, private.med_patient_pick(v_patient, v_today)) and x.patient_id = v_patient and x.status = 'active' for update;
  if t.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  st := private.med_state(t.id, v_today);
  if st->>'state' not in ('today','overdue') then raise exception 'NOTHING_DUE' using errcode = '22023'; end if;
  insert into public.patient_med_applications (treatment_id, patient_id, clinic_id, applied_on, dose_mg, place, source, applied_by_name, created_by)
  values (t.id, v_patient, v_clinic, v_today, t.dose_mg, 'home', 'patient', v_name, private.current_profile_id())
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── Permissões de execução
revoke all on function private.med_gate(uuid), private.med_state(uuid, date), private.med_stock_out(uuid, uuid, uuid, uuid, numeric, date, text), private.med_patient_pick(uuid, date) from public, anon;
grant execute on function private.med_gate(uuid), private.med_state(uuid, date), private.med_stock_out(uuid, uuid, uuid, uuid, numeric, date, text), private.med_patient_pick(uuid, date) to authenticated;
revoke all on function
  public.med_get_settings(uuid), public.med_set_settings(uuid, boolean),
  public.med_save_treatment(uuid, uuid, text, date, numeric, int, text, text, uuid, uuid),
  public.med_adjust_dose(uuid, numeric, date, text), public.med_end_treatment(uuid),
  public.med_record_application(uuid, date, numeric, text, text, uuid, uuid),
  public.med_record_delivery(uuid, date, int, text, uuid, uuid), public.med_remove_entry(text, uuid),
  public.med_stock_options(uuid), public.med_states(uuid), public.med_overdue_list(int), public.med_patient_today(), public.med_patient_confirm(uuid)
  from public, anon;
grant execute on function
  public.med_get_settings(uuid), public.med_set_settings(uuid, boolean),
  public.med_save_treatment(uuid, uuid, text, date, numeric, int, text, text, uuid, uuid),
  public.med_adjust_dose(uuid, numeric, date, text), public.med_end_treatment(uuid),
  public.med_record_application(uuid, date, numeric, text, text, uuid, uuid),
  public.med_record_delivery(uuid, date, int, text, uuid, uuid), public.med_remove_entry(text, uuid),
  public.med_stock_options(uuid), public.med_states(uuid), public.med_overdue_list(int), public.med_patient_today(), public.med_patient_confirm(uuid)
  to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261124130000','20261124130000_auto_a3_medicacao.sql',
  'Automacao A3: controle de aplicacao de medicacao (tirzepatida). Tabelas novas clinic_med_settings (lembrete no app, nasce desligado), '
  'patient_med_treatments/doses/applications/deliveries (RLS: le quem acessa o paciente; escreve so RPC; medico/nutricionista) + RPCs med_*; '
  'baixa de estoque opcional via private.stock_exit (E3: saldo insuficiente bloqueia). Hoje/atrasada derivado na leitura, sem cron. So objetos novos.',
  'AUTO-A3')
on conflict (version) do nothing;
