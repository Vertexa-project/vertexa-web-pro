// Estoque · Entrega 3 (entradas, saídas, saldo, kardex). Leitura e escrita SÓ por RPC (a RLS e o fin_can são a barreira real).
import { supabase } from "@/lib/supabase";
import type { EntryLineInput } from "@/lib/domain/nfe";
import type { EntryType, ExitType, LossKind, MovementType } from "@/lib/domain/stockMoves";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------- saldo por unidade ----------
export interface BalanceLot { lot_id: string; lot_code: string; expiry_date: string | null; qty: number; open_qty: number; expired: boolean }
export interface BalanceRow {
  item_id: string; item_name: string; category: string; item_type: string; stock_unit: string; fractional: boolean; lot_control: boolean;
  unit_id: string; unit_name: string; qty_on_hand: number; avg_cost_cents: number; value_cents: number; min_qty: number | null; below_min: boolean;
  next_expiry: string | null; expired_qty: number; open_qty: number; lots: BalanceLot[];
}
export interface BalanceFilter { unitId?: string | null; search?: string; onlyPositive?: boolean }
export async function listBalances(clinicId: string, f: BalanceFilter): Promise<BalanceRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_stock_balances", { p_clinic: clinicId, p_unit: f.unitId || null, p_item: null, p_search: f.search?.trim() || null, p_only_positive: f.onlyPositive ?? false });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as BalanceRow),
    qty_on_hand: n(r.qty_on_hand), avg_cost_cents: n(r.avg_cost_cents), value_cents: n(r.value_cents), min_qty: nn(r.min_qty), expired_qty: n(r.expired_qty), open_qty: n(r.open_qty),
    lots: ((r.lots as Record<string, unknown>[]) ?? []).map((l) => ({ ...(l as unknown as BalanceLot), qty: n(l.qty), open_qty: n(l.open_qty) })),
  }));
}

// ---------- kardex / saídas / movimentações ----------
export interface MovementRow {
  id: string; occurred_on: string; created_at: string; unit_id: string; unit_name: string; item_id: string; item_name: string; stock_unit: string; movement_type: MovementType;
  qty: number; unit_cost_cents: number; total_cost_cents: number; balance_after: number; avg_cost_after_cents: number; lot_code: string; expiry_date: string | null;
  reason: string | null; purpose: string | null; loss_kind: LossKind | null; patient_name: string | null; user_name: string | null; supplier_name: string | null;
  invoice_number: string | null; entry_id: string | null; sale_id: string | null; reversed: boolean; reversal_of: string | null;
}
export interface MovementFilter { unitId?: string | null; itemId?: string | null; type?: string; direction?: "in" | "out" | ""; from?: string; to?: string; entryId?: string | null }
export async function listMovements(clinicId: string, f: MovementFilter): Promise<MovementRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_stock_movements", {
    p_clinic: clinicId, p_unit: f.unitId || null, p_item: f.itemId || null, p_type: f.type || null, p_direction: f.direction || null,
    p_from: f.from || null, p_to: f.to || null, p_entry: f.entryId || null, p_limit: 500, p_offset: 0,
  });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as MovementRow),
    qty: n(r.qty), unit_cost_cents: n(r.unit_cost_cents), total_cost_cents: n(r.total_cost_cents), balance_after: n(r.balance_after), avg_cost_after_cents: n(r.avg_cost_after_cents),
  }));
}

// ---------- documentos de entrada ----------
export interface EntryRow {
  id: string; created_at: string; received_on: string; unit_id: string; unit_name: string; entry_type: EntryType; supplier_name: string | null; invoice_number: string | null;
  invoice_key: string | null; lines_count: number; items_total_cents: number; freight_cents: number; total_cents: number; status: "active" | "reversed"; reverse_reason: string | null;
  user_name: string | null; notes: string | null;
}
export interface EntryFilter { unitId?: string | null; from?: string; to?: string }
export async function listEntries(clinicId: string, f: EntryFilter): Promise<EntryRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_stock_entries", { p_clinic: clinicId, p_unit: f.unitId || null, p_from: f.from || null, p_to: f.to || null, p_limit: 500, p_offset: 0 });
  return (rows ?? []).map((r) => ({ ...(r as unknown as EntryRow), lines_count: n(r.lines_count), items_total_cents: n(r.items_total_cents), freight_cents: n(r.freight_cents), total_cents: n(r.total_cents) }));
}

