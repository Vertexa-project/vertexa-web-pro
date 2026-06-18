// Factory central de query keys — hierárquica por paciente para facilitar invalidação.
export const qk = {
  patients: ["patients"] as const,
  patient: (id: string) => ["patient", id] as const,
  patientTimeline: (id: string) => ["patient", id, "timeline"] as const,
  workoutPlan: (patientId: string) => ["patient", patientId, "workoutPlan"] as const,
  nutritionPlan: (patientId: string) => ["patient", patientId, "nutritionPlan"] as const,
  bodyAssessments: (patientId: string) => ["patient", patientId, "bodyAssessments"] as const,
  progressPhotos: (patientId: string) => ["patient", patientId, "progressPhotos"] as const,
  muscleRecovery: (patientId: string) => ["patient", patientId, "muscleRecovery"] as const,
  adherenceSnapshot: (patientId: string) => ["patient", patientId, "adherenceSnapshot"] as const,
  chatThread: (patientId: string) => ["patient", patientId, "chat"] as const,
  unreadMentions: (profileId: string) => ["chat", "mentions", profileId] as const,
  campaigns: ["campaigns"] as const,
  allPlans: ["plans", "all"] as const,
};
