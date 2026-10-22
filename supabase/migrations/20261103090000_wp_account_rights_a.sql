-- =====================================================================================
-- WP-LGPD · A — Exportar e apagar conta (PDF do Ernâni, telas de Perfil; ordem aprovada item 4).
-- · my_data_export(): o paciente baixa TUDO que a plataforma guarda sobre ele (JSON). Só o próprio paciente.
-- · account_deletion_requests: pedido de exclusão (1 aberto por paciente). O pedido AVISA a clínica (aparece na Gestão);
--   a exclusão não é imediata e o paciente pode cancelar enquanto estiver aberta.
-- · execute_account_deletion(): só ADMIN da clínica. ANONIMIZA o cadastro (nome, e-mail, nascimento, sexo, objetivo,
--   avatar), apaga fotos, documentos e mídias, desativa o acesso e bloqueia o login. O HISTÓRICO CLÍNICO (peso,
--   refeições, treinos, sono) é PRESERVADO, já sem identificação. Os arquivos do Storage só saem pela API do Storage:
--   a função devolve os caminhos e o web os remove e confirma (account_files_removed).
-- Reversível: drop das 5 funções e da tabela; o que foi anonimizado não volta (é o ponto).
-- =====================================================================================
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  pending_files jsonb not null default '[]'::jsonb
);
create unique index if not exists account_deletion_one_open on public.account_deletion_requests (patient_id) where status = 'open';
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
drop policy if exists account_deletion_select on public.account_deletion_requests;
create policy account_deletion_select on public.account_deletion_requests for select to authenticated
  using (private.is_self_patient(patient_id) or private.is_clinic_admin(clinic_id));

create or replace function public.request_account_deletion()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; v_clinic uuid; v_id uuid;
begin
  select p.id, p.clinic_id into v_pat, v_clinic from public.patients p
   where p.profile_id = private.current_profile_id() limit 1;
  if v_pat is null then raise exception 'not a patient' using errcode = '42501'; end if;
  select id into v_id from public.account_deletion_requests where patient_id = v_pat and status = 'open';
  if v_id is not null then return v_id; end if;
  insert into public.account_deletion_requests (patient_id, clinic_id) values (v_pat, v_clinic) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_account_deletion()
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.account_deletion_requests r set status = 'cancelled', resolved_at = now()
   where r.status = 'open' and private.is_self_patient(r.patient_id);
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.my_data_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; v_out jsonb; t text;
  tabs text[] := array['weight_logs','meal_logs','activity_events','activity_sessions','sleep_logs','supplements','supplement_intakes',
    'body_assessments','nutrition_plans','workout_plans','workout_session_logs','rest_days','progress_photos','patient_achievements',
    'notifications','weekly_team_notes','media_consents','patient_documents'];
  rows jsonb;
begin
  select p.id into v_pat from public.patients p where p.profile_id = private.current_profile_id() limit 1;
  if v_pat is null then raise exception 'not a patient' using errcode = '42501'; end if;
  select jsonb_build_object(
      'exportado_em', now(),
      'perfil', (select to_jsonb(x) from (select pr.full_name, pr.email, pr.created_at from public.profiles pr where pr.id = private.current_profile_id()) x),
      'cadastro', (select to_jsonb(x) from (select birth_date, sex, height_cm, goal, start_date, start_weight, current_weight, target_weight from public.patients where id = v_pat) x))
    into v_out;
  foreach t in array tabs loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.patient_id = $1', t) into rows using v_pat;
    v_out := v_out || jsonb_build_object(t, rows);
  end loop;
  return v_out;
end $$;

create or replace function public.execute_account_deletion(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.account_deletion_requests; v_prof uuid; v_auth uuid; v_files jsonb; v_old_email text;
begin
  select * into r from public.account_deletion_requests where id = p_request for update;
  if r.id is null or not private.is_clinic_admin(r.clinic_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.status <> 'open' then raise exception 'request not open' using errcode = '22023'; end if;
  select pa.profile_id into v_prof from public.patients pa where pa.id = r.patient_id;
  select auth_user_id into v_auth from public.profiles where id = v_prof;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'path', pth)), '[]'::jsonb) into v_files from (
    select 'progress-photos' b, storage_path pth from public.progress_photos where patient_id = r.patient_id and storage_path is not null
    union all select 'patient-documents', file_path from public.patient_documents where patient_id = r.patient_id
    union all select 'profile-avatars', avatar_path from public.profiles where id = v_prof and avatar_path is not null) f;

  delete from public.progress_photos where patient_id = r.patient_id;
  delete from public.patient_documents where patient_id = r.patient_id;
  delete from public.media_pieces where patient_id = r.patient_id;
  delete from public.media_consents where patient_id = r.patient_id;
  delete from public.weekly_team_notes where patient_id = r.patient_id;

  update public.patients set birth_date = null, sex = null, goal = null where id = r.patient_id;
  update public.profiles set full_name = 'Paciente removido', email = null, avatar_url = null, avatar_path = null, status = 'inactive' where id = v_prof;
  if v_auth is not null then
    update auth.users set banned_until = 'infinity', email = 'removido+' || id::text || '@invalid.local', phone = null,
           raw_user_meta_data = '{}'::jsonb where id = v_auth;
  end if;
  update public.account_deletion_requests set status = 'done', resolved_at = now(), resolved_by = private.current_profile_id(), pending_files = v_files where id = r.id;
  return v_files;
end $$;

create or replace function public.account_files_removed(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.account_deletion_requests set pending_files = '[]'::jsonb
   where id = p_request and status = 'done' and private.is_clinic_admin(clinic_id);
end $$;

revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
revoke all on function public.my_data_export() from public, anon;
revoke all on function public.execute_account_deletion(uuid) from public, anon;
revoke all on function public.account_files_removed(uuid) from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.my_data_export() to authenticated;
grant execute on function public.execute_account_deletion(uuid) to authenticated;
grant execute on function public.account_files_removed(uuid) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261103090000','20261103090000_wp_account_rights_a.sql','LGPD-A: exportar dados (my_data_export) e pedido/execução de exclusão com anonimização.','LGPD-A');
