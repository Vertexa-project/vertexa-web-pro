// Financeiro · Entrega 4: atendimento (participantes), kit com baixa de estoque, pacotes dos pacientes, consumo sem saldo e devolução.
// Leitura e escrita SÓ por RPC (a RLS e o fin_can/appt_can do servidor são a barreira real; o custo do material vem nulo para quem não lê estoque).
import { supabase } from "@/lib/supabase";
import type { ApptRole, ApptStatus } from "@/lib/domain/finAppointments";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------- contexto do «Novo atendimento» ----------
export interface ApptContext {
  can_manage: boolean; is_professional: boolean; my_professional_id: string | null; roles: ApptRole[] | null;
  services: { id: string; name: string; roles: ApptRole[] }[];
  professionals: { id: string; name: string }[];
  sale_items: { sale_item_id: string; sale_id: string; description: string; sold_on: string; remaining: number; net_cents: number | null }[];
  packages: { patient_package_item_id: string; patient_package_id: string; name: string; expires_on: string; qty_total: number; qty_used: number; remaining: number }[];
}
export async function getApptContext(clinicId: string, unitId: string, patientId: string | null, serviceId: string | null): Promise<ApptContext> {
  const r = await rpc<ApptContext>("fin_appt_context", { p_clinic: clinicId, p_unit: unitId, p_patient: patientId, p_service: serviceId });
  return { ...r, sale_items: (r.sale_items ?? []).map((s) => ({ ...s, remaining: n(s.remaining) })), packages: (r.packages ?? []).map((p) => ({ ...p, qty_total: n(p.qty_total), qty_used: n(p.qty_used), remaining: n(p.remaining) })) };
}
export const searchApptPatients = (clinicId: string, search: string) =>
  rpc<{ patient_id: string; full_name: string }[]>("fin_appt_patients", { p_clinic: clinicId, p_search: search || null, p_limit: 20 });

// ---------- lista e detalhe ----------
export interface ApptParticipant { professional_id: string; name: string; role: ApptRole }
export interface ApptRow {
  id: string; performed_on: string; status: ApptStatus; unit_id: string; unit_name: string; patient_id: string; patient_name: string | null; service_id: string; service_name: string;
  participants: ApptParticipant[]; sale_id: string | null; package_name: string | null; without_sale: boolean; base_value_cents: number | null;
  /** nulo para quem não lê o estoque (profissional, Recepção) */
  material_cost_cents: number | null; material_estimated_cents: number | null; has_shortfall: boolean; can_manage: boolean; created_at: string;
}
export interface ApptFilter { unitId?: string | null; status?: ApptStatus | ""; from?: string; to?: string; patientId?: string | null; professionalId?: string | null; onlyWithoutSale?: boolean; onlyShortfall?: boolean }
export async function listAppointments(clinicId: string, f: ApptFilter): Promise<ApptRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_appt_list", {
    p_clinic: clinicId, p_unit: f.unitId || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null, p_patient: f.patientId || null,
    p_professional: f.professionalId || null, p_only_without_sale: f.onlyWithoutSale ?? false, p_only_shortfall: f.onlyShortfall ?? false, p_limit: 500, p_offset: 0,
  });
  return (rows ?? []).map((r) => ({ ...(r as unknown as ApptRow), base_value_cents: nn(r.base_value_cents), material_cost_cents: nn(r.material_cost_cents), material_estimated_cents: nn(r.material_estimated_cents) }));
}

