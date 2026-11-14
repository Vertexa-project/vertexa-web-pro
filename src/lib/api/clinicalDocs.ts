// Documentos clínicos · Entrega 9. Leitura e escrita SÓ por RPC (doc_*): o servidor confere papel, registro do profissional e acesso ao paciente.
import { supabase } from "@/lib/supabase";
import type { DocType, PrescribedItem } from "@/lib/domain/clinicalDocs";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface DocAccess {
  kind: "clinical" | "front" | "none"; can_emit: boolean; can_list: boolean; can_content: boolean; can_resend: boolean; registry_missing: boolean;
  provider: string | null; provider_ready: boolean; is_demo: boolean;
}
export const NO_DOC_ACCESS: DocAccess = { kind: "none", can_emit: false, can_list: false, can_content: false, can_resend: false, registry_missing: false, provider: null, provider_ready: false, is_demo: false };
export const getDocAccess = (clinicId: string) => rpc<DocAccess>("doc_my_access", { p_clinic: clinicId });

export interface DocRow {
  id: string; clinic_id: string; patient_id: string; patient_name: string | null; encounter_id: string | null; appointment_id: string | null;
  doc_type: DocType; title: string; signed_at: string; professional_name: string | null; professional_registry: string | null;
  provider: string; is_demo: boolean; sncr_number: string | null; item_count: number;
  invalidated: boolean; invalidated_at: string | null; invalidated_reason: string | null; resend_count: number;
}
export interface DocFull extends DocRow {
  content: string; items: PrescribedItem[]; clinic_name: string; content_hash: string;
  patient: { name: string; birth_date: string | null; cpf: string | null; address: string | null };
  professional: { name: string; registry_number: string | null; specialty: string | null };
}
export interface DocListFilter {
  patientId?: string | null; encounterId?: string | null; appointmentId?: string | null;
  docType?: string | null; from?: string | null; to?: string | null; status?: "active" | "invalidated" | null; search?: string | null;
}
export const listDocuments = (clinicId: string, f: DocListFilter = {}) =>
  rpc<DocRow[]>("doc_list", { p_clinic: clinicId, p_patient: f.patientId ?? null, p_encounter: f.encounterId ?? null, p_appointment: f.appointmentId ?? null, p_limit: 200, p_offset: 0,
    p_type: f.docType || null, p_from: f.from || null, p_to: f.to || null, p_status: f.status || null, p_search: f.search?.trim() || null });
export const getDocument = (id: string) => rpc<DocFull>("doc_get", { p_doc: id });
/** Reenviar (modo demonstração): devolve o documento para baixar/abrir o PDF e registra o reenvio. Nada é enviado a ninguém. */
export const resendDocument = (id: string) => rpc<DocFull>("doc_resend", { p_doc: id, p_channel: "download" });
export const invalidateDocument = (id: string, reason: string) => rpc<null>("doc_invalidate", { p_doc: id, p_reason: reason });

export interface RawSession {
  session_id: string; provider: "demo" | "memed" | "nexodata"; is_demo: boolean; doc_type: DocType; expires_at: string;
  patient: { name: string; birth_date: string | null; cpf: string | null; address: string | null };
  professional: { id: string; name: string; registry_number: string | null; specialty: string | null };
  clinic: { id: string; name: string }; encounter_id: string | null; appointment_id: string | null;
}
export const openSession = (clinicId: string, patientId: string, type: DocType, encounterId?: string | null, appointmentId?: string | null) =>
  rpc<RawSession>("doc_open_session", { p_clinic: clinicId, p_patient: patientId, p_type: type, p_encounter: encounterId ?? null, p_appointment: appointmentId ?? null });
export const signDemo = (sessionId: string, title: string, content: string, items: PrescribedItem[], extra: { cpf?: string; address?: string }) =>
  rpc<{ document_id: string; already: boolean }>("doc_sign_demo", { p_session: sessionId, p_title: title, p_content: content, p_items: items, p_patient_extra: extra });

export interface PrescribedRow {
  document_id: string; signed_at: string; is_demo: boolean; encounter_id: string | null; appointment_id: string | null;
  name: string; dose: string; posology: string; quantity: string;
  stock_suggestion: { item_id: string; name: string; stock_unit: string } | null;
}
/** Itens prescritos como dado (para «Preparar retorno»). A sugestão de estoque é só indicação: nada é baixado. */
export const listPrescribedItems = (clinicId: string, patientId: string, f: { encounterId?: string | null; appointmentId?: string | null; since?: string | null } = {}) =>
  rpc<PrescribedRow[]>("doc_prescribed_items", { p_clinic: clinicId, p_patient: patientId, p_encounter: f.encounterId ?? null, p_appointment: f.appointmentId ?? null, p_since: f.since ?? null });
