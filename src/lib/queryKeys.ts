// Factory central de query keys — hierárquica por paciente para facilitar invalidação.
export const qk = {
  patients: ["patients"] as const,
  patient: (id: string) => ["patient", id] as const,
  patientTimeline: (id: string) => ["patient", id, "timeline"] as const,
  workoutPlan: (patientId: string) => ["patient", patientId, "workoutPlan"] as const,
  nutritionPlan: (patientId: string) => ["patient", patientId, "nutritionPlan"] as const,
  bodyAssessments: (patientId: string) => ["patient", patientId, "bodyAssessments"] as const,
  patientDocuments: (patientId: string) => ["patient", patientId, "documents"] as const,
  // Exames/documentos REAIS (tabela patient_documents) — distinto do `patientDocuments` legado
  // (laudos de body_assessments.document_url) para não colidir a invalidação.
  patientExams: (patientId: string) => ["patient", patientId, "exams"] as const,
  weightSeries: (patientId: string) => ["patient", patientId, "weightSeries"] as const,
  hydrationToday: (patientId: string) => ["patient", patientId, "hydrationToday"] as const,
  hydrationDaily: (patientId: string, days: number) => ["patient", patientId, "hydrationDaily", days] as const,
  progressPhotos: (patientId: string) => ["patient", patientId, "progressPhotos"] as const,
  patientSupplements: (patientId: string) => ["patient", patientId, "supplements"] as const,
  muscleRecovery: (patientId: string) => ["patient", patientId, "muscleRecovery"] as const,
  adherenceSnapshot: (patientId: string) => ["patient", patientId, "adherenceSnapshot"] as const,
  chatThread: (patientId: string) => ["patient", patientId, "chat"] as const,
  unreadMentions: (profileId: string) => ["chat", "mentions", profileId] as const,
  // URL assinada de anexo do chat (TTL curto; não cachear além do TTL).
  chatAttachmentUrl: (path: string) => ["chat", "attachment", path] as const,
  currentProfessional: (profileId: string) => ["currentProfessional", profileId] as const,
  currentProfessionalRecord: (profileId: string) => ["currentProfessional", profileId, "record"] as const,
  // Identidade real: profile resolvido por auth_user_id (auth.uid()).
  profileByAuthUser: (authUserId: string) => ["profileByAuthUser", authUserId] as const,
  clinicProfessionals: (clinicId: string) => ["clinicProfessionals", clinicId] as const,
  clinic: (clinicId: string) => ["clinic", clinicId] as const,
  // Sinal REAL "sou admin da clínica?" (RPC am_i_clinic_admin). null = clínica do logado (server-side).
  clinicAdmin: (clinicId: string | null) => ["clinicAdmin", clinicId ?? "self"] as const,
  // Trilha de auditoria de exportação (WP-REPORT B) — lista filtrada/paginada + profissionais p/ filtro.
  reportExports: (filters: unknown, page: number) => ["reportExports", filters, page] as const,
  clinicProfessionalProfiles: (clinicId: string) => ["clinicProfessionalProfiles", clinicId] as const,
  // Disciplinas (WP-DISC B): lista canônica, do profissional logado, e da equipe da clínica (admin).
  disciplinesList: ["disciplines", "list"] as const,
  myDisciplines: (professionalId: string) => ["disciplines", "mine", professionalId] as const,
  clinicDisciplines: (clinicId: string) => ["disciplines", "clinic", clinicId] as const,
  // Jornada do paciente (WP-KANBAN B): colunas por clínica, estado atual (por paciente) e marcos
  // reconhecidos. `journeyState`/`journeyAcks` são globais (a RLS escopa ao que o usuário acessa).
  journeyColumns: (clinicId: string) => ["journey", "columns", clinicId] as const,
  journeyState: ["journey", "state"] as const,
  journeyAcks: ["journey", "acks"] as const,
  campaigns: ["campaigns"] as const,
  allPlans: ["plans", "all"] as const,
  // Agenda interna (Sessão 6/12) — escopada por clínica + faixa visível do calendário [from, to).
  appointments: (clinicId: string, fromISO: string, toISO: string) =>
    ["appointments", clinicId, fromISO, toISO] as const,
  // Integração Google Calendar (Sessão 10/12) — escopada por clínica.
  calendarConnection: (clinicId: string) => ["calendarConnection", clinicId] as const,
  calendarEvents: (clinicId: string, fromISO: string, toISO: string) =>
    ["calendarEvents", clinicId, fromISO, toISO] as const,
};
