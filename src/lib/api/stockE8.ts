// Estoque · Entrega 8 (inventário cego, transferências entre unidades, alertas e relatórios). Leitura e escrita SÓ por RPC (fin_can no servidor é a barreira real).
import { supabase } from "@/lib/supabase";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------- transferências ----------
export type TransferStatus = "in_transit" | "received" | "canceled";
export interface TransferLine {
  line_id: string; item_id: string; item_name: string; stock_unit: string; lot_code: string; expiry_date: string | null; qty_sent: number; qty_received: number | null;
  unit_cost_cents: number; total_cost_cents: number; received_cost_cents: number | null; loss_qty: number | null; loss_cents: number | null; receive_reason: string | null;
  dest_lot_code: string | null; dest_expiry_date: string | null;
}
export interface TransferRow {
  id: string; number: number; status: TransferStatus; from_unit_id: string; from_unit_name: string; to_unit_id: string; to_unit_name: string; sent_at: string; sent_by_name: string | null;
  received_at: string | null; received_by_name: string | null; canceled_at: string | null; cancel_reason: string | null; notes: string | null; receive_note: string | null; age_days: number; stale: boolean;
  can_receive: boolean; can_cancel: boolean; lines_count: number; sent_cents: number; received_cents: number; loss_cents: number; lines: TransferLine[];
}
export interface TransferFilter { unitId?: string | null; status?: string; from?: string; to?: string }
export async function listTransfers(clinicId: string, f: TransferFilter): Promise<TransferRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_stock_transfers", { p_clinic: clinicId, p_unit: f.unitId || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null, p_limit: 100, p_offset: 0 });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as TransferRow), lines_count: n(r.lines_count), sent_cents: n(r.sent_cents), received_cents: n(r.received_cents), loss_cents: n(r.loss_cents), age_days: n(r.age_days),
    lines: ((r.lines as Record<string, unknown>[]) ?? []).map((l) => ({
      ...(l as unknown as TransferLine), qty_sent: n(l.qty_sent), qty_received: nn(l.qty_received), unit_cost_cents: n(l.unit_cost_cents), total_cost_cents: n(l.total_cost_cents),
      received_cost_cents: nn(l.received_cost_cents), loss_qty: nn(l.loss_qty), loss_cents: nn(l.loss_cents),
    })),
  }));
}
export interface TransferSendLine { itemId: string; quantity: number; lotId?: string | null }
export const sendTransfer = (clinicId: string, fromUnit: string, toUnit: string, lines: TransferSendLine[], notes: string) =>
  rpc<string>("fin_stock_transfer_send", { p_clinic: clinicId, p_from: fromUnit, p_to: toUnit, p_lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, lot_id: l.lotId || null })), p_notes: notes.trim() || null });
export interface TransferReceiveLine { lineId: string; quantity: number; lotCode?: string; expiryDate?: string | null; reason?: string }
export const receiveTransfer = (transferId: string, lines: TransferReceiveLine[], note: string) =>
  rpc<{ transfer_id: string; lines: number; received_cents: number; loss_cents: number }>("fin_stock_transfer_receive", {
    p_transfer: transferId, p_note: note.trim() || null,
    p_lines: lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity, lot_code: l.lotCode || null, expiry_date: l.expiryDate || null, reason: l.reason?.trim() || null })),
  });
export const cancelTransfer = (transferId: string, reason: string) => rpc<void>("fin_stock_transfer_cancel", { p_transfer: transferId, p_reason: reason });

