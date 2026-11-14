-- E6 (achado D38): responder a contestação já atualiza o extrato, que volta ao aceite do profissional (antes ficava «Contestado» até clicar Atualizar extrato).
create or replace function public.fin_closing_answer(p_dispute uuid, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.fin_closing_disputes; cp public.fin_closing_pros; c public.fin_closings; v_rs text := btrim(coalesce(p_response, ''));
begin
  select * into d from public.fin_closing_disputes where id = p_dispute;
  if d.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into c from public.fin_closings where id = (select x.closing_id from public.fin_closing_pros x where x.id = d.closing_pro_id) for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into cp from public.fin_closing_pros where id = d.closing_pro_id;
  perform private.fin_gate(cp.clinic_id, 'close_decide', null, true);
  if c.status = 'travado' then raise exception 'PERIOD_LOCKED: mês travado' using errcode = '42501'; end if;
  select * into d from public.fin_closing_disputes where id = p_dispute;
  if d.status <> 'open' then raise exception 'ALREADY_ANSWERED' using errcode = '22023'; end if;
  if char_length(v_rs) < 3 or char_length(v_rs) > 500 then raise exception 'RESPONSE_REQUIRED' using errcode = '22023'; end if;
  update public.fin_closing_disputes set status = 'answered', response = v_rs, answered_by = private.current_profile_id(), answered_at = now() where id = d.id;
  perform private.fin_log(cp.clinic_id, null, 'closing_dispute', d.id, 'update', jsonb_build_object('status', 'open'), jsonb_build_object('status', 'answered', 'response', v_rs, 'period', c.period), 'Resposta à contestação');
  perform private.close_refresh_cp(cp.id);
end $$;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261115120000','20261115120000_fin_e6_answer_refresh.sql','FIN-E6: responder contestação atualiza o extrato e devolve ao aceite (achado D38).','FIN-E6');
