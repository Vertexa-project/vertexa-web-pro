import { useMutation, useQueryClient } from "@tanstack/react-query";

import { publishWorkoutPlan } from "@/lib/api/workoutPublish";
import { useWriteGuard } from "@/hooks/useDisciplines";
import { qk } from "@/lib/queryKeys";

export function usePublishWorkout(patientId: string) {
  const qc = useQueryClient();
  const guard = useWriteGuard();
  return useMutation({
    mutationFn: (v: { planId: string; notify: boolean }) => {
      guard("workout");
      return publishWorkoutPlan(v.planId, v.notify);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workoutPlan(patientId) });
      qc.invalidateQueries({ queryKey: qk.allPlans });
    },
  });
}
