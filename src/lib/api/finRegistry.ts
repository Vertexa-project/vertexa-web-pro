// Financeiro · base (Entrega 1): unidades, papéis, histórico, configurações e alíquota. Leitura por RLS, escrita só por RPC.
import { supabase } from "@/lib/supabase";
import { rowToAccess, type FinAccess, type FinRole } from "@/lib/domain/finAccess";
import type { EffectiveTaxRate, TaxRateRow } from "@/lib/domain/taxRate";

export interface ClinicUnit {
  id: string;
  clinic_id: string;
  name: string;
  is_active: boolean;
  is_primary: boolean;
  license_number: string | null;
  license_valid_until: string | null;
}

export interface StaffRoleRow {
  id: string;
  professional_id: string;
  role: FinRole;
  all_units: boolean;
  unit_ids: string[];
}

export interface AuditEntry {
  id: string;
  entity: string;
  entity_id: string | null;
  action: "create" | "update" | "deactivate" | "reverse" | "view_sensitive";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  user_name: string | null;
  at: string;
  unit_id: string | null;
}

export interface FinSettings {
  clinic_id: string;
  auto_settle: boolean;
  deduct_fee: boolean;
  deduct_tax: boolean;
  deduct_material: boolean;
  cash_diff_limit_cents: number;
  accept_days: number;
  patient_display: "initials" | "full" | "hidden";
  tier_base: "organization" | "unit";
}

export async function getFinAccess(clinicId: string): Promise<FinAccess> {
  const { data, error } = await supabase.rpc("fin_my_access", { p_clinic: clinicId });
  if (error) throw error;
  return rowToAccess(data);
}

export async function listUnits(clinicId: string): Promise<ClinicUnit[]> {
  const { data, error } = await supabase
    .from("clinic_units")
    .select("id, clinic_id, name, is_active, is_primary, license_number, license_valid_until")
    .eq("clinic_id", clinicId)
    .order("is_primary", { ascending: false })
    .order("name");
  if (error) throw error;
  return (data ?? []) as ClinicUnit[];
}

export interface SaveUnitInput {
  id: string | null;
  name: string;
  isActive: boolean;
  licenseNumber: string;
  licenseValidUntil: string;
  reason?: string;
}

export async function saveUnit(clinicId: string, input: SaveUnitInput): Promise<string> {
  const { data, error } = await supabase.rpc("fin_save_unit", {
    p_clinic: clinicId,
    p_id: input.id,
    p_data: { name: input.name, is_active: input.isActive, license_number: input.licenseNumber, license_valid_until: input.licenseValidUntil || null },
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function listStaffRoles(clinicId: string): Promise<StaffRoleRow[]> {
  const { data, error } = await supabase
    .from("clinic_staff_roles")
    .select("id, professional_id, role, all_units, unit_ids")
    .eq("clinic_id", clinicId);
  if (error) throw error;
  return (data ?? []) as StaffRoleRow[];
}

export interface StaffRoleInput {
  role: FinRole;
  allUnits: boolean;
  unitIds: string[];
}

export async function setStaffRoles(clinicId: string, professionalId: string, roles: StaffRoleInput[], reason?: string): Promise<void> {
  const { error } = await supabase.rpc("fin_set_staff_roles", {
    p_clinic: clinicId,
    p_professional: professionalId,
    p_roles: roles.map((r) => ({ role: r.role, all_units: r.allUnits, unit_ids: r.allUnits ? [] : r.unitIds })),
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export interface AuditFilter {
  entity?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export async function listAudit(clinicId: string, f: AuditFilter): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc("fin_audit_list", {
    p_clinic: clinicId,
    p_entity: f.entity ?? null,
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_limit: f.limit ?? 100,
    p_offset: f.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

export async function getFinSettings(clinicId: string): Promise<FinSettings | null> {
  const { data, error } = await supabase.from("fin_settings").select("*").eq("clinic_id", clinicId).maybeSingle();
  if (error) throw error;
  return (data as FinSettings | null) ?? null;
}

export async function saveFinSettings(clinicId: string, patch: Partial<Omit<FinSettings, "clinic_id">>, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("fin_save_settings", { p_clinic: clinicId, p_data: patch, p_reason: reason ?? null });
  if (error) throw error;
}

export async function listTaxRates(clinicId: string): Promise<(TaxRateRow & { id: string })[]> {
  const { data, error } = await supabase
    .from("fin_tax_rates")
    .select("id, period, rate_pct, unit_id")
    .eq("clinic_id", clinicId)
    .order("period", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as { id: string; period: string; rate_pct: number | string; unit_id: string | null }[]).map((r) => ({ ...r, rate_pct: Number(r.rate_pct) }));
}

export async function setTaxRate(clinicId: string, period: string, ratePct: number, unitId: string | null, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("fin_set_tax_rate", { p_clinic: clinicId, p_period: period, p_rate_pct: ratePct, p_unit: unitId, p_reason: reason ?? null });
  if (error) throw error;
}

/** Chamada ao servidor (mesma regra de effectiveTaxRate no domínio) — usada pela prova de paridade. */
export async function getEffectiveTaxRate(clinicId: string, period: string, unitId: string | null): Promise<EffectiveTaxRate> {
  const { data, error } = await supabase.rpc("fin_effective_tax_rate", { p_clinic: clinicId, p_period: period, p_unit: unitId });
  if (error) throw error;
  const r = ((data ?? []) as { rate_pct: number | null; inherited: boolean; source_period: string | null; has_rate: boolean }[])[0];
  return { found: Boolean(r?.has_rate), ratePct: r?.rate_pct == null ? null : Number(r.rate_pct), inherited: Boolean(r?.inherited), sourcePeriod: r?.source_period ?? null };
}
