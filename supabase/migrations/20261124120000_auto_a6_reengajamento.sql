-- =====================================================================================
-- AUTO A6 — Reengajamento do paciente sumido (Versão 1). Amplia a "Reativação" (WP-CAMP A) com uma SEQUÊNCIA de 3 mensagens.
--
-- Regra: o paciente fica N dias sem interagir → mensagem 1 (padrão dia 5), 2 (dia 8), 3 (dia 12). PARA quando ele interage
-- (registra algo, escreve na conversa, manda peso/foto) e só recomeça num NOVO sumiço.
--   · "Interação" = o mesmo sinal do "N dias sem interação" do cálculo de adesão (activity_events) + mensagem do PACIENTE
--     na conversa + peso + foto de progresso (+ data de entrada, para quem nunca registrou). Mensagem da equipe e o
--     próprio aviso do reengajamento NÃO contam.
--   · Ciclo = a data da última interação ("âncora"). Nova interação muda a âncora → a sequência antiga para e a nova começa
--     do zero num próximo sumiço. Livro-razão reengagement_sends: UNIQUE (paciente, âncora, etapa) = nunca repete a etapa.
--   · No máximo UMA etapa por paciente por dia (rodar o cron 2x no mesmo dia não duplica; clínica que liga com paciente
--     sumido há 30 dias recebe 1 mensagem por dia, não as 3 de uma vez).
--   · Entrega: notificação no app (type 'retention', como a Reativação) + mensagem da EQUIPE na conversa (chat_messages,
--     sender_role 'professional', sem autor pessoal) para o paciente poder responder; a clínica pode desligar a conversa.
--   · Nasce DESLIGADO por clínica. Textos e dias editáveis (só admin, RPC save_reengagement_settings).
--   · Cron diário 'wp-reengagement-daily' (08:05 BRT) e RPC admin run_reengagement_now(clinic, data) para simular o aceite.
-- Só objetos novos. Reversão: drop das funções/tabelas abaixo e cron.unschedule('wp-reengagement-daily').
-- =====================================================================================

create table if not exists public.reengagement_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  is_active boolean not null default false,
  send_chat boolean not null default true,
  day_1 integer not null default 5, day_2 integer not null default 8, day_3 integer not null default 12,
  title_1 text not null default 'Oi, {nome}, tudo bem?',
  body_1 text not null default 'Percebi que faz uns dias que a gente não se fala. Está tudo certo e sem nenhuma dúvida, ou o plano está difícil de seguir? Me conta por aqui, sem pressão: estou aqui para ajustar o que for preciso.',
  title_2 text not null default 'Passando para saber de você',
  body_2 text not null default '{nome}, voltei para saber como você está. Às vezes a rotina aperta e o plano fica para depois, acontece com todo mundo. Se quiser, responda por aqui e a gente encontra juntos um jeito que caiba na sua semana.',
  title_3 text not null default 'Sua equipe continua aqui',
  body_3 text not null default '{nome}, quero que você saiba que não está sozinho(a) nesse processo. Quando puder, me responda por aqui ou registre algo no app, mesmo que seja pouco. A gente retoma de onde você parou, no seu ritmo.',
  updated_at timestamptz not null default now(),
  constraint reeng_days_order check (day_1 >= 1 and day_1 < day_2 and day_2 < day_3 and day_3 <= 365),
  constraint reeng_titles_len check (char_length(title_1) between 1 and 80 and char_length(title_2) between 1 and 80 and char_length(title_3) between 1 and 80),
  constraint reeng_bodies_len check (char_length(body_1) between 1 and 500 and char_length(body_2) between 1 and 500 and char_length(body_3) between 1 and 500)
);
alter table public.reengagement_settings enable row level security;
revoke all on public.reengagement_settings from anon, authenticated;
grant select on public.reengagement_settings to authenticated;
drop policy if exists reengagement_settings_select on public.reengagement_settings;
create policy reengagement_settings_select on public.reengagement_settings for select to authenticated using (private.is_clinic_staff(clinic_id));

