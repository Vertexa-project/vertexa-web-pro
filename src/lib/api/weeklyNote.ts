import { supabase } from "@/lib/supabase";

/** Recado escrito pela equipe para a semana que começa em `weekStart` (segunda). null = nenhum (o app mostra o automático). */
export async function getWeeklyNote(patientId: string, weekStart: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("weekly_team_notes")
    .select("body")
    .eq("patient_id", patientId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return (data as { body: string } | null)?.body ?? null;
}

/** Grava o recado da semana; texto vazio apaga e o paciente volta a ver o recado automático. */
export async function setWeeklyNote(patientId: string, weekStart: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("set_weekly_note", { p_patient: patientId, p_week: weekStart, p_body: body });
  if (error) throw error;
}
