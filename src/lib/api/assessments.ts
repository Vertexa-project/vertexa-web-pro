import { supabase } from "@/lib/supabase";
import type { BodyAssessment, ProgressPhoto } from "@/types/db";

/** Avaliações corporais em ordem cronológica (asc) — pronto para o gráfico de evolução. */
export async function getBodyAssessments(patientId: string): Promise<BodyAssessment[]> {
  const { data, error } = await supabase
    .from("body_assessments")
    .select("*")
    .eq("patient_id", patientId)
    .order("assessed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BodyAssessment[];
}

export async function getProgressPhotos(patientId: string): Promise<ProgressPhoto[]> {
  const { data, error } = await supabase
    .from("progress_photos")
    .select("*")
    .eq("patient_id", patientId)
    .order("taken_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProgressPhoto[];
}

/**
 * Documentos do paciente = avaliações corporais que têm um arquivo anexado
 * (laudos de DEXA/bioimpedância em PDF etc.), mais recentes primeiro. A web só LÊ.
 * ⚠️ document_url é URL crua na sprint; bucket privado + signed URL é dívida pós-MVP
 * (PENDENCIAS #12) — não embutir o arquivo, só linkar.
 */
export async function getPatientDocuments(patientId: string): Promise<BodyAssessment[]> {
  const { data, error } = await supabase
    .from("body_assessments")
    .select("*")
    .eq("patient_id", patientId)
    .not("document_url", "is", null)
    .order("assessed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BodyAssessment[];
}
