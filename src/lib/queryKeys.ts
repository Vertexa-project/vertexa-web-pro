// Factory central de query keys — hierárquica por paciente para facilitar invalidação.
export const qk = {
  patients: ["patients"] as const,
  patient: (id: string) => ["patient", id] as const,
  patientTimeline: (id: string) => ["patient", id, "timeline"] as const,
  workoutPlan: (patientId: string) => ["patient", patientId, "workoutPlan"] as const,
  nutritionPlan: (patientId: string) => ["patient", patientId, "nutritionPlan"] as const,
  bodyAssessments: (patientId: string) => ["patient", patientId, "bodyAssessments"] as const,
  patientDocuments: (patientId: string) => ["patient", patientId, "documents"] as const,
  weightSeries: (patientId: string) => ["patient", patientId, "weightSeries"] as const,
  hydrationToday: (patientId: string) => ["patient", patientId, "hydrationToday"] as const,
  progressPhotos: (patientId: string) => ["patient", patientId, "progressPhotos"] as const,
  muscleRecovery: (patientId: string) => ["patient", patientId, "muscleRecovery"] as const,
  adherenceSnapshot: (patientId: string) => ["patient", patientId, "adherenceSnapshot"] as const,
  chatThread: (patientId: string) => ["patient", patientId, "chat"] as const,
  unreadMentions: (profileId: string) => ["chat", "mentions", profileId] as const,
  currentProfessional: (profileId: string) => ["currentProfessional", profileId] as const,
  currentProfessionalRecord: (profileId: string) => ["currentProfessional", profileId, "record"] as const,
  clinicProfessionals: (clinicId: string) => ["clinicProfessionals", clinicId] as const,
  campaigns: ["campaigns"] as const,
  allPlans: ["plans", "all"] as const,
  // Agenda interna (Sessão 6) — escopada por clínica + janela de tempo.
  appointments: (clinicId: string, scope: string) => ["appointments", clinicId, scope] as const,
  // Ledger humano de migrations (Sessão 7) — seção admin em Configurações.
  migrationLog: ["migrationLog"] as const,
};
