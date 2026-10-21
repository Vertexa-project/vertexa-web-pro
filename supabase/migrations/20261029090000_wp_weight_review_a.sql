-- =====================================================================================
-- WP-WREV · A — Revisão de peso suspeito pela equipe (PDF do Ernâni, tela 03)
-- · weight_logs.review_status: ok (padrão) | pending (paciente confirmou variação >2 kg/dia) | approved | rejected.
-- · O paciente só pode gravar 'ok' ou 'pending'; aprovar/recusar é só da equipe (RPC review_weight_log).
-- · Aprovar emite o marcador weight_logged (que o app não emite no caso suspeito) para o VRI.
-- Reversível: drop function public.review_weight_log; alter table public.weight_logs drop column review_status, drop column reviewed_at;
--   e recriar a policy weight_logs_insert_self sem a checagem de review_status.
-- =====================================================================================
alter table public.weight_logs
  add column if not exists review_status text not null default 'ok' check (review_status in ('ok','pending','approved','rejected')),
  add column if not exists reviewed_at timestamptz;
create index if not exists weight_logs_pending_idx on public.weight_logs (patient_id) where review_status = 'pending';

drop policy if exists weight_logs_insert_self on public.weight_logs;
create policy weight_logs_insert_self on public.weight_logs for insert to authenticated
  with check (private.is_self_patient(patient_id) and private.clinic_is_operational(private.patient_clinic(patient_id))
              and review_status in ('ok','pending'));

create or replace function public.review_weight_log(p_id uuid, p_decision text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.weight_logs;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode = '22023'; end if;
  select * into w from public.weight_logs where id = p_id;
  if not found or not private.can_access_patient(w.patient_id) or private.is_self_patient(w.patient_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if w.review_status <> 'pending' then return w.id; end if;
  update public.weight_logs set review_status = p_decision, reviewed_at = now() where id = w.id;
  if p_decision = 'approved' then
    insert into public.activity_events (patient_id, type, payload)
    values (w.patient_id, 'weight_logged', jsonb_build_object('source','review','weight_log_id', w.id::text));
  end if;
  return w.id;
end $$;
revoke all on function public.review_weight_log(uuid, text) from public, anon;
grant execute on function public.review_weight_log(uuid, text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261029090000','20261029090000_wp_weight_review_a.sql','WREV-A: revisão de peso suspeito (review_status + review_weight_log).','WREV-A');
