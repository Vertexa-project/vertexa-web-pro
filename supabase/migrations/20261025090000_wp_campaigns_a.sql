-- =====================================================================================
-- WP-CAMP · A — campanhas: modelos automáticos + disparo manual, entregues na caixa de notificações do app.
-- · campaigns ganha title/days_threshold e gatilho validado (welcome|checkin|return|reactivation|birthday).
--   Os modelos nascem DESLIGADOS (public.ensure_clinic_campaigns, só admin): nada é enviado sem a clínica ligar.
-- · campaign_sends: livro-razão de envios (campaign, paciente, período) — impede repetir a mesma mensagem.
-- · private.run_campaigns(): lê as campanhas ATIVAS e grava em public.notifications. Diário via pg_cron (08:00 BRT).
-- · campaign_broadcasts + preview_broadcast/send_broadcast: disparo manual por staff. Audiência: 'mine' (pacientes
--   vinculados ao profissional), 'mine_inactive', 'all' e 'all_inactive' (estes dois só admin).
-- · Canal: notificação no app. Sem WhatsApp/e-mail/push nesta entrega.
-- =====================================================================================
alter table public.campaigns add column if not exists title text;
alter table public.campaigns add column if not exists days_threshold integer;
alter table public.campaigns drop constraint if exists campaigns_trigger_check;
alter table public.campaigns add constraint campaigns_trigger_check check (trigger is null or trigger in ('welcome','checkin','return','reactivation','birthday'));
alter table public.campaigns drop constraint if exists campaigns_title_len;
alter table public.campaigns add constraint campaigns_title_len check (title is null or char_length(title) between 1 and 80);
alter table public.campaigns drop constraint if exists campaigns_body_len;
alter table public.campaigns add constraint campaigns_body_len check (message_template is null or char_length(message_template) between 1 and 500);
alter table public.campaigns drop constraint if exists campaigns_days_range;
alter table public.campaigns add constraint campaigns_days_range check (days_threshold is null or days_threshold between 1 and 365);
create unique index if not exists campaigns_clinic_trigger_uq on public.campaigns (clinic_id, trigger) where trigger is not null;
-- Admin edita só o conteúdo e o liga/desliga (nunca clinic_id/trigger).
revoke update on public.campaigns from authenticated, anon;
grant update (name, title, message_template, is_active, days_threshold) on public.campaigns to authenticated;

create table if not exists public.campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  period_key text not null,
  sent_at timestamptz not null default now(),
  unique (campaign_id, patient_id, period_key)
);
create index if not exists campaign_sends_campaign_idx on public.campaign_sends (campaign_id, sent_at desc);
alter table public.campaign_sends enable row level security;
revoke all on public.campaign_sends from anon, authenticated;
grant select on public.campaign_sends to authenticated;
drop policy if exists campaign_sends_select on public.campaign_sends;
create policy campaign_sends_select on public.campaign_sends for select to authenticated using (
  exists (select 1 from public.campaigns c where c.id = campaign_id and private.is_clinic_staff(c.clinic_id)) );

create table if not exists public.campaign_broadcasts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id),
  audience text not null check (audience in ('mine','mine_inactive','all','all_inactive')),
  inactive_days integer check (inactive_days is null or inactive_days between 1 and 365),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 500),
  recipients integer not null check (recipients >= 0),
  created_at timestamptz not null default now()
);
create index if not exists campaign_broadcasts_clinic_idx on public.campaign_broadcasts (clinic_id, created_at desc);
alter table public.campaign_broadcasts enable row level security;
revoke all on public.campaign_broadcasts from anon, authenticated;
grant select on public.campaign_broadcasts to authenticated;
drop policy if exists campaign_broadcasts_select on public.campaign_broadcasts;
create policy campaign_broadcasts_select on public.campaign_broadcasts for select to authenticated using (
  private.is_clinic_admin(clinic_id) or (private.is_clinic_staff(clinic_id) and sender_profile_id = private.current_profile_id()) );

