-- WP-EFFORT · A — testes (ROLLBACK). Assume 20261028090000 aplicada/concatenada.
begin;
do $$
declare
  fails text := ''; n int; pid uuid := gen_random_uuid(); tid uuid := gen_random_uuid(); clid uuid := gen_random_uuid(); owner uuid := gen_random_uuid();
begin
  select count(*) into n from public.activity_event_types where type='workout_effort' and counts_as_adherence = false and counts_as_interaction = false;
  if n <> 1 then fails := fails || 'catalogo(got '||n||') '; end if;
  -- o tipo precisa ser aceito pela FK de activity_events
  insert into public.profiles (id, auth_user_id, role, full_name, status, created_at) values (owner, gen_random_uuid(), 'admin', 'Adm', 'active', now()), (pid, gen_random_uuid(), 'patient', 'Pac', 'active', now());
  insert into public.clinics (id, name, owner_profile_id) values (clid, 'C', owner);
  insert into public.patients (id, profile_id, clinic_id) values (tid, pid, clid);
  begin
    insert into public.activity_events (patient_id, type, payload) values (tid, 'workout_effort', '{"effort":7}'::jsonb);
  exception when others then fails := fails || 'fk_recusou('||sqlerrm||') ';
  end;
  -- esforço sozinho NÃO conta como atividade/adesão: o último dia de atividade continua vazio
  select count(*) into n from public.activity_events e join public.activity_event_types t on t.type = e.type
   where e.patient_id = tid and (t.counts_as_adherence or t.counts_as_interaction);
  if n <> 0 then fails := fails || 'conta_como_atividade(got '||n||') '; end if;
  if fails <> '' then raise exception 'WP-EFFORT-A FAILS: %', fails; end if;
  raise notice 'WP-EFFORT-A: OK';
end $$;
rollback;
