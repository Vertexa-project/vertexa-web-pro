// Tipos do banco VERTEXA (derivados de docs/SCHEMA.sql).
// Compartilhado com o app paciente — NÃO renomear tabelas/colunas sem alinhar.
// Ideal pós-MVP: gerar via `supabase gen types typescript`.

// ========== ENUMS ==========
export type UserRole = "professional" | "patient" | "admin";
export type ProfessionalType =
  | "doctor"
  | "nutritionist"
  | "physiotherapist"
  | "personal_trainer"
  | "other";
export type PatientStatus =
  | "novo"
  | "em_acompanhamento"
  | "atencao"
  | "em_risco"
  | "inativo";
export type MuscleStatus =
  | "fatigued"
  | "recovering"
  | "recovered"
  | "weakened"
  | "neutral";

// ========== TABLE ROWS ==========
export interface Profile {
  id: string;
  auth_user_id: string | null;
  role: UserRole;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  // active | pending — pending = profissional criado no 1o login sem match por e-mail
  // (sem professional/clinic; web mostra PendingAccess). Migration 20260708120000.
  status: string;
  created_at: string;
}

export interface Clinic {
  id: string;
  name: string;
  owner_profile_id: string | null;
  created_at: string;
  // Código de acesso compartilhável (WP-JOIN-1). Migration 20260803090000: NOT NULL no banco, mas
  // opcional aqui porque um build da web pode rodar contra um banco anterior à migration.
  join_code?: string | null;
}

export interface Professional {
  id: string;
  profile_id: string | null;
  clinic_id: string | null;
  type: ProfessionalType;
  registry_number: string | null;
  specialty: string | null;
}

export interface Patient {
  id: string;
  profile_id: string | null;
  clinic_id: string | null;
  birth_date: string | null;
  sex: string | null;
  height_cm: number | null;
  goal: string | null;
  start_date: string | null;
  start_weight: number | null;
  current_weight: number | null;
  target_weight: number | null;
}

export interface ProfessionalPatientLink {
  id: string;
  professional_id: string | null;
  patient_id: string | null;
  is_external: boolean;
  status: string;
  created_at: string;
}

export interface WorkoutPlan {
  id: string;
  patient_id: string | null;
  professional_id: string | null;
  title: string;
  goal: string | null;
  created_at: string;
}

export interface Workout {
  id: string;
  workout_plan_id: string | null;
  letter: string | null;
  name: string;
  primary_muscle_group: string | null;
  day_index: number | null;
  estimated_minutes: number | null;
}

export interface WorkoutExercise {
  id: string;
  workout_id: string | null;
  name: string;
  muscle_groups: string[] | null;
  sets: number | null;
  reps: number | null;
  load_kg: number | null;
  rest_seconds: number | null;
  gif_url: string | null;
  notes: string | null;
  order_index: number | null;
}

export interface NutritionPlan {
  id: string;
  patient_id: string | null;
  professional_id: string | null;
  title: string;
  status: string;
  created_at: string;
}

export interface Meal {
  id: string;
  nutrition_plan_id: string | null;
  time: string | null;
  name: string | null;
  items: string[] | null;
  calories: number | null;
  order_index: number | null;
}

export interface BodyAssessment {
  id: string;
  patient_id: string | null;
  professional_id: string | null;
  assessed_at: string | null;
  method: string | null; // bioimpedancia | adipometro | dexa | manual
  weight: number | null;
  body_fat_pct: number | null;
  measurements: Record<string, unknown> | null;
  document_url: string | null;
  created_at: string;
}

export interface ProgressPhoto {
  id: string;
  patient_id: string | null;
  photo_url: string;
  /**
   * WP-STORAGE-P2: path canônico no bucket privado `progress-photos` ({patient_id}/{uuid}.ext).
   * Fonte da signed URL na exibição. NULL = linha legada → fallback `photo_url`. Convive com
   * `photo_url` (STORAGE-CONTRACT-1); não substitui o legado.
   */
  storage_path: string | null;
  captured_in_app: boolean;
  taken_at: string;
}

