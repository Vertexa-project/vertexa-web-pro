-- Stub MÍNIMO para a prova SQL da parte 6 do redesign num Postgres LOCAL descartável. NÃO vai para produção.
-- Reproduz só o que a migration P6 usa (helpers e tabelas do banco real, simplificados) + a save_workout_plan REAL copiada da migration de disciplinas.
alter table public.schema_migration_log add constraint schema_migration_log_version_key unique (version);
create table public.professional_patient_links (id uuid primary key default gen_random_uuid(), professional_id uuid references public.professionals(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade, is_external boolean default false, status text default 'active');
create table public.disciplines (code text primary key);
insert into public.disciplines values ('medico'),('nutricionista'),('fisioterapeuta'),('educador_fisico');
create table public.professional_disciplines (professional_id uuid not null references public.professionals(id) on delete cascade,
  discipline text not null references public.disciplines(code), primary key (professional_id, discipline));
create function private.brt_date(p_ts timestamptz) returns date language sql immutable as $$ select (p_ts at time zone 'America/Sao_Paulo')::date $$;
create function private.patient_clinic(p_patient uuid) returns uuid language sql stable security definer set search_path = '' as $$ select clinic_id from public.patients where id = p_patient $$;
create function private.is_self_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.patients pt where pt.id = p_patient and pt.profile_id = private.current_profile_id()) $$;
create function private.is_common_professional_of_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.professional_patient_links l join public.professionals pr on pr.id = l.professional_id
    where l.patient_id = p_patient and coalesce(l.status,'active') = 'active' and coalesce(l.is_external,false) = false and pr.profile_id = private.current_profile_id()) $$;
create function private.can_access_patient_internal(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_self_patient(p_patient) or private.is_common_professional_of_patient(p_patient) or private.is_clinic_admin(private.patient_clinic(p_patient)) $$;
create function private.can_prescribe_for_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_common_professional_of_patient(p_patient) or private.is_clinic_admin(private.patient_clinic(p_patient)) $$;
create function private.can_write_discipline(p_patient uuid, p_disciplines text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_prescribe_for_patient(p_patient) and exists (select 1 from public.professional_disciplines pd join public.professionals pr on pr.id = pd.professional_id
    where pr.profile_id = private.current_profile_id() and pr.clinic_id = private.patient_clinic(p_patient) and pd.discipline = any(p_disciplines)) $$;
grant execute on all functions in schema private to authenticated;

create table public.workout_plans (id uuid primary key default gen_random_uuid(), patient_id uuid references public.patients(id) on delete cascade,
  professional_id uuid references public.professionals(id), title text not null, goal text, created_at timestamptz default now());
create table public.workouts (id uuid primary key default gen_random_uuid(), workout_plan_id uuid references public.workout_plans(id) on delete cascade,
  letter text, name text not null, primary_muscle_group text, day_index int, estimated_minutes int);
create table public.workout_exercises (id uuid primary key default gen_random_uuid(), workout_id uuid references public.workouts(id) on delete cascade,
  name text not null, muscle_groups text[], sets int, reps int, load_kg numeric, rest_seconds int, gif_url text, notes text, order_index int);
create function private.workout_plan_patient(p uuid) returns uuid language sql stable security definer set search_path = '' as $$ select patient_id from public.workout_plans where id = p $$;
create function private.workout_patient(p uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select wp.patient_id from public.workouts w join public.workout_plans wp on wp.id = w.workout_plan_id where w.id = p $$;
grant execute on function private.workout_plan_patient(uuid), private.workout_patient(uuid) to authenticated;
alter table public.workout_plans enable row level security; alter table public.workouts enable row level security; alter table public.workout_exercises enable row level security;
create policy workout_plans_select on public.workout_plans for select to authenticated using (private.can_access_patient_internal(patient_id));
create policy workouts_select on public.workouts for select to authenticated using (private.can_access_patient_internal(private.workout_plan_patient(workout_plan_id)));
create policy workout_exercises_select on public.workout_exercises for select to authenticated using (private.can_access_patient_internal(private.workout_patient(workout_id)));
grant select on public.workout_plans, public.workouts, public.workout_exercises to authenticated;
grant update (professional_id, title, goal) on public.workout_plans to authenticated;  -- como o banco real: is_draft/published_* NÃO são atualizáveis direto

create table public.patient_documents (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade,
  uploaded_by_role text not null check (uploaded_by_role in ('professional','patient')), uploaded_by_professional_id uuid references public.professionals(id) on delete set null,
  kind text not null default 'exam', title text, file_path text not null, mime_type text, file_size_bytes bigint, uploaded_at timestamptz not null default now());
alter table public.patient_documents enable row level security;
create policy patient_documents_select on public.patient_documents for select to authenticated using (private.can_access_patient_internal(patient_id));
create policy patient_documents_write_insert on public.patient_documents for insert to authenticated with check (private.can_prescribe_for_patient(patient_id));
grant select, insert on public.patient_documents to authenticated;
create table public.notifications (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null, title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());

create or replace function public.save_workout_plan(p_patient_id uuid, p_title text, p_goal text DEFAULT NULL::text, p_workouts jsonb DEFAULT '[]'::jsonb)
 returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_plan_id uuid; v_prof uuid; w jsonb; ex jsonb; v_workout_id uuid; i int := 0; j int;
begin
  if not private.can_write_discipline(p_patient_id, array['educador_fisico','fisioterapeuta']) then raise exception 'forbidden: requires educador_fisico or fisioterapeuta discipline' using errcode = '42501'; end if;
  if btrim(coalesce(p_title,'')) = '' then raise exception 'title required' using errcode = '22023'; end if;
  select pr.id into v_prof from public.professionals pr where pr.profile_id = private.current_profile_id() and pr.clinic_id = (select clinic_id from public.patients where id = p_patient_id) limit 1;
  delete from public.workout_plans where patient_id = p_patient_id;
  insert into public.workout_plans (patient_id, professional_id, title, goal) values (p_patient_id, v_prof, btrim(p_title), nullif(btrim(coalesce(p_goal,'')),'')) returning id into v_plan_id;
  for w in select value from jsonb_array_elements(coalesce(p_workouts,'[]'::jsonb)) loop
    i := i + 1;
    insert into public.workouts (workout_plan_id, letter, name, primary_muscle_group, day_index, estimated_minutes)
    values (v_plan_id, w->>'letter', w->>'name', w->>'primary_muscle_group', i, (w->>'estimated_minutes')::int) returning id into v_workout_id;
    j := 0;
    for ex in select value from jsonb_array_elements(coalesce(w->'exercises','[]'::jsonb)) loop
      j := j + 1;
      insert into public.workout_exercises (workout_id, name, muscle_groups, sets, reps, load_kg, order_index)
      values (v_workout_id, ex->>'name', coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(ex->'muscle_groups','[]'::jsonb)) x), '{}'), (ex->>'sets')::int, (ex->>'reps')::int, (ex->>'load_kg')::numeric, j);
    end loop;
  end loop;
  return v_plan_id;
