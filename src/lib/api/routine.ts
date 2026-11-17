import { supabase } from "@/lib/supabase";
import type { ClinicRoutineSettings, MissionView, RoutineView } from "@/lib/domain/routine";

const COLS = "clinic_id, routine_enabled, photo_period, photo_weekday, weight_period, weight_weekday, feedback_period, feedback_weekday, mission_enabled, mission_days, mission_steps";

/** Padrão da clínica (null = a clínica ainda não salvou nada: tudo desligado). */
export async function getClinicRoutineSettings(clinicId: string): Promise<ClinicRoutineSettings | null> {
  const { data, error } = await supabase.from("clinic_routine_settings").select(COLS).eq("clinic_id", clinicId).maybeSingle();
  if (error) throw error;
  return (data as ClinicRoutineSettings | null) ?? null;
}

export async function saveClinicRoutineSettings(clinicId: string, settings: Partial<Omit<ClinicRoutineSettings, "clinic_id">>): Promise<void> {
  const { error } = await supabase.rpc("save_clinic_routine_settings", { p_clinic_id: clinicId, p_settings: settings });
  if (error) throw error;
}

export async function getPatientRoutine(patientId: string, weeks = 4): Promise<RoutineView> {
  const { data, error } = await supabase.rpc("get_patient_routine", { p_patient_id: patientId, p_weeks: weeks });
  if (error) throw error;
  return data as RoutineView;
}

export type RoutineOverrideInput =
  | { mode: "off" }
  | { mode: "custom"; settings: Partial<Pick<ClinicRoutineSettings, "photo_period" | "photo_weekday" | "weight_period" | "weight_weekday" | "feedback_period" | "feedback_weekday">> };

export async function savePatientRoutineOverride(patientId: string, input: RoutineOverrideInput): Promise<void> {
  const { error } = await supabase.rpc("save_patient_routine_override", { p_patient_id: patientId, p_mode: input.mode, p_settings: input.mode === "custom" ? input.settings : {} });
  if (error) throw error;
}

export async function clearPatientRoutineOverride(patientId: string): Promise<void> {
  const { error } = await supabase.rpc("clear_patient_routine_override", { p_patient_id: patientId });
  if (error) throw error;
}

export async function getPatientMission(patientId: string): Promise<MissionView> {
  const { data, error } = await supabase.rpc("get_patient_mission", { p_patient_id: patientId });
  if (error) throw error;
  return data as MissionView;
}

export async function startPatientMission(patientId: string, restart = false): Promise<void> {
  const { error } = await supabase.rpc("start_patient_mission", { p_patient_id: patientId, p_restart: restart });
  if (error) throw error;
}
