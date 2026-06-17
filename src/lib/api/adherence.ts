import { supabase } from "@/lib/supabase";
import type { AdherenceSnapshot } from "@/types/db";

/** Snapshot de VRI mais recente do paciente (lido, não recalculado — PENDÊNCIA #3). */
export async function getAdherenceSnapshot(patientId: string): Promise<AdherenceSnapshot | null> {
  const { data, error } = await supabase
    .from("adherence_snapshots")
    .select("*")
    .eq("patient_id", patientId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AdherenceSnapshot | null;
}