end $function$;

-- Fixture (UUIDs fixos): clínica A (admin dono, educador, nutri, médico sem disciplina, recepção), clínica B; pacientes Mariana (A), Paulo (A), Zélia (B)
insert into public.profiles (id, auth_user_id, full_name, status) values
 ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'Admin A', 'active'), ('00000000-0000-0000-0000-0000000000a2', gen_random_uuid(), 'Edu A', 'active'),
 ('00000000-0000-0000-0000-0000000000a3', gen_random_uuid(), 'Nutri A', 'active'), ('00000000-0000-0000-0000-0000000000a4', gen_random_uuid(), 'Recepção A', 'active'),
 ('00000000-0000-0000-0000-0000000000a5', gen_random_uuid(), 'Médico A', 'active'), ('00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 'Admin B', 'active'),
 ('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'Mariana', 'active'), ('00000000-0000-0000-0000-0000000000c2', gen_random_uuid(), 'Paulo', 'active'),
 ('00000000-0000-0000-0000-0000000000c3', gen_random_uuid(), 'Zélia', 'active');
insert into public.clinics (id, name, owner_profile_id) values ('00000000-0000-0000-0000-00000000ca01', 'Clínica A', '00000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-00000000cb01', 'Clínica B', '00000000-0000-0000-0000-0000000000b1');
insert into public.professionals (id, profile_id, clinic_id) values
 ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000ca01'),
 ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000ca01'),
 ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000ca01'),
 ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000ca01');
insert into public.professional_disciplines values ('00000000-0000-0000-0000-0000000000e2', 'educador_fisico'), ('00000000-0000-0000-0000-0000000000e3', 'nutricionista');
insert into public.patients (id, profile_id, clinic_id) values
 ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000ca01'),
 ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000ca01'),
 ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000cb01');
insert into public.professional_patient_links (professional_id, patient_id) values
 ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2'),
 ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f2'),
 ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000f1');
-- PLANO LEGADO (existia antes da migration): Mariana já vê hoje
insert into public.workout_plans (id, patient_id, title) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'Plano legado');
insert into public.workouts (id, workout_plan_id, letter, name, day_index) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'A', 'Treino A', 1);
insert into public.workout_exercises (workout_id, name, sets, reps, order_index) values ('00000000-0000-0000-0000-0000000000d2', 'Agachamento', 3, 10, 1);
