import { supabase } from "@/lib/supabase";
import { uploadPatientDocument } from "@/lib/api/documents";
import type { DeliveryKind } from "@/lib/domain/deliveries";

export interface DeliveryRow {
  id: string;
  patient_id: string;
  document_id: string;
  kind: DeliveryKind;
  title: string;
  sent_at: string;
  first_opened_at: string | null;
  revoked_at: string | null;
  sent_by_name: string | null;
}

interface RawDelivery extends Omit<DeliveryRow, "sent_by_name"> {
  sender: { profile: { full_name: string | null } | null } | null;
}

/** Envios do paciente (mais recentes primeiro), com o nome de quem enviou, em UMA consulta. */
export async function listDeliveries(patientId: string): Promise<DeliveryRow[]> {
  const { data, error } = await supabase
    .from("patient_deliveries")
    .select("id, patient_id, document_id, kind, title, sent_at, first_opened_at, revoked_at, sender:professionals!patient_deliveries_sent_by_professional_id_fkey ( profile:profiles!professionals_profile_id_fkey ( full_name ) )")
    .eq("patient_id", patientId)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as RawDelivery[]).map(({ sender, ...d }) => ({ ...d, sent_by_name: sender?.profile?.full_name ?? null }));
}

/** Entrega um documento que já está em Documentos ao app do paciente (registra quem enviou e quando; avisa o paciente). */
export async function sendDocumentToPatient(documentId: string, kind: DeliveryKind, title?: string | null, notify = true): Promise<string> {
  const { data, error } = await supabase.rpc("send_document_to_patient", { p_document_id: documentId, p_kind: kind, p_title: title ?? null, p_notify: notify });
  if (error) throw error;
  return data as string;
}

export async function revokeDelivery(deliveryId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_delivery", { p_delivery_id: deliveryId });
  if (error) throw error;
}

export interface SendPdfInput {
  patientId: string;
  professionalId: string;
  blob: Blob;
  fileName: string;
  kind: DeliveryKind;
  title: string;
}

/**
 * PDF gerado no navegador → bucket privado + linha em Documentos (relatório) → envio ao app.
 * Se o envio falhar depois de salvar, o PDF fica em Documentos e dá para reenviar de lá (não gera arquivo duplicado).
 */
export async function savePdfAndSend(input: SendPdfInput): Promise<{ documentId: string; deliveryId: string | null }> {
  const file = new File([input.blob], input.fileName, { type: "application/pdf" });
  const doc = await uploadPatientDocument({
    patientId: input.patientId,
    file,
    kind: "report",
    title: input.title,
    uploadedByRole: "professional",
    uploadedByProfessionalId: input.professionalId,
  });
  const deliveryId = await sendDocumentToPatient(doc.id, input.kind, input.title);
  return { documentId: doc.id, deliveryId };
}