-- ── modelos padrão (desligados) ──────────────────────────────────────────────────────
create or replace function public.ensure_clinic_campaigns(p_clinic uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not private.is_clinic_admin(p_clinic) then
    raise exception 'forbidden: clinic admin only' using errcode = '42501';
  end if;
  insert into public.campaigns (clinic_id, name, trigger, title, message_template, days_threshold, is_active)
  values
    (p_clinic,'Boas-vindas','welcome','Bem-vindo(a), {nome}!','Que bom ter você por aqui. Seu plano já está no app: registre refeições, treinos e hidratação. Qualquer dúvida, fale com a gente.',null,false),
    (p_clinic,'Check-in periódico','checkin','Como você está, {nome}?','Já faz um tempo desde o último balanço. Registre seu peso e suas fotos de evolução para acompanharmos juntos.',15,false),
    (p_clinic,'Lembrete de retorno','return','Hora de agendar seu retorno','{nome}, está chegando o momento do seu retorno. Fale com a clínica para marcar sua próxima consulta.',30,false),
    (p_clinic,'Reativação de inativos','reactivation','Sentimos sua falta, {nome}','Faz alguns dias que você não registra nada. Que tal retomar hoje com um registro rápido?',7,false),
    (p_clinic,'Aniversário','birthday','Feliz aniversário, {nome}! 🎉','Desejamos um dia incrível e muita saúde. Conte com a gente.',null,false)
  on conflict (clinic_id, trigger) where trigger is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.ensure_clinic_campaigns(uuid) from public, anon;
grant execute on function public.ensure_clinic_campaigns(uuid) to authenticated;

-- ── texto personalizado ──────────────────────────────────────────────────────────────
create or replace function private.campaign_render(p_text text, p_full_name text) returns text
language sql immutable set search_path = '' as $$
  select replace(p_text, '{nome}', coalesce(nullif(split_part(btrim(coalesce(p_full_name,'')), ' ', 1), ''), 'você'))
$$;

-- última atividade do paciente (evento OU entrada no sistema), em dia BRT
create or replace function private.patient_last_activity_day(p_patient uuid) returns date
language sql stable set search_path = '' as $$
  select private.brt_date(greatest(
    coalesce((select max(e.created_at) from public.activity_events e where e.patient_id = p_patient), '-infinity'::timestamptz),
    (select pr.created_at from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = p_patient)))
$$;

-- ── motor automático ─────────────────────────────────────────────────────────────────
create or replace function private.run_campaigns(p_clinic uuid default null, p_today date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c record; r record; v_today date := coalesce(p_today, private.brt_date(now()));
  v_sent integer := 0; v_key text; v_ok boolean; v_n integer; v_age integer; v_idle integer; v_id uuid;
  v_type text;
begin
  for c in select * from public.campaigns
            where is_active and trigger is not null and clinic_id is not null
              and (p_clinic is null or clinic_id = p_clinic)
              and private.clinic_is_operational(clinic_id)
            order by created_at
  loop
    v_type := case c.trigger when 'welcome' then 'professional' when 'reactivation' then 'retention'
                             when 'birthday' then 'motivation' else 'reminder' end;
    for r in select pt.id as patient_id, pt.birth_date, pr.full_name, private.brt_date(pr.created_at) as join_day
               from public.patients pt join public.profiles pr on pr.id = pt.profile_id
              where pt.clinic_id = c.clinic_id and pr.status = 'active'
    loop
      v_ok := false; v_key := null;
      v_age := v_today - r.join_day;
      if c.trigger = 'welcome' then
        v_ok := v_age between 0 and 7; v_key := 'once';
      elsif c.trigger in ('checkin','return') then
        v_n := coalesce(c.days_threshold, case c.trigger when 'checkin' then 15 else 30 end);
        v_ok := v_age >= v_n and (v_age % v_n) <= 2; v_key := (v_age / v_n)::text;
      elsif c.trigger = 'reactivation' then
        v_n := coalesce(c.days_threshold, 7);
        v_idle := v_today - private.patient_last_activity_day(r.patient_id);
        v_ok := v_idle >= v_n; v_key := (v_today - v_idle)::text;
      elsif c.trigger = 'birthday' then
        v_ok := r.birth_date is not null
                and extract(month from r.birth_date) = extract(month from v_today)
                and extract(day from r.birth_date) = extract(day from v_today);
        v_key := extract(year from v_today)::text;
      end if;
      continue when not v_ok;
      insert into public.campaign_sends (campaign_id, patient_id, period_key) values (c.id, r.patient_id, v_key)
        on conflict do nothing returning id into v_id;
      continue when v_id is null;
      insert into public.notifications (patient_id, type, title, body)
        values (r.patient_id, v_type, private.campaign_render(coalesce(c.title, c.name), r.full_name),
                private.campaign_render(coalesce(c.message_template, ''), r.full_name));
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end $$;
revoke all on function private.run_campaigns(uuid, date) from public, anon, authenticated;

-- ── disparo manual ───────────────────────────────────────────────────────────────────
create or replace function private.broadcast_recipients(p_clinic uuid, p_audience text, p_days integer)
returns table (patient_id uuid, full_name text) language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.current_profile_id(); v_days integer := coalesce(p_days, 7);
begin
  if p_audience not in ('mine','mine_inactive','all','all_inactive') then
    raise exception 'invalid audience' using errcode = '22023';
  end if;
  if not private.is_clinic_staff(p_clinic) then
    raise exception 'forbidden: clinic staff only' using errcode = '42501';
  end if;
  if p_audience in ('all','all_inactive') and not private.is_clinic_admin(p_clinic) then
    raise exception 'forbidden: clinic admin only' using errcode = '42501';
  end if;
  return query
    select pt.id, pr.full_name
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic and pr.status = 'active'
       and (p_audience in ('all','all_inactive') or exists (
              select 1 from public.professional_patient_links l join public.professionals pf on pf.id = l.professional_id
               where l.patient_id = pt.id and l.status = 'active' and pf.clinic_id = p_clinic and pf.profile_id = v_me))
       and (p_audience in ('mine','all') or (private.brt_date(now()) - private.patient_last_activity_day(pt.id)) >= v_days);
end $$;
revoke all on function private.broadcast_recipients(uuid, text, integer) from public, anon, authenticated;

create or replace function public.preview_broadcast(p_clinic uuid, p_audience text, p_days integer default null)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from private.broadcast_recipients(p_clinic, p_audience, p_days)
$$;
revoke all on function public.preview_broadcast(uuid, text, integer) from public, anon;
grant execute on function public.preview_broadcast(uuid, text, integer) to authenticated;

create or replace function public.send_broadcast(p_clinic uuid, p_audience text, p_days integer, p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_title text := btrim(coalesce(p_title,'')); v_body text := btrim(coalesce(p_body,'')); v_n integer; v_id uuid; v_me uuid := private.current_profile_id();
begin
  if char_length(v_title) not between 1 and 80 then raise exception 'invalid title' using errcode = '22023'; end if;
  if char_length(v_body) not between 1 and 500 then raise exception 'invalid body' using errcode = '22023'; end if;
  insert into public.notifications (patient_id, type, title, body)
    select x.patient_id, 'professional', private.campaign_render(v_title, x.full_name), private.campaign_render(v_body, x.full_name)
      from private.broadcast_recipients(p_clinic, p_audience, p_days) x;
  get diagnostics v_n = row_count;
  insert into public.campaign_broadcasts (clinic_id, sender_profile_id, audience, inactive_days, title, body, recipients)
    values (p_clinic, v_me, p_audience, case when p_audience like '%inactive' then coalesce(p_days,7) end, v_title, v_body, v_n)
    returning id into v_id;
  return jsonb_build_object('broadcast_id', v_id, 'recipients', v_n);
end $$;
revoke all on function public.send_broadcast(uuid, text, integer, text, text) from public, anon;
grant execute on function public.send_broadcast(uuid, text, integer, text, text) to authenticated;

-- ── agenda diária (08:00 BRT = 11:00 UTC); idempotente pelo livro-razão ────────────────
do $$ begin
  if exists (select 1 from cron.job where jobname = 'wp-campaigns-daily') then perform cron.unschedule('wp-campaigns-daily'); end if;
  perform cron.schedule('wp-campaigns-daily', '0 11 * * *', 'select private.run_campaigns();');
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261025090000','20261025090000_wp_campaigns_a.sql',
  'CAMP-A: modelos automáticos (desligados por padrão) + disparo manual via notificação no app; livro-razão campaign_sends; cron diário.','CAMP-A');
