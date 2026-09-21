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
  // Equipe da paciente (WP-2bi-UI) — a ÚNICA consulta que traz vínculo INATIVO. Chave separada
  // de `patient(id)` de propósito: aquela é a leitura corrida (só ativos) e não deve servir esta.
  patientTeam: (patientId: string) => ["patient", patientId, "team"] as const,
  // Pacientes sem responsável ativo (RPC por CLÍNICA, admin-only) — alimenta o badge da listagem.
  patientsWithoutProfessional: (clinicId: string) =>
    ["patients", "withoutActiveProfessional", clinicId] as const,
  chatThread: (patientId: string) => ["patient", patientId, "chat"] as const,
  unreadMentions: (profileId: string) => ["chat", "mentions", profileId] as const,
  // Inbox do profissional (WP-07B2). Escopada por profile — NÃO misturar com mentions.
  staffNotifications: (profileId: string) => ["staffNotifications", profileId] as const,
  staffNotificationsUnread: (profileId: string) =>
    ["staffNotifications", profileId, "unreadCount"] as const,
  // Profissionais do canal (RPC channel_professionals). Chaveado por CANAL, não por paciente: é o
  // canal que a RPC recebe e é ele que define quem participa.
  // ⚠️ O `includeAuthors` ENTRA NA CHAVE porque as duas chamadas devolvem conjuntos diferentes e
  // respondem a perguntas diferentes: false = "quem posso marcar agora" (roster), true = "quem
  // escreveu isto" (roster ∪ autores). Compartilhar cache faria o seletor oferecer um desativado
  // — ou o histórico perder o nome do autor —, dependendo de quem chegasse primeiro.
  channelProfessionals: (channelId: string, includeAuthors: boolean) =>
    ["chat", "professionals", channelId, includeAuthors ? "with-authors" : "roster"] as const,
  // URL assinada de anexo do chat (TTL curto; não cachear além do TTL).
  chatAttachmentUrl: (path: string) => ["chat", "attachment", path] as const,
  currentProfessional: (profileId: string) => ["currentProfessional", profileId] as const,
  currentProfessionalRecord: (profileId: string) => ["currentProfessional", profileId, "record"] as const,
  // Identidade real: profile resolvido por auth_user_id (auth.uid()).
  profileByAuthUser: (authUserId: string) => ["profileByAuthUser", authUserId] as const,
  clinicProfessionals: (clinicId: string) => ["clinicProfessionals", clinicId] as const,
  clinic: (clinicId: string) => ["clinic", clinicId] as const,
  // Solicitações de acesso à clínica (WP-JOIN-1). `myJoinRequests` não leva o profile no key: a
  // RLS já escopa ao chamador, e a sessão troca o cache inteiro no signOut (queryClient.clear()).
  myJoinRequests: ["joinRequests", "mine"] as const,
  pendingJoinRequests: (clinicId: string) => ["joinRequests", "pending", clinicId] as const,
  // Fila completa (tela de Equipe). Chave separada da contagem: são consultas diferentes
  // (select de linhas × head+count) e a tela não deve reaproveitar o cache do badge.
  pendingJoinRequestList: (clinicId: string) => ["joinRequests", "pendingList", clinicId] as const,
  // Sinal REAL "sou admin da clínica?" (RPC am_i_clinic_admin). null = clínica do logado (server-side).
  clinicAdmin: (clinicId: string | null) => ["clinicAdmin", clinicId ?? "self"] as const,
  clinicBillingIdentity: (clinicId: string) => ["billingIdentity", clinicId] as const,
  sellableBillingPlans: () => ["billingCatalog", "sellable"] as const,
  clinicCommercialCheckout: (clinicId: string) => ["billingCheckout", clinicId] as const,
  clinicCommercialUsage: (clinicId: string) => ["billingCommercialUsage", clinicId] as const,
  clinicBillingOverview: (clinicId: string) => ["billingHub", "overview", clinicId] as const,
  clinicBillingCharges: (clinicId: string) => ["billingHub", "charges", clinicId] as const,
  clinicBillingPayments: (clinicId: string) => ["billingHub", "payments", clinicId] as const,
  clinicBillingTimeline: (clinicId: string) => ["billingHub", "timeline", clinicId] as const,
  // Trilha de auditoria de exportação (WP-REPORT B) — lista filtrada/paginada + profissionais p/ filtro.
  reportExports: (filters: unknown, page: number) => ["reportExports", filters, page] as const,
  clinicProfessionalProfiles: (clinicId: string) => ["clinicProfessionalProfiles", clinicId] as const,
  // Disciplinas (WP-DISC B): lista canônica, do profissional logado, e da equipe da clínica (admin).
  disciplinesList: ["disciplines", "list"] as const,
  myDisciplines: (professionalId: string) => ["disciplines", "mine", professionalId] as const,
  clinicDisciplines: (clinicId: string) => ["disciplines", "clinic", clinicId] as const,
  // Trilha imutável de estado do profissional (WP-TEAM-2b-ii). Admin-only pela RLS: para o
  // não-admin a consulta volta vazia, e "vazia" aqui significaria "ninguém foi desativado" —
  // por isso a tela só a habilita para admin.
  professionalStatusEvents: (clinicId: string) => ["professionals", "statusEvents", clinicId] as const,
  // Minhas clínicas + o MEU status em cada uma (RPC my_clinic_memberships). Sem parâmetro: a
  // chave não leva profile porque a RPC já é escopada ao chamador e o signOut limpa o cache.
  myClinicMemberships: ["clinicMemberships", "mine"] as const,
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
  // Integração Google Calendar — escopada por clínica + profissional dono da conexão.
  calendarConnection: (clinicId: string, professionalId: string) =>
    ["calendarConnection", clinicId, professionalId] as const,
  calendarEvents: (clinicId: string, professionalId: string, fromISO: string, toISO: string) =>
    ["calendarEvents", clinicId, professionalId, fromISO, toISO] as const,
  // Platform Admin (WP-10B2B) — isolado do cache clínico. NÃO misturar com clinicAdmin.
  platformAccess: ["platform", "access"] as const,
  platformClinics: ["platform", "clinics"] as const,
  platformClinicPixStatuses: ["platform", "clinicPixStatuses"] as const,
  clinicOnboardingState: ["onboarding", "clinic"] as const,
  platformOnboardingSettings: ["platform", "onboardingSettings"] as const,
  platformClinicRequests: ["platform", "clinicRequests"] as const,
  platformBillingOverview: ["platform", "billing", "overview"] as const,
  platformBillingClinics: (filters: unknown) => ["platform", "billing", "clinics", filters] as const,
  platformClinicBillingDetail: (clinicId: string) =>
    ["platform", "billing", "clinic", clinicId] as const,
  platformBillingCharges: (filters: unknown) => ["platform", "billing", "charges", filters] as const,
  platformBillingPayments: (filters: unknown) =>
    ["platform", "billing", "payments", filters] as const,
  platformBillingEvents: (filters: unknown) => ["platform", "billing", "events", filters] as const,
  platformBillingReport: (period: unknown) => ["platform", "billing", "report", period] as const,
  platformBillingCommercial: ["platform", "billing", "commercial"] as const,
  platformCommercialAccess: ["platform", "billing", "commercialAccess"] as const,
  clinicCommercialAccess: (clinicId: string) => ["billingCommercialAccess", clinicId] as const,
  platformClinicCommercialDetail: (clinicId: string) =>
    ["platform", "billing", "commercial", "clinic", clinicId] as const,
  platformCommercialPlanOptions: ["platform", "billing", "commercial", "plans"] as const,
  myProfileAvatar: (profileId: string) => ["profileAvatar", profileId] as const,
  avatarSignedUrl: (path: string) => ["avatar", "signedUrl", path] as const,
  avatarSignedUrlBatch: (fingerprint: string) => ["avatar", "signedUrlBatch", "profile-avatars", fingerprint] as const,
};