create table if not exists public.reengagement_sends (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  step smallint not null check (step between 1 and 3),
  anchor_day date not null,              -- data (BRT) da última interação que abriu este ciclo de sumiço
  sent_on date not null,                 -- dia (BRT) do envio; na simulação, a data simulada
  sent_at timestamptz not null default now(),
  simulated boolean not null default false,
  title text not null, body text not null,
  notification_id uuid, chat_message_id uuid,
  unique (patient_id, anchor_day, step)
);
create index if not exists reengagement_sends_patient_idx on public.reengagement_sends (patient_id, sent_at desc);
create index if not exists reengagement_sends_clinic_idx on public.reengagement_sends (clinic_id, sent_at desc);
alter table public.reengagement_sends enable row level security;
revoke all on public.reengagement_sends from anon, authenticated;
grant select on public.reengagement_sends to authenticated;
drop policy if exists reengagement_sends_select on public.reengagement_sends;
create policy reengagement_sends_select on public.reengagement_sends for select to authenticated
  using (private.is_clinic_staff(clinic_id) and private.can_access_patient(patient_id));

-- ── última interação (mesmo sinal do "dias sem interação" + conversa) ───────────────────────────
create or replace function private.patient_last_interaction_at(p_patient uuid) returns timestamptz
language sql stable set search_path = '' as $$
  select greatest(
    coalesce((select max(e.created_at) from public.activity_events e where e.patient_id = p_patient), '-infinity'::timestamptz),
    coalesce((select max(m.created_at) from public.chat_messages m join public.chat_channels c on c.id = m.channel_id
               where c.patient_id = p_patient and m.sender_role = 'patient'::public.user_role), '-infinity'::timestamptz),
    coalesce((select max(w.measured_at) from public.weight_logs w where w.patient_id = p_patient), '-infinity'::timestamptz),
    coalesce((select max(ph.taken_at) from public.progress_photos ph where ph.patient_id = p_patient), '-infinity'::timestamptz),
    coalesce((select pr.created_at from public.patients pt join public.profiles pr on pr.id = pt.profile_id where pt.id = p_patient), '-infinity'::timestamptz))
$$;
revoke all on function private.patient_last_interaction_at(uuid) from public, anon, authenticated;

-- ── texto personalizado (mesma regra de {nome} da campanha) ─────────────────────────────────────
-- private.campaign_render já existe (WP-CAMP A).

