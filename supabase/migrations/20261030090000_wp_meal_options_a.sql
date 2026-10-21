-- =====================================================================================
-- WP-MEALOPT · A — Opções de refeição (PDF do Ernâni, tela 19: "Trocar sem sair do plano")
-- · meals.options: alternativas à refeição (a "Opção 1" é a própria refeição). Cada opção = {items text[], calories int}.
--   No máximo 5 alternativas. Gravadas pela mesma RPC save_nutrition_plan (atômica, só nutricionista).
-- · meal_logs.option_index: qual opção o paciente usou (2..6). NULL = a refeição original (opção 1).
-- Reversível: alter table meal_logs drop column option_index; alter table meals drop column options;
--   e recriar save_nutrition_plan sem o campo options (ver 20260712* original).
-- =====================================================================================
alter table public.meals
  add column if not exists options jsonb not null default '[]'::jsonb
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 5);
alter table public.meal_logs
  add column if not exists option_index smallint check (option_index between 2 and 6);

create or replace function public.save_nutrition_plan(p_patient_id uuid, p_title text, p_meals jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_plan_id uuid; v_prof uuid; m jsonb; i int := 0; v_opts jsonb;
begin
  if not private.can_write_discipline(p_patient_id, array['nutricionista']) then raise exception 'forbidden: requires nutricionista discipline' using errcode = '42501'; end if;
  if btrim(coalesce(p_title,'')) = '' then raise exception 'title required' using errcode = '22023'; end if;
  select pr.id into v_prof from public.professionals pr where pr.profile_id = private.current_profile_id() and pr.clinic_id = (select clinic_id from public.patients where id = p_patient_id) limit 1;
  delete from public.nutrition_plans where patient_id = p_patient_id;
  insert into public.nutrition_plans (patient_id, professional_id, title, status) values (p_patient_id, v_prof, btrim(p_title), 'active') returning id into v_plan_id;
  for m in select value from jsonb_array_elements(coalesce(p_meals,'[]'::jsonb)) loop
    i := i + 1;
    -- normaliza as opções: só as que têm itens; itens aparados; kcal inteiro ou nulo
    select coalesce(jsonb_agg(jsonb_build_object('items', o.items, 'calories', o.cal) order by o.ord), '[]'::jsonb) into v_opts
    from (
      select ord,
             (select coalesce(jsonb_agg(btrim(x)) filter (where btrim(x) <> ''), '[]'::jsonb) from jsonb_array_elements_text(coalesce(op->'items','[]'::jsonb)) x) as items,
             (op->>'calories')::int as cal
      from jsonb_array_elements(case when jsonb_typeof(m->'options') = 'array' then m->'options' else '[]'::jsonb end) with ordinality as t(op, ord)
    ) o
    where jsonb_array_length(o.items) > 0;
    insert into public.meals (nutrition_plan_id, time, name, items, calories, order_index, options)
    values (v_plan_id, m->>'time', m->>'name', coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(m->'items','[]'::jsonb)) x), '{}'), (m->>'calories')::int, i, v_opts);
  end loop;
  return v_plan_id;
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261030090000','20261030090000_wp_meal_options_a.sql','MEALOPT-A: meals.options (alternativas) + meal_logs.option_index; save_nutrition_plan grava as opções.','MEALOPT-A');
