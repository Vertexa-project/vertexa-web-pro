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

/** Cria o plano de treino e SUBSTITUI o anterior do paciente (apenas 1 ativo na sprint). */
export async function saveWorkoutPlan(input: SaveWorkoutPlanInput): Promise<void> {
  const { error: delErr } = await supabase
    .from("workout_plans")
    .delete()
    .eq("patient_id", input.patientId);
  if (delErr) throw delErr;

  const { data: plan, error: planErr } = await supabase
    .from("workout_plans")
    .insert({
      patient_id: input.patientId,
      professional_id: input.professionalId,
      title: input.title,
      goal: input.goal,
    })
    .select("id")
    .single();
  if (planErr) throw planErr;

  for (const [i, w] of input.workouts.entries()) {
    const { data: workout, error: wErr } = await supabase
      .from("workouts")
      .insert({
        workout_plan_id: plan.id,
        letter: w.letter,
        name: w.name,
        primary_muscle_group: w.primary_muscle_group,
        day_index: i + 1,
        estimated_minutes: w.estimated_minutes,
      })
      .select("id")
      .single();
    if (wErr) throw wErr;

    if (w.exercises.length > 0) {
      const rows = w.exercises.map((ex, j) => ({
        workout_id: workout.id,
        name: ex.name,
        muscle_groups: ex.muscle_groups,
        sets: ex.sets,
        reps: ex.reps,
        load_kg: ex.load_kg,
        order_index: j + 1,
      }));
      const { error: exErr } = await supabase.from("workout_exercises").insert(rows);
      if (exErr) throw exErr;
    }
  }
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

/** Cria o plano alimentar e SUBSTITUI o anterior do paciente. */
export async function saveNutritionPlan(input: SaveNutritionPlanInput): Promise<void> {
  const { error: delErr } = await supabase
    .from("nutrition_plans")
    .delete()
    .eq("patient_id", input.patientId);
  if (delErr) throw delErr;

  const { data: plan, error: planErr } = await supabase
    .from("nutrition_plans")
    .insert({
      patient_id: input.patientId,
      professional_id: input.professionalId,
      title: input.title,
      status: "active",
    })
    .select("id")
    .single();
  if (planErr) throw planErr;

  if (input.meals.length > 0) {
    const rows = input.meals.map((m, i) => ({
      nutrition_plan_id: plan.id,
      time: m.time,
      name: m.name,
      items: m.items,
      calories: m.calories,
      order_index: i + 1,
    }));
    const { error: mErr } = await supabase.from("meals").insert(rows);
    if (mErr) throw mErr;
  }
}