export interface ApptMaterial {
  id: string; item_id: string; item_name: string; consumption_unit: string; stock_unit: string; batch: number; source: "kit" | "added"; planned_qty: number; qty_consumption: number;
  qty: number; applied_qty: number; short_qty: number; status: "active" | "reversed"; cost_cents: number | null; estimated_cents: number | null;
}
export interface ApptDetail {
  id: string; clinic_id: string; unit_id: string; unit_name: string; status: ApptStatus; performed_on: string; service_id: string; service_name: string; patient_id: string; patient_name: string | null;
  sale_id: string | null; sale_item_id: string | null; patient_package_item_id: string | null; notes: string | null; agenda_appointment_id: string | null; encounter_id: string | null;
  base_value_cents: number | null; material_cost_cents: number | null; material_estimated_cents: number | null; has_shortfall: boolean; can_manage: boolean; can_cost: boolean;
  cancel_reason: string | null; done_at: string | null; canceled_at: string | null;
  package: { name: string; item_name: string; qty_total: number; qty_used: number; expires_on: string } | null; sale_description: string | null;
  participants: ApptParticipant[]; materials: ApptMaterial[];
}
export async function getAppointment(id: string): Promise<ApptDetail> {
  const r = await rpc<ApptDetail>("fin_appt_get", { p_appt: id });
  return {
    ...r, base_value_cents: nn(r.base_value_cents), material_cost_cents: nn(r.material_cost_cents), material_estimated_cents: nn(r.material_estimated_cents),
    materials: (r.materials ?? []).map((m) => ({ ...m, planned_qty: n(m.planned_qty), qty_consumption: n(m.qty_consumption), qty: n(m.qty), applied_qty: n(m.applied_qty), short_qty: n(m.short_qty), cost_cents: nn(m.cost_cents), estimated_cents: nn(m.estimated_cents) })),
  };
}

// ---------- kit ----------
export interface KitLot { lot_id: string; lot_code: string; expiry_date: string | null; available: number; expired: boolean }
export interface KitLine {
  item_id: string; name: string; consumption_unit: string; stock_unit: string; factor: number; fractional: boolean; individual_use: boolean; lot_control: boolean;
  planned_qty: number; qty: number; source: "kit" | "added"; short_qty: number; status: string; balance: number; avg_cost_cents: number | null; cost_cents: number | null;
  lots: KitLot[]; suggested_lot_id: string | null;
}
export interface KitView {
  appointment_id: string; status: ApptStatus; unit_id: string; patient_id: string; can_cost: boolean; lines: KitLine[];
  catalog: { id: string; name: string; consumption_unit: string; stock_unit: string; fractional: boolean }[];
}
export async function getKit(apptId: string): Promise<KitView> {
  const r = await rpc<KitView>("fin_appt_kit", { p_appt: apptId });
  return {
    ...r,
    lines: (r.lines ?? []).map((l) => ({
      ...l, factor: n(l.factor), planned_qty: n(l.planned_qty), qty: n(l.qty), short_qty: n(l.short_qty), balance: n(l.balance), avg_cost_cents: nn(l.avg_cost_cents), cost_cents: nn(l.cost_cents),
      lots: (l.lots ?? []).map((x) => ({ ...x, available: n(x.available) })),
    })),
  };
}

// ---------- escrita ----------
export interface SaveApptInput {
  id: string | null; unitId: string; patientId: string; serviceId: string; performedOn: string; saleItemId: string | null; patientPackageItemId: string | null;
  notes?: string; participants: { professionalId: string; role: ApptRole }[]; reason?: string;
}
const toParts = (p: SaveApptInput["participants"]) => p.map((x) => ({ professional_id: x.professionalId, role: x.role }));
export const saveAppointment = (clinicId: string, i: SaveApptInput) =>
  rpc<string>("fin_appt_save", {
    p_clinic: clinicId, p_unit: i.unitId, p_id: i.id,
    p_data: { patient_id: i.patientId, service_id: i.serviceId, performed_on: i.performedOn, sale_item_id: i.saleItemId, patient_package_item_id: i.patientPackageItemId, notes: i.notes ?? null },
    p_participants: toParts(i.participants), p_reason: i.reason ?? null,
  });

export interface KitLineInput { itemId: string; quantity: number; lotId?: string | null }
const toLines = (l: KitLineInput[]) => l.map((x) => ({ item_id: x.itemId, quantity: x.quantity, lot_id: x.lotId || undefined }));
/** `lines` null = o kit do serviço como está cadastrado. */
export const completeAppointment = (id: string, lines: KitLineInput[] | null, note?: string) =>
  rpc<{ appointment_id: string; has_shortfall: boolean; base_value_cents: number | null }>("fin_appt_complete", { p_appt: id, p_lines: lines ? toLines(lines) : null, p_note: note || null });
