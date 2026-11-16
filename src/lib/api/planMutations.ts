import { supabase } from "@/lib/supabase";

export interface WorkoutExerciseInput {
  name: string;
  muscle_groups: string[];
  sets: number | null;
  reps: number | null;
  load_kg: number | null;
  /** Instrução do exercício (texto livre) que o paciente lê no app. */
  notes?: string | null;
  /** Intervalo entre séries, em segundos. */
  rest_seconds?: number | null;
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
  /** true = já salva publicada. Padrão: rascunho até a 1ª publicação; plano que o paciente já vê continua visível. */
  publish?: boolean;
}

/**
 * Cria o plano de treino e SUBSTITUI o anterior do paciente (apenas 1 ativo na sprint).
 * P6: usa save_workout_plan_v2 (a mesma gravação + estado de publicação + instrução/intervalo do exercício).
 * Escreve pela RPC SECURITY DEFINER `save_workout_plan` (WP-APP-1): o DELETE+INSERT vira
 * UMA transação atômica no servidor (erro no meio → plano antigo intacto; sem plano parcial)
 * e a autorização é revalidada via can_prescribe_for_patient (vínculo/admin). day_index/
 * order_index são derivados server-side pela ordem do array. professionalId não é enviado:
 * o servidor resolve o autor pelo próprio chamador.
 */
export async function saveWorkoutPlan(input: SaveWorkoutPlanInput): Promise<void> {
  const { error } = await supabase.rpc("save_workout_plan_v2", {
    p_publish: input.publish ?? false,
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
        notes: ex.notes ?? null,
        rest_seconds: ex.rest_seconds ?? null,
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
  options?: { items: string[]; calories: number | null }[];
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
      options: m.options ?? [],
    })),
  });
  if (error) throw error;
}
