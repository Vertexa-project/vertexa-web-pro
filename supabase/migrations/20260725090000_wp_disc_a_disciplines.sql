-- =====================================================================================
-- WP-DISC · A — DISCIPLINAS por profissional (1:N) + ESCRITA escopada por disciplina.
-- Fecha a DÍVIDA-RLS-3 (prescrição não escopada por disciplina). LEITURA integrada (DISC-2)
-- NÃO é alterada — nenhuma policy de SELECT é tocada.
--
-- DECISÕES DO DONO (lei):
--  · DISC-1 a área RESTRINGE a escrita; DISC-2 leitura integrada intacta; DISC-3 médico tem sua área.
--  · DISC-ADMIN-1: autoridade de admin é ADMINISTRATIVA — admin SEM disciplina clínica NÃO escreve
--    clínico (perde inclusive body_assessments, que hoje tinha — MUDANÇA DE COMPORTAMENTO intencional).
--  · Profissional↔disciplina é 1:N; autorização é UNIÃO (OU): pode escrever se possui QUALQUER uma das
--    disciplinas exigidas pela tabela. Acumular disciplinas SEMPRE amplia, nunca restringe.
--  · Atribuição de disciplina: SÓ admin da clínica (RPC dedicada), NUNCA o próprio profissional.
--  · Mantém professionals.type por compatibilidade (dívida anotada).
--
-- MAPA disciplina→escrita (final):
--   nutrition_plans, meals, supplements ........ nutricionista
--   workout_plans, workouts, workout_exercises . educador_fisico OU fisioterapeuta
--   body_assessments ........................... nutricionista OU educador_fisico OU fisioterapeuta OU medico
--   patient_documents .......................... NÃO escopado (segue can_prescribe_for_patient)
--   appointments ............................... NÃO escopado (administrativo; regra atual)
--   EXCEÇÃO: a anamnese (body_assessment) criada DENTRO de create_patient é administrativa e NÃO é
--            bloqueada — create_patient é SECURITY DEFINER e não passa pela policy (provado em teste).
--
-- ONDE O MAPA VIVE: em CÓDIGO (constante de disciplina por policy/RPC). Porta aberta p/ config por
-- clínica no futuro (bastaria trocar a constante por consulta a uma tabela clinic_discipline_scope,
-- sem mudar a forma das policies).
--
-- KILL SWITCH / ROLLBACK (fail-closed — reverte as policies de ESCRITA à versão anterior baseada em
-- can_prescribe_for_patient; NUNCA abre para anon; SELECT nunca foi tocado):
--   -- 6 tabelas: recriar *_write_insert/update/delete com can_prescribe_for_patient(<patient>):
--   --   nutrition_plans/supplements/workout_plans: can_prescribe_for_patient(patient_id)
--   --   meals: can_prescribe_for_patient(private.nutrition_plan_patient(nutrition_plan_id))
--   --   workouts: can_prescribe_for_patient(private.workout_plan_patient(workout_plan_id))
--   --   workout_exercises: can_prescribe_for_patient(private.workout_patient(workout_id))
--   -- body_assessments: insert/update = (is_common_professional_of_patient(patient_id) OR
--   --   is_clinic_admin(private.patient_clinic(patient_id))); delete (admin) = is_clinic_admin(private.patient_clinic(patient_id))
--   -- RPCs: repor o gate para `if not private.can_prescribe_for_patient(p_patient_id) then raise ...`
--   drop function if exists public.assign_professional_discipline(uuid, text);
--   drop function if exists public.revoke_professional_discipline(uuid, text);
--   drop function if exists private.can_write_discipline(uuid, text[]);
--   drop function if exists private.professional_clinic(uuid);
--   drop table if exists public.professional_disciplines;
--   drop table if exists public.disciplines;
-- =====================================================================================

-- ───────────────────────── 1) Lista canônica (dados, extensível) ─────────────────────────
create table if not exists public.disciplines (
  code        text primary key,
  label       text not null,
  is_clinical boolean not null default true
);
insert into public.disciplines (code, label, is_clinical) values
  ('medico',          'Médico',          true),
  ('nutricionista',   'Nutricionista',   true),
  ('fisioterapeuta',  'Fisioterapeuta',  true),
  ('educador_fisico', 'Educador Físico', true),
  ('psicologo',       'Psicólogo',       true),   -- na lista; sem mapeamento de escrita nas 6 por ora
  ('outro',           'Outro',           false)
on conflict (code) do nothing;

-- ───────────────────────── 2) professional_disciplines (1:N; sem limite) ─────────────────────────
create table if not exists public.professional_disciplines (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  discipline      text not null references public.disciplines(code),
  granted_by      uuid,                                   -- profile do admin que concedeu (null = backfill)
  created_at      timestamptz not null default now(),
  primary key (professional_id, discipline)               -- PK composta: N disciplinas por profissional
);