-- ── entrega de UMA etapa (notificação + conversa); devolve se enviou ───────────────────────────
create or replace function private.reengagement_deliver(p_s public.reengagement_settings, p_patient uuid, p_name text,
  p_step integer, p_anchor date, p_today date, p_sim boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text; v_body text; v_notif uuid; v_chan uuid; v_msg uuid; v_prof uuid;
begin
  v_title := private.campaign_render(case p_step when 1 then p_s.title_1 when 2 then p_s.title_2 else p_s.title_3 end, p_name);
  v_body  := private.campaign_render(case p_step when 1 then p_s.body_1  when 2 then p_s.body_2  else p_s.body_3  end, p_name);
  insert into public.reengagement_sends (clinic_id, patient_id, step, anchor_day, sent_on, simulated, title, body)
    values (p_s.clinic_id, p_patient, p_step, p_anchor, p_today, p_sim, v_title, v_body)
    on conflict (patient_id, anchor_day, step) do nothing returning id into v_id;
  if v_id is null then return false; end if;
  insert into public.notifications (patient_id, type, title, body) values (p_patient, 'retention', v_title, v_body) returning id into v_notif;
  if p_s.send_chat then
    insert into public.chat_channels (patient_id) values (p_patient) on conflict (patient_id) do nothing;
    select cc.id into v_chan from public.chat_channels cc where cc.patient_id = p_patient;
    select pt.profile_id into v_prof from public.patients pt where pt.id = p_patient;
    if v_prof is not null then
      insert into public.chat_participants (channel_id, profile_id, role) values (v_chan, v_prof, 'patient'::public.user_role)
        on conflict (channel_id, profile_id) do nothing;
    end if;
    insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
      values (v_chan, null, 'professional'::public.user_role, v_body) returning id into v_msg;
  end if;
  update public.reengagement_sends set notification_id = v_notif, chat_message_id = v_msg where id = v_id;
  return true;
end $$;
revoke all on function private.reengagement_deliver(public.reengagement_settings, uuid, text, integer, date, date, boolean) from public, anon, authenticated;

-- ── motor ────────────────────────────────────────────────────────────────────────────────────────
create or replace function private.run_reengagement(p_clinic uuid default null, p_today date default null, p_sim boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.reengagement_settings; r record; v_today date := coalesce(p_today, private.brt_date(now()));
  v_sent integer := 0; v_anchor date; v_idle integer; v_last_step integer; v_last_on date; v_next integer; v_need integer;
begin
  for s in select * from public.reengagement_settings
            where is_active and (p_clinic is null or clinic_id = p_clinic) and private.clinic_is_operational(clinic_id)
            order by clinic_id
  loop
    for r in select pt.id as patient_id, pr.full_name
               from public.patients pt join public.profiles pr on pr.id = pt.profile_id
              where pt.clinic_id = s.clinic_id and pr.status = 'active'
    loop
      v_anchor := private.brt_date(private.patient_last_interaction_at(r.patient_id));
      v_idle := v_today - v_anchor;
      continue when v_idle < s.day_1;
      select x.step, x.sent_on into v_last_step, v_last_on from public.reengagement_sends x
       where x.patient_id = r.patient_id and x.anchor_day = v_anchor order by x.step desc limit 1;
      v_next := coalesce(v_last_step, 0) + 1;
      continue when v_next > 3;
      v_need := case v_next when 1 then s.day_1 when 2 then s.day_2 else s.day_3 end;
      continue when v_idle < v_need;
      continue when v_last_on is not null and v_last_on >= v_today;   -- no máximo uma etapa por dia
      if private.reengagement_deliver(s, r.patient_id, r.full_name, v_next, v_anchor, v_today, p_sim) then v_sent := v_sent + 1; end if;
    end loop;
  end loop;
  return v_sent;
end $$;
revoke all on function private.run_reengagement(uuid, date, boolean) from public, anon, authenticated;

-- ── RPCs (web) ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.save_reengagement_settings(p_clinic uuid, p_active boolean, p_send_chat boolean,
  p_days integer[], p_titles text[], p_bodies text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  if coalesce(array_length(p_days,1),0) <> 3 or coalesce(array_length(p_titles,1),0) <> 3 or coalesce(array_length(p_bodies,1),0) <> 3 then
    raise exception 'invalid sequence' using errcode = '22023';
  end if;
  insert into public.reengagement_settings (clinic_id, is_active, send_chat, day_1, day_2, day_3, title_1, body_1, title_2, body_2, title_3, body_3)
  values (p_clinic, coalesce(p_active,false), coalesce(p_send_chat,true), p_days[1], p_days[2], p_days[3],
          btrim(p_titles[1]), btrim(p_bodies[1]), btrim(p_titles[2]), btrim(p_bodies[2]), btrim(p_titles[3]), btrim(p_bodies[3]))
  on conflict (clinic_id) do update set is_active = excluded.is_active, send_chat = excluded.send_chat,
    day_1 = excluded.day_1, day_2 = excluded.day_2, day_3 = excluded.day_3,
    title_1 = excluded.title_1, body_1 = excluded.body_1, title_2 = excluded.title_2, body_2 = excluded.body_2,
    title_3 = excluded.title_3, body_3 = excluded.body_3, updated_at = now();
exception when check_violation then
  raise exception 'invalid sequence values' using errcode = '22023';
end $$;
revoke all on function public.save_reengagement_settings(uuid, boolean, boolean, integer[], text[], text[]) from public, anon;
grant execute on function public.save_reengagement_settings(uuid, boolean, boolean, integer[], text[], text[]) to authenticated;

-- "Rodar agora": admin da clínica. p_today nulo = hoje (igual ao cron, idempotente). p_today futuro (até +90 dias) =
-- simulação para o aceite: grava o envio como simulated=true, com a data simulada.
create or replace function public.run_reengagement_now(p_clinic uuid, p_today date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_real date := private.brt_date(now()); v_day date := coalesce(p_today, private.brt_date(now())); v_n integer;
begin
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  if v_day < v_real or v_day > v_real + 90 then raise exception 'date out of range' using errcode = '22023'; end if;
  v_n := private.run_reengagement(p_clinic, v_day, v_day <> v_real);
  return jsonb_build_object('sent', v_n, 'day', v_day, 'simulated', v_day <> v_real);
end $$;
revoke all on function public.run_reengagement_now(uuid, date) from public, anon;
grant execute on function public.run_reengagement_now(uuid, date) to authenticated;

-- Limpa SÓ envios simulados de um paciente (e a notificação/mensagem que eles geraram). Dado real nunca é tocado.
create or replace function public.clear_simulated_reengagement(p_clinic uuid, p_patient uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not private.is_clinic_admin(p_clinic) then raise exception 'forbidden: clinic admin only' using errcode = '42501'; end if;
  delete from public.notifications where id in (select notification_id from public.reengagement_sends where clinic_id = p_clinic and patient_id = p_patient and simulated and notification_id is not null);
  delete from public.chat_messages where id in (select chat_message_id from public.reengagement_sends where clinic_id = p_clinic and patient_id = p_patient and simulated and chat_message_id is not null);
  delete from public.reengagement_sends where clinic_id = p_clinic and patient_id = p_patient and simulated;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.clear_simulated_reengagement(uuid, uuid) from public, anon;
grant execute on function public.clear_simulated_reengagement(uuid, uuid) to authenticated;

-- Situação por paciente (só quem o chamador acessa): em andamento / concluída / respondeu (voltou a interagir).
create or replace function public.reengagement_overview(p_clinic uuid)
returns table (patient_id uuid, full_name text, last_interaction_day date, idle_days integer, steps_sent integer, last_step integer,
               last_sent_on date, state text)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.brt_date(now()); v_d1 integer;
begin
  if not private.is_clinic_staff(p_clinic) then raise exception 'forbidden: clinic staff only' using errcode = '42501'; end if;
  select coalesce((select day_1 from public.reengagement_settings where clinic_id = p_clinic), 5) into v_d1;
  return query
  with base as (
    select pt.id as pid, pr.full_name as fname, private.brt_date(private.patient_last_interaction_at(pt.id)) as anchor
      from public.patients pt join public.profiles pr on pr.id = pt.profile_id
     where pt.clinic_id = p_clinic and pr.status = 'active'
  ), calc as (
    select b.*, (v_today - b.anchor) as idle,
           (select count(*) from public.reengagement_sends x where x.patient_id = b.pid and x.anchor_day = b.anchor)::integer as cur_steps,
           (select max(x.step) from public.reengagement_sends x where x.patient_id = b.pid)::integer as any_step,
           (select x.step from public.reengagement_sends x where x.patient_id = b.pid order by x.anchor_day desc, x.step desc limit 1)::integer as lst,
           (select x.sent_on from public.reengagement_sends x where x.patient_id = b.pid order by x.anchor_day desc, x.step desc limit 1) as lst_on
      from base b where private.can_access_patient(b.pid)
  )
  select c.pid, c.fname, c.anchor, c.idle, c.cur_steps, c.lst, c.lst_on,
         case when c.cur_steps >= 3 then 'concluida'
              when c.cur_steps >= 1 then 'em_andamento'
              when c.any_step is not null then 'respondeu'
              else 'aguardando' end
    from calc c
   where c.any_step is not null or c.idle >= v_d1
   order by (c.cur_steps >= 1) desc, c.lst_on desc nulls last, c.fname
   limit 300;
end $$;
revoke all on function public.reengagement_overview(uuid) from public, anon;
grant execute on function public.reengagement_overview(uuid) to authenticated;

-- Linha da ficha: "Reengajamento: mensagem 2 de 3 enviada em dd/mm" (ou "parou: paciente voltou a interagir").
create or replace function public.patient_reengagement_line(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_anchor date; v_cur integer; v_last record; v_clinic uuid;
begin
  v_clinic := private.patient_clinic(p_patient);
  if not (private.is_clinic_staff(v_clinic) and private.can_access_patient(p_patient)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select x.step, x.sent_on, x.anchor_day into v_last from public.reengagement_sends x
   where x.patient_id = p_patient order by x.anchor_day desc, x.step desc limit 1;
  if v_last.step is null then return null; end if;
  v_anchor := private.brt_date(private.patient_last_interaction_at(p_patient));
  return jsonb_build_object('step', v_last.step, 'sent_on', v_last.sent_on,
    'state', case when v_last.anchor_day = v_anchor then (case when v_last.step >= 3 then 'concluida' else 'em_andamento' end) else 'respondeu' end);
end $$;
revoke all on function public.patient_reengagement_line(uuid) from public, anon;
grant execute on function public.patient_reengagement_line(uuid) to authenticated;

-- ── agenda diária (08:05 BRT = 11:05 UTC); idempotente pelo livro-razão ────────────────────────
do $$ begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'wp-reengagement-daily') then perform cron.unschedule('wp-reengagement-daily'); end if;
    perform cron.schedule('wp-reengagement-daily', '5 11 * * *', 'select private.run_reengagement();');
  end if;
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261124120000','20261124120000_auto_a6_reengajamento.sql',
  'A6: reengajamento do paciente sumido — 3 mensagens (dia 5/8/12 sem interação), para ao interagir; desligado por padrão; cron diário; RPC de simulação.','AUTO-A6')
on conflict do nothing;