// ---------- inventário ----------
export type InventoryStatus = "counting" | "review" | "approved" | "canceled";
export interface InventoryRow {
  id: string; number: number; name: string | null; unit_id: string; unit_name: string; scope: "all" | "category" | "type"; scope_value: string | null; blind: boolean; status: InventoryStatus;
  notes: string | null; frozen_at: string; finished_at: string | null; approved_at: string | null; approve_note: string | null; canceled_at: string | null; cancel_reason: string | null;
  created_by_name: string | null; approved_by_name: string | null; lines_total: number; lines_counted: number; can_review: boolean; can_count: boolean;
  lines_with_difference: number | null; increase_cents: number | null; decrease_cents: number | null;
}
export interface InventoryFilter { unitId?: string | null; status?: string }
export async function listInventories(clinicId: string, f: InventoryFilter): Promise<InventoryRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_inventory_list", { p_clinic: clinicId, p_unit: f.unitId || null, p_status: f.status || null, p_inventory: null, p_limit: 50, p_offset: 0 });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as InventoryRow), lines_total: n(r.lines_total), lines_counted: n(r.lines_counted), lines_with_difference: nn(r.lines_with_difference), increase_cents: nn(r.increase_cents), decrease_cents: nn(r.decrease_cents),
  }));
}
export interface InventoryLine {
  id: string; item_id: string; item_name: string; category: string; stock_unit: string; fractional: boolean; ean: string | null; lot_id: string | null; lot_code: string; expiry_date: string | null;
  is_extra: boolean; counted_qty: number | null; counted_at: string | null; counted_by_name: string | null;
  /** NULOS para quem conta e durante a contagem cega (o servidor é quem decide). */
  expected_qty: number | null; moved_qty: number | null; diff_qty: number | null; avg_cost_cents: number | null; diff_value_cents: number | null; adjust_movement_id: string | null;
}
export async function listInventoryLines(inventoryId: string): Promise<InventoryLine[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_inventory_lines", { p_inventory: inventoryId });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as InventoryLine), counted_qty: nn(r.counted_qty), expected_qty: nn(r.expected_qty), moved_qty: nn(r.moved_qty), diff_qty: nn(r.diff_qty), avg_cost_cents: nn(r.avg_cost_cents), diff_value_cents: nn(r.diff_value_cents),
  }));
}
export interface InventoryOpenInput { name?: string; notes?: string; scope: "all" | "category" | "type"; scopeValue?: string; blind: boolean }
export const openInventory = (clinicId: string, unitId: string, d: InventoryOpenInput) =>
  rpc<string>("fin_inventory_open", { p_clinic: clinicId, p_unit: unitId, p_data: { name: d.name?.trim() || null, notes: d.notes?.trim() || null, scope: d.scope, scope_value: d.scopeValue || null, blind: d.blind } });
export interface CountInput { lineId?: string; itemId?: string; lotCode?: string; expiryDate?: string | null; countedQty: number | null }
export const countInventory = (inventoryId: string, lines: CountInput[]) =>
  rpc<number>("fin_inventory_count", { p_inventory: inventoryId, p_lines: lines.map((l) => ({ line_id: l.lineId, item_id: l.itemId, lot_code: l.lotCode, expiry_date: l.expiryDate, counted_qty: l.countedQty })) });
export const finishInventory = (inventoryId: string, zeroUncounted: boolean) => rpc<number>("fin_inventory_finish", { p_inventory: inventoryId, p_zero_uncounted: zeroUncounted });
export const reopenInventory = (inventoryId: string, reason: string) => rpc<void>("fin_inventory_reopen", { p_inventory: inventoryId, p_reason: reason });
export const cancelInventory = (inventoryId: string, reason: string) => rpc<void>("fin_inventory_cancel", { p_inventory: inventoryId, p_reason: reason });
export const approveInventory = (inventoryId: string, note: string) =>
  rpc<{ inventory_id: string; adjustments: number; increase_cents: number; decrease_cents: number; net_cents: number }>("fin_inventory_approve", { p_inventory: inventoryId, p_note: note.trim() || null });

