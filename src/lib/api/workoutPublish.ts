import { supabase } from "@/lib/supabase";

export interface PublishResult {
  already_published: boolean;
  published_at: string | null;
  workouts: number;
  exercises: number;
}

/** Publica o plano de treino (rascunho → no app, todos os dias liberados). A função do banco confere a disciplina e recusa plano vazio. */
export async function publishWorkoutPlan(planId: string, notify = true): Promise<PublishResult> {
  const { data, error } = await supabase.rpc("publish_workout_plan", { p_plan_id: planId, p_notify: notify });
  if (error) throw error;
  return data as PublishResult;
}
