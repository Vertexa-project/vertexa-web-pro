import { supabase } from "@/lib/supabase";
import type { NutritionPlanFull, WorkoutPlanFull } from "@/types/db";

/** Plano de treino mais recente do paciente, com treinos (ordenados) e exercícios. */
export async function getWorkoutPlan(patientId: string): Promise<WorkoutPlanFull | null> {
  const { data, error } = await supabase
    .from("workout_plans")
    .select(`*, workouts ( *, workout_exercises ( * ) )`)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const plan = data as unknown as WorkoutPlanFull;
  plan.workouts = [...(plan.workouts ?? [])]
    .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0))
    .map((w) => ({
      ...w,
      workout_exercises: [...(w.workout_exercises ?? [])].sort(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
      ),
    }));
  return plan;
}

/** Plano alimentar mais recente do paciente, com refeições ordenadas. */
export async function getNutritionPlan(patientId: string): Promise<NutritionPlanFull | null> {
  const { data, error } = await supabase
    .from("nutrition_plans")
    .select(`*, meals ( * )`)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const plan = data as unknown as NutritionPlanFull;
  plan.meals = [...(plan.meals ?? [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return plan;
}