-- ───────────────────────── 3) Helpers ─────────────────────────
create or replace function private.professional_clinic(p_prof uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select pr.clinic_id from public.professionals pr where pr.id = p_prof
$$;
revoke all on function private.professional_clinic(uuid) from public, anon;
grant execute on function private.professional_clinic(uuid) to authenticated;

-- can_write_discipline: exige VÍNCULO (can_prescribe_for_patient) E posse de ALGUMA das disciplinas
-- exigidas (UNIÃO). Externo não passa (can_prescribe usa is_common). Admin sem disciplina não passa
-- (o exists falha). Sem caminho de auto-concessão (a atribuição é RPC admin-only).
create or replace function private.can_write_discipline(p_patient uuid, p_disciplines text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_prescribe_for_patient(p_patient)
     and exists (
       select 1
       from public.professional_disciplines pd
       join public.professionals pr on pr.id = pd.professional_id
       where pr.profile_id = private.current_profile_id()
         and pr.clinic_id  = private.patient_clinic(p_patient)
         and pd.discipline = any(p_disciplines)
     )
$$;
revoke all on function private.can_write_discipline(uuid, text[]) from public, anon;
grant execute on function private.can_write_discipline(uuid, text[]) to authenticated;

-- ───────────────────────── 4) RLS + grants nas 2 tabelas novas ─────────────────────────
alter table public.disciplines             enable row level security;
alter table public.professional_disciplines enable row level security;

revoke all on public.disciplines             from anon, authenticated;
revoke all on public.professional_disciplines from anon, authenticated;
grant select on public.disciplines             to authenticated;
grant select on public.professional_disciplines to authenticated;

-- disciplines: lookup canônico legível pelo app autenticado; sem escrita pelo client (seed/admin).
create policy disciplines_select on public.disciplines
  for select to authenticated using (true);

-- professional_disciplines: o próprio profissional OU staff/admin da clínica dele leem; sem escrita
-- pelo client (só via RPC admin-only, SECURITY DEFINER).
create policy professional_disciplines_select on public.professional_disciplines
  for select to authenticated
  using (private.owns_professional(professional_id)
         or private.is_clinic_staff(private.professional_clinic(professional_id)));

-- ───────────────────────── 5) Backfill idempotente (map(type)); 0 profissionais hoje ⇒ no-op ─────
insert into public.professional_disciplines (professional_id, discipline, granted_by)
select pr.id,
  case pr.type
    when 'doctor'          then 'medico'
    when 'nutritionist'    then 'nutricionista'
    when 'physiotherapist' then 'fisioterapeuta'
    when 'personal_trainer'then 'educador_fisico'
    when 'other'           then 'outro'
  end,
  null
from public.professionals pr
where pr.type is not null
on conflict (professional_id, discipline) do nothing;

