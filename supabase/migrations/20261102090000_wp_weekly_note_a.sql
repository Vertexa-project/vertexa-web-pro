-- =====================================================================================
-- WP-WNOTE · A — Recado da equipe no Resumo da semana (PDF do Ernâni, tela 17; decisão de 21/10:
-- "recado automático por faixa de desempenho, que o profissional pode trocar por texto próprio").
-- · weekly_team_notes: 1 recado por paciente e semana (segunda). Leitura: quem acessa o paciente (inclui o próprio).
--   Escrita só pela RPC set_weekly_note, que é da EQUIPE (nunca do próprio paciente). Texto vazio apaga o recado
--   e o app volta ao automático.
-- Reversível: drop function public.set_weekly_note; drop table public.weekly_team_notes.
-- =====================================================================================
create table if not exists public.weekly_team_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  body text not null check (char_length(btrim(body)) between 1 and 300),
  author_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, week_start)
);
alter table public.weekly_team_notes enable row level security;
revoke all on public.weekly_team_notes from anon, authenticated;
grant select on public.weekly_team_notes to authenticated;
drop policy if exists weekly_team_notes_select on public.weekly_team_notes;
create policy weekly_team_notes_select on public.weekly_team_notes for select to authenticated using (private.can_access_patient(patient_id));

create or replace function public.set_weekly_note(p_patient uuid, p_week date, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_week date := date_trunc('week', p_week::timestamp)::date; v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  if p_patient is null or p_week is null then raise exception 'patient and week required' using errcode = '22023'; end if;
  if not private.can_access_patient(p_patient) or private.is_self_patient(p_patient) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_body = '' then
    delete from public.weekly_team_notes where patient_id = p_patient and week_start = v_week;
    return null;
  end if;
  if char_length(v_body) > 300 then raise exception 'note too long' using errcode = '22023'; end if;
  insert into public.weekly_team_notes (patient_id, week_start, body, author_profile_id)
  values (p_patient, v_week, v_body, private.current_profile_id())
  on conflict (patient_id, week_start) do update set body = excluded.body, author_profile_id = excluded.author_profile_id, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.set_weekly_note(uuid, date, text) from public, anon;
grant execute on function public.set_weekly_note(uuid, date, text) to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261102090000','20261102090000_wp_weekly_note_a.sql','WNOTE-A: recado da equipe no resumo semanal (weekly_team_notes + set_weekly_note).','WNOTE-A');
