-- FIN-E8 (achado D45): estorno de saída devolve pelo custo médio vigente sem deslocar o CM. Só recria private.stock_reverse_one.
create or replace function private.stock_reverse_one(p_movement uuid, p_reason text, p_allow_sale boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements; r public.stock_movements; ou public.stock_open_units; l public.stock_lots; v_cur_avg numeric; v_recalc boolean;
begin
  select * into m from public.stock_movements where id = p_movement for update;
  if m.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if m.movement_type = 'reversal' then raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '22023'; end if;
  if m.movement_type = 'sale' and not p_allow_sale then raise exception 'SALE_MOVEMENT_USE_CANCEL' using errcode = '22023'; end if;
  if m.movement_type in ('transfer_out','transfer_in','inventory') and not p_allow_sale then raise exception 'DOC_MOVEMENT_USE_FLOW' using errcode = '22023'; end if;
  if exists (select 1 from public.stock_movements x where x.reversed_movement_id = m.id) then raise exception 'ALREADY_REVERSED' using errcode = '22023'; end if;
  select * into l from public.stock_lots where id = m.lot_id for update;
  if m.qty > 0 and l.qty_on_hand - private.stock_lot_open_qty(l.id) < m.qty then raise exception 'REVERSAL_NO_STOCK' using errcode = '22023'; end if;
  -- Devolver uma saída que saiu pelo custo médio que ainda vale não muda o custo médio (o total da saída é arredondado ao centavo e
  -- recalcular com ele deslocava o CM na 4ª casa: achado D45, 44,6432 → 44,6430 ao cancelar transferência).
  select b.avg_cost_cents into v_cur_avg from public.stock_balances b where b.item_id = m.item_id and b.unit_id = m.unit_id;
  v_recalc := not (m.qty < 0 and m.avg_cost_after_cents is not null and v_cur_avg = m.avg_cost_after_cents);
  r := private.stock_apply(m.clinic_id, m.unit_id, m.item_id, m.lot_id, m.open_unit_id, null, 'reversal', -m.qty, -m.total_cost_cents, v_recalc,
         jsonb_build_object('reason', p_reason, 'reversed_movement_id', m.id, 'patient_id', m.patient_id, 'sale_id', m.sale_id, 'transfer_id', m.transfer_id, 'inventory_id', m.inventory_id));
  if m.qty < 0 and m.open_unit_id is not null then
    select * into ou from public.stock_open_units where id = m.open_unit_id for update;
    update public.stock_open_units set qty_remaining = least(qty_remaining + abs(m.qty), 1),
        status = case when qty_remaining + abs(m.qty) >= 1 then 'closed' else 'open' end,
        closed_at = case when qty_remaining + abs(m.qty) >= 1 then now() else null end,
        close_reason = case when qty_remaining + abs(m.qty) >= 1 then 'reversed' else null end
      where id = ou.id;
  end if;
  return r.id;
end $$;
revoke all on function private.stock_reverse_one(uuid, text, boolean) from public, anon, authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261117120000','20261117120000_fin_e8_reverse_keep_avg.sql','FIN-E8: estorno de saída mantém o custo médio quando ele não mudou (achado D45).','FIN-E8');
