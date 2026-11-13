// Consulta assistida — camada de dados. Escritas só por RPC (security definer); leituras sob RLS
// (só equipe clínica com acesso ao paciente). Telas NÃO chamam o Supabase direto.
import { supabase } from "@/lib/supabase";
import type { RecordFields } from "../../../supabase/functions/_shared/clinical/record";
import type { TemplateSnapshot } from "../../../supabase/functions/_shared/clinical/template";

export type EncounterStatus = "gravando" | "processando" | "rascunho" | "finalizado" | "cancelado";

export interface Encounter {
  id: string;
  clinic_id: string;
  patient_id: string;
  professional_id: string;
  template_snapshot: TemplateSnapshot;
  status: EncounterStatus;
  started_at: string;
  recording_started_at: string | null;
  ended_at: string | null;
  finalized_at: string | null;
  consent_version: string | null;
  consent_text: string | null;
  consent_given_at: string | null;
  is_demo: boolean;
  processing_error: string | null;
  audio_delete_after: string | null;
  audio_deleted_at: string | null;
  agreements_sent_at: string | null;
}

export interface EncounterListItem {
  id: string;
  status: EncounterStatus;
  started_at: string;
  ended_at: string | null;
  finalized_at: string | null;
  professional_name: string | null;
  is_demo: boolean;
  agreements_sent_at: string | null;
}

export interface TranscriptSegment {
  id: string;
  ord: number;
  speaker: string | null;
  text: string;
  start_ms: number;
  is_demo: boolean;
}

export interface ChunkRow {
  id: string;
  seq: number;
  status: "uploaded" | "transcribing" | "done" | "failed";
  duration_ms: number | null;
}

export interface RecordState {
  fields: RecordFields;
  version: number;
  ai_warning: string | null;
}

export interface Addendum {
  id: string;
  text: string;
  created_at: string;
  author: string | null;
}

export interface EncounterPeople {
  professional: string | null;
  addenda: Addendum[];
}

const BUCKET = "clinical-audio";

const ERROR_TEXT: Record<string, string> = {
  FORBIDDEN: "Você não tem acesso ao prontuário deste paciente.",
  CONSENT_REQUIRED: "Registre o aceite do paciente antes de gravar.",
  ENCOUNTER_NOT_EDITABLE: "Este atendimento já foi finalizado ou cancelado.",
  ENCOUNTER_FINALIZED: "Este atendimento já foi finalizado.",
  ENCOUNTER_NOT_READY: "Termine a gravação e o processamento antes de finalizar.",
};

/** Traduz o código do banco/função para texto de tela. */
export function clinicalErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? "";
  for (const [code, text] of Object.entries(ERROR_TEXT)) if (raw.includes(code)) return text;
  return "Não foi possível concluir. Tente novamente.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const startEncounter = (patientId: string) => rpc<string>("clinical_start_encounter", { p_patient: patientId });