// Suplemento do paciente (tabela `supplements`, criada pela S3 do app). AUTORIA do profissional:
// a WEB escreve (editor) e o APP LÊ (getMySupplements, ordena por order_index). NÃO renomear/remover
// colunas — quebra o app. O "tomado" vive em `supplement_intakes` (app), fora deste tipo.
export interface Supplement {
  id: string;
  patient_id: string;
  name: string;
  dose: string | null;
  time_label: string | null;
  order_index: number;
  created_at: string;
}

// Documento/exame do paciente (PDF/imagem) — bucket PRIVADO 'patient-documents' + URL assinada
// (migration 20260702230000). Modelo BIDIRECIONAL: a WEB escreve (uploaded_by_role='professional');
// o app paciente lerá/ESCREVERÁ no futuro (uploaded_by_role='patient'). NÃO renomear colunas sem
// alinhar aqui + no CONTRATO. file_path = CAMINHO do objeto no bucket (NÃO URL pública) — resolver
// via createSignedUrl no clique.
export type DocumentUploaderRole = "professional" | "patient";
// Tipo do documento — texto flexível no banco; estes são os valores canônicos da UI.
export type PatientDocumentKind = "exam" | "report" | "other";

export interface PatientDocument {
  id: string;
  patient_id: string;
  uploaded_by_role: DocumentUploaderRole;
  uploaded_by_professional_id: string | null; // professionals.id (null quando o paciente envia)
  kind: string; // 'exam' | 'report' | 'other' (texto flexível — ver PatientDocumentKind)
  title: string | null;
  file_path: string; // caminho no bucket privado (NÃO URL pública)
  mime_type: string | null;
  file_size_bytes: number | null;
  uploaded_at: string;
  created_at: string;
}

// Documento com o nome de quem enviou resolvido (professionals -> profiles) para a lista da web.
export interface PatientDocumentView extends PatientDocument {
  uploaded_by_name: string | null;
}

// Peso auto-reportado pelo paciente no app (tabela canônica do VALOR de peso).
// Compartilhada com o app paciente — ver docs/CONTRATO_INTEGRACAO.md (spine de dados).
export interface WeightLog {
  id: string;
  patient_id: string | null;
  weight_kg: number;
  measured_at: string;
  source: string; // 'app' (paciente) | 'web' (profissional) | outros
  created_at: string;
}

// Ponto unificado do gráfico de peso: avaliações clínicas (body_assessments) +
// auto-reportes do app (weight_logs), normalizados num só formato.
export interface WeightPoint {
  date: string; // ISO — measured_at (app) | assessed_at (avaliação)
  weight: number;
  source: "assessment" | "app";
  method: string | null; // método da avaliação clínica (null para registros do app)
}

