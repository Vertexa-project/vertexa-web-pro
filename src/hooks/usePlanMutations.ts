import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  saveNutritionPlan,
  saveWorkoutPlan,
  type SaveNutritionPlanInput,
  type SaveWorkoutPlanInput,
} from "@/lib/api/planMutations";
import { qk } from "@/lib/queryKeys";

export function useSaveWorkoutPlan(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWorkoutPlanInput) => saveWorkoutPlan(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workoutPlan(patientId) });
      qc.invalidateQueries({ queryKey: qk.allPlans });
    },
  });
}

export function useSaveNutritionPlan(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveNutritionPlanInput) => saveNutritionPlan(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.nutritionPlan(patientId) });
      qc.invalidateQueries({ queryKey: qk.allPlans });
    },
  });
}
