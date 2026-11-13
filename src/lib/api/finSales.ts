// Financeiro · Entrega 2: vendas, recebimentos, títulos e caixa diário. Leitura e escrita SÓ por RPC (a RLS é a barreira real).
import { supabase } from "@/lib/supabase";
import type { CardModality, PaymentKind, ReceivableStatus, SaleStatus } from "@/lib/domain/finSales";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---------- catálogo e opções ----------
export interface SaleCatalog {
  services: { id: string; name: string; category: string; price_cents: number }[];
  packages: { id: string; name: string; price_cents: number }[];
  products: { id: string; name: string; item_type: "resale" | "compounded"; price_cents: number }[];
  professionals: { id: string; name: string }[];
  can_edit_price: boolean;
}
export const getSaleCatalog = (clinicId: string, unitId: string) => rpc<SaleCatalog>("fin_sale_catalog", { p_clinic: clinicId, p_unit: unitId });

export interface PaymentOption {
  id: string; name: string; kind: PaymentKind;
  /** null quando o papel não lê taxas (Recepção). */
  flat_fee_pct: number | null; flat_fee_cents: number | null; settle_days: number | null;
  rows: { brand: string; modality: CardModality; fee_pct: number | null; settle_days: number | null; anticipation: boolean | null; anticipation_fee_pct: number | null; anticipation_days: number | null }[];
}
export const getPaymentOptions = (clinicId: string, unitId: string) => rpc<PaymentOption[]>("fin_payment_options", { p_clinic: clinicId, p_unit: unitId });

export const searchSalePatients = (clinicId: string, search: string) =>
  rpc<{ patient_id: string; full_name: string }[]>("fin_sale_patients", { p_clinic: clinicId, p_search: search || null, p_limit: 20 });

export const getComplianceStatus = (clinicId: string, unitId: string) =>
  rpc<{ license_ok: boolean; accepted: boolean; blocked: boolean }>("fin_compliance_status", { p_clinic: clinicId, p_unit: unitId });
export const acceptCompliance = (clinicId: string, unitId: string) => rpc<string>("fin_accept_compliance", { p_clinic: clinicId, p_unit: unitId, p_type: "compounded_no_license" });

// ---------- vendas ----------
export interface SaleRow {
  id: string; created_at: string; unit_id: string; unit_name: string; patient_id: string; patient_name: string | null; status: SaleStatus;
  total_gross_cents: number; discount_cents: number; total_net_cents: number; paid_cents: number; seller_id: string | null; seller_name: string | null;
  items_count: number; cancel_reason: string | null;
}
export interface SalesFilter { unitId?: string | null; status?: SaleStatus | ""; from?: string; to?: string }
export const listSales = (clinicId: string, f: SalesFilter) =>
  rpc<SaleRow[]>("fin_sales_list", { p_clinic: clinicId, p_unit: f.unitId || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null });

export interface SaleItemRow {
  id: string; position: number; item_type: "service" | "package" | "product" | "compounded"; description: string; quantity: number;
  list_price_cents: number; unit_price_cents: number; gross_cents: number; discount_item_cents: number; discount_share_cents: number; net_cents: number;
}
export interface PaymentRow {
  id: string; method: string; acquirer_name: string; brand: string | null; modality: CardModality | null; installments: number; amount_cents: number;
  paid_on: string; nsu: string | null; status: "active" | "reversed"; reverse_reason: string | null; cash_register_id: string | null;
}
export interface ReceivableRow {
  id: string; payment_id: string; installment_no: number; installments: number; gross_cents: number; fee_cents: number; net_cents: number;
  expected_date: string; settled_date: string | null; settled_net_cents: number | null; status: ReceivableStatus; reverse_reason: string | null;
}
export interface SaleDetail extends Omit<SaleRow, "items_count"> {
  clinic_id: string; notes: string | null; canceled_at: string | null; items: SaleItemRow[]; payments: PaymentRow[]; receivables: ReceivableRow[];
}
export const getSale = (saleId: string) => rpc<SaleDetail>("fin_sale_get", { p_sale: saleId });

export interface SaveSaleInput {
  unitId: string; patientId: string; sellerId: string | null; referrerId: string | null; notes?: string;
  items: { itemType: "service" | "package" | "product"; refId: string; quantity: number; unitPriceCents?: number; discountCents?: number | null; discountPct?: number | null }[];
  totalDiscountCents?: number; totalDiscountPct?: number | null;
}
export const saveSale = (clinicId: string, i: SaveSaleInput) =>
  rpc<string>("fin_save_sale", {
    p_clinic: clinicId, p_unit: i.unitId, p_patient: i.patientId, p_seller: i.sellerId, p_referrer: i.referrerId, p_notes: i.notes ?? null,
    p_total_discount_cents: i.totalDiscountCents ?? 0, p_total_discount_pct: i.totalDiscountPct ?? null,
    p_items: i.items.map((x) => ({ item_type: x.itemType, ref_id: x.refId, quantity: x.quantity, unit_price_cents: x.unitPriceCents, discount_cents: x.discountCents ?? undefined, discount_pct: x.discountPct ?? undefined })),
  });
