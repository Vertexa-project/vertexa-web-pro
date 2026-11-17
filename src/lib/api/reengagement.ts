import { supabase } from "@/lib/supabase";
import { DEFAULT_CONFIG, type ReengagementConfig, type ReengagementLineData, type ReengagementState } from "@/lib/domain/reengagement";

interface SettingsRow {
  is_active: boolean; send_chat: boolean;
  day_1: number; day_2: number; day_3: number;
  title_1: string; title_2: string; title_3: string; body_1: string; body_2: string; body_3: string;
}

/** Configuração da clínica; sem linha ainda = padrão (desligado). */
export async function getReengagementConfig(clinicId: string): Promise<ReengagementConfig> {
  const { data, error } = await supabase.from("reengagement_settings").select("*").eq("clinic_id", clinicId).maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_CONFIG;
  const r = data as SettingsRow;
  return {
    isActive: r.is_active, sendChat: r.send_chat,
    steps: [
      { day: r.day_1, title: r.title_1, body: r.body_1 },
      { day: r.day_2, title: r.title_2, body: r.body_2 },
      { day: r.day_3, title: r.title_3, body: r.body_3 },
    ],
  };
}

/** Grava a configuração inteira (só admin da clínica; o banco recusa os demais). */
export async function saveReengagementConfig(clinicId: string, c: ReengagementConfig): Promise<void> {
  const { error } = await supabase.rpc("save_reengagement_settings", {
    p_clinic: clinicId, p_active: c.isActive, p_send_chat: c.sendChat,
    p_days: c.steps.map((s) => s.day), p_titles: c.steps.map((s) => s.title), p_bodies: c.steps.map((s) => s.body),
  });
  if (error) throw error;
}

export interface ReengagementOverviewRow {
  patient_id: string; full_name: string; last_interaction_day: string; idle_days: number;
  steps_sent: number; last_step: number | null; last_sent_on: string | null; state: ReengagementState;
}
export async function listReengagementOverview(clinicId: string): Promise<ReengagementOverviewRow[]> {
  const { data, error } = await supabase.rpc("reengagement_overview", { p_clinic: clinicId });
  if (error) throw error;
  return (data ?? []) as ReengagementOverviewRow[];
}

export interface ReengagementSendRow { id: string; patient_id: string; step: number; sent_on: string; title: string; simulated: boolean }
export async function listReengagementHistory(): Promise<ReengagementSendRow[]> {
  const { data, error } = await supabase.from("reengagement_sends").select("id, patient_id, step, sent_on, title, simulated")
    .order("sent_at", { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as ReengagementSendRow[];
}

/** Linha da ficha; null = nunca recebeu reengajamento. */
export async function getPatientReengagementLine(patientId: string): Promise<ReengagementLineData | null> {
  const { data, error } = await supabase.rpc("patient_reengagement_line", { p_patient: patientId });
  if (error) throw error;
  return (data ?? null) as ReengagementLineData | null;
}
