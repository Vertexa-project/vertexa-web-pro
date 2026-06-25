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
  created_at: string;
}

export interface Clinic {
  id: string;
  name: string;
  owner_profile_id: string | null;
  created_at: string;
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
  captured_in_app: boolean;
  taken_at: string;
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
  body: string;
  created_at: string;
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
  profile: Pick<Profile, "full_name" | "email" | "avatar_url"> | null;
  snapshot:
    | Pick<AdherenceSnapshot, "score" | "level" | "status" | "weekly_completion_rate" | "calculated_at">
    | null;
  professionals: ProfessionalSummary[];
  lastActivityAt: string | null;
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
