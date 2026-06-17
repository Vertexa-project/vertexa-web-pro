import { useQuery } from "@tanstack/react-query";

import { getNutritionPlan, getWorkoutPlan } from "@/lib/api/plans";
import { qk } from "@/lib/queryKeys";

export const useWorkoutPlan = (patientId: string) =>
  useQuery({
    queryKey: qk.workoutPlan(patientId),
    queryFn: () => getWorkoutPlan(patientId),
    enabled: Boolean(patientId),
  });

export const useNutritionPlan = (patientId: string) =>
  useQuery({
    queryKey: qk.nutritionPlan(patientId),
    queryFn: () => getNutritionPlan(patientId),
    enabled: Boolean(patientId),
  });