// ---------- alertas ----------
export interface AlertSettings { expiry_days: number[]; idle_days: number; transfer_days: number }
export interface AlertCounts { below_min: number; expiring: number; expired: number; shortfalls: number; shortfalls_cents: number; stale_transfers: number; total: number }
export interface BelowMinAlert { item_id: string; item_name: string; unit_id: string; unit_name: string; stock_unit: string; qty_on_hand: number; min_qty: number; missing_qty: number }
export interface ExpiringAlert { lot_id: string; item_id: string; item_name: string; unit_id: string; unit_name: string; stock_unit: string; lot_code: string; expiry_date: string; days_left: number; window_days: number | null; qty: number; value_cents: number }
export interface ExpiredAlert { lot_id: string; item_id: string; item_name: string; unit_id: string; unit_name: string; stock_unit: string; lot_code: string; expiry_date: string; days_late: number; qty: number; value_cents: number }
export interface ShortfallAlert { id: string; item_name: string; unit_name: string; stock_unit: string; qty: number; est_cost_cents: number; occurred_on: string; appointment_id: string | null }
export interface StaleTransferAlert { id: string; number: number; from_unit_name: string; to_unit_name: string; sent_at: string; age_days: number; lines: number; sent_cents: number; can_receive: boolean }
export interface StockAlerts {
  settings: AlertSettings; counts: AlertCounts; below_min: BelowMinAlert[]; expiring: ExpiringAlert[]; expired: ExpiredAlert[]; shortfalls: ShortfallAlert[]; stale_transfers: StaleTransferAlert[];
}
export async function getStockAlerts(clinicId: string, unitId: string | null): Promise<StockAlerts> {
  const r = await rpc<Record<string, unknown>>("fin_stock_alerts", { p_clinic: clinicId, p_unit: unitId || null });
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const c = (r.counts ?? {}) as Record<string, unknown>;
  const counts: AlertCounts = { below_min: n(c.below_min), expiring: n(c.expiring), expired: n(c.expired), shortfalls: n(c.shortfalls), shortfalls_cents: n(c.shortfalls_cents), stale_transfers: n(c.stale_transfers), total: n(c.total) };
  return {
    settings: r.settings as AlertSettings, counts,
    below_min: arr<Record<string, unknown>>(r.below_min).map((x) => ({ ...(x as unknown as BelowMinAlert), qty_on_hand: n(x.qty_on_hand), min_qty: n(x.min_qty), missing_qty: n(x.missing_qty) })),
    expiring: arr<Record<string, unknown>>(r.expiring).map((x) => ({ ...(x as unknown as ExpiringAlert), qty: n(x.qty), value_cents: n(x.value_cents), days_left: n(x.days_left) })),
    expired: arr<Record<string, unknown>>(r.expired).map((x) => ({ ...(x as unknown as ExpiredAlert), qty: n(x.qty), value_cents: n(x.value_cents), days_late: n(x.days_late) })),
    shortfalls: arr<Record<string, unknown>>(r.shortfalls).map((x) => ({ ...(x as unknown as ShortfallAlert), qty: n(x.qty), est_cost_cents: n(x.est_cost_cents) })),
    stale_transfers: arr<Record<string, unknown>>(r.stale_transfers).map((x) => ({ ...(x as unknown as StaleTransferAlert), age_days: n(x.age_days), lines: n(x.lines), sent_cents: n(x.sent_cents) })),
  };
}
export const saveAlertSettings = (clinicId: string, s: AlertSettings, reason: string) =>
  rpc<AlertSettings>("fin_stock_alert_settings_save", { p_clinic: clinicId, p_data: { expiry_days: s.expiry_days, idle_days: s.idle_days, transfer_days: s.transfer_days }, p_reason: reason.trim() || null });

// ---------- relatórios ----------
export type ReportKey = "position" | "movements" | "consumption" | "losses" | "validity" | "idle" | "purchases";
export interface ReportResult { report: ReportKey; from: string; to: string; count: number; totals: Record<string, number>; rows: Record<string, unknown>[]; truncated: boolean }
export interface ReportFilter { unitId?: string | null; from?: string; to?: string; params?: Record<string, unknown> }
export async function getStockReport(clinicId: string, report: ReportKey, f: ReportFilter): Promise<ReportResult> {
  const r = await rpc<Record<string, unknown>>("fin_stock_report", { p_clinic: clinicId, p_report: report, p_unit: f.unitId || null, p_from: f.from || null, p_to: f.to || null, p_params: f.params ?? {}, p_limit: 2000, p_offset: 0 });
  const totals: Record<string, number> = {};
  for (const [k, v] of Object.entries((r.totals ?? {}) as Record<string, unknown>)) totals[k] = n(v);
  return { report, from: String(r.from), to: String(r.to), count: n(r.count), totals, rows: (r.rows as Record<string, unknown>[]) ?? [], truncated: r.truncated === true };
}
