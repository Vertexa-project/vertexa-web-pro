import { supabase } from "@/lib/supabase";
import type { NutritionPlanFull, PlanListItem, WorkoutPlanFull } from "@/types/db";

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

interface RawPlanRow {
  id: string;
  title: string;
  created_at: string;
  patient_id: string | null;
  patient: { profile: { full_name: string | null } | null } | null;
}

/** Todos os planos (treino + alimentar) entre pacientes, para a tela /planos. */
export async function listAllPlans(): Promise<PlanListItem[]> {
  const select = "id, title, created_at, patient_id, patient:patients ( profile:profiles ( full_name ) )";
  const [w, n] = await Promise.all([
    supabase.from("workout_plans").select(select),
    supabase.from("nutrition_plans").select(select),
  ]);
  if (w.error) throw w.error;
  if (n.error) throw n.error;

  const map = (rows: RawPlanRow[] | null, type: PlanListItem["type"]): PlanListItem[] =>
    (rows ?? []).map((r) => ({
      id: r.id,
      type,
      title: r.title,
      patientId: r.patient_id ?? "",
      patientName: r.patient?.profile?.full_name ?? null,
      createdAt: r.created_at,
    }));

  return [
    ...map(w.data as unknown as RawPlanRow[], "treino"),
    ...map(n.data as unknown as RawPlanRow[], "alimentar"),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
