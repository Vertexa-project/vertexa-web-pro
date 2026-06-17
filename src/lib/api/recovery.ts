import { supabase } from "@/lib/supabase";
import type { MuscleRecoveryState } from "@/types/db";

/** Estados de recuperação muscular do paciente (somente leitura — ver PENDÊNCIA #1). */
export async function getMuscleRecovery(patientId: string): Promise<MuscleRecoveryState[]> {
  const { data, error } = await supabase
    .from("muscle_recovery_states")
    .select("*")
    .eq("patient_id", patientId);
  if (error) throw error;
  return (data ?? []) as MuscleRecoveryState[];
}
