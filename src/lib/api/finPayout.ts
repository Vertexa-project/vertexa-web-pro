// Financeiro · Entrega 5: motor de repasse. Leitura e escrita SÓ por RPC (a RLS e o fin_can do servidor são a barreira real).
// O profissional chama as mesmas RPCs e recebe só as próprias linhas; Recepção e Estoquista recebem 42501.
import { supabase } from "@/lib/supabase";
import type { PayoutLineType, PayoutRole, PayoutRule, PayoutRuleType, PayoutTargetType, ServiceCategory, Tier } from "@/lib/domain/finPayout";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------- contexto (formulário de regra e simulador) ----------
export interface PayoutContext {
  can_write: boolean; is_owner: boolean;
  professionals: { id: string; name: string }[];
  services: { id: string; name: string; category: ServiceCategory }[];
  items: { id: string; name: string; item_type: string }[];
  units: { id: string; name: string }[];
  settings: { deduct_fee: boolean; deduct_tax: boolean; deduct_material: boolean; tier_base: "organization" | "unit" };
  tax_pct: number;
}
export async function getPayoutContext(clinicId: string): Promise<PayoutContext> {
  const r = await rpc<PayoutContext>("fin_share_context", { p_clinic: clinicId });
  return { ...r, professionals: r.professionals ?? [], services: r.services ?? [], items: r.items ?? [], units: r.units ?? [], tax_pct: n(r.tax_pct) };
}

// ---------- regras ----------
export interface PayoutRuleRow extends PayoutRule {
  professional_name: string; service_name: string | null; item_name: string | null; item_type: string | null; usage_fee_mode: "fixed" | "pct" | null;
  commission_base: "net_fee" | "margin"; notes: string | null; created_at: string; in_use: boolean;
}
export async function listPayoutRules(clinicId: string, professionalId?: string | null, includeInactive = false): Promise<PayoutRuleRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_share_rules_list", { p_clinic: clinicId, p_professional: professionalId || null, p_include_inactive: includeInactive });
  return (rows ?? []).map((r) => ({ ...(r as unknown as PayoutRuleRow), pct: nn(r.pct), amount_cents: nn(r.amount_cents), unit_ids: (r.unit_ids as string[]) ?? [] }));
}
export interface SavePayoutRuleInput {
  id: string | null; professionalId: string; ruleType: PayoutRuleType; role: PayoutRole | "vendedor" | null; targetType: PayoutTargetType; serviceId: string | null; category: ServiceCategory | null;
  stockItemId: string | null; pct: number | null; amountCents: number | null; tiers: Tier[] | null; tierScope: "organization" | "unit" | null; compensation: boolean;
  usageFeeMode: "fixed" | "pct" | null; commissionBase: "net_fee" | "margin"; deductionsOverride: { fee?: boolean; tax?: boolean; material?: boolean } | null;
  allUnits: boolean; unitIds: string[]; validFrom: string; validTo: string | null; notes: string | null; reason?: string; acceptMedication?: boolean;
}
export async function savePayoutRule(clinicId: string, v: SavePayoutRuleInput): Promise<{ id: string; warnings: string[]; pct_sum: number | null }> {
  const r = await rpc<{ id: string; warnings: string[]; pct_sum: number | null }>("fin_share_rule_save", {
    p_clinic: clinicId, p_id: v.id,
    p_data: {
      professional_id: v.professionalId, rule_type: v.ruleType, role: v.role, target_type: v.targetType, service_id: v.serviceId, category: v.category, stock_item_id: v.stockItemId,
      pct: v.pct, amount_cents: v.amountCents, tiers: v.tiers, tier_scope: v.tierScope, compensation: v.compensation, usage_fee_mode: v.usageFeeMode, commission_base: v.commissionBase,
      deductions_override: v.deductionsOverride && Object.keys(v.deductionsOverride).length > 0 ? v.deductionsOverride : null,
      all_units: v.allUnits, unit_ids: v.allUnits ? [] : v.unitIds, valid_from: v.validFrom, valid_to: v.validTo, notes: v.notes,
    },
    p_reason: v.reason ?? null, p_accept_medication: v.acceptMedication ?? false,
  });
  return { id: r.id, warnings: r.warnings ?? [], pct_sum: nn(r.pct_sum) };
}
export const setPayoutRuleActive = (ruleId: string, active: boolean, reason: string) =>
  rpc<void>("fin_share_rule_set_active", { p_rule: ruleId, p_active: active, p_reason: reason });

