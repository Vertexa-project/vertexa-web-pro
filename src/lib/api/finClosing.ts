// Financeiro · Entrega 6: fechamento mensal do repasse. Toda leitura/escrita é por RPC (fin_closing_*): o servidor confere papel, mês travado e dono do extrato.
// Arquivos (NF e comprovante) vão para o bucket PRIVADO «fin-repasse», na pasta <clínica>/<extrato>/; a leitura é por URL assinada de curta duração.
import { supabase } from "@/lib/supabase";
import type { PayoutDerivedLine, PayoutLineRow } from "@/lib/api/finPayout";
import { closingFileError, closingFilePath, type AdjustKind, type Acceptance, type ClosingRow, type ClosingStatus, type PayMethod, type PaymentFileRow } from "@/lib/domain/finClosing";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const BUCKET = "fin-repasse";
const SIGNED_URL_SECONDS = 300;

export interface ClosingTotals {
  appointments: number; pct_cents: number; fixed_exec_cents: number; fixed_monthly_cents: number; guarantee_cents: number; commission_cents: number; usage_fee_cents: number;
  adjustment_cents: number; gross_cents: number; withholding_cents: number; net_cents: number;
}
export interface ClosingView {
  period: string; period_ended: boolean;
  closing: { id: string; status: ClosingStatus; accept_days: number; started_at: string; approved_at: string | null; locked_at: string | null; lock_no: number; unlocked_at: string | null; unlock_reason: string | null } | null;
  rows: ClosingRow[]; totals: ClosingTotals;
  pendencies: { unruled: { appointment_id: string; performed_on: string; service_name: string; professional_id: string; professional_name: string; role: string }[]; unruled_count: number;
    appointments_without_sale: number; overdue_receivables: number; negative_count: number };
  can: { prepare: boolean; decide: boolean; pay: boolean; unlock: boolean };
}
export const getClosing = (clinicId: string, period: string, unitId?: string | null) => rpc<ClosingView>("fin_closing_get", { p_clinic: clinicId, p_period: period, p_unit: unitId || null });

export interface DisputeRow { id: string; share_line_id: string | null; line_label: string | null; comment: string; status: "open" | "answered"; response: string | null; created_at: string; answered_at: string | null; stmt_version: number }
export interface StatementView {
  closing: { id: string; period: string; status: ClosingStatus; locked: boolean };
  row: ClosingRow;
  professional: { id: string; name: string; bond_type: string | null; simples_optant: boolean };
  derived: PayoutDerivedLine[]; withholdings: ClosingRow["withholdings"];
  lines: Omit<PayoutLineRow, "professional_id" | "professional_name">[];
  disputes: DisputeRow[];
  check: { items_total_cents: number; gross_cents: number; matches: boolean };
  is_self: boolean; can: { decide: boolean; pay: boolean; prepare: boolean };
}
export const getStatement = (statementId: string) => rpc<StatementView>("fin_closing_statement", { p_cp: statementId });

export interface MyStatementRow {
  id: string; period: string; closing_status: ClosingStatus; status: ClosingRow["status"]; acceptance: Acceptance; accept_deadline: string; deadline_passed: boolean;
  gross_cents: number; withholding_cents: number; net_cents: number; requires_invoice: boolean; nf_status: ClosingRow["nf_status"]; paid_on: string | null; open_disputes: number;
}
export const listMyStatements = (clinicId: string) => rpc<MyStatementRow[]>("fin_closing_my_list", { p_clinic: clinicId });
export const getPaymentFile = (closingId: string) => rpc<{ period: string; rows: PaymentFileRow[] }>("fin_closing_payment_file", { p_closing: closingId });

// ---------- escrita ----------
export const startClosing = (clinicId: string, period: string) => rpc<{ id: string; created: boolean; professionals: number }>("fin_closing_start", { p_clinic: clinicId, p_period: period });
export const refreshClosing = (closingId: string, professionalId?: string | null) => rpc<{ changed: number; added: number }>("fin_closing_refresh", { p_closing: closingId, p_professional: professionalId || null });
export const notifyClosing = (closingId: string, professionalIds?: string[] | null) => rpc<number>("fin_closing_notify", { p_closing: closingId, p_professionals: professionalIds && professionalIds.length > 0 ? professionalIds : null });
export interface ApproveResult { approved: number; skipped: { closing_pro_id: string; professional_id: string; name: string; reason: string }[] }
export const approveClosing = (closingId: string, professionalIds?: string[] | null) => rpc<ApproveResult>("fin_closing_approve", { p_closing: closingId, p_professionals: professionalIds && professionalIds.length > 0 ? professionalIds : null });
export const lockClosing = (closingId: string, reason?: string) => rpc<void>("fin_closing_lock", { p_closing: closingId, p_reason: reason?.trim() || null });
export const unlockClosing = (closingId: string, reason: string) => rpc<void>("fin_closing_unlock", { p_closing: closingId, p_reason: reason });
export const acceptStatement = (statementId: string) => rpc<void>("fin_closing_accept", { p_cp: statementId });
export const contestStatement = (statementId: string, comment: string, lineId?: string | null, lineLabel?: string | null) =>
  rpc<string>("fin_closing_contest", { p_cp: statementId, p_comment: comment, p_line: lineId || null, p_line_label: lineLabel || null });
export const answerDispute = (disputeId: string, response: string) => rpc<void>("fin_closing_answer", { p_dispute: disputeId, p_response: response });
export const adjustStatement = (statementId: string, kind: AdjustKind, amountCents: number, reason: string) => rpc<void>("fin_closing_adjust", { p_cp: statementId, p_kind: kind, p_amount_cents: amountCents, p_reason: reason });
export const saveInvoice = (statementId: string, number: string, date: string, path: string) => rpc<void>("fin_closing_invoice_save", { p_cp: statementId, p_number: number, p_date: date, p_path: path });
export const payStatement = (statementId: string, v: { paidOn: string; method: PayMethod; proofPath: string; note?: string | null }) =>
  rpc<{ paid: boolean; locked: boolean }>("fin_closing_pay", { p_cp: statementId, p_data: { paid_on: v.paidOn, method: v.method, proof_path: v.proofPath, note: v.note?.trim() || null } });

// ---------- arquivos ----------
/** Envia NF ou comprovante para a pasta do extrato e devolve o caminho a registrar na RPC. */
export async function uploadClosingFile(clinicId: string, statementId: string, kind: "nf" | "comprovante", file: File): Promise<string> {
  const bad = closingFileError(file);
  if (bad) throw new Error(bad);
  const path = closingFilePath(clinicId, statementId, kind, file.name);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}
export async function closingFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível abrir o arquivo.");
  return data.signedUrl;
}
