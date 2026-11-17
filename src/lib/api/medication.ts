// Medicação (A3): leitura pelas tabelas (a RLS limita a quem acessa o paciente) e escrita SÓ por RPC med_*.
import { supabase } from "@/lib/supabase";
import type { MedApplication, MedDelivery, MedDose, MedPlace, MedStockOption, MedTreatment } from "@/lib/domain/medication";

const num = (v: unknown) => Number(v);

export interface MedicationData {
  treatments: MedTreatment[];
  doses: MedDose[];
  applications: MedApplication[];
  deliveries: MedDelivery[];
  states: Record<string, { state: string; due_on: string | null; days_late: number }>;
}

/** Tudo do paciente em consultas paralelas (4 leituras + estado derivado por RPC), sem N+1. */
export async function getMedication(patientId: string): Promise<MedicationData> {
  const [t, d, a, e] = await Promise.all([
    supabase.from("patient_med_treatments").select("id, patient_id, medication, started_on, dose_mg, weekday, applied_where, notes, stock_item_id, stock_unit_id, status, ended_on").eq("patient_id", patientId).order("created_at", { ascending: false }),
    supabase.from("patient_med_doses").select("id, treatment_id, dose_mg, effective_on, note, created_at").eq("patient_id", patientId).order("effective_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    supabase.from("patient_med_applications").select("id, treatment_id, applied_on, dose_mg, place, source, applied_by_name, note, stock_item_id, created_at").eq("patient_id", patientId).order("applied_on", { ascending: false }).limit(100),
    supabase.from("patient_med_deliveries").select("id, treatment_id, delivered_on, quantity, note, stock_item_id, created_at").eq("patient_id", patientId).order("delivered_on", { ascending: false }).limit(100),
  ]);
  for (const r of [t, d, a, e]) if (r.error) throw r.error;
  const treatments = ((t.data ?? []) as unknown as MedTreatment[]).map((x) => ({ ...x, dose_mg: num(x.dose_mg) }));
  const active = treatments.filter((x) => x.status === "active");
  const states: MedicationData["states"] = {};
  if (active.length > 0) {
    const st = await supabase.rpc("med_states", { p_patient: patientId });
    if (st.error) throw st.error;
    for (const o of (st.data ?? []) as Array<{ treatment_id: string; state: string; due_on: string | null; days_late: number }>) {
      states[o.treatment_id] = { state: o.state, due_on: o.due_on, days_late: Number(o.days_late) };
    }
  }
  return {
    treatments,
    doses: ((d.data ?? []) as unknown as MedDose[]).map((x) => ({ ...x, dose_mg: num(x.dose_mg) })),
    applications: ((a.data ?? []) as unknown as MedApplication[]).map((x) => ({ ...x, dose_mg: num(x.dose_mg) })),
    deliveries: (e.data ?? []) as unknown as MedDelivery[],
    states,
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const saveTreatment = (i: { patientId: string; id?: string | null; medication: string; startedOn: string; doseMg: number | null; weekday: number; where: MedPlace; notes: string; stockItem: string | null; stockUnit: string | null }) =>
  rpc<string>("med_save_treatment", { p_patient: i.patientId, p_id: i.id ?? null, p_medication: i.medication, p_started_on: i.startedOn, p_dose_mg: i.doseMg, p_weekday: i.weekday, p_where: i.where, p_notes: i.notes || null, p_stock_item: i.stockItem, p_stock_unit: i.stockUnit });
export const adjustDose = (i: { treatmentId: string; doseMg: number; effectiveOn: string; note: string }) =>
  rpc<string>("med_adjust_dose", { p_treatment: i.treatmentId, p_dose_mg: i.doseMg, p_effective_on: i.effectiveOn, p_note: i.note || null });
export const endTreatment = (treatmentId: string) => rpc<void>("med_end_treatment", { p_treatment: treatmentId });
export const recordApplication = (i: { treatmentId: string; appliedOn: string; doseMg: number; place: MedPlace; note: string; stockItem: string | null; stockUnit: string | null }) =>
  rpc<string>("med_record_application", { p_treatment: i.treatmentId, p_applied_on: i.appliedOn, p_dose_mg: i.doseMg, p_place: i.place, p_note: i.note || null, p_stock_item: i.stockItem, p_stock_unit: i.stockUnit });
export const recordDelivery = (i: { treatmentId: string; deliveredOn: string; quantity: number; note: string; stockItem: string | null; stockUnit: string | null }) =>
  rpc<string>("med_record_delivery", { p_treatment: i.treatmentId, p_delivered_on: i.deliveredOn, p_quantity: i.quantity, p_note: i.note || null, p_stock_item: i.stockItem, p_stock_unit: i.stockUnit });
export const removeEntry = (kind: "application" | "delivery", id: string) => rpc<void>("med_remove_entry", { p_kind: kind, p_id: id });
export async function listStockOptions(patientId: string): Promise<MedStockOption[]> {
  const rows = await rpc<Array<Record<string, unknown>>>("med_stock_options", { p_patient: patientId });
  return (rows ?? []).map((r) => ({ ...(r as unknown as MedStockOption), qty_on_hand: num(r.qty_on_hand) }));
}
export async function getMedSettings(clinicId: string): Promise<boolean> {
  const r = await rpc<{ patient_reminder_enabled: boolean }>("med_get_settings", { p_clinic: clinicId });
  return Boolean(r?.patient_reminder_enabled);
}
export const setMedSettings = (clinicId: string, enabled: boolean) => rpc<void>("med_set_settings", { p_clinic: clinicId, p_enabled: enabled });