// ---------- lançamentos e prévia ----------
export interface PayoutLineRow {
  id: string; professional_id: string; professional_name: string; period: string; line_type: PayoutLineType; role: PayoutRole | "vendedor" | null; kind: "original" | "correction" | "manual";
  base_cents: number | null; gross_cents: number | null; pct: number | null; amount_cents: number; source_date: string | null; origin_period: string | null; reason: string | null;
  created_at: string; appointment_id: string | null; unit_name: string | null; service_name: string | null; patient: string | null; memory: Record<string, unknown>;
}
export async function listPayoutLines(clinicId: string, f: { professionalId?: string | null; period?: string | null; unitId?: string | null }): Promise<PayoutLineRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_share_lines_list", { p_clinic: clinicId, p_professional: f.professionalId || null, p_period: f.period || null, p_unit: f.unitId || null, p_limit: 500, p_offset: 0 });
  return (rows ?? []).map((r) => ({ ...(r as unknown as PayoutLineRow), base_cents: nn(r.base_cents), gross_cents: nn(r.gross_cents), pct: nn(r.pct), amount_cents: n(r.amount_cents), memory: (r.memory as Record<string, unknown>) ?? {} }));
}
export interface PayoutDerivedLine { line_type: PayoutLineType; amount_cents: number; memory: Record<string, unknown> }
export interface PayoutMonth {
  period: string; professional_id: string; locked: boolean; derived: PayoutDerivedLine[];
  persisted: { pct: number; fixed_exec: number; commission: number; adjustment: number; liquidated_cents: number };
  tier_adjust_cents: number; fixed_monthly_cents: number; guarantee_cents: number; usage_fee_cents: number; carry_in_cents: number; gross_total_cents: number;
  withholdings: { rule_type: string; label: string | null; rate_pct: number; amount_cents: number; waived: "simples" | "min_base" | null }[];
  withholding_total_cents: number; net_total_cents: number; negative: boolean;
}
export async function getPayoutMonth(clinicId: string, professionalId: string | null, period: string): Promise<PayoutMonth> {
  const r = await rpc<PayoutMonth>("fin_share_month", { p_clinic: clinicId, p_professional: professionalId, p_period: period });
  return { ...r, derived: r.derived ?? [], withholdings: r.withholdings ?? [] };
}
export interface PayoutMonthAll { period: string; locked: boolean; unruled_count: number; professionals: { professional_id: string; name: string; gross_total_cents: number; withholding_total_cents: number; net_total_cents: number; negative: boolean; carry_in_cents: number }[] }
export const getPayoutMonthAll = (clinicId: string, period: string) => rpc<PayoutMonthAll>("fin_share_month_all", { p_clinic: clinicId, p_period: period });
export interface UnruledRow { appointment_id: string; performed_on: string; service_name: string; professional_id: string; professional_name: string; role: PayoutRole; unit_name: string }
export const listUnruled = (clinicId: string, from?: string, to?: string) => rpc<UnruledRow[]>("fin_share_unruled", { p_clinic: clinicId, p_from: from || null, p_to: to || null });
export interface MedCommissionRow { line_id: string; period: string; professional_name: string; item_name: string; item_type: string | null; amount_cents: number; kind: string }
export const listMedCommissions = (clinicId: string, period?: string | null) => rpc<MedCommissionRow[]>("fin_share_med_commissions", { p_clinic: clinicId, p_period: period || null });
export const recalcPayout = (clinicId: string, from?: string | null, to?: string | null) => rpc<{ lines_created: number; events_processed: number }>("fin_share_recalc", { p_clinic: clinicId, p_from: from || null, p_to: to || null });