-- ───────────────────────── 6) Atribuição/revogação (SÓ admin da clínica; nunca auto) ─────────────
create or replace function public.assign_professional_discipline(p_professional_id uuid, p_discipline text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid;
begin
  if private.current_profile_id() is null then
    raise exception 'assign_professional_discipline: not authenticated' using errcode = '42501';
  end if;
  select clinic_id into v_clinic from public.professionals where id = p_professional_id;
  if v_clinic is null then
    raise exception 'assign_professional_discipline: professional not found' using errcode = 'P0002';
  end if;
  -- SÓ admin da clínica do profissional-alvo (bloqueia não-admin e clínica alheia).
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'assign_professional_discipline: only clinic admin can assign' using errcode = '42501';
  end if;
  -- SEM auto-concessão (nem o admin se concede — sem caminho de auto-escalação).
  if exists (select 1 from public.professionals where id = p_professional_id and profile_id = private.current_profile_id()) then
    raise exception 'assign_professional_discipline: self-assignment is not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.disciplines where code = p_discipline) then
    raise exception 'assign_professional_discipline: unknown discipline %', p_discipline using errcode = '22023';
  end if;
  insert into public.professional_disciplines (professional_id, discipline, granted_by)
  values (p_professional_id, p_discipline, private.current_profile_id())
  on conflict (professional_id, discipline) do nothing;   -- concede INDIVIDUALMENTE; idempotente
end $$;

create or replace function public.revoke_professional_discipline(p_professional_id uuid, p_discipline text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid;
begin
  if private.current_profile_id() is null then
    raise exception 'revoke_professional_discipline: not authenticated' using errcode = '42501';
  end if;
  select clinic_id into v_clinic from public.professionals where id = p_professional_id;
  if v_clinic is null then
    raise exception 'revoke_professional_discipline: professional not found' using errcode = 'P0002';
  end if;
  if not private.is_clinic_admin(v_clinic) then
    raise exception 'revoke_professional_discipline: only clinic admin can revoke' using errcode = '42501';
  end if;
  delete from public.professional_disciplines
    where professional_id = p_professional_id and discipline = p_discipline;  -- revoga INDIVIDUALMENTE
end $$;

revoke all     on function public.assign_professional_discipline(uuid, text) from public, anon;
revoke all     on function public.revoke_professional_discipline(uuid, text) from public, anon;
grant  execute on function public.assign_professional_discipline(uuid, text) to authenticated;
grant  execute on function public.revoke_professional_discipline(uuid, text) to authenticated;

-- ───────────────────────── 7) Policies de ESCRITA escopadas por disciplina (SELECT intacto) ─────────
-- NUTRIÇÃO → nutricionista
drop policy if exists nutrition_plans_write_insert on public.nutrition_plans;
drop policy if exists nutrition_plans_write_update on public.nutrition_plans;
drop policy if exists nutrition_plans_write_delete on public.nutrition_plans;
create policy nutrition_plans_write_insert on public.nutrition_plans for insert to authenticated
  with check (private.can_write_discipline(patient_id, array['nutricionista']));
create policy nutrition_plans_write_update on public.nutrition_plans for update to authenticated
  using (private.can_write_discipline(patient_id, array['nutricionista']))
  with check (private.can_write_discipline(patient_id, array['nutricionista']));
create policy nutrition_plans_write_delete on public.nutrition_plans for delete to authenticated
  using (private.can_write_discipline(patient_id, array['nutricionista']));

drop policy if exists meals_write_insert on public.meals;
drop policy if exists meals_write_update on public.meals;
drop policy if exists meals_write_delete on public.meals;
create policy meals_write_insert on public.meals for insert to authenticated
  with check (private.can_write_discipline(private.nutrition_plan_patient(nutrition_plan_id), array['nutricionista']));
create policy meals_write_update on public.meals for update to authenticated
  using (private.can_write_discipline(private.nutrition_plan_patient(nutrition_plan_id), array['nutricionista']))
  with check (private.can_write_discipline(private.nutrition_plan_patient(nutrition_plan_id), array['nutricionista']));
create policy meals_write_delete on public.meals for delete to authenticated
  using (private.can_write_discipline(private.nutrition_plan_patient(nutrition_plan_id), array['nutricionista']));

drop policy if exists supplements_write_insert on public.supplements;
drop policy if exists supplements_write_update on public.supplements;
drop policy if exists supplements_write_delete on public.supplements;
create policy supplements_write_insert on public.supplements for insert to authenticated
  with check (private.can_write_discipline(patient_id, array['nutricionista']));
create policy supplements_write_update on public.supplements for update to authenticated
  using (private.can_write_discipline(patient_id, array['nutricionista']))
  with check (private.can_write_discipline(patient_id, array['nutricionista']));
create policy supplements_write_delete on public.supplements for delete to authenticated
  using (private.can_write_discipline(patient_id, array['nutricionista']));

-- TREINO → educador_fisico OU fisioterapeuta
drop policy if exists workout_plans_write_insert on public.workout_plans;
drop policy if exists workout_plans_write_update on public.workout_plans;
drop policy if exists workout_plans_write_delete on public.workout_plans;
create policy workout_plans_write_insert on public.workout_plans for insert to authenticated
  with check (private.can_write_discipline(patient_id, array['educador_fisico','fisioterapeuta']));
create policy workout_plans_write_update on public.workout_plans for update to authenticated
  using (private.can_write_discipline(patient_id, array['educador_fisico','fisioterapeuta']))
  with check (private.can_write_discipline(patient_id, array['educador_fisico','fisioterapeuta']));
create policy workout_plans_write_delete on public.workout_plans for delete to authenticated
  using (private.can_write_discipline(patient_id, array['educador_fisico','fisioterapeuta']));

drop policy if exists workouts_write_insert on public.workouts;
drop policy if exists workouts_write_update on public.workouts;
drop policy if exists workouts_write_delete on public.workouts;
create policy workouts_write_insert on public.workouts for insert to authenticated
  with check (private.can_write_discipline(private.workout_plan_patient(workout_plan_id), array['educador_fisico','fisioterapeuta']));
create policy workouts_write_update on public.workouts for update to authenticated
  using (private.can_write_discipline(private.workout_plan_patient(workout_plan_id), array['educador_fisico','fisioterapeuta']))
  with check (private.can_write_discipline(private.workout_plan_patient(workout_plan_id), array['educador_fisico','fisioterapeuta']));
create policy workouts_write_delete on public.workouts for delete to authenticated
  using (private.can_write_discipline(private.workout_plan_patient(workout_plan_id), array['educador_fisico','fisioterapeuta']));

drop policy if exists workout_exercises_write_insert on public.workout_exercises;
drop policy if exists workout_exercises_write_update on public.workout_exercises;
drop policy if exists workout_exercises_write_delete on public.workout_exercises;
create policy workout_exercises_write_insert on public.workout_exercises for insert to authenticated
  with check (private.can_write_discipline(private.workout_patient(workout_id), array['educador_fisico','fisioterapeuta']));
create policy workout_exercises_write_update on public.workout_exercises for update to authenticated
  using (private.can_write_discipline(private.workout_patient(workout_id), array['educador_fisico','fisioterapeuta']))
  with check (private.can_write_discipline(private.workout_patient(workout_id), array['educador_fisico','fisioterapeuta']));
create policy workout_exercises_write_delete on public.workout_exercises for delete to authenticated
  using (private.can_write_discipline(private.workout_patient(workout_id), array['educador_fisico','fisioterapeuta']));

-- AVALIAÇÃO → nutricionista OU educador_fisico OU fisioterapeuta OU medico (inclui DELETE:
-- admin sem disciplina PERDE — DISC-ADMIN-1). A anamnese via create_patient (SECDEF) não passa aqui.
drop policy if exists body_assessments_write_insert on public.body_assessments;
drop policy if exists body_assessments_write_update on public.body_assessments;
drop policy if exists body_assessments_admin_delete on public.body_assessments;
create policy body_assessments_write_insert on public.body_assessments for insert to authenticated
  with check (private.can_write_discipline(patient_id, array['nutricionista','educador_fisico','fisioterapeuta','medico']));
create policy body_assessments_write_update on public.body_assessments for update to authenticated
  using (private.can_write_discipline(patient_id, array['nutricionista','educador_fisico','fisioterapeuta','medico']))
  with check (private.can_write_discipline(patient_id, array['nutricionista','educador_fisico','fisioterapeuta','medico']));
create policy body_assessments_write_delete on public.body_assessments for delete to authenticated
  using (private.can_write_discipline(patient_id, array['nutricionista','educador_fisico','fisioterapeuta','medico']));

-- ───────────────────────── 8) RPCs SECDEF revalidam a disciplina (senão viram porta lateral) ─────
create or replace function public.save_nutrition_plan(p_patient_id uuid, p_title text, p_meals jsonb DEFAULT '[]'::jsonb)
 returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_plan_id uuid; v_prof uuid; m jsonb; i int := 0;
