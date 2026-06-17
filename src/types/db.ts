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

export interface Message {
  id: string;
  patient_id: string | null;
  sender_role: UserRole;
  sender_professional_id: string | null;
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
