import { supabase } from "@/lib/supabase";
import type { FinanceCharge, FinanceOverview, FinancePatient } from "@/lib/domain/finance";

export async function getFinanceOverview(clinicId: string, month: string): Promise<FinanceOverview> {
  const { data, error } = await supabase.rpc("finance_overview", { p_clinic: clinicId, p_month: month });
  if (error) throw error;
  return data as FinanceOverview;
}
export async function getFinanceCharges(clinicId: string, month: string): Promise<FinanceCharge[]> {
  const { data, error } = await supabase.rpc("finance_charges", { p_clinic: clinicId, p_month: month });
  if (error) throw error;
  return (data ?? []) as FinanceCharge[];
}
export async function getFinancePatients(clinicId: string): Promise<FinancePatient[]> {
  const { data, error } = await supabase.rpc("finance_patients", { p_clinic: clinicId });
  if (error) throw error;
  return (data ?? []) as FinancePatient[];
}
export async function generateMonthCharges(clinicId: string, month: string): Promise<number> {
  const { data, error } = await supabase.rpc("generate_month_charges", { p_clinic: clinicId, p_month: month });
  if (error) throw error;
  return Number(data ?? 0);
}
export async function setPatientBilling(input: { patientId: string; amountCents: number; dueDay: number; active: boolean }): Promise<void> {
  const { error } = await supabase.rpc("set_patient_billing", { p_patient: input.patientId, p_amount_cents: input.amountCents, p_due_day: input.dueDay, p_active: input.active, p_notes: null });
  if (error) throw error;
}
export async function markChargePaid(chargeId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_charge_paid", { p_charge: chargeId, p_paid_on: null });
  if (error) throw error;
}
export async function reopenCharge(chargeId: string): Promise<void> {
  const { error } = await supabase.rpc("reopen_charge", { p_charge: chargeId });
  if (error) throw error;
}
export async function cancelCharge(chargeId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_charge", { p_charge: chargeId });
  if (error) throw error;
}
