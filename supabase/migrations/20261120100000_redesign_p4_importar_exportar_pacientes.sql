-- Redesign parte 4 — Importar pacientes por planilha (prévia + duplicados) e exportar a base com motivo e auditoria.
-- SÓ CRIA objetos novos (3 tabelas, 2 funções internas, 4 RPCs). Não altera patients/profiles/create_patient.
--
-- Importar: public.import_patients(...) reaproveita public.create_patient (profiles + patients + vínculo do chamador) para cada
--   linha, na MESMA transação: erro em qualquer linha desfaz o lote inteiro. Exige admin da clínica (mesma regra do cadastro
--   manual). Rechecagem de duplicado no servidor (e-mail, telefone, nome + nascimento). Não envia convite nem e-mail.
-- Exportar: public.export_patients(...) grava a auditoria e devolve as linhas na MESMA transação (não existe exportar sem registrar).
--   Exige admin da clínica ou papel Gestor. Prontuário/anotações clínicas nunca entram.
-- O telefone não existe no cadastro do paciente hoje: fica em patient_import_origin (vem só da importação).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.patient_import_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  source_filename text not null check (char_length(source_filename) between 1 and 200),
  total_rows integer not null check (total_rows >= 0),
  imported_count integer not null check (imported_count >= 0),
  duplicate_count integer not null check (duplicate_count >= 0),
  error_count integer not null check (error_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists patient_import_batches_clinic_idx on public.patient_import_batches (clinic_id, created_at desc);

create table if not exists public.patient_import_origin (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  batch_id uuid not null references public.patient_import_batches(id) on delete cascade,
  source_filename text not null,
  phone text,
  phone_key text,
  imported_at timestamptz not null default now()
);
create index if not exists patient_import_origin_phone_idx on public.patient_import_origin (clinic_id, phone_key) where phone_key is not null;
create index if not exists patient_import_origin_batch_idx on public.patient_import_origin (batch_id);

create table if not exists public.patient_exports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  reason_kind text not null check (reason_kind in ('backup', 'migracao', 'auditoria', 'pedido_titular', 'outro')),
  reason_text text not null check (char_length(btrim(reason_text)) between 5 and 300),
  fields text[] not null check (cardinality(fields) between 1 and 4),
  row_count integer not null check (row_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists patient_exports_clinic_idx on public.patient_exports (clinic_id, created_at desc);

comment on table public.patient_exports is
  'Redesign P4: auditoria IMUTÁVEL de exportação da base de pacientes. Guarda quem, quando, motivo, grupos de dados e quantidade de linhas — nunca os dados exportados.';

alter table public.patient_import_batches enable row level security;
alter table public.patient_import_origin enable row level security;
alter table public.patient_exports enable row level security;
revoke all on public.patient_import_batches, public.patient_import_origin, public.patient_exports from public, anon, authenticated;
grant select on public.patient_import_batches, public.patient_import_origin, public.patient_exports to authenticated;

drop policy if exists patient_import_batches_select on public.patient_import_batches;
create policy patient_import_batches_select on public.patient_import_batches for select to authenticated
  using (private.is_clinic_admin(clinic_id));

-- A origem aparece na Timeline/cadastro: quem pode abrir a ficha do paciente (mesma regra clínica) ou o admin.
drop policy if exists patient_import_origin_select on public.patient_import_origin;
create policy patient_import_origin_select on public.patient_import_origin for select to authenticated
  using (private.is_clinic_admin(clinic_id) or private.clinical_can_access_patient(patient_id));

-- Lista "Exportações": só o admin da clínica.
drop policy if exists patient_exports_select on public.patient_exports;
create policy patient_exports_select on public.patient_exports for select to authenticated
  using (private.is_clinic_admin(clinic_id));

-- Imutável: nenhum papel tem insert/update/delete direto (só as RPCs abaixo, como dono); o gatilho barra edição até do dono.
create or replace function private.patient_exports_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'patient_exports é imutável' using errcode = '42501';
end $$;
drop trigger if exists patient_exports_no_change on public.patient_exports;
create trigger patient_exports_no_change before update on public.patient_exports
  for each row execute function private.patient_exports_immutable();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Funções internas
-- ---------------------------------------------------------------------------------------------------------------------
-- Telefone BR só com dígitos, sem o 55 do país; 10 ou 11 dígitos, senão nulo.
create or replace function private.import_phone_key(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d is null then null
    when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
    when length(d) in (10, 11) then d
    else null end
  from (select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as d) x
$$;

-- Por que este candidato é duplicado na clínica (ou nulo). Paciente removido (profile 'inactive') não conta.
create or replace function private.import_dup_reason(p_clinic uuid, p_email text, p_phone_key text, p_name text, p_birth date)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if p_email is not null and exists (
    select 1 from public.profiles pr
     where pr.email is not null and lower(btrim(pr.email)) = lower(btrim(p_email)) and coalesce(pr.status, '') <> 'inactive'
       and (exists (select 1 from public.patients pt where pt.profile_id = pr.id)
            or exists (select 1 from public.professionals po where po.profile_id = pr.id))
  ) then return 'email'; end if;
  if p_phone_key is not null and exists (
    select 1 from public.patient_import_origin o
      join public.patients pt on pt.id = o.patient_id
      join public.profiles pr on pr.id = pt.profile_id
     where o.clinic_id = p_clinic and o.phone_key = p_phone_key and coalesce(pr.status, '') <> 'inactive'
  ) then return 'telefone'; end if;
  if p_birth is not null and exists (
    select 1 from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic and pt.birth_date = p_birth and coalesce(pr.status, '') <> 'inactive'
       and lower(btrim(pr.full_name)) = lower(btrim(p_name))
  ) then return 'nome_nascimento'; end if;
  return null;
end $$;
revoke all on function private.import_phone_key(text), private.import_dup_reason(uuid, text, text, text, date) from public, anon, authenticated;

-- Quem pode exportar a base: admin da clínica ou papel Gestor.
create or replace function private.patient_export_allowed(p_clinic uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (private.is_clinic_admin(p_clinic) or private.fin_has_role(p_clinic, array['gestor']))
$$;
revoke all on function private.patient_export_allowed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. RPC: chaves para a prévia (só admin) — o navegador detecta duplicados contra a base da clínica
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.patient_import_dedupe_keys(p_clinic uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_profile_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_clinic_admin(p_clinic) then
    raise exception 'forbidden: PATIENT_IMPORT_ADMIN_REQUIRED' using errcode = '42501', hint = 'PATIENT_IMPORT_ADMIN_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'email', nullif(lower(btrim(coalesce(pr.email, ''))), ''),
             'name', btrim(pr.full_name),
             'birth_date', pt.birth_date,
             'phone_key', o.phone_key))
      from public.patients pt
      join public.profiles pr on pr.id = pt.profile_id
      left join public.patient_import_origin o on o.patient_id = pt.id
     where pt.clinic_id = p_clinic and coalesce(pr.status, '') <> 'inactive'), '[]'::jsonb);
end $$;
revoke all on function public.patient_import_dedupe_keys(uuid) from public, anon;
grant execute on function public.patient_import_dedupe_keys(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. RPC: importar (atômico)
-- p_rows: [{line, name, email, phone, birth_date 'YYYY-MM-DD', sex, goal, height_cm, weight_kg, force}]
-- force=true só libera duplicado por telefone ou por nome+nascimento; e-mail repetido nunca entra.
-- Devolve {batch_id, imported, duplicates, errors, results:[{line, status: importado|duplicado|erro, reason, patient_id}]}.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.import_patients(p_clinic uuid, p_filename text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_max constant integer := 500;
  v_actor uuid := private.current_profile_id();
  v_file text := left(btrim(coalesce(p_filename, '')), 200);
  v_batch uuid := gen_random_uuid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb; v_line integer; v_name text; v_email text; v_phone text; v_pkey text; v_birth date; v_sex text; v_goal text;
  v_height numeric; v_weight numeric; v_force boolean; v_reason text; v_pid uuid;
  v_results jsonb := '[]'::jsonb; v_imported integer := 0; v_dups integer := 0; v_errs integer := 0; v_total integer;
  v_seen_email text[] := '{}'; v_seen_phone text[] := '{}'; v_seen_nb text[] := '{}';
  v_nb text;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_clinic is null then raise exception 'clinic_id required' using errcode = '22023'; end if;
  if not private.clinic_is_operational(p_clinic) then
    raise exception 'forbidden: clinic not operational' using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  if not private.is_clinic_admin(p_clinic) then
    raise exception 'forbidden: PATIENT_IMPORT_ADMIN_REQUIRED' using errcode = '42501', hint = 'PATIENT_IMPORT_ADMIN_REQUIRED';
  end if;
  if v_file = '' then raise exception 'filename required' using errcode = '22023', hint = 'PATIENT_IMPORT_FILE_REQUIRED'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then raise exception 'no rows' using errcode = '22023', hint = 'PATIENT_IMPORT_EMPTY'; end if;
  if v_total > c_max then
    raise exception 'too many rows (max %)', c_max using errcode = '22023', hint = 'PATIENT_IMPORT_TOO_MANY';
  end if;

  -- Uma importação por vez na clínica: a rechecagem de duplicado e o insert não correm contra outra importação.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vertexa:patient-import:' || p_clinic::text, 0));

  insert into public.patient_import_batches (id, clinic_id, actor_profile_id, source_filename, total_rows, imported_count, duplicate_count, error_count)
  values (v_batch, p_clinic, v_actor, v_file, v_total, 0, 0, 0);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := coalesce((r ->> 'line')::integer, 0);
    v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
    v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
    v_phone := nullif(btrim(coalesce(r ->> 'phone', '')), '');
    v_pkey := private.import_phone_key(v_phone);
    v_sex := nullif(btrim(coalesce(r ->> 'sex', '')), '');
    v_goal := nullif(btrim(coalesce(r ->> 'goal', '')), '');
    v_force := coalesce((r ->> 'force')::boolean, false);
    v_reason := null; v_birth := null; v_height := null; v_weight := null;
    begin
      v_birth := nullif(r ->> 'birth_date', '')::date;
      v_height := nullif(r ->> 'height_cm', '')::numeric;
      v_weight := nullif(r ->> 'weight_kg', '')::numeric;
    exception when others then v_reason := 'dado_invalido';
    end;
    -- validação (o navegador já mostrou os erros; o servidor não confia nele)
    if v_reason is null then
      if v_name is null or char_length(v_name) > 200 then v_reason := 'nome';
      elsif v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v_reason := 'email';
      elsif v_phone is not null and v_pkey is null then v_reason := 'telefone';
      elsif v_birth is not null and (v_birth > v_today or v_birth < date '1900-01-01') then v_reason := 'nascimento';
      elsif v_sex is not null and v_sex not in ('feminino', 'masculino', 'outro') then v_reason := 'sexo';
      elsif v_height is not null and (v_height < 50 or v_height > 260) then v_reason := 'altura';
      elsif v_weight is not null and (v_weight < 20 or v_weight > 700) then v_reason := 'peso';
      end if;
    end if;
    if v_reason is not null then
      v_errs := v_errs + 1;
      v_results := v_results || jsonb_build_object('line', v_line, 'status', 'erro', 'reason', v_reason);
      continue;
    end if;

    -- duplicado: repetido no próprio lote (o primeiro vale) ou já na clínica
    v_nb := case when v_birth is not null then lower(v_name) || '|' || v_birth::text end;
    v_reason := null;
    if v_email is not null and v_email = any (v_seen_email) then v_reason := 'email';
    else
      -- e-mail: serializa a decisão de identidade (mesma chave do create_patient) antes de olhar a base
      perform private.identity_email_lock(v_email);
      v_reason := private.import_dup_reason(p_clinic, v_email, null, v_name, null);
    end if;
    if v_reason is null and v_pkey is not null and (v_pkey = any (v_seen_phone)
        or private.import_dup_reason(p_clinic, null, v_pkey, v_name, null) = 'telefone') then v_reason := 'telefone'; end if;
    if v_reason is null and v_nb is not null and (v_nb = any (v_seen_nb)
        or private.import_dup_reason(p_clinic, null, null, v_name, v_birth) = 'nome_nascimento') then v_reason := 'nome_nascimento'; end if;
    if v_reason is not null and not (v_force and v_reason in ('telefone', 'nome_nascimento')) then
      v_dups := v_dups + 1;
      v_results := v_results || jsonb_build_object('line', v_line, 'status', 'duplicado', 'reason', v_reason);
      continue;
    end if;

    -- mesma porta do cadastro manual: profiles + patients + vínculo do chamador (create_patient exige admin; erro desfaz o lote)
    v_pid := public.create_patient(
      p_clinic, v_name, v_email, v_birth, v_sex, v_height, v_goal, v_weight, null,
      null, null, null, null, v_today);
    insert into public.patient_import_origin (patient_id, clinic_id, batch_id, source_filename, phone, phone_key)
    values (v_pid, p_clinic, v_batch, v_file, v_phone, v_pkey);

    if v_email is not null then v_seen_email := v_seen_email || v_email; end if;
    if v_pkey is not null then v_seen_phone := v_seen_phone || v_pkey; end if;
    if v_nb is not null then v_seen_nb := v_seen_nb || v_nb; end if;
    v_imported := v_imported + 1;
    v_results := v_results || jsonb_build_object('line', v_line, 'status', 'importado', 'patient_id', v_pid);
  end loop;

  update public.patient_import_batches
     set imported_count = v_imported, duplicate_count = v_dups, error_count = v_errs
   where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'imported', v_imported, 'duplicates', v_dups, 'errors', v_errs, 'results', v_results);
end $$;
revoke all on function public.import_patients(uuid, text, jsonb) from public, anon;
grant execute on function public.import_patients(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. RPC: exportar (auditoria + linhas na mesma transação)
-- p_fields: subconjunto de cadastro | contato | medidas | adesao. Prontuário nunca entra.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.export_patients(p_clinic uuid, p_fields text[], p_reason_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_max constant integer := 20000;
  v_actor uuid := private.current_profile_id();
  v_fields text[];
  v_reason text := btrim(coalesce(p_reason, ''));
  v_rows jsonb; v_count integer; v_id uuid; v_name text;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_clinic is null then raise exception 'clinic_id required' using errcode = '22023'; end if;
  if not private.patient_export_allowed(p_clinic) then
    raise exception 'forbidden: PATIENT_EXPORT_MANAGER_REQUIRED' using errcode = '42501', hint = 'PATIENT_EXPORT_MANAGER_REQUIRED';
  end if;
  select coalesce(array_agg(distinct f order by f), '{}') into v_fields from unnest(coalesce(p_fields, '{}')) f;
  if cardinality(v_fields) = 0 or exists (select 1 from unnest(v_fields) f where f not in ('cadastro', 'contato', 'medidas', 'adesao')) then
    raise exception 'invalid fields' using errcode = '22023', hint = 'PATIENT_EXPORT_FIELDS_INVALID';
  end if;
  if p_reason_kind is null or p_reason_kind not in ('backup', 'migracao', 'auditoria', 'pedido_titular', 'outro') then
    raise exception 'reason kind required' using errcode = '22023', hint = 'PATIENT_EXPORT_REASON_REQUIRED';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'reason text required' using errcode = '22023', hint = 'PATIENT_EXPORT_REASON_REQUIRED';
  end if;

  select count(*) into v_count
    from public.patients pt join public.profiles pr on pr.id = pt.profile_id
   where pt.clinic_id = p_clinic and coalesce(pr.status, '') <> 'inactive';
  if v_count > c_max then raise exception 'too many patients' using errcode = '54000', hint = 'PATIENT_EXPORT_TOO_LARGE'; end if;

  select coalesce(jsonb_agg(x.o order by x.sort_name), '[]'::jsonb) into v_rows from (
    select lower(pr.full_name) as sort_name,
      jsonb_build_object('nome', pr.full_name)
      || case when 'cadastro' = any (v_fields) then jsonb_build_object(
           'nascimento', pt.birth_date, 'sexo', pt.sex, 'objetivo', pt.goal, 'inicio', pt.start_date, 'origem', o.source_filename) else '{}'::jsonb end
      || case when 'contato' = any (v_fields) then jsonb_build_object('email', pr.email, 'telefone', o.phone) else '{}'::jsonb end
      || case when 'medidas' = any (v_fields) then jsonb_build_object(
           'altura_cm', pt.height_cm, 'peso_inicial', pt.start_weight, 'meta_peso', pt.target_weight,
           'peso_atual', coalesce(w.weight_kg, pt.current_weight),
           'ultima_medida', case when w.measured_at is not null then (w.measured_at at time zone 'America/Sao_Paulo')::date end) else '{}'::jsonb end
      || case when 'adesao' = any (v_fields) then jsonb_build_object(
           'status', s.status::text, 'pontuacao', s.score, 'adesao_semanal', s.weekly_completion_rate) else '{}'::jsonb end as o
      from public.patients pt
      join public.profiles pr on pr.id = pt.profile_id
      left join public.patient_import_origin o on o.patient_id = pt.id
      left join lateral (select wl.weight_kg, wl.measured_at from public.weight_logs wl where wl.patient_id = pt.id
                          order by wl.measured_at desc limit 1) w on 'medidas' = any (v_fields)
      left join lateral (select a.status, a.score, a.weekly_completion_rate from public.adherence_snapshots a where a.patient_id = pt.id
                          order by a.calculated_at desc limit 1) s on 'adesao' = any (v_fields)
     where pt.clinic_id = p_clinic and coalesce(pr.status, '') <> 'inactive'
  ) x;

  select full_name into v_name from public.profiles where id = v_actor;
  -- Auditoria e linhas saem juntas: se este insert falhar, nada é devolvido.
  insert into public.patient_exports (clinic_id, actor_profile_id, actor_name, reason_kind, reason_text, fields, row_count)
  values (p_clinic, v_actor, v_name, p_reason_kind, v_reason, v_fields, v_count)
  returning id into v_id;

  return jsonb_build_object('export_id', v_id, 'row_count', v_count, 'fields', to_jsonb(v_fields), 'rows', v_rows);
end $$;
revoke all on function public.export_patients(uuid, text[], text, text) from public, anon;
grant execute on function public.export_patients(uuid, text[], text, text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261120100000', '20261120100000_redesign_p4_importar_exportar_pacientes.sql',
        'Redesign P4: import_patients (atômico, reaproveita create_patient, duplicado rechecado no servidor), patient_import_origin/batches, patient_import_dedupe_keys, export_patients (auditoria + linhas na mesma transação, só admin/Gestor) e patient_exports imutável. Só objetos novos.',
        'REDESIGN-P4')
on conflict (version) do nothing;