begin
  if not private.can_write_discipline(p_patient_id, array['nutricionista']) then raise exception 'forbidden: requires nutricionista discipline' using errcode = '42501'; end if;
  if btrim(coalesce(p_title,'')) = '' then raise exception 'title required' using errcode = '22023'; end if;
  select pr.id into v_prof from public.professionals pr where pr.profile_id = private.current_profile_id() and pr.clinic_id = (select clinic_id from public.patients where id = p_patient_id) limit 1;
  delete from public.nutrition_plans where patient_id = p_patient_id;
  insert into public.nutrition_plans (patient_id, professional_id, title, status) values (p_patient_id, v_prof, btrim(p_title), 'active') returning id into v_plan_id;
  for m in select value from jsonb_array_elements(coalesce(p_meals,'[]'::jsonb)) loop
    i := i + 1;
    insert into public.meals (nutrition_plan_id, time, name, items, calories, order_index)
    values (v_plan_id, m->>'time', m->>'name', coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(m->'items','[]'::jsonb)) x), '{}'), (m->>'calories')::int, i);
  end loop;
  return v_plan_id;
end $function$;

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

insert into public.schema_migration_log (version, filename, description, session)
values ('20260725090000','20260725090000_wp_disc_a_disciplines.sql',
  'WP-DISC A: disciplinas por profissional (1:N) + escrita escopada. disciplines + professional_disciplines '
  '(+ RLS SELECT, sem escrita pelo client), backfill map(type), helper private.can_write_discipline(uuid,text[]) '
  '(UNIAO de disciplinas), RPCs admin-only assign/revoke_professional_discipline (nunca auto). Policies de '
  'ESCRITA das 6 tabelas + body_assessments passam a exigir a disciplina (SELECT intacto, DISC-2). save_workout_plan/'
  'save_nutrition_plan revalidam disciplina. Fecha DIVIDA-RLS-3. professionals.type mantido (divida). '
  'MUDANCA: admin sem disciplina perde escrita de body_assessments (DISC-ADMIN-1).',
  'WP-DISC')
on conflict (version) do nothing;