export interface ActivityEvent {
  id: string;
  patient_id: string | null;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface MuscleRecoveryState {
  id: string;
  patient_id: string | null;
  muscle_group: string;
  last_trained_at: string | null;
  last_intensity: number | null;
  status: MuscleStatus;
  calculated_at: string;
}

export interface AdherenceSnapshot {
  id: string;
  patient_id: string | null;
  score: number | null;
  level: string | null;
  status: PatientStatus | null;
  streak: number | null;
  weekly_completion_rate: number | null;
  risk_factors: string[] | null;
  positive_factors: string[] | null;
  calculated_at: string;
}

// Chat multiprofissional (novo schema — substitui a tabela legada `messages`).
// Tabelas compartilhadas com o app paciente — NÃO renomear sem alinhar.
export interface ChatChannel {
  id: string;
  patient_id: string | null;
  created_at: string;
}

export interface ChatParticipant {
  id: string;
  channel_id: string | null;
  profile_id: string | null;
  role: UserRole;
}

export interface ChatMessage {
  id: string;
  channel_id: string | null;
  sender_profile_id: string | null;
  sender_role: UserRole;
  /** ANULÁVEL desde WP-CHAT-ATTACH A: mensagem só-anexo não tem texto (CHECK exige body OU anexo). */
  body: string | null;
  created_at: string;
  // Anexo (1 por mensagem; bucket privado chat-attachments, caminho {channel_id}/{uuid}.{ext}).
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  /**
   * Mensagem citada (WP-CHAT-MENTIONS-A). A FK é COMPOSTA com channel_id, então o banco já
   * garante que a citada é do MESMO canal — a UI não reimplementa essa regra.
   */
  reply_to_message_id: string | null;
}

export interface Campaign {
  id: string;
  clinic_id: string | null;
  name: string;
  trigger: string | null;
  message_template: string | null;
  is_active: boolean;
  created_at: string;
}

// Agenda interna do profissional (Sessão 6) — web-only (o app paciente NÃO usa).
// NÃO renomear colunas sem alinhar no CONTRATO. patient_id = patients.id; professional_id = professionals.id.

// Tipo do compromisso (Sessão 12) — categoria clínica + cor no calendário.
export type AppointmentType = "consulta" | "retorno" | "previsao_retorno" | "outros";
// Status do compromisso (Sessão 12) — CICLO CLÍNICO. NÃO confundir com CalendarConnectionStatus
// (saúde OAuth) nem com CalendarEventCache.status (valor cru do Google) — três domínios distintos.
export type AppointmentStatus = "confirmado" | "pendente" | "desmarcado";

export interface Appointment {
  id: string;
  clinic_id: string; // NOT NULL no banco (isolamento por clínica)
  patient_id: string | null;
  professional_id: string | null;
  title: string;
  starts_at: string; // ISO timestamptz
  ends_at: string | null;
  notes: string | null;
  type: AppointmentType; // NOT NULL no banco (default 'consulta')
  status: AppointmentStatus; // NOT NULL no banco (default 'confirmado')
  created_at: string;
}

// Compromisso com nomes resolvidos (paciente/profissional) para a lista da agenda.
export interface AppointmentView extends Appointment {
  patient_name: string | null;
  professional_name: string | null;
}

// Integração Google Calendar (Sessão 10) — web/Edge-only (o app paciente NÃO usa).
// METADADO da conexão: SEM tokens. Os tokens vivem em calendar_connection_tokens (DENY-ALL no banco,
// só acessível por Edge Function/service_role) — o client NUNCA os lê.
export type CalendarConnectionStatus = "connected" | "revoked" | "error" | "stale";

export interface CalendarConnection {
  id: string;
  clinic_id: string;
  professional_id: string | null;
  provider: string; // 'google'
  google_account_email: string | null;
  google_calendar_id: string | null;
  calendar_name: string | null;
  scopes: string | null;
  status: CalendarConnectionStatus;
  last_synced_at: string | null; // ISO timestamptz
  created_at: string;
  updated_at: string;
}

// Espelho read-only dos eventos do Google (preenchido pela Edge Function de sync). web/Edge-only.
export interface CalendarEventCache {
  id: string;
  connection_id: string;
  clinic_id: string;
  google_event_id: string;
  title: string | null;
  starts_at: string; // ISO timestamptz
  ends_at: string | null;
  all_day: boolean;
  status: string | null;
  synced_at: string;
}

// Item unificado da Agenda do Dashboard — discriminado por FONTE. Eventos 'google' são READ-ONLY
// (sem editar/excluir); 'internal' carrega o AppointmentView para o CRUD interno da Sessão 6.
export interface AgendaItem {
  id: string; // prefixado por fonte (ex.: "internal:<uuid>" / "google:<uuid>") — chave estável de UI
  source: "internal" | "google";
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  patient_name: string | null;
  professional_name: string | null;
  /** Só para 'internal' — tipo/ciclo clínico do compromisso (Sessão 12). */
  appointmentType?: AppointmentType;
  appointmentStatus?: AppointmentStatus;
  /** Só para 'google' — status cru do evento no Google (confirmed/tentative/cancelled). */
  googleEventStatus?: string | null;
  /** Só para 'internal' — base do editar/excluir. */
  appointment?: AppointmentView;
}

// ========== VIEW / COMPOSED TYPES (shapes retornados pela camada api/) ==========
export interface ProfessionalSummary {
  id: string;
  type: ProfessionalType;
  full_name: string | null;
}

export interface PatientListItem {
  id: string;
  goal: string | null;
  current_weight: number | null;
  start_date: string | null;
  // WP-KANBAN B: data de nascimento (DATE) para os marcos DERIVADOS do cartão (aniversário do ano
  // corrente). A RLS já limita quais pacientes cada um enxerga — é o MESMO caminho de leitura, só
  // acrescido de uma coluna (sem novo acesso).
  birth_date: string | null;
  profile: Pick<Profile, "full_name" | "email" | "avatar_url"> | null;
  snapshot:
    | Pick<AdherenceSnapshot, "score" | "level" | "status" | "weekly_completion_rate" | "calculated_at">
    | null;
  professionals: ProfessionalSummary[];
  lastActivityAt: string | null;
  // Recência por tipo de registro — base para "pendências" (sem peso/foto/treino recente).
  // Peso = weight_logs.measured_at (valor canônico); foto = progress_photos.taken_at;
  // treino = activity_events(type='workout_checked').created_at. Ver lib/domain/pendencies.ts.
  lastWeightAt: string | null;
  lastPhotoAt: string | null;
  lastWorkoutAt: string | null;
}

export interface PatientDetail extends Patient {
  profile: Profile | null;
  professionals: ProfessionalSummary[];
}

export interface WorkoutWithExercises extends Workout {
  workout_exercises: WorkoutExercise[];
}

export interface WorkoutPlanFull extends WorkoutPlan {
  workouts: WorkoutWithExercises[];
}

export interface NutritionPlanFull extends NutritionPlan {
  meals: Meal[];
}

// Mensagem com o nome do remetente resolvido (clínica/profissional — NUNCA "Vertexa").
export interface ChatMessageView extends ChatMessage {
  sender_name: string | null;
  /**
   * Perfis marcados NESTA mensagem. Vem do mesmo SELECT da lista (embed de chat_mentions), e não
   * de uma segunda leitura: a policy chat_mentions_select libera `can_read_channel`, então quem lê
   * a conversa lê as marcações dela. É a fonte do destaque "você foi marcado aqui".
   */
  mentioned_profile_ids: string[];
}

/**
 * Profissional participante do canal, como devolvido pela RPC `public.channel_professionals`
 * (SECURITY DEFINER, portão `private.can_read_channel`).
 *
 * ⚠️ NÃO trocar por embed: `professionals_select` exige ser o PRÓPRIO profissional ou admin da
 * clínica, então um profissional COMUM lê ZERO linha dos colegas — e embed aninhado bloqueado por
 * RLS não devolve erro, devolve VAZIO. A RPC é o único caminho que não mente.
 */
export interface ChannelProfessional {
  profileId: string;
  /** Nome do banco; já cai para "Profissional" quando vem nulo/vazio. */
  name: string;
  type: ProfessionalType | null;
  specialty: string | null;
  /** Codes de public.disciplines (a RPC devolve `{}` quando não há nenhuma). */
  disciplines: string[];
}

// Shape completo que a tela de Mensagens precisa: canal resolvido + profissional
// atuante (remetente em modo demo) + histórico.
export interface ChatThread {
  channelId: string;
  actingProfileId: string | null;
  messages: ChatMessageView[];
}

export interface PlanListItem {
  id: string;
  type: "treino" | "alimentar";
  title: string;
  patientId: string;
  patientName: string | null;
  createdAt: string;
}