export interface EntryHeaderInput {
  entryType: EntryType; supplierId?: string | null; supplierNew?: { name: string; taxId: string } | null;
  invoiceNumber?: string; invoiceKey?: string; issueDate?: string; freightCents?: number; notes?: string;
}
export const createEntry = (clinicId: string, unitId: string, h: EntryHeaderInput, lines: EntryLineInput[]) =>
  rpc<string>("fin_stock_entry", {
    p_clinic: clinicId, p_unit: unitId,
    p_header: {
      entry_type: h.entryType, supplier_id: h.supplierId || null, supplier_new: h.supplierNew ? { name: h.supplierNew.name, tax_id: h.supplierNew.taxId } : null,
      invoice_number: h.invoiceNumber || null, invoice_key: h.invoiceKey || null, issue_date: h.issueDate || null, freight_cents: h.freightCents ?? 0, notes: h.notes || null,
    },
    p_lines: lines.map((l) => ({
      item_id: l.itemId, quantity: l.quantity, line_total_cents: l.lineTotalCents, lot_code: l.lotCode, expiry_date: l.expiryDate, supplier_code: l.supplierCode, conversion_factor: l.conversionFactor,
    })),
  });

/** Já existe entrada ativa com essa chave de NF-e? (aviso antes de confirmar; o servidor também recusa) */
export async function findActiveEntryByKey(clinicId: string, key: string): Promise<{ id: string; invoice_number: string | null; received_on: string } | null> {
  const { data, error } = await supabase.from("stock_entries").select("id, invoice_number, received_on").eq("clinic_id", clinicId).eq("invoice_key", key).eq("status", "active").maybeSingle();
  if (error) throw error;
  return (data as { id: string; invoice_number: string | null; received_on: string } | null) ?? null;
}

// ---------- fornecedores e de/para ----------
export interface Supplier { id: string; name: string; tax_id: string | null; is_active: boolean }
export async function listSuppliers(clinicId: string): Promise<Supplier[]> {
  const { data, error } = await supabase.from("stock_suppliers").select("id, name, tax_id, is_active").eq("clinic_id", clinicId).order("name");
  if (error) throw error;
  return (data ?? []) as Supplier[];
}
export async function listSupplierMaps(supplierId: string): Promise<{ supplierCode: string; itemId: string; conversionFactor: number }[]> {
  const { data, error } = await supabase.from("stock_supplier_item_map").select("supplier_code, item_id, conversion_factor").eq("supplier_id", supplierId);
  if (error) throw error;
  return ((data ?? []) as { supplier_code: string; item_id: string; conversion_factor: number | string }[]).map((m) => ({ supplierCode: m.supplier_code, itemId: m.item_id, conversionFactor: Number(m.conversion_factor) }));
}
export const saveSupplier = (clinicId: string, s: { id: string | null; name: string; taxId: string; isActive?: boolean; reason?: string }) =>
  rpc<string>("fin_stock_save_supplier", { p_clinic: clinicId, p_id: s.id, p_data: { name: s.name, tax_id: s.taxId, is_active: s.isActive ?? true }, p_reason: s.reason ?? null });

// ---------- saídas ----------
export interface LotsInfo {
  avg_cost_cents: number | null;
  lots: { lot_id: string; lot_code: string; expiry_date: string | null; qty: number; available: number; expired: boolean }[];
  open_units: { open_unit_id: string; lot_code: string; patient_id: string | null; patient_name: string | null; opened_on: string; expires_on: string | null; qty_remaining: number; expired: boolean }[];
}
export async function getLots(clinicId: string, unitId: string, itemId: string): Promise<LotsInfo> {
  const r = await rpc<LotsInfo>("fin_stock_lots", { p_clinic: clinicId, p_unit: unitId, p_item: itemId });
  return {
    avg_cost_cents: nn(r.avg_cost_cents),
    lots: (r.lots ?? []).map((l) => ({ ...l, qty: n(l.qty), available: n(l.available) })),
    open_units: (r.open_units ?? []).map((o) => ({ ...o, qty_remaining: n(o.qty_remaining) })),
  };
}
export const searchStockPatients = (clinicId: string, search: string) =>
  rpc<{ patient_id: string; full_name: string }[]>("fin_stock_patients", { p_clinic: clinicId, p_search: search || null, p_limit: 20 });

export interface ExitInput {
  unitId: string; itemId: string; type: ExitType; quantity: number; reason?: string; purpose?: string; lossKind?: LossKind | ""; patientId?: string;
  lotId?: string; openUnitId?: string; confirmExpired?: boolean;
}
export const registerExit = (clinicId: string, i: ExitInput) =>
  rpc<{ movement_ids: string[]; total_cost_cents: number; open_unit_id?: string }>("fin_stock_exit", {
    p_clinic: clinicId, p_unit: i.unitId, p_item: i.itemId, p_type: i.type, p_quantity: i.quantity,
    p_data: {
      reason: i.reason ?? null, purpose: i.purpose ?? null, loss_kind: i.lossKind || null, patient_id: i.patientId || null,
      lot_id: i.lotId || null, open_unit_id: i.openUnitId || null, confirm_expired: i.confirmExpired ?? false,
    },
  });

// ---------- estorno ----------
export const reverseMovement = (movementId: string, reason: string) => rpc<string>("fin_stock_reverse", { p_movement: movementId, p_reason: reason });
export const reverseEntry = (entryId: string, reason: string) => rpc<number>("fin_stock_reverse_entry", { p_entry: entryId, p_reason: reason });