export const cancelSale = (saleId: string, reason: string) => rpc<void>("fin_cancel_sale", { p_sale: saleId, p_reason: reason });

export interface AddPaymentInput { acquirerId: string; brand?: string | null; modality?: CardModality | null; installments: number; amountCents: number; paidOn?: string; nsu?: string }
export const addPayment = (saleId: string, i: AddPaymentInput) =>
  rpc<string>("fin_add_payment", { p_sale: saleId, p_data: { acquirer_id: i.acquirerId, brand: i.brand ?? null, modality: i.modality ?? null, installments: i.installments, amount_cents: i.amountCents, paid_on: i.paidOn || null, nsu: i.nsu || null } });

// ---------- títulos ----------
export interface TitleListRow {
  id: string; sale_id: string; payment_id: string; unit_id: string; patient_name: string | null; acquirer_name: string; method: string; brand: string | null;
  installment_no: number; installments: number; gross_cents: number; fee_cents: number; net_cents: number; expected_date: string; settled_date: string | null;
  settled_net_cents: number | null; status: ReceivableStatus; reverse_reason: string | null; nsu: string | null;
}
export interface TitleFilter { unitId?: string | null; status?: ReceivableStatus | ""; from?: string; to?: string }
export const listTitles = (clinicId: string, f: TitleFilter) =>
  rpc<TitleListRow[]>("fin_receivables_list", { p_clinic: clinicId, p_unit: f.unitId || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null });
export const settleTitle = (id: string, date?: string) => rpc<void>("fin_settle_receivable", { p_id: id, p_settled_date: date || null });
export const correctTitle = (id: string, date: string, netCents: number, reason: string) => rpc<void>("fin_correct_receivable", { p_id: id, p_settled_date: date, p_settled_net_cents: netCents, p_reason: reason });
export const reverseTitle = (id: string, reason: string) => rpc<void>("fin_reverse_receivable", { p_id: id, p_reason: reason });

// ---------- caixa ----------
export interface CashSummary {
  id: string; unit_id: string; unit_name: string; operator_name: string | null; operator_profile_id: string; business_date: string; status: "open" | "pending_approval" | "closed";
  opening_cash_cents: number; justification: string | null;
  live_lines: { key: string; label: string; expected_cents: number; counted_cents?: number; difference_cents?: number }[];
  movements: { id: string; type: "sangria" | "suprimento"; amount_cents: number; reason: string; created_at: string }[];
}
export const getMyOpenCash = (clinicId: string) => rpc<CashSummary | null>("fin_my_open_cash", { p_clinic: clinicId });
export const openCash = (clinicId: string, unitId: string, openingCents: number) => rpc<string>("fin_open_cash", { p_clinic: clinicId, p_unit: unitId, p_opening_cents: openingCents });
export const cashMovement = (registerId: string, type: "sangria" | "suprimento", amountCents: number, reason: string) =>
  rpc<string>("fin_cash_movement", { p_register: registerId, p_type: type, p_amount_cents: amountCents, p_reason: reason });
export const closeCash = (registerId: string, counted: Record<string, number>, justification: string) =>
  rpc<"closed" | "pending_approval">("fin_close_cash", { p_register: registerId, p_counted: counted, p_justification: justification || null });
export const approveCash = (registerId: string, note?: string) => rpc<void>("fin_approve_cash", { p_register: registerId, p_note: note || null });

export interface CashReportRow {
  id: string; business_date: string; unit_id: string; unit_name: string; operator_profile_id: string; operator_name: string | null; status: "open" | "pending_approval" | "closed";
  opened_at: string; closed_at: string | null; opening_cash_cents: number; expected_cash_cents: number | null; counted_cash_cents: number | null;
  cash_difference_cents: number | null; difference_cents: number | null; justification: string | null; approved_by_name: string | null; stale: boolean;
}
export interface CashFilter { from?: string; to?: string; unitId?: string | null }
export const listCashReport = (clinicId: string, f: CashFilter) =>
  rpc<CashReportRow[]>("fin_cash_report", { p_clinic: clinicId, p_from: f.from || null, p_to: f.to || null, p_unit: f.unitId || null, p_operator: null });
