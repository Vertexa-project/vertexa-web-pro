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
