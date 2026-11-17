import { supabase } from "@/lib/supabase";
import type { PreConsultaFile, PreConsultaQuestion, PreConsultaRow } from "@/lib/domain/preConsulta";

const COLS = "id, patient_id, appointment_id, appointment_starts_at, status, source, questions, answers, sent_at, answered_at, canceled_at";

/** Pedidos de pré-consulta do paciente (mais novo primeiro). A RLS só entrega a quem tem acesso clínico ao paciente. */
export async function listPreConsultas(patientId: string): Promise<PreConsultaRow[]> {
  const { data, error } = await supabase.from("pre_consultas").select(COLS).eq("patient_id", patientId).order("sent_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as unknown as PreConsultaRow[];
}

interface RawFile { document_id: string; doc: { title: string | null; file_path: string; mime_type: string | null } | null }

/** Exames anexados a um pedido (uma consulta só: pedido + documentos). */
export async function listPreConsultaFiles(preConsultaId: string): Promise<PreConsultaFile[]> {
  const { data, error } = await supabase
    .from("pre_consulta_files")
    .select("document_id, doc:patient_documents ( title, file_path, mime_type )")
    .eq("pre_consulta_id", preConsultaId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as RawFile[]).filter((f) => f.doc).map((f) => ({ document_id: f.document_id, ...(f.doc as NonNullable<RawFile["doc"]>) }));
}

export interface SendResult { id: string; created: boolean; appointment_id: string | null; appointment_starts_at: string | null }

export async function sendPreConsulta(patientId: string, appointmentId: string | null = null): Promise<SendResult> {
  const { data, error } = await supabase.rpc("send_pre_consulta", { p_patient_id: patientId, p_appointment_id: appointmentId });
  if (error) throw error;
  return data as SendResult;
}

export async function cancelPreConsulta(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_pre_consulta", { p_id: id });
  if (error) throw error;
}

export interface PreConsultaSettings { auto_send: boolean; questions: PreConsultaQuestion[] | null }

export async function getPreConsultaSettings(clinicId: string): Promise<PreConsultaSettings> {
  const { data, error } = await supabase.from("pre_consulta_settings").select("auto_send, questions").eq("clinic_id", clinicId).maybeSingle();
  if (error) throw error;
  return (data as PreConsultaSettings | null) ?? { auto_send: false, questions: null };
}

/** Salva liga/desliga e perguntas (null = voltar ao padrão). Só admin da clínica (a RPC confere). */
export async function savePreConsultaSettings(clinicId: string, autoSend: boolean, questions: PreConsultaQuestion[] | null): Promise<void> {
  const { error } = await supabase.rpc("set_pre_consulta_settings", { p_clinic_id: clinicId, p_auto_send: autoSend, p_questions: questions });
  if (error) throw error;
}
