import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  saveNutritionPlan,
  saveWorkoutPlan,
  type SaveNutritionPlanInput,
  type SaveWorkoutPlanInput,
} from "@/lib/api/planMutations";
import { useWriteGuard } from "@/hooks/useDisciplines";
import { qk } from "@/lib/queryKeys";

// Guard de disciplina no MUTATION HOOK (defesa em profundidade): mesmo que um botão/editor não gateie,
// a escrita é barrada no cliente (WriteForbiddenError) antes de tocar o banco — que também nega. (WP-DISC B3)
export function useSaveWorkoutPlan(patientId: string) {
  const qc = useQueryClient();
  const guard = useWriteGuard();
  return useMutation({
    mutationFn: (input: SaveWorkoutPlanInput) => {
      guard("workout");
      return saveWorkoutPlan(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workoutPlan(patientId) });
      qc.invalidateQueries({ queryKey: qk.allPlans });
    },
  });
}

export function useSaveNutritionPlan(patientId: string) {
  const qc = useQueryClient();
  const guard = useWriteGuard();
  return useMutation({
    mutationFn: (input: SaveNutritionPlanInput) => {
      guard("nutrition");
      return saveNutritionPlan(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.nutritionPlan(patientId) });
      qc.invalidateQueries({ queryKey: qk.allPlans });
    },
  });
}