export async function getEncounter(id: string): Promise<Encounter | null> {
  const { data, error } = await supabase
    .from("clinical_encounters")
    .select(
      "id,clinic_id,patient_id,professional_id,template_snapshot,status,started_at,recording_started_at,ended_at,finalized_at,consent_version,consent_text,consent_given_at,is_demo,processing_error,audio_delete_after,audio_deleted_at,agreements_sent_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Encounter | null) ?? null;
}

export const listEncounters = (patientId: string) =>
  rpc<EncounterListItem[]>("clinical_list_encounters", { p_patient: patientId });

export async function getRecord(encounterId: string): Promise<RecordState | null> {
  const { data, error } = await supabase
    .from("clinical_records")
    .select("fields,version,ai_warning")
    .eq("encounter_id", encounterId)
    .maybeSingle();
  if (error) throw error;
  return (data as RecordState | null) ?? null;
}

export async function listSegments(encounterId: string): Promise<TranscriptSegment[]> {
  const { data, error } = await supabase
    .from("clinical_transcript_segments")
    .select("id,ord,speaker,text,start_ms,is_demo")
    .eq("encounter_id", encounterId)
    .order("ord", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TranscriptSegment[];
}

export async function listChunks(encounterId: string): Promise<ChunkRow[]> {
  const { data, error } = await supabase
    .from("clinical_audio_chunks")
    .select("id,seq,status,duration_ms")
    .eq("encounter_id", encounterId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChunkRow[];
}

export const getPeople = (encounterId: string) => rpc<EncounterPeople | null>("clinical_encounter_people", { p_encounter: encounterId });

export const recordConsent = (encounterId: string, version: string, text: string) =>
  rpc<void>("clinical_record_consent", { p_encounter: encounterId, p_version: version, p_text: text });

export const setEncounterStatus = (encounterId: string, status: "gravando" | "processando" | "rascunho") =>
  rpc<void>("clinical_set_status", { p_encounter: encounterId, p_status: status });

export const cancelEncounter = (encounterId: string) => rpc<void>("clinical_cancel_encounter", { p_encounter: encounterId });

export const saveField = (encounterId: string, key: string, value: string) =>
  rpc<unknown>("clinical_save_field", { p_encounter: encounterId, p_key: key, p_value: value });

export const unlockField = (encounterId: string, key: string) =>
  rpc<void>("clinical_unlock_field", { p_encounter: encounterId, p_key: key });

export const finalizeEncounter = (encounterId: string) => rpc<void>("clinical_finalize", { p_encounter: encounterId });

export const addAddendum = (encounterId: string, text: string) =>
  rpc<string>("clinical_add_addendum", { p_encounter: encounterId, p_text: text });

export const sendAgreements = (encounterId: string, text: string) =>
  rpc<string>("clinical_send_agreements", { p_encounter: encounterId, p_text: text });

export interface AgreementSend {
  id: string;
  sent_at: string;
  text: string;
}

export async function listAgreementSends(encounterId: string): Promise<AgreementSend[]> {
  const { data, error } = await supabase
    .from("clinical_agreement_sends")
    .select("id,sent_at,text")
    .eq("encounter_id", encounterId)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AgreementSend[];
}

// ---------------------------------------------------------------- áudio e funções
export async function uploadAudioChunk(path: string, blob: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (!error) return;
  // Reenvio depois de uma queda: o objeto já está lá → conta como enviado.
  const msg = `${(error as { message?: string }).message ?? ""} ${(error as { statusCode?: string }).statusCode ?? ""}`;
  if (/already exists|Duplicate|409/i.test(msg)) return;
  throw error;
}

export const registerChunk = (encounterId: string, seq: number, path: string, mime: string, size: number, durationMs: number) =>
  rpc<string>("clinical_register_chunk", {
    p_encounter: encounterId,
    p_seq: seq,
    p_path: path,
    p_mime: mime,
    p_size: size,
    p_duration_ms: durationMs,
  });

export interface TranscribeResult {
  mode: "demo" | "openai";
  segments: number;
  already?: boolean;
  in_progress?: boolean;
}
export interface StructureResult {
  mode: "demo" | "openai";
  applied: number;
  skipped: number;
  warning: string | null;
  empty?: boolean;
}

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = "function_error";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = (await ctx.json()) as { error?: string };
        if (p?.error) code = String(p.error);
      } catch {
        // corpo não-JSON
      }
    }
    throw new Error(code);
  }
  return data as T;
}

export const transcribeChunk = (chunkId: string) => invokeFn<TranscribeResult>("clinical-transcribe", { chunk_id: chunkId });
export const structureEncounter = (encounterId: string) => invokeFn<StructureResult>("clinical-structure", { encounter_id: encounterId });
export const purgeAudio = (body: { encounter_id?: string; now?: boolean }) =>
  invokeFn<{ purged: number; checked: number }>("clinical-audio-purge", body);