export const correctAppointment = (id: string, lines: KitLineInput[], reason: string) =>
  rpc<{ appointment_id: string; has_shortfall: boolean; delta_cents: number }>("fin_appt_correct", { p_appt: id, p_lines: toLines(lines), p_reason: reason });
export const cancelAppointment = (id: string, reason: string) => rpc<void>("fin_appt_cancel", { p_appt: id, p_reason: reason });
export const setAppointmentParticipants = (id: string, participants: SaveApptInput["participants"], reason?: string) =>
  rpc<void>("fin_appt_set_participants", { p_appt: id, p_participants: toParts(participants), p_reason: reason || null });

// ---------- pacotes dos pacientes ----------
export interface PatientPackageItem {
  id: string; item_type: "service" | "product"; name: string; service_id: string | null; stock_item_id: string | null; qty_total: number; qty_used: number; remaining: number; net_total_cents: number | null;
}
export interface PatientPackageRow {
  id: string; patient_id: string; patient_name: string | null; unit_id: string; unit_name: string; name: string; sale_id: string; purchased_on: string; expires_on: string;
  status: "active" | "canceled"; expired: boolean; price_cents: number | null; items: PatientPackageItem[];
}
export interface PatientPackageFilter { patientId?: string | null; status?: "active" | "canceled" | ""; search?: string }
export async function listPatientPackages(clinicId: string, f: PatientPackageFilter): Promise<PatientPackageRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_patient_packages_list", { p_clinic: clinicId, p_patient: f.patientId || null, p_status: f.status || null, p_search: f.search?.trim() || null, p_limit: 500, p_offset: 0 });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as PatientPackageRow), price_cents: nn(r.price_cents),
    items: ((r.items as Record<string, unknown>[]) ?? []).map((i) => ({ ...(i as unknown as PatientPackageItem), qty_total: n(i.qty_total), qty_used: n(i.qty_used), remaining: n(i.remaining), net_total_cents: nn(i.net_total_cents) })),
  }));
}
export const deliverPackageItem = (itemId: string, qty: number, unitId?: string | null) =>
  rpc<{ patient_package_item_id: string; qty_used: number; remaining: number; movement_ids: string[] }>("fin_package_deliver", { p_item: itemId, p_qty: qty, p_data: { unit_id: unitId || undefined } });

// ---------- devolução de paciente e consumo sem saldo ----------
export const returnFromPatient = (movementId: string, qty: number, reason: string) => rpc<string>("fin_stock_patient_return", { p_movement: movementId, p_qty: qty, p_reason: reason });

export interface ShortfallRow {
  id: string; created_at: string; occurred_on: string; unit_id: string; unit_name: string; item_id: string; item_name: string; stock_unit: string; qty: number; est_cost_cents: number;
  appointment_id: string; service_name: string; patient_name: string | null; status: "open" | "resolved" | "reversed"; resolution: "retro_entry" | "adjustment" | "reversed" | null;
  resolve_reason: string | null; resolved_at: string | null;
}
export async function listShortfalls(clinicId: string, f: { unitId?: string | null; status?: string }): Promise<ShortfallRow[]> {
  const rows = await rpc<Record<string, unknown>[]>("fin_shortfalls_list", { p_clinic: clinicId, p_unit: f.unitId || null, p_status: f.status === "" ? null : (f.status ?? "open"), p_limit: 500, p_offset: 0 });
  return (rows ?? []).map((r) => ({ ...(r as unknown as ShortfallRow), qty: n(r.qty), est_cost_cents: n(r.est_cost_cents) }));
}
export const resolveShortfall = (id: string, mode: "retro" | "adjust", reason: string) => rpc<void>("fin_shortfall_resolve", { p_id: id, p_mode: mode, p_reason: reason });
