import { supabase } from "@/lib/supabase";
import type { ActivityEvent } from "@/types/db";

export async function getPatientTimeline(patientId: string, limit = 50): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from("activity_events")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ActivityEvent[];
}
