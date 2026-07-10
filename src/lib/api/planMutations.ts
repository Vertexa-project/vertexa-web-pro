import { supabase } from "@/lib/supabase";

export interface WorkoutExerciseInput {
  name: string;
  muscle_groups: string[];
  sets: number | null;
  reps: number | null;
  load_kg: number | null;
}

export interface WorkoutInput {
  letter: string | null;
  name: string;
  primary_muscle_group: string | null;
  estimated_minutes: number | null;
  exercises: WorkoutExerciseInput[];
}

export interface SaveWorkoutPlanInput {
  patientId: string;
  professionalId: string | null;
  title: string;
  goal: string | null;
  workouts: WorkoutInput[];
}

/**
 * Cria o plano de treino e SUBSTITUI o anterior do paciente (apenas 1 ativo na sprint).
 * Escreve pela RPC SECURITY DEFINER `save_workout_plan` (WP-APP-1): o DELETE+INSERT vira
 * UMA transação atômica no servidor (erro no meio → plano antigo intacto; sem plano parcial)
 * e a autorização é revalidada via can_prescribe_for_patient (vínculo/admin). day_index/
 * order_index são derivados server-side pela ordem do array. professionalId não é enviado:
 * o servidor resolve o autor pelo próprio chamador.
 */
export async function saveWorkoutPlan(input: SaveWorkoutPlanInput): Promise<void> {
  const { error } = await supabase.rpc("save_workout_plan", {
    p_patient_id: input.patientId,
    p_title: input.title,
    p_goal: input.goal,
    p_workouts: input.workouts.map((w) => ({
      letter: w.letter,
      name: w.name,
      primary_muscle_group: w.primary_muscle_group,
      estimated_minutes: w.estimated_minutes,
      exercises: w.exercises.map((ex) => ({
        name: ex.name,
        muscle_groups: ex.muscle_groups,
        sets: ex.sets,
        reps: ex.reps,
        load_kg: ex.load_kg,
      })),
    })),
  });
  if (error) throw error;
}

export interface MealInput {
  time: string | null;
  name: string | null;
  items: string[];
  calories: number | null;
}

export interface SaveNutritionPlanInput {
  patientId: string;
  professionalId: string | null;
  title: string;
  meals: MealInput[];
}

/**
 * Cria o plano alimentar e SUBSTITUI o anterior do paciente.
 * Escreve pela RPC SECURITY DEFINER `save_nutrition_plan` (WP-APP-1): DELETE+INSERT atômico no
 * servidor (sem plano parcial) e autorização revalidada via can_prescribe_for_patient.
 */
export async function saveNutritionPlan(input: SaveNutritionPlanInput): Promise<void> {
  const { error } = await supabase.rpc("save_nutrition_plan", {
    p_patient_id: input.patientId,
    p_title: input.title,
    p_meals: input.meals.map((m) => ({
      time: m.time,
      name: m.name,
      items: m.items,
      calories: m.calories,
    })),
  });
  if (error) throw error;
}
